"""
Helbot - perucompras_ofertas.py (Playwright + fetch directo)

Excel (Nro. parte | Precio unit. prom. ofertado | Marca) ->
  1) busca cada Nro. parte en _CatalogoProductoIndexJson (coincidencia EXACTA)
  2) si el precio del portal ya es el del Excel -> "sin cambio"
  3) si no: Inserta_ProductoOfertadoTMP (N_CatalogoProducto, PEN, precio)
  4) vuelve a buscar y VERIFICA que el portal quedó con el precio del Excel
  5) al final: Envia_ProductoOfertadoTMP (N_Catalogo, N_Categoria) por cada categoría con inserciones
  6) escribe un Excel *_resultado.xlsx con: Encontrado / Resultado / precio antes / después / detalle
"""
import io
import os
import re
import logging
from contextlib import contextmanager
from copy import copy

from perucompras_pw import abrir_pagina, ir_a, sesion_caida, captura

logger = logging.getLogger("helbot.perucompras_ofertas")

URL_INDEX = "/t_ProductoOfertadoAmp/CatalogoProductoIndex"
URL_BUSCAR = "/t_ProductoOfertadoAmp/_CatalogoProductoIndexJson"
URL_INSERTA = "/t_ProductoOfertadoAmp/Inserta_ProductoOfertadoTMP"
URL_ENVIA = "/t_ProductoOfertadoAmp/Envia_ProductoOfertadoTMP"

CONC = max(1, min(8, int(os.getenv("OFERTA_CONC", "4"))))      # peticiones simultáneas
CHUNK = max(5, int(os.getenv("OFERTA_CHUNK", "25")))            # filas por lote
RE_ERROR = re.compile(r"error|exception|no se pudo|inv[aá]lid|fall", re.I)


@contextmanager
def _ctx_pagina(page):
    """Permite usar una página ya abierta (modo manual)."""
    yield page, []


# ======================= Excel de entrada =======================
def _num(v) -> float | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 2)
    t = re.sub(r"[^\d.,-]", "", str(v))
    if "," in t and "." in t:
        t = t.replace(",", "")                 # 352,773.95
    elif "," in t:
        t = t.replace(",", ".") if re.search(r",\d{1,2}$", t) else t.replace(",", "")
    try:
        return round(float(t), 2)
    except ValueError:
        return None


def _detectar_cabecera(filas):
    for i, fila in enumerate(filas[:10]):
        c = {}
        for j, v in enumerate(fila):
            t = str(v or "").lower().strip()
            if "nro" in t and "parte" in t:
                c["parte"] = j
            elif "precio" in t:
                c["precio"] = j
            elif t == "marca":
                c["marca"] = j
        if "parte" in c and "precio" in c:
            return i, c
    return None, {}


def leer_excel(origen) -> list[dict]:
    """origen: ruta o bytes. 'fila' = número de fila real en Excel."""
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(origen) if isinstance(origen, (bytes, bytearray)) else origen,
                       data_only=True, read_only=True)
    filas = list(wb.active.iter_rows(values_only=True))
    hdr_i, cols = _detectar_cabecera(filas)
    if hdr_i is None:
        raise RuntimeError("No encontré las columnas 'Nro. parte' y 'Precio unit. prom. ofertado' en el Excel.")
    out = []
    for n, fila in enumerate(filas[hdr_i + 1:], start=hdr_i + 2):
        parte = str(fila[cols["parte"]] or "").strip() if cols["parte"] < len(fila) else ""
        if not parte:
            continue
        precio = _num(fila[cols["precio"]]) if cols["precio"] < len(fila) else None
        marca = ""
        if "marca" in cols and cols["marca"] < len(fila):
            marca = str(fila[cols["marca"]] or "").strip()
        out.append({"fila": n, "parte": parte, "precio": precio, "marca": marca})
    return out


# ======================= fetch directo (dentro de la página) =======================
_JS_CATS = r"""(cid) => {
  for (const s of document.querySelectorAll('select')) {
    const ops = [...s.options].map(o => ({id: o.value, nombre: o.text.trim()}));
    if (ops.some(o => o.id === String(cid)))
      return ops.filter(o => /^\d+$/.test(o.id) && o.id !== '0');
  }
  return [];
}"""

