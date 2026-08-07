"""
rapifich_api.py
================
RAPIFICH — API FastAPI de subida masiva a PERU COMPRAS.

Es la conversión 1:1 de la lógica que tenías en subir_producto_perucompras.py
(tkinter) a un servicio web. TODA la lógica de scraping/requests/selenium
(login, paso1/paso2/paso3, keep-alive, detección de color, parseo de
CONFIG.txt) es la misma; lo único que cambia es que ahora se controla desde
el navegador en vez de una ventana de escritorio.

Corre en: http://0.0.0.0:4001  (distinto del scraper SEACE, que usa el 4000)

CAMBIOS EN ESTA VERSIÓN:
  - Se agrega `boot_id` al backend (se genera una vez al arrancar el proceso).
    Se expone en /status. El frontend lo usa para detectar que el servidor
    se reinició y así resetear su cursor de logs — antes, si reiniciabas el
    backend, el frontend seguía pidiendo "/logs?since=<numero_viejo>" y como
    el backend volvía a contar los IDs desde 1, nunca te llegaba nada nuevo
    (por eso el log de operaciones se veía "vacío" tras un reinicio).
  - Se agrega POST /subir/cancelar — permite cancelar una subida en curso.
    Se detiene apenas termina la ficha actual (no corta un guardado a la mitad).
  - Se agrega POST /logs/limpiar — limpia el historial de log en el backend.
  - Se agrega GET /fs/accesos — devuelve accesos directos (Escritorio,
    Documentos, Descargas, Imágenes) para el explorador de carpetas, así no
    hay que navegar manualmente desde C:\\ o D:\\ cada vez.

Requisitos (además de lo que ya tenías para el bot):
    pip install fastapi "uvicorn[standard]"

Ejecutar:
    python rapifich_api.py
"""

import re
import html as html_lib
import time
import threading
import unicodedata
import string
import uuid
from datetime import datetime
from itertools import count
from pathlib import Path
from typing import Optional, List

import requests
from requests_toolbelt.multipart.encoder import MultipartEncoder
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

try:
    from webdriver_manager.chrome import ChromeDriverManager
    USE_WDM = True
except ImportError:
    USE_WDM = False

try:
    from login_perucompras import intentar_login_con_ocr
    from acciones_post_login import cerrar_ventanas_emergentes
    USE_LOGIN_MODULE = True
except ImportError:
    USE_LOGIN_MODULE = False


# ─────────────────────────────────────────────────────────────────────────────
#  CONFIGURACIÓN GENERAL (idéntica al bot original)
# ─────────────────────────────────────────────────────────────────────────────
BASE_URL   = "https://www.catalogos.perucompras.gob.pe"
LOGIN_URL  = BASE_URL + "/"
CREATE_URL = BASE_URL + "/t_CatalogoProductoMarca/CatalogoProductoCreate"
EDIT_URL   = BASE_URL + "/t_CatalogoProductoMarca/CatalogoProductoEdit"

USUARIOS = {
    "multilimp.01": "Fabr.2025",
    "susdd":        "ECldsds5",
}

KEEPALIVE_INTERVAL = 90
MAX_CARACTERISTICAS_ITER = 50
API_PORT = 4001

# Única carpeta permitida para explorar/subir fichas. Nadie puede
# salir de aquí con el explorador de carpetas.
CARPETA_COMPARTIDA_RAIZ = r"\\MSI\Users\MSICROSS\Documents\FICHAS_COMPARTIDAS"

ACUERDOS = {
    "AM-001-2024 — Utiles de limpieza y aseo": {
        "N_Acuerdo":  "372",
        "N_Catalogo": "379",
        "categorias": [
            ("12436", "ARROZ PILADO"),
            ("12435", "ACEITE VEGETAL"),
            ("12433", "AZUCAR"),
            ("12434", "LENTEJA"),
            ("12437", "FRIJOL"),
            ("12180", "ESCOBILLONES"),
            ("12181", "LAVAVAJILLAS"),
            ("12182", "SUAVIZANTES DE ROPA"),
            ("12184", "DETERGENTES"),
            ("12185", "REMOVEDORES DE SARRO"),
            ("12186", "DESINFECTANTES"),
            ("12187", "DESENGRASANTES"),
            ("12188", "ESPONJAS Y FIBRAS"),
            ("12189", "SILICONA"),
            ("12190", "TINAS Y BATEAS"),
            ("12191", "TACHOS BUZONES Y RECOLECTORES"),
            ("12192", "CERAS"),
            ("12193", "TOALLAS"),
            ("12194", "ATRAPA POLVO"),
            ("12195", "MOPAS Y TRAPEADORES"),
            ("12196", "ALCOHOL ETILICO GEL"),
            ("12165", "CEPILLO DENTAL"),
            ("12166", "LIMPIADORES"),
            ("12167", "RECOGEDORES"),
            ("12168", "AMBIENTADORES Y PASTILLAS"),
            ("12169", "JABON HIGIENE MANOS"),
            ("12170", "PANOS Y BAYETAS"),
            ("12171", "PASTA DENTAL"),
            ("12172", "PULVERIZADORES Y ATOMIZADORES"),
            ("12173", "CARRITOS PARA LIMPIEZA"),
            ("12174", "JALADORES DE AGUA"),
            ("12175", "HIPOCLORITO DE SODIO"),
            ("12177", "BASTONES Y MANGOS"),
            ("12178", "CEPILLOS Y ESCOBILLAS"),
            ("12179", "ESCOBAS"),
            ("12163", "PAPEL TOALLA"),
            ("12164", "PAPEL HIGIENICO"),
        ],
    },
}

COLOR_CODES = {
    "AM": "AMARILLO", "ZA": "AMARILLO AZUL", "AV": "AMARILLO VERDE", "RA": "AMARILLO ROJO",
    "AN": "ANARANJADO", "AZ": "AZUL", "AA": "AZUL ACERO", "AC": "AZUL COBALTO",
    "AE": "AZUL ELECTRICO", "AI": "AZUL ITALIANO", "AO": "AZUL MARINO", "AL": "AZUL CLARO",
    "AD": "AZUL VERDE", "AR": "AZUL ROJO", "AU": "ALUMINIO", "BG": "BEIGE", "BL": "BLANCO",
    "B": "BLANCO", "CE": "CELESTE", "CB": "CELESTE BEBE", "CM": "CREMA", "CR": "CORAL",
    "FU": "FUCSIA", "GN": "GUINDA", "GR": "GRIS", "LA": "LAVANDA", "LI": "LILA",
    "MA": "MADERA", "MN": "MADERA NEGRO", "MG": "MAGENTA", "MR": "MARRON", "MO": "MORADO",
    "NG": "NEGRO", "PR": "PALO ROSA", "PT": "PLATA", "PL": "PLOMO", "PU": "PURPURA",
    "RJ": "ROJO", "RO": "ROJO OSCURO", "RN": "ROJO NEGRO", "RS": "ROSADO", "RC": "ROSADO CLARO",
    "TU": "TURQUESA", "VR": "VARIADO", "VE": "VERDE", "VA": "VERDE AGUA", "VC": "VERDE CLARO",
    "VS": "VERDE ESMERALDA", "VL": "VERDE LIMA", "VO": "VERDE OSCURO", "VN": "VINO", "VI": "VIOLETA",
}

