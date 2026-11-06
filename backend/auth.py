"""
Helbot - auth.py
-----------------
Login con usuario/contraseña + segundo factor TOTP (app autenticadora) + sesión única.
- /auth/login            paso 1 (contraseña) -> token temporal (o sesión si aún no activó 2FA)
- /auth/verificar-2fa    paso 2 (código)     -> token de sesión
- /auth/2fa/iniciar      autoactivación: valida contraseña + código de invitación, devuelve QR
- /auth/2fa/confirmar    autoactivación: valida el primer código y deja el 2FA activo

Sesión única: cada login nuevo genera un "sid" y lo guarda en la BD. Los tokens
anteriores quedan inválidos (la sesión vieja es expulsada).
"""

import os
import io
import json
import time
import asyncio
import base64
import hashlib
import secrets
import logging
from datetime import datetime, timedelta

import jwt
import pyotp
import qrcode
from cryptography.fernet import Fernet
from passlib.context import CryptContext
from fastapi import APIRouter, HTTPException, Header, Depends, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from db import get_conn

limiter = Limiter(key_func=get_remote_address)

logger = logging.getLogger("helbot.auth")

# Sin valor por defecto: si falta en el .env, el backend no arranca.
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
JWT_EXP_HORAS = 12

fernet = Fernet(os.environ["TOTP_KEY"].encode())

# false = quien aún no activó su 2FA puede entrar solo con contraseña (periodo de transición)
# true  = el 2FA es obligatorio para todos
MFA_OBLIGATORIO = os.getenv("MFA_OBLIGATORIO", "false").lower() == "true"

# 0 = solo vale el código que muestra la app AHORA (el anterior ya no sirve).
# Si algún celular tiene el reloj desfasado, ponlo en 1 en el .env (pero entonces
# vuelve a valer el código anterior).
TOTP_VENTANA = int(os.getenv("TOTP_VENTANA", "0"))