_JS_LOTE = r"""async ([urlB, urlI, filas, acuerdo, catalogo, cats, conc, dry]) => {
  const H = {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
             'X-Requested-With': 'XMLHttpRequest'};
  const COLS = ['C_Imagen','C_Descripcion','C_ArchivoDescriptivo','C_MonedaOfertada',
                'N_PrecioOfertado','N_CatalogoProducto','C_Estado'];
  const out = new Array(filas.length);
  let i = 0;
  const norm = s => (s || '').toUpperCase();

  function cuerpo(kw, cat) {
    const p = new URLSearchParams();
    p.set('draw', '1');
    COLS.forEach((c, k) => {
      p.set(`columns[${k}][data]`, c); p.set(`columns[${k}][name]`, c);
      p.set(`columns[${k}][searchable]`, 'true'); p.set(`columns[${k}][orderable]`, 'true');
      p.set(`columns[${k}][search][value]`, ''); p.set(`columns[${k}][search][regex]`, 'false');
    });
    p.set('order[0][column]', '0'); p.set('order[0][dir]', 'asc');
    p.set('start', '0'); p.set('length', '50');
    p.set('search[value]', ''); p.set('search[regex]', 'false');
    p.set('N_Acuerdo', acuerdo); p.set('N_Catalogo', catalogo); p.set('N_Categoria', cat);
    p.set('C_Descripcion', kw);
    return p.toString();
  }
  async function buscar(kw, cat) {
    const r = await fetch(urlB, {method: 'POST', headers: H, body: cuerpo(kw, cat), credentials: 'include'});
    if (r.status !== 200) throw new Error('búsqueda HTTP ' + r.status);
    const t = await r.text();
    try { return JSON.parse(t).data || []; }
    catch (_) { const e = new Error('respuesta no JSON (¿sesión caída?)'); e.sesion = true; throw e; }
  }
  function exactos(data, kw, marca) {
    let ex = data.filter(d => norm(d.C_Descripcion).split(/\s+/).includes(kw));
    if (ex.length > 1 && marca) {
      const mb = ex.filter(d => norm(d.C_Descripcion).includes(norm(marca)));
      if (mb.length >= 1) ex = mb;
    }
    return ex;
  }

  async function uno(f) {
    try {
      if (f.precio === null || f.precio <= 0) return {e: 'sin_precio'};
      const kw = norm(f.parte);
      let ex = [], cat = null, vistos = 0;
      for (const c of cats) {
        const data = await buscar(f.parte, c);
        vistos += data.length;
        ex = exactos(data, kw, f.marca);
        if (ex.length >= 1) { cat = c; break; }
      }
      if (ex.length === 0) return {e: 'no_encontrado', n: vistos};
      if (ex.length > 1) return {e: 'ambiguo', n: ex.length, cat: cat};
      const it = ex[0], cp = it.N_CatalogoProducto, antes = Number(it.N_PrecioOfertado);
      if (dry) return {e: 'encontrado', cp: cp, cat: cat, antes: antes, estado: it.C_Estado};
      if (Math.abs(antes - f.precio) < 0.005)
        return {e: 'ya_tenia_precio', cp: cp, cat: cat, antes: antes, despues: antes};

      const p = new URLSearchParams();
      p.set('N_CatalogoProducto', cp); p.set('C_MonedaOfertada', 'PEN'); p.set('N_PrecioOfertado', String(f.precio));
      const ri = await fetch(urlI, {method: 'POST', headers: H, body: p.toString(), credentials: 'include'});
      const ti = (await ri.text()).trim();
      if (ri.status !== 200) return {e: 'error', cp: cp, cat: cat, antes: antes, m: 'inserta HTTP ' + ri.status};
      if (ti.startsWith('<')) return {e: 'sesion', cp: cp, cat: cat, m: 'inserta devolvió HTML'};

      // verificación: releer la ficha y comparar el precio del portal con el del Excel
      const d2 = exactos(await buscar(f.parte, cat), kw, f.marca);
      const it2 = d2.find(d => d.N_CatalogoProducto === cp);
      if (!it2) return {e: 'insertado', cp: cp, cat: cat, antes: antes, verif: 'no_verificable', r: ti.slice(0, 80)};
      const despues = Number(it2.N_PrecioOfertado);
      if (Math.abs(despues - f.precio) < 0.005)
        return {e: 'insertado', cp: cp, cat: cat, antes: antes, despues: despues, verif: 'ok', r: ti.slice(0, 80)};
      return {e: 'precio_no_coincide', cp: cp, cat: cat, antes: antes, despues: despues, r: ti.slice(0, 80)};
    } catch (err) {
      return {e: err.sesion ? 'sesion' : 'error', m: String(err.message || err).slice(0, 100)};
    }
  }
  async function w() {
    while (true) { const k = i++; if (k >= filas.length) return; out[k] = await uno(filas[k]); }
  }
  await Promise.all(Array.from({length: Math.min(conc, filas.length)}, w));
  return out;
}"""