CARACTERISTICAS_TEXTO_LIBRE = {
    "MODELO",
    "NRO PARTE",
    "CODIGO DE IDENTIFICACION UNICO",
}

IMG_EXTS = (".png", ".jpg", ".jpeg", ".gif", ".webp")


# ─────────────────────────────────────────────────────────────────────────────
#  UTILIDADES DE TEXTO / NORMALIZACIÓN  (idénticas al bot original)
# ─────────────────────────────────────────────────────────────────────────────
def normalize_label(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode("ascii")
    s = s.upper()
    s = re.sub(r"[_\-/]+", " ", s)
    s = re.sub(r"[().:]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def detectar_color(nombre_ficha, codigo_base):
    nombre = (nombre_ficha or "").strip()
    base = (codigo_base or "").strip()

    if base and nombre.upper().startswith(base.upper()):
        resto = nombre[len(base):].lstrip("-_ ")
        if resto:
            codigo_color = re.split(r"[-_]", resto)[0].upper()
            color = COLOR_CODES.get(codigo_color)
            if color:
                return codigo_color, color

    segmentos = nombre.split("-")
    if len(segmentos) >= 2:
        segmento_color = segmentos[-2]
        codigo_color = segmento_color[-2:].upper()
        color = COLOR_CODES.get(codigo_color)
        if color:
            return codigo_color, color
        codigo_color_1 = segmento_color[-1:].upper()
        color = COLOR_CODES.get(codigo_color_1)
        if color:
            return codigo_color_1, color

    return "", None


def parsear_config(path_config):
    config = {}
    precio = None
    with open(path_config, encoding="utf-8-sig") as f:
        for linea in f:
            linea = linea.strip()
            if not linea or linea.startswith("#") or ":" not in linea:
                continue
            clave, valor = linea.split(":", 1)
            clave_norm = normalize_label(clave)
            valor = valor.strip()
            if not clave_norm:
                continue
            if clave_norm == "PRECIO":
                precio = valor
                continue
            config[clave_norm] = valor
    return config, precio


def escanear_carpeta_base(carpeta):
    carpeta = Path(carpeta)
    errores = []
    config_path = carpeta / "CONFIG.txt"
    fichas_dir = carpeta / "FICHAS"
    imagenes_dir = carpeta / "IMAGENES"

    if not config_path.exists():
        errores.append(f"No se encontró CONFIG.txt en '{carpeta.name}'")
    if not fichas_dir.exists():
        errores.append(f"No se encontró la carpeta FICHAS en '{carpeta.name}'")
    if not imagenes_dir.exists():
        errores.append(f"No se encontró la carpeta IMAGENES en '{carpeta.name}'")
    if errores:
        return None, errores

    try:
        config, precio = parsear_config(config_path)
    except Exception as e:
        return None, [f"No se pudo leer CONFIG.txt en '{carpeta.name}': {e}"]

    if not precio:
        errores.append(f"CONFIG.txt de '{carpeta.name}' no tiene PRECIO definido")

    pdfs = {p.stem: p for p in fichas_dir.glob("*.pdf")}
    imagenes = {}
    for ext in IMG_EXTS:
        for img in imagenes_dir.glob(f"*{ext}"):
            imagenes[img.stem] = img

    fichas = []
    for stem, pdf_path in sorted(pdfs.items()):
        img_path = imagenes.get(stem)
        if not img_path:
            errores.append(f"'{carpeta.name}': falta IMAGEN para la ficha '{stem}'")
            continue
        fichas.append({"codigo": stem, "pdf": pdf_path, "imagen": img_path})

    for stem in imagenes:
        if stem not in pdfs:
            errores.append(f"'{carpeta.name}': falta PDF para la imagen '{stem}'")

    if not fichas:
        errores.append(f"'{carpeta.name}': no se encontraron fichas válidas (PDF + IMAGEN)")
        return None, errores

    info = {
        "codigo_base": carpeta.name,
        "carpeta": carpeta,
        "config": config,
        "precio": precio,
        "fichas": fichas,
    }
    return info, errores


def detectar_carpetas_base(carpeta_seleccionada):
    carpeta = Path(carpeta_seleccionada)
    if not carpeta.is_dir():
        return []

    def es_base(p):
        return (p / "CONFIG.txt").exists() and (p / "FICHAS").exists() and (p / "IMAGENES").exists()

    if es_base(carpeta):
        return [carpeta]

    candidatas = []
    try:
        for sub in sorted(carpeta.iterdir()):
            if sub.is_dir() and es_base(sub):
                candidatas.append(sub)
    except Exception:
        pass
    return candidatas


# ─────────────────────────────────────────────────────────────────────────────
#  LOGIN  (idéntico al bot original)
# ─────────────────────────────────────────────────────────────────────────────
def crear_driver(headless=False):
    opts = Options()
    if headless:
        opts.add_argument("--headless=new")
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
        {"source": "Object.defineProperty(navigator,'webdriver',{get:()=>undefined})"}
    )
    return driver


def _login_fallback(usuario, password, log_fn=None):
    def log(tag, msg):
        if log_fn:
            log_fn(tag, msg)
    try:
        driver = crear_driver(headless=False)
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


def hacer_login(usuario, password, log_fn=None):
    if USE_LOGIN_MODULE:
        try:
            driver, _ = intentar_login_con_ocr(usuario, password)
            if driver:
                cookies = driver.get_cookies()
                if log_fn:
                    log_fn("ok", f"Login OK — {len(cookies)} cookies")
                return driver, cookies
        except Exception as e:
            if log_fn:
                log_fn("error", f"intentar_login_con_ocr falló: {e}")
    return _login_fallback(usuario, password, log_fn=log_fn)


def session_desde_cookies(cookies_list):
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


# ─────────────────────────────────────────────────────────────────────────────
#  FLUJO REAL DE 2 PASOS (idéntico al bot original)
# ─────────────────────────────────────────────────────────────────────────────
def _extraer_input(html, name):
    for pat in [
        rf'<input[^>]+name="{re.escape(name)}"[^>]+value="([^"]*)"',
        rf'<input[^>]+value="([^"]*)"[^>]+name="{re.escape(name)}"',
        rf"<input[^>]+name='{re.escape(name)}'[^>]+value='([^']*)'",
        rf"<input[^>]+value='([^']*)'[^>]+name='{re.escape(name)}'",
    ]:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            return m.group(1)
    return ""


def paso1_obtener_formulario(session, n_acuerdo, n_catalogo, n_categoria, c_categoria):
    data = {
        "N_Acuerdo": n_acuerdo,
        "N_Catalogo": n_catalogo,
        "N_Categoria": n_categoria,
        "C_Categoria": c_categoria,
        "C_EstadoNav": "ACTIVO",
    }
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": BASE_URL + "/t_CatalogoProductoMarca",
        "Origin": BASE_URL,
    }
    try:
        r = session.post(CREATE_URL, data=data, headers=headers, allow_redirects=True, timeout=30)
        r.raise_for_status()
        if "login" in r.url.lower():
            return None

        html = r.text
        campos = {}
        tokens = re.findall(
            r'<input[^>]+name="__RequestVerificationToken"[^>]+value="([^"]+)"', html, re.IGNORECASE)
        if not tokens:
            tokens = re.findall(
                r'<input[^>]+value="([^"]+)"[^>]+name="__RequestVerificationToken"', html, re.IGNORECASE)
        campos["__RequestVerificationToken"] = tokens[0] if tokens else ""

        for name in [
            "ID_CatalogoProducto", "N_AcuerdoCatalogo", "N_Categoria",
            "C_Descripcion", "C_PrecioRef", "C_Imagen", "C_ArchivoDescriptivo",
            "C_Estado", "ID_Marca", "ID_Proveedor", "ID_CatalogoAcuerdo",
            "N_IDProveedorMarca",
        ]:
            campos[name] = _extraer_input(html, name)

        campos["_N_Acuerdo"] = n_acuerdo
        campos["_N_Catalogo"] = n_catalogo
        campos["_N_Categoria"] = n_categoria
        campos["_C_Categoria"] = c_categoria
        return campos
    except Exception as e:
        print(f"[PASO1] Error: {e}")
        return None


