"""
ofertas_router.py
------------------
Nuevo tab "Ofertas": para cada producto de t_ProductoOfertadoAmp
(pantalla "Agregar oferta"), encuentra el precio máximo aceptado por
Perú Compras probando valores contra Inserta_ProductoOfertadoTMP.

Reutiliza la MISMA sesión ya autenticada por uid (perucompras_sesiones),
exactamente como ya hace _restringir_en_perucompras en extraccion_router.py
— sin login nuevo, sin Playwright.

REGLA DE ORO — NO NEGOCIABLE: este archivo no tiene ninguna función que
llame a /t_ProductoOfertadoAmp/Envia_ProductoOfertadoTMP. Solo escribe en
la tabla TMP (Inserta_ProductoOfertadoTMP) y en la auditoría propia
(perucompras_ofertas_maximos_detalle). El envío real lo hace el usuario
a mano desde la interfaz de Perú Compras.

CONCURRENCIA: esta sesión (pc_session.session) la comparten el monitor
de publicadas y la extracción — Perú Compras mata la sesión si detecta
2 requests "al mismo tiempo" con las mismas cookies. Por eso CADA
llamada HTTP de este archivo va envuelta en `with pc_session.request_lock`,
y además se pausa el monitor (m.pausar()/m.reanudar()) igual que hace
_tarea_extraccion.

FILTROS (nuevo): tanto /ejecutar como /resultados aceptan filtrar por
acuerdo marco / catálogo / categoría. Los selects en cascada para
lanzar una búsqueda filtrada se llenan en vivo desde Perú Compras
(/acuerdos, /catalogos, /categorias). Los selects para filtrar la
TABLA de resultados ya guardados se llenan desde la propia BD
(/resultados/filtros), sin tocar Perú Compras.

SALTAR EXISTENTES (nuevo): si saltar_existentes=true (default), un
producto que ya tiene un precio_maximo guardado en CUALQUIER corrida
anterior no se vuelve a probar contra Perú Compras — se copia tal cual
a la corrida nueva (motivo="reusado", intentos=0). Poné
saltar_existentes=false cuando quieras re-verificar todo porque
sospechas que los máximos cambiaron.

TECHO DE SEGURIDAD (nuevo): si la fase exponencial nunca encuentra un
rechazo y el valor probado supera PRECIO_MAXIMO_TECHO, se corta ahí
mismo (motivo="techo_seguridad") en vez de seguir duplicando el precio
sin límite — eso fue lo que desbordó la columna DECIMAL antes.
"""

import logging
import json
import re
import time
import concurrent.futures
import requests as _requests_lib_check  # noqa: F401 — solo para verificar disponibilidad si _probar_precio la necesita
from datetime import datetime
from dataclasses import dataclass
from typing import Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Query

from perucompras_login import perucompras_sesiones
from monitor_publicadas import monitor_de
from auth import obtener_usuario_actual, UsuarioToken
from db import get_conn

logger = logging.getLogger("helbot.ofertas_router")

router = APIRouter(prefix="/perucompras/ofertas", tags=["perucompras-ofertas"])

# TIMEOUT_VIVO_SEGUNDOS: si /vivo tarda más que esto (típicamente porque
# está esperando su turno en el lock compartido detrás de una búsqueda de
# precios máximos en curso), el endpoint responde con un 504 claro en vez
# de dejar que un proxy externo (nginx/Coolify) corte la conexión en seco
# — eso era lo que probablemente causaba el "error de fetch" en el
# frontend. El hilo que quedó a medias sigue corriendo en segundo plano
# (Python no puede cancelarlo), pero el usuario ya no se queda esperando
# indefinidamente ni se lleva un error críptico.
TIMEOUT_VIVO_SEGUNDOS = 25
_pool_vivo = concurrent.futures.ThreadPoolExecutor(max_workers=4)

BASE = "https://catalogos.perucompras.gob.pe"
URL_ENTRADA = f"{BASE}/t_ProductoOfertadoAmp/CatalogoProductoIndex"
URL_LISTA_CATALOGOS = f"{BASE}/General/ListaJ_CatalogoAcuerdo"
URL_LISTA_CATEGORIAS = f"{BASE}/General/ListaJ_CategoriaCatalogo"
URL_LISTA_PRODUCTOS = f"{BASE}/t_ProductoOfertadoAmp/_CatalogoProductoIndexJson"
URL_INSERTA_PRECIO = f"{BASE}/t_ProductoOfertadoAmp/Inserta_ProductoOfertadoTMP"
# OJO: payload sin verificar contra el navegador real — ver nota en _enviar_oferta_individual.
URL_ENVIA_OFERTA = f"{BASE}/t_ProductoOfertadoAmp/Envia_ProductoOfertadoTMP"

# --- parámetros de la búsqueda ---------------------------------------------
PRECIO_INICIAL = 0.10
PRECISION = 0.01

# CASCADA DE RESOLUCIÓN PARA LA FASE 1 — reemplaza el paso fijo de 10%.
# Empieza RÁPIDO (1.5x = ~21 pasos de 0.10 a 500) para no perder tiempo
# en productos con banda de precio ancha (la mayoría de los casos). Si
# ese barrido NO encuentra ningún valor aceptado, escala a un paso más
# fino (1.15x, ~61 pasos) para no saltarse una banda más angosta. Si
# TODAVÍA no encuentra nada, usa el paso más fino de todos (1.03x,
# ~288 pasos) como último recurso — esto prácticamente garantiza
# encontrar cualquier banda válida que exista dentro de
# [0, PRECIO_MAXIMO_TECHO], aunque sea muy angosta. La gran mayoría de
# productos se resuelve en el PRIMER nivel (rápido); solo los casos
# difíciles pagan el costo de los niveles siguientes.
FACTORES_CASCADA_FASE1 = [1.5, 1.15, 1.03]
MAX_ITER_FASE2 = 40
MAX_ITER_FASE3 = 30
PAUSA_ENTRE_REQUESTS = 0.12  # respiro por request, evita gatillar un WAF/rate-limit
# Techo de seguridad — LÍMITE DE NEGOCIO, no solo técnico: un producto
# de este catálogo no tiene sentido que valga más que esto. Perú Compras
# puede llegar a aceptar valores absurdos (se vieron casos ~8,000,000),
# pero eso no es un precio coherente — es solo que el portal no valida
# techos. Por eso la búsqueda NUNCA prueba ni reporta un valor fuera de
# [0, PRECIO_MAXIMO_TECHO]; si Perú Compras seguiría aceptando más allá
# de acá, se corta y se marca motivo="techo_seguridad" para que se
# revise a mano en vez de mandarlo automático.
PRECIO_MAXIMO_TECHO = 500.00

ERROR_MARKERS = ("limites extremos", "límites extremos", "fuera de los limites")

_estado_ofertas = {
    "corriendo": False,
    "producto_actual": None,
    "productos_completados": 0,
    "total_productos": 0,
    "iniciado_en": None,
    "terminado_en": None,
    "error": None,
    "run_id": None,
}


# --- descubrimiento de acuerdos (HTML) --------------------------------------
# OJO — CALIBRAR: el <select id="ajaxAcuerdo"> podría venir vacío en el
# HTML plano si Perú Compras lo llena por AJAX en vez de renderizarlo en
# el servidor (a diferencia de catálogo/categoría, que SÍ vimos que se
# llenan dinámicamente tras elegir el acuerdo). Si el log de warning de
# abajo aparece seguido, actualiza ACUERDOS_RESPALDO a mano (ábrelo en el
# navegador, inspecciona #ajaxAcuerdo > option, o la pestaña Network por
# si hay un endpoint tipo ListaJ_AcuerdoMarco que no vimos todavía).
ACUERDOS_RESPALDO: list[tuple[str, str]] = [
    ("370", "EXT-CE-2024-17 BEBIDAS NO ALCOHÓLICAS"),
    ("372", "EXT-CE-2024-18 CEREALES, ACEITE, AZUCARES Y MENESTRAS"),
    ("376", "EXT-CE-2024-26 MAQUINAS, EQUIPOS Y HERRAMIENTAS PARA JARDINERIA, SILVICULTURA Y AGRICULTURA"),
]

