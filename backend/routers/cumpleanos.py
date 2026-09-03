"""
routers/cumpleanos.py
======================
Endpoints y tarea en segundo plano para el módulo de Cumpleaños.

- Unos días antes (dias_aviso_previo): UNA alerta por día.
- El día exacto del cumpleaños: alerta cada 5 minutos, sin parar.
- Difunde por WebSocket a todos los clientes conectados a /api/cumpleanos/ws.
"""

import os
import asyncio
import logging
from datetime import date
from typing import Optional, List

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from mysql.connector import pooling

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/cumpleanos", tags=["cumpleanos"])

# ─── POOL DE CONEXIONES ───────────────────────────────────────────────────
_pool: Optional[pooling.MySQLConnectionPool] = None

def get_pool() -> pooling.MySQLConnectionPool:
    global _pool
    if _pool is None:
        _pool = pooling.MySQLConnectionPool(
            pool_name="cumpleanos_web",
            pool_size=5,
            host     = os.getenv("DB_HOST"),
            port     = int(os.getenv("DB_PORT", "3306")),
            user     = os.getenv("DB_USER"),
            password = os.getenv("DB_PASSWORD"),
            database = os.getenv("DB_NAME"),
            charset  = "utf8mb4",
        )
        logger.info("✓ Pool MySQL cumpleanos iniciado")
    return _pool


def get_conn():
    return get_pool().get_connection()


# ─── MODELOS ────────────────────────────────────────────────────────────
class Trabajador(BaseModel):
    id: int
    nombre: str
    fecha_nacimiento: str
    dias_aviso_previo: int
    activo: bool

class TrabajadorCrear(BaseModel):
    nombre: str
    fecha_nacimiento: str  # "YYYY-MM-DD"
    dias_aviso_previo: int = 3


# ─── WEBSOCKET MANAGER ────────────────────────────────────────────────────
class GestorConexiones:
    def __init__(self):
        self.activas: List[WebSocket] = []

    async def conectar(self, ws: WebSocket):
        await ws.accept()
        self.activas.append(ws)

    def desconectar(self, ws: WebSocket):
        if ws in self.activas:
            self.activas.remove(ws)

    async def difundir(self, mensaje: dict):
        muertas = []
        for ws in self.activas:
            try:
                await ws.send_json(mensaje)
            except Exception:
                muertas.append(ws)
        for ws in muertas:
            self.desconectar(ws)

gestor = GestorConexiones()


@router.websocket("/ws")
async def websocket_cumpleanos(websocket: WebSocket):
    await gestor.conectar(websocket)
    try:
        while True:
            await websocket.receive_text()  # solo mantiene viva la conexión
    except WebSocketDisconnect:
        gestor.desconectar(websocket)


# ─── ENDPOINTS REST ────────────────────────────────────────────────────────
@router.get("", response_model=List[Trabajador])
def listar_cumpleanos():
    conn = get_conn()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("""
            SELECT id, nombre, fecha_nacimiento, dias_aviso_previo, activo
            FROM cumpleanos_trabajadores
            ORDER BY MONTH(fecha_nacimiento), DAY(fecha_nacimiento)
        """)
        filas = cur.fetchall()
        cur.close()
        for f in filas:
            f["fecha_nacimiento"] = str(f["fecha_nacimiento"])
            f["activo"] = bool(f["activo"])
        return filas
    finally:
        conn.close()


@router.post("", response_model=Trabajador)
def crear_cumpleanos(payload: TrabajadorCrear):
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO cumpleanos_trabajadores (nombre, fecha_nacimiento, dias_aviso_previo)
            VALUES (%s, %s, %s)
        """, (payload.nombre, payload.fecha_nacimiento, payload.dias_aviso_previo))
        conn.commit()
        nuevo_id = cur.lastrowid
        cur.close()
        return Trabajador(
            id=nuevo_id, nombre=payload.nombre,
            fecha_nacimiento=payload.fecha_nacimiento,
            dias_aviso_previo=payload.dias_aviso_previo, activo=True,
        )
    finally:
        conn.close()


@router.delete("/{id_trabajador}")
def eliminar_cumpleanos(id_trabajador: int):
    conn = get_conn()
    try:
        cur = conn.cursor()
        cur.execute("DELETE FROM cumpleanos_trabajadores WHERE id=%s", (id_trabajador,))
        conn.commit()
        afectadas = cur.rowcount
        cur.close()
        if afectadas == 0:
            raise HTTPException(404, "No encontrado")
        return {"ok": True}
    finally:
        conn.close()


# ─── TAREA EN SEGUNDO PLANO ──────────────────────────────────────────────
INTERVALO_SEGUNDOS = 300  # 5 minutos

def _proxima_ocurrencia(fecha_nac: date, hoy: date) -> date:
    try:
        candidata = fecha_nac.replace(year=hoy.year)
    except ValueError:
        candidata = fecha_nac.replace(year=hoy.year, day=28)  # 29 feb en año no bisiesto
    if candidata < hoy:
        try:
            candidata = fecha_nac.replace(year=hoy.year + 1)
        except ValueError:
            candidata = fecha_nac.replace(year=hoy.year + 1, day=28)
    return candidata


async def _revisar_cumpleanos():
    conn = get_conn()
    try:
        cur = conn.cursor(dictionary=True)
        cur.execute("""
            SELECT id, nombre, fecha_nacimiento, dias_aviso_previo
            FROM cumpleanos_trabajadores WHERE activo = 1
        """)
        trabajadores = cur.fetchall()
        cur.close()

        hoy = date.today()

        for t in trabajadores:
            proxima = _proxima_ocurrencia(t["fecha_nacimiento"], hoy)
            dias_restantes = (proxima - hoy).days

            if dias_restantes == 0:
                await gestor.difundir({
                    "tipo": "dia",
                    "id_trabajador": t["id"],
                    "nombre": t["nombre"],
                    "mensaje": f"🎉 ¡Hoy es el cumpleaños de {t['nombre']}!",
                })

            elif 0 < dias_restantes <= t["dias_aviso_previo"]:
                cur2 = conn.cursor()
                cur2.execute("""
                    SELECT id FROM cumpleanos_notificaciones_log
                    WHERE id_trabajador=%s AND fecha_evento=%s AND tipo='previo' AND fecha_envio=%s
                """, (t["id"], proxima, hoy))
                if not cur2.fetchone():
                    await gestor.difundir({
                        "tipo": "previo",
                        "id_trabajador": t["id"],
                        "nombre": t["nombre"],
                        "dias_restantes": dias_restantes,
                        "mensaje": f"🎂 Faltan {dias_restantes} día(s) para el cumpleaños de {t['nombre']}.",
                    })
                    cur2.execute("""
                        INSERT INTO cumpleanos_notificaciones_log
                            (id_trabajador, fecha_evento, tipo, fecha_envio)
                        VALUES (%s, %s, 'previo', %s)
                    """, (t["id"], proxima, hoy))
                    conn.commit()
                cur2.close()
    except Exception:
        logger.exception("Error revisando cumpleaños")
    finally:
        conn.close()


async def tarea_cumpleanos_loop():
    """Bucle infinito — se lanza desde main.py al arrancar la app."""
    while True:
        await _revisar_cumpleanos()
        await asyncio.sleep(INTERVALO_SEGUNDOS)