def paso1_edit_obtener_formulario(session, id_producto):
    try:
        r = session.get(EDIT_URL, params={
            "ID_CatalogoProducto": id_producto,
            "C_EstadoNav": "ACTIVO"
        }, timeout=30)
        r.raise_for_status()
        if "login" in r.url.lower():
            return None

        html = r.text
        campos = {}
        tokens = re.findall(
            r'<input[^>]+name="__RequestVerificationToken"[^>]+value="([^"]+)"', html, re.IGNORECASE)
        if not tokens:
            tokens = re.findall(
                r'<input[^>]+value="([^"]+)"[^>]+name="__RequestVerificationToken"', html, re.IGNORECASE)
        campos["__RequestVerificationToken"] = tokens[0] if tokens else ""

        for name in [
            "ID_CatalogoProducto", "N_AcuerdoCatalogo", "N_Categoria",
            "C_Descripcion", "C_PrecioRef", "C_Imagen", "C_ArchivoDescriptivo",
            "C_Estado", "ID_Marca", "ID_Proveedor", "ID_CatalogoAcuerdo",
            "N_IDProveedorMarca",
        ]:
            campos[name] = _extraer_input(html, name)

        campos["_N_Acuerdo"] = ""
        campos["_N_Catalogo"] = ""
        campos["_N_Categoria"] = campos.get("N_Categoria", "")
        campos["_C_Categoria"] = ""
        return campos
    except Exception as e:
        print(f"[PASO1_EDIT] Error: {e}")
        return None


def paso2_guardar_producto(session, campos, precio, imagen_path, pdf_path, id_producto=None):
    url = EDIT_URL if id_producto else CREATE_URL
    handles = []
    try:
        mime_img = "image/jpeg"
        if imagen_path and Path(imagen_path).exists():
            imagen_path = Path(imagen_path)
            if imagen_path.suffix.lower() == ".png":
                mime_img = "image/png"
            elif imagen_path.suffix.lower() == ".gif":
                mime_img = "image/gif"
            fh_img = open(imagen_path, "rb")
            handles.append(fh_img)
            campo_img = (imagen_path.name, fh_img, mime_img)
        else:
            campo_img = ("", b"", "application/octet-stream")

        if pdf_path and Path(pdf_path).exists():
            pdf_path = Path(pdf_path)
            fh_pdf = open(pdf_path, "rb")
            handles.append(fh_pdf)
            campo_pdf = (pdf_path.name, fh_pdf, "application/pdf")
        else:
            campo_pdf = ("", b"", "application/octet-stream")

        if id_producto:
            nombre_campo_img = "dataFile"
            nombre_campo_pdf = "AdjFile"
        else:
            nombre_campo_img = "upload"
            nombre_campo_pdf = "uploadAdj"

        form_fields = [
            ("__RequestVerificationToken", campos.get("__RequestVerificationToken", "")),
            ("ID_CatalogoProducto", campos.get("ID_CatalogoProducto", "")),
            ("N_AcuerdoCatalogo", campos.get("N_AcuerdoCatalogo", "")),
            ("N_Categoria", campos.get("N_Categoria", "")),
            ("C_Descripcion", campos.get("C_Descripcion", "")),
            ("C_Imagen", campos.get("C_Imagen", "")),
            ("C_ArchivoDescriptivo", campos.get("C_ArchivoDescriptivo", "")),
            ("N_IDProveedorMarca", campos.get("N_IDProveedorMarca", "")),
            ("C_EstadoNav", "ACTIVO"),
            ("C_Estado", campos.get("C_Estado", "ACTIVO")),
            ("C_PrecioRef", str(precio).strip()),
            (nombre_campo_img, campo_img),
            (nombre_campo_pdf, campo_pdf),
            ("uploadAdjAdicional", ("", b"", "application/octet-stream")),
            ("uploadAdjPie1", ("", b"", "application/octet-stream")),
            ("uploadAdjPie2", ("", b"", "application/octet-stream")),
            ("btnGuardar", "Guardar"),
        ]
        encoder = MultipartEncoder(fields=form_fields)
        headers = {
            "Referer": url,
            "Origin": BASE_URL,
            "Content-Type": encoder.content_type,
        }

        r = session.post(url, data=encoder, headers=headers, allow_redirects=True, timeout=600)
        url_final = r.url
        url_lower = url_final.lower()
        if "catalogoproductoedit" in url_lower:
            m = re.search(r"ID_CatalogoProducto=(\d+)", url_final, re.IGNORECASE)
            id_creado = m.group(1) if m else "?"
            return True, f"Producto guardado — ID: {id_creado}", id_creado

        if r.status_code in (200, 302):
            texto = r.text.lower()
            if any(s in texto for s in
                   ["caracteristicaindex", "_caracteristicaotraindex",
                    "catalogoproductoedit", "id_catalogoproducto=2"]):
                m = re.search(r"ID_CatalogoProducto=(\d+)", r.text, re.IGNORECASE)
                id_creado = m.group(1) if m else "?"
                return True, f"Producto guardado — ID: {id_creado}", id_creado

        if r.status_code == 500:
            return False, "HTTP 500 — Token inválido o campos faltantes.", None
        if r.status_code == 403:
            return False, "HTTP 403 — Sin permisos o sesión expirada.", None
        if r.status_code == 302:
            loc = r.headers.get("Location", "")
            if "login" in loc.lower():
                return False, "Sesión expirada — vuelve a iniciar sesión.", None
            return True, f"Redirección 302 a: {loc}", None

        return False, f"Respuesta inesperada HTTP {r.status_code}", None
    except Exception as e:
        return False, f"Excepción: {str(e)}", None
    finally:
        for fh in handles:
            try:
                fh.close()
            except Exception:
                pass


