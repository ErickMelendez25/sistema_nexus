"""
buscar_precio_maximo.py
========================

Objetivo: para cada producto que aparece en la pantalla "Agregar oferta"
de Perú Compras (t_ProductoOfertadoAmp), encontrar el PRECIO MÁXIMO que
el sistema acepta para N_PrecioOfertado, probando valores directamente
contra el endpoint real (sin llenar el input en el DOM, para máxima
velocidad), y SIN TOCAR JAMÁS "Enviar Oferta".

REGLA DE ORO — NO NEGOCIABLE
-----------------------------
Este script NUNCA llama a /t_ProductoOfertadoAmp/Envia_ProductoOfertadoTMP.
Esa función ni siquiera está implementada acá. Solo prueba precios contra
Inserta_ProductoOfertadoTMP (que guarda en la tabla TMP, no en la oferta
final) y al final imprime/guarda un reporte para que revises manualmente
en la interfaz y decidas tú cuándo enviar cada oferta.

CÓMO FUNCIONA LA BÚSQUEDA (por qué no es una binaria "normal")
----------------------------------------------------------------
El mensaje de error "El precio ingresado esta fuera de los limites
extremos" es el MISMO tanto si el precio es menor al mínimo como si es
mayor al máximo — no hay forma de distinguir la causa solo con la
respuesta. Por eso la búsqueda tiene 3 fases:

  1) Exponencial ascendente desde un valor chico, hasta conseguir el
     PRIMER precio ACEPTADO. No importa si los rechazos previos eran
     "muy bajo" — solo nos interesa entrar a la zona válida.
  2) Seguir duplicando desde ese punto hasta el PRIMER precio
     RECHAZADO por encima. Como ya veníamos de la zona válida, ese
     rechazo sí significa "superó el máximo".
  3) Binaria entre el último aceptado y el primer rechazado, hasta la
     precisión deseada (por defecto 1 céntimo).

CALIBRAR ANTES DE USAR EN SERIO
--------------------------------
No tenemos un ejemplo real de la respuesta de Inserta_ProductoOfertadoTMP
cuando el precio SÍ es aceptado — solo vimos la respuesta de rechazo
(el HTML de un modal). La función `es_rechazado()` de abajo asume que
cualquier respuesta que NO contenga el texto de error es un éxito.
Antes de correr esto en serio: ejecuta con --debug sobre un solo
producto y un precio que sepas que funciona, mira la respuesta cruda
impresa, y ajusta `es_rechazado()` si el formato real es distinto (por
ejemplo si en éxito devuelve JSON tipo {"cod_rpta": 0, ...}).

USO
---
  # 1era vez: abre un Chromium VISIBLE para que hagas login a mano en
  # Perú Compras, y guarda la sesión (cookies) en storage_state.json
  python buscar_precio_maximo.py --login

  # Calibrar / probar UN solo producto conocido antes de correr todo
  python buscar_precio_maximo.py --debug --solo-producto 2367902 --moneda PEN

  # Correr la búsqueda real (headless, rápido) sobre todos los
  # acuerdos / catálogos / categorías activos
  python buscar_precio_maximo.py

Requisitos:
  pip install playwright
  playwright install chromium
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from playwright.async_api import async_playwright, BrowserContext, Page

BASE = "https://catalogos.perucompras.gob.pe"
URL_ENTRADA = f"{BASE}/t_ProductoOfertadoAmp/CatalogoProductoIndex"
URL_LISTA_CATALOGOS = f"{BASE}/General/ListaJ_CatalogoAcuerdo"
URL_LISTA_CATEGORIAS = f"{BASE}/General/ListaJ_CategoriaCatalogo"
URL_LISTA_PRODUCTOS = f"{BASE}/t_ProductoOfertadoAmp/_CatalogoProductoIndexJson"
URL_INSERTA_PRECIO = f"{BASE}/t_ProductoOfertadoAmp/Inserta_ProductoOfertadoTMP"

STORAGE_STATE_PATH = Path("storage_state.json")
REPORTE_PATH = Path("reporte_precios_maximos.csv")

# --- parámetros de la búsqueda ---------------------------------------------
PRECIO_INICIAL = 0.10        # primer valor a probar en la fase exponencial
PRECISION = 0.01             # resolución final del precio (1 céntimo)
MAX_ITER_FASE1 = 40          # tope de seguridad, subir desde PRECIO_INICIAL
MAX_ITER_FASE2 = 40          # tope de seguridad, subir desde el primer aceptado
MAX_ITER_FASE3 = 30          # tope de seguridad, binaria final
CONCURRENCIA_MAX = 5         # cuántos productos se prueban en paralelo
PAUSA_ENTRE_REQUESTS = 0.12  # pequeño respiro por request, evita gatillar un WAF/rate-limit

ERROR_MARKERS = (
    "limites extremos",
    "límites extremos",
    "fuera de los limites",
)


def es_rechazado(status_ok: bool, texto_respuesta: str) -> bool:
    """
    Ver bloque "CALIBRAR ANTES DE USAR EN SERIO" al inicio del archivo.
    Ajusta esto en cuanto sepas cómo luce una respuesta de ÉXITO real.
    """
    if not status_ok:
        return True
    bajo = texto_respuesta.lower()
    return any(marcador in bajo for marcador in ERROR_MARKERS)


# --- estructuras de datos ----------------------------------------------------

@dataclass
class Producto:
    id_catalogo_producto: int
    descripcion: str
    moneda: str
    acuerdo: str
    catalogo: str
    categoria: str
    estado_actual: str


@dataclass
class ResultadoProducto:
    producto: Producto
    precio_maximo: Optional[float]
    intentos: int
    motivo: str  # "ok" | "sin_rango_encontrado" | "sin_techo_encontrado" | "error"
    detalle: str = ""


# --- fase de login / sesión --------------------------------------------------

async def hacer_login_manual() -> None:
    """
    Abre un Chromium visible para que inicies sesión a mano en Perú
    Compras. Cuando termines (ya viendo el panel logueado), presiona
    ENTER en la consola — esto guarda cookies/sesión en
    storage_state.json para que las siguientes corridas (headless,
    rápidas) reutilicen la misma sesión sin volver a loguear.
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context()
        page = await context.new_page()
        await page.goto(BASE)
        print("Inicia sesión en la pestaña abierta. Cuando ya estés dentro, vuelve acá y presiona ENTER...")
        await asyncio.get_event_loop().run_in_executor(None, input)
        await context.storage_state(path=str(STORAGE_STATE_PATH))
        await browser.close()
        print(f"Sesión guardada en {STORAGE_STATE_PATH.resolve()}")