_PATRON_SELECT_ACUERDO = re.compile(r'<select[^>]*id=["\']ajaxAcuerdo["\'][^>]*>(.*?)</select>', re.S)
_PATRON_OPTION = re.compile(r'<option[^>]*value=["\']([^"\']*)["\'][^>]*>([^<]*)</option>', re.S)


def _obtener_acuerdos(session) -> list[tuple[str, str]]:
    r = session.get(URL_ENTRADA, timeout=30)
    m = _PATRON_SELECT_ACUERDO.search(r.text)
    if m:
        opciones = [
            (v, t.strip()) for v, t in _PATRON_OPTION.findall(m.group(1))
            if v not in ("", "0")
        ]
        if opciones:
            return opciones
    logger.warning(
        "No se pudo extraer <select id='ajaxAcuerdo'> del HTML de %s — "
        "usando ACUERDOS_RESPALDO. Revisa/actualiza esa lista si hace falta.",
        URL_ENTRADA,
    )
    return ACUERDOS_RESPALDO


def _obtener_catalogos(session, n_acuerdo: str) -> list[dict]:
    resp = session.post(
        URL_LISTA_CATALOGOS,
        data={"N_Acuerdo": n_acuerdo, "C_Estado": "ACTIVO"},
        headers={"X-Requested-With": "XMLHttpRequest"},
        timeout=30,
    )
    datos = _json_o_falla(resp, f"Listar catálogos del acuerdo {n_acuerdo}")
    return [{"value": d["Value"], "text": d["Text"]} for d in datos]


def _obtener_categorias(session, n_catalogo: str) -> list[dict]:
    """
    OJO: solo cubre N_Nivel=1 con N_CategoriaParent=0, igual que el único
    ejemplo real que tenemos. Si algún catálogo tiene categorías
    anidadas (nivel 2+), habría que recursar pasando N_CategoriaParent =
    value de la categoría de nivel 1 — no lo implementé porque no vimos
    un caso real con sub-niveles.
    """
    resp = session.post(
        URL_LISTA_CATEGORIAS,
        data={"N_Catalogo": n_catalogo, "N_CategoriaParent": "0", "C_Estado": "ACTIVO", "N_Nivel": "1"},
        headers={"X-Requested-With": "XMLHttpRequest"},
        timeout=30,
    )
    datos = _json_o_falla(resp, f"Listar categorías del catálogo {n_catalogo}")
    return [{"value": d["Value"], "text": d["Text"]} for d in datos]


class RespuestaPeruComprasInvalida(Exception):
    """
    Perú Compras devolvió algo que NO es el JSON esperado: sesión caída
    (redirect a la pantalla de login, que es HTML), cuerpo vacío, un
    error 5xx del propio portal, o un WAF interceptando la request. Es
    un caso completamente distinto a un rechazo de negocio (eso lo
    maneja es_rechazado) — acá ni siquiera hay una respuesta con la que
    trabajar, así que hay que cortar temprano con un mensaje claro en
    vez de dejar que raise un JSONDecodeError críptico más abajo.
    """
    def __init__(self, contexto: str, resp):
        self.contexto = contexto
        self.status_code = getattr(resp, "status_code", None)
        cuerpo = getattr(resp, "text", "") or ""
        self.fragmento = cuerpo[:300]
        parece_login = "login" in cuerpo.lower() or "iniciar sesión" in cuerpo.lower() or "iniciar sesion" in cuerpo.lower()
        pista = (
            " (el cuerpo de la respuesta parece una pantalla de login — "
            "la sesión de Perú Compras probablemente expiró o fue cerrada)"
            if parece_login else ""
        )
        super().__init__(
            f"{contexto}: Perú Compras respondió HTTP {self.status_code} con un cuerpo que no es JSON{pista}. "
            f"Fragmento: {self.fragmento!r}"
        )


def _json_o_falla(resp, contexto: str):
    """
    Envoltorio de resp.json() que, en vez de dejar que reviente con un
    JSONDecodeError sin contexto, levanta RespuestaPeruComprasInvalida
    con el HTTP status y un fragmento del cuerpo real — lo necesario
    para diagnosticar sesión caída vs. HTML cambiado vs. portal caído,
    sin tener que reproducir el bug a mano.
    """
    try:
        return resp.json()
    except ValueError as e:
        raise RespuestaPeruComprasInvalida(contexto, resp) from e

def _columnas_datatable() -> dict:
    nombres = [
        "C_Imagen", "C_Descripcion", "C_ArchivoDescriptivo",
        "C_MonedaOfertada", "N_PrecioOfertado", "N_CatalogoProducto", "C_Estado",
    ]
    params = {}
    for i, nombre in enumerate(nombres):
        params[f"columns[{i}][data]"] = nombre
        params[f"columns[{i}][name]"] = nombre
        params[f"columns[{i}][searchable]"] = "true"
        params[f"columns[{i}][orderable]"] = "true"
        params[f"columns[{i}][search][value]"] = ""
        params[f"columns[{i}][search][regex]"] = "false"
    return params


def _obtener_productos(session, n_acuerdo: str, n_catalogo: str, n_categoria: str, longitud_pagina: int = 500) -> list[dict]:
    productos: list[dict] = []
    start = 0
    while True:
        form = {
            "draw": "1", **_columnas_datatable(),
            "order[0][column]": "0", "order[0][dir]": "asc",
            "start": str(start), "length": str(longitud_pagina),
            "search[value]": "", "search[regex]": "false",
            "N_Acuerdo": n_acuerdo, "N_Catalogo": n_catalogo, "N_Categoria": n_categoria,
            "C_Descripcion": "",
        }
        resp = session.post(URL_LISTA_PRODUCTOS, data=form, headers={"X-Requested-With": "XMLHttpRequest"}, timeout=30)
        cuerpo = _json_o_falla(resp, f"Listar productos (acuerdo={n_acuerdo}, catálogo={n_catalogo}, categoría={n_categoria})")
        filas = cuerpo.get("data", [])
        productos.extend(filas)
        total = int(cuerpo.get("recordsTotal", len(productos)))
        start += longitud_pagina
        if start >= total or not filas:
            break
    return productos


# --- prueba de precio + algoritmo de 3 fases --------------------------------

def es_rechazado(status_ok: bool, texto_respuesta: str) -> bool:
    if not status_ok:
        return True
    bajo = texto_respuesta.lower()
    if any(m in bajo for m in ERROR_MARKERS):
        return True
    # Muchos endpoints ASP.NET MVC devuelven JSON con un campo de éxito
    # explícito (o un mensaje de error) en vez de (o además de) alguna
    # de las frases de ERROR_MARKERS. Si el texto no matchea pero el
    # JSON dice claramente que falló, también es un rechazo.
    try:
        cuerpo = json.loads(texto_respuesta)
    except (ValueError, TypeError):
        return False
    if isinstance(cuerpo, dict):
        for clave in ("success", "Success", "resultado", "Resultado", "ok", "Ok", "isValid", "IsValid"):
            if clave in cuerpo and cuerpo[clave] is False:
                return True
        for clave in ("error", "Error", "mensaje", "Mensaje", "message", "Message"):
            valor = cuerpo.get(clave)
            if isinstance(valor, str) and valor.strip():
                return True
    return False


import requests as _requests_lib  # alias local, evita chocar con el nombre 'requests' si se usa como variable en otro lado

MAX_REINTENTOS_CONEXION = 4
ESPERA_BASE_REINTENTO = 1.5  # segundos — backoff exponencial: 1.5, 3, 6, 12