_JS_ENVIA = r"""async ([url, catalogo, categoria]) => {
  const p = new URLSearchParams(); p.set('N_Catalogo', catalogo); p.set('N_Categoria', categoria);
  const r = await fetch(url, {method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest'},
    body: p.toString(), credentials: 'include'});
  return {status: r.status, text: (await r.text()).trim().slice(0, 300)};
}"""


# ======================= texto del resultado por fila =======================
def _armar(f: dict, r: dict) -> dict:
    e = r["e"]
    base = {"fila": f["fila"], "nro_parte": f["parte"], "marca": f["marca"], "precio": f["precio"],
            "estado": e, "cp": r.get("cp"), "cat": r.get("cat"),
            "antes": r.get("antes"), "despues": r.get("despues"), "detalle": r.get("m") or r.get("r") or ""}
    if e == "insertado" and r.get("verif") == "ok":
        base.update(encontrado="SI", resultado="OK: precio actualizado y verificado", nivel="ok")
    elif e == "insertado":
        base.update(encontrado="SI", resultado="OK: insertado (el portal no lo muestra para verificar)", nivel="aviso")
    elif e == "ya_tenia_precio":
        base.update(encontrado="SI", resultado="PRECIO IGUAL: oferta enviada", nivel="aviso")
    elif e == "encontrado":
        base.update(encontrado="SI", resultado="ENCONTRADO (prueba, no se modificó nada)", nivel="aviso",
                    detalle=r.get("estado") or "")
    elif e == "no_encontrado":
        base.update(encontrado="NO", resultado="NO ENCONTRADO", nivel="mal",
                    detalle=f"0 coincidencias exactas ({r.get('n', 0)} fichas vistas)")
    elif e == "ambiguo":
        base.update(encontrado="SI", resultado=f"AMBIGUO: {r.get('n')} coincidencias", nivel="mal")
    elif e == "sin_precio":
        base.update(encontrado="-", resultado="SIN PRECIO en el Excel", nivel="mal")
    elif e == "precio_no_coincide":
        base.update(encontrado="SI", resultado="ERROR: el portal quedó con otro precio", nivel="mal")
    else:
        base.update(encontrado="?", resultado="ERROR", nivel="mal")
    return base


