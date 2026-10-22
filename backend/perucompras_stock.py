"""
Helbot - perucompras_stock.py (versión Playwright)
FASE 1 extraer_todo(): recorre acuerdo -> catálogo -> categoría de ESTE uid,
        pulsa Iniciar Búsqueda y lee TODAS las filas.
FASE 2 modificar_seleccion(): por cada producto elegible abre el modal
        Existencias, pone 50000-100000, Guardar y confirma "Sí".
"""
import os
import re
import json
import random
import logging
import threading
from datetime import datetime

from perucompras_pw import (
    PWTimeout, abrir_pagina, ir_a, esperar_ajax, select2_listar, select2_seleccionar,
    opciones_select, drenar_modales, sesion_caida, captura,
)

logger = logging.getLogger("helbot.perucompras_stock")

# ---------------- historial de lo ya aplicado (persistente en disco) ----------------
HISTORIAL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "historial_stock.json")
_HIST_LOCK = threading.Lock()


def _hist_leer_todo() -> dict:
    try:
        with open(HISTORIAL_PATH, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def _hist_cargar(usuario) -> dict:
    with _HIST_LOCK:
        return _hist_leer_todo().get((usuario or "").lower(), {})


def _hist_guardar(usuario, items: list[dict]):
    """Guarda en disco los items que quedaron MODIFICADO (clave = id del producto)."""
    if not items:
        return
    with _HIST_LOCK:
        todo = _hist_leer_todo()
        mio = todo.setdefault((usuario or "").lower(), {})
        for it in items:
            mio[str(it["id"])] = {
                "fecha": datetime.now().isoformat(timespec="seconds"),
                "stock_nuevo": it["stock_nuevo"],
                "categoria": it["categoria"],
                "ficha": it["ficha_producto"][:120],
            }
        tmp = HISTORIAL_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(todo, fh, ensure_ascii=False)
        os.replace(tmp, HISTORIAL_PATH)

URL_STOCK = "/MejoraBasica"
STOCK_MIN = 50000
STOCK_MAX = 100000
COMBINACIONES: list = []  # compatibilidad: ya no se usa (los datos salen del portal)
RE_ERROR = re.compile(r"error|no se pudo|no es v[aá]lid|inv[aá]lid|incorrect|fall", re.I)

_JS_LEER = r"""() => {
  const tabla = document.querySelector('#TablaProductos');
  if (!tabla) return [];
  let nodos = [...tabla.querySelectorAll('tbody tr')];
  try {
    if (window.jQuery && jQuery.fn.dataTable && jQuery.fn.dataTable.isDataTable('#TablaProductos')) {
      nodos = jQuery('#TablaProductos').DataTable().rows().nodes().toArray();
    }
  } catch (e) {}
  return nodos.map(tr => {
    const td = tr.querySelectorAll('td');
    const a = tr.querySelector('a[onclick*="fnModificarStock"]');
    const m = a ? (a.getAttribute('onclick') || '').match(/fnModificarStock\((\d+)\)/) : null;
    const t = i => td[i] ? td[i].innerText.trim() : '';
    return {id: m ? m[1] : null, ncols: td.length, ficha: t(1).replace(/\s+/g,' '), precio: t(4), vig: t(6), pub: t(7)};
  }).filter(f => f.ncols >= 7);
}"""


def _num(t):
    t = (t or "").replace(",", "").strip()
    try:
        return int(float(t)) if t else None
    except Exception:
        return None


def _es_elegible(efectivo) -> bool:
    """Se modifica solo si stock != 2 y < 50000 (>=50000 ya está bien)."""
    return efectivo is not None and efectivo != 2 and efectivo < STOCK_MIN


# ---------------- navegación ----------------
def _preparar(page, acuerdo_id: str, catalogo_id: str):
    ir_a(page, URL_STOCK)
    page.wait_for_selector("#ajaxAcuerdo", state="attached")
    select2_seleccionar(page, "ajaxAcuerdo", acuerdo_id)
    esperar_ajax(page)
    page.select_option("#ajaxCatalogo", catalogo_id)
    esperar_ajax(page)


def _buscar(page):
    page.evaluate("() => document.querySelectorAll('#TablaProductos').forEach(e => e.remove())")
    try:
        with page.expect_response(lambda r: "ListaProductosOfertados" in r.url, timeout=45000):
            page.click("#btnBuscar")
    except PWTimeout:
        logger.warning("La búsqueda no disparó _ListaProductosOfertados en 45s")
    esperar_ajax(page, 500)
    try:
        page.wait_for_selector("#TablaProductos", timeout=6000)
    except PWTimeout:
        pass


def _ir_categoria(page, acuerdo_id, catalogo_id, categoria_id):
    _preparar(page, acuerdo_id, catalogo_id)
    page.select_option("#ajaxCategoria", categoria_id)
    esperar_ajax(page)
    _buscar(page)


def _explorar_arbol(page, progreso) -> list[dict]:
    ir_a(page, URL_STOCK)
    page.wait_for_selector("#ajaxAcuerdo", state="attached")
    arbol = []
    for ac in select2_listar(page, "ajaxAcuerdo"):
        progreso["categoria_actual"] = f"Leyendo {ac['texto'][:50]}..."
        select2_seleccionar(page, "ajaxAcuerdo", ac["dato_id"])
        esperar_ajax(page)
        nodo = {"acuerdo_id": ac["dato_id"], "acuerdo": ac["texto"], "catalogos": []}
        for cat in opciones_select(page, "ajaxCatalogo"):
            page.select_option("#ajaxCatalogo", cat["value"])
            esperar_ajax(page)
            cats = opciones_select(page, "ajaxCategoria")
            nodo["catalogos"].append({
                "id": cat["value"], "nombre": cat["texto"],
                "categorias": [{"id": c["value"], "nombre": c["texto"]} for c in cats],
            })
        arbol.append(nodo)
    return arbol


def _leer_categoria(page, ac, cat, ca) -> list[dict]:
    data = []
    for f in page.evaluate(_JS_LEER):
        vig, pub = _num(f["vig"]), _num(f["pub"])
        if vig is None and pub is None:
            continue
        efectivo = pub if pub is not None else vig
        ficha = f["ficha"]
        mc = re.search(r"([A-Z0-9\-]+)$", ficha)
        if not f["id"]:
            estado = "SIN_ID"
        else:
            estado = "PENDIENTE" if _es_elegible(efectivo) else "OMITIDO"
        data.append({
            "id": f["id"], "categoria": ca["nombre"], "ficha_producto": ficha,
            "codigo": mc.group(1) if mc else "SIN-COD", "precio_vigente": f["precio"],
            "stock_actual": vig if vig is not None else 0, "stock_publicar": pub,
            "stock_nuevo": None, "estado": estado,
            "acuerdo_id": ac["acuerdo_id"], "catalogo_id": cat["id"], "categoria_id": ca["id"],
        })
    return data


# ---------------- FASE 1 ----------------
def extraer_todo(pc_session, progreso: dict) -> list[dict]:
    todos: list[dict] = []
    progreso.update({"fase": "extrayendo", "categoria_actual": "Leyendo acuerdos...",
                     "categorias_completadas": 0, "total_categorias": 0})
    with abrir_pagina(pc_session) as (page, _dialogos):
        try:
            arbol = _explorar_arbol(page, progreso)
            progreso["total_categorias"] = sum(len(c["categorias"]) for a in arbol for c in a["catalogos"])
            if progreso["total_categorias"] == 0:
                captura(page, "stock_sin_categorias")
                raise RuntimeError("Este usuario no tiene acuerdos/catálogos/categorías en Precio y Existencias.")
            for ac in arbol:
                for cat in ac["catalogos"]:
                    if not cat["categorias"]:
                        continue
                    _preparar(page, ac["acuerdo_id"], cat["id"])
                    for ca in cat["categorias"]:
                        progreso["categoria_actual"] = ca["nombre"]
                        try:
                            page.select_option("#ajaxCategoria", ca["id"])
                            esperar_ajax(page)
                            _buscar(page)
                            todos.extend(_leer_categoria(page, ac, cat, ca))
                        except Exception as e:
                            if sesion_caida(page):
                                raise
                            logger.error(f"Categoría {ca['nombre']} falló: {e}")
                            captura(page, f"stock_extraer_{ca['nombre']}")
                        progreso["categorias_completadas"] += 1
        except Exception:
            captura(page, "stock_extraer_error")
            raise
    if not todos:
        raise RuntimeError("0 productos extraídos. Revisa la carpeta debug_pw/ y el log.")

    # Lo que ya apliqué antes y el portal confirma con stock correcto -> se salta y se indica
    hist = _hist_cargar(pc_session.usuario)
    for it in todos:
        if it["id"] and str(it["id"]) in hist:
            it["modificado_antes"] = hist[str(it["id"])].get("fecha")
            if it["estado"] == "OMITIDO":
                it["estado"] = "YA_APLICADO"
    progreso["ya_aplicados"] = sum(1 for i in todos if i["estado"] == "YA_APLICADO")
    progreso["nuevos_pendientes"] = sum(1 for i in todos if i["estado"] == "PENDIENTE")
    progreso["fase"] = "listo"
    return todos


# ---------------- FASE 2 ----------------
def _cerrar_modal(page):
    try:
        page.keyboard.press("Escape")
        page.evaluate("() => { if (window.jQuery) jQuery('.modal').modal('hide'); }")
    except Exception:
        pass


def _modificar_item(page, item: dict):
    nuevo = random.randint(STOCK_MIN, STOCK_MAX)
    ultimo_error = ""
    for _intento in (1, 2):
        try:
            id_num = int(item["id"])
            page.evaluate("id => fnModificarStock(id)", id_num)
            page.wait_for_selector("#modalBody #N_Stock", state="visible", timeout=30000)
            page.wait_for_function(
                "id => { const e=document.querySelector('#ID_ProductoOfertado'); return !!e && e.value===String(id); }",
                arg=id_num, timeout=15000,
            )
            page.fill("#N_Stock", str(nuevo))
            page.click("#btn_guardar")
            ok_btn = page.locator("._wModal_btn_ok:visible").first
            ok_btn.wait_for(state="visible", timeout=15000)
            ok_btn.click()
            page.wait_for_selector("#N_Stock", state="hidden", timeout=40000)
            esperar_ajax(page, 300)
            msgs = drenar_modales(page)
            errores = [m for m in msgs if RE_ERROR.search(m)]
            if errores:
                item["estado"] = f"ERROR:{errores[0][:80]}"
                return
            item["estado"] = "MODIFICADO"
            item["stock_nuevo"] = nuevo
            return
        except Exception as e:
            ultimo_error = str(e)[:120]
            if sesion_caida(page):
                raise RuntimeError("La sesión de Perú Compras se cayó durante la modificación")
            captura(page, f"stock_item_{item['id']}")
            _cerrar_modal(page)
            page.wait_for_timeout(800)
    item["estado"] = f"ERROR:{ultimo_error}"


def _verificar_grupo(page, ac_id, cat_id, ca_id, lista: list[dict]):
    """Re-busca y compara. Solo marca ERROR si la fila quedó IGUAL que antes."""
    try:
        _ir_categoria(page, ac_id, cat_id, ca_id)
        filas = {f["id"]: f for f in page.evaluate(_JS_LEER) if f["id"]}
    except Exception as e:
        logger.warning(f"No se pudo verificar el grupo: {e}")
        return
    for it in lista:
        if it["estado"] != "MODIFICADO":
            continue
        f = filas.get(it["id"])
        if not f:
            continue
        vig, pub = _num(f["vig"]), _num(f["pub"])
        if it["stock_nuevo"] in (vig, pub):
            continue
        if vig == it["stock_actual"] and pub == it["stock_publicar"]:
            it["estado"] = "ERROR:no se reflejó el cambio"
            it["stock_nuevo"] = None


def modificar_seleccion(pc_session, progreso: dict, items: list[dict], categorias_seleccionadas: set[str]) -> None:
    a_procesar = [
        i for i in items
        if i["categoria"] in categorias_seleccionadas
        and i["id"]
        and (i["estado"] == "PENDIENTE" or str(i["estado"]).startswith("ERROR"))
    ]
    progreso.update({"fase": "modificando", "categoria_actual": None,
                     "total_a_modificar": len(a_procesar), "procesados": 0})
    grupos: dict[tuple, list[dict]] = {}
    for it in a_procesar:
        grupos.setdefault((it["acuerdo_id"], it["catalogo_id"], it["categoria_id"]), []).append(it)

    if a_procesar:
        with abrir_pagina(pc_session) as (page, _dialogos):
            for (ac_id, cat_id, ca_id), lista in grupos.items():
                progreso["categoria_actual"] = lista[0]["categoria"]
                try:
                    _ir_categoria(page, ac_id, cat_id, ca_id)
                except Exception as e:
                    if sesion_caida(page):
                        raise
                    captura(page, f"stock_grupo_{ca_id}")
                    for it in lista:
                        it["estado"] = f"ERROR:{str(e)[:80]}"
                    progreso["procesados"] += len(lista)
                    continue
                for it in lista:
                    _modificar_item(page, it)
                    progreso["procesados"] += 1
                _verificar_grupo(page, ac_id, cat_id, ca_id, lista)
                _hist_guardar(pc_session.usuario, [it for it in lista if it["estado"] == "MODIFICADO"])
    progreso["fase"] = "completado"


def calcular_stats_por_categoria(items: list[dict]) -> list[dict]:
    por_cat: dict[str, list[dict]] = {}
    for i in items:
        por_cat.setdefault(i["categoria"], []).append(i)
    stats = []
    for nombre, filas in por_cat.items():
        stats.append({
            "categoria": nombre,
            "total": len(filas),
            "pendientes": sum(1 for f in filas if f["estado"] == "PENDIENTE"),
            "modificados": sum(1 for f in filas if f["estado"] == "MODIFICADO"),
            "omitidos": sum(1 for f in filas if f["estado"] == "OMITIDO"),
            "ya_aplicados": sum(1 for f in filas if f["estado"] == "YA_APLICADO"),
            "errores": sum(1 for f in filas if f["estado"] in ("ERROR", "TIMEOUT", "SIN_ID") or str(f["estado"]).startswith("ERROR")),
        })
    stats.sort(key=lambda s: s["categoria"])
    return stats