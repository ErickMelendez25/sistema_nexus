"""
Helbot - perucompras_pw.py
Utilidades Playwright compartidas por stock y plazo.
Usa las cookies de la sesión ya logueada (Selenium) y maneja el
navegador como una persona.
"""
import os
import re
import sys
import time
import asyncio
import logging
import threading
import contextlib

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout  # noqa: F401

logger = logging.getLogger("helbot.perucompras_pw")

BASE_URL = "https://catalogos.perucompras.gob.pe"
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)
HEADLESS = os.getenv("PW_HEADLESS", "1") != "0"

_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def _lock_de(clave: str) -> threading.Lock:
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(clave, threading.Lock())


def _cookies_para_playwright(pc_session) -> list[dict]:
    out = []
    for c in pc_session.session.cookies:
        if c.value is None:
            continue
        out.append({
            "name": c.name,
            "value": c.value,
            "domain": c.domain or "catalogos.perucompras.gob.pe",
            "path": c.path or "/",
            "secure": bool(c.secure),
        })
    return out


@contextlib.contextmanager
def reservar_usuario(pc_session):
    """Reserva al usuario UNA vez para una operación con varios navegadores en paralelo.
    Los workers deben abrir con abrir_pagina(pc_session, usar_lock=False)."""
    if pc_session is None or pc_session.session is None or not pc_session.autenticado:
        raise RuntimeError("No hay sesión activa de Perú Compras para este usuario")
    lock = _lock_de(pc_session.usuario or "?")
    if not lock.acquire(blocking=False):
        raise RuntimeError("Ya hay otra operación con navegador en curso para este usuario; espera a que termine.")
    pc_session.trabajo_activo.set()
    try:
        yield
    finally:
        pc_session.trabajo_activo.clear()
        lock.release()


