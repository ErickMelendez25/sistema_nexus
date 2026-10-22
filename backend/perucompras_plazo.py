"""
Helbot - perucompras_plazo.py (versión Playwright)
Acuerdo -> Catálogo -> Categoría -> Región -> Provincia -> Iniciar Búsqueda
-> plazo=1 en la primera fila + "Aplicar a todos" (verificando todas las
páginas) -> Enviar -> confirmar "Si".
"""
import os
import re
import logging

from perucompras_pw import (
    BASE_URL, PWTimeout, abrir_pagina, ir_a, esperar_ajax, select2_listar, select2_seleccionar,
    opciones_select, drenar_modales, sesion_caida, captura,
)

logger = logging.getLogger("helbot.perucompras_plazo")

URL_PLAZO = "/MejoraPlazo/IndexMejora"
ACUERDOS_MARCO: dict = {}  # compatibilidad: ya no se usa
RE_ERROR = re.compile(r"error|no se pudo|no es v[aá]lid|inv[aá]lid|incorrect|fall", re.I)

_CACHE_ARBOL: dict[str, list] = {}   # usuario real -> árbol acuerdo/catálogo/categoría
_CACHE_GEO: dict[tuple, list] = {}

_JS_FILAS = r"""() => [...document.querySelectorAll('#tbData tr.FilaDatos')].map(tr => {
  const td = tr.querySelectorAll('td'); const i = tr.querySelector('input.PlazoEntrega');
  return {vig: td[6] ? td[6].innerText.trim() : '', val: i ? i.value : ''};
})"""


# ---------------- navegación ----------------
def _preparar(page, acuerdo_id, catalogo=None, categoria=None):
    ir_a(page, URL_PLAZO)
    page.wait_for_selector("#cboAcuerdo", state="attached")
    select2_seleccionar(page, "cboAcuerdo", acuerdo_id)
    esperar_ajax(page)
    if catalogo:
        page.select_option("#cboCatalogo", str(catalogo))
        esperar_ajax(page)
    if categoria:
        page.select_option("#cboCategoria", str(categoria))
        esperar_ajax(page)


def _escanear_arbol(page) -> list[dict]:
    ir_a(page, URL_PLAZO)
    page.wait_for_selector("#cboAcuerdo", state="attached")
    arbol = []
    for ac in select2_listar(page, "cboAcuerdo"):
        select2_seleccionar(page, "cboAcuerdo", ac["dato_id"])
        esperar_ajax(page)
        nodo = {"acuerdo_id": ac["dato_id"], "acuerdo": ac["texto"], "catalogos": []}
        for cat in opciones_select(page, "cboCatalogo"):
            page.select_option("#cboCatalogo", cat["value"])
            esperar_ajax(page)
            cats = opciones_select(page, "cboCategoria")
            nodo["catalogos"].append({
                "id": cat["value"], "nombre": cat["texto"],
                "categorias": [{"id": c["value"], "nombre": c["texto"]} for c in cats],
            })
        arbol.append(nodo)
    return arbol


def _obtener_arbol(pc_session, page=None, refrescar=False) -> list[dict]:
    clave = (pc_session.usuario or "").lower()
    if not refrescar and clave in _CACHE_ARBOL:
        return _CACHE_ARBOL[clave]
    if page is not None:
        arbol = _escanear_arbol(page)
    else:
        with abrir_pagina(pc_session) as (pg, _d):
            arbol = _escanear_arbol(pg)
    if not arbol:
        raise RuntimeError("Este usuario no tiene acuerdos disponibles en Plazo de entrega máximo.")
    _CACHE_ARBOL[clave] = arbol
    return arbol


def _nodo(arbol, acuerdo_nombre):
    for a in arbol:
        if a["acuerdo"] == acuerdo_nombre:
            return a
    raise RuntimeError(f"Acuerdo no reconocido para este usuario: {acuerdo_nombre}")


