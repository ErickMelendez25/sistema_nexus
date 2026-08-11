"""
Helbot - perucompras_login.py
------------------------------
Login y sesión persistente a Peru Compras. Es la MISMA lógica de login que
usas en rapifich_api.py (Selenium, con o sin login_perucompras.py de OCR de
captcha, fallback manual, y conversión de cookies del driver a una
requests.Session). Se le agregó:

  - Clase PeruComprasSession para encapsular el estado (antes vivía en el
    objeto global `estado` de rapifich_api.py).
  - Keep-alive automático cada KEEPALIVE_INTERVAL segundos, con re-login
    si el ping falla (idéntico patrón a _keepalive_loop / _relogin_sincronizado).
  - buscar_publicadas(): TODO — pega aquí el endpoint real del módulo de
    "Publicadas" (acuerdo marco / catálogo / categoría / estado) una vez
    que lo tengas mapeado; la sesión ya autenticada queda lista para usarlo.

Uso:
    from perucompras_login import perucompras_session
    perucompras_session.login("multilimp.01", "Fabr.2025")
    # ... luego, en cualquier parte:
    if perucompras_session.autenticado:
        r = perucompras_session.session.get(...)
"""

import os
import time
import threading
import logging
from typing import Optional

import requests
import platform
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

logger = logging.getLogger("helbot.perucompras_login")
logging.basicConfig(level=logging.INFO)

try:
    from webdriver_manager.chrome import ChromeDriverManager
    USE_WDM = True
except ImportError:
    USE_WDM = False

# Si ya tienes tu módulo de login con OCR de captcha (el mismo que usa
# rapifich_api.py), Helbot lo reutiliza automáticamente si está en el path.
try:
    from login_perucompras import intentar_login_con_ocr
    from acciones_post_login import cerrar_ventanas_emergentes
    USE_LOGIN_MODULE = True
except ImportError as e:
    logger.warning(f"⚠️ No se pudo importar login_perucompras — usando fallback con selectores INCORRECTOS. Motivo: {e}")
    USE_LOGIN_MODULE = False

# ============================================================
# CONFIG
# ============================================================
BASE_URL = "https://www.catalogos.perucompras.gob.pe"
LOGIN_URL = BASE_URL + "/"
KEEPALIVE_INTERVAL = 90  # segundos
LOGIN_TIMEOUT_SEGUNDOS = 90  # si un login sigue "cargando" más de esto, se fuerza el cierre


def _limpiar_chrome_de(usuario: str):
    """Best-effort: mata procesos Chrome huérfanos y limpia el perfil
    bloqueado de este usuario. No truena si login_perucompras.py (con
    OCR) no está disponible — en ese caso simplemente no hace nada."""
    try:
        from login_perucompras import _matar_procesos_chrome_huerfanos, _limpiar_perfil_bloqueado
        _matar_procesos_chrome_huerfanos(usuario)
        _limpiar_perfil_bloqueado(usuario)
    except Exception as e:
        logger.warning(f"No se pudo limpiar Chrome huérfano de '{usuario}': {e}")

# ============================================================
# Driver / login (idéntico a rapifich_api.py)
# ============================================================
def _crear_driver(headless: bool = False):
    import platform
    opts = Options()
    if platform.system() != "Windows":
        # En Linux (producción/Docker) usamos headless=new real, que ya
        # confirmamos que funciona de forma estable en el contenedor —
        # el truco de ventana invisible con Xvfb es más frágil ahí.
        opts.add_argument("--headless=new")
    elif headless:
        opts.add_argument("--headless=new")
    opts.add_argument("--window-position=-32000,-32000")  # invisible, fuera de pantalla (solo aplica si no es headless)
    opts.add_argument("--window-size=1200,900")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    opts.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
    )
    if USE_WDM:
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=opts)
    else:
        driver = webdriver.Chrome(options=opts)
    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {"source": "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"},
    )
    return driver


