# login_perucompras.py - versión OCR avanzada, optimizada y eficiente ⚡
import os
import platform
import shutil
import threading
import logging
import time
import io
import re
import cv2
import numpy as np
from PIL import Image
import pytesseract
from selenium import webdriver
from selenium.webdriver.common.by import By

# ddddocr es mucho más rápido y preciso que pytesseract para este tipo
# de captcha (texto claro sobre fondo degradado) — mismo motor que ya
# usas en mef_scraper.py. Se carga UNA sola vez a nivel de módulo
# (crear la instancia carga un modelo — hacerlo en cada intento sería
# lento); si no está instalado, cae de vuelta a pytesseract sin romper
# nada.
try:
    import ddddocr
    _DDDDOCR_DISPONIBLE = True
except ImportError:
    _DDDDOCR_DISPONIBLE = False

_ddddocr_instancia = None


def _obtener_ddddocr():
    global _ddddocr_instancia
    if not _DDDDOCR_DISPONIBLE:
        return None
    if _ddddocr_instancia is None:
        # beta=True usa el modelo entrenado específicamente para
        # captchas alfanuméricos con ruido/degradado (como el tuyo) —
        # en la práctica sube la precisión varios puntos porcentuales
        # comparado con el modelo general por defecto.
        _ddddocr_instancia = ddddocr.DdddOcr(show_ad=False, beta=True)
    return _ddddocr_instancia
# ===
from selenium.webdriver.chrome.service import Service

from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.action_chains import ActionChains

from selenium.common.exceptions import TimeoutException, NoSuchElementException

# ===



# === CONFIGURACIÓN ===

if platform.system() == "Windows":
    pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
else:
    pytesseract.pytesseract.tesseract_cmd = "/usr/bin/tesseract"

URL = "https://www.catalogos.perucompras.gob.pe/AccesoGeneral"

MAX_INTENTOS = 5
TIMEOUT_WAIT = 10

CAPTCHA_RE = re.compile(r"^[A-Z0-9]{5,6}$")

logger_login = logging.getLogger("helbot.login_perucompras")

# Carpeta base donde cada usuario tendrá su propio perfil de Chrome aislado.
# Ruta corta en C:\ (fuera del proyecto) para evitar problemas de permisos.
if platform.system() == "Windows":
    CARPETA_PERFILES = r"C:\HelbotChromeProfiles"
else:
    CARPETA_PERFILES = "/tmp/HelbotChromeProfiles"
os.makedirs(CARPETA_PERFILES, exist_ok=True)

# Candado global: evita que dos logins abran Chrome AL MISMO TIEMPO.
# Windows falla al crear el archivo DevToolsActivePort si se lanzan
# varios Chrome en paralelo, así que forzamos que arranquen uno por uno.
_lock_arranque_chrome = threading.Lock()


def _limpiar_perfil_bloqueado(usuario: str, borrar_todo: bool = False):
    """Limpia el perfil de Chrome del usuario para evitar perfiles
    corruptos o bloqueados de una sesión anterior mal cerrada."""
    perfil_usuario = os.path.join(CARPETA_PERFILES, usuario)
    if not os.path.exists(perfil_usuario):
        return
    if borrar_todo:
        try:
            shutil.rmtree(perfil_usuario, ignore_errors=True)
            logger_login.info(f"Perfil de '{usuario}' borrado por completo (reinicio limpio)")
        except Exception as e:
            print(f" ⚠️ No se pudo borrar el perfil completo de '{usuario}': {e}")
        return
    for nombre in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        ruta = os.path.join(perfil_usuario, nombre)
        try:
            if os.path.exists(ruta):
                os.remove(ruta)
        except Exception:
            pass