def paso3_obtener_valores_caracteristica(session, id_producto, n_caracteristica):
    url = BASE_URL + "/t_CatalogoProductoMarca/ListarValoresCaracteristica"
    try:
        r = session.post(url,
            data=f"N_CatalogoProducto={id_producto}&N_Caracteristica={n_caracteristica}",
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
                "Accept": "*/*",
                "Referer": BASE_URL + f"/t_CatalogoProductoMarca/CatalogoProductoEdit"
                                      f"?ID_CatalogoProducto={id_producto}&C_EstadoNav=ACTIVO",
            },
            timeout=30)
        r.raise_for_status()
        texto = r.text.strip()
        if not texto or texto in ("null", "[]", ""):
            return []
        if texto.startswith("[") or texto.startswith("{"):
            import json
            datos = json.loads(texto)
            if isinstance(datos, list):
                resultado = []
                for item in datos:
                    if isinstance(item, dict):
                        val = str(item.get("Value") or item.get("value") or
                                   item.get("N_ValCaracteristica") or item.get("id") or "")
                        nom = html_lib.unescape(str(item.get("Text") or item.get("text") or
                                   item.get("C_ValCaracteristica") or item.get("nombre") or val))
                        if val and val != "0":
                            resultado.append((val, nom))
                return resultado
        opciones = re.findall(
            r'<option[^>]+value="?(\d+)"?[^>]*>([^<]+)</option>', texto, re.IGNORECASE)
        return [(v, html_lib.unescape(n.strip())) for v, n in opciones if v != "0"]
    except Exception as e:
        print(f"[LISTAR_VALORES] Error: {e}")
        return []


def paso3_obtener_token_y_primera_caracteristica(session, id_producto, n_categoria):
    url = BASE_URL + "/t_CatalogoProductoMarca/CaracteristicaCreate"
    try:
        r = session.get(url, params={
            "N_Categoria": n_categoria,
            "N_CatalogoProducto": id_producto,
            "C_EstadoNav": "ACTIVO",
        }, timeout=30)
        r.raise_for_status()
        html = r.text

        tokens = re.findall(
            r'<input[^>]+name="__RequestVerificationToken"[^>]+value="([^"]+)"', html, re.IGNORECASE)
        if not tokens:
            tokens = re.findall(
                r'<input[^>]+value="([^"]+)"[^>]+name="__RequestVerificationToken"', html, re.IGNORECASE)
        token = tokens[0] if tokens else ""

        m_select = re.search(
            r'<select[^>]+name="N_Caracteristica"[^>]*>(.*?)</select>', html, re.DOTALL | re.IGNORECASE)
        if not m_select:
            return token, None, None, None, False

        select_html = m_select.group(1)
        opciones_car = re.findall(
            r'<option[^>]+value="?(\d+)"?[^>]*>([^<]+)</option>', select_html, re.IGNORECASE)
        opciones_car = [(v, html_lib.unescape(nm.strip())) for v, nm in opciones_car if v != "0" and int(v) > 100]

        if not opciones_car:
            return token, None, None, None, False

        n_car_val, n_car_nombre = opciones_car[0]
        nombre_norm = normalize_label(n_car_nombre)

        if nombre_norm in CARACTERISTICAS_TEXTO_LIBRE:
            return token, n_car_val, n_car_nombre, "", False

        valores = paso3_obtener_valores_caracteristica(session, id_producto, n_car_val)
        if valores:
            return token, n_car_val, n_car_nombre, valores[0][0], True

        return token, n_car_val, n_car_nombre, "", False
    except Exception as e:
        print(f"[PASO3_TOKEN] Error: {e}")
        return "", None, None, None, False


def paso3_guardar_una_caracteristica(session, token, id_producto, n_caracteristica, valor, es_select):
    url = BASE_URL + "/t_CatalogoProductoMarca/CaracteristicaCreate"

    if es_select:
        fields = [
            ("__RequestVerificationToken", token),
            ("N_Caracteristica", str(n_caracteristica)),
            ("N_ValCaracteristica", str(valor)),
            ("N_ValCaracteristicaTXT", ""),
            ("N_ValCaracteristicaNUM", ""),
            ("D_ValCaracteristicaFecha", ""),
            ("N_CatalogoProducto", str(id_producto)),
            ("C_EstadoNav", "ACTIVO"),
        ]
    else:
        fields = [
            ("__RequestVerificationToken", token),
            ("N_Caracteristica", str(n_caracteristica)),
            ("N_ValCaracteristica", ""),
            ("N_ValCaracteristicaTXT", str(valor)),
            ("N_ValCaracteristicaNUM", ""),
            ("D_ValCaracteristicaFecha", ""),
            ("N_CatalogoProducto", str(id_producto)),
            ("C_EstadoNav", "ACTIVO"),
        ]

    encoder = MultipartEncoder(fields=fields)
    headers = {
        "Referer": BASE_URL + f"/t_CatalogoProductoMarca/CatalogoProductoEdit?ID_CatalogoProducto={id_producto}&C_EstadoNav=ACTIVO",
        "Origin": BASE_URL,
        "Content-Type": encoder.content_type,
    }

    try:
        r = session.post(url, data=encoder, headers=headers, allow_redirects=True, timeout=30)
        return r.status_code == 200
    except Exception as e:
        print(f"[PASO3_GUARDAR] Excepción: {e}")
        return False


# ─────────────────────────────────────────────────────────────────────────────
#  ESTADO GLOBAL DEL SERVICIO  (reemplaza a la clase AppSubirProducto de tkinter)
# ─────────────────────────────────────────────────────────────────────────────
_log_seq = count(1)


class Estado:
    def __init__(self):
        self.driver = None
        self.session = None
        self.cookies_list = None
        self.usuario = None
        self.password = None

        self.login_lock = threading.Lock()
        # desconectado | cargando | activa | perdida
        self.sesion_estado = "desconectado"
        self.procesando = False

        self.cola = []  # [{info, errores}]
        self.logs = []
        self.logs_lock = threading.Lock()

        self.keepalive_stop = threading.Event()
        self.keepalive_thread = None

        # Se genera una única vez cuando arranca el proceso. El frontend lo
        # compara en cada poll de /status: si cambia, significa que el
        # backend se reinició y el frontend debe resetear su cursor local de
        # logs (si no, sigue pidiendo "since=<numero_viejo>" contra un
        # contador de logs que volvió a empezar en 1 y nunca ve nada nuevo).
        self.boot_id = uuid.uuid4().hex

        # Señal para cancelar una subida en curso. Se revisa entre carpeta y
        # carpeta, y entre ficha y ficha — nunca a mitad de un guardado, para
        # no dejar un producto a medio subir.
        self.cancelar_event = threading.Event()

        self.progreso = {
            "activo": False,
            "usuario": None,
            "total": 0,
            "actual": 0,
            "codigo_actual": "",
            "carpeta_actual": "",
            "inicio_ts": None,
            "tiempos_por_ficha": [],
            "items": [],
        }

    def log(self, tag, msg):
        entry = {"id": next(_log_seq), "ts": datetime.now().strftime("%H:%M:%S"), "tag": tag, "msg": msg}
        with self.logs_lock:
            self.logs.append(entry)
            if len(self.logs) > 3000:
                self.logs = self.logs[-2000:]
        print(f"[{entry['ts']}] [{tag.upper()}] {msg}")


estado = Estado()


