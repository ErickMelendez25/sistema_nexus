"""
MEF SCRAPER - INDUSTRIAL GRADE FINAL
------------------------------------
✔ Acepta frontend dinámico (470, 15241, etc)
✔ Normaliza automáticamente
✔ Maneja JSF hidden inputs completos
✔ Sesión robusta por intento
✔ Captura captcha tolerante (NO rígido)
✔ OCR híbrido estable
✔ Debug real de fallos
✔ Evita loops inútiles
✔ API lista producción
"""

import io
import re
import time
import logging
import requests
import numpy as np
import cv2

from PIL import Image
from bs4 import BeautifulSoup
from typing import Optional, Dict, Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# ============================================================
# LOGGING
# ============================================================
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("MEF")

# ============================================================
# CONFIG
# ============================================================
BASE_URL = "https://apps2.mef.gob.pe/consulta-vfp-webapp/consultaExpediente.jspx"
ACTION_URL = "https://apps2.mef.gob.pe/consulta-vfp-webapp/actionConsultaExpediente.jspx"
CAPTCHA_URL = "https://apps2.mef.gob.pe/consulta-vfp-webapp/Captcha.jpg"

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Referer": BASE_URL,
}

MAX_INTENTOS = 4
TIMEOUT = 20

# ============================================================
# REQUEST MODEL (FRONTEND FLEXIBLE)
# ============================================================
class ConsultaReq(BaseModel):
    sec_ejec: str
    expediente: str


# ============================================================
# NORMALIZACIÓN INTELIGENTE
# ============================================================
def normalize(sec, exp):
    sec = str(sec).strip()
    exp = str(exp).strip()

    if not sec.isdigit() or not exp.isdigit():
        raise ValueError("Solo valores numéricos permitidos")

    # MEF padding real
    sec = sec.zfill(6)
    exp = exp.zfill(10)

    return sec, exp