# ---------------- API para el router ----------------
def listar_opciones(pc_session, refrescar: bool = False) -> list[dict]:
    """Mismo formato que antes (familia = id de catálogo) -> el frontend casi no cambia."""
    out = []
    for ac in _obtener_arbol(pc_session, refrescar=refrescar):
        cats = []
        for ct in ac["catalogos"]:
            for ca in ct["categorias"]:
                cats.append({"familia": int(ct["id"]), "categoria": int(ca["id"]), "nombre": ca["nombre"]})
        out.append({"acuerdo": ac["acuerdo"], "categorias": cats})
    return out


def obtener_departamentos(pc_session, acuerdo: str, familia: int, categoria: int) -> list[dict]:
    clave = ("dep", (pc_session.usuario or "").lower(), acuerdo, int(familia), int(categoria))
    if clave in _CACHE_GEO:
        return _CACHE_GEO[clave]
    ac = _nodo(_obtener_arbol(pc_session), acuerdo)
    with abrir_pagina(pc_session) as (page, _d):
        _preparar(page, ac["acuerdo_id"], familia, categoria)
        regs = opciones_select(page, "cboRegion")
    res = [{"codigo": r["value"], "nombre": r["texto"]} for r in regs]
    if res:
        _CACHE_GEO[clave] = res
    return res


def obtener_provincias(pc_session, acuerdo: str, familia: int, categoria: int, dep_codigo: str) -> list[dict]:
    clave = ("prov", (pc_session.usuario or "").lower(), dep_codigo)
    if clave in _CACHE_GEO:
        return _CACHE_GEO[clave]
    ac = _nodo(_obtener_arbol(pc_session), acuerdo)
    with abrir_pagina(pc_session) as (page, _d):
        _preparar(page, ac["acuerdo_id"], familia, categoria)
        page.select_option("#cboRegion", dep_codigo)
        esperar_ajax(page)
        provs = opciones_select(page, "cboProvincia")
    res = [{"codigo": p["value"], "nombre": p["texto"]} for p in provs]
    if res:
        _CACHE_GEO[clave] = res
    return res


def _num_plazo(t) -> int | None:
    m = re.search(r"\d+", t or "")
    return int(m.group()) if m else None


# ---------------- paginación de resultados ----------------
def _info(page) -> str:
    loc = page.locator("#divNumRegistrosPorPagina")
    return loc.first.inner_text() if loc.count() else ""


def _clic_y_esperar(page, loc):
    antes = _info(page)
    loc.click()
    try:
        page.wait_for_function(
            "t => ((document.querySelector('#divNumRegistrosPorPagina')||{}).innerText||'') !== t",
            arg=antes, timeout=8000,
        )
    except PWTimeout:
        pass
    page.wait_for_timeout(150)


def _primera_pagina(page):
    for _ in range(100):
        activo = page.locator("#divPaginacion input.NavegaActivo")
        if activo.count() and activo.first.get_attribute("value") == "1":
            return
        uno = page.locator("#divPaginacion input[value='1']")
        if uno.count():
            _clic_y_esperar(page, uno.first)
            continue
        ant = page.locator("#divPaginacion input[value='Anterior']")
        if ant.count() == 0 or ant.first.is_disabled():
            return
        _clic_y_esperar(page, ant.first)


def _siguiente(page) -> bool:
    sig = page.locator("#divPaginacion input[value='Siguiente']")
    if sig.count() == 0 or sig.first.is_disabled():
        return False
    antes = _info(page)
    _clic_y_esperar(page, sig.first)
    return _info(page) != antes


def _leer_todas(page) -> list[dict]:
    _primera_pagina(page)
    filas: list[dict] = []
    for _ in range(500):
        filas += page.evaluate(_JS_FILAS)
        if not _siguiente(page):
            break
    return filas


def _asegurar_todas(page) -> int:
    """Recorre TODAS las páginas y deja cada 'Plazo a publicar' en 1."""
    arregladas = 0
    _primera_pagina(page)
    for _ in range(500):
        inputs = page.locator("#tbData input.PlazoEntrega")
        for k in range(inputs.count()):
            inp = inputs.nth(k)
            if inp.input_value().strip() != "1":
                inp.fill("1")
                inp.blur()
                arregladas += 1
        if not _siguiente(page):
            break
    return arregladas