def _matar_procesos_chrome_huerfanos(usuario: str):
    """Mata SOLO los procesos chrome.exe que pertenecen al perfil de
    ESTE usuario específico (identificados por su carpeta de perfil
    única en la línea de comando), sin tocar sesiones activas de otros
    usuarios ni el Chrome personal del sistema. Usa psutil, que funciona
    igual en Windows y Linux — reemplaza el wmic/taskkill anterior, que
    solo existía en Windows y fallaba en silencio dentro del contenedor
    Docker (Linux) de producción."""
    try:
        import psutil

        perfil_usuario = os.path.join(CARPETA_PERFILES, usuario)
        matados = 0
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                cmdline = " ".join(proc.info['cmdline'] or [])
                if perfil_usuario in cmdline:
                    proc.kill()
                    matados += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        if matados:
            print(f" 🧹 {matados} proceso(s) Chrome huérfano(s) de '{usuario}' cerrado(s)")
    except Exception as e:
        print(f" ⚠️ No se pudo limpiar procesos huérfanos de '{usuario}': {e}")


def _crear_chrome_options(usuario: str) -> Options:
    """Opciones de Chrome AISLADAS por usuario: perfil propio (para que
    2 usuarios nunca compartan cookies/sesión) y ventana invisible
    (posicionada fuera de la pantalla, sin depender de --headless)."""
    opts = Options()

    perfil_usuario = os.path.join(CARPETA_PERFILES, usuario)
    opts.add_argument(f"--user-data-dir={perfil_usuario}")

    opts.add_argument("--window-size=1200,900")
    opts.add_argument("--window-position=-32000,-32000")  # invisible, fuera de pantalla
    opts.add_argument("--disable-notifications")
    opts.add_argument("--disable-infobars")
    opts.add_argument("--lang=es-PE")
    opts.add_argument("--disable-popup-blocking")
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--disable-extensions")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--no-first-run")
    opts.add_argument("--no-default-browser-check")

    opts.add_experimental_option("excludeSwitches", ["enable-logging", "enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    opts.add_experimental_option("detach", False)

    return opts


# === UTILIDADES ===

def cerrar_modal_si_existe(driver, timeout=2):
    """Cierra modal de salida si existe."""
    try:
        btn = WebDriverWait(driver, timeout).until(
            EC.element_to_be_clickable((By.ID, "btnSalir"))
        )
        btn.click()
        print("🟢 Modal cerrado.")
        time.sleep(0.3)
        return True
    except (TimeoutException, NoSuchElementException):
        return False


def detectar_pagina_verificacion(driver):
    """Detecta si aparece la página de código de verificación"""
    try:
        driver.find_element(By.ID, "C_CodigoVerificacion")
        print("⚠ Página de verificación detectada")
        return True
    except NoSuchElementException:
        return False


def cancelar_verificacion(driver):
    """Presiona cancelar en la pantalla de verificación y vuelve al login"""
    try:
        print("⚠ Intentando cancelar verificación...")

        btn_cancelar = WebDriverWait(driver, 5).until(
            EC.element_to_be_clickable((By.ID, "btnCancelar"))
        )

        driver.execute_script("arguments[0].click();", btn_cancelar)

        print("🟢 Botón CANCELAR presionado")

        WebDriverWait(driver, 10).until(
            EC.presence_of_element_located((By.ID, "ID_Usuario"))
        )

        print("🔄 Regresó al login correctamente")

        return True

    except TimeoutException:
        print("⚠ No apareció botón cancelar")
        return False

    except Exception as e:
        print("⚠ Error cancelando verificación:", e)
        return False


def preprocesar_captcha_basico(img_bytes):
    """Preprocesamiento estándar para OCR."""

    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    arr = np.array(img)

    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)

    gray = cv2.bitwise_not(gray)

    gray = cv2.convertScaleAbs(gray, alpha=1.6, beta=10)

    gray = cv2.GaussianBlur(gray, (1, 1), 0)

    _, th1 = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    th2 = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 35, 10
    )

    combined = cv2.bitwise_and(th1, th2)

    kernel = np.ones((2, 2), np.uint8)
    final = cv2.dilate(combined, kernel, iterations=1)

    return Image.fromarray(final)