# ── KEEP-ALIVE / SESIÓN ──────────────────────────────────────────────────────
def _keepalive_loop():
    while not estado.keepalive_stop.wait(KEEPALIVE_INTERVAL):
        if estado.sesion_estado != "activa" or not estado.driver:
            continue
        try:
            with estado.login_lock:
                estado.driver.get(BASE_URL + "/Home/Index")
                time.sleep(2)
                nuevas_cookies = estado.driver.get_cookies()
                nueva_session = session_desde_cookies(nuevas_cookies)
                r_test = nueva_session.get(BASE_URL + "/Home/Index", timeout=20, allow_redirects=True)
                if r_test.status_code == 200 and "login" not in r_test.url.lower():
                    estado.session = nueva_session
                    estado.cookies_list = nuevas_cookies
                    estado.log("dim", "Sesión renovada automáticamente (keep-alive)")
                else:
                    raise ValueError(f"URL inesperada: {r_test.url}")
        except Exception:
            estado.log("warn", "Keep-alive falló — reintentando login...")
            _relogin_sincronizado()


def _iniciar_keepalive():
    estado.keepalive_stop.clear()
    if estado.keepalive_thread is None or not estado.keepalive_thread.is_alive():
        estado.keepalive_thread = threading.Thread(target=_keepalive_loop, daemon=True)
        estado.keepalive_thread.start()


def _relogin_sincronizado():
    with estado.login_lock:
        if not estado.usuario or not estado.password:
            estado.sesion_estado = "perdida"
            return False
        try:
            drv, ck = hacer_login(estado.usuario, estado.password, log_fn=estado.log)
            if drv:
                try:
                    if estado.driver:
                        estado.driver.quit()
                except Exception:
                    pass
                estado.driver = drv
                estado.cookies_list = ck
                estado.session = session_desde_cookies(ck)
                estado.sesion_estado = "activa"
                estado.log("ok", "Relogin exitoso — sesión activa")
                return True
            estado.sesion_estado = "perdida"
            estado.log("error", "Relogin falló")
            return False
        except Exception as e:
            estado.sesion_estado = "perdida"
            estado.log("error", f"Relogin error: {e}")
            return False


def _hacer_login_bg(usuario):
    estado.sesion_estado = "cargando"
    estado.usuario = usuario
    estado.password = USUARIOS[usuario]
    estado.log("info", f"Iniciando sesión: {usuario}...")
    driver, cookies = hacer_login(usuario, estado.password, log_fn=estado.log)
    if not driver:
        estado.log("error", "No se pudo iniciar sesión. Verifica credenciales.")
        estado.sesion_estado = "perdida"
        return
    try:
        if USE_LOGIN_MODULE:
            cerrar_ventanas_emergentes(driver)
    except Exception as e:
        estado.log("dim", f"Post-login (no crítico): {e}")

    estado.driver = driver
    estado.cookies_list = cookies
    estado.session = session_desde_cookies(cookies)

    estado.log("info", "Calentando sesión...")
    try:
        r = estado.session.get(CREATE_URL, timeout=30)
        estado.log("dim", f"Calentamiento OK — status {r.status_code}")
    except Exception as e:
        estado.log("warn", f"Calentamiento falló (no crítico): {e}")

    estado.sesion_estado = "activa"
    estado.log("ok", f"Sesión activa — {usuario}")
    _iniciar_keepalive()


# ── SUBIDA MASIVA (idéntico a _procesar_cola/_procesar_ficha/_rellenar_caracteristicas) ──
def _cola_resumen():
    return [
        {
            "codigo_base": it["info"]["codigo_base"],
            "num_fichas": len(it["info"]["fichas"]),
            "errores": it["errores"],
            "categoria": it.get("categoria"),
        }
        for it in estado.cola
    ]

def _procesar_cola(cola, n_acuerdo, n_catalogo, usuario_inicia):
    estado.procesando = True
    estado.cancelar_event.clear()

    total_fichas = sum(len(it["info"]["fichas"]) for it in cola)
    estado.progreso = {
        "activo": True, "usuario": usuario_inicia, "total": total_fichas, "actual": 0,
        "codigo_actual": "", "carpeta_actual": "", "inicio_ts": time.time(),
        "tiempos_por_ficha": [], "items": [],
    }

    estado.log("header", "=" * 60)
    estado.log("header", f"INICIANDO SUBIDA MASIVA — {len(cola)} carpeta(s)")
    estado.log("header", "=" * 60)

    resumen_global = {"ok": 0, "error": 0, "advertencias": 0}
    cancelado = False

    for i, item in enumerate(cola, start=1):
        if estado.cancelar_event.is_set():
            cancelado = True
            break

        info = item["info"]
        codigo_base = info["codigo_base"]

        categoria = item.get("categoria")
        if not categoria:
            estado.log("error", f"'{codigo_base}': sin categoría asignada — se omite")
            continue
        n_categoria, c_categoria = categoria["n_categoria"], categoria["c_categoria"]
        estado.progreso["carpeta_actual"] = codigo_base

        estado.log("header", f">>> CARPETA {i}/{len(cola)}: {codigo_base} ({len(info['fichas'])} fichas)")

        resumen = {"ok": [], "error": [], "advertencias": []}
        for j, ficha in enumerate(info["fichas"], start=1):
            if estado.cancelar_event.is_set():
                cancelado = True
                break
            t0 = time.time()
            estado.progreso["codigo_actual"] = ficha["codigo"]
            _procesar_ficha(info, ficha, n_acuerdo, n_catalogo, n_categoria, c_categoria, resumen)
            estado.progreso["actual"] += 1
            estado.progreso["tiempos_por_ficha"].append(time.time() - t0)
            estado.progreso["items"].append({
                "codigo": ficha["codigo"],
                "estado": "ok" if ficha["codigo"] in resumen["ok"] else "error",
            })

        resumen_global["ok"] += len(resumen["ok"])
        resumen_global["error"] += len(resumen["error"])
        resumen_global["advertencias"] += len(resumen["advertencias"])

        estado.log("header", f"--- {codigo_base}: {len(resumen['ok'])} OK / "
                              f"{len(resumen['error'])} con error / "
                              f"{len(resumen['advertencias'])} con advertencias ---")
        if resumen["error"]:
            estado.log("error", f"   Fichas con error: {', '.join(resumen['error'])}")
        if resumen["advertencias"]:
            for codigo, errs in resumen["advertencias"]:
                estado.log("warn", f"   {codigo}: {'; '.join(errs)}")

        if cancelado:
            break

    if cancelado:
        estado.log("warn", "=" * 60)
        estado.log("warn", "SUBIDA CANCELADA POR EL USUARIO")
        estado.log("warn", f"   Se alcanzó a procesar: {resumen_global['ok']} OK / "
                            f"{resumen_global['error']} con error")
        estado.log("warn", "=" * 60)
    else:
        estado.log("header", "=" * 60)
        estado.log("header", f"SUBIDA FINALIZADA — TOTAL: {resumen_global['ok']} OK / "
                              f"{resumen_global['error']} con error / "
                              f"{resumen_global['advertencias']} con advertencias")
        estado.log("header", "=" * 60)

    estado.progreso["activo"] = False
    estado.procesando = False
    estado.cancelar_event.clear()