# ---------------- modo directo (fetch) ----------------
TURBO_URL_C = BASE_URL + "/MejoraPlazo/consultaMejoraPlazoEntrega"
TURBO_URL_M = BASE_URL + "/MejoraPlazo/modificarMejoraPlazoEntrega"
TOKEN_P = "@@P@@"
CONC = max(1, min(8, int(os.getenv("PLAZO_CONC", "4"))))   # peticiones simultáneas por región

_JS_LOTE = r"""async ([urlC, urlM, tpl, token, provs, firmaVacia, puedeEnviar, conc]) => {
  const H = {'content-type': 'text/plain;charset=UTF-8'};
  const out = new Array(provs.length);
  let i = 0;
  async function uno(v) {
    try {
      const rc = await fetch(urlC, {method: 'POST', headers: H, body: tpl.split(token).join(v), credentials: 'include'});
      if (rc.status !== 200) return {e: 'pendiente', m: 'consulta HTTP ' + rc.status};
      const t = await rc.text();
      if (t.indexOf('Nro^Imagen') < 0) {
        if (firmaVacia !== null && t.trim() === firmaVacia) return {e: 'sin', n: 0};
        return {e: 'pendiente', m: 'respuesta no reconocida'};
      }
      const partes = t.split('¯');
      if (partes.length < 2) return {e: 'pendiente', m: 'formato inesperado'};
      const filas = partes[1].split('¬').filter(x => x.trim() !== '');
      if (filas.length === 0) return {e: 'sin', n: 0};
      const ids = [];
      let todas1 = true;
      for (const f of filas) {
        const c = f.split('^');
        if (c.length < 10 || !c[0].endsWith('-' + v)) return {e: 'pendiente', m: 'fila inesperada'};
        ids.push(c[0]);
        if (parseInt(c[6], 10) !== 1) todas1 = false;
      }
      if (todas1) return {e: 'igual', n: ids.length};
      if (!puedeEnviar) return {e: 'pendiente', m: 'formato de envío aún sin validar'};
      const body = ids.map(x => x + '^1^^').join('¬');
      const rm = await fetch(urlM, {method: 'POST', headers: H, body: body, credentials: 'include'});
      const tm = (await rm.text()).trim();
      if (rm.status === 200 && tm === 'OK') return {e: 'enviado', n: ids.length};
      return {e: 'pendiente', m: 'envío respondió ' + rm.status + ': ' + tm.slice(0, 60)};
    } catch (err) {
      return {e: 'pendiente', m: 'excepción: ' + String(err).slice(0, 60)};
    }
  }
  async function w() {
    while (true) {
      const k = i++;
      if (k >= provs.length) return;
      out[k] = await uno(provs[k]);
    }
  }
  await Promise.all(Array.from({length: Math.min(conc, provs.length)}, w));
  return out;
}"""


class _Turbo:
    def __init__(self):
        self.activo = os.getenv("PLAZO_TURBO", "1") != "0"   # PLAZO_TURBO=0 lo apaga
        self.tpl = None            # plantilla de consulta de la región actual
        self.firma_vacia = None    # respuesta real de "sin fichas"
        self.mod_validado = False  # el cuerpo de envío coincidió con el del navegador


def _cuerpo_modificar(texto: str, pv_value: str):
    partes = texto.split("¯")
    if len(partes) < 2:
        return None
    ids = []
    for f in partes[1].split("¬"):
        if not f.strip():
            continue
        c = f.split("^")
        if len(c) < 10 or not c[0].endswith("-" + pv_value):
            return None
        ids.append(c[0])
    return "¬".join(f"{i}^1^^" for i in ids) if ids else None