# ======================= ejecución principal =======================
def ejecutar_ofertas(pc_session, progreso: dict, filas: list[dict],
                     acuerdo_id: int, catalogo_id: int, categoria_id: int,
                     enviar: bool = True, dry_run: bool = False, pagina=None,
                     todas_categorias: bool = False, resultados: list | None = None,
                     enviar_cada: int = 0) -> list[dict]:
    """
    dry_run=True: solo busca. todas_categorias=True: si no está en la categoría dada,
    prueba las demás categorías del mismo catálogo. `resultados` se llena en vivo (sirve
    para guardar el reporte aunque el proceso se corte).
    """
    resultados = resultados if resultados is not None else []
    envios: list[dict] = []
    progreso.update({
        "combinacion_actual": "Abriendo navegador...", "total": len(filas), "procesadas": 0,
        "insertadas": 0, "verificadas": 0, "sin_cambio": 0, "no_encontradas": 0,
        "ambiguas": 0, "errores": 0, "enviado": False, "envios": envios,
    })

    with (_ctx_pagina(pagina) if pagina is not None else abrir_pagina(pc_session)) as (page, _dialogos):
        if pagina is None:
            ir_a(page, URL_INDEX)
        elif "catalogos.perucompras.gob.pe" not in page.url or "AccesoGeneral" in page.url:
            raise RuntimeError(f"La pestaña no está en 'Agregar oferta' (url actual: {page.url})")

        cats = [str(categoria_id)]
        if todas_categorias:
            otras = [o["id"] for o in page.evaluate(_JS_CATS, str(categoria_id)) if o["id"] != str(categoria_id)]
            cats += otras
            print(f"Buscará en {len(cats)} categorías (la dada primero)")

        tam = enviar_cada if (enviar_cada and enviar and not dry_run) else CHUNK
        for ini in range(0, len(filas), tam):
            lote = filas[ini: ini + tam]
            progreso["combinacion_actual"] = f"Filas {ini + 1}–{ini + len(lote)} de {len(filas)}"
            try:
                res = page.evaluate(_JS_LOTE, [URL_BUSCAR, URL_INSERTA, lote, str(acuerdo_id),
                                               str(catalogo_id), cats, CONC, dry_run])
            except Exception as e:
                cerrada = False
                try:
                    cerrada = page.is_closed()
                except Exception:
                    cerrada = True
                print("ERROR EVALUATE:", repr(e)[:300], "| pestaña cerrada:", cerrada)
                if cerrada or "closed" in str(e).lower():
                    raise RuntimeError("Playwright perdió la pestaña (no cierres ni recargues Chrome durante la corrida)")
                if sesion_caida(page):
                    raise RuntimeError("La sesión de Perú Compras se cayó durante las ofertas")
                captura(page, f"ofertas_lote_{ini}")
                res = [{"e": "error", "m": f"lote falló: {str(e)[:80]}"}] * len(lote)

            if res and all(r["e"] == "sesion" for r in res):
                raise RuntimeError("La sesión de Perú Compras no está activa (las respuestas no son JSON).")

            for f, r in zip(lote, res):
                x = _armar(f, r)
                resultados.append(x)
                progreso["procesadas"] += 1
                e = x["estado"]
                if e == "insertado":
                    progreso["insertadas"] += 1
                    if r.get("verif") == "ok":
                        progreso["verificadas"] += 1
                elif e == "ya_tenia_precio":
                    progreso["sin_cambio"] += 1
                elif e == "encontrado":
                    progreso["insertadas"] += 1
                elif e == "no_encontrado":
                    progreso["no_encontradas"] += 1
                elif e == "ambiguo":
                    progreso["ambiguas"] += 1
                else:
                    progreso["errores"] += 1
            print(f"  {progreso['combinacion_actual']} -> {progreso['procesadas']}/{len(filas)} "
                  f"| ins {progreso['insertadas']} ver {progreso['verificadas']} "
                  f"sin cambio {progreso['sin_cambio']} no enc {progreso['no_encontradas']} "
                  f"err {progreso['errores']}")
            if enviar_cada and enviar and not dry_run:
                nuevas = sorted({x["cat"] for x in resultados[-len(lote):]
                                 if x["estado"] in ("insertado", "ya_tenia_precio") and x["cat"]})
                for cat in nuevas:
                    r = page.evaluate(_JS_ENVIA, [URL_ENVIA, str(catalogo_id), str(cat)])
                    ok = r["status"] == 200 and not r["text"].startswith("<") and not RE_ERROR.search(r["text"])
                    envios.append({"categoria": cat, "ok": ok, "detalle": f"HTTP {r['status']}: {r['text'][:150]}"})
                    print(f"    ENVÍO cat {cat}: {'OK' if ok else 'FALLÓ'} -> {r['status']} {r['text'][:60]}")
                    if not ok:
                        raise RuntimeError("El envío falló; se detiene para no acumular fichas sin enviar") 

        if enviar and not dry_run and not enviar_cada:
            cats_envio = sorted({x["cat"] for x in resultados if x["estado"] == "insertado" and x["cat"]})
            for cat in cats_envio:
                progreso["combinacion_actual"] = f"Enviando oferta (categoría {cat})..."
                r = page.evaluate(_JS_ENVIA, [URL_ENVIA, str(catalogo_id), str(cat)])
                logger.info(f"Envia_ProductoOfertadoTMP cat {cat} -> {r}")
                ok = r["status"] == 200 and not r["text"].startswith("<") and not RE_ERROR.search(r["text"])
                envios.append({"categoria": cat, "ok": ok, "detalle": f"HTTP {r['status']}: {r['text'][:150]}"})
                print(f"  ENVÍO categoría {cat}: {'OK' if ok else 'FALLÓ'} -> {r['status']} {r['text'][:100]}")
            progreso["enviado"] = bool(envios) and all(e["ok"] for e in envios)

    return resultados

# ======================= modo UI (se ve en el navegador) =======================
def _exactos_ui(items: list[dict], kw: str, marca: str) -> list[dict]:
    ex = [it for it in items if kw in re.split(r"\s+", it["texto"])]
    if len(ex) > 1 and marca:
        mb = [it for it in ex if marca.upper() in it["texto"]]
        if mb:
            ex = mb
    return ex


ESPERA_RESP = max(10, int(os.getenv("OFERTA_ESPERA", "45"))) * 1000   # ms antes de dar F5
REINTENTOS = max(1, int(os.getenv("OFERTA_REINTENTOS", "6")))
_SELECTS: list = []   # catálogo/categoría elegidos, para restaurarlos tras F5


def _guardar_selects(page) -> list[dict]:
    return page.evaluate("""() => [...document.querySelectorAll('select')]
        .map(s => ({id: s.id, name: s.name, value: s.value}))""")


