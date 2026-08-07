"""
Helbot - chat_ws.py
--------------------
Manager de conexiones WebSocket del chat. Actualiza la columna
`online` en usuarios_helbot cuando alguien entra o sale, y usa un
heartbeat (ping cada 20s) para detectar conexiones muertas que
nunca mandaron el cierre limpio (recargas bruscas, wifi caído, etc).
"""

import asyncio
import logging
from typing import Dict
from fastapi import WebSocket
from db import get_conn

logger = logging.getLogger("helbot.chat_ws")

INTERVALO_PING_SEGUNDOS = 20


class ChatConnectionManager:
    def __init__(self):
        self.conexiones: Dict[int, WebSocket] = {}

    async def conectar(self, usuario_id: int, websocket: WebSocket):
        # Si ya había una conexión viva de este mismo usuario (otra pestaña,
        # una reconexión que no cerró bien la anterior, etc.) se cierra la
        # vieja ANTES de aceptar la nueva. Sin esto, el dict `conexiones`
        # solo guarda la última referencia, pero el socket anterior sigue
        # vivo y sin dueño — y cuando cualquiera de los dos se cae, dispara
        # un `desconectar()` que apaga el online aunque el otro siga activo.
        # Esta es la causa de "a veces queda offline aunque sigo conectado".
        anterior = self.conexiones.get(usuario_id)
        if anterior is not None:
            try:
                await anterior.close(code=4000)
            except Exception:
                pass

        await websocket.accept()
        self.conexiones[usuario_id] = websocket
        self._marcar_online(usuario_id, True)
        await self.broadcast_estado(usuario_id, True)
        logger.info(f"Usuario {usuario_id} conectado por WS")

    def desconectar(self, usuario_id: int, websocket: WebSocket | None = None):
        # Si me pasan el socket que se desconectó, solo lo saco del dict
        # cuando SIGUE siendo el que está registrado ahora mismo. Si ya fue
        # reemplazado por una conexión más nueva (ver `conectar`), no hago
        # nada — evita que una desconexión tardía del socket viejo borre
        # el estado online de una sesión nueva que ya lo reemplazó.
        if websocket is not None and self.conexiones.get(usuario_id) is not websocket:
            return
        self.conexiones.pop(usuario_id, None)
        self._marcar_online(usuario_id, False)
        logger.info(f"Usuario {usuario_id} desconectado de WS")

    def _marcar_online(self, usuario_id: int, online: bool):
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE usuarios_helbot SET online = %s WHERE id = %s",
                    (online, usuario_id),
                )
            conn.commit()
        finally:
            conn.close()



    async def enviar_a_usuario(self, usuario_id: int, mensaje: dict):
        """Manda un mensaje SOLO a ese usuario, si tiene el WS abierto.
        Se usa para mensajes de chat privados, typing indicator y
        confirmaciones de lectura — nunca un broadcast a todos."""
        ws = self.conexiones.get(usuario_id)
        if not ws:
            return
        try:
            await ws.send_json(mensaje)
        except Exception:
            self.desconectar(usuario_id, ws)



    async def broadcast_estado(self, usuario_id: int, online: bool):
        mensaje = {"tipo": "estado_usuario", "usuario_id": usuario_id, "online": online}
        muertos = []
        # OJO: list(...) hace una copia de las llaves ANTES de iterar.
        # Sin esto, si otro usuario se conecta/desconecta mientras este
        # for todavía está corriendo (puede pasar, porque el await de
        # send_json le cede el control a otras tareas), Python revienta
        # con "dictionary changed size during iteration".
        for uid, ws in list(self.conexiones.items()):
            try:
                await ws.send_json(mensaje)
            except Exception:
                muertos.append((uid, ws))
        for uid, ws in muertos:
            self.desconectar(uid, ws)

    async def verificar_conexiones_vivas(self):
        """
        Se ejecuta en loop cada INTERVALO_PING_SEGUNDOS. Manda un ping
        real a cada socket — si falla, es una conexión zombie (el
        navegador ya no existe, pero el server nunca se enteró) y se
        marca offline de inmediato, en vez de esperar a que alguien más
        intente mandarle un mensaje.
        """
        while True:
            await asyncio.sleep(INTERVALO_PING_SEGUNDOS)
            muertos = []
            for uid, ws in list(self.conexiones.items()):
                try:
                    await ws.send_json({"tipo": "ping"})
                except Exception:
                    muertos.append((uid, ws))
            for uid, ws in muertos:
                logger.info(f"Usuario {uid} detectado como zombie por heartbeat")
                self.desconectar(uid, ws)
                await self.broadcast_estado(uid, False)


chat_manager = ChatConnectionManager()