def _turbo_aprender(turbo, cap: dict, pv_value: str, msg: str) -> bool:
    """Tras una provincia hecha por navegador: aprende la plantilla de la región y valida el envío."""
    try:
        post = cap.get("c_post") or ""
        if not post.endswith("^" + pv_value):
            return False
        turbo.tpl = post[: -len(pv_value)] + TOKEN_P
        texto = cap.get("c_text") or ""
        if "Nro^Imagen" not in texto:
            if msg.startswith("Sin fichas") and turbo.firma_vacia is None and len(texto.strip()) < 600:
                turbo.firma_vacia = texto.strip()
            return True
        m_post = cap.get("m_post")
        if m_post and not turbo.mod_validado:
            if _cuerpo_modificar(texto, pv_value) == m_post:
                turbo.mod_validado = True
            else:
                turbo.activo = False
                logger.warning("TURBO plazo desactivado: el cuerpo de envío armado no coincide con el del navegador")
                return False
        return True
    except Exception as e:
        logger.warning(f"TURBO plazo: no se pudo aprender la plantilla: {e}")
        return False


def _lote_directo(page, turbo, valores: list) -> list:
    return page.evaluate(
        _JS_LOTE,
        [TURBO_URL_C, TURBO_URL_M, turbo.tpl, TOKEN_P, valores, turbo.firma_vacia, turbo.mod_validado, CONC],
    )


# ---------------- una provincia ----------------
def _buscar_y_enviar(page, dialogos, cap: dict | None = None) -> tuple[bool, int, str]:
    page.evaluate("() => { const t=document.getElementById('tbData'); if (t) t.innerHTML=''; }")
    try:
        with page.expect_response(lambda r: "consultaMejoraPlazoEntrega" in r.url, timeout=45000) as _ir:
            page.get_by_text("Iniciar Búsqueda").first.click()
        if cap is not None:
            try:
                cap["c_post"] = _ir.value.request.post_data or ""
                cap["c_text"] = _ir.value.text()
            except Exception:
                pass
    except PWTimeout:
        logger.warning("La búsqueda no disparó consultaMejoraPlazoEntrega en 45s")
    esperar_ajax(page, 500)

    # Esperar a que aparezcan inputs de plazo O el mensaje "No se encontraron fichas"
    try:
        page.wait_for_function(
            "() => document.querySelector('#tbData input.PlazoEntrega') || "
            "/No se encontraron fichas/i.test((document.getElementById('tbData')||{}).innerText||'')",
            timeout=10000,
        )
    except PWTimeout:
        pass

    if (page.locator("#tbData input.PlazoEntrega").count() == 0
            or page.locator("#tbData tr.FilaDatos", has_text="No se encontraron fichas").count() > 0):
        return True, 0, "Sin fichas en esta provincia"

    # Total de registros de la provincia, leído del texto "Mostrando 1 a 10 de 49 Registros"
    m_total = re.search(r"de\s+(\d+)", _info(page))
    pendientes = int(m_total.group(1)) if m_total else page.locator("#tbData tr.FilaDatos").count()

    # Salto rápido SOLO si la provincia cabe en una página y todas ya tienen plazo 1
    # (no recorre páginas: mira únicamente lo que ya está en pantalla)
    sig = page.locator("#divPaginacion input[value='Siguiente']")
    una_sola_pagina = sig.count() == 0 or sig.first.is_disabled()
    if una_sola_pagina:
        vigentes = page.evaluate(_JS_FILAS)
        if vigentes and all(_num_plazo(f["vig"]) == 1 for f in vigentes):
            return True, 0, f"Sin cambios: las {len(vigentes)} fichas ya tienen plazo 1"

    # 1) Poner 1 en la primera fila de la primera página
    primero = page.locator("#tbData input.PlazoEntrega").first
    primero.click()
    primero.fill("1")
    primero.blur()

    # 2) "Aplicar a todos" (el portal lo copia a todas las filas de todas las páginas)
    page.locator("#tbData input[onclick*='replicarValor(this,1)']").first.click()
    page.wait_for_timeout(500)

    # 3) Revisión rápida SOLO de la página actual (no recorre páginas)
    sin_uno = page.evaluate(
        "() => [...document.querySelectorAll('#tbData input.PlazoEntrega')].filter(i => i.value.trim() !== '1').length"
    )
    if sin_uno:
        return False, 0, f"'Aplicar a todos' no puso 1 en {sin_uno} filas de la página"

    del dialogos[:]
    page.click("#btnEnviarDatos")
    ok_btn = page.locator("._wModal_btn_ok:visible").first
    ok_btn.wait_for(state="visible", timeout=15000)
    try:
        with page.expect_request(lambda r: "modificarMejoraPlazoEntrega" in r.url, timeout=15000) as _rq:
            ok_btn.click()
        if cap is not None:
            cap["m_post"] = _rq.value.post_data or ""
    except PWTimeout:
        pass
    page.wait_for_timeout(1000)
    esperar_ajax(page, 300)
    msgs = drenar_modales(page) + list(dialogos)
    errores = [m for m in msgs if RE_ERROR.search(m)]
    if errores:
        return False, 0, f"Portal respondió: {errores[0][:120]}"
    msg = f"{pendientes} fichas enviadas"
    if msgs:
        msg += f" · portal: {msgs[-1][:80]}"
    return True, pendientes, msg