def _probar_precio(pc_session, id_producto: int, moneda: str, precio: float) -> bool:
    """
    Cada llamada toma el lock SOLO para esta única request HTTP (no para
    toda una búsqueda de precio máximo). Así, mientras una corrida larga
    está probando cientos de valores, un vistazo rápido desde /vivo puede
    colarse entre request y request en vez de quedarse esperando a que
    termine el producto entero.

    REINTENTOS DE CONEXIÓN (nuevo): con el algoritmo de pasos finos
    (FACTOR_CRECIMIENTO_FASE1), una corrida puede mandar 100+ requests
    seguidas por producto. Perú Compras (o un WAF delante) a veces corta
    la conexión en seco ("RemoteDisconnected: Remote end closed
    connection without response") bajo esa carga sostenida — no es un
    error de negocio, es la conexión TCP muriendo sin dar respuesta.
    Reintentamos con backoff exponencial antes de rendirnos; si TODOS
    los reintentos fallan, dejamos que la excepción suba (la maneja el
    try/except por producto en _tarea_ofertas, que ya no tumba toda la
    corrida — ver ese bloque).
    """
    ultimo_error = None
    for intento in range(MAX_REINTENTOS_CONEXION):
        try:
            with pc_session.request_lock:
                resp = pc_session.session.post(
                    URL_INSERTA_PRECIO,
                    data={"N_CatalogoProducto": str(id_producto), "C_MonedaOfertada": moneda, "N_PrecioOfertado": f"{precio:.2f}"},
                    headers={"X-Requested-With": "XMLHttpRequest"},
                    timeout=30,
                )
            rechazado = es_rechazado(resp.ok, resp.text)
            time.sleep(PAUSA_ENTRE_REQUESTS)
            return not rechazado
        except _requests_lib.exceptions.RequestException as e:
            ultimo_error = e
            if intento < MAX_REINTENTOS_CONEXION - 1:
                espera = ESPERA_BASE_REINTENTO * (2 ** intento)
                logger.warning(
                    "Conexión caída probando precio %.2f para producto %s (intento %d/%d) — reintentando en %.1fs: %s",
                    precio, id_producto, intento + 1, MAX_REINTENTOS_CONEXION, espera, e,
                )
                time.sleep(espera)
    # Se agotaron los reintentos: dejamos que suba, para que el llamador
    # (búsqueda de un producto, guardado manual, envío de oferta) decida
    # cómo manejar esta falla persistente en vez de fingir un resultado.
    raise ultimo_error


VALOR_CANARIO_INVALIDO = 999_999.99
# Muy por encima de cualquier precio real y del propio techo de
# seguridad. Cualquier validación real de Perú Compras debería
# rechazarlo. Si en cambio lo "acepta", significa que el mensaje de
# rechazo de ESTE producto/catálogo no coincide con nada de lo que
# es_rechazado sabe reconocer — y confiar en la escalera normal
# terminaría trepando derecho hasta el techo (500.00) sin haber
# encontrado nunca un máximo real.

def _probar_precio_con_diagnostico(pc_session, id_producto: int, moneda: str, precio: float) -> tuple[bool, str]:
    """
    Igual que _probar_precio pero además devuelve el texto crudo de la
    respuesta, para poder diagnosticar por qué algo se consideró
    aceptado o rechazado. Solo se usa en el canario y en el resultado
    final del techo — no en el loop caliente de la búsqueda normal,
    para no cargar memoria/logs de más en las ~100 llamadas por producto.
    """
    ultimo_error = None
    for intento in range(MAX_REINTENTOS_CONEXION):
        try:
            with pc_session.request_lock:
                resp = pc_session.session.post(
                    URL_INSERTA_PRECIO,
                    data={"N_CatalogoProducto": str(id_producto), "C_MonedaOfertada": moneda, "N_PrecioOfertado": f"{precio:.2f}"},
                    headers={"X-Requested-With": "XMLHttpRequest"},
                    timeout=30,
                )
            aceptado = not es_rechazado(resp.ok, resp.text)
            time.sleep(PAUSA_ENTRE_REQUESTS)
            return aceptado, resp.text
        except _requests_lib.exceptions.RequestException as e:
            ultimo_error = e
            if intento < MAX_REINTENTOS_CONEXION - 1:
                time.sleep(ESPERA_BASE_REINTENTO * (2 ** intento))
    raise ultimo_error


def _verificar_deteccion_funciona(pc_session, id_producto: int, moneda: str) -> tuple[bool, str]:
    """
    True si Perú Compras rechazó el valor absurdo (la detección de
    rechazo funciona para este producto). False + el texto crudo si lo
    "aceptó" (la detección está rota para este producto puntual).
    """
    aceptado, texto = _probar_precio_con_diagnostico(pc_session, id_producto, moneda, VALOR_CANARIO_INVALIDO)
    return (not aceptado), texto[:500]

@dataclass
class ResultadoBusqueda:
    precio_maximo: Optional[float]
    intentos: int
    motivo: str
    detalle: str = ""



def _confirmar_precio_final(pc_session, id_producto: int, moneda: str, precio: float, intentos_maximos: int = 3) -> bool:
    """
    Reintenta poner `precio` en Inserta_ProductoOfertadoTMP hasta
    intentos_maximos veces, devolviendo True SOLO si Perú Compras lo
    aceptó de verdad. Antes esta confirmación se hacía "a ciegas" (sin
    mirar el resultado), y motivo='ok' se guardaba igual aunque esta
    llamada fallara — dejando precio_maximo correcto en la BD pero el
    campo real en Perú Compras en 0 o en un valor viejo.
    """
    for _ in range(intentos_maximos):
        if _probar_precio(pc_session, id_producto, moneda, precio):
            return True
    return False




def _barrido_creciente(pc_session, id_producto: int, moneda: str, factor: float, techo: float) -> tuple[Optional[float], int]:
    """
    Prueba valores empezando en PRECIO_INICIAL, multiplicando por `factor`
    en cada paso, hasta llegar a `techo` o encontrar el primer valor
    aceptado. Devuelve (valor_aceptado_o_None, intentos_usados). Es el
    "un nivel" de la cascada de resolución — se llama con factores cada
    vez más finos hasta que alguno encuentre algo.
    """
    intentos = 0
    valor = PRECIO_INICIAL
    while valor < techo:
        intentos += 1
        if _probar_precio(pc_session, id_producto, moneda, valor):
            return valor, intentos
        valor = round(valor * factor, 2)
    return None, intentos