def _login_fallback(usuario: str, password: str, log_fn=None):
    def log(tag, msg):
        if log_fn:
            log_fn(tag, msg)
        else:
            logger.info(f"[{tag}] {msg}")

    try:
        driver = _crear_driver(headless=False)
        driver.get(LOGIN_URL)
        wait = WebDriverWait(driver, 30)
        campo_user = wait.until(EC.presence_of_element_located((By.ID, "UserName")))
        campo_user.clear()
        campo_user.send_keys(usuario)
        campo_pass = driver.find_element(By.ID, "Password")
        campo_pass.clear()
        campo_pass.send_keys(password)
        try:
            driver.find_element(By.ID, "CaptchaImage")
            log("warn", "Captcha detectado — resuelve manualmente en el navegador del bot")
            WebDriverWait(driver, 120).until(EC.url_contains("/Home"))
            log("ok", "Login manual completado")
        except Exception:
            btn = driver.find_element(By.CSS_SELECTOR, "input[type='submit'],button[type='submit']")
            btn.click()
            try:
                WebDriverWait(driver, 20).until(lambda d: "/Account/Login" not in d.current_url)
                log("ok", f"Login exitoso — {driver.current_url}")
            except Exception:
                log("error", "Credenciales incorrectas o timeout")
                driver.quit()
                return None, None
        cookies = driver.get_cookies()
        return driver, cookies
    except Exception as e:
        log("error", f"Error en login: {e}")
        if "driver" in locals():
            try:
                driver.quit()
            except Exception:
                pass
        return None, None


def _hacer_login(usuario: str, password: str, log_fn=None):
    if USE_LOGIN_MODULE:
        try:
            driver, _ = intentar_login_con_ocr(usuario, password)
            if driver:
                cookies = driver.get_cookies()
                if log_fn:
                    log_fn("ok", f"Login OK — {len(cookies)} cookies")
                return driver, cookies
            # intentar_login_con_ocr agotó sus intentos y YA cerró/limpió
            # su propio driver y perfil (ver login_perucompras.py). NO
            # caemos a _login_fallback: ese usa selectores de OTRO
            # formulario (UserName/Password/CaptchaImage) que no existen
            # en este sitio real (que usa ID_Usuario/Contrasena/
            # CodigoCaptcha) — por eso abría una SEGUNDA ventana, en
            # primer plano, que se quedaba colgada con "element not
            # interactable" sin poder hacer nada.
            if log_fn:
                log_fn("error", "Login con OCR agotó sus intentos")
            return None, None
        except Exception as e:
            if log_fn:
                log_fn("error", f"intentar_login_con_ocr falló: {e}")
            return None, None
    return _login_fallback(usuario, password, log_fn=log_fn)

def _session_desde_cookies(cookies_list) -> requests.Session:
    s = requests.Session()
    for c in cookies_list:
        s.cookies.set(c["name"], c["value"], domain=c.get("domain", ""), path=c.get("path", "/"))
    s.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "es-PE,es;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Origin": BASE_URL,
        "Referer": BASE_URL + "/",
    })
    return s