def _procesar_ficha(info, ficha, n_acuerdo, n_catalogo, n_categoria, c_categoria, resumen):
    codigo = ficha["codigo"]
    precio = info["precio"]
    config = info["config"]
    estado.log("info", f"  Ficha {codigo}: iniciando...")

    session = estado.session

    campos = paso1_obtener_formulario(session, n_acuerdo, n_catalogo, n_categoria, c_categoria)
    if campos is None:
        estado.log("warn", f"  Ficha {codigo}: sesión parece expirada — renovando...")
        if not _relogin_sincronizado():
            estado.log("error", f"  Ficha {codigo}: ABORTADA — no se pudo renovar la sesión")
            resumen["error"].append(codigo)
            return
        session = estado.session
        campos = paso1_obtener_formulario(session, n_acuerdo, n_catalogo, n_categoria, c_categoria)
        if campos is None:
            estado.log("error", f"  Ficha {codigo}: ABORTADA — PASO 1 falló tras renovar sesión")
            resumen["error"].append(codigo)
            return

    if not campos.get("__RequestVerificationToken"):
        estado.log("error", f"  Ficha {codigo}: ABORTADA — token vacío en el formulario")
        resumen["error"].append(codigo)
        return

    ok, msg, id_creado = paso2_guardar_producto(session, campos, precio, ficha["imagen"], ficha["pdf"], None)
    if not ok:
        estado.log("warn", f"  Ficha {codigo}: PASO 2 falló ({msg}) — reintentando con sesión renovada...")
        if not _relogin_sincronizado():
            estado.log("error", f"  Ficha {codigo}: ABORTADA — no se pudo renovar la sesión para reintento")
            resumen["error"].append(codigo)
            return
        session = estado.session
        campos = paso1_obtener_formulario(session, n_acuerdo, n_catalogo, n_categoria, c_categoria)
        if campos is None or not campos.get("__RequestVerificationToken"):
            estado.log("error", f"  Ficha {codigo}: ABORTADA — PASO 1 falló en reintento")
            resumen["error"].append(codigo)
            return
        ok, msg, id_creado = paso2_guardar_producto(session, campos, precio, ficha["imagen"], ficha["pdf"], None)
        if not ok:
            estado.log("error", f"  Ficha {codigo}: {msg} (tras reintento)")
            resumen["error"].append(codigo)
            return

    if not id_creado or id_creado == "?":
        estado.log("error", f"  Ficha {codigo}: producto creado pero sin ID detectado — revisar manualmente")
        resumen["error"].append(codigo)
        return

    estado.log("ok", f"  Ficha {codigo}: producto creado (ID {id_creado})")

    codigo_color, color_nombre = detectar_color(codigo, info["codigo_base"])
    if color_nombre:
        estado.log("info", f"  Ficha {codigo}: color detectado -> '{codigo_color}' = {color_nombre}")
    else:
        estado.log("warn", f"  Ficha {codigo}: NO se pudo detectar color (código leído: '{codigo_color}')")

    ok_count, errores_car = _rellenar_caracteristicas(id_creado, n_categoria, config, codigo, color_nombre, session)

    resumen["ok"].append(codigo)
    if errores_car:
        resumen["advertencias"].append((codigo, errores_car))
        estado.log("warn", f"  Ficha {codigo}: producto ID {id_creado} creado con {len(errores_car)} "
                            f"característica(s) pendiente(s) — revisar manualmente")
    else:
        estado.log("ok", f"  Ficha {codigo}: completada con {ok_count} característica(s)")


def _rellenar_caracteristicas(id_producto, n_categoria, config, codigo_ficha, color_nombre, session):
    ok_count = 0
    errores = []
    ultima = None
    repeticiones = 0

    for _ in range(MAX_CARACTERISTICAS_ITER):
        time.sleep(0.4)

        token_car = n_car_val = n_car_nombre = primer_val_select = None
        es_select = False
        for _intento in range(5):
            token_car, n_car_val, n_car_nombre, primer_val_select, es_select = \
                paso3_obtener_token_y_primera_caracteristica(session, id_producto, n_categoria)
            if n_car_val != ultima:
                break
            time.sleep(0.5)

        if not n_car_val:
            break
        if not token_car:
            errores.append("token vacío al consultar características")
            break

        if n_car_val == ultima:
            repeticiones += 1
            if repeticiones >= 2:
                errores.append(f"{n_car_nombre}: el servidor repite la misma característica, se detuvo aquí")
                break
        else:
            ultima = n_car_val
            repeticiones = 0

        nombre_norm = normalize_label(n_car_nombre)

        if nombre_norm == "NRO PARTE" or nombre_norm == "CODIGO DE IDENTIFICACION UNICO":
            valor_deseado = codigo_ficha
            es_texto_libre = True
        elif nombre_norm == "MODELO":
            valor_deseado = config.get("MODELO")
            es_texto_libre = True
        elif "COLOR" in nombre_norm.split():
            valor_deseado = color_nombre
            es_texto_libre = False
            if valor_deseado is None:
                errores.append(f"{n_car_nombre}: no se pudo detectar el color desde el código '{codigo_ficha}'")
        else:
            valor_deseado = config.get(nombre_norm)
            es_texto_libre = nombre_norm in CARACTERISTICAS_TEXTO_LIBRE

        if valor_deseado is None:
            estado.log("warn", f"    {n_car_nombre}: sin valor en CONFIG.txt — se usará la primera opción del servidor")
            errores.append(f"{n_car_nombre}: no hay valor en CONFIG.txt — se usó la primera opción, REVISAR")
            valor_deseado = ""

        if es_texto_libre or not es_select:
            if not es_select:
                exito = paso3_guardar_una_caracteristica(
                    session, token_car, id_producto, n_car_val, valor_deseado, False)
                if exito:
                    ok_count += 1
                    estado.log("ok", f"    {n_car_nombre} = {valor_deseado}")
                else:
                    errores.append(f"{n_car_nombre}: fallo al guardar el texto '{valor_deseado}'")
                    break
                time.sleep(0.6)
                continue

        opciones = paso3_obtener_valores_caracteristica(session, id_producto, n_car_val)
        opcion_val = None
        opcion_texto_usada = None
        es_aproximado = False

        for val, texto in opciones:
            if normalize_label(texto) == normalize_label(valor_deseado):
                opcion_val, opcion_texto_usada = val, texto
                break

        if not opcion_val:
            vn = normalize_label(valor_deseado)
            if vn:
                vn_words = vn.split()
                nombre_car_words = set(nombre_norm.split())
                unidades_comunes = {"CM", "MM", "M", "KG", "GR", "LT", "ML",
                                    "UND", "UNI", "MESES", "ANIOS", "DIAS",
                                    "PULG", "PULGADAS"}
                candidatos = []
                for val, texto in opciones:
                    tn = normalize_label(texto)
                    tn_words = tn.split()
                    if vn_words and all(w in tn_words for w in vn_words):
                        extra = [w for w in tn_words if w not in vn_words]
                        aproximado = any(
                            len(w) > 3 and w not in nombre_car_words and w not in unidades_comunes
                            for w in extra
                        )
                        candidatos.append((val, texto, len(extra), aproximado))
                if candidatos:
                    candidatos.sort(key=lambda c: c[2])
                    opcion_val, opcion_texto_usada, _n, aprox = candidatos[0]
                    if aprox:
                        es_aproximado = True

        if not opcion_val:
            vn = normalize_label(valor_deseado)
            for val, texto in opciones:
                tn = normalize_label(texto)
                if vn and (vn in tn or tn in vn):
                    opcion_val, opcion_texto_usada = val, texto
                    es_aproximado = True
                    break

        if not opcion_val:
            palabras_v = set(normalize_label(valor_deseado).split())
            mejor_score = 0
            for val, texto in opciones:
                palabras_t = set(normalize_label(texto).split())
                score = len(palabras_v & palabras_t)
                if score > mejor_score:
                    mejor_score = score
                    opcion_val, opcion_texto_usada = val, texto
            if opcion_val:
                es_aproximado = True

        if not opcion_val and opciones:
            opcion_val, opcion_texto_usada = opciones[0]
            es_aproximado = True
            disponibles = ", ".join(t for _, t in opciones[:8])
            errores.append(
                f"{n_car_nombre}: valor '{valor_deseado}' NO coincide con ninguna opción — "
                f"se usó '{opcion_texto_usada}' como reemplazo, REVISAR "
                f"(disponibles: {disponibles}{'...' if len(opciones) > 8 else ''})"
            )
        elif not opciones:
            errores.append(f"{n_car_nombre}: el servidor no devolvió opciones — se omitió")
            continue
        elif es_aproximado:
            errores.append(f"{n_car_nombre}: coincidencia aproximada '{opcion_texto_usada}' para '{valor_deseado}' — revisar")

        valor_deseado = opcion_texto_usada

        exito = paso3_guardar_una_caracteristica(session, token_car, id_producto, n_car_val, opcion_val, True)
        if exito:
            ok_count += 1
            estado.log("ok", f"    {n_car_nombre} = {valor_deseado}")
        else:
            errores.append(f"{n_car_nombre}: fallo al guardar '{valor_deseado}' — se reintentará en la siguiente vuelta")
        time.sleep(0.6)

    return ok_count, errores


