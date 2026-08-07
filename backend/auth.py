"""
Helbot - auth.py
-----------------
Login simple con usuario/contraseña guardados en MySQL (tabla
usuarios_helbot) + token JWT. El token viaja en el header
"Authorization: Bearer <token>" y guarda el id de usuario y sus
catalogos_permitidos, para que el resto de la API filtre sin volver
a consultar la DB en cada request.

TODO: cambiar JWT_SECRET por una variable de entorno real en producción.
"""

import os
import json
import logging
from datetime import datetime, timedelta

import jwt
from passlib.context import CryptContext
from fastapi import APIRouter, HTTPException, Header, Depends, Request
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from db import get_conn

limiter = Limiter(key_func=get_remote_address)

logger = logging.getLogger("helbot.auth")

JWT_SECRET = os.getenv("JWT_SECRET", "cambia-esto-en-produccion")
JWT_ALGORITHM = "HS256"
JWT_EXP_HORAS = 12

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class UsuarioToken(BaseModel):
    id: int
    username: str
    nombre_completo: str | None = None
    rol: str
    catalogos_permitidos: list[int] | None = None
    foto_perfil: str | None = None

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verificar_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def crear_token(usuario: dict) -> str:
    payload = {
        "id": usuario["id"],
        "username": usuario["username"],
        "nombre_completo": usuario.get("nombre_completo"),
        "rol": usuario.get("rol", "seguimiento"),
        "catalogos_permitidos": usuario.get("catalogos_permitidos"),
        "foto_perfil": usuario.get("foto_perfil"),
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXP_HORAS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decodificar_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sesión expirada, vuelve a iniciar sesión")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


def obtener_usuario_actual(
    authorization: str | None = Header(default=None),
    token: str | None = None,
) -> UsuarioToken:
    """Dependency de FastAPI: valida la sesión y devuelve los datos del
    usuario logueado (incluye catalogos_permitidos).

    Acepta el JWT de DOS formas:
    1) Header "Authorization: Bearer <token>" — lo que ya usa el frontend
       en cada fetch normal (fetchConToken).
    2) Query param "?token=<token>" — necesario para links que se pegan
       directo en la barra de direcciones de otro navegador (ej. "Copiar
       link" de un PDF), porque ahí no hay forma de mandar un header.
    """
    token_final = None
    if authorization and authorization.startswith("Bearer "):
        token_final = authorization.removeprefix("Bearer ").strip()
    elif token:
        token_final = token

    if not token_final:
        raise HTTPException(status_code=401, detail="Falta el token de sesión")

    payload = decodificar_token(token_final)
    return UsuarioToken(**payload)

@router.post("/auth/login")
@limiter.limit("5/minute")
def login(request: Request, body: LoginRequest):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM usuarios_helbot WHERE username = %s AND activo = TRUE",
                (body.username,),
            )
            usuario = cur.fetchone()
    finally:
        conn.close()

    if not usuario or not verificar_password(body.password, usuario["password_hash"]):
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrectos")

    catalogos = usuario.get("catalogos_permitidos")
    if catalogos:
        catalogos = json.loads(catalogos) if isinstance(catalogos, str) else catalogos

    token = crear_token(
        {
            "id": usuario["id"],
            "username": usuario["username"],
            "nombre_completo": usuario.get("nombre_completo"),
            "rol": usuario.get("rol", "seguimiento"),
            "catalogos_permitidos": catalogos,
            "foto_perfil": usuario.get("foto_perfil"),
        }
    )

    return {
        "token": token,
        "usuario": {
            "id": usuario["id"],
            "username": usuario["username"],
            "nombre_completo": usuario.get("nombre_completo"),
            "rol": usuario.get("rol", "seguimiento"),
            "catalogos_permitidos": catalogos,
            "foto_perfil": usuario.get("foto_perfil"),
        },
    }


@router.get("/auth/me")
def me(usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM usuarios_helbot WHERE id = %s AND activo = TRUE",
                (usuario.id,),
            )
            fila = cur.fetchone()
    finally:
        conn.close()

    if not fila:
        raise HTTPException(status_code=401, detail="Usuario no encontrado o inactivo")

    catalogos = fila.get("catalogos_permitidos")
    if catalogos:
        catalogos = json.loads(catalogos) if isinstance(catalogos, str) else catalogos

    return UsuarioToken(
        id=fila["id"],
        username=fila["username"],
        nombre_completo=fila.get("nombre_completo"),
        rol=fila.get("rol", "seguimiento"),
        catalogos_permitidos=catalogos,
        foto_perfil=fila.get("foto_perfil"),
    )