# ============================================================
# Sesión con estado + keep-alive (nuevo, para Helbot)
# ============================================================
class PeruComprasSession:
    def __init__(self):
        self.driver = None
        self.session: requests.Session | None = None
        self.cookies_list = None
        self.usuario = None
        self.password = None

        self.estado = "desconectado"  # desconectado | cargando | activa | perdida
        self.login_lock = threading.Lock()
        # 🔒 Candado exclusivo para peticiones HTTP reales a Perú Compras.
        # Perú Compras invalida la sesión si detecta 2 requests "al mismo
        # tiempo" con las mismas cookies (igual que cuando otro usuario
        # entra con las mismas credenciales). El monitor de publicadas y
        # la extracción de proformas comparten la MISMA sesión — sin este
        # candado, ambos podían disparar requests en paralelo y Perú
        # Compras mataba la sesión real a la mitad, cortando el resto de
        # catálogos en la extracción.
        self.request_lock = threading.RLock()
        self.keepalive_stop = threading.Event()
        self.keepalive_thread: threading.Thread | None = None

        self.on_sesion_perdida = None   # callback(usuario) -> se llama al perder sesión
        self.on_sesion_recuperada = None  # callback(usuario) -> se llama al recuperarla
        self.on_sesion_fallida = None   # callback(usuario) -> se llama cuando el relogin automático se rinde definitivamente (pasa a "desconectado")
        self.on_login_exitoso = None  # callback() -> se llama justo al quedar "activa"

    @property
    def autenticado(self) -> bool:
        return self.estado == "activa"

    # -------- login síncrono (bloquea hasta terminar) --------
    def login(self, usuario: str, password: str, log_fn=None) -> bool:
        # El candado evita que este login (manual, disparado por el
        # botón) corra AL MISMO TIEMPO que un relogin automático interno
        # (_relogin_sincronizado, que se dispara solo cuando se pierde
        # la sesión) — sin esto, los dos abrían Chrome con el MISMO
        # perfil en paralelo y chocaban ("session not created: Chrome
        # instance exited"), dejando el frontend pegado en "cargando".
        with self.login_lock:
            self.estado = "cargando"
            self.usuario = usuario
            self.password = password
            driver = None

            # Por si quedó un driver viejo vivo de un intento anterior
            # (ej. la ventana zombie que mencionas) — se mata ANTES de
            # intentar abrir uno nuevo con el mismo perfil.
            try:
                if self.driver:
                    self.driver.quit()
            except Exception:
                pass
            self.driver = None
            self.session = None
            _limpiar_chrome_de(usuario)

            try:
                driver, cookies = _hacer_login(usuario, password, log_fn=log_fn)
                if not driver:
                    self.estado = "desconectado"  # login falló limpio -> botón se re-habilita
                    _limpiar_chrome_de(usuario)
                    return False

                try:
                    if USE_LOGIN_MODULE:
                        cerrar_ventanas_emergentes(driver)
                except Exception as e:
                    logger.info(f"Post-login (no crítico): {e}")

                self.driver = driver
                self.cookies_list = cookies
                self.session = _session_desde_cookies(cookies)
                self.estado = "activa"
                self._iniciar_keepalive()
                if self.on_login_exitoso:
                    try:
                        self.on_login_exitoso()
                    except Exception as e:
                        logger.warning(f"Error en callback on_login_exitoso: {e}")
                return True

            except Exception as e:
                logger.error(f"Login de '{usuario}' falló con excepción no controlada: {e}")
                try:
                    if driver:
                        driver.quit()
                except Exception:
                    pass
                self.driver = None
                self.session = None
                self.estado = "desconectado"
                _limpiar_chrome_de(usuario)
                return False

    # -------- login en background (no bloquea el request HTTP) --------
    def login_async(self, usuario: str, password: str, log_fn=None):
        threading.Thread(target=self._login_con_watchdog, args=(usuario, password, log_fn), daemon=True).start()

    def _login_con_watchdog(self, usuario: str, password: str, log_fn=None):
        """Corre el login real y, EN PARALELO, un vigilante que fuerza el
        cierre si el login se queda colgado más de LOGIN_TIMEOUT_SEGUNDOS
        (ej. Chrome no responde, un selector nunca aparece, etc.) — sin
        esto, un cuelgue silencioso dejaba el botón de login inhabilitado
        para siempre y la ventana viva, sin que reiniciar la página
        arreglara nada (había que reiniciar el backend)."""
        vigilante = threading.Thread(target=self._watchdog_timeout, args=(usuario,), daemon=True)
        vigilante.start()
        self.login(usuario, password, log_fn=log_fn)

    def _watchdog_timeout(self, usuario: str, timeout_seg: int = LOGIN_TIMEOUT_SEGUNDOS):
        inicio = time.time()
        while time.time() - inicio < timeout_seg:
            if self.estado != "cargando":
                return  # terminó a tiempo (éxito o error ya manejado arriba)
            time.sleep(2)

        if self.estado == "cargando":
            logger.warning(f"Login de '{usuario}' excedió {timeout_seg}s sin responder — forzando cierre")
            try:
                if self.driver:
                    self.driver.quit()
            except Exception:
                pass
            self.driver = None
            self.session = None
            self.estado = "desconectado"
            _limpiar_chrome_de(usuario)
    def logout(self):
        self.keepalive_stop.set()
        usuario_actual = self.usuario
        try:
            if self.driver:
                self.driver.quit()
        except Exception:
            pass
        self.driver = None
        self.session = None
        self.estado = "desconectado"
        # Sin esto, driver.quit() a veces no mata el proceso chrome.exe
        # de verdad (queda huérfano) y el perfil se queda con archivos
        # de bloqueo (SingletonLock, etc.) que impiden loguear limpio
        # la próxima vez con este mismo uid.
        if usuario_actual:
            _limpiar_chrome_de(usuario_actual)

    # -------- keep-alive: mismo patrón que rapifich_api.py --------
    def _keepalive_loop(self):
        while not self.keepalive_stop.wait(KEEPALIVE_INTERVAL):
            if self.estado != "activa" or not self.driver:
                continue
            try:
                with self.login_lock:
                    self.driver.get(BASE_URL + "/Home/Index")
                    time.sleep(2)
                    nuevas_cookies = self.driver.get_cookies()
                    nueva_session = _session_desde_cookies(nuevas_cookies)
                    r_test = nueva_session.get(BASE_URL + "/Home/Index", timeout=20, allow_redirects=True)
                    if r_test.status_code == 200 and "login" not in r_test.url.lower():
                        self.session = nueva_session
                        self.cookies_list = nuevas_cookies
                        logger.info("Sesión Peru Compras renovada automáticamente (keep-alive)")
                    else:
                        raise ValueError(f"URL inesperada: {r_test.url}")
            except Exception:
                logger.warning("Keep-alive falló — la sesión se perdió (probablemente otro usuario entró con las mismas credenciales)")
                estado_previo = self.estado
                self.estado = "perdida"

                # Todo esto (matar driver viejo + intentar relogin) debe
                # ir bajo el MISMO candado que usa login() — así, si en
                # ese instante alguien le da clic manual a "Iniciar
                # sesión" para este mismo uid, uno de los dos espera su
                # turno en vez de pelear por el mismo perfil de Chrome.
                with self.login_lock:
                    usuario_actual = self.usuario
                    try:
                        if self.driver:
                            self.driver.quit()
                    except Exception:
                        pass
                    self.driver = None
                    self.session = None
                    _limpiar_chrome_de(usuario_actual) if usuario_actual else None

                if estado_previo == "activa" and self.on_sesion_perdida:
                    try:
                        self.on_sesion_perdida(self.usuario)
                    except Exception as e:
                        logger.warning(f"Error en callback on_sesion_perdida: {e}")

                relogin_ok = self._relogin_sincronizado()
                if relogin_ok:
                    if self.on_sesion_recuperada:
                        try:
                            self.on_sesion_recuperada(self.usuario)
                        except Exception as e:
                            logger.warning(f"Error en callback on_sesion_recuperada: {e}")
                else:
                    # _relogin_sincronizado() ya agotó su intento y dejó
                    # self.estado = "perdida" — sin esto, el sidebar (que
                    # trata "perdida" IGUAL que "cargando", mostrando el
                    # spinner anaranjado) se queda pensando que SIGUE
                    # reconectando para siempre. Se fuerza "desconectado"
                    # Y se avisa por WS con on_sesion_fallida — sin el
                    # aviso, el frontend nunca refresca porque no hay
                    # ningún WS listener para este caso.
                    self.estado = "desconectado"
                    if usuario_actual:
                        _limpiar_chrome_de(usuario_actual)
                    if self.on_sesion_fallida:
                        try:
                            self.on_sesion_fallida(usuario_actual)
                        except Exception as e:
                            logger.warning(f"Error en callback on_sesion_fallida: {e}")

    def _iniciar_keepalive(self):
        self.keepalive_stop.clear()
        if self.keepalive_thread is None or not self.keepalive_thread.is_alive():
            self.keepalive_thread = threading.Thread(target=self._keepalive_loop, daemon=True)
            self.keepalive_thread.start()

    def _relogin_sincronizado(self) -> bool:
        with self.login_lock:
            if not self.usuario or not self.password:
                self.estado = "perdida"
                return False
            try:
                drv, ck = _hacer_login(self.usuario, self.password)
                if drv:
                    try:
                        if self.driver:
                            self.driver.quit()
                    except Exception:
                        pass
                    self.driver = drv
                    self.cookies_list = ck
                    self.session = _session_desde_cookies(ck)
                    self.estado = "activa"
                    logger.info("Relogin exitoso — sesión activa")
                    return True
                self.estado = "perdida"
                return False
            except Exception as e:
                self.estado = "perdida"
                logger.error(f"Relogin error: {e}")
                return False

    # -------- TODO: endpoint real de búsqueda de publicadas --------
    def buscar_publicadas(self, filtro: dict) -> list:
        """
        TODO: reemplazar por la llamada real al módulo de "Publicadas"
        (acuerdo marco / catálogo / categoría / estado=Publicada), usando
        self.session ya autenticada. Deja aquí la URL/endpoint real cuando
        lo tengas mapeado (inspecciona la pestaña Network al hacer la
        búsqueda manual en el navegador).
        """
        if not self.autenticado:
            return []
        try:
            # Ejemplo de forma esperada — AJUSTAR a tu endpoint real:
            # resp = self.session.get(BASE_URL + "/t_Publicacion/Buscar", params=filtro, timeout=20)
            # resp.raise_for_status()
            # return resp.json().get("items", [])
            logger.warning("buscar_publicadas(): falta conectar el endpoint real de Peru Compras")
            return []
        except Exception as e:
            logger.warning(f"Error buscando publicadas: {e}")
            return []