def preprocesar_captcha_agresivo(img_bytes):
    """Preprocesamiento agresivo para captchas difíciles."""

    arr = np.array(Image.open(io.BytesIO(img_bytes)).convert("RGB"))

    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)

    gray = cv2.resize(gray, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)

    gray = cv2.GaussianBlur(gray, (3, 3), 0)

    _, th = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    return Image.fromarray(th)


def solve_captcha_ddddocr(img_bytes) -> str:
    """Lee el captcha con ddddocr directo sobre los bytes crudos de la
    imagen — no necesita preprocesamiento porque el modelo ya está
    entrenado para texto sobre fondos con ruido/degradado. Devuelve el
    texto en MAYÚSCULAS (formato que espera CAPTCHA_RE) o "" si falla."""
    ocr = _obtener_ddddocr()
    if not ocr:
        return ""
    try:
        texto = ocr.classification(img_bytes)
        texto = "".join(ch for ch in texto if ch.isalnum()).upper().strip()
        return texto
    except Exception as e:
        print(f" ⚠️ ddddocr falló: {e}")
        return ""


def leer_captcha_elemento(img_element, intento_num=1):
    """OCR mejorado con 2 métodos y validación cruzada."""

    try:
        img_bytes = img_element.screenshot_as_png

        # 🚀 ddddocr primero — es notablemente más rápido que las 2
        # pasadas de pytesseract de abajo, y no necesita preprocesar la
        # imagen. Si da un resultado que ya cumple el formato del
        # captcha, se devuelve de inmediato sin correr pytesseract.
        texto_ddddocr = solve_captcha_ddddocr(img_bytes)
        print(f" 🧠 OCR (ddddocr): '{texto_ddddocr}'")
        if CAPTCHA_RE.match(texto_ddddocr):
            print(f" ✅ Captcha válido (ddddocr): {texto_ddddocr}")
            return texto_ddddocr

        resultados = []
        if texto_ddddocr:
            resultados.append(("ddddocr", texto_ddddocr))

        try:
            pre1 = preprocesar_captcha_basico(img_bytes)

            text1 = pytesseract.image_to_string(
                pre1,
                config="-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 --psm 7 --oem 3",
            )

            texto1 = "".join(ch for ch in text1 if ch.isalnum()).upper().strip()

            resultados.append(("Básico", texto1))

            print(f" 🧠 OCR (Básico): '{texto1}'")

        except Exception as e:
            print(f" ⚠️ OCR Básico falló: {e}")

        try:
            pre2 = preprocesar_captcha_agresivo(img_bytes)

            text2 = pytesseract.image_to_string(
                pre2,
                config="-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 --psm 8 --oem 3",
            )

            texto2 = "".join(ch for ch in text2 if ch.isalnum()).upper().strip()

            resultados.append(("Agresivo", texto2))

            print(f" 🧠 OCR (Agresivo): '{texto2}'")

        except Exception as e:
            print(f" ⚠️ OCR Agresivo falló: {e}")

        for nombre, texto in resultados:
            if CAPTCHA_RE.match(texto):
                print(f" ✅ Captcha válido ({nombre}): {texto}")
                return texto

        if resultados:
            mejor = max(resultados, key=lambda x: len(x[1]))

            if len(mejor[1]) >= 5:
                print(f" ⚠️ Captcha dudoso pero usado: {mejor[1]}")
                return mejor[1][:6]

        print(" ❌ OCR no pudo leer el captcha")

        return ""

    except Exception as e:
        print(f" ⚠️ Error crítico en OCR (intento {intento_num}): {e}")
        return ""