def _restaurar_selects(page, sel: list[dict]):
    for s in sel:
        css = f"#{s['id']}" if s["id"] else (f"select[name='{s['name']}']" if s["name"] else None)
        if not css or not s["value"]:
            continue
        try:
            if page.locator(css).first.input_value() != s["value"]:
                page.wait_for_function(
                    "([c, v]) => { const e = document.querySelector(c); "
                    "return e && [...e.options].some(o => o.value === v); }",
                    arg=[css, s["value"]], timeout=60000)
                page.select_option(css, s["value"])
                page.wait_for_timeout(1500)
        except Exception as ex:
            print(f"    no pude restaurar {css}: {str(ex)[:60]}")


def _buscar_ui(page, parte: str) -> list[dict]:
    from urllib.parse import quote_plus
    if not _SELECTS:
        _SELECTS.extend(_guardar_selects(page))
    for intento in range(1, REINTENTOS + 1):
        try:
            page.click("#C_Descripcion")
            page.keyboard.press("Control+A")
            page.keyboard.type(parte, delay=40)
            with page.expect_response(
                    lambda r: "_CatalogoProductoIndexJson" in r.url
                    and quote_plus(parte) in (r.request.post_data or ""),
                    timeout=ESPERA_RESP) as rb:
                page.click("#btnBuscar")
            break
        except Exception:
            print(f"    sin respuesta en {ESPERA_RESP // 1000}s (intento {intento}/{REINTENTOS}) -> F5")
            page.reload(wait_until="domcontentloaded", timeout=0)
            page.wait_for_timeout(3000)
            _restaurar_selects(page, _SELECTS)
    else:
        raise RuntimeError(f"el portal no respondió tras {REINTENTOS} intentos con F5")

    # cuántas fichas devolvió el servidor
    from urllib.parse import parse_qsl
    _pd = [(k, v) for k, v in parse_qsl(rb.value.request.post_data or "", keep_blank_values=True)
           if not k.startswith("columns[")]
    print("    PETICIÓN:", _pd)
    print("    RESPUESTA:", rb.value.text()[:200])
    try:
        n = len(rb.value.json().get("data") or [])
    except Exception:
        n = -1

    # si hay fichas, esperar a que la tabla las pinte (una fila con el código buscado)
    if n != 0:
        try:
            page.wait_for_function(
                """(kw) => [...document.querySelectorAll('tr')].some(
                       tr => tr.querySelector('input.cls_txtMonto')
                          && tr.innerText.toUpperCase().includes(kw))""",
                arg=parte.upper(), timeout=20000)
        except Exception:
            pass
    page.wait_for_timeout(1000)

    trs = page.locator("tr:has(input.cls_txtMonto)")
    print(f"    servidor devolvió {n} fichas | tabla: {trs.count()} filas con input")
    items = []
    for i in range(trs.count()):
        tr = trs.nth(i)
        items.append({"texto": tr.inner_text().upper(),
                      "inp": tr.locator("input.cls_txtMonto").first})
    return items


def _ok_resp(resp) -> tuple[bool, str]:
    t = resp.text().strip()
    ok = resp.status == 200 and not t.startswith("<") and not RE_ERROR.search(t)
    return ok, f"HTTP {resp.status}: {t[:120]}"