# Instancia única compartida por toda la app (importar esto desde main.py)
# ============================================================
# Múltiples usuarios — leídos de .env (PERUCOMPRAS_USER_1/_2/...)
# ============================================================
def _cargar_usuarios_configurados() -> dict:
    usuarios = {}
    i = 1
    while True:
        user = os.getenv(f"PERUCOMPRAS_USER_{i}")
        password = os.getenv(f"PERUCOMPRAS_PASS_{i}")
        if not user or not password:
            break
        label = os.getenv(f"PERUCOMPRAS_LABEL_{i}", user)
        usuarios[str(i)] = {"usuario": user, "password": password, "label": label}
        i += 1
    return usuarios


USUARIOS_PERUCOMPRAS = _cargar_usuarios_configurados()


class SesionesPeruCompras:
    """
    Un PeruComprasSession (con su propio driver Selenium + keep-alive)
    por cada usuario configurado en .env. Permite tener varias sesiones
    activas a la vez y elegir cuál "mirar" desde el frontend (uid_viendo
    lo decide el frontend en cada request via ?uid=).
    """
    def __init__(self, usuarios: dict):
        self.usuarios = usuarios
        self.sesiones: dict[str, PeruComprasSession] = {
            uid: PeruComprasSession() for uid in usuarios
        }
        self.activo_id: Optional[str] = next(iter(usuarios), None)

    def ids(self) -> list[str]:
        return list(self.usuarios.keys())

    def sesion(self, uid: str) -> Optional[PeruComprasSession]:
        return self.sesiones.get(uid)

    def set_activo(self, uid: str) -> bool:
        if uid not in self.sesiones:
            return False
        self.activo_id = uid
        return True

    def cerrar_otras_sesiones_del_mismo_usuario(self, usuario: str, uid_mantener: str):
        """Perú Compras solo permite UNA sesión activa por cuenta real.
        Antes de loguear en `uid_mantener`, cierra (driver.quit real +
        limpieza de perfil) cualquier OTRA sesión de Helbot (otro uid)
        que esté usando ese mismo usuario real — evita que queden dos
        ventanas de Chrome logueadas con la misma cuenta al mismo
        tiempo, sin importar si el login vino del botón predefinido o
        del formulario manual."""
        usuario_normalizado = usuario.strip().lower()
        for uid, cfg in list(self.usuarios.items()):
            if uid == uid_mantener:
                continue
            if cfg["usuario"].strip().lower() != usuario_normalizado:
                continue
            sesion = self.sesiones.get(uid)
            if sesion and (sesion.driver or sesion.autenticado):
                logger.warning(
                    f"Cerrando sesión duplicada de '{usuario}' en uid='{uid}' "
                    f"(se mantiene uid='{uid_mantener}')"
                )
                sesion.logout()

    def login_async(self, uid: str, log_fn=None):
        cfg = self.usuarios.get(uid)
        sesion = self.sesiones.get(uid)
        if not cfg or not sesion:
            return
        self.cerrar_otras_sesiones_del_mismo_usuario(cfg["usuario"], uid)
        sesion.login_async(cfg["usuario"], cfg["password"], log_fn=log_fn)

    def estado_todos(self) -> dict:
        return {
            uid: {
                "label": self.usuarios[uid]["label"],
                "autenticado": s.autenticado,
                "estado": s.estado,
            }
            for uid, s in self.sesiones.items()
        }


    def crear_sesion_manual(self, usuario: str, password: str) -> str:
        """
        Crea (o reutiliza) una sesión para un usuario de Peru Compras que
        NO está predefinido en el .env. Si el username coincide con un
        usuario YA predefinido en el .env, reutiliza ESE uid en vez de
        crear uno nuevo — evita tener dos sesiones/ventanas de Chrome
        abiertas para el mismo usuario real de Peru Compras al mismo
        tiempo (el sitio solo permite una sesión activa por usuario).
        """
        usuario_normalizado = usuario.strip().lower()

        # ¿Ya existe un uid predefinido (del .env) con este mismo username?
        for uid_existente, cfg in self.usuarios.items():
            if cfg["usuario"].strip().lower() == usuario_normalizado:
                # Reutiliza ese uid — actualiza el password por si acaso
                # el usuario lo escribió distinto (typo corregido, etc.)
                self.usuarios[uid_existente]["password"] = password
                self.cerrar_otras_sesiones_del_mismo_usuario(usuario, uid_existente)
                return uid_existente

        # No existía — crea uno nuevo con prefijo "manual__"
        uid = f"manual__{usuario_normalizado}"
        if uid not in self.sesiones:
            self.sesiones[uid] = PeruComprasSession()
            self.usuarios[uid] = {
                "usuario": usuario.strip(),
                "password": password,
                "label": usuario.strip(),
            }
        else:
            self.usuarios[uid]["password"] = password

        self.cerrar_otras_sesiones_del_mismo_usuario(usuario, uid)
        return uid


if not USUARIOS_PERUCOMPRAS:
    logger.warning(
        "No hay usuarios de Peru Compras configurados en .env "
        "(PERUCOMPRAS_USER_1/PERUCOMPRAS_PASS_1, etc.)"
    )

perucompras_sesiones = SesionesPeruCompras(USUARIOS_PERUCOMPRAS)