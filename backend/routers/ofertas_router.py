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
import threading
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
TIMEOUT_VIVO_SEGUNDOS = 45
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
    "cancelado": False,
}

# Bandera para cancelar una corrida en curso. La pone /cancelar y la lee
# _verificar_cancelacion() entre request y request de la búsqueda.
_cancelar_ofertas = threading.Event()


class CorridaCancelada(Exception):
    """Se levanta cuando el usuario pidió cancelar la búsqueda en curso."""


def _verificar_cancelacion():
    if _cancelar_ofertas.is_set():
        raise CorridaCancelada()


class SesionNoDisponible(Exception):
    """La sesión de Perú Compras sigue en None/caída después de esperar el relogin."""


TIMEOUT_ESPERA_SESION = 180  # segundos máximos esperando que termine el relogin


def _esperar_sesion(pc_session, timeout: int = TIMEOUT_ESPERA_SESION):
    """
    Si la sesión se perdió y el sistema está reloguéandose
    (pc_session.session is None), espera aquí hasta que vuelva.
    NO debe llamarse con el request_lock tomado (el relogin podría
    necesitarlo). Respeta la cancelación del usuario.
    """
    limite = time.time() + timeout
    avisado = False
    while pc_session.session is None:
        _verificar_cancelacion()
        if pc_session.estado == "desconectado":
            # El sistema se rindió (o es modo espejo y cayó): no hay relogin en camino.
            raise SesionNoDisponible(
                "La sesión de Perú Compras se cayó y no se va a reconectar sola. "
                "Si usas modo espejo, pega las cookies de nuevo y relanza la búsqueda "
                "(con 'Saltar productos ya calculados' marcado continúa donde quedó)."
            )
        if time.time() > limite:
            raise SesionNoDisponible(
                f"La sesión de Perú Compras no volvió en {timeout}s tras perderse"
            )
        if not avisado:
            logger.warning("Sesión de Perú Compras caída: esperando el relogin automático...")
            _estado_ofertas["producto_actual"] = "Sesión caída, esperando relogin automático..."
            avisado = True
        time.sleep(2)
    if avisado:
        logger.info("Sesión de Perú Compras recuperada, se continúa donde se quedó")

