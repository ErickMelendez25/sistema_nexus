import asyncio
import logging
from datetime import datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, Depends, HTTPException
from pydantic import BaseModel

from db import get_conn
from auth import decodificar_token, obtener_usuario_actual, UsuarioToken
from chat_ws import chat_manager

logger = logging.getLogger("helbot.chat")
router = APIRouter()


@router.on_event("startup")
async def iniciar_heartbeat_chat():
    asyncio.create_task(chat_manager.verificar_conexiones_vivas())


@router.get("/chat/usuarios")
def obtener_usuarios():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                    id,
                    username,
                    nombre_completo,
                    foto_perfil,
                    rol,
                    online
                FROM usuarios_helbot
                WHERE activo = TRUE
                ORDER BY nombre_completo
            """)
            return cur.fetchall()
    finally:
        conn.close()


@router.get("/usuarios/mini")
def usuarios_mini():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT username, nombre_completo, foto_perfil FROM usuarios_helbot WHERE activo = 1"
            )
            return cur.fetchall()
    finally:
        conn.close()


@router.get("/chat/resumen")
def obtener_resumen_chats(usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    """Para pintar la lista de chats como WhatsApp: último mensaje, su
    fecha, y cuántos mensajes sin leer tiene cada conversación con el
    usuario logueado. Se usa para ordenar por reciente y mostrar el badge."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    u.id AS usuario_id,
                    (SELECT m.contenido FROM mensajes_chat m
                       WHERE (m.emisor_id = u.id AND m.receptor_id = %s)
                          OR (m.emisor_id = %s AND m.receptor_id = u.id)
                       ORDER BY m.creado_en DESC, m.id DESC LIMIT 1) AS ultimo_mensaje,
                    (SELECT m.creado_en FROM mensajes_chat m
                       WHERE (m.emisor_id = u.id AND m.receptor_id = %s)
                          OR (m.emisor_id = %s AND m.receptor_id = u.id)
                       ORDER BY m.creado_en DESC, m.id DESC LIMIT 1) AS ultimo_mensaje_en,
                    (SELECT COUNT(*) FROM mensajes_chat m
                       WHERE m.emisor_id = u.id AND m.receptor_id = %s AND m.leido = FALSE) AS no_leidos
                FROM usuarios_helbot u
                WHERE u.activo = TRUE AND u.id != %s
                """,
                (usuario.id, usuario.id, usuario.id, usuario.id, usuario.id, usuario.id),
            )
            filas = cur.fetchall()
    finally:
        conn.close()

    for f in filas:
        if isinstance(f.get("ultimo_mensaje_en"), datetime):
            f["ultimo_mensaje_en"] = f["ultimo_mensaje_en"].isoformat()
    return filas


@router.get("/chat/mensajes/{otro_id}")
def obtener_conversacion(otro_id: int, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    """Historial completo entre el usuario logueado y `otro_id`,
    ordenado del más viejo al más nuevo."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, emisor_id, receptor_id, contenido, leido, creado_en
                FROM mensajes_chat
                WHERE (emisor_id = %s AND receptor_id = %s)
                   OR (emisor_id = %s AND receptor_id = %s)
                ORDER BY creado_en ASC, id ASC
                """,
                (usuario.id, otro_id, otro_id, usuario.id),
            )
            filas = cur.fetchall()
    finally:
        conn.close()

    for f in filas:
        if isinstance(f.get("creado_en"), datetime):
            f["creado_en"] = f["creado_en"].isoformat()
    return filas
class MensajeNuevo(BaseModel):
    receptor_id: int
    contenido: str



class MensajeReenviar(BaseModel):
    mensaje_id: int
    receptor_id: int


@router.post("/chat/mensajes")
async def enviar_mensaje(body: MensajeNuevo, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    contenido = body.contenido.strip()
    if not contenido:
        raise HTTPException(status_code=400, detail="El mensaje no puede estar vacío")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO mensajes_chat (emisor_id, receptor_id, contenido) VALUES (%s, %s, %s)",
                (usuario.id, body.receptor_id, contenido),
            )
            conn.commit()
            nuevo_id = cur.lastrowid
            cur.execute(
                "SELECT id, emisor_id, receptor_id, contenido, leido, creado_en FROM mensajes_chat WHERE id = %s",
                (nuevo_id,),
            )
            fila = cur.fetchone()
    finally:
        conn.close()

    if isinstance(fila.get("creado_en"), datetime):
        fila["creado_en"] = fila["creado_en"].isoformat()

    # Empuja el mensaje en vivo al receptor, si tiene el WS abierto.
    await chat_manager.enviar_a_usuario(
        body.receptor_id,
        {"tipo": "mensaje_nuevo", "mensaje": fila},
    )

    return fila




@router.post("/chat/mensajes/reenviar")
async def reenviar_mensaje(body: MensajeReenviar, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # Trae el contenido original, verificando que el usuario
            # logueado sea parte de esa conversación (no puede reenviar
            # mensajes ajenos que nunca vio).
            cur.execute(
                """
                SELECT contenido FROM mensajes_chat
                WHERE id = %s AND (emisor_id = %s OR receptor_id = %s)
                """,
                (body.mensaje_id, usuario.id, usuario.id),
            )
            original = cur.fetchone()
            if not original:
                raise HTTPException(status_code=404, detail="Mensaje no encontrado")

            cur.execute(
                "INSERT INTO mensajes_chat (emisor_id, receptor_id, contenido) VALUES (%s, %s, %s)",
                (usuario.id, body.receptor_id, original["contenido"]),
            )
            conn.commit()
            nuevo_id = cur.lastrowid
            cur.execute(
                "SELECT id, emisor_id, receptor_id, contenido, leido, creado_en FROM mensajes_chat WHERE id = %s",
                (nuevo_id,),
            )
            fila = cur.fetchone()
    finally:
        conn.close()

    if isinstance(fila.get("creado_en"), datetime):
        fila["creado_en"] = fila["creado_en"].isoformat()

    await chat_manager.enviar_a_usuario(
        body.receptor_id,
        {"tipo": "mensaje_nuevo", "mensaje": fila},
    )
    return fila


class MarcarLeidos(BaseModel):
    emisor_id: int


@router.post("/chat/mensajes/marcar-leidos")
async def marcar_leidos(body: MarcarLeidos, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE mensajes_chat SET leido = TRUE WHERE emisor_id = %s AND receptor_id = %s AND leido = FALSE",
                (body.emisor_id, usuario.id),
            )
            conn.commit()
    finally:
        conn.close()

    # Avisa al emisor que sus mensajes ya fueron vistos (para el doble check azul).
    await chat_manager.enviar_a_usuario(
        body.emisor_id,
        {"tipo": "mensajes_vistos", "por": usuario.id},
    )
    return {"ok": True}


@router.websocket("/chat/ws")
async def chat_websocket(websocket: WebSocket, token: str = Query(...)):
    try:
        payload = decodificar_token(token)
    except Exception as e:
        logger.warning(f"WS rechazado, token inválido: {e}")
        await websocket.close(code=1008)
        return

    usuario_id = payload["id"]
    await chat_manager.conectar(usuario_id, websocket)

    try:
        while True:
            data = await websocket.receive_json()
            tipo = data.get("tipo")

            # "escribiendo..." — igual que antes.
            if tipo == "escribiendo":
                destino = data.get("para")
                if destino:
                    await chat_manager.enviar_a_usuario(
                        int(destino),
                        {"tipo": "escribiendo", "de": usuario_id},
                    )

            # ---------- Señalización de llamadas (WebRTC) ----------
            # El servidor NUNCA toca audio/video — solo reenvía estos
            # mensajes de un usuario a otro, como un cartero. Todo el
            # trabajo real (SDP, ICE) lo hacen los navegadores directo
            # entre sí una vez conectados.

            elif tipo == "llamada_iniciar":
                # A llama a B: le avisamos a B que están timbrando.
                destino = data.get("para")
                if destino:
                    conn = get_conn()
                    try:
                        with conn.cursor() as cur:
                            cur.execute(
                                "SELECT nombre_completo FROM usuarios_helbot WHERE id = %s",
                                (usuario_id,),
                            )
                            fila = cur.fetchone()
                    finally:
                        conn.close()
                    nombre_llamante = fila["nombre_completo"] if fila else "Usuario"
                    await chat_manager.enviar_a_usuario(
                        int(destino),
                        {
                            "tipo": "llamada_entrante",
                            "de": usuario_id,
                            "nombre": nombre_llamante,
                            "con_video": data.get("con_video", False),
                        },
                    )

            elif tipo == "llamada_oferta":
                # SDP offer de A hacia B.
                destino = data.get("para")
                if destino:
                    await chat_manager.enviar_a_usuario(
                        int(destino),
                        {"tipo": "llamada_oferta", "de": usuario_id, "sdp": data.get("sdp")},
                    )

            elif tipo == "llamada_respuesta":
                # SDP answer de B hacia A (aceptó la llamada).
                destino = data.get("para")
                if destino:
                    await chat_manager.enviar_a_usuario(
                        int(destino),
                        {"tipo": "llamada_respuesta", "de": usuario_id, "sdp": data.get("sdp")},
                    )

            elif tipo == "llamada_ice":
                # Candidatos ICE, van y vienen varias veces por llamada.
                destino = data.get("para")
                if destino:
                    await chat_manager.enviar_a_usuario(
                        int(destino),
                        {"tipo": "llamada_ice", "de": usuario_id, "candidate": data.get("candidate")},
                    )

            elif tipo == "llamada_rechazar":
                destino = data.get("para")
                if destino:
                    await chat_manager.enviar_a_usuario(
                        int(destino),
                        {"tipo": "llamada_rechazada", "de": usuario_id},
                    )

            elif tipo == "llamada_colgar":
                destino = data.get("para")
                if destino:
                    await chat_manager.enviar_a_usuario(
                        int(destino),
                        {"tipo": "llamada_colgada", "de": usuario_id},
                    )
    except WebSocketDisconnect:
        # Solo apaga el online si el socket que se cayó sigue siendo el
        # registrado — evita que la desconexión tardía de una pestaña
        # vieja apague una sesión nueva que ya la reemplazó.
        chat_manager.desconectar(usuario_id, websocket)
        await chat_manager.broadcast_estado(usuario_id, False)