def login_exitoso(driver):
    """Verifica si el login fue exitoso."""

    try:
        WebDriverWait(driver, 5).until_not(
            EC.presence_of_element_located((By.ID, "CodigoCaptcha"))
        )

        time.sleep(1)

        if detectar_pagina_verificacion(driver):
            return False

        body = driver.find_element(By.TAG_NAME, "body").text

        success_keywords = [
            "Catálogo Electrónico",
            "Perú Compras",
            "Bienvenido",
            "Salir",
            "Consultar",
            "Proveedores",
        ]

        if detectar_pagina_verificacion(driver):
            return False

        if any(keyword in body for keyword in success_keywords):
            print("✅ ¡Login exitoso detectado!")
            return True

        return False

    except TimeoutException:
        print(" ℹ️ Captcha aún visible (no pasó validación)")
        return False

    except NoSuchElementException:
        print(" ⚠️ No se pudo verificar estado de login")
        return False

    except Exception as e:
        print(f" ⚠️ Error verificando login: {e}")
        return False


def rellenar_formulario(driver, usuario, contrasena, captcha_text):
    """Rellena el formulario de login de forma segura."""

    try:
        usuario_input = driver.find_element(By.ID, "ID_Usuario")
        pass_input = driver.find_element(By.ID, "Contrasena")
        captcha_input = driver.find_element(By.ID, "CodigoCaptcha")

        usuario_input.clear()
        usuario_input.send_keys(usuario)

        pass_input.clear()
        pass_input.send_keys(contrasena)

        captcha_input.clear()
        captcha_input.send_keys(captcha_text)

        return True

    except NoSuchElementException as e:
        print(f" ❌ No se encontró elemento del formulario: {e}")
        return False


def realizar_click_login(driver):
    """Realiza el click en el botón de login."""

    try:
        btn_login = driver.find_element(By.ID, "btnLogin")
        btn_login.click()
        print(" ➡️ Click en botón de login")
        return True

    except NoSuchElementException:
        print(" ❌ No se encontró botón de login")
        return False


# === LOGIN PRINCIPAL ===

