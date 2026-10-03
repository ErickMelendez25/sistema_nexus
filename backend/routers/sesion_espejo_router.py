"""
sesion_espejo_router.py
-----------------------
MODO ESPEJO: conecta el bot usando las cookies de una sesión que una persona
ya tiene abierta en su navegador. No hace login, así que no echa a nadie.
"""

import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from perucompras_login import perucompras_sesiones

logger = logging.getLogger("helbot.espejo")

router = APIRouter(prefix="/sesion/perucompras", tags=["perucompras-espejo"])

DOMINIO_COOKIES = "catalogos.perucompras.gob.pe"


class EspejoIn(BaseModel):
    uid: str
    cookies: str  # el valor del header "Cookie" tal cual: "a=1; b=2; c=3"


def _parsear_cookies(texto: str) -> list[dict]:
    texto = (texto or "").strip()
    if texto.lower().startswith("cookie:"):
        texto = texto[len("cookie:"):].strip()
    cookies = []
    for trozo in texto.split(";"):
        trozo = trozo.strip()
        if "=" not in trozo:
            continue
        nombre, valor = trozo.split("=", 1)
        nombre, valor = nombre.strip(), valor.strip()
        if nombre:
            cookies.append({"name": nombre, "value": valor, "domain": DOMINIO_COOKIES, "path": "/"})
    return cookies


@router.post("/login-espejo")
def login_espejo(body: EspejoIn):
    sesion = perucompras_sesiones.sesion(body.uid)
    cfg = perucompras_sesiones.usuarios.get(body.uid)
    if sesion is None or cfg is None:
        raise HTTPException(404, "Ese usuario no existe en la configuración")

    cookies = _parsear_cookies(body.cookies)
    if not cookies:
        raise HTTPException(400, "No se encontraron cookies. Pega el valor del header 'Cookie' completo.")

    ok, error = sesion.login_espejo(cfg["usuario"], cookies)
    if not ok:
        logger.warning("Modo espejo rechazado para uid=%s: %s", body.uid, error)
        raise HTTPException(400, error)
    return {"ok": True, "uid": body.uid, "espejo": True}