def _eliminar_producto_bg(id_elim):
    estado.log("warn", f"Eliminando producto ID: {id_elim}...")
    try:
        campos = paso1_edit_obtener_formulario(estado.session, id_elim)
        if not campos:
            estado.log("error", "No se pudo obtener el formulario — ID incorrecto o sesión expirada")
            return
        token = campos.get("__RequestVerificationToken", "")
        if not token:
            estado.log("error", "Token vacío — no se puede eliminar sin token")
            return

        delete_url = BASE_URL + "/t_CatalogoProductoMarca/CatalogoProductoDelete"
        fields = [
            ("__RequestVerificationToken", token),
            ("ID_CatalogoProducto", id_elim),
            ("C_EstadoNav", "ACTIVO"),
            ("btnEliminar", "Eliminar"),
        ]
        encoder = MultipartEncoder(fields=fields)
        headers = {
            "Referer": EDIT_URL + f"?ID_CatalogoProducto={id_elim}&C_EstadoNav=ACTIVO",
            "Origin": BASE_URL,
            "Content-Type": encoder.content_type,
        }
        r = estado.session.post(delete_url, data=encoder, headers=headers, allow_redirects=True, timeout=30)
        url_final = r.url.lower()
        texto = r.text.lower()
        if "catalogoproductoindex" in url_final or "catalogoproductoindex" in texto or r.status_code in (200, 302):
            if "login" in url_final:
                estado.log("error", "Sesión expirada durante la eliminación")
                return
            estado.log("ok", f"Producto ID {id_elim} eliminado correctamente")
        else:
            estado.log("error", f"HTTP {r.status_code} al eliminar")
    except Exception as e:
        estado.log("error", f"Excepción al eliminar: {e}")


# ─────────────────────────────────────────────────────────────────────────────
#  API
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="RAPIFICH API — Subida Masiva Peru Compras")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginReq(BaseModel):
    usuario: str


class RutaReq(BaseModel):
    ruta: str


class CodigoReq(BaseModel):
    codigo_base: str


class SubirReq(BaseModel):
    acuerdo: str


class EliminarReq(BaseModel):
    id_producto: str


@app.get("/")
def root():
    return {"servicio": "RAPIFICH API", "puerto": API_PORT, "sesion": estado.sesion_estado, "boot_id": estado.boot_id}


@app.get("/usuarios")
def get_usuarios():
    return {"usuarios": list(USUARIOS.keys())}


@app.get("/status")
def get_status():
    return {
        "logueado": estado.driver is not None,
        "usuario": estado.usuario,
        "sesion": estado.sesion_estado,
        "procesando": estado.procesando,
        "procesando_por": estado.progreso.get("usuario"),
        "progreso_actual": estado.progreso.get("actual"),
        "progreso_total": estado.progreso.get("total"),
        "cola": _cola_resumen(),
        # Cambia cada vez que se reinicia el proceso — el frontend lo usa
        # para saber que debe resetear su cursor de logs.
        "boot_id": estado.boot_id,
    }


@app.get("/progreso")
def get_progreso():
    p = estado.progreso
    restante = None
    if p["activo"] and p["tiempos_por_ficha"]:
        promedio = sum(p["tiempos_por_ficha"]) / len(p["tiempos_por_ficha"])
        restante = round(promedio * (p["total"] - p["actual"]))
    return {**p, "segundos_restantes_estimados": restante}

@app.post("/login")
def login(req: LoginReq):
    if req.usuario not in USUARIOS:
        return {"ok": False, "error": "Usuario no válido"}
    if estado.sesion_estado == "cargando":
        return {"ok": False, "error": "Ya hay un login en curso"}
    threading.Thread(target=_hacer_login_bg, args=(req.usuario,), daemon=True).start()
    return {"ok": True}


@app.post("/logout")
def logout():
    estado.keepalive_stop.set()
    try:
        if estado.driver:
            estado.driver.quit()
    except Exception:
        pass
    estado.driver = None
    estado.session = None
    estado.usuario = None
    estado.password = None
    estado.sesion_estado = "desconectado"
    estado.log("dim", "Sesión cerrada")
    return {"ok": True}


@app.post("/renovar")
def renovar():
    if not estado.usuario:
        return {"ok": False, "error": "No hay usuario logueado"}
    estado.log("info", "Renovando sesión manualmente...")
    threading.Thread(target=_relogin_sincronizado, daemon=True).start()
    return {"ok": True}


@app.get("/acuerdos")
def get_acuerdos():
    resultado = []
    for nombre, data in ACUERDOS.items():
        resultado.append({
            "nombre": nombre,
            "categorias": [{"n_categoria": c[0], "c_categoria": c[1]} for c in data["categorias"]],
        })
    return {"acuerdos": resultado}


@app.get("/fs/unidades")
def fs_unidades():
    """Ya no se listan discos locales — el explorador arranca directo en
    la carpeta compartida de fichas, que es la única raíz permitida."""
    p = Path(CARPETA_COMPARTIDA_RAIZ)
    if not p.exists():
        return {"unidades": [], "error": f"No se pudo acceder a {CARPETA_COMPARTIDA_RAIZ}"}
    return {"unidades": [str(p)]}


@app.get("/fs/accesos")
def fs_accesos():
    """Único acceso directo permitido: la carpeta compartida de fichas."""
    p = Path(CARPETA_COMPARTIDA_RAIZ)
    if p.exists():
        return {"accesos": [{"nombre": "Fichas compartidas", "ruta": str(p)}]}
    return {"accesos": []}