def _encontrar_precio_maximo(pc_session, id_producto: int, moneda: str) -> ResultadoBusqueda:
    """
    Busca el máximo aceptado por Perú Compras, pero NUNCA fuera de
    [0, PRECIO_MAXIMO_TECHO] — ni para probar valores, ni para reportar
    un resultado.

    FASE 1 (encontrar CUALQUIER valor aceptado): avanza con pasos de
    +10% (FACTOR_CRECIMIENTO_FASE1) en vez de duplicar, porque Perú
    Compras parece validar una banda [piso, techo] alrededor de un
    precio de referencia (ver nota en ERROR_MARKERS) — con pasos
    grandes (x2) se puede saltar de un valor rechazado por BAJO directo
    a uno rechazado por ALTO sin nunca tocar la banda válida en el medio.
    Con +10% es mucho más difícil que eso pase.

    FASE 2 (encontrar el TECHO real, una vez que ya sabemos que hay un
    valor válido): acá sí conviene ir rápido (x2), porque ya estamos
    DENTRO de la banda y solo buscamos la primera vez que nos pasamos
    del límite superior — no hay riesgo de "saltarnos" nada porque
    partimos de un punto ya confirmado como válido.

    FASE 3: bisección normal para afinar el techo exacto.
    """
    intentos = 1
    deteccion_ok, texto_canario = _verificar_deteccion_funciona(pc_session, id_producto, moneda)
    if not deteccion_ok:
        return ResultadoBusqueda(
            None, intentos, "deteccion_no_confiable",
            f"Perú Compras ACEPTÓ un precio de prueba absurdo ({VALOR_CANARIO_INVALIDO:.2f}) para este producto. "
            f"Esto indica que el mensaje real de rechazo de este catálogo/producto no coincide con ninguno de los "
            f"ERROR_MARKERS conocidos {ERROR_MARKERS}, así que la búsqueda normal terminaría trepando directo hasta "
            f"el techo de seguridad sin encontrar un máximo real. Fragmento de la respuesta de Perú Compras para "
            f"ajustar ERROR_MARKERS: {texto_canario!r}",
        )

    lo: Optional[float] = None
    factor_que_encontro = None

    for factor in FACTORES_CASCADA_FASE1:
        candidato, usados = _barrido_creciente(pc_session, id_producto, moneda, factor, PRECIO_MAXIMO_TECHO)
        intentos += usados
        if candidato is not None:
            lo = candidato
            factor_que_encontro = factor
            break

    if lo is None:
        # Ni siquiera el nivel más fino de la cascada (1.03x) encontró un
        # valor aceptado por debajo del techo — probamos el techo mismo
        # como último recurso antes de rendirnos.
        intentos += 1
        if _probar_precio(pc_session, id_producto, moneda, PRECIO_MAXIMO_TECHO):
            return ResultadoBusqueda(
                PRECIO_MAXIMO_TECHO, intentos, "techo_seguridad",
                f"Perú Compras acepta valores hasta el techo de seguridad ({PRECIO_MAXIMO_TECHO:.2f}); se usa el techo como máximo coherente.",
            )
        return ResultadoBusqueda(
            None, intentos, "sin_rango_encontrado",
            f"Ningún valor probado fue aceptado, ni siquiera con la cascada completa de resoluciones "
            f"{FACTORES_CASCADA_FASE1} ni el techo de seguridad ({PRECIO_MAXIMO_TECHO:.2f}). "
            f"Revisar a mano en el tab 'en vivo' — puede que el precio válido para este producto "
            f"esté fuera del rango [0, {PRECIO_MAXIMO_TECHO:.2f}].",
        )

    hi: Optional[float] = None
    valor = round(lo * 2, 2)
    for _ in range(MAX_ITER_FASE2):
        if valor >= PRECIO_MAXIMO_TECHO:
            intentos += 1
            if _probar_precio(pc_session, id_producto, moneda, PRECIO_MAXIMO_TECHO):
                return ResultadoBusqueda(
                    PRECIO_MAXIMO_TECHO, intentos, "techo_seguridad",
                    f"Se aceptó hasta {lo:.2f} y también el techo de seguridad ({PRECIO_MAXIMO_TECHO:.2f}); Perú Compras probablemente acepta más, pero se limita acá a propósito.",
                )
            hi = PRECIO_MAXIMO_TECHO
            break
        intentos += 1
        if _probar_precio(pc_session, id_producto, moneda, valor):
            lo = valor
            valor = round(valor * 2, 2)
        else:
            hi = valor
            break
    if hi is None:
        hi = PRECIO_MAXIMO_TECHO

    for _ in range(MAX_ITER_FASE3):
        if (hi - lo) <= PRECISION:
            break
        intentos += 1
        medio = round((lo + hi) / 2, 2)
        if medio == lo or medio == hi:
            break
        if _probar_precio(pc_session, id_producto, moneda, medio):
            lo = medio
        else:
            hi = medio

    # Confirmación final: la bisección puede haber terminado con el último
    # intento RECHAZADO en pantalla (hi). Volvemos a mandar exactamente
    # `lo` (el máximo aceptado, siempre <= PRECIO_MAXIMO_TECHO) para que
    # el campo "precio unitario" en Perú Compras quede efectivamente en
    # el valor máximo encontrado. A DIFERENCIA DE ANTES: acá SÍ chequeamos
    # si esta confirmación tuvo éxito. Si Perú Compras la rechaza (incluso
    # con reintentos), NO marcamos motivo="ok" — eso era el bug que dejaba
    # precio_maximo correcto en la BD pero el campo real del portal en 0.
    intentos += 1
    confirmado = _confirmar_precio_final(pc_session, id_producto, moneda, lo)
    if not confirmado:
        return ResultadoBusqueda(
            lo, intentos, "ok_no_confirmado",
            f"Se encontró el máximo teórico ({lo:.2f}) pero Perú Compras lo RECHAZÓ al intentar "
            f"dejarlo puesto en el campo, incluso reintentando. El campo del portal probablemente "
            f"NO quedó en {lo:.2f} — revisar a mano en el tab 'en vivo'.",
        )

    return ResultadoBusqueda(lo, intentos, "ok")


# --- persistencia (auditoría) -----------------------------------------------

def _crear_run(usuario_helbot: str, uid_perucompras: str) -> int:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO perucompras_ofertas_maximos_runs (usuario_helbot, uid_perucompras, iniciado_en, estado) VALUES (%s, %s, %s, 'corriendo')",
                (usuario_helbot, uid_perucompras, datetime.now()),
            )
            return cur.lastrowid
    finally:
        conn.close()


def _cerrar_run(run_id: int, estado: str, error: Optional[str], total_productos: int):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE perucompras_ofertas_maximos_runs SET terminado_en=%s, estado=%s, error=%s, total_productos=%s WHERE id=%s",
                (datetime.now(), estado, error, total_productos, run_id),
            )
    finally:
        conn.close()


def _guardar_resultado(run_id: int, producto: dict, resultado: ResultadoBusqueda):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO perucompras_ofertas_maximos_detalle
                    (run_id, id_catalogo_producto, descripcion, moneda,
                     n_acuerdo, acuerdo, n_catalogo, catalogo, n_categoria, categoria,
                     estado_actual, precio_maximo, precio_actual_al_correr,
                     intentos, motivo, detalle, creado_en)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    run_id, producto["id_catalogo_producto"], producto["descripcion"], producto["moneda"],
                    producto.get("n_acuerdo"), producto["acuerdo"],
                    producto.get("n_catalogo"), producto["catalogo"],
                    producto.get("n_categoria"), producto["categoria"],
                    producto["estado_actual"], resultado.precio_maximo, producto.get("precio_actual"),
                    resultado.intentos, resultado.motivo, resultado.detalle,
                    datetime.now(),
                ),
            )
        conn.commit()
    except Exception as e:
        # No tumbamos la corrida completa por un producto puntual que no
        # se pudo guardar (ej. algo raro en la descripción/encoding).
        logger.exception(
            "No se pudo guardar el resultado del producto %s (run_id=%s)",
            producto.get("id_catalogo_producto"), run_id,
        )
        conn2 = get_conn()
        try:
            with conn2.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO perucompras_ofertas_maximos_detalle
                        (run_id, id_catalogo_producto, descripcion, moneda, acuerdo, catalogo, categoria,
                         estado_actual, precio_maximo, intentos, motivo, detalle, creado_en)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL, %s, %s, %s, %s)
                    """,
                    (
                        run_id, producto["id_catalogo_producto"], producto["descripcion"], producto["moneda"],
                        producto["acuerdo"], producto["catalogo"], producto["categoria"], producto["estado_actual"],
                        resultado.intentos, "error_guardado", f"{type(e).__name__}: {e}",
                        datetime.now(),
                    ),
                )
            conn2.commit()
        except Exception:
            logger.exception("Tampoco se pudo guardar la fila de error_guardado, se omite este producto.")
        finally:
            conn2.close()
    finally:
        conn.close()


def _obtener_ultimos_precios() -> dict:
    """
    Último precio_maximo con motivo='ok' guardado por producto, sin
    importar de qué run venga.

    OJO — por qué exigimos motivo='ok' (y no solo "no nulo"): un
    resultado con motivo 'techo_seguridad' o 'sin_rango_encontrado' NO
    es un máximo confirmado — es una señal de que la búsqueda no pudo
    encontrar el verdadero límite (por ejemplo, por el bug de saltarse
    una banda angosta que existía antes de ajustar
    FACTOR_CRECIMIENTO_FASE1). Si tratáramos esos casos como "ya
    resueltos", 'saltar_existentes' los reusaría para siempre, sin
    volver a intentarlo nunca con el algoritmo corregido.

    Al exigir motivo='ok', cualquier producto que haya quedado en
    NULL o en techo_seguridad automáticamente se vuelve a calcular
    la próxima vez que se corra la búsqueda (con saltar_existentes=true,
    que es el default) — sin que el usuario tenga que filtrar ni
    seleccionar nada a mano.
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id_catalogo_producto, precio_maximo, motivo, detalle
                FROM (
                    SELECT id_catalogo_producto, precio_maximo, motivo, detalle,
                           ROW_NUMBER() OVER (PARTITION BY id_catalogo_producto ORDER BY creado_en DESC) AS rn
                    FROM perucompras_ofertas_maximos_detalle
                    WHERE precio_maximo IS NOT NULL AND precio_maximo <= %s AND motivo = 'ok'
                ) t
                WHERE rn = 1
                """,
                (PRECIO_MAXIMO_TECHO,),
            )
            return {f["id_catalogo_producto"]: f for f in cur.fetchall()}
    finally:
        conn.close()

def _guardar_precio_manual(id_producto: int, precio: float, moneda: str, aceptado: bool, usuario: str):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO perucompras_ofertas_manual
                    (id_catalogo_producto, precio_unitario, moneda, aceptado_perucompras, actualizado_en, actualizado_por)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    precio_unitario = VALUES(precio_unitario),
                    moneda = VALUES(moneda),
                    aceptado_perucompras = VALUES(aceptado_perucompras),
                    actualizado_en = VALUES(actualizado_en),
                    actualizado_por = VALUES(actualizado_por),
                    enviado_en = NULL,
                    enviado_por = NULL,
                    envio_error = NULL
                """,
                (id_producto, precio, moneda, 1 if aceptado else 0, datetime.now(), usuario),
            )
        conn.commit()
    finally:
        conn.close()