def intentar_login_con_ocr(usuario, contrasena):

    print("=" * 60)
    print("🚀 INICIANDO SESIÓN EN PERÚ COMPRAS")
    print("=" * 60)

    driver = None

    try:

        # Arranque de Chrome protegido por candado: nunca 2 usuarios
        # abren Chrome exactamente al mismo tiempo (evita el crash
        # típico de Windows "DevToolsActivePort file doesn't exist").
        with _lock_arranque_chrome:
            # Antes de abrir una ventana nueva para este usuario, matamos
            # cualquier Chrome huérfano que haya quedado vivo de un
            # intento anterior fallido o colgado — así nunca se acumulan
            # ventanas invisibles sin cerrar cuando se reintenta el login.
            _matar_procesos_chrome_huerfanos(usuario)
            time.sleep(1)
            _limpiar_perfil_bloqueado(usuario)
            opts = _crear_chrome_options(usuario)
            try:
                driver = webdriver.Chrome(options=opts)
            except Exception as e:
                print(f" ⚠️ Chrome no pudo arrancar con el perfil existente ({e}). "
                      f"Borrando perfil completo de '{usuario}' y reintentando...")
                _limpiar_perfil_bloqueado(usuario, borrar_todo=True)
                opts = _crear_chrome_options(usuario)
                driver = webdriver.Chrome(options=opts)

            # Pausa antes de soltar el candado: le da tiempo a Windows
            # de estabilizar este proceso antes de que arranque el siguiente.
            time.sleep(3)

        driver.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {
                "source": """
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
                """
            },
        )

        wait = WebDriverWait(driver, TIMEOUT_WAIT)

        driver.get(URL)

        print(f"📄 Página cargada: {URL}\n")

        for intento in range(1, MAX_INTENTOS + 1):

            print(f"🔁 INTENTO {intento}/{MAX_INTENTOS}")
            print("-" * 60)

            try:

                cerrar_modal_si_existe(driver)

                usuario_input = wait.until(
                    EC.presence_of_element_located((By.ID, "ID_Usuario"))
                )

                pass_input = wait.until(
                    EC.presence_of_element_located((By.ID, "Contrasena"))
                )

                captcha_img = wait.until(
                    EC.visibility_of_element_located((By.ID, "imgCaptcha"))
                )

                # Espera activa a que la imagen realmente termine de cargar en el
                # navegador (naturalWidth > 0) — sin esto, a veces se captura el
                # captcha viejo o un frame en blanco justo después del refresh.
                WebDriverWait(driver, 5).until(
                    lambda d: d.execute_script(
                        "return arguments[0].complete && arguments[0].naturalWidth > 0;",
                        captcha_img,
                    )
                )

                if not rellenar_formulario(driver, usuario, contrasena, ""):
                    driver.refresh()
                    time.sleep(1)
                    continue

                print(" 🔍 Leyendo captcha con OCR...")

                captcha_text = leer_captcha_elemento(captcha_img, intento)

                if not CAPTCHA_RE.match(captcha_text):

                    print(" ⚠️ Captcha inválido, refrescando...")

                    try:
                        captcha_img.click()
                        WebDriverWait(driver, 5).until(
                            lambda d: d.execute_script(
                                "return arguments[0].complete && arguments[0].naturalWidth > 0;",
                                captcha_img,
                            )
                        )
                        captcha_text = leer_captcha_elemento(captcha_img, intento)
                    except:
                        pass

                if captcha_text:

                    captcha_input = driver.find_element(By.ID, "CodigoCaptcha")

                    captcha_input.clear()
                    captcha_input.send_keys(captcha_text)

                    print(f" ✍️ Captcha ingresado: {captcha_text}")

                else:

                    print(" ❌ No se pudo leer captcha, saltando intento")
                    driver.refresh()
                    time.sleep(1)
                    continue

                if not realizar_click_login(driver):
                    driver.refresh()
                    time.sleep(1)
                    continue

                WebDriverWait(driver, 10).until(
                    EC.presence_of_element_located((By.TAG_NAME, "body"))
                )
                if detectar_pagina_verificacion(driver):

                    if cancelar_verificacion(driver):

                        print("🔄 Reintentando login...")
                        WebDriverWait(driver, 10).until(
                            EC.presence_of_element_located((By.TAG_NAME, "body"))
                        )

                        driver.get(URL)
                        continue

                    else:

                        driver.refresh()
                        continue

                time.sleep(2)

                cerrar_modal_si_existe(driver)

                if login_exitoso(driver):

                    print("\n" + "=" * 60)
                    print("✅ ¡LOGIN EXITOSO! ✅")
                    print("=" * 60)

                    return driver, wait

                print(" ❌ Login rechazado, reintentando...")

                driver.refresh()
                time.sleep(1)

            except TimeoutException:

                print(" ⏱️ Timeout esperando elementos")

                try:
                    driver.refresh()
                    time.sleep(1)
                except Exception:
                    print("🔴 Chrome fue cerrado.")
                    return None, None

            except Exception as e:

                print(f" ⚠️ Error: {e}")

                try:
                    driver.current_url
                except Exception:
                    print("🔴 El navegador ya no existe.")
                    return None, None

                try:
                    driver.refresh()
                    time.sleep(1)
                except Exception:
                    return None, None

        print("\n" + "=" * 60)
        print("🚫 Se agotaron los intentos de login")
        print("=" * 60)

        try:
            driver.quit()
        except Exception:
            pass
        _limpiar_perfil_bloqueado(usuario, borrar_todo=True)

        return None, None

    except Exception as e:

        print(f"\n❌ Error crítico: {e}")

        if driver:
            try:
                driver.quit()
            except Exception:
                pass
        _limpiar_perfil_bloqueado(usuario, borrar_todo=True)

        return None, None


# === EJEMPLO DE USO ===

if __name__ == "__main__":

    USUARIO = "tu_usuario"
    CONTRASENA = "tu_contrasena"

    driver, wait = intentar_login_con_ocr(USUARIO, CONTRASENA)

    if driver:

        print("\n✅ Sesión iniciada. El navegador permanece abierto.")
        print("📌 Cierra la ventana del navegador cuando termines.")

    else:

        print("\n❌ No se pudo iniciar sesión")