@contextlib.contextmanager
def abrir_pagina(pc_session, usar_lock: bool = True):
    """Context manager -> (page, dialogos). Un solo navegador por usuario a la vez
    (salvo usar_lock=False, que se usa SOLO dentro de reservar_usuario)."""
    if pc_session is None or pc_session.session is None or not pc_session.autenticado:
        raise RuntimeError("No hay sesión activa de Perú Compras para este usuario")
    lock = None
    if usar_lock:
        lock = _lock_de(pc_session.usuario or "?")
        if not lock.acquire(blocking=False):
            raise RuntimeError("Ya hay otra operación con navegador en curso para este usuario; espera a que termine.")

    # uvicorn --reload en Windows fuerza el loop Selector, que no permite
    # lanzar subprocesos (Playwright). Se fuerza Proactor para loops NUEVOS.
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

    pc_session.trabajo_activo.set()  # el keep-alive no hace ping mientras trabajamos
    pw = None
    browser = None
    try:
        pw = sync_playwright().start()
        browser = pw.chromium.launch(
            headless=HEADLESS,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        ctx = browser.new_context(user_agent=UA, viewport={"width": 1400, "height": 900}, locale="es-PE")
        ctx.add_cookies(_cookies_para_playwright(pc_session))
        ctx.set_default_timeout(30000)
        page = ctx.new_page()
        dialogos: list[str] = []

        def _dlg(d):
            dialogos.append(d.message)
            try:
                d.accept()
            except Exception:
                pass

        page.on("dialog", _dlg)
        yield page, dialogos
    finally:
        try:
            if browser:
                browser.close()
        except Exception:
            pass
        try:
            if pw:
                pw.stop()
        except Exception:
            pass
        if lock is not None:
            pc_session.trabajo_activo.clear()
            lock.release()


def sesion_caida(page) -> bool:
    u = (page.url or "").lower()
    return "login" in u or "accesogeneral" in u


def ir_a(page, path: str):
    page.goto(BASE_URL + path, wait_until="domcontentloaded")
    if sesion_caida(page):
        raise RuntimeError(f"Perú Compras redirigió a login ({page.url}): la sesión no sirvió en el navegador")


def esperar_ajax(page, ms: int = 400):
    page.wait_for_timeout(ms)
    try:
        page.wait_for_load_state("networkidle", timeout=4000)
    except PWTimeout:
        pass


def captura(page, nombre: str):
    try:
        os.makedirs("debug_pw", exist_ok=True)
        limpio = re.sub(r"[^A-Za-z0-9_-]", "_", nombre)[:60]
        page.screenshot(path=f"debug_pw/{limpio}_{int(time.time())}.png", full_page=True)
    except Exception:
        pass


# ---------------- select2 ----------------
# Se trabaja contra el <select> nativo (los <option> reales) y se dispara
# 'change'; select2 solo es la "cara" visual. Así no dependemos del clic
# sobre el dropdown, que fallaba cuando el portal reinicializa el widget.
_JS_S2_HAY_OPCIONES = r"""id => [...document.querySelectorAll('#'+id+' option')]
  .some(o => o.value && o.value !== '0')"""
_JS_S2_OPCIONES = r"""id => [...document.querySelectorAll('#'+id+' option')]
  .map(o => ({value:o.value, texto:o.textContent.trim().replace(/\s+/g,' ')}))
  .filter(o => o.value && o.value !== '0' && !/^Seleccione/i.test(o.texto))"""
_JS_S2_TEXTO = r"""id => { const c=document.getElementById('select2-'+id+'-container'); return c ? c.textContent.trim().replace(/\s+/g,' ') : ''; }"""
_JS_S2_SET_NATIVO = r"""([id, v]) => {
  const el = document.getElementById(id);
  if (!el) return false;
  el.value = v;
  if (el.value !== v) return false;
  el.dispatchEvent(new Event('change', {bubbles: true}));
  return true;
}"""
_JS_S2_FORZAR = r"""([id, v]) => { jQuery('#'+id).val(v).trigger('change'); }"""


def _s2_confirmado(page, sel_id: str, texto: str, espera_ms: int = 3000) -> bool:
    esperado = re.sub(r"\s+", " ", texto).strip()
    fin = time.time() + espera_ms / 1000
    while time.time() < fin:
        if page.evaluate(_JS_S2_TEXTO, sel_id) == esperado:
            return True
        page.wait_for_timeout(200)
    return False


def select2_listar(page, sel_id: str, cerrar: bool = True) -> list[dict]:
    """Lee las opciones del <select> nativo. (cerrar se mantiene por compatibilidad)."""
    page.wait_for_function(_JS_S2_HAY_OPCIONES, arg=sel_id, timeout=20000)
    return [
        {"texto": o["texto"], "dato_id": o["value"], "rid": ""}
        for o in page.evaluate(_JS_S2_OPCIONES, sel_id)
    ]


def select2_seleccionar(page, sel_id: str, dato_id: str):
    items = select2_listar(page, sel_id)
    it = next((x for x in items if x["dato_id"] == dato_id), None)
    if not it:
        raise RuntimeError(f"No se encontró la opción {dato_id} en {sel_id}")
    for _ in range(3):
        # 1) set directo en el <select> + evento change nativo
        if page.evaluate(_JS_S2_SET_NATIVO, [sel_id, dato_id]) and _s2_confirmado(page, sel_id, it["texto"]):
            return
        # 2) plan B: API de jQuery/select2
        try:
            page.evaluate(_JS_S2_FORZAR, [sel_id, dato_id])
        except Exception:
            pass
        if _s2_confirmado(page, sel_id, it["texto"]):
            return
        page.wait_for_timeout(500)
    raise RuntimeError(f"No se pudo seleccionar '{it['texto']}' en {sel_id}")


# ---------------- <select> normal ----------------
_JS_OPTS = r"""id => [...document.querySelectorAll('#'+id+' option')]
  .map(o => ({value:o.value, texto:o.textContent.trim().replace(/\s+/g,' ')}))
  .filter(o => o.value && o.value!=='0')"""


def opciones_select(page, sel_id: str, espera_ms: int = 8000) -> list[dict]:
    try:
        page.wait_for_function(
            "id => document.querySelectorAll('#'+id+' option').length > 1", arg=sel_id, timeout=espera_ms
        )
    except PWTimeout:
        return []
    return page.evaluate(_JS_OPTS, sel_id)


# ---------------- modales de confirmación ----------------
def drenar_modales(page, max_s: int = 12) -> list[str]:
    """Lee y cierra modales de resultado. NUNCA hace clic en un modal
    '¿Está seguro...?' (evita doble envío). Devuelve los mensajes leídos."""
    msgs: list[str] = []
    fin = time.time() + max_s
    while time.time() < fin:
        vis = page.locator("._wModal_msg:visible")
        if vis.count() == 0:
            break
        try:
            txt = vis.first.inner_text().strip()
        except Exception:
            break
        if "está seguro" in txt.lower() or "esta seguro" in txt.lower():
            page.wait_for_timeout(500)
            continue
        msgs.append(txt)
        try:
            page.locator("._wModal_btn_ok:visible, ._wModal_btn_cancel:visible").first.click(timeout=3000)
        except Exception:
            break
        page.wait_for_timeout(500)
    return msgs