def _obtener_precios_manual(ids: list[int]) -> dict:
    if not ids:
        return {}
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            marcadores = ",".join(["%s"] * len(ids))
            cur.execute(
                f"""
                SELECT id_catalogo_producto, precio_unitario, moneda, aceptado_perucompras,
                       actualizado_en, actualizado_por, enviado_en, enviado_por, envio_error
                FROM perucompras_ofertas_manual
                WHERE id_catalogo_producto IN ({marcadores})
                """,
                tuple(ids),
            )
            return {f["id_catalogo_producto"]: f for f in cur.fetchall()}
    finally:
        conn.close()

def _resolver_run_id(uid: str, run_id: int) -> int:
    if run_id:
        return run_id
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if uid:
                cur.execute(
                    "SELECT id FROM perucompras_ofertas_maximos_runs WHERE uid_perucompras=%s ORDER BY id DESC LIMIT 1",
                    (uid,),
                )
            else:
                cur.execute("SELECT id FROM perucompras_ofertas_maximos_runs ORDER BY id DESC LIMIT 1")
            fila = cur.fetchone()
            return fila["id"] if fila else 0
    finally:
        conn.close()


def _recolectar_productos(pc_session, n_acuerdo_filtro, n_catalogo_filtro, n_categoria_filtro) -> list[dict]:
    """
    Recorre acuerdo -> catálogo -> categoría en Perú Compras y devuelve la
    lista de productos, incluyendo el precio actual que YA tiene puesto el
    portal en ese momento (N_PrecioOfertado) — sin ninguna llamada extra,
    es el mismo dato que ya venía trayendo _obtener_productos.
    """
    session = pc_session.session
    with pc_session.request_lock:
        acuerdos = _obtener_acuerdos(session)
    if n_acuerdo_filtro:
        acuerdos = [a for a in acuerdos if a[0] == n_acuerdo_filtro]

    productos_totales: list[dict] = []
    for n_acuerdo, texto_acuerdo in acuerdos:
        with pc_session.request_lock:
            catalogos = _obtener_catalogos(session, n_acuerdo)
        if n_catalogo_filtro:
            catalogos = [c for c in catalogos if c["value"] == n_catalogo_filtro]
        for catalogo in catalogos:
            with pc_session.request_lock:
                categorias = _obtener_categorias(session, catalogo["value"])
            if n_categoria_filtro:
                categorias = [c for c in categorias if c["value"] == n_categoria_filtro]
            for categoria in categorias:
                with pc_session.request_lock:
                    filas = _obtener_productos(session, n_acuerdo, catalogo["value"], categoria["value"])
                for fila in filas:
                    productos_totales.append({
                        "id_catalogo_producto": fila["N_CatalogoProducto"],
                        "descripcion": fila.get("C_Descripcion", ""),
                        "moneda": fila.get("C_MonedaOfertada", "PEN"),
                        "n_acuerdo": n_acuerdo,
                        "acuerdo": texto_acuerdo,
                        "n_catalogo": catalogo["value"],
                        "catalogo": catalogo["text"],
                        "n_categoria": categoria["value"],
                        "categoria": categoria["text"],
                        "estado_actual": fila.get("C_Estado", ""),
                        "precio_actual": fila.get("N_PrecioOfertado"),
                    })
    return productos_totales


# --- tarea en background ----------------------------------------------------

def _tarea_ofertas(
    uid: str,
    run_id: int,
    n_acuerdo_filtro: Optional[str],
    n_catalogo_filtro: Optional[str],
    n_categoria_filtro: Optional[str],
    saltar_existentes: bool,
    usuario_helbot: str,
):
    pc_session = perucompras_sesiones.sesion(uid)
    m = monitor_de(uid)
    _estado_ofertas.update({
        "corriendo": True, "producto_actual": None,
        "productos_completados": 0, "total_productos": 0,
        "iniciado_en": datetime.now().isoformat(),
        "terminado_en": None, "error": None, "run_id": run_id,
    })
    if m:
        m.pausar()
    try:
        productos_totales = _recolectar_productos(pc_session, n_acuerdo_filtro, n_catalogo_filtro, n_categoria_filtro)

        _estado_ofertas["total_productos"] = len(productos_totales)

        ultimos_precios = _obtener_ultimos_precios() if saltar_existentes else {}

        for producto in productos_totales:
            _estado_ofertas["producto_actual"] = producto["descripcion"][:80]

            try:
                existente = ultimos_precios.get(producto["id_catalogo_producto"])
                if existente is not None:
                    # Aunque reusamos el valor guardado (no volvemos a "buscar"),
                    # sí mandamos ese precio a Inserta_ProductoOfertadoTMP para
                    # que el campo "precio unitario" quede puesto en pantalla,
                    # igual que si lo hubiéramos recalculado ahora. Con
                    # confirmación real (ver _confirmar_precio_final): si Perú
                    # Compras rechaza dejarlo puesto, NO lo marcamos como
                    # "reusado" sin más.
                    confirmado = _confirmar_precio_final(
                        pc_session, producto["id_catalogo_producto"], producto["moneda"], existente["precio_maximo"]
                    )
                    if confirmado:
                        resultado = ResultadoBusqueda(
                            precio_maximo=existente["precio_maximo"],
                            intentos=0,
                            motivo="reusado",
                            detalle=f"Reusado del último valor guardado (motivo original: {existente['motivo']}).",
                        )
                    else:
                        resultado = ResultadoBusqueda(
                            precio_maximo=existente["precio_maximo"],
                            intentos=0,
                            motivo="reusado_no_confirmado",
                            detalle=f"El valor reusado ({existente['precio_maximo']:.2f}) fue RECHAZADO por Perú Compras "
                                    f"al intentar dejarlo puesto ahora — el campo del portal probablemente NO quedó en ese valor.",
                        )
                else:
                    resultado = _encontrar_precio_maximo(pc_session, producto["id_catalogo_producto"], producto["moneda"])

                _guardar_resultado(run_id, producto, resultado)

                if resultado.precio_maximo is not None and resultado.motivo in ("ok", "reusado"):
                    _guardar_precio_manual(
                        producto["id_catalogo_producto"], resultado.precio_maximo, producto["moneda"],
                        aceptado=True, usuario=f"{usuario_helbot} (búsqueda automática)",
                    )
                elif resultado.motivo in ("ok_no_confirmado", "reusado_no_confirmado"):
                    _guardar_precio_manual(
                        producto["id_catalogo_producto"], resultado.precio_maximo, producto["moneda"],
                        aceptado=False, usuario=f"{usuario_helbot} (búsqueda automática, no confirmado)",
                    )

            except _requests_lib.exceptions.RequestException as e:
                # La conexión se cayó de forma persistente (se agotaron los
                # reintentos de _probar_precio) para ESTE producto puntual.
                # En vez de tumbar la corrida entera (lo que pasaba antes),
                # lo registramos como error de este producto y seguimos con
                # el siguiente — así una falla de red aislada no te hace
                # perder el trabajo ya avanzado sobre el resto del catálogo.
                logger.exception(
                    "Fallo de conexión persistente en producto %s (run_id=%s) — se salta y sigue con el siguiente",
                    producto.get("id_catalogo_producto"), run_id,
                )
                resultado_error = ResultadoBusqueda(
                    None, 0, "error_conexion",
                    f"Conexión con Perú Compras caída de forma persistente: {type(e).__name__}: {e}. "
                    f"No se pudo determinar el precio para este producto en esta corrida — probar de nuevo más tarde.",
                )
                _guardar_resultado(run_id, producto, resultado_error)

            _estado_ofertas["productos_completados"] += 1

        _cerrar_run(run_id, "completado", None, _estado_ofertas["total_productos"])
    except Exception as e:
        logger.exception("Error en _tarea_ofertas")
        _estado_ofertas["error"] = str(e)
        _cerrar_run(run_id, "error", str(e), _estado_ofertas.get("total_productos", 0))
    finally:
        if m:
            m.reanudar()
        _estado_ofertas["corriendo"] = False
        _estado_ofertas["terminado_en"] = datetime.now().isoformat()