def _verificar_totp(secreto: str, codigo: str, ultimo_paso: int = 0) -> int | None:
    """Devuelve el paso de 30 s que coincide con el código, o None si no vale.
    Un paso <= ultimo_paso se rechaza (el código ya se usó)."""
    if not codigo.isdigit() or len(codigo) != 6:
        return None
    totp = pyotp.TOTP(secreto)
    ahora = int(time.time() // 30)
    for paso in range(ahora - TOTP_VENTANA, ahora + TOTP_VENTANA + 1):
        if paso <= ultimo_paso:
            continue
        if secrets.compare_digest(totp.at(paso * 30), codigo):
            return paso
    return None

MSG_SESION_DESPLAZADA = (
    "Tu sesión se cerró porque se inició sesión con tu usuario en otro dispositivo. "
    "Si no fuiste tú, avisa al administrador."
)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class Verificar2FA(BaseModel):
    temp_token: str
    codigo: str


class IniciarEnrolamiento(BaseModel):
    username: str
    password: str
    codigo_invitacion: str


class ConfirmarEnrolamiento(BaseModel):
    enrol_token: str
    codigo: str


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


def _hash_invitacion(codigo: str) -> str:
    limpio = codigo.replace("-", "").replace(" ", "").upper()
    return hashlib.sha256(limpio.encode()).hexdigest()


def _qr_base64(uri: str) -> str:
    buf = io.BytesIO()
    qrcode.make(uri).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def crear_token(usuario: dict) -> str:
    payload = {
        "scope": "full",
        "tv": usuario.get("token_version", 0),
        "sid": usuario.get("sid"),
        "id": usuario["id"],
        "username": usuario["username"],
        "nombre_completo": usuario.get("nombre_completo"),
        "rol": usuario.get("rol", "seguimiento"),
        "catalogos_permitidos": usuario.get("catalogos_permitidos"),
        "foto_perfil": usuario.get("foto_perfil"),
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXP_HORAS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def crear_token_temporal(user_id: int, scope: str, minutos: int) -> str:
    """Token de corta vida que NO da acceso a la API, solo a un paso concreto."""
    payload = {
        "scope": scope,
        "id": user_id,
        "exp": datetime.utcnow() + timedelta(minutes=minutos),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decodificar_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sesión expirada, vuelve a iniciar sesión")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


# Cache de 5 s: consulta si el usuario sigue activo, si su sesión no fue revocada
# y si sigue siendo la sesión vigente (sesión única).
_cache_estado: dict[int, tuple[float, dict | None]] = {}
CACHE_SEGUNDOS = 5


def _estado_usuario(user_id: int) -> dict | None:
    ahora = time.time()
    hit = _cache_estado.get(user_id)
    if hit and ahora - hit[0] < CACHE_SEGUNDOS:
        return hit[1]
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT activo, token_version, sesion_id FROM usuarios_helbot WHERE id = %s",
                (user_id,),
            )
            fila = cur.fetchone()
    finally:
        conn.close()
    _cache_estado[user_id] = (ahora, fila)
    return fila


def obtener_usuario_actual(
    authorization: str | None = Header(default=None),
    token: str | None = None,
) -> UsuarioToken:
    """Dependency de FastAPI: valida la sesión y devuelve los datos del
    usuario logueado. Acepta el JWT por header Authorization: Bearer <token>
    o por query param ?token=<token> (links de PDF)."""
    token_final = None
    if authorization and authorization.startswith("Bearer "):
        token_final = authorization.removeprefix("Bearer ").strip()
    elif token:
        token_final = token

    if not token_final:
        raise HTTPException(status_code=401, detail="Falta el token de sesión")

    payload = decodificar_token(token_final)

    # Los tokens temporales NO dan acceso a la API
    if payload.get("scope") != "full":
        raise HTTPException(status_code=401, detail="Token inválido")

    estado = _estado_usuario(payload["id"])
    if (
        not estado
        or not estado["activo"]
        or estado["token_version"] != payload.get("tv", 0)
    ):
        raise HTTPException(status_code=401, detail="Sesión revocada")

    # Sesión única: si entró otro login con este usuario, este token ya no vale
    if not estado["sesion_id"] or estado["sesion_id"] != payload.get("sid"):
        raise HTTPException(status_code=401, detail=MSG_SESION_DESPLAZADA)

    return UsuarioToken(**payload)


def _sesion_completa(usuario: dict) -> dict:
    """Crea la sesión y desplaza cualquier sesión anterior del mismo usuario."""
    catalogos = usuario.get("catalogos_permitidos")
    if catalogos:
        catalogos = json.loads(catalogos) if isinstance(catalogos, str) else catalogos
    datos = {
        "id": usuario["id"],
        "username": usuario["username"],
        "nombre_completo": usuario.get("nombre_completo"),
        "rol": usuario.get("rol", "seguimiento"),
        "catalogos_permitidos": catalogos,
        "foto_perfil": usuario.get("foto_perfil"),
    }

    sid = secrets.token_hex(16)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT sesion_id FROM usuarios_helbot WHERE id = %s", (usuario["id"],))
            previa = cur.fetchone()
            cur.execute(
                "UPDATE usuarios_helbot SET sesion_id = %s WHERE id = %s",
                (sid, usuario["id"]),
            )
        conn.commit()
    finally:
        conn.close()

    if previa and previa.get("sesion_id"):
        logger.info("Sesión anterior desplazada user_id=%s", usuario["id"])
    _cache_estado.pop(usuario["id"], None)

    token = crear_token(
        {**datos, "token_version": usuario.get("token_version", 0), "sid": sid}
    )
    return {"token": token, "usuario": datos}


# ---------------------------------------------------------------- LOGIN

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

    if not usuario.get("totp_secret"):
        if MFA_OBLIGATORIO:
            raise HTTPException(
                status_code=403,
                detail="Aún no activaste tu verificación en dos pasos. Usa «Activar verificación» con el código que te dio el administrador.",
            )
        # Periodo de transición: entra solo con contraseña
        return _sesion_completa(usuario)

    # Paso 1 correcto: NO se entrega sesión (ni se desplaza la vigente), solo un token temporal
    return {"requiere_2fa": True, "temp_token": crear_token_temporal(usuario["id"], "2fa", 5)}


@router.post("/auth/verificar-2fa")
@limiter.limit("5/minute")
def verificar_2fa(request: Request, body: Verificar2FA):
    payload = decodificar_token(body.temp_token)
    if payload.get("scope") != "2fa":
        raise HTTPException(status_code=401, detail="Token inválido")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM usuarios_helbot WHERE id = %s AND activo = TRUE",
                (payload["id"],),
            )
            usuario = cur.fetchone()
    finally:
        conn.close()

    if not usuario or not usuario.get("totp_secret"):
        raise HTTPException(status_code=401, detail="Verificación fallida")

    secreto = fernet.decrypt(usuario["totp_secret"].encode()).decode()
    codigo = body.codigo.strip().replace(" ", "")
    paso = _verificar_totp(secreto, codigo, usuario.get("totp_ultimo_paso") or 0)

    if paso is None:
        logger.warning("2FA fallido user_id=%s ip=%s", usuario["id"], get_remote_address(request))
        raise HTTPException(status_code=401, detail="Código incorrecto o ya usado")

    # Marcado atómico: si dos peticiones llegan a la vez con el mismo código, solo una pasa
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE usuarios_helbot SET totp_ultimo_paso = %s
                   WHERE id = %s AND (totp_ultimo_paso IS NULL OR totp_ultimo_paso < %s)""",
                (paso, usuario["id"], paso),
            )
            usado = cur.rowcount == 1
        conn.commit()
    finally:
        conn.close()

    if not usado:
        raise HTTPException(status_code=401, detail="Código incorrecto o ya usado")

    return _sesion_completa(usuario)


# ------------------------------------------------- AUTOACTIVACIÓN DEL 2FA

@router.post("/auth/2fa/iniciar")
@limiter.limit("10/minute")
def iniciar_enrolamiento(request: Request, body: IniciarEnrolamiento):
    """Valida contraseña + código de invitación y devuelve el QR para escanear."""
    error = HTTPException(status_code=401, detail="Datos incorrectos o código de invitación inválido/vencido")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM usuarios_helbot WHERE username = %s AND activo = TRUE",
                (body.username,),
            )
            usuario = cur.fetchone()

            if not usuario or not verificar_password(body.password, usuario["password_hash"]):
                raise error

            if usuario.get("totp_secret"):
                raise HTTPException(
                    status_code=400,
                    detail="Tu verificación ya está activa. Si cambiaste de celular, pide un reinicio al administrador.",
                )

            expira = usuario.get("enrol_expira")
            if (
                not usuario.get("enrol_hash")
                or not expira
                or expira < datetime.utcnow()
                or (usuario.get("enrol_intentos") or 0) >= 5
            ):
                raise error

            if not secrets.compare_digest(
                usuario["enrol_hash"], _hash_invitacion(body.codigo_invitacion)
            ):
                cur.execute(
                    "UPDATE usuarios_helbot SET enrol_intentos = enrol_intentos + 1 WHERE id = %s",
                    (usuario["id"],),
                )
                conn.commit()
                logger.warning("Invitación 2FA incorrecta user_id=%s ip=%s", usuario["id"], get_remote_address(request))
                raise error

            secreto = pyotp.random_base32()
            cur.execute(
                "UPDATE usuarios_helbot SET totp_pendiente = %s WHERE id = %s",
                (fernet.encrypt(secreto.encode()).decode(), usuario["id"]),
            )
        conn.commit()
    finally:
        conn.close()

    uri = pyotp.TOTP(secreto).provisioning_uri(name=usuario["username"], issuer_name="Nexus RPC")
    return {
        "enrol_token": crear_token_temporal(usuario["id"], "enrol", 10),
        "qr": _qr_base64(uri),
    }


@router.post("/auth/2fa/confirmar")
@limiter.limit("10/minute")
def confirmar_enrolamiento(request: Request, body: ConfirmarEnrolamiento):
    """Valida el primer código de la app; recién ahí el 2FA queda activo."""
    payload = decodificar_token(body.enrol_token)
    if payload.get("scope") != "enrol":
        raise HTTPException(status_code=401, detail="Token inválido")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM usuarios_helbot WHERE id = %s AND activo = TRUE",
                (payload["id"],),
            )
            usuario = cur.fetchone()

            if (
                not usuario
                or usuario.get("totp_secret")
                or not usuario.get("totp_pendiente")
                or not usuario.get("enrol_hash")
            ):
                raise HTTPException(status_code=401, detail="Activación inválida, vuelve a empezar")

            secreto = fernet.decrypt(usuario["totp_pendiente"].encode()).decode()
            codigo = body.codigo.strip().replace(" ", "")
            paso = _verificar_totp(secreto, codigo)
            if paso is None:
                raise HTTPException(status_code=401, detail="Código incorrecto. Revisa la hora de tu celular.")

            cur.execute(
                """UPDATE usuarios_helbot
                   SET totp_secret = totp_pendiente, totp_pendiente = NULL,
                       enrol_hash = NULL, enrol_expira = NULL, enrol_intentos = 0,
                       totp_ultimo_paso = %s, token_version = token_version + 1
                   WHERE id = %s""",
                (paso, usuario["id"]),
            )
        conn.commit()
    finally:
        conn.close()

    _cache_estado.pop(usuario["id"], None)
    usuario["token_version"] = (usuario.get("token_version") or 0) + 1
    logger.info("2FA activado user_id=%s", usuario["id"])
    return _sesion_completa(usuario)


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


# ------------------------------------------------- VIGILANTE DE SESIÓN ÚNICA

def _leer_estado_directo(user_id: int) -> dict | None:
    """Lee la BD sin caché, para detectar el desplazamiento en segundos."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT activo, token_version, sesion_id FROM usuarios_helbot WHERE id = %s",
                (user_id,),
            )
            return cur.fetchone()
    finally:
        conn.close()