def _procesar_ui(page, f: dict, categoria_id: int, dry_run: bool) -> dict:
    if f["precio"] is None or f["precio"] <= 0:
        return {"e": "sin_precio"}
    kw = f["parte"].upper()
    cat = str(categoria_id)

    items = _buscar_ui(page, f["parte"])
    ex = _exactos_ui(items, kw, f["marca"])
    if not ex:
        for it in items:
            print("    FICHA VISTA (final):", " ".join(it["texto"].split())[-160:])
        return {"e": "no_encontrado", "n": len(items)}
    if len(ex) > 1:
        return {"e": "ambiguo", "n": len(ex), "cat": cat}

    inp = ex[0]["inp"]
    cp = inp.get_attribute("id")
    antes = _num(inp.input_value())
    estado_txt = " ".join(ex[0]["texto"].split())[-70:]
    igual = antes is not None and abs(antes - f["precio"]) < 0.005
    if dry_run:
        return {"e": "encontrado", "cp": cp, "cat": cat, "antes": antes,
                "estado": ("PRECIO IGUAL" if igual else "PRECIO DISTINTO") + " | " + estado_txt}
    if igual:
        with page.expect_response(lambda r: "Envia_ProductoOfertadoTMP" in r.url, timeout=30000) as re_:
            page.click("#btn_enviarOferta2")
        ok_e, det_e = _ok_resp(re_.value)
        try:
            page.get_by_role("button", name="OK", exact=True).click(timeout=5000)
        except Exception:
            pass
        if not ok_e:
            return {"e": "error", "cp": cp, "cat": cat, "antes": antes,
                    "m": "precio igual, pero el envío falló: " + det_e}
        return {"e": "ya_tenia_precio", "cp": cp, "cat": cat, "antes": antes, "despues": antes,
                "m": "precio igual; oferta enviada | " + det_e}

    # 1) escribir el precio y salir del campo (Tab) -> el portal inserta en la tabla temporal
    inp.scroll_into_view_if_needed()
    inp.click()
    page.keyboard.press("Control+A")
    page.keyboard.type(f"{f['precio']:.2f}", delay=30)
    en_campo = _num(inp.input_value())
    if en_campo is None or abs(en_campo - f["precio"]) >= 0.005:
        visto = inp.input_value()
        page.reload(wait_until="domcontentloaded", timeout=0)   # descarta lo escrito
        page.wait_for_timeout(3000)
        _restaurar_selects(page, _SELECTS)
        return {"e": "error", "cp": cp, "cat": cat, "antes": antes,
                "m": f"el campo quedó en {visto!r} y no en {f['precio']:.2f}; NO se insertó ni se envió"}
    try:
        with page.expect_response(lambda r: "Inserta_ProductoOfertadoTMP" in r.url, timeout=10000) as ri:
            page.keyboard.press("Tab")
    except Exception:
        return {"e": "error", "cp": cp, "cat": cat, "antes": antes,
                "m": "al salir del campo el portal no mandó Inserta_ProductoOfertadoTMP; NO se envió"}
    ok_i, det_i = _ok_resp(ri.value)
    if not ok_i:
        return {"e": "error", "cp": cp, "cat": cat, "antes": antes, "m": "inserta falló: " + det_i}
    from urllib.parse import parse_qsl
    insertado = dict(parse_qsl(ri.value.request.post_data or "")).get("N_PrecioOfertado", "")
    v_ins = _num(insertado)
    if v_ins is None or abs(v_ins - f["precio"]) >= 0.005:
        return {"e": "error", "cp": cp, "cat": cat, "antes": antes,
                "m": f"el portal insertó {insertado!r} y no {f['precio']:.2f}; NO se envió. Revisa lo pendiente en el portal"}

    # 2) Enviar Oferta
    with page.expect_response(lambda r: "Envia_ProductoOfertadoTMP" in r.url, timeout=30000) as re_:
        page.click("#btn_enviarOferta2")
    ok_e, det_e = _ok_resp(re_.value)
    try:
        page.get_by_role("button", name="OK", exact=True).click(timeout=5000)
    except Exception:
        pass
    if not ok_e:
        return {"e": "error", "cp": cp, "cat": cat, "antes": antes, "m": "envío falló: " + det_e}

    # 3) verificar: buscar de nuevo y leer el precio que quedó en el portal
    ex2 = _exactos_ui(_buscar_ui(page, f["parte"]), kw, f["marca"])
    despues = _num(ex2[0]["inp"].input_value()) if len(ex2) == 1 else None
    if despues is not None and abs(despues - f["precio"]) < 0.005:
        return {"e": "insertado", "cp": cp, "cat": cat, "antes": antes, "despues": despues,
                "verif": "ok", "r": "enviado " + det_e}
    if despues is None:
        return {"e": "insertado", "cp": cp, "cat": cat, "antes": antes, "verif": "no_verificable", "r": det_e}
    return {"e": "precio_no_coincide", "cp": cp, "cat": cat, "antes": antes, "despues": despues, "r": det_e}


def ejecutar_ui(page, filas: list[dict], categoria_id: int, resultados: list, progreso: dict,
                excel, salida: str, dry_run: bool = False) -> list[dict]:
    if "t_ProductoOfertadoAmp" not in page.url:
        raise RuntimeError(f"La pestaña no está en 'Agregar oferta' (url actual: {page.url})")
    progreso.update({"total": len(filas), "procesadas": 0, "insertadas": 0, "verificadas": 0,
                     "sin_cambio": 0, "no_encontradas": 0, "ambiguas": 0, "errores": 0,
                     "enviado": False, "envios": []})
    for f in filas:
        try:
            r = _procesar_ui(page, f, categoria_id, dry_run)
        except Exception as e:
            r = {"e": "error", "m": str(e)[:100]}
        x = _armar(f, r)
        resultados.append(x)
        progreso["procesadas"] += 1
        e = x["estado"]
        if e == "insertado":
            progreso["insertadas"] += 1
            if r.get("verif") == "ok":
                progreso["verificadas"] += 1
        elif e == "ya_tenia_precio":
            progreso["sin_cambio"] += 1
        elif e == "encontrado":
            progreso["insertadas"] += 1
        elif e == "no_encontrado":
            progreso["no_encontradas"] += 1
        elif e == "ambiguo":
            progreso["ambiguas"] += 1
        else:
            progreso["errores"] += 1
        print(f"  fila {f['fila']} {f['parte']} -> {x['resultado']} | {x['detalle']}")
        try:   # el Excel resultado se actualiza producto por producto
            escribir_resultado_excel(excel, resultados, salida, progreso)
        except PermissionError:
            print("    (cierra el Excel resultado para que se pueda actualizar)")
    return resultados