# --- endpoints ---------------------------------------------------------------

@router.post("/ejecutar")
def ejecutar_ofertas(
    uid: str,
    background_tasks: BackgroundTasks,
    n_acuerdo: Optional[str] = None,
    n_catalogo: Optional[str] = None,
    n_categoria: Optional[str] = None,
    saltar_existentes: bool = True,
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")
    if _estado_ofertas["corriendo"]:
        return {"ok": True, "detalle": "Ya hay una búsqueda de precios máximos en curso"}

    usuario_helbot = usuario.nombre_completo or usuario.username
    run_id = _crear_run(usuario_helbot, uid)
    background_tasks.add_task(
        _tarea_ofertas, uid, run_id, n_acuerdo, n_catalogo, n_categoria, saltar_existentes, usuario_helbot,
    )
    return {"ok": True, "detalle": "Búsqueda de precios máximos iniciada en background", "run_id": run_id}

@router.get("/estado")
def estado_ofertas():
    return _estado_ofertas


@router.get("/acuerdos")
def listar_acuerdos_ep(uid: str, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")
    with pc_session.request_lock:
        acuerdos = _obtener_acuerdos(pc_session.session)
    return {"acuerdos": [{"value": v, "text": t} for v, t in acuerdos]}


@router.get("/catalogos")
def listar_catalogos_ep(uid: str, n_acuerdo: str, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")
    try:
        with pc_session.request_lock:
            catalogos = _obtener_catalogos(pc_session.session, n_acuerdo)
    except RespuestaPeruComprasInvalida as e:
        logger.warning("Respuesta inválida de Perú Compras en /catalogos (uid=%s): %s", uid, e)
        raise HTTPException(502, f"Perú Compras no devolvió los catálogos esperados (posible sesión expirada). Detalle: {e}")
    return {"catalogos": catalogos}


@router.get("/categorias")
def listar_categorias_ep(uid: str, n_catalogo: str, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")
    try:
        with pc_session.request_lock:
            categorias = _obtener_categorias(pc_session.session, n_catalogo)
    except RespuestaPeruComprasInvalida as e:
        logger.warning("Respuesta inválida de Perú Compras en /categorias (uid=%s): %s", uid, e)
        raise HTTPException(502, f"Perú Compras no devolvió las categorías esperadas (posible sesión expirada). Detalle: {e}")
    return {"categorias": categorias}


@router.get("/vivo")
def ofertas_en_vivo(
    uid: str,
    n_acuerdo: Optional[str] = None,
    n_catalogo: Optional[str] = None,
    n_categoria: Optional[str] = None,
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    """
    Consulta EN VIVO a Perú Compras (sin tocar la BD para los datos del
    portal). Además le pega el precio manual que ya tenías guardado en tu
    BD para cada producto (tabla perucompras_ofertas_manual), para poder
    mostrar/editar ese valor en la tabla en vivo.
    """
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    # Ya NO bloqueamos con 409 si hay una búsqueda corriendo: el
    # request_lock de la sesión serializa las llamadas HTTP igual, así
    # que esta consulta simplemente espera su turno en vez de fallar.
    # Lo único que hay que cuidar es no pisar el pausar/reanudar del
    # monitor que ya hizo la búsqueda de fondo.
    ya_pausado_por_otro = _estado_ofertas["corriendo"]
    m = monitor_de(uid)
    if m and not ya_pausado_por_otro:
        m.pausar()
    try:
        futuro = _pool_vivo.submit(_recolectar_productos, pc_session, n_acuerdo, n_catalogo, n_categoria)
        try:
            productos = futuro.result(timeout=TIMEOUT_VIVO_SEGUNDOS)
        except concurrent.futures.TimeoutError:
            raise HTTPException(
                504,
                f"Perú Compras está tardando más de {TIMEOUT_VIVO_SEGUNDOS}s en responder — probablemente "
                f"porque hay una búsqueda de precios máximos usando la misma sesión ahora mismo. "
                f"Probá filtrar por un acuerdo/catálogo/categoría específico (es más rápido), o esperá "
                f"un momento y reintentá.",
            )
        except RespuestaPeruComprasInvalida as e:
            # Perú Compras no devolvió el JSON esperado. En vez de esperar
            # hasta el próximo tick del keep-alive (hasta 90s, ver
            # KEEPALIVE_INTERVAL en perucompras_login.py) para que el
            # sistema SOLO se entere de que la sesión murió, se lo
            # avisamos ahora mismo — dispara el relogin automático de
            # inmediato en vez de dejar la sesión "zombie" (estado=activa
            # pero en realidad muerta) un rato más.
            logger.warning("Respuesta inválida de Perú Compras en /vivo (uid=%s): %s", uid, e)
            pc_session.marcar_sesion_perdida(motivo=f"/vivo recibió respuesta inválida: {e}")
            raise HTTPException(
                502,
                f"La sesión con Perú Compras se cayó — se está reconectando automáticamente. "
                f"Esperá unos segundos y reintentá. Detalle técnico: {e}",
            )
    finally:
        if m and not ya_pausado_por_otro:
            m.reanudar()

    manuales = _obtener_precios_manual([p["id_catalogo_producto"] for p in productos])
    for p in productos:
        man = manuales.get(p["id_catalogo_producto"])
        if man:
            p["precio_manual_bd"] = man["precio_unitario"]
            p["precio_manual_aceptado"] = bool(man["aceptado_perucompras"])
            p["precio_manual_actualizado_en"] = man["actualizado_en"].isoformat()
            p["precio_manual_actualizado_por"] = man["actualizado_por"]
            p["enviado_en"] = man["enviado_en"].isoformat() if man["enviado_en"] else None
            p["enviado_por"] = man["enviado_por"]
            p["envio_error"] = man["envio_error"]
        else:
            p["precio_manual_bd"] = None
            p["precio_manual_aceptado"] = None
            p["precio_manual_actualizado_en"] = None
            p["precio_manual_actualizado_por"] = None
            p["enviado_en"] = None
            p["enviado_por"] = None
            p["envio_error"] = None

    return {"total": len(productos), "productos": productos}



@router.post("/precio-manual")
def guardar_precio_manual(
    uid: str,
    id_catalogo_producto: int,
    moneda: str,
    precio: float,
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    """
    Digita el precio unitario a mano para UN producto: lo manda a
    Inserta_ProductoOfertadoTMP (queda puesto en el campo real de Perú
    Compras) y lo guarda en tu BD (perucompras_ofertas_manual), sin
    importar si viene de una búsqueda de precio máximo o no.

    NO registra oferta — sigue siendo solo el campo TMP, igual que el
    resto del archivo.
    """
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    ya_pausado_por_otro = _estado_ofertas["corriendo"]
    m = monitor_de(uid)
    if m and not ya_pausado_por_otro:
        m.pausar()
    try:
        aceptado = _confirmar_precio_final(pc_session, id_catalogo_producto, moneda, precio)
    finally:
        if m and not ya_pausado_por_otro:
            m.reanudar()


    usuario_helbot = usuario.nombre_completo or usuario.username
    _guardar_precio_manual(id_catalogo_producto, precio, moneda, aceptado, usuario_helbot)

    if not aceptado:
        return {"ok": False, "detalle": "Perú Compras rechazó ese precio (igual quedó guardado en tu BD, marcado como no aceptado)"}
    return {"ok": True, "detalle": "Precio puesto en Perú Compras y guardado en tu BD"}


@router.post("/precio-manual-lote")
def guardar_precio_manual_lote(
    uid: str,
    precio: float,
    ids: list[int] = Query(..., description="uno o varios id_catalogo_producto"),
    moneda: str = "PEN",
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    """
    Igual que /precio-manual pero aplicando el MISMO precio a varios
    productos de una sola vez — pensado para corregir en bloque productos
    que quedaron pegados al techo de seguridad (500) y ya se sabe cuál es
    el precio real. Para cada id: lo manda a Inserta_ProductoOfertadoTMP
    (queda puesto en el campo real de Perú Compras) y lo guarda en
    perucompras_ofertas_manual. Sigue sin registrar oferta.
    """
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    ya_pausado_por_otro = _estado_ofertas["corriendo"]
    m = monitor_de(uid)
    if m and not ya_pausado_por_otro:
        m.pausar()
    usuario_helbot = usuario.nombre_completo or usuario.username
    resultados = []
    try:
        for id_producto in ids:
            aceptado = _confirmar_precio_final(pc_session, id_producto, moneda, precio)
            _guardar_precio_manual(id_producto, precio, moneda, aceptado, usuario_helbot)
            resultados.append({"id_catalogo_producto": id_producto, "ok": aceptado})
    finally:
        if m and not ya_pausado_por_otro:
            m.reanudar()

    return {"resultados": resultados}


@router.get("/resultados")
def listar_resultados(
    uid: str = "",
    run_id: int = 0,
    acuerdo: str = "",
    catalogo: str = "",
    categoria: str = "",
    precio_min: Optional[float] = None,
    precio_max: Optional[float] = None,
    pagina: int = Query(1, ge=1),
    por_pagina: int = Query(50, ge=1, le=500),
):
    """
    Por defecto (run_id=0) muestra el ÚLTIMO valor guardado de CADA
    producto, sin importar de qué corrida venga — así una corrida nueva
    filtrada por otra categoría no "tapa" los resultados de corridas
    anteriores en otras categorías; se van acumulando entre corridas.

    Si se pasa un run_id específico, se filtra a esa corrida puntual tal
    cual quedó (por si alguna vez se quiere revisar una corrida vieja
    exacta, en vez de la vista acumulada).
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            condiciones = []
            parametros: list = []
            if acuerdo:
                condiciones.append("d.acuerdo = %s")
                parametros.append(acuerdo)
            if catalogo:
                condiciones.append("d.catalogo = %s")
                parametros.append(catalogo)
            if categoria:
                condiciones.append("d.categoria = %s")
                parametros.append(categoria)
            if precio_min is not None:
                condiciones.append("d.precio_maximo >= %s")
                parametros.append(precio_min)
            if precio_max is not None:
                condiciones.append("d.precio_maximo <= %s")
                parametros.append(precio_max)
            where_extra = (" AND " + " AND ".join(condiciones)) if condiciones else ""

            if run_id:
                cur.execute(
                    f"SELECT COUNT(*) AS total FROM perucompras_ofertas_maximos_detalle d WHERE d.run_id = %s{where_extra}",
                    (run_id, *parametros),
                )
                total = cur.fetchone()["total"]
                offset = (pagina - 1) * por_pagina
                cur.execute(
                    f"""
                    SELECT d.id_catalogo_producto, d.descripcion, d.moneda, d.acuerdo, d.catalogo, d.categoria,
                           d.estado_actual, d.precio_maximo, d.precio_actual_al_correr, d.intentos, d.motivo, d.detalle,
                           d.enviado_en, d.enviado_por, d.envio_error, d.creado_en, d.run_id
                    FROM perucompras_ofertas_maximos_detalle d
                    WHERE d.run_id = %s{where_extra}
                    ORDER BY d.id ASC
                    LIMIT %s OFFSET %s
                    """,
                    (run_id, *parametros, por_pagina, offset),
                )
            else:
                filtro_uid = "r.uid_perucompras = %s" if uid else "1=1"
                parametros_uid = [uid] if uid else []

                # Usamos MAX(dd.id) en vez de MAX(dd.creado_en) para el
                # "último por producto": id es autoincremental y SIEMPRE
                # único, así que el JOIN trae garantizado una sola fila
                # por producto. Con creado_en existía una rendija teórica
                # de duplicado si dos filas del mismo producto quedaban
                # con el mismo datetime exacto.
                cur.execute(
                    f"""
                    SELECT COUNT(*) AS total
                    FROM perucompras_ofertas_maximos_detalle d
                    JOIN (
                        SELECT dd.id_catalogo_producto, MAX(dd.id) AS max_id
                        FROM perucompras_ofertas_maximos_detalle dd
                        JOIN perucompras_ofertas_maximos_runs r ON dd.run_id = r.id
                        WHERE {filtro_uid}
                        GROUP BY dd.id_catalogo_producto
                    ) ult ON d.id_catalogo_producto = ult.id_catalogo_producto AND d.id = ult.max_id
                    WHERE 1=1{where_extra}
                    """,
                    (*parametros_uid, *parametros),
                )
                total = cur.fetchone()["total"]

                offset = (pagina - 1) * por_pagina
                cur.execute(
                    f"""
                    SELECT d.id_catalogo_producto, d.descripcion, d.moneda, d.acuerdo, d.catalogo, d.categoria,
                           d.estado_actual, d.precio_maximo, d.precio_actual_al_correr, d.intentos, d.motivo, d.detalle,
                           d.enviado_en, d.enviado_por, d.envio_error, d.creado_en, d.run_id
                    FROM perucompras_ofertas_maximos_detalle d
                    JOIN (
                        SELECT dd.id_catalogo_producto, MAX(dd.id) AS max_id
                        FROM perucompras_ofertas_maximos_detalle dd
                        JOIN perucompras_ofertas_maximos_runs r ON dd.run_id = r.id
                        WHERE {filtro_uid}
                        GROUP BY dd.id_catalogo_producto
                    ) ult ON d.id_catalogo_producto = ult.id_catalogo_producto AND d.id = ult.max_id
                    WHERE 1=1{where_extra}
                    ORDER BY d.id_catalogo_producto ASC
                    LIMIT %s OFFSET %s
                    """,
                    (*parametros_uid, *parametros, por_pagina, offset),
                )

            filas = cur.fetchall()
            for f in filas:
                if f.get("creado_en"):
                    f["creado_en"] = f["creado_en"].isoformat()
            return {"run_id": run_id, "total": total, "pagina": pagina, "por_pagina": por_pagina, "filas": filas}
    finally:
        conn.close()


def _enviar_oferta_individual(pc_session, id_producto: int, moneda: str, precio_maximo: float) -> tuple[bool, str]:
    # 1) reconfirmamos el precio en el campo, por si cambió algo desde el cálculo
    # original. Con reintentos (_confirmar_precio_final) en vez de un solo
    # intento — este es el checkpoint más crítico de todo el archivo, justo
    # antes de la acción irreversible, así que no puede depender de que una
    # sola llamada HTTP salga bien a la primera.
    if not _confirmar_precio_final(pc_session, id_producto, moneda, precio_maximo):
        return False, "Perú Compras rechazó el precio al reconfirmarlo justo antes de enviar (incluso con reintentos)"
    # 2) el envío real. PAYLOAD SIN VERIFICAR — confirmar con el
    # navegador (pestaña Network al hacer clic en "Registrar oferta"
    # a mano una vez) y ajustar los campos de 'data' si hace falta.
    with pc_session.request_lock:
        resp = pc_session.session.post(
            URL_ENVIA_OFERTA,
            data={"N_CatalogoProducto": str(id_producto)},
            headers={"X-Requested-With": "XMLHttpRequest"},
            timeout=30,
        )
    time.sleep(PAUSA_ENTRE_REQUESTS)

    if not resp.ok:
        return False, f"HTTP {resp.status_code}"
    if any(m in resp.text.lower() for m in ERROR_MARKERS):
        return False, resp.text[:300]
    return True, ""

def _marcar_enviado(id_catalogo_producto: int, run_id: int, ok: bool, error: str, usuario: str):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if ok:
                cur.execute(
                    """UPDATE perucompras_ofertas_maximos_detalle
                       SET enviado_en=%s, enviado_por=%s, envio_error=NULL
                       WHERE run_id=%s AND id_catalogo_producto=%s""",
                    (datetime.now(), usuario, run_id, id_catalogo_producto),
                )
            else:
                cur.execute(
                    """UPDATE perucompras_ofertas_maximos_detalle
                       SET envio_error=%s
                       WHERE run_id=%s AND id_catalogo_producto=%s""",
                    (error, run_id, id_catalogo_producto),
                )
        conn.commit()
    finally:
        conn.close()


@router.post("/enviar")
def enviar_ofertas(
    uid: str,
    run_id: int,
    ids: list[int] = Query(..., description="uno o varios id_catalogo_producto"),
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            marcadores = ",".join(["%s"] * len(ids))
            cur.execute(
                f"""SELECT id_catalogo_producto, moneda, precio_maximo, motivo
                    FROM perucompras_ofertas_maximos_detalle
                    WHERE run_id=%s AND id_catalogo_producto IN ({marcadores})""",
                (run_id, *ids),
            )
            filas = {f["id_catalogo_producto"]: f for f in cur.fetchall()}
    finally:
        conn.close()

    m = monitor_de(uid)
    if m:
        m.pausar()
    usuario_helbot = usuario.nombre_completo or usuario.username
    resultados = []
    try:
        for id_producto in ids:
            fila = filas.get(id_producto)
            if fila is None:
                resultados.append({"id_catalogo_producto": id_producto, "ok": False, "error": "No encontrado en esta corrida"})
                continue
            # Whitelist explícita: solo se puede enviar si el precio quedó
            # REALMENTE confirmado en pantalla ("ok" o "reusado"). Todo lo
            # demás (techo_seguridad, sin_rango_encontrado, error_guardado,
            # ok_no_confirmado, reusado_no_confirmado) se bloquea — en
            # ninguno de esos casos estamos seguros de que el campo del
            # portal tenga el valor que dice la BD.
            if fila["precio_maximo"] is None or fila["motivo"] not in ("ok", "reusado"):
                _marcar_enviado(id_producto, run_id, False, f"Bloqueado: motivo={fila['motivo']}, revisar a mano", usuario_helbot)
                resultados.append({"id_catalogo_producto": id_producto, "ok": False, "error": f"Bloqueado — revisar a mano (motivo: {fila['motivo']})"})
                continue
            ok, error = _enviar_oferta_individual(pc_session, id_producto, fila["moneda"], fila["precio_maximo"])
            _marcar_enviado(id_producto, run_id, ok, error, usuario_helbot)
            resultados.append({"id_catalogo_producto": id_producto, "ok": ok, "error": error})
    finally:
        if m:
            m.reanudar()

    return {"resultados": resultados}


@router.get("/resultados/filtros")
def filtros_resultados(uid: str = "", run_id: int = 0):
    """
    Por defecto (run_id=0), valores distintos de acuerdo/catálogo/
    categoría entre TODAS las corridas de este uid — acumulado — así al
    volver a filtrar no desaparecen las categorías de corridas
    anteriores. Si se pasa un run_id específico, se acota a esa corrida.
    Puro SQL, no toca Perú Compras.
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if run_id:
                condicion = "run_id = %s"
                parametros: list = [run_id]
            else:
                if uid:
                    cur.execute(
                        "SELECT id FROM perucompras_ofertas_maximos_runs WHERE uid_perucompras=%s",
                        (uid,),
                    )
                else:
                    cur.execute("SELECT id FROM perucompras_ofertas_maximos_runs")
                ids_runs = [f["id"] for f in cur.fetchall()]
                if not ids_runs:
                    return {"run_id": 0, "acuerdos": [], "catalogos": [], "categorias": []}
                marcadores = ",".join(["%s"] * len(ids_runs))
                condicion = f"run_id IN ({marcadores})"
                parametros = ids_runs

            cur.execute(
                f"SELECT DISTINCT acuerdo FROM perucompras_ofertas_maximos_detalle WHERE {condicion} ORDER BY acuerdo",
                parametros,
            )
            acuerdos = [f["acuerdo"] for f in cur.fetchall()]

            cur.execute(
                f"SELECT DISTINCT catalogo FROM perucompras_ofertas_maximos_detalle WHERE {condicion} ORDER BY catalogo",
                parametros,
            )
            catalogos = [f["catalogo"] for f in cur.fetchall()]

            cur.execute(
                f"SELECT DISTINCT categoria FROM perucompras_ofertas_maximos_detalle WHERE {condicion} ORDER BY categoria",
                parametros,
            )
            categorias = [f["categoria"] for f in cur.fetchall()]

            return {"run_id": run_id, "acuerdos": acuerdos, "catalogos": catalogos, "categorias": categorias}
    finally:
        conn.close()


def _marcar_enviado_manual(id_catalogo_producto: int, ok: bool, error: str, usuario: str):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if ok:
                cur.execute(
                    """UPDATE perucompras_ofertas_manual
                       SET enviado_en=%s, enviado_por=%s, envio_error=NULL
                       WHERE id_catalogo_producto=%s""",
                    (datetime.now(), usuario, id_catalogo_producto),
                )
            else:
                cur.execute(
                    """UPDATE perucompras_ofertas_manual
                       SET envio_error=%s
                       WHERE id_catalogo_producto=%s""",
                    (error, id_catalogo_producto),
                )
        conn.commit()
    finally:
        conn.close()


@router.post("/enviar-vivo")
def enviar_ofertas_vivo(
    uid: str,
    ids: list[int] = Query(..., description="uno o varios id_catalogo_producto"),
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    """
    Envía oferta para productos de la tabla EN VIVO, usando el precio
    guardado en perucompras_ofertas_manual (no depende de ninguna
    corrida de búsqueda de precio máximo). Solo se puede enviar un
    producto si ya tiene un precio guardado Y ese precio fue aceptado
    por Perú Compras al guardarlo (aceptado_perucompras = 1).
    """
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    manuales = _obtener_precios_manual(ids)

    m = monitor_de(uid)
    if m:
        m.pausar()
    usuario_helbot = usuario.nombre_completo or usuario.username
    resultados = []
    try:
        for id_producto in ids:
            man = manuales.get(id_producto)
            if man is None or not man["aceptado_perucompras"]:
                resultados.append({
                    "id_catalogo_producto": id_producto,
                    "ok": False,
                    "error": "No hay precio guardado y aceptado para este producto — guardalo primero",
                })
                continue
            ok, error = _enviar_oferta_individual(pc_session, id_producto, man["moneda"], float(man["precio_unitario"]))
            _marcar_enviado_manual(id_producto, ok, error, usuario_helbot)
            resultados.append({"id_catalogo_producto": id_producto, "ok": ok, "error": error})
    finally:
        if m:
            m.reanudar()

    return {"resultados": resultados}