# --- descubrimiento de acuerdos / catálogos / categorías --------------------

async def obtener_acuerdos(page: Page) -> list[dict]:
    """
    Lee el <select id="ajaxAcuerdo"> ya renderizado en la página de
    entrada (detrás del select2). Devuelve [{"value": "370", "text": "..."}]
    filtrando el placeholder ("Seleccione un Acuerdo Marco", value vacío u "0").
    """
    await page.goto(URL_ENTRADA)
    opciones = await page.eval_on_selector_all(
        "#ajaxAcuerdo option",
        "els => els.map(e => ({value: e.value, text: e.textContent.trim()}))",
    )
    return [o for o in opciones if o["value"] not in ("", "0")]


async def obtener_catalogos(context: BrowserContext, n_acuerdo: str) -> list[dict]:
    resp = await context.request.post(
        URL_LISTA_CATALOGOS,
        form={"N_Acuerdo": n_acuerdo, "C_Estado": "ACTIVO"},
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    datos = await resp.json()
    return [{"value": d["Value"], "text": d["Text"]} for d in datos]


async def obtener_categorias(context: BrowserContext, n_catalogo: str) -> list[dict]:
    """
    OJO: el ejemplo que tenemos solo cubre N_Nivel=1 con
    N_CategoriaParent=0. Si algún catálogo tiene categorías anidadas
    (nivel 2+), habría que llamar de nuevo este mismo endpoint pasando
    N_CategoriaParent = value de la categoría de nivel 1 y N_Nivel="2",
    y así recursivamente hasta que la respuesta venga vacía. No lo
    implementé porque no vimos un caso real con sub-niveles — si te
    encuentras con catálogos que sí los tienen, avísame y lo agregamos.
    """
    resp = await context.request.post(
        URL_LISTA_CATEGORIAS,
        form={
            "N_Catalogo": n_catalogo,
            "N_CategoriaParent": "0",
            "C_Estado": "ACTIVO",
            "N_Nivel": "1",
        },
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    datos = await resp.json()
    return [{"value": d["Value"], "text": d["Text"]} for d in datos]


def _columnas_datatable() -> dict:
    """Arma los parámetros columns[i][...] exactos que usa el DataTable real."""
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


async def obtener_productos(
    context: BrowserContext,
    n_acuerdo: str,
    n_catalogo: str,
    n_categoria: str,
    longitud_pagina: int = 500,
) -> list[dict]:
    """
    Llama _CatalogoProductoIndexJson con paginación (start/length) hasta
    traer todas las filas (recordsTotal puede ser mayor a una página).
    """
    productos: list[dict] = []
    start = 0
    while True:
        form = {
            "draw": "1",
            **_columnas_datatable(),
            "order[0][column]": "0",
            "order[0][dir]": "asc",
            "start": str(start),
            "length": str(longitud_pagina),
            "search[value]": "",
            "search[regex]": "false",
            "N_Acuerdo": n_acuerdo,
            "N_Catalogo": n_catalogo,
            "N_Categoria": n_categoria,
            "C_Descripcion": "",
        }
        resp = await context.request.post(
            URL_LISTA_PRODUCTOS,
            form=form,
            headers={"X-Requested-With": "XMLHttpRequest"},
        )
        cuerpo = await resp.json()
        filas = cuerpo.get("data", [])
        productos.extend(filas)
        total = int(cuerpo.get("recordsTotal", len(productos)))
        start += longitud_pagina
        if start >= total or not filas:
            break
    return productos


# --- prueba de un precio individual ------------------------------------------

async def probar_precio(
    context: BrowserContext,
    id_producto: int,
    moneda: str,
    precio: float,
    debug: bool = False,
) -> bool:
    """POST directo a Inserta_ProductoOfertadoTMP. True = precio aceptado."""
    resp = await context.request.post(
        URL_INSERTA_PRECIO,
        form={
            "N_CatalogoProducto": str(id_producto),
            "C_MonedaOfertada": moneda,
            "N_PrecioOfertado": f"{precio:.2f}",
        },
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    texto = await resp.text()
    rechazado = es_rechazado(resp.ok, texto)
    if debug:
        print(f"    [debug] precio={precio:.2f} status={resp.status} rechazado={rechazado}")
        print(f"    [debug] respuesta cruda: {texto[:500]!r}")
    await asyncio.sleep(PAUSA_ENTRE_REQUESTS)
    return not rechazado


# --- algoritmo de búsqueda: exponencial + exponencial + binaria -------------

async def encontrar_precio_maximo(
    context: BrowserContext,
    producto: Producto,
    debug: bool = False,
) -> ResultadoProducto:
    intentos = 0

    # Fase 1: subir desde un valor chico hasta el primer ACEPTADO
    valor = PRECIO_INICIAL
    lo: Optional[float] = None
    for _ in range(MAX_ITER_FASE1):
        intentos += 1
        if await probar_precio(context, producto.id_catalogo_producto, producto.moneda, valor, debug):
            lo = valor
            break
        valor *= 2
    if lo is None:
        return ResultadoProducto(
            producto, None, intentos, "sin_rango_encontrado",
            "Ningún valor probado en la fase exponencial fue aceptado; "
            "puede que el rango válido esté fuera de lo que cubre MAX_ITER_FASE1, "
            "o que el producto no admita precio (revisar C_Estado).",
        )

    # Fase 2: seguir subiendo desde lo (aceptado) hasta el primer RECHAZADO
    hi: Optional[float] = None
    valor = lo * 2
    for _ in range(MAX_ITER_FASE2):
        intentos += 1
        if await probar_precio(context, producto.id_catalogo_producto, producto.moneda, valor, debug):
            lo = valor
            valor *= 2
        else:
            hi = valor
            break
    if hi is None:
        return ResultadoProducto(
            producto, lo, intentos, "sin_techo_encontrado",
            f"Se aceptaron valores hasta {lo:.2f} sin encontrar un rechazo por arriba "
            "dentro de MAX_ITER_FASE2 — el precio_maximo reportado es un PISO, no el techo real.",
        )

    # Fase 3: binaria entre lo (bueno) y hi (malo) hasta la precisión pedida
    for _ in range(MAX_ITER_FASE3):
        if (hi - lo) <= PRECISION:
            break
        intentos += 1
        medio = round((lo + hi) / 2, 2)
        if medio == lo or medio == hi:
            break
        if await probar_precio(context, producto.id_catalogo_producto, producto.moneda, medio, debug):
            lo = medio
        else:
            hi = medio

    return ResultadoProducto(producto, lo, intentos, "ok")


# --- orquestación general ----------------------------------------------------

async def procesar_producto_con_limite(
    context: BrowserContext,
    producto: Producto,
    semaforo: asyncio.Semaphore,
    debug: bool,
) -> ResultadoProducto:
    async with semaforo:
        print(f"-> Buscando precio máximo: {producto.id_catalogo_producto} ({producto.descripcion[:60]}...)")
        resultado = await encontrar_precio_maximo(context, producto, debug)
        estado = f"{resultado.precio_maximo:.2f}" if resultado.precio_maximo is not None else "N/A"
        print(f"   [{resultado.motivo}] {producto.id_catalogo_producto} -> {estado} ({resultado.intentos} intentos)")
        return resultado


async def correr(solo_producto: Optional[int], moneda_manual: str, debug: bool) -> None:
    if not STORAGE_STATE_PATH.exists():
        print("No existe storage_state.json — corre primero con --login")
        sys.exit(1)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not debug)
        context = await browser.new_context(storage_state=str(STORAGE_STATE_PATH))
        page = await context.new_page()

        resultados: list[ResultadoProducto] = []
        semaforo = asyncio.Semaphore(CONCURRENCIA_MAX)

        if solo_producto is not None:
            # Modo calibración: un solo ID de producto conocido, sin recorrer
            # todo el árbol de acuerdos/catálogos/categorías.
            producto = Producto(
                id_catalogo_producto=solo_producto,
                descripcion="(modo --solo-producto)",
                moneda=moneda_manual,
                acuerdo="", catalogo="", categoria="", estado_actual="",
            )
            resultados.append(await procesar_producto_con_limite(context, producto, semaforo, debug))
        else:
            acuerdos = await obtener_acuerdos(page)
            print(f"Acuerdos encontrados: {[a['text'] for a in acuerdos]}")

            tareas = []
            for acuerdo in acuerdos:
                catalogos = await obtener_catalogos(context, acuerdo["value"])
                for catalogo in catalogos:
                    categorias = await obtener_categorias(context, catalogo["value"])
                    for categoria in categorias:
                        filas = await obtener_productos(
                            context, acuerdo["value"], catalogo["value"], categoria["value"]
                        )
                        print(
                            f"{acuerdo['text']} / {catalogo['text']} / {categoria['text']}: "
                            f"{len(filas)} producto(s)"
                        )
                        for fila in filas:
                            producto = Producto(
                                id_catalogo_producto=fila["N_CatalogoProducto"],
                                descripcion=fila.get("C_Descripcion", ""),
                                moneda=fila.get("C_MonedaOfertada", "PEN"),
                                acuerdo=acuerdo["text"],
                                catalogo=catalogo["text"],
                                categoria=categoria["text"],
                                estado_actual=fila.get("C_Estado", ""),
                            )
                            tareas.append(procesar_producto_con_limite(context, producto, semaforo, debug))

            resultados = await asyncio.gather(*tareas) if tareas else []

        await browser.close()

    guardar_reporte(resultados)


def guardar_reporte(resultados: list[ResultadoProducto]) -> None:
    with REPORTE_PATH.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow([
            "id_catalogo_producto", "descripcion", "moneda", "acuerdo", "catalogo",
            "categoria", "estado_actual", "precio_maximo", "intentos", "motivo", "detalle",
        ])
        for r in resultados:
            writer.writerow([
                r.producto.id_catalogo_producto, r.producto.descripcion, r.producto.moneda,
                r.producto.acuerdo, r.producto.catalogo, r.producto.categoria,
                r.producto.estado_actual,
                f"{r.precio_maximo:.2f}" if r.precio_maximo is not None else "",
                r.intentos, r.motivo, r.detalle,
            ])
    print(f"\nReporte guardado en {REPORTE_PATH.resolve()} ({len(resultados)} producto(s)).")
    print("RECUERDA: los precios ya quedaron guardados en la tabla TMP de Perú Compras.")
    print("Revisa la interfaz manualmente y solo TÚ decides cuándo presionar 'Enviar Oferta'.")
    print("Este script nunca la presiona.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--login", action="store_true", help="Abre un Chromium visible para loguearte a mano")
    parser.add_argument("--debug", action="store_true", help="Corre con navegador visible e imprime cada respuesta cruda")
    parser.add_argument("--solo-producto", type=int, default=None, help="Calibrar: probar un solo N_CatalogoProducto conocido")
    parser.add_argument("--moneda", type=str, default="PEN", help="Moneda a usar con --solo-producto")
    args = parser.parse_args()

    if args.login:
        asyncio.run(hacer_login_manual())
        return

    asyncio.run(correr(args.solo_producto, args.moneda, args.debug))


if __name__ == "__main__":
    main()