# ======================= Excel de salida =======================
def escribir_resultado_excel(origen, resultados: list[dict], salida=None, progreso: dict | None = None):
    """Copia el Excel original y le agrega columnas de resultado. Si salida es None devuelve bytes."""
    from openpyxl import load_workbook
    from openpyxl.styles import PatternFill

    wb = load_workbook(io.BytesIO(origen) if isinstance(origen, (bytes, bytearray)) else origen)
    ws = wb.active
    cab = [tuple(c.value for c in row) for row in ws.iter_rows(min_row=1, max_row=10)]
    hdr_i, _ = _detectar_cabecera(cab)
    hdr = (hdr_i or 0) + 1
    c0 = ws.max_column + 1

    heads = ["Encontrado", "Resultado", "Precio portal antes", "Precio portal después",
             "Categoría (ID)", "N_CatalogoProducto", "Detalle"]
    for k, h in enumerate(heads):
        cell = ws.cell(row=hdr, column=c0 + k, value=h)
        src = ws.cell(row=hdr, column=c0 - 1)
        cell._style = copy(src._style)
        ws.column_dimensions[cell.column_letter].width = 44 if h in ("Resultado", "Detalle") else 20

    fills = {"ok": PatternFill("solid", fgColor="C6EFCE"),
             "aviso": PatternFill("solid", fgColor="FFEB9C"),
             "mal": PatternFill("solid", fgColor="FFC7CE")}
    for x in resultados:
        if not x.get("fila"):
            continue
        vals = [x["encontrado"], x["resultado"], x["antes"], x["despues"], x["cat"], x["cp"], x["detalle"]]
        for k, v in enumerate(vals):
            cell = ws.cell(row=x["fila"], column=c0 + k, value=v)
            if k in (0, 1):
                cell.fill = fills[x["nivel"]]

    rs = wb.create_sheet("Resumen")
    rs.append(["Concepto", "Valor"])
    for k in ("total", "procesadas", "insertadas", "verificadas", "sin_cambio",
              "no_encontradas", "ambiguas", "errores", "enviado"):
        if progreso and k in progreso:
            rs.append([k, progreso[k]])
    for e in (progreso or {}).get("envios", []):
        rs.append([f"envío categoría {e['categoria']}", ("OK " if e["ok"] else "FALLÓ ") + e["detalle"]])
    rs.column_dimensions["A"].width = 28
    rs.column_dimensions["B"].width = 90

    if salida:
        wb.save(salida)
        return salida
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()



def leer_encontradas(ruta: str) -> set[int]:
    """Lee un Excel de resultado (corrida --dry) y devuelve los números de fila que salieron ENCONTRADO."""
    from openpyxl import load_workbook
    filas = list(load_workbook(ruta, data_only=True, read_only=True).active.iter_rows(values_only=True))
    hdr = col = None
    for i, fila in enumerate(filas[:10]):
        for j, v in enumerate(fila):
            if str(v or "").strip().lower() == "resultado":
                hdr, col = i, j
        if col is not None:
            break
    if col is None:
        raise RuntimeError("No encontré la columna 'Resultado' en " + ruta)
    out = set()
    for n, fila in enumerate(filas[hdr + 1:], start=hdr + 2):
        if col < len(fila) and str(fila[col] or "").upper().startswith("ENCONTRADO"):
            out.add(n)
    return out