# ============================================================
# PREPROCESAMIENTO CAPTCHA
# ============================================================
def preprocess(img_bytes):
    img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    arr = np.array(img).astype(np.int16)

    r = arr[:, :, 0]
    g = arr[:, :, 1]
    b = arr[:, :, 2]

    mask = (b - r) > 12

    out = np.full(r.shape, 255, dtype=np.uint8)
    out[mask] = 0

    # 🔽 NUEVO: eliminar manchitas/ruido sueltas (componentes muy pequeñas)
    inv = cv2.bitwise_not(out)  # letras en blanco sobre fondo negro
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(inv, connectivity=8)
    clean = np.zeros_like(inv)
    for i in range(1, n_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        if area >= 15:  # descarta manchas menores a 15 px (ruido, no letras)
            clean[labels == i] = 255
    out = cv2.bitwise_not(clean)

    out = cv2.resize(out, None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)

    kernel = np.ones((3, 3), np.uint8)
    out = cv2.morphologyEx(out, cv2.MORPH_CLOSE, kernel, iterations=2)

    return Image.fromarray(out)
# ============================================================
# CAPTCHA ROBUSTO (INDUSTRIAL)
# ============================================================
import itertools

CONFUSIONES = {
    "0": ["o"], "o": ["0", "p"], "p": ["o"],
    "1": ["l"], "l": ["1"],
    "5": ["s"], "s": ["5"],
    "8": ["6", "b", "e"], "6": ["8", "g"], "b": ["8"], "g": ["6", "9"], "9": ["g"],
    "e": ["c", "8"], "c": ["e"],
    "2": ["z"], "z": ["2"],
    "u": ["v", "n"], "v": ["u", "r"], "n": ["i", "u", "r"],
    "i": ["n", "f"], "f": ["i"], "r": ["n", "v"],
}

def generar_variantes(palabra: str, max_variantes=60):
    opciones_por_posicion = []
    for ch in palabra:
        opciones = [ch] + CONFUSIONES.get(ch, [])
        opciones_por_posicion.append(opciones)

    variantes = set()
    for combo in itertools.product(*opciones_por_posicion):
        variantes.add("".join(combo))
        if len(variantes) >= max_variantes:
            break

    return list(variantes)

def solve_captcha(img_bytes) -> list:
    img = preprocess(img_bytes)

    candidates = []

    try:
        import pytesseract
        t = pytesseract.image_to_string(
            img,
            config="--psm 8 -c tessedit_char_whitelist=abcdefghijklmnopqrstuvwxyz0123456789"
        )
        t = re.sub(r"[^a-zA-Z0-9]", "", t).lower()
        if t:
            candidates.append(t)
    except:
        pass

    try:
        import easyocr
        reader = easyocr.Reader(["en"], gpu=False, verbose=False)
        t = "".join(reader.readtext(np.array(img), detail=0))
        t = re.sub(r"[^a-zA-Z0-9]", "", t).lower()
        if t:
            candidates.append(t)
    except:
        pass

    base_5 = [c for c in candidates if len(c) == 5]
    if not base_5 and candidates:
        candidates.sort(key=len, reverse=True)
        for c in candidates:
            if len(c) >= 4:
                base_5.append(c[:5])

    todas = []
    for palabra in base_5:
        todas.extend(generar_variantes(palabra, max_variantes=60))

    vistas = set()
    resultado = []
    for c in todas:
        if c not in vistas:
            vistas.add(c)
            resultado.append(c)

    return resultado


def solve_captcha_ddddocr(img_bytes) -> Optional[str]:
    try:
        import ddddocr
        ocr = ddddocr.DdddOcr(show_ad=False)
        texto = ocr.classification(img_bytes)
        texto = re.sub(r"[^a-zA-Z0-9]", "", texto).lower()
        return texto if len(texto) == 5 else None
    except Exception as e:
        logger.warning(f"ddddocr falló: {e}")
        return None


# ============================================================
# JSF HELPERS
# ============================================================
def extract_hidden(html: str):
    soup = BeautifulSoup(html, "html.parser")

    hidden = {}
    for inp in soup.find_all("input", type="hidden"):
        name = inp.get("name")
        val = inp.get("value", "")
        if name:
            hidden[name] = val

    return hidden


def is_error(html: str) -> bool:
    t = html.lower()

    return (
        ("captcha" in t and "incorrecto" in t) or
        ("captcha" in t and "inválido" in t)
    )

def parse_result(html: str) -> Optional[dict]:
    soup = BeautifulSoup(html, "html.parser")

    # 🔽 confirmar que sí hubo resultados (MEF muestra este mensaje cuando encuentra datos)
    banner = soup.find("span", class_="pagebanner")
    if not banner or "found" not in banner.get_text(strip=True).lower():
        return None

    table = soup.find("table", id="expedienteDetalles")
    if not table:
        table = soup.find("table")
    if not table:
        return None

    # 🔽 encabezados desde <thead>
    headers = []
    thead = table.find("thead")
    if thead:
        headers = [th.get_text(strip=True) for th in thead.find_all("th")]

    # 🔽 filas de datos desde <tbody>
    filas = []
    tbody = table.find("tbody")
    if tbody:
        for row in tbody.find_all("tr"):
            celdas = [td.get_text(strip=True) for td in row.find_all("td")]
            if headers and len(celdas) == len(headers):
                filas.append(dict(zip(headers, celdas)))
            elif celdas:
                filas.append({"columnas": celdas})

    if not filas:
        return None


    # ==========================================================
    # EXTRAER DATOS SUPERIORES (INPUTS DEL MEF)
    # ==========================================================

    def valor_input(nombre):
        inp = soup.find("input", {"name": nombre})
        if inp:
            return inp.get("value", "").strip()
        return ""

    datos = {
        "anio": valor_input("anoEje"),
        "entidad": valor_input("secEjec"),
        "nombreEntidad": valor_input("secEjecNombre"),
        "expediente": valor_input("expediente"),
        "tipoOperacion": valor_input("tipoOperacion"),
        "descripcionOperacion": valor_input("tipoOperacionNombre"),
        "modalidadCompra": valor_input("modalidadCompra"),
        "descripcionModalidad": valor_input("modalidadCompraNombre"),
        "tipoProceso": valor_input("tipoProceso"),
        "descripcionProceso": valor_input("tipoProcesoNombre"),
    }

    return {

        "anio": datos["anio"],

        "entidad": datos["entidad"],

        "nombreEntidad": datos["nombreEntidad"],

        "expediente": datos["expediente"],

        "tipoOperacion": datos["tipoOperacion"],

        "descripcionOperacion": datos["descripcionOperacion"],

        "modalidadCompra": datos["modalidadCompra"],

        "descripcionModalidad": datos["descripcionModalidad"],

        "tipoProceso": datos["tipoProceso"],

        "descripcionProceso": datos["descripcionProceso"],

        "registros": filas

    }



import os
os.makedirs("debug_mef", exist_ok=True)

# ============================================================
# CORE ENGINE
# ============================================================
def consultar_mef(sec_ejec, expediente) -> Dict[str, Any]:

    try:
        sec_ejec, expediente = normalize(sec_ejec, expediente)
    except Exception as e:
        return {"ok": False, "error": str(e)}

    for intento in range(1, MAX_INTENTOS + 1):

        try:
            session = requests.Session()
            session.headers.update(HEADERS)

            # 1. GET
            r = session.get(BASE_URL, timeout=TIMEOUT)
            html = r.text

            time.sleep(0.2)

            hidden = extract_hidden(html)

            # 2. CAPTCHA
# 2. CAPTCHA
            cap = session.get(CAPTCHA_URL, timeout=TIMEOUT)

            # 🔥 seguridad sesión rota
            if len(cap.content) < 300:
                logger.warning(f"[{intento}] captcha inválido (sesión rota)")
                continue

            # 🔽 NUEVO: guarda la imagen cruda del captcha
            with open(f"debug_mef/intento{intento}_raw.jpg", "wb") as f:
                f.write(cap.content)

            # 🔽 NUEVO: guarda la imagen ya procesada (la que ve el OCR)
            preprocess(cap.content).save(f"debug_mef/intento{intento}_pre.png")

            candidatos = solve_captcha(cap.content)
            logger.info(f"[{intento}] OCR generó {len(candidatos)} candidatos: {candidatos}")

            # 🔽 NUEVO: probar ddddocr (gratis, corre en tu PC)
            resultado_ddddocr = solve_captcha_ddddocr(cap.content)
            if resultado_ddddocr:
                logger.info(f"[{intento}] ddddocr leyó: {resultado_ddddocr}")
                candidatos = [resultado_ddddocr] + candidatos

            if not candidatos:
                logger.info(f"[{intento}] captcha no leído")
                continue
            if resultado_ddddocr:
                logger.info(f"[{intento}] ddddocr leyó: {resultado_ddddocr}")
                candidatos = [resultado_ddddocr] + candidatos

            if not candidatos:
                logger.info(f"[{intento}] captcha no leído")
                continue

       
            exito = False
            for idx, captcha in enumerate(candidatos, start=1):

                payload = {
                    **hidden,
                    "anoEje": "2026",
                    "secEjec": sec_ejec,
                    "expediente": expediente,
                    "j_captcha": captcha
                }

                r2 = session.post(ACTION_URL, data=payload, timeout=TIMEOUT)
                html2 = r2.text

                print(f"[INTENTO {intento}.{idx}] CAPTCHA={captcha}")

                with open(f"debug_mef/intento{intento}_{idx}_resp.html", "w", encoding="utf-8") as f:
                    f.write(html2)

                if is_error(html2):
                    logger.warning(f"[{intento}.{idx}] is_error=True con captcha={captcha}")
                    continue

                data = parse_result(html2)

                if data:
                    exito = True
                    return {
                        "ok": True,
                        "intentos": f"{intento}.{idx}",
                        "sec_ejec": sec_ejec,
                        "expediente": expediente,
                        "data": data
                    }

            if not exito:
                continue
        except Exception as e:
            logger.warning(f"error intento {intento}: {e}")
            continue

    return {
        "ok": False,
        "error": "No se pudo resolver expediente (MEF bloqueo o captcha)"
    }


# ============================================================
# FASTAPI
# ============================================================
router = APIRouter(prefix="/mef", tags=["MEF"])


@router.post("/consultar")
def endpoint(body: ConsultaReq):

    result = consultar_mef(body.sec_ejec, body.expediente)

    if not result["ok"]:
        raise HTTPException(
            status_code=422,
            detail=result
        )

    return result


# ============================================================
# TEST LOCAL
# ============================================================
if __name__ == "__main__":
    print(consultar_mef("751", "611"))