@router.websocket("/auth/ws")
async def ws_sesion(websocket: WebSocket, token: str = ""):
    """El navegador se conecta con su JWT. Si el sid deja de ser el vigente
    (entró otro login), se le avisa y se cierra: el frontend cierra sesión solo."""
    await websocket.accept()

    async def _cerrar(tipo: str, mensaje: str, code: int):
        try:
            await websocket.send_json({"tipo": tipo, "mensaje": mensaje})
            await websocket.close(code=code)
        except Exception:
            pass

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        await _cerrar("sesion_invalida", "Sesión expirada, vuelve a iniciar sesión", 4401)
        return

    if payload.get("scope") != "full":
        await _cerrar("sesion_invalida", "Token inválido", 4401)
        return

    user_id = payload["id"]
    sid = payload.get("sid")
    tv = payload.get("tv", 0)

    try:
        while True:
            estado = await asyncio.to_thread(_leer_estado_directo, user_id)
            if not estado or not estado["activo"] or estado["token_version"] != tv:
                await _cerrar("sesion_invalida", "Tu sesión fue revocada. Vuelve a iniciar sesión.", 4401)
                return
            if not estado["sesion_id"] or estado["sesion_id"] != sid:
                await _cerrar("sesion_desplazada", MSG_SESION_DESPLAZADA, 4001)
                return
            # Espera 3 s; si el cliente se desconecta, receive_text lanza WebSocketDisconnect
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=3)
            except asyncio.TimeoutError:
                pass
    except WebSocketDisconnect:
        return