# ======================= modo manual (Chrome por CDP) =======================
if __name__ == "__main__":
    import argparse
    import subprocess
    import time
    import urllib.request
    from datetime import datetime
    from playwright.sync_api import sync_playwright

    ap = argparse.ArgumentParser()
    ap.add_argument("excel")
    ap.add_argument("--acuerdo", type=int, default=352)
    ap.add_argument("--catalogo", type=int, default=355)
    ap.add_argument("--categoria", type=int, default=12314)
    ap.add_argument("--desde", type=int, default=0, help="fila de Excel inicial (inclusive)")
    ap.add_argument("--hasta", type=int, default=0, help="fila de Excel final (inclusive)")
    ap.add_argument("--limit", type=int, default=0, help="procesar solo las primeras N filas")
    ap.add_argument("--dry", action="store_true", help="solo buscar, no insertar ni enviar")
    ap.add_argument("--no-enviar", action="store_true", help="insertar pero NO enviar la oferta")
    ap.add_argument("--solo-enviar", action="store_true", help="no procesa filas: solo envía lo ya insertado de la categoría")
    ap.add_argument("--enviar-cada", type=int, default=0, help="enviar la oferta cada N productos (1 = producto por producto)")
    ap.add_argument("--todas-categorias", action="store_true", help="si no está en la categoría dada, probar las demás")
    ap.add_argument("--salida", default="", help="ruta del Excel de resultado")
    ap.add_argument("--ui", action="store_true", help="manejar la pantalla (escribe, busca, pone precio, envía por producto)")
    ap.add_argument("--solo-de", default="", help="Excel de resultado de una corrida --dry: procesa solo las filas ENCONTRADO")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO)

    filas = leer_excel(a.excel)
    if a.desde:
        filas = [f for f in filas if f["fila"] >= a.desde]
    if a.hasta:
        filas = [f for f in filas if f["fila"] <= a.hasta]
    if a.solo_de:
        _ok = leer_encontradas(a.solo_de)
        filas = [f for f in filas if f["fila"] in _ok]
    if a.limit:
        filas = filas[: a.limit]
    print(f"{len(filas)} filas a procesar")

    with sync_playwright() as p:
        chrome = next((c for c in [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        ] if os.path.exists(c)), None)
        if not chrome:
            raise SystemExit("No encontré chrome.exe")
        subprocess.Popen([chrome, "--remote-debugging-port=9222", "--user-data-dir=C:\\chrome_pc",
                          "https://catalogos.perucompras.gob.pe/AccesoGeneral"])
        for _ in range(30):
            try:
                urllib.request.urlopen("http://127.0.0.1:9222/json/version", timeout=1)
                break
            except Exception:
                time.sleep(1)
        else:
            raise SystemExit("Chrome no abrió el puerto 9222 (cierra todos los Chrome y reintenta)")
        input("Inicia sesión, entra a Agregar oferta (la pantalla con 'Iniciar Búsqueda') y presiona ENTER aquí... ")
        browser = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
        page = None
        for _ in range(60):
            todas = [pg for c in browser.contexts for pg in c.pages]
            page = next((pg for pg in todas if "t_ProductoOfertadoAmp" in pg.url), None)
            if page:
                break
            time.sleep(1)
        if page is None:
            raise SystemExit("No hay ninguna pestaña en t_ProductoOfertadoAmp. Pestañas vistas: "
                             + ", ".join(pg.url for pg in todas))
        print("Pestaña de trabajo:", page.url, "| prueba evaluate:", page.evaluate("1 + 1"))
        if a.solo_enviar:
            r = page.evaluate(_JS_ENVIA, [URL_ENVIA, str(a.catalogo), str(a.categoria)])
            print("ENVÍO ->", r["status"], r["text"])
            browser.close()
            raise SystemExit(0)

        progreso: dict = {}
        res: list = []
        try:
            if a.ui:
                salida_live = a.salida or os.path.splitext(a.excel)[0] + "_resultado.xlsx"
                ejecutar_ui(page, filas, a.categoria, res, progreso, a.excel, salida_live, dry_run=a.dry)
            else:
                ejecutar_ofertas(None, progreso, filas, a.acuerdo, a.catalogo, a.categoria,
                                 enviar=not a.no_enviar, dry_run=a.dry, pagina=page,
                                 todas_categorias=a.todas_categorias, resultados=res,
                                 enviar_cada=a.enviar_cada)
        finally:
            print({k: v for k, v in progreso.items() if k != "envios"})
            for r in [x for x in res if x["nivel"] == "mal"][:10]:
                print("  ->", r["fila"], r["nro_parte"], r["resultado"], r["detalle"])
            if res:
                salida = a.salida or os.path.splitext(a.excel)[0] + "_resultado.xlsx"
                try:
                    escribir_resultado_excel(a.excel, res, salida, progreso)
                except PermissionError:
                    salida = os.path.splitext(salida)[0] + datetime.now().strftime("_%H%M%S") + ".xlsx"
                    escribir_resultado_excel(a.excel, res, salida, progreso)
                print("Resultado guardado en:", salida)
            browser.close()   # solo se desconecta, no cierra Chrome