@app.get("/fs/listar")
def fs_listar(ruta: str):
    """Lista las subcarpetas de 'ruta' para el explorador de carpetas del frontend.
    Marca 'es_base' = True si esa subcarpeta ya tiene CONFIG.txt + FICHAS + IMAGENES."""
    p = Path(ruta)
    raiz = Path(CARPETA_COMPARTIDA_RAIZ)
    try:
        p.relative_to(raiz)
        dentro = True
    except ValueError:
        dentro = (p == raiz)
    if not dentro:
        return {"ok": False, "error": "Solo puedes navegar dentro de la carpeta compartida de fichas"}
    if not p.exists() or not p.is_dir():
        return {"ok": False, "error": "Esa ruta no existe o no es una carpeta"}

    carpetas = []
    try:
        for sub in sorted(p.iterdir(), key=lambda x: x.name.lower()):
            if not sub.is_dir():
                continue
            try:
                es_base = (sub / "CONFIG.txt").exists() and (sub / "FICHAS").exists() and (sub / "IMAGENES").exists()
            except Exception:
                es_base = False
            carpetas.append({"nombre": sub.name, "ruta": str(sub), "es_base": es_base})
    except PermissionError:
        return {"ok": False, "error": "Sin permisos para leer esa carpeta"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

    try:
        padre = None if p == raiz else str(p.parent)
    except Exception:
        padre = None

    return {"ok": True, "ruta": str(p), "padre": padre, "carpetas": carpetas}


@app.post("/carpeta/explorar")
def explorar_carpeta(req: RutaReq):
    bases = detectar_carpetas_base(req.ruta)
    if not bases:
        return {"ok": False, "error": "No se encontró ninguna carpeta válida (CONFIG.txt + FICHAS/ + IMAGENES/) en esa ruta ni en sus subcarpetas."}
    resultado = []
    for base in bases:
        info, errores = escanear_carpeta_base(base)
        if info is None:
            resultado.append({"codigo_base": base.name, "valido": False, "errores": errores})
        else:
            resultado.append({"codigo_base": info["codigo_base"], "valido": True,
                               "num_fichas": len(info["fichas"]), "errores": errores})
    return {"ok": True, "carpetas": resultado}


@app.post("/cola/agregar")
def cola_agregar(req: RutaReq):
    raiz = Path(CARPETA_COMPARTIDA_RAIZ)
    try:
        Path(req.ruta).relative_to(raiz)
    except ValueError:
        if Path(req.ruta) != raiz:
            return {"ok": False, "error": "Solo se permiten carpetas dentro de la carpeta compartida"}
    bases = detectar_carpetas_base(req.ruta)
    if not bases:
        return {"ok": False, "error": "No se encontró ninguna carpeta válida en esa ruta."}

    existentes = {item["info"]["carpeta"] for item in estado.cola}
    agregadas = []
    for base in bases:
        if base in existentes:
            continue
        info, errores = escanear_carpeta_base(base)
        if info is None:
            estado.log("error", f"'{base.name}' no se pudo agregar: {'; '.join(errores)}")
            continue
        estado.cola.append({"info": info, "errores": errores, "categoria": None})
        agregadas.append(info["codigo_base"])
        estado.log("ok" if not errores else "warn",
                    f"Agregada a la cola: {info['codigo_base']} ({len(info['fichas'])} fichas)")
        for err in errores:
            estado.log("warn", f"   - {err}")

    if not agregadas:
        return {"ok": False, "error": "Las carpetas detectadas ya estaban en la cola o no eran válidas.", "cola": _cola_resumen()}
    return {"ok": True, "agregadas": agregadas, "cola": _cola_resumen()}


@app.post("/cola/quitar")
def cola_quitar(req: CodigoReq):
    estado.cola = [it for it in estado.cola if it["info"]["codigo_base"] != req.codigo_base]
    estado.log("dim", f"Quitada de la cola: {req.codigo_base}")
    return {"ok": True, "cola": _cola_resumen()}


class AsignarCategoriaReq(BaseModel):
    codigo_base: str
    n_categoria: str
    c_categoria: str


@app.post("/cola/categoria")
def cola_categoria(req: AsignarCategoriaReq):
    for it in estado.cola:
        if it["info"]["codigo_base"] == req.codigo_base:
            it["categoria"] = {"n_categoria": req.n_categoria, "c_categoria": req.c_categoria}
            return {"ok": True, "cola": _cola_resumen()}
    return {"ok": False, "error": "Carpeta no encontrada en la cola"}




@app.post("/cola/limpiar")
def cola_limpiar():
    estado.cola = []
    estado.log("dim", "Cola vaciada")
    return {"ok": True}


@app.post("/subir")
def subir(req: SubirReq):
    if estado.sesion_estado != "activa":
        return {"ok": False, "error": "No hay sesión activa. Inicia sesión primero."}
    if estado.procesando:
        return {
            "ok": False,
            "error": f"Ya hay una subida en curso ({estado.progreso['usuario']}) — "
                     f"{estado.progreso['actual']}/{estado.progreso['total']}. Vuelve a intentar en un momento.",
        }
    if not estado.cola:
        return {"ok": False, "error": "La cola de carpetas está vacía."}
    if req.acuerdo not in ACUERDOS:
        return {"ok": False, "error": "Acuerdo marco inválido."}

    sin_categoria = [it["info"]["codigo_base"] for it in estado.cola if not it.get("categoria")]
    if sin_categoria:
        return {"ok": False, "error": f"Falta asignar categoría a: {', '.join(sin_categoria)}"}

    data = ACUERDOS[req.acuerdo]
    cola_copia = list(estado.cola)
    threading.Thread(
        target=_procesar_cola,
        args=(cola_copia, data["N_Acuerdo"], data["N_Catalogo"], estado.usuario),
        daemon=True,
    ).start()
    return {"ok": True}


@app.post("/subir/cancelar")
def subir_cancelar():
    """Solicita cancelar la subida en curso. No corta un guardado a la mitad:
    se detiene apenas termina la ficha que está procesando en ese momento."""
    if not estado.procesando:
        return {"ok": False, "error": "No hay ninguna subida en curso."}
    estado.cancelar_event.set()
    estado.log("warn", "Cancelación solicitada por el usuario — se detendrá al terminar la ficha actual.")
    return {"ok": True}


@app.post("/eliminar")
def eliminar(req: EliminarReq):
    if estado.sesion_estado != "activa":
        return {"ok": False, "error": "No hay sesión activa."}
    threading.Thread(target=_eliminar_producto_bg, args=(req.id_producto,), daemon=True).start()
    return {"ok": True}


@app.get("/logs")
def get_logs(since: int = 0):
    with estado.logs_lock:
        nuevos = [e for e in estado.logs if e["id"] > since]
    return {"logs": nuevos}


@app.post("/logs/limpiar")
def logs_limpiar():
    with estado.logs_lock:
        estado.logs = []
    estado.log("dim", "Log de operaciones limpiado")
    return {"ok": True}


if __name__ == "__main__":
    print("=" * 60)
    print(f"  RAPIFICH API — escuchando en 0.0.0.0:{API_PORT}")
    print(f"  boot_id: {estado.boot_id}")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=API_PORT)