# --- descubrimiento de acuerdos (HTML) --------------------------------------
# OJO — CALIBRAR: el <select id="ajaxAcuerdo"> podría venir vacío en el
# HTML plano si Perú Compras lo llena por AJAX en vez de renderizarlo en
# el servidor (a diferencia de catálogo/categoría, que SÍ vimos que se
# llenan dinámicamente tras elegir el acuerdo). Si el log de warning de
# abajo aparece seguido, actualiza ACUERDOS_RESPALDO a mano (ábrelo en el
# navegador, inspecciona #ajaxAcuerdo > option, o la pestaña Network por
# si hay un endpoint tipo ListaJ_AcuerdoMarco que no vimos todavía).
ACUERDOS_RESPALDO: list[tuple[str, str]] = [
    ("324", "EXT-CE-2024-3 MATERIALES E INSUMOS DE LIMPIEZA, PAPELES PARA ASEO Y LIMPIEZA"),
    ("352", "EXT-CE-2024-12 TUBERIAS, PINTURAS, CERÁMICOS, SANITARIOS, ACCESORIOS, Y COMPLEMENTOS EN GENERAL"),
    ("357", "EXT-CE-2024-16 ACCESORIOS DOMÉSTICOS Y BIENES PARA USOS DIVERSOS"),
    ("370", "EXT-CE-2024-17 BEBIDAS NO ALCOHÓLICAS"),
    ("372", "EXT-CE-2024-18 CEREALES, ACEITE, AZUCARES Y MENESTRAS"),
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
        "USANDO ACUERDOS_RESPALDO: no se pudieron leer acuerdos del HTML de %s "
        "(HTTP %s, largo del HTML=%s, contiene 'ajaxAcuerdo'=%s, select encontrado=%s). "
        "Inicio del HTML: %r",
        URL_ENTRADA, r.status_code, len(r.text), "ajaxAcuerdo" in r.text, bool(m), r.text[:200],
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

def _post_precio(pc_session, id_producto: int, moneda: str, precio: float):
    """Una request a Inserta_ProductoOfertadoTMP, esperando antes a que haya sesión."""
    _esperar_sesion(pc_session)
    with pc_session.request_lock:
        sess = pc_session.session
        if sess is None:
            raise _requests_lib.exceptions.ConnectionError("Sesión de Perú Compras no disponible (relogin en curso)")
        resp = sess.post(
            URL_INSERTA_PRECIO,
            data={"N_CatalogoProducto": str(id_producto), "C_MonedaOfertada": moneda, "N_PrecioOfertado": f"{precio:.2f}"},
            headers={"X-Requested-With": "XMLHttpRequest"},
            timeout=30,
        )
        if "AccesoGeneral" in (resp.url or ""):
            # Nos mandó a la pantalla de login: la sesión está muerta. NO es un precio aceptado.
            raise RespuestaPeruComprasInvalida("Probar precio", resp)
        return resp


def _probar_precio(pc_session, id_producto: int, moneda: str, precio: float) -> bool:
    """
    True si Perú Compras aceptó el precio. Toma el lock solo por request.
    Reintenta con backoff si la conexión muere, y espera el relogin si
    la sesión se cayó.
    """
    ultimo_error = None
    for intento in range(MAX_REINTENTOS_CONEXION):
        try:
            resp = _post_precio(pc_session, id_producto, moneda, precio)
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
    raise ultimo_error



VALOR_CANARIO_INVALIDO = 999_999.99
# Muy por encima de cualquier precio real y del propio techo de
# seguridad. Cualquier validación real de Perú Compras debería
# rechazarlo. Si en cambio lo "acepta", el mensaje de rechazo de ESTE
# producto no coincide con nada de lo que es_rechazado sabe reconocer.


def _probar_precio_con_diagnostico(pc_session, id_producto: int, moneda: str, precio: float) -> tuple[bool, str]:
    """Igual que _probar_precio pero devuelve también el texto crudo de la respuesta."""
    ultimo_error = None
    for intento in range(MAX_REINTENTOS_CONEXION):
        try:
            resp = _post_precio(pc_session, id_producto, moneda, precio)
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




def _barrido_creciente(
    pc_session, id_producto: int, moneda: str, factor: float, inicio: float, techo: float
) -> tuple[Optional[float], int]:
    """
    Prueba valores empezando en `inicio`, multiplicando por `factor` en cada
    paso, hasta llegar a `techo` o encontrar el primer valor aceptado.
    Devuelve (valor_aceptado_o_None, intentos_usados).
    """
    intentos = 0
    valor = inicio
    while valor < techo:
        _verificar_cancelacion()
        intentos += 1
        if _probar_precio(pc_session, id_producto, moneda, valor):
            return valor, intentos
        siguiente = round(valor * factor, 2)
        # Con valores chicos y factores finos (0.10 * 1.03 = 0.103 -> 0.10) el
        # redondeo dejaba el valor igual y el bucle probaba el mismo precio
        # para siempre. Garantizamos avanzar al menos 1 céntimo.
        if siguiente <= valor:
            siguiente = round(valor + 0.01, 2)
        valor = siguiente
    return None, intentos


def _encontrar_precio_maximo(
    pc_session,
    id_producto: int,
    moneda: str,
    precio_min: Optional[float] = None,
    precio_max: Optional[float] = None,
) -> ResultadoBusqueda:
    """
    Busca el máximo aceptado por Perú Compras SOLO dentro de [precio_min, precio_max].
    Sin precio_min parte de PRECIO_INICIAL (0.10); sin precio_max el tope es
    PRECIO_MAXIMO_TECHO. Nunca prueba ni reporta valores fuera de ese rango.

    Fase 1: cascada de barridos crecientes desde el mínimo hasta el primer aceptado.
    Fase 2: duplicar desde ese punto hasta el primer rechazo (o el techo).
    Fase 3: bisección para afinar.
    """
    inicio = precio_min if precio_min is not None else PRECIO_INICIAL
    techo = precio_max if precio_max is not None else PRECIO_MAXIMO_TECHO

    intentos = 1
    deteccion_ok, texto_canario = _verificar_deteccion_funciona(pc_session, id_producto, moneda)
    aviso = ""
    if not deteccion_ok:
        # Ya NO abortamos: seguimos con la búsqueda y dejamos el aviso en detalle.
        aviso = (
            f"AVISO: Perú Compras ACEPTÓ un precio de prueba absurdo ({VALOR_CANARIO_INVALIDO:.2f}). "
            f"O este producto no tiene límite superior en el portal, o su mensaje de rechazo no coincide "
            f"con ERROR_MARKERS. Respuesta cruda: {texto_canario[:200]!r}"
        )

    def con_aviso(texto: str) -> str:
        return f"{texto} {aviso}".strip()

    lo: Optional[float] = None
    for factor in FACTORES_CASCADA_FASE1:
        candidato, usados = _barrido_creciente(pc_session, id_producto, moneda, factor, inicio, techo)
        intentos += usados
        if candidato is not None:
            lo = candidato
            break

    if lo is None:
        _verificar_cancelacion()
        intentos += 1
        if _probar_precio(pc_session, id_producto, moneda, techo):
            return ResultadoBusqueda(
                techo, intentos, "techo_seguridad",
                con_aviso(f"Perú Compras acepta valores hasta el techo ({techo:.2f}); se usa el techo como máximo."),
            )
        return ResultadoBusqueda(
            None, intentos, "sin_rango_encontrado",
            con_aviso(
                f"Ningún valor entre {inicio:.2f} y {techo:.2f} fue aceptado, ni con la cascada completa "
                f"{FACTORES_CASCADA_FASE1} ni el techo mismo. Revisar a mano en el tab 'en vivo' — puede que "
                f"el precio válido de este producto esté fuera de ese rango."
            ),
        )

    hi: Optional[float] = None
    valor = round(lo * 2, 2)
    for _ in range(MAX_ITER_FASE2):
        _verificar_cancelacion()
        if valor >= techo:
            intentos += 1
            if _probar_precio(pc_session, id_producto, moneda, techo):
                return ResultadoBusqueda(
                    techo, intentos, "techo_seguridad",
                    con_aviso(f"Se aceptó hasta {lo:.2f} y también el techo ({techo:.2f}); Perú Compras probablemente acepta más, pero se limita acá a propósito."),
                )
            hi = techo
            break
        intentos += 1
        if _probar_precio(pc_session, id_producto, moneda, valor):
            lo = valor
            valor = round(valor * 2, 2)
        else:
            hi = valor
            break
    if hi is None:
        hi = techo

    for _ in range(MAX_ITER_FASE3):
        _verificar_cancelacion()
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

    intentos += 1
    confirmado = _confirmar_precio_final(pc_session, id_producto, moneda, lo)
    if not confirmado:
        return ResultadoBusqueda(
            lo, intentos, "ok_no_confirmado",
            con_aviso(
                f"Se encontró el máximo teórico ({lo:.2f}) pero Perú Compras lo RECHAZÓ al intentar "
                f"dejarlo puesto en el campo, incluso reintentando. Revisar a mano en el tab 'en vivo'."
            ),
        )

    return ResultadoBusqueda(lo, intentos, "ok", con_aviso(""))

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


def _obtener_ultimos_precios(precio_min: Optional[float] = None, precio_max: Optional[float] = None) -> dict:
    """
    Último precio_maximo con motivo='ok' por producto, de cualquier corrida,
    SOLO si cae dentro del rango [precio_min, precio_max] de esta corrida
    (sin precio_min no hay piso; sin precio_max el tope es PRECIO_MAXIMO_TECHO).
    Exigir motivo='ok' hace que lo no confirmado (techo_seguridad,
    sin_rango_encontrado, deteccion_no_confiable...) se recalcule, y el filtro
    de rango hace que un valor viejo fuera del rango actual (ej. un 0.20 para
    un producto de ~1000) también se recalcule.
    """
    minimo = precio_min if precio_min is not None else 0
    techo = precio_max if precio_max is not None else PRECIO_MAXIMO_TECHO
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
                    WHERE precio_maximo IS NOT NULL
                      AND precio_maximo >= %s AND precio_maximo <= %s
                      AND motivo = 'ok'
                ) t
                WHERE rn = 1
                """,
                (minimo, techo),
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


PAGINA_CORRIDA = 100        # filas por request al listar productos en la corrida
REINTENTOS_PAGINA = 12      # reintentos por página (cubre un relogin completo con captcha)


def _obtener_productos_corrida(pc_session, n_acuerdo: str, n_catalogo: str, n_categoria: str) -> list[dict]:
    """
    Descarga TODOS los productos de una categoría para la búsqueda de precios
    máximos. Si la sesión se cae a mitad de la descarga, espera el relogin
    y reintenta la MISMA página (no pierde lo ya descargado).
    """
    productos: list[dict] = []
    start = 0
    while True:
        _verificar_cancelacion()
        ultimo_error: Optional[Exception] = None
        for intento in range(REINTENTOS_PAGINA):
            try:
                _esperar_sesion(pc_session)
                with pc_session.request_lock:
                    filas, total = _pagina_productos(
                        pc_session.session, n_acuerdo, n_catalogo, n_categoria, start, PAGINA_CORRIDA
                    )
                break
            except (RespuestaPeruComprasInvalida, _requests_lib.exceptions.RequestException) as e:
                ultimo_error = e
                logger.warning(
                    "Página start=%d de la categoría %s falló (intento %d/%d): %s",
                    start, n_categoria, intento + 1, REINTENTOS_PAGINA, e,
                )
                time.sleep(min(3 * (intento + 1), 15))
                _verificar_cancelacion()
        else:
            raise ultimo_error

        productos.extend(filas)
        _estado_ofertas["producto_actual"] = f"Descargando lista de Perú Compras... {len(productos)}/{total}"
        if (start // PAGINA_CORRIDA) % 10 == 0:
            logger.info("Descargando productos de la categoría %s: %d/%d", n_categoria, len(productos), total)
        start += PAGINA_CORRIDA
        if not filas or start >= total:
            break
        time.sleep(0.05)
    return productos


def _sesion_viva(pc_session):
    """Espera el relogin si hace falta y devuelve la sesión actual (no una copia vieja)."""
    _esperar_sesion(pc_session)
    return pc_session.session


def _recolectar_productos(
    pc_session, n_acuerdo_filtro, n_catalogo_filtro, n_categoria_filtro, en_corrida: bool = False
) -> list[dict]:
    """
    Recorre acuerdo -> catálogo -> categoría en Perú Compras y devuelve la
    lista de productos, incluyendo el precio actual que YA tiene puesto el
    portal (N_PrecioOfertado). Con en_corrida=True (búsqueda de precios
    máximos) descarga por páginas chicas con reintentos, se puede cancelar
    y muestra el avance. La sesión se lee de nuevo en cada paso, para
    sobrevivir a un relogin a mitad del recorrido.
    """
    if n_acuerdo_filtro:
        texto_filtro = dict(ACUERDOS_RESPALDO).get(n_acuerdo_filtro, n_acuerdo_filtro)
        acuerdos = [(n_acuerdo_filtro, texto_filtro)]
    else:
        sess = _sesion_viva(pc_session)
        with pc_session.request_lock:
            acuerdos = _obtener_acuerdos(sess)

    productos_totales: list[dict] = []
    for n_acuerdo, texto_acuerdo in acuerdos:
        sess = _sesion_viva(pc_session)
        with pc_session.request_lock:
            catalogos = _obtener_catalogos(sess, n_acuerdo)
        if n_catalogo_filtro:
            catalogos = [c for c in catalogos if c["value"] == n_catalogo_filtro]
        for catalogo in catalogos:
            sess = _sesion_viva(pc_session)
            with pc_session.request_lock:
                categorias = _obtener_categorias(sess, catalogo["value"])
            if n_categoria_filtro:
                categorias = [c for c in categorias if c["value"] == n_categoria_filtro]
            for categoria in categorias:
                if en_corrida:
                    _verificar_cancelacion()
                    filas = _obtener_productos_corrida(pc_session, n_acuerdo, catalogo["value"], categoria["value"])
                else:
                    sess = _sesion_viva(pc_session)
                    with pc_session.request_lock:
                        filas = _obtener_productos(sess, n_acuerdo, catalogo["value"], categoria["value"])
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



def _es_propuesta(estado) -> bool:
    """
    True si el producto está en estado PROPUESTA ("Nuevo, nadie ha presentado
    ofertas"). Es un 'in' y no un '==' por si el portal devuelve el texto
    envuelto en HTML (<div ...>PROPUESTA</div>) en vez de texto plano.
    Ojo: 'OFERTADA SIN OFERTA' y 'OFERTADA NO ADJUDICADA' NO contienen
    la palabra PROPUESTA, así que no se confunden.
    """
    return "PROPUESTA" in str(estado or "").upper()

# --- tarea en background ----------------------------------------------------

def _tarea_ofertas(
    uid: str,
    run_id: int,
    n_acuerdo_filtro: Optional[str],
    n_catalogo_filtro: Optional[str],
    n_categoria_filtro: Optional[str],
    saltar_existentes: bool,
    usuario_helbot: str,
    omitir_propuesta: bool = False,
    precio_min: Optional[float] = None,
    precio_max: Optional[float] = None,
):
    pc_session = perucompras_sesiones.sesion(uid)
    m = monitor_de(uid)
    _cancelar_ofertas.clear()
    _estado_ofertas.update({
        "corriendo": True, "producto_actual": None,
        "productos_completados": 0, "total_productos": 0,
        "iniciado_en": datetime.now().isoformat(),
        "terminado_en": None, "error": None, "run_id": run_id,
        "cancelado": False,
    })
    if m:
        m.pausar()
    try:
        _estado_ofertas["producto_actual"] = "Descargando lista de productos de Perú Compras..."
        productos_totales = _recolectar_productos(
            pc_session, n_acuerdo_filtro, n_catalogo_filtro, n_categoria_filtro, en_corrida=True,
        )

        if omitir_propuesta:
            antes = len(productos_totales)
            productos_totales = [p for p in productos_totales if not _es_propuesta(p.get("estado_actual"))]
            logger.info(
                "omitir_propuesta=True: %d producto(s) en PROPUESTA omitidos, quedan %d (run_id=%s)",
                antes - len(productos_totales), len(productos_totales), run_id,
            )

        _estado_ofertas["total_productos"] = len(productos_totales)

        ultimos_precios = _obtener_ultimos_precios(precio_min, precio_max) if saltar_existentes else {}

        for producto in productos_totales:
            _verificar_cancelacion()
            _estado_ofertas["producto_actual"] = producto["descripcion"][:80]

            try:
                existente = ultimos_precios.get(producto["id_catalogo_producto"])
                if existente is not None:
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
                    resultado = _encontrar_precio_maximo(
                        pc_session, producto["id_catalogo_producto"], producto["moneda"], precio_min, precio_max
                    )

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
    except RespuestaPeruComprasInvalida as e:
        logger.warning("Respuesta inválida de Perú Compras en la corrida (run_id=%s): %s", run_id, e)
        try:
            pc_session.marcar_sesion_perdida(motivo=f"corrida de precios máximos recibió respuesta inválida: {e}")
        except Exception:
            logger.exception("No se pudo marcar la sesión de Perú Compras como perdida")
        msg = (
            "Perú Compras devolvió una respuesta vacía o inválida (la sesión probablemente se cayó y se está "
            f"reconectando). Espera unos segundos y vuelve a lanzar la búsqueda. Detalle: {e}"
        )
        _estado_ofertas["error"] = msg
        _cerrar_run(run_id, "error", msg[:250], _estado_ofertas.get("total_productos", 0))
    except CorridaCancelada:
        logger.info(
            "Búsqueda cancelada por el usuario (run_id=%s) tras %d producto(s)",
            run_id, _estado_ofertas["productos_completados"],
        )
        _estado_ofertas["cancelado"] = True
        # Se guarda como 'completado' + texto en error para no depender de que
        # la columna estado acepte un valor nuevo.
        _cerrar_run(run_id, "completado", "Cancelado por el usuario", _estado_ofertas["productos_completados"])
    except Exception as e:
        logger.exception("Error en _tarea_ofertas")
        _estado_ofertas["error"] = str(e)
        _cerrar_run(run_id, "error", str(e), _estado_ofertas.get("total_productos", 0))
    finally:
        _cancelar_ofertas.clear()
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
    omitir_propuesta: bool = True,
    precio_min: Optional[float] = None,
    precio_max: Optional[float] = None,
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    # 0 o negativo = "sin valor" (se usa el default)
    if precio_min is not None and precio_min <= 0:
        precio_min = None
    if precio_max is not None and precio_max <= 0:
        precio_max = None
    techo_efectivo = precio_max if precio_max is not None else PRECIO_MAXIMO_TECHO
    if precio_min is not None and precio_min >= techo_efectivo:
        raise HTTPException(
            400,
            f"El precio mínimo ({precio_min:.2f}) debe ser menor que el precio máximo ({techo_efectivo:.2f}). "
            f"Si no pones máximo, el techo por defecto es {PRECIO_MAXIMO_TECHO:.2f}.",
        )

    if _estado_ofertas["corriendo"]:
        return {"ok": True, "detalle": "Ya hay una búsqueda de precios máximos en curso"}

    usuario_helbot = usuario.nombre_completo or usuario.username
    run_id = _crear_run(usuario_helbot, uid)
    background_tasks.add_task(
        _tarea_ofertas, uid, run_id, n_acuerdo, n_catalogo, n_categoria,
        saltar_existentes, usuario_helbot, omitir_propuesta, precio_min, precio_max,
    )
    return {"ok": True, "detalle": "Búsqueda de precios máximos iniciada en background", "run_id": run_id}


@router.post("/cancelar")
def cancelar_ofertas(usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    if not _estado_ofertas["corriendo"]:
        return {"ok": False, "detalle": "No hay ninguna búsqueda en curso"}
    _cancelar_ofertas.set()
    return {"ok": True, "detalle": "Cancelación solicitada: se detiene en cuanto termine la request actual"}

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


@router.get("/contar")
def contar_ofertas(
    uid: str,
    n_acuerdo: str,
    n_catalogo: str,
    n_categoria: Optional[str] = None,
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    """
    Cuenta productos SIN descargarlos (pide length=1 y lee recordsTotal).
    Si el lock de la sesión está ocupado, no se queda esperando:
    responde ocupado=True rápido para no trabar los selects.
    """
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    if not pc_session.request_lock.acquire(timeout=3):
        return {"total": None, "ocupado": True}
    try:
        form = {
            "draw": "1", **_columnas_datatable(),
            "order[0][column]": "0", "order[0][dir]": "asc",
            "start": "0", "length": "1",
            "search[value]": "", "search[regex]": "false",
            "N_Acuerdo": n_acuerdo, "N_Catalogo": n_catalogo,
            "N_Categoria": n_categoria or "",
            "C_Descripcion": "",
        }
        resp = pc_session.session.post(
            URL_LISTA_PRODUCTOS, data=form,
            headers={"X-Requested-With": "XMLHttpRequest"}, timeout=20,
        )
        cuerpo = _json_o_falla(resp, f"Contar productos (acuerdo={n_acuerdo}, catálogo={n_catalogo})")
        total = int(cuerpo.get("recordsTotal", 0))
    except RespuestaPeruComprasInvalida as e:
        logger.warning("Respuesta inválida de Perú Compras en /contar (uid=%s): %s", uid, e)
        raise HTTPException(502, f"Perú Compras no devolvió el conteo esperado. Detalle: {e}")
    finally:
        pc_session.request_lock.release()
    return {"total": total, "ocupado": False}


def _recolectar_productos_directo(
    pc_session, n_acuerdo, n_catalogo, n_categoria,
    acuerdo_txt: str, catalogo_txt: str, categoria_txt: str,
) -> list[dict]:
    """
    Camino rápido para /vivo cuando ya vienen acuerdo + catálogo + categoría:
    UNA sola request a Perú Compras (sin listar catálogos ni categorías).
    """
    with pc_session.request_lock:
        filas = _obtener_productos(pc_session.session, n_acuerdo, n_catalogo, n_categoria)
    return [
        {
            "id_catalogo_producto": fila["N_CatalogoProducto"],
            "descripcion": fila.get("C_Descripcion", ""),
            "moneda": fila.get("C_MonedaOfertada", "PEN"),
            "n_acuerdo": n_acuerdo,
            "acuerdo": acuerdo_txt or n_acuerdo,
            "n_catalogo": n_catalogo,
            "catalogo": catalogo_txt or n_catalogo,
            "n_categoria": n_categoria,
            "categoria": categoria_txt or n_categoria,
            "estado_actual": fila.get("C_Estado", ""),
            "precio_actual": fila.get("N_PrecioOfertado"),
        }
        for fila in filas
    ]



# --- /vivo-carga: descarga en background + polling --------------------------
_cache_vivo: dict = {}
_cache_vivo_mutex = threading.Lock()
TTL_CACHE_VIVO = 600   # segundos que dura una descarga en caché
PAGINA_VIVO = 100      # filas por request a Perú Compras


def _pagina_productos(session, n_acuerdo, n_catalogo, n_categoria, start, length):
    if session is None:
        # La sesión se está reloguéando; el llamador reintenta esta misma página.
        raise _requests_lib.exceptions.ConnectionError("Sesión de Perú Compras no disponible (relogin en curso)")
    form = {
        "draw": "1", **_columnas_datatable(),
        "order[0][column]": "0", "order[0][dir]": "asc",
        "start": str(start), "length": str(length),
        "search[value]": "", "search[regex]": "false",
        "N_Acuerdo": n_acuerdo, "N_Catalogo": n_catalogo, "N_Categoria": n_categoria,
        "C_Descripcion": "",
    }
    ultimo_error = None
    for intento in range(3):
        try:
            resp = session.post(
                URL_LISTA_PRODUCTOS, data=form,
                headers={"X-Requested-With": "XMLHttpRequest"}, timeout=60,
            )
            cuerpo = _json_o_falla(resp, f"Listar productos (start={start})")
            return cuerpo.get("data", []), int(cuerpo.get("recordsTotal", 0))
        except _requests_lib.exceptions.RequestException as e:
            ultimo_error = e
            time.sleep(2 * (intento + 1))
    raise ultimo_error


def _job_vivo(clave, uid, pc_session, n_acuerdo, n_catalogo, n_categoria, txt_acuerdo, txt_catalogo, txt_categoria):
    entrada = _cache_vivo[clave]
    ya_pausado = _estado_ofertas["corriendo"]
    m = monitor_de(uid)
    if m and not ya_pausado:
        m.pausar()
    try:
        start = 0
        while True:
            with pc_session.request_lock:
                filas, total = _pagina_productos(
                    pc_session.session, n_acuerdo, n_catalogo, n_categoria, start, PAGINA_VIVO
                )
            entrada["total"] = total
            for fila in filas:
                entrada["productos"].append({
                    "id_catalogo_producto": fila["N_CatalogoProducto"],
                    "descripcion": fila.get("C_Descripcion", ""),
                    "moneda": fila.get("C_MonedaOfertada", "PEN"),
                    "n_acuerdo": n_acuerdo,
                    "acuerdo": txt_acuerdo or n_acuerdo,
                    "n_catalogo": n_catalogo,
                    "catalogo": txt_catalogo or n_catalogo,
                    "n_categoria": n_categoria,
                    "categoria": txt_categoria or n_categoria,
                    "estado_actual": fila.get("C_Estado", ""),
                    "precio_actual": fila.get("N_PrecioOfertado"),
                })
            entrada["cargados"] = len(entrada["productos"])
            start += PAGINA_VIVO
            if not filas or start >= total:
                break
            time.sleep(0.05)  # deja que otros tomen el lock entre páginas
        entrada["actualizado"] = time.time()
        entrada["estado"] = "listo"
    except RespuestaPeruComprasInvalida as e:
        logger.warning("Respuesta inválida de Perú Compras en /vivo-carga (uid=%s): %s", uid, e)
        pc_session.marcar_sesion_perdida(motivo=f"/vivo-carga recibió respuesta inválida: {e}")
        entrada["error"] = "La sesión con Perú Compras se cayó, se está reconectando. Reintentá en unos segundos."
        entrada["estado"] = "error"
    except Exception as e:
        logger.exception("Error en _job_vivo")
        entrada["error"] = f"{type(e).__name__}: {e}"
        entrada["estado"] = "error"
    finally:
        if m and not ya_pausado:
            m.reanudar()


def _mezclar_manuales(productos: list[dict]) -> list[dict]:
    manuales = _obtener_precios_manual([p["id_catalogo_producto"] for p in productos])
    salida = []
    for p in productos:
        q = dict(p)
        man = manuales.get(p["id_catalogo_producto"])
        q["precio_manual_bd"] = man["precio_unitario"] if man else None
        q["precio_manual_aceptado"] = bool(man["aceptado_perucompras"]) if man else None
        q["precio_manual_actualizado_en"] = man["actualizado_en"].isoformat() if man else None
        q["precio_manual_actualizado_por"] = man["actualizado_por"] if man else None
        q["enviado_en"] = man["enviado_en"].isoformat() if man and man["enviado_en"] else None
        q["enviado_por"] = man["enviado_por"] if man else None
        q["envio_error"] = man["envio_error"] if man else None
        salida.append(q)
    return salida


@router.get("/vivo-carga")
def vivo_carga(
    uid: str,
    n_acuerdo: str,
    n_catalogo: str,
    n_categoria: str,
    acuerdo_txt: str = "",
    catalogo_txt: str = "",
    categoria_txt: str = "",
    inicio: bool = False,
    refrescar: bool = False,
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    clave = (uid, n_acuerdo, n_catalogo, n_categoria)
    with _cache_vivo_mutex:
        entrada = _cache_vivo.get(clave)
        vencida = bool(entrada) and entrada["estado"] == "listo" and (time.time() - entrada["actualizado"] > TTL_CACHE_VIVO)
        reiniciar = (
            entrada is None
            or vencida
            or (inicio and entrada["estado"] == "error")
            or (refrescar and entrada["estado"] != "cargando")
        )
        if reiniciar:
            entrada = {
                "estado": "cargando", "productos": [], "total": 0,
                "cargados": 0, "error": None, "actualizado": time.time(),
            }
            _cache_vivo.pop(clave, None)
            _cache_vivo[clave] = entrada
            threading.Thread(
                target=_job_vivo,
                args=(clave, uid, pc_session, n_acuerdo, n_catalogo, n_categoria, acuerdo_txt, catalogo_txt, categoria_txt),
                daemon=True,
            ).start()
        # limpieza: máximo 20 descargas en memoria
        for k in list(_cache_vivo)[:-20]:
            if _cache_vivo[k]["estado"] != "cargando":
                del _cache_vivo[k]

    resp = {
        "estado": entrada["estado"], "total": entrada["total"],
        "cargados": entrada["cargados"], "error": entrada["error"],
    }
    if entrada["estado"] == "listo":
        resp["productos"] = _mezclar_manuales(entrada["productos"])
    return resp


@router.get("/vivo")
def ofertas_en_vivo(
    uid: str,
    n_acuerdo: Optional[str] = None,
    n_catalogo: Optional[str] = None,
    n_categoria: Optional[str] = None,
    acuerdo_txt: str = "",
    catalogo_txt: str = "",
    categoria_txt: str = "",
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    """
    Consulta EN VIVO a Perú Compras(sin tocar la BD para los datos del
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
        if n_acuerdo and n_catalogo and n_categoria:
            futuro = _pool_vivo.submit(
                _recolectar_productos_directo, pc_session, n_acuerdo, n_catalogo, n_categoria,
                acuerdo_txt, catalogo_txt, categoria_txt,
            )
        else:
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