# ---------------- ejecución principal ----------------
def ejecutar_modificacion_plazo(pc_session, progreso: dict, seleccion: dict | None = None) -> list[dict]:
    sel = seleccion or {}
    acuerdos_ok = set(sel.get("acuerdos") or [])
    cats_ok = {(int(c[0]), int(c[1])) for c in (sel.get("categorias") or [])}
    dep_f = sel.get("departamento_codigo") or None
    prov_f = sel.get("provincia_codigo") or None
    resultados: list[dict] = []
    turbo = _Turbo()

    progreso.update({
        "combinacion_actual": "Abriendo navegador...", "combinaciones_completadas": 0,
        "total_combinaciones": 0, "fichas_modificadas": 0, "combos_con_error": 0,
    })

    with abrir_pagina(pc_session) as (page, dialogos):
        arbol = _obtener_arbol(pc_session, page=page)
        combos = []
        for ac in arbol:
            if acuerdos_ok and ac["acuerdo"] not in acuerdos_ok:
                continue
            for ct in ac["catalogos"]:
                for ca in ct["categorias"]:
                    if cats_ok and (int(ct["id"]), int(ca["id"])) not in cats_ok:
                        continue
                    combos.append((ac, ct, ca))
        if not combos:
            raise RuntimeError("Ninguna categoría seleccionada existe para este usuario.")

        progreso["categorias"] = [
            {"categoria": ca["nombre"], "acuerdo": ac["acuerdo"], "estado": "pendiente",
             "provincias": 0, "con_error": 0, "fichas": 0, "sin_fichas": 0, "sin_cambios": 0}
            for ac, ct, ca in combos
        ]
        actual = [None]

        def cerrar_actual():
            c = actual[0]
            if c and c["estado"] == "en_curso":
                c["estado"] = "con_errores" if c["con_error"] else "terminada"

        def registrar(nombre, dep, prov, ok, n, msg):
            resultados.append({"categoria": nombre, "departamento": dep, "provincia": prov,
                               "fichas_modificadas": n, "ok": ok, "mensaje": msg})
            progreso["combinaciones_completadas"] += 1
            progreso["fichas_modificadas"] += n
            c = actual[0]
            if c:
                c["provincias"] += 1
                c["fichas"] += n
                if ok and n == 0 and msg.startswith("Sin fichas"):
                    c["sin_fichas"] += 1
                if ok and n == 0 and msg.startswith("Sin cambios"):
                    c["sin_cambios"] += 1
            if not ok:
                progreso["combos_con_error"] += 1
                if c:
                    c["con_error"] += 1

        for idx, (ac, ct, ca) in enumerate(combos):
            cerrar_actual()
            actual[0] = progreso["categorias"][idx]
            actual[0]["estado"] = "en_curso"
            nombre = ca["nombre"]

            def preparar():
                _preparar(page, ac["acuerdo_id"], ct["id"], ca["id"])

            try:
                preparar()
                regiones = opciones_select(page, "cboRegion")
            except Exception as e:
                if sesion_caida(page):
                    raise
                captura(page, f"plazo_cat_{ca['id']}")
                progreso["total_combinaciones"] += 1
                registrar(nombre, "-", "-", False, 0, f"No se pudo preparar la categoría: {str(e)[:100]}")
                continue
            if dep_f:
                regiones = [r for r in regiones if r["value"] == dep_f]

            sucio = False
            for reg in regiones:
                try:
                    if sucio:
                        preparar()
                        sucio = False
                    page.select_option("#cboRegion", reg["value"])
                    esperar_ajax(page)
                    provs = opciones_select(page, "cboProvincia")
                    if not provs:
                        page.wait_for_timeout(1000)
                        provs = opciones_select(page, "cboProvincia")
                except Exception as e:
                    if sesion_caida(page):
                        raise
                    sucio = True
                    progreso["total_combinaciones"] += 1
                    registrar(nombre, reg["texto"], "-", False, 0, f"Error leyendo provincias: {str(e)[:100]}")
                    continue
                if prov_f:
                    provs = [p for p in provs if p["value"] == prov_f]
                progreso["total_combinaciones"] += len(provs)

                pendientes = list(provs)
                region_ok = False
                lotes = 0
                turbo.tpl = None
                while pendientes:
                    # ---- modo directo: resuelve en bloque las provincias restantes de la región ----
                    if turbo.activo and region_ok and lotes < 2:
                        lotes += 1
                        progreso["combinacion_actual"] = f"{nombre} · {reg['texto']} (modo directo)"
                        try:
                            res = _lote_directo(page, turbo, [p["value"] for p in pendientes])
                        except Exception as e:
                            if sesion_caida(page):
                                raise RuntimeError("La sesión de Perú Compras se cayó durante el plazo")
                            logger.warning(f"TURBO plazo: lote falló, sigue por navegador: {e}")
                            res = [{"e": "pendiente"}] * len(pendientes)
                        resto = []
                        for p_, r_ in zip(pendientes, res):
                            if r_["e"] == "sin":
                                registrar(nombre, reg["texto"], p_["texto"], True, 0,
                                          "Sin fichas en esta provincia (directo)")
                            elif r_["e"] == "igual":
                                registrar(nombre, reg["texto"], p_["texto"], True, 0,
                                          f"Sin cambios: las {r_['n']} fichas ya tienen plazo 1 (directo)")
                            elif r_["e"] == "enviado":
                                registrar(nombre, reg["texto"], p_["texto"], True, r_["n"],
                                          f"{r_['n']} fichas enviadas (directo)")
                            else:
                                if r_.get("m"):
                                    logger.info(f"TURBO plazo: {p_['texto']} va por navegador ({r_['m']})")
                                resto.append(p_)
                        pendientes = resto
                        region_ok = False
                        continue

                    # ---- navegador (como siempre) ----
                    pv = pendientes.pop(0)
                    progreso["combinacion_actual"] = f"{nombre} · {reg['texto']} / {pv['texto']}"
                    cap = {}
                    try:
                        if sucio:
                            preparar()
                            page.select_option("#cboRegion", reg["value"])
                            esperar_ajax(page)
                            sucio = False
                        page.select_option("#cboProvincia", pv["value"])
                        ok, n, msg = _buscar_y_enviar(page, dialogos, cap)
                    except Exception as e:
                        if sesion_caida(page):
                            raise RuntimeError("La sesión de Perú Compras se cayó durante el plazo")
                        captura(page, f"plazo_{ca['id']}_{pv['value']}")
                        sucio = True
                        ok, n, msg = False, 0, f"Excepción: {str(e)[:120]}"
                        cap = {}
                    region_ok = bool(ok and turbo.activo and _turbo_aprender(turbo, cap, pv["value"], msg))
                    registrar(nombre, reg["texto"], pv["texto"], ok, n, msg)

        cerrar_actual()

    if progreso["total_combinaciones"] == 0:
        raise RuntimeError("No se armó ninguna combinación categoría/región/provincia.")
    return resultados