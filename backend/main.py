"""
Helbot - main.py
-----------------
Punto de entrada de la API. Junta:

  - perucompras_login.py  -> sesión Selenium+requests a Peru Compras (personal 1)
  - erp_login.py          -> sesión al ERP interno (personal ventas, completa precio)
  - ficha_ocr.py           -> router de OCR de fichas (ya trae su propio APIRouter)
  - db.py                  -> conexión MySQL + init_db()

Alineado 1:1 con el frontend Next.js (HelbotPage): mismo puerto (4001),
mismos paths, mismo shape de request/response, y WebSocket /ws/alertas
para las notificaciones en vivo (nueva_publicada / precio_completado).

Patrón de login: el frontend hace POST sin body a /sesion/perucompras/login
y /sesion/erp/login (solo hay un botón "Iniciar sesión"), así que las
credenciales NO vienen del cliente — se leen de variables de entorno.
El login corre en background (login_async) y el frontend pollea
GET /sesion/estado cada 15s para refrescar los badges.

TODO generales:
  - Setear las env vars reales: PERUCOMPRAS_USER, PERUCOMPRAS_PASS,
    ERP_USER, ERP_PASS (o pasarlas por body si prefieres login manual).
  - Conectar buscar_publicadas() en perucompras_login.py con el endpoint
    real antes de que /publicadas/buscar sirva para algo.
  - Conectar /mef/consultar con tu módulo real de scraping+captcha del MEF
    (está con un stub 501 mientras tanto, para no romper el frontend con 404).
"""


from dotenv import load_dotenv
load_dotenv(override=True)
import os
import json
import asyncio
import logging
from datetime import datetime
from typing import Optional, List




from fastapi import FastAPI, HTTPException, BackgroundTasks, WebSocket, WebSocketDisconnect, Query, Depends, UploadFile, File
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded


from fastapi.staticfiles import StaticFiles
import uuid
from pathlib import Path
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from db import get_conn, init_db, guardar_json
from perucompras_login import perucompras_sesiones
from erp_login import erp_session, ERP_API_BASE
from ficha_ocr import router as ficha_ocr_router
from mef_scraper import router as mef_router
from monitor_publicadas import monitores, monitor_de
from auth import router as auth_router, obtener_usuario_actual, UsuarioToken
import op_seguimiento
from almacenamiento import almacenamiento, STORAGE_BACKEND

from ventas_router import router as ventas_router, configurar_alertas


from routers import cobranzas_doc_pago
from routers import cobranzas_carta_nota







from routers import perucompras_filtros
from routers import perucompras_extraccion_router as perucompras_extraccion_router_mod
from routers import perucompras_marcas_router as perucompras_marcas_router_mod

from routers import perucompras_stock_router as perucompras_stock_router_mod
from routers import perucompras_plazo_router as perucompras_plazo_router_mod

from chat import router as chat_router

logger = logging.getLogger("helbot.main")
logging.basicConfig(level=logging.INFO)

# ============================================================
# Credenciales (el frontend NO las manda — login es solo un botón)
# ============================================================
PERUCOMPRAS_USER = os.getenv("PERUCOMPRAS_USER", "")
PERUCOMPRAS_PASS = os.getenv("PERUCOMPRAS_PASS", "")
ERP_USER = os.getenv("ERP_USER", "")
ERP_PASS = os.getenv("ERP_PASS", "")

# ============================================================
# App
# ============================================================
app = FastAPI(title="Helbot API", version="0.1.0")

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# Carpeta física SOLO para el backend "local" (STORAGE_BACKEND=local).
# IMPORTANTE: debe ser LA MISMA carpeta que usa almacenamiento.py para
# guardar — si no, el servidor guarda en un lugar y sirve desde otro,
# y las imágenes nunca se encuentran. Por eso se reutiliza directamente
# almacenamiento.upload_dir en vez de calcular una ruta aparte acá.
UPLOAD_DIR = almacenamiento.upload_dir

# TODO: ajustar a los orígenes reales si el frontend corre en otra IP/puerto
import re

CORS_ORIGINS = [
    "https://gruecolimp.com",
    "http://localhost:3002",
    "http://127.0.0.1:3002",
    "http://192.168.1.41:3002",
    "http://192.168.18.33:3002",
    "http://192.168.18.139:3002",
    "https://nexus.gruecolimp.com", # <-- reemplaza con tu dominio real de producción
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"http://192\.168\.\d{1,3}\.\d{1,3}:3002",  # cualquier IP de tu red local
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.include_router(ficha_ocr_router)

app.include_router(mef_router)
app.include_router(auth_router)


app.include_router(cobranzas_doc_pago.router)
app.include_router(cobranzas_carta_nota.router)


app.include_router(perucompras_filtros.router)


app.include_router(perucompras_extraccion_router_mod.router)
app.include_router(perucompras_marcas_router_mod.router)



app.include_router(perucompras_stock_router_mod.router)
app.include_router(perucompras_plazo_router_mod.router)

app.include_router(chat_router)





# El mount /archivos solo tiene sentido para el backend "local". Con
# s3/azure las imágenes se sirven directo desde la URL del bucket, no
# desde este servidor.
if STORAGE_BACKEND == "local":
    app.mount("/archivos", StaticFiles(directory=str(UPLOAD_DIR)), name="archivos")

# ============================================================
# WebSocket / alertas en vivo   
# ============================================================
class ConnectionManager:
    def __init__(self):
        self.activos: List[WebSocket] = []

    async def conectar(self, ws: WebSocket):
        await ws.accept()
        self.activos.append(ws)

    def desconectar(self, ws: WebSocket):
        if ws in self.activos:
            self.activos.remove(ws)

    async def broadcast(self, mensaje: dict):
        muertos = []
        for ws in self.activos:
            try:
                await ws.send_json(mensaje)
            except Exception:
                muertos.append(ws)
        for ws in muertos:
            self.desconectar(ws)


manager = ConnectionManager()
_main_loop: Optional[asyncio.AbstractEventLoop] = None
_ultimo_hash_ventas_erp: Optional[str] = None


async def _polling_erp_ventas(intervalo_seg: int = 45):
    """
    Cada `intervalo_seg` segundos, si hay sesión ERP activa, vuelve a pedir
    TODAS las ventas (forzar=True) y las empuja por WebSocket como
    'ventas_erp_actualizadas' — pero SOLO si el conjunto de códigos cambió
    respecto al último envío, para no spamear al frontend con el mismo
    payload cada 45s.

    Esto es lo que hace que el comparador Publicadas <-> Ventas ERP se vea
    "en vivo" sin que el usuario tenga que tocar 'Refrescar'.
    """
    global _ultimo_hash_ventas_erp
    while True:
        await asyncio.sleep(intervalo_seg)
        if not erp_session.autenticado:
            continue
        try:
            # obtener_todas_ventas() es bloqueante (requests/Selenium por dentro),
            # así que lo corremos en un thread para no congelar el event loop
            # y que el resto de la API (WS incluido) siga respondiendo.
            resultado = await asyncio.to_thread(erp_session.obtener_todas_ventas, True)
        except Exception as e:
            logger.warning(f"polling_erp_ventas: error consultando ERP: {e}")
            continue

        ventas = resultado.get("ventas", []) or []
        codigos = sorted(
            str(v.get("codigoVenta") or v.get("numeroOcam") or v.get("id") or "")
            for v in ventas
        )
        nuevo_hash = str(hash(tuple(codigos)))

        if nuevo_hash != _ultimo_hash_ventas_erp:
            _ultimo_hash_ventas_erp = nuevo_hash
            emitir_alerta({"tipo": "ventas_erp_actualizadas", "data": resultado})
            logger.info(f"polling_erp_ventas: cambio detectado — {len(ventas)} ventas emitidas por WS")


def guardar_notificacion(tipo: str, data: dict, emisor: Optional[str] = None):
    """Persiste la notificación en MySQL. `emisor` es quien generó la
    acción (ej. rellenado_por) — se guarda para poder excluirla del
    propio panel de ese usuario más adelante."""
    if tipo == "nueva_publicada" and not (data.get("C_OrdenCompra") and data.get("C_Entidad")):
        return  # basura: no trae OCAM+Entidad, no se guarda

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO notificaciones_helbot (tipo, data, emisor) VALUES (%s, %s, %s)",
                (tipo, guardar_json(data), emisor),
            )
    finally:
        conn.close()


def emitir_alerta(mensaje: dict, persistir: bool = True):
    """
    Llamable desde threads normales (background tasks, keep-alive de
    perucompras_login.py, etc.) para empujar un mensaje por WebSocket
    hacia el frontend. `mensaje` debe traer {"tipo": ..., "data": {...}}
    porque así lo lee HelbotPage.onmessage.

    `persistir=True` además guarda una fila en notificaciones_helbot.
    "ventas_erp_actualizadas" nunca se persiste porque se dispara cada
    ~45s y llenaría la tabla sin aportar nada al historial de alertas.
    """
    if persistir and mensaje.get("tipo") != "ventas_erp_actualizadas":
        try:
            data = mensaje.get("data", {}) or {}
            emisor = (
                data.get("rellenado_por")
                or data.get("subido_por")
                or data.get("completado_por")
                or data.get("confirmado_por")
            )
            guardar_notificacion(mensaje.get("tipo", ""), data, emisor)
        except Exception as e:
            logger.warning(f"No se pudo guardar la notificación en DB: {e}")

    if _main_loop is None:
        logger.warning("emitir_alerta: loop principal aún no listo, se descarta el mensaje")
        return
    asyncio.run_coroutine_threadsafe(manager.broadcast(mensaje), _main_loop)


configurar_alertas(emitir_alerta)


def _hacer_callback_nueva_orden(uid: str):
    def _push(orden: dict):
        # El monitor a veces dispara este callback con el dict de la
        # orden incompleto (solo N_OrdenCompra, sin C_OrdenCompra ni
        # C_Entidad) — eso es lo que después se guarda en MySQL y hace
        # que el historial de notificaciones muestre un número pelado
        # en vez de la entidad/OCAM, y que el clic no lleve a ningún
        # lado. Si faltan esos campos, se completan consultando el
        # snapshot en memoria del monitor (m.obtener_por_id), que sí
        # tiene el objeto completo de la orden.
        if not orden.get("C_OrdenCompra") or not orden.get("C_Entidad"):
            m = monitor_de(uid)
            n_orden = orden.get("N_OrdenCompra")
            if m and n_orden:
                completa = m.obtener_por_id(n_orden)
                if completa:
                    orden = {**completa, **orden}
            if not orden.get("C_OrdenCompra") or not orden.get("C_Entidad"):
                logger.warning(
                    f"nueva_publicada DESCARTADA por datos incompletos "
                    f"(uid={uid}, N_OrdenCompra={n_orden}): {orden}"
                )
                return
        emitir_alerta({"tipo": "nueva_publicada", "data": {**orden, "_uid": uid}})
    return _push

for _uid, _monitor in monitores.items():
    _monitor.on_nueva_orden = _hacer_callback_nueva_orden(_uid)



def _hacer_callback_sesion_perdida(uid: str):
    def _push(usuario: str):
        # Cierra el Chrome huérfano de ESTE usuario apenas se detecta la
        # sesión perdida — antes solo se avisaba por WebSocket pero el
        # proceso de Chrome se quedaba vivo en el servidor.
        sesion = perucompras_sesiones.sesion(uid)
        if sesion and sesion.driver:
            try:
                sesion.driver.quit()
                logger.info(f"Chrome de '{uid}' cerrado automáticamente por sesión perdida")
            except Exception as e:
                logger.warning(f"No se pudo cerrar Chrome de '{uid}' tras sesión perdida: {e}")
            finally:
                sesion.driver = None

        emitir_alerta({
            "tipo": "perucompras_sesion_perdida",
            "data": {"uid": uid, "usuario": usuario,
                      "mensaje": f"La sesión de '{usuario}' se cerró (posible ingreso simultáneo con el mismo usuario)."},
        })
    return _push

def _hacer_callback_sesion_recuperada(uid: str):
    def _push(usuario: str):
        emitir_alerta({"tipo": "perucompras_sesion_recuperada", "data": {"uid": uid, "usuario": usuario}})
    return _push


def _hacer_callback_sesion_fallida(uid: str):
    def _push(usuario: str):
        # Se dispara cuando el relogin automático del keep-alive se
        # rinde definitivamente (el usuario real tendrá que darle clic
        # a "Entrar" de nuevo). Sin este evento, el sidebar y el módulo
        # de Operaciones se quedan desincronizados: uno en "cargando"
        # para siempre, el otro ya mostrando el botón de login.
        emitir_alerta({
            "tipo": "perucompras_sesion_fallida",
            "data": {"uid": uid, "usuario": usuario,
                      "mensaje": f"No se pudo reconectar automáticamente la sesión de '{usuario}'. Inicia sesión de nuevo."},
        })
    return _push

for _uid, _s in perucompras_sesiones.sesiones.items():
    _s.on_sesion_perdida = _hacer_callback_sesion_perdida(_uid)
    _s.on_sesion_recuperada = _hacer_callback_sesion_recuperada(_uid)
    _s.on_sesion_fallida = _hacer_callback_sesion_fallida(_uid)



def _hacer_callback_login_ok(uid: str):
    def _push():
        m = monitor_de(uid)
        if m:
            m.iniciar()
        emitir_alerta({"tipo": "perucompras_login_ok", "data": {"uid": uid}}, persistir=False)
    return _push

for _uid, _s in perucompras_sesiones.sesiones.items():
    _s.on_login_exitoso = _hacer_callback_login_ok(_uid)




@app.websocket("/ws/alertas")
async def ws_alertas(websocket: WebSocket):
    await manager.conectar(websocket)
    try:
        while True:
            # No esperamos nada del cliente, solo mantenemos la conexión viva.
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.desconectar(websocket)


@app.on_event("startup")
async def on_startup():
    global _main_loop
    _main_loop = asyncio.get_running_loop()
    try:
        init_db()
        logger.info("DB inicializada (tablas verificadas/creadas)")
    except Exception as e:
        logger.error(f"No se pudo inicializar la DB: {e}")

    # Al arrancar, ningún WebSocket de chat está vivo todavía — si el
    # backend se cayó de golpe la vez anterior, la columna `online` pudo
    # quedar en TRUE para siempre. La reseteamos para partir limpio.
    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute("UPDATE usuarios_helbot SET online = FALSE")
        conn.commit()
        conn.close()
        logger.info("Estado online reseteado al arrancar el backend")
    except Exception as e:
        logger.warning(f"No se pudo resetear el estado online al arrancar: {e}")

    # Arranca el polling de ventas ERP -> WebSocket (comparador en vivo).
    # Se guarda la tarea en el propio app.state para que no la recoja el
    # garbage collector (asyncio solo mantiene una referencia débil).
    app.state.tarea_polling_erp_ventas = asyncio.create_task(_polling_erp_ventas())


@app.on_event("shutdown")
async def on_shutdown():
    """Cierra TODOS los navegadores del bot (todos los usuarios + ERP)
    al apagar el backend, para no dejar procesos Chrome huérfanos que
    choquen con el siguiente arranque (por el detach=True del driver)."""
    logger.info("Apagando backend: cerrando sesiones de Chrome de todos los usuarios...")
    tarea = getattr(app.state, "tarea_polling_erp_ventas", None)
    if tarea:
        tarea.cancel()
    for uid, sesion in perucompras_sesiones.sesiones.items():
        try:
            if sesion.driver:
                sesion.driver.quit()
                logger.info(f"Chrome del usuario '{uid}' cerrado correctamente")
        except Exception as e:
            logger.warning(f"No se pudo cerrar Chrome del usuario '{uid}': {e}")
    try:
        if erp_session.driver:
            erp_session.driver.quit()
            logger.info("Chrome del ERP cerrado correctamente")
    except Exception as e:
        logger.warning(f"No se pudo cerrar Chrome del ERP: {e}")


@app.get("/health")
def health():
    return {"ok": True, "hora": datetime.now().isoformat()}


@app.get("/notificaciones")
def notificaciones_listar(limite: int = Query(50), usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    """Historial real desde MySQL. Excluye las notificaciones generadas
    por el propio usuario (no necesitas que te avisen de tu propia
    acción) y calcula 'leida' de forma individual por usuario, no global."""
    identidad = usuario.nombre_completo or usuario.username
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT n.*, (nl.usuario IS NOT NULL) AS leida_usuario
                FROM notificaciones_helbot n
                LEFT JOIN notificaciones_leidas nl
                    ON nl.notificacion_id = n.id AND nl.usuario = %s
                WHERE n.emisor IS NULL OR n.emisor != %s
                ORDER BY n.creado_en DESC
                LIMIT %s
                """,
                (identidad, identidad, limite),
            )
            filas = cur.fetchall()
    finally:
        conn.close()

    resultado = []
    for f in filas:
        data = f.get("data")
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                data = {}
        resultado.append({
            "id": f["id"],
            "tipo": f["tipo"],
            "leida": bool(f["leida_usuario"]),
            "creado_en": f["creado_en"].isoformat() if f["creado_en"] else None,
            **(data or {}),
        })
    return resultado


class MarcarLeidasRequest(BaseModel):
    ids: Optional[List[int]] = None  # None = marcar TODAS LAS MÍAS como leídas


@app.post("/notificaciones/marcar-leidas")
def notificaciones_marcar_leidas(body: MarcarLeidasRequest, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    identidad = usuario.nombre_completo or usuario.username
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if body.ids:
                formato = ",".join(["%s"] * len(body.ids))
                cur.execute(
                    f"""
                    INSERT IGNORE INTO notificaciones_leidas (notificacion_id, usuario)
                    SELECT id, %s FROM notificaciones_helbot WHERE id IN ({formato})
                    """,
                    (identidad, *body.ids),
                )
            else:
                cur.execute(
                    """
                    INSERT IGNORE INTO notificaciones_leidas (notificacion_id, usuario)
                    SELECT id, %s FROM notificaciones_helbot
                    WHERE emisor IS NULL OR emisor != %s
                    """,
                    (identidad, identidad),
                )
    finally:
        conn.close()
    return {"ok": True}

# ============================================================
# Modelos
# ============================================================
class LoginRequest(BaseModel):
    usuario: Optional[str] = None
    password: Optional[str] = None


class PublicadaOut(BaseModel):
    id: str
    acuerdo_marco: Optional[str] = None
    catalogo: Optional[str] = None
    categoria: Optional[str] = None
    titulo: Optional[str] = None
    estado_gestion: str
    detectada_en: Optional[str] = None

class EstadoGestionUpdate(BaseModel):
    estado_gestion: str  # "nueva" | "registrada"


class OrdenCreate(BaseModel):
    publicada_id: Optional[str] = None
    producto: str
    cantidad: int
    registrado_por: str


class OrdenOut(BaseModel):
    id: int
    publicada_id: Optional[str] = None
    producto: str
    cantidad: int
    precio: Optional[float] = None
    estado_precio: str
    registrado_por: str
    completado_por: Optional[str] = None
    creado_en: Optional[str] = None
    completado_en: Optional[str] = None


class PrecioUpdate(BaseModel):
    precio: float
    completado_por: str


class MefConsultaRequest(BaseModel):
    sec_ejec: str
    expediente: str


class ErpCompletarRequest(BaseModel):
    publicada_id: str
    origen: Optional[str] = None
    datos: dict


class OpRellenarRequest(BaseModel):
    proveedor_nombre: Optional[str] = None
    proveedor_telefono: Optional[str] = None
    precio_producto: Optional[float] = None
    comodato: Optional[str] = None
    agencia_transporte: Optional[str] = None
    precio_flete: Optional[float] = None
    observaciones: Optional[str] = None
    rellenado_por: str  # nombre/identificador de quien llena (usuario externo)
    numero_ocam: Optional[str] = None


class OpProductoRellenarRequest(BaseModel):
    proveedor_nombre: Optional[str] = None
    proveedor_id: Optional[int] = None
    proveedor_telefono: Optional[str] = None
    precio_producto: Optional[float] = None
    comodato: Optional[str] = None
    observaciones_externas: Optional[str] = None 
    agencia_transporte: Optional[str] = None
    transporte_id: Optional[int] = None
    precio_flete: Optional[float] = None
    observaciones: Optional[str] = None
    observaciones_transporte: Optional[str] = None
    otras_observaciones: Optional[str] = None
    margen: Optional[str] = None
    margen_orden: Optional[str] = None
    tipo_envio: Optional[str] = None
    empresa_id: Optional[int] = None
    empresa_nombre: Optional[str] = None
    rellenado_por: str
    numero_ocam: Optional[str] = None
    codigo_venta: Optional[str] = None
    producto_descripcion: Optional[str] = None

class OpProductoBloqueItem(BaseModel):
    codigo: str
    descripcion: str
    precio_producto: float | None = None
    precio_flete: float | None = None
    comodato: str | None = None
    observaciones_externas: str | None = None
    margen: str | None = None
    margen_orden: str | None = None

class DatosCompartidosRequest(BaseModel):
    proveedor_nombre: str | None = None
    proveedor_id: int | None = None
    proveedor_telefono: str | None = None
    tipo_envio: str | None = None
    agencia_transporte: str | None = None
    transporte_id: int | None = None
    observaciones: str | None = None
    otras_observaciones: str | None = None
    observaciones_transporte: str | None = None

class OpProductosBloqueRequest(BaseModel):
    productos: list[OpProductoBloqueItem]
    datos_compartidos: DatosCompartidosRequest
    rellenado_por: str
    numero_ocam: str | None = None
    codigo_venta: str | None = None

class OpProductoSubirRequest(BaseModel):
    subido_por: str


class OpSubirErpRequest(BaseModel):
    subido_por: str  # nombre del personal de seguimiento que confirma


class ConfirmarProductoRequest(BaseModel):
    confirmado_por: str  # nombre de quien confirma (rol seguimiento)


class ActualizarSiafRequest(BaseModel):
    etapa_siaf: str
    fecha_siaf: str  # formato "YYYY-MM-DD"
    fuentes_financiamiento: str
    multiple_fuentes_financiamiento: bool
    monto_venta: float
    siaf: Optional[str] = None
    expediente: Optional[str] = None
    unidad_ejecutora: Optional[str] = None
    registros: Optional[list] = None
    completado_por: Optional[str] = None

class ActualizarProductoRequest(BaseModel):
    proveedor_nombre: Optional[str] = None
    proveedor_id: Optional[int] = None
    proveedor_telefono: Optional[str] = None
    precio_producto: Optional[float] = None
    comodato: Optional[str] = None
    observaciones_externas: Optional[str] = None
    agencia_transporte: Optional[str] = None
    transporte_id: Optional[int] = None
    precio_flete: Optional[float] = None
    observaciones: Optional[str] = None
    observaciones_transporte: Optional[str] = None
    otras_observaciones: Optional[str] = None
    margen: Optional[str] = None
    margen_orden: Optional[str] = None
    tipo_envio: Optional[str] = None
    empresa_id: Optional[int] = None
    empresa_nombre: Optional[str] = None
    producto_descripcion: Optional[str] = None
# ============================================================
# Sesión — endpoint combinado que usa el frontend
# ============================================================
@app.get("/sesion/estado")
def sesion_estado():
    for uid, m in monitores.items():
        s = perucompras_sesiones.sesion(uid)
        if s and s.autenticado:
            m.iniciar()
    return {
        "perucompras": perucompras_sesiones.estado_todos(),
        "perucompras_activo": perucompras_sesiones.activo_id,
        "erp": erp_session.autenticado,
    }


class PeruComprasUidRequest(BaseModel):
    uid: str


@app.get("/sesion/perucompras/usuarios")
def perucompras_usuarios():
    return [
        {"uid": uid, "label": cfg["label"]}
        for uid, cfg in perucompras_sesiones.usuarios.items()
    ]


@app.post("/sesion/perucompras/login")
def perucompras_login(body: PeruComprasUidRequest):
    sesion = perucompras_sesiones.sesion(body.uid)
    if not sesion:
        raise HTTPException(status_code=404, detail=f"Usuario '{body.uid}' no configurado en .env")
    if sesion.estado == "cargando":
        return {"ok": True, "detalle": "Login ya en progreso"}
    perucompras_sesiones.login_async(body.uid)
    perucompras_sesiones.set_activo(body.uid)
    return {"ok": True, "detalle": f"Login iniciado en background — usuario {body.uid}"}



class PeruComprasLoginManualRequest(BaseModel):
    usuario: str
    password: str


@app.post("/sesion/perucompras/login-manual")
def perucompras_login_manual(body: PeruComprasLoginManualRequest):
    """
    Login para un usuario de Peru Compras que NO está preconfigurado en
    el .env — usado por el botón '¿Otro usuario? Iniciar sesión
    manualmente' del frontend. Crea (o reutiliza) una sesión dinámica
    con un uid derivado del username, y arranca el login en background
    exactamente igual que el login con usuarios predefinidos.
    """
    if not body.usuario.strip() or not body.password.strip():
        raise HTTPException(status_code=422, detail="Usuario y contraseña son obligatorios")

    uid = perucompras_sesiones.crear_sesion_manual(body.usuario, body.password)
    sesion = perucompras_sesiones.sesion(uid)

    if sesion.estado == "cargando":
        return {"ok": True, "uid": uid, "detalle": "Login ya en progreso"}

    perucompras_sesiones.login_async(uid)
    perucompras_sesiones.set_activo(uid)
    return {"ok": True, "uid": uid, "detalle": f"Login manual iniciado en background — usuario {body.usuario}"}


@app.post("/sesion/perucompras/logout")
def perucompras_logout(body: PeruComprasUidRequest):
    sesion = perucompras_sesiones.sesion(body.uid)
    if not sesion:
        raise HTTPException(status_code=404, detail=f"Usuario '{body.uid}' no configurado en .env")
    etiqueta = perucompras_sesiones.usuarios.get(body.uid, {}).get("label", body.uid)
    sesion.logout()
    # Antes nadie avisaba por WebSocket cuando se cerraba sesión manualmente
    # (a diferencia de sesión perdida/recuperada, que sí emiten alerta) —
    # por eso el sidebar y cualquier otro panel abierto seguían viendo el
    # badge en verde hasta el siguiente poll de 15s. Con esto, todos los
    # clientes conectados se enteran al instante.
    emitir_alerta({
        "tipo": "perucompras_logout",
        "data": {"uid": body.uid, "usuario": etiqueta},
    }, persistir=False)
    return {"ok": True}


@app.post("/sesion/erp/login")
def erp_login_endpoint(body: Optional[LoginRequest] = None):
    usuario = (body.usuario if body and body.usuario else ERP_USER)
    password = (body.password if body and body.password else ERP_PASS)
    if not usuario or not password:
        raise HTTPException(
            status_code=500,
            detail="Faltan credenciales del ERP (env vars ERP_USER/ERP_PASS o body).",
        )
    if erp_session.estado == "cargando":
        return {"ok": True, "detalle": "Login ya en progreso"}
    erp_session.login_async(usuario, password)
    return {"ok": True, "detalle": "Login iniciado en background"}


@app.post("/sesion/erp/logout")
def erp_logout():
    erp_session.logout()
    return {"ok": True}




@app.get("/erp/ventas")
def erp_ventas(forzar: bool = Query(False), usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        resultado = erp_session.obtener_todas_ventas(forzar=forzar)
    except Exception as e:
        logger.warning(f"Error obteniendo ventas del ERP: {e}")
        raise HTTPException(status_code=502, detail=f"Error obteniendo ventas del ERP: {e}")

    catalogos_permitidos = usuario.catalogos_permitidos
    if catalogos_permitidos:  # None o [] = ve todo (admin)
        ventas_filtradas = [
            v for v in resultado.get("ventas", [])
            if (v.get("catalogoEmpresa") or {}).get("id") in catalogos_permitidos
        ]
        resultado = {**resultado, "ventas": ventas_filtradas, "total": len(ventas_filtradas)}

    return resultado



@app.get("/erp/proveedores")
def erp_proveedores():
    """Proxy hacia GET /api/providers del ERP — usado por el buscador
    de proveedor en el formulario de seguimiento de OPs."""
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/providers", timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error obteniendo proveedores del ERP: {e}")
        raise HTTPException(status_code=502, detail=f"Error obteniendo proveedores del ERP: {e}")


@app.get("/erp/transportes")
def erp_transportes():
    """Proxy hacia GET /api/transports del ERP — usado por el buscador
    de agencia de transporte en el formulario de seguimiento de OPs."""
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/transports", timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error obteniendo transportes del ERP: {e}")
        raise HTTPException(status_code=502, detail=f"Error obteniendo transportes del ERP: {e}")
    

@app.get("/erp/proveedores/{proveedor_id}/contactos")
def erp_proveedor_contactos(proveedor_id: int):
    """Proxy hacia GET /api/contacts/provider/{id} del ERP."""
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/contacts/provider/{proveedor_id}", timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error obteniendo contactos del proveedor {proveedor_id}: {e}")
        raise HTTPException(status_code=502, detail=f"Error obteniendo contactos del proveedor: {e}")


class ContactoProveedorCrearRequest(BaseModel):
    nombre: str
    cargo: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    cumpleanos: Optional[str] = None
    nota: Optional[str] = None


@app.post("/erp/proveedores/{proveedor_id}/contactos")
def erp_proveedor_contacto_crear(proveedor_id: int, body: ContactoProveedorCrearRequest):
    """Proxy hacia POST /api/contacts del ERP, con tipo=PROVEEDOR fijo."""
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        payload = body.dict(exclude_none=True)
        payload["proveedorId"] = proveedor_id
        payload["referenciaId"] = proveedor_id
        payload["tipo"] = "PROVEEDOR"
        r = erp_session.session.post(f"{ERP_API_BASE}/contacts", json=payload, timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error creando contacto del proveedor {proveedor_id}: {e}")
        detalle = getattr(e, "response", None)
        raise HTTPException(status_code=502, detail=f"Error creando contacto del proveedor: {detalle.text if detalle is not None else e}")


    
class CuentaBancariaCrear(BaseModel):
    tipoCuenta: Optional[str] = "corriente"
    banco: Optional[str] = None
    numeroCuenta: Optional[str] = None


class ProveedorCrearRequest(BaseModel):
    ruc: str
    razonSocial: str
    telefono: Optional[str] = None
    email: Optional[str] = None
    departamento: Optional[str] = None
    provincia: Optional[str] = None
    distrito: Optional[str] = None
    direccion: Optional[str] = None
    cuentasBancarias: Optional[list[CuentaBancariaCrear]] = None


@app.post("/erp/proveedores")
def erp_proveedor_crear(body: ProveedorCrearRequest):
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        payload = body.dict(exclude_none=True)
        r = erp_session.session.post(f"{ERP_API_BASE}/providers", json=payload, timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error creando proveedor en el ERP: {e}")
        detalle = getattr(e, "response", None)
        raise HTTPException(status_code=502, detail=f"Error creando proveedor en el ERP: {detalle.text if detalle is not None else e}")


class TransporteCrearRequest(BaseModel):
    ruc: str
    razonSocial: str
    telefono: Optional[str] = None
    email: Optional[str] = None
    cobertura: Optional[str] = None
    departamento: Optional[str] = None
    provincia: Optional[str] = None
    distrito: Optional[str] = None
    direccion: Optional[str] = None
    numCuentaDetracciones: Optional[str] = None
    cuentasBancarias: Optional[list[CuentaBancariaCrear]] = None


@app.post("/erp/transportes")
def erp_transporte_crear(body: TransporteCrearRequest):
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        payload = body.dict(exclude_none=True)
        r = erp_session.session.post(f"{ERP_API_BASE}/transports", json=payload, timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error creando transporte en el ERP: {e}")
        detalle = getattr(e, "response", None)
        raise HTTPException(status_code=502, detail=f"Error creando transporte en el ERP: {detalle.text if detalle is not None else e}")


@app.get("/erp/ubigeo/departamentos")
def erp_ubigeo_departamentos():
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/ubigeo/regions", timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error obteniendo departamentos: {e}")
        raise HTTPException(status_code=502, detail=f"Error obteniendo departamentos: {e}")


@app.get("/erp/ubigeo/provincias")
def erp_ubigeo_provincias(region: str = Query(...)):
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/ubigeo/provinces", params={"region": region}, timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error obteniendo provincias: {e}")
        raise HTTPException(status_code=502, detail=f"Error obteniendo provincias: {e}")


@app.get("/erp/ubigeo/distritos")
def erp_ubigeo_distritos(province: str = Query(...)):
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/ubigeo/districts", params={"province": province}, timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error obteniendo distritos: {e}")
        raise HTTPException(status_code=502, detail=f"Error obteniendo distritos: {e}")






@app.get("/erp/ordenes/{orden_compra_id}/ops")
def erp_ops_de_orden(orden_compra_id: int):
    """Lista las OPs (órdenes de proveedor) de una venta, con el estado
    de seguimiento de Helbot (pendiente/preview/subido) fusionado."""
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        ops = op_seguimiento.listar_ops_de_orden(orden_compra_id)
    except Exception as e:
        logger.warning(f"Error listando OPs de orden {orden_compra_id}: {e}")
        raise HTTPException(status_code=502, detail=f"Error consultando OPs en el ERP: {e}")

    op_ids = [op["id"] for op in ops]
    seguimientos = op_seguimiento.obtener_seguimientos_masivo(op_ids)
    for op in ops:
        seg = seguimientos.get(op["id"])
        op["_seguimiento"] = {
            "estado": seg["estado"] if seg else "pendiente",
            "rellenado_por": seg.get("rellenado_por") if seg else None,
            "subido_por": seg.get("subido_por") if seg else None,
        }
    return ops



@app.get("/erp/ventas/seguimientos-productos")
def erp_ventas_seguimientos_productos():
    """Lista compacta de seguimiento por producto de TODAS las órdenes,
    para pintar el progreso en las cards de Ventas ERP."""
    try:
        return op_seguimiento.obtener_todos_seguimientos_productos()
    except Exception as e:
        logger.warning(f"Error obteniendo seguimientos de productos: {e}")
        raise HTTPException(status_code=502, detail=f"Error consultando seguimientos: {e}")


@app.get("/erp/estadisticas/seguimiento")
def erp_estadisticas_seguimiento():
    """Reporte de auditoría para gerencia: quién envió cada producto a
    revisión y quién lo confirmó, con fechas. Ver op_seguimiento.
    obtener_estadisticas_seguimiento para el detalle del shape."""
    try:
        return op_seguimiento.obtener_estadisticas_seguimiento()
    except Exception as e:
        logger.warning(f"Error obteniendo estadísticas de seguimiento: {e}")
        raise HTTPException(status_code=500, detail=f"Error consultando estadísticas: {e}")

@app.post("/erp/ventas/{orden_compra_id}/actualizar-siaf")
def erp_venta_actualizar_siaf(orden_compra_id: int, body: ActualizarSiafRequest):
    """Botón 'Completar resultados en el ERP' del panel MEF: actualiza
    etapaSiaf/fechaSiaf/fuentesFinanciamiento/montoVenta calculados a
    partir de la tabla de resultados del MEF."""
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        resultado = op_seguimiento.actualizar_datos_siaf(
            orden_compra_id,
            body.etapa_siaf,
            body.fecha_siaf,
            body.fuentes_financiamiento,
            body.multiple_fuentes_financiamiento,
            body.monto_venta,
        )
    except Exception as e:
        logger.warning(f"Error actualizando datos SIAF de orden {orden_compra_id}: {e}")
        raise HTTPException(status_code=502, detail=f"Error actualizando en el ERP: {e}")

    # Guarda el snapshot de ESTE envío — así la próxima vez que se
    # consulte el MEF, se puede comparar y avisar si los datos cambiaron.
    try:
        op_seguimiento.guardar_mef_actualizacion(
            orden_compra_id,
            body.siaf,
            body.expediente,
            body.etapa_siaf,
            body.fecha_siaf,
            body.fuentes_financiamiento,
            body.multiple_fuentes_financiamiento,
            body.monto_venta,
            body.registros or [],
            body.completado_por,
        )
    except Exception as e:
        logger.warning(f"No se pudo guardar el snapshot MEF de orden {orden_compra_id}: {e}")

    # Avisa en vivo por WebSocket a todos MENOS al propio usuario que
    # hizo la acción — el frontend filtra comparando completado_por con
    # el usuario logueado en ese cliente (mismo patrón que op_rellenada).
    emitir_alerta({
        "tipo": "mef_completado",
        "data": {
            "orden_compra_id": orden_compra_id,
            "siaf": body.siaf,
            "expediente": body.expediente,
            "unidad_ejecutora": body.unidad_ejecutora,
            "monto_venta": body.monto_venta,
            "completado_por": body.completado_por,
        },
    })

    return resultado


@app.get("/erp/ventas/{orden_compra_id}/mef-completado")
def erp_venta_mef_completado(orden_compra_id: int):
    """Devuelve el último snapshot guardado (o None) de cuándo/quién/
    qué datos se enviaron al ERP desde el panel MEF de esta venta."""
    return op_seguimiento.obtener_mef_actualizacion(orden_compra_id)



@app.post("/erp/ordenes/{orden_compra_id}/iniciar")
def erp_ordenes_iniciar(orden_compra_id: int):
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        r = erp_session.session.get(
            f"{ERP_API_BASE}/agrupaciones-oc/by-orden-compra/{orden_compra_id}",
            timeout=20,
        )
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error consultando agrupaciones OC de orden {orden_compra_id}: {e}")
        raise HTTPException(status_code=502, detail=f"Error generando OP en el ERP: {e}")


class OpOrdenProductosCrear(BaseModel):
    productos: list[dict]
    numero_ocam: Optional[str] = None
    codigo_venta: Optional[str] = None


class ProductoMontoReferencia(BaseModel):
    codigo: str
    monto_referencia: Optional[float] = None


class MontosReferenciaRequest(BaseModel):
    productos: list[ProductoMontoReferencia]


@app.post("/erp/ordenes/{orden_compra_id}/productos-seguimiento/asegurar")
def erp_orden_productos_asegurar(orden_compra_id: int, body: OpOrdenProductosCrear):
    """Crea (idempotente) las filas de seguimiento por producto para una
    orden que AÚN NO tiene OP real en el ERP (nOps == 0). El frontend
    manda venta.productos tal cual vino de /erp/ventas — no se necesita
    ninguna llamada extra al ERP externo."""
    try:
        op_seguimiento.asegurar_filas_productos_preview(
            orden_compra_id, body.numero_ocam, body.codigo_venta, body.productos
        )
    except Exception as e:
        logger.warning(f"Error asegurando filas de productos para orden {orden_compra_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error preparando seguimiento: {e}")
    return op_seguimiento.obtener_seguimientos_de_orden(orden_compra_id)


@app.post("/erp/ordenes/{orden_compra_id}/productos/montos-referencia")
def erp_orden_montos_referencia(orden_compra_id: int, body: MontosReferenciaRequest):
    """Guarda el 'Monto importe' de referencia POR PRODUCTO — lo usa    
    CrearOrdenModal cuando la orden tiene varios productos, para que
    cada uno calcule su propio margen en vez de compartir el montoVenta
    de toda la orden. Nunca se manda al ERP."""
    try:
        op_seguimiento.guardar_montos_referencia(
            orden_compra_id, [p.dict() for p in body.productos]
        )
    except Exception as e:
        logger.warning(f"Error guardando montos de referencia de orden {orden_compra_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error guardando montos de referencia: {e}")
    return {"ok": True}



@app.get("/erp/ordenes/{orden_compra_id}/productos/montos-referencia")
def erp_orden_montos_referencia_obtener(orden_compra_id: int):
    """Contraparte de lectura del endpoint POST de arriba — el frontend
    (obtenerMontosReferenciaProductos en erp-shared.ts) la usa para
    rellenar 'Monto importe (ref. margen)' al reabrir una venta ya
    guardada. Sin este GET, el campo siempre queda vacío."""
    try:
        productos = op_seguimiento.obtener_montos_referencia(orden_compra_id)
    except Exception as e:
        logger.warning(f"Error obteniendo montos de referencia de orden {orden_compra_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error obteniendo montos de referencia: {e}")
    return {"productos": productos}


@app.get("/erp/ordenes/{orden_compra_id}/productos-seguimiento")
def erp_orden_productos_seguimiento(orden_compra_id: int):
    """Seguimiento de Helbot por producto de una orden de compra, para
    fusionar con venta.productos en el drawer cuando nOps == 0."""
    try:
        return op_seguimiento.obtener_seguimientos_de_orden(orden_compra_id)
    except Exception as e:
        logger.warning(f"Error obteniendo seguimiento de orden {orden_compra_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error consultando seguimiento: {e}")


@app.post("/erp/ordenes/{orden_compra_id}/productos/{producto_codigo}/rellenar-preview")
def erp_orden_producto_rellenar_preview(orden_compra_id: int, producto_codigo: str, body: OpProductoRellenarRequest):
    """Rellena el formulario de UN producto de una orden que aún no
    tiene OP real en el ERP (op_id = NULL). Pasa ese producto a 'preview'."""
    try:
        resultado = op_seguimiento.rellenar_producto_de_orden(
            orden_compra_id,
            producto_codigo,
            body.dict(exclude={"rellenado_por", "numero_ocam", "codigo_venta", "producto_descripcion"}),
            body.rellenado_por,
            body.numero_ocam,
            body.codigo_venta,
            body.producto_descripcion,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.warning(f"Error rellenando producto {producto_codigo} de orden {orden_compra_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error guardando el llenado: {e}")

    emitir_alerta({
        "tipo": "op_rellenada",
        "data": {
            "orden_compra_id": orden_compra_id,
            "producto_codigo": producto_codigo,
            "producto_descripcion": resultado.get("producto_descripcion"),
            "rellenado_por": body.rellenado_por,
            "campos_faltantes": resultado.get("campos_faltantes", []),
        },
    })
    return resultado




@app.post("/erp/ordenes/{orden_compra_id}/productos/enviar-bloque")
def erp_orden_productos_enviar_bloque(orden_compra_id: int, body: OpProductosBloqueRequest):
    """Rellena EN BLOQUE varios productos de una orden que aún no tienen
    OP real en el ERP, compartiendo los datos comunes (proveedor, transporte, etc.)
    pero con precio/flete/comodato independientes por producto. Usa
    rellenar_productos_en_bloque, que arma automáticamente el
    grupo_envio_id y las observaciones_transporte con el desglose de
    flete por producto."""
    try:
        resultados = op_seguimiento.rellenar_productos_en_bloque(
            orden_compra_id=orden_compra_id,
            productos=[p.dict() for p in body.productos],
            datos_compartidos=body.datos_compartidos.dict(),
            rellenado_por=body.rellenado_por,
            numero_ocam=body.numero_ocam,
            codigo_venta=body.codigo_venta,
        )
    except Exception as e:
        logger.warning(f"Error rellenando en bloque orden {orden_compra_id}: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    emitir_alerta({
        "tipo": "op_rellenada_bloque",
        "data": {
            "orden_compra_id": orden_compra_id,
            "productos_codigos": [r.get("producto_codigo") for r in resultados],
            "grupo_envio_id": resultados[0].get("grupo_envio_id") if resultados else None,
            "rellenado_por": body.rellenado_por,
            "cantidad": len(resultados),
        },
    })
    return {"resultados": resultados, "errores": []}

@app.get("/erp/ops/{op_id}")
def erp_op_detalle(op_id: int):
    """Detalle completo de una OP (productos, proveedor, transporte del
    ERP real) + el seguimiento de Helbot, uno por CADA producto de la OP
    (cada producto puede tener su propio proveedor/precio/flete)."""
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        detalle = op_seguimiento.detalle_op(op_id)
    except Exception as e:
        logger.warning(f"Error obteniendo detalle de OP {op_id}: {e}")
        raise HTTPException(status_code=502, detail=f"Error consultando la OP en el ERP: {e}")

    orden_compra_id = detalle.get("ordenCompraId")
    numero_ocam = (detalle.get("ordenCompra") or {}).get("numeroOcam")
    productos = detalle.get("productos") or []

    op_seguimiento.asegurar_filas_productos(op_id, orden_compra_id, numero_ocam, productos)
    seguimientos_por_codigo = op_seguimiento.obtener_seguimientos_productos(op_id)

    for p in productos:
        codigo = str(p.get("codigo") or p.get("id") or "")
        seg = seguimientos_por_codigo.get(codigo)
        p["_seguimiento"] = {
            "estado": seg["estado"] if seg else "pendiente",
            "proveedor_nombre": seg.get("proveedor_nombre") if seg else None,
            "proveedor_telefono": seg.get("proveedor_telefono") if seg else None,
            "precio_producto": float(seg["precio_producto"]) if seg and seg.get("precio_producto") is not None else None,
            "comodato": seg.get("comodato") if seg else None,
            "agencia_transporte": seg.get("agencia_transporte") if seg else None,
            "precio_flete": float(seg["precio_flete"]) if seg and seg.get("precio_flete") is not None else None,
            "rellenado_por": seg.get("rellenado_por") if seg else None,
            "subido_por": seg.get("subido_por") if seg else None,
        }

    detalle["productos"] = productos
    return detalle

@app.post("/erp/ops/{op_id}/rellenar")
def erp_op_rellenar(op_id: int, body: OpRellenarRequest, orden_compra_id: int = Query(...)):
    """Usuario externo llena proveedor/precio/comodato/flete. Pasa a
    estado 'preview' y avisa a seguimiento por WebSocket."""
    try:
        resultado = op_seguimiento.rellenar_op(
            op_id,
            orden_compra_id,
            body.numero_ocam,
            body.dict(exclude={"rellenado_por", "numero_ocam"}),
            body.rellenado_por,
        )
    except Exception as e:
        logger.warning(f"Error rellenando OP {op_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error guardando el llenado: {e}")

    emitir_alerta({
        "tipo": "op_rellenada",
        "data": {
            "op_id": op_id,
            "orden_compra_id": orden_compra_id,
            "numero_ocam": body.numero_ocam,
            "rellenado_por": body.rellenado_por,
        },
    })
    return resultado


@app.post("/erp/ops/{op_id}/subir-erp")
def erp_op_subir(op_id: int, body: OpSubirErpRequest):
    """Seguimiento confirma y sube (por ahora, solo localmente — ver TODO
    en op_seguimiento.subir_al_erp) los datos revisados."""
    try:
        resultado = op_seguimiento.subir_al_erp(op_id, body.subido_por)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.warning(f"Error subiendo OP {op_id} al ERP: {e}")
        raise HTTPException(status_code=500, detail=f"Error subiendo al ERP: {e}")

    emitir_alerta({
        "tipo": "op_subida_erp",
        "data": {
            "op_id": op_id,
            "orden_compra_id": (resultado or {}).get("orden_compra_id"),
            "subido_por": body.subido_por,
        },
    })
    return resultado



@app.post("/erp/ops/{op_id}/productos/{producto_codigo}/rellenar")
def erp_op_producto_rellenar(op_id: int, producto_codigo: str, body: OpProductoRellenarRequest):
    """Usuario externo llena proveedor/precio/comodato/flete de UN
    producto específico de la OP. Pasa ese producto a 'preview'."""
    try:
        resultado = op_seguimiento.rellenar_producto(
            op_id,
            producto_codigo,
            body.dict(exclude={"rellenado_por"}),
            body.rellenado_por,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.warning(f"Error rellenando producto {producto_codigo} de OP {op_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error guardando el llenado: {e}")

    emitir_alerta({
        "tipo": "op_rellenada",
        "data": {"op_id": op_id, "producto_codigo": producto_codigo, "rellenado_por": body.rellenado_por},
    })
    return resultado


@app.post("/erp/ops/{op_id}/productos/{producto_codigo}/subir-erp")
def erp_op_producto_subir(op_id: int, producto_codigo: str, body: OpProductoSubirRequest):
    """Seguimiento confirma y sube (por ahora, solo localmente) los datos
    revisados de UN producto de la OP."""
    try:
        resultado = op_seguimiento.subir_producto_al_erp(op_id, producto_codigo, body.subido_por)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.warning(f"Error subiendo producto {producto_codigo} de OP {op_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error subiendo al ERP: {e}")

    emitir_alerta({
        "tipo": "op_subida_erp",
        "data": {
            "op_id": op_id,
            "orden_compra_id": (resultado or {}).get("orden_compra_id"),
            "producto_codigo": producto_codigo,
            "subido_por": body.subido_por,
        },
    })
    return resultado


@app.post("/erp/ordenes/{orden_compra_id}/productos/{producto_codigo}/confirmar")
def erp_orden_producto_confirmar(orden_compra_id: int, producto_codigo: str, body: ConfirmarProductoRequest):
    """Seguimiento revisa un producto en 'preview' y lo aprueba -> pasa a
    'confirmado'. A partir de aquí el formulario queda de solo lectura
    para cualquier rol que no sea seguimiento. Además intenta escribir
    los datos en el ERP real (Railway) — si eso falla, el producto se
    queda igual 'confirmado' en Helbot, pero se avisa el error para que
    seguimiento lo suba manualmente."""
    try:
        resultado = op_seguimiento.confirmar_producto_de_orden(orden_compra_id, producto_codigo, body.confirmado_por)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.warning(f"Error confirmando producto {producto_codigo} de orden {orden_compra_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error confirmando: {e}")

    error_erp = None
    try:
        op_seguimiento.subir_producto_al_erp_real(orden_compra_id, producto_codigo)
        logger.info(f"Producto {producto_codigo} de orden {orden_compra_id} subido al ERP real correctamente")
    except Exception as e:
        error_erp = str(e)
        logger.warning(f"No se pudo subir al ERP real el producto {producto_codigo} de orden {orden_compra_id}: {e}")

    emitir_alerta({
        "tipo": "op_confirmada",
        "data": {
            "orden_compra_id": orden_compra_id,
            "producto_codigo": producto_codigo,
            "producto_descripcion": resultado.get("producto_descripcion"),
            "confirmado_por": body.confirmado_por,
            "error_erp": error_erp,
        },
    })
    resultado["error_erp"] = error_erp
    return resultado


@app.post("/erp/ordenes/{orden_compra_id}/productos/{producto_codigo}/actualizar")
def erp_orden_producto_actualizar(orden_compra_id: int, producto_codigo: str, body: ActualizarProductoRequest):
    """Seguimiento corrige datos de un producto ya enviado (preview o
    confirmado) SIN tocar el estado. Solo debe ser llamado por el rol
    seguimiento (esa validación de rol se hace en el frontend con
    esSeguimiento; si luego agregas auth por rol acá, este es el lugar)."""
    try:
        resultado = op_seguimiento.actualizar_producto_seguimiento(
            orden_compra_id,
            producto_codigo,
            body.dict(exclude={"producto_descripcion"}),
            body.producto_descripcion,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.warning(f"Error actualizando producto {producto_codigo} de orden {orden_compra_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error actualizando: {e}")
    return resultado





class ActualizarYSubirErpRequest(BaseModel):
    proveedor_nombre: Optional[str] = None
    proveedor_id: Optional[int] = None
    proveedor_telefono: Optional[str] = None
    precio_producto: Optional[float] = None
    comodato: Optional[str] = None
    observaciones_externas: Optional[str] = None
    agencia_transporte: Optional[str] = None
    transporte_id: Optional[int] = None
    precio_flete: Optional[float] = None
    observaciones: Optional[str] = None
    observaciones_transporte: Optional[str] = None
    otras_observaciones: Optional[str] = None
    margen: Optional[str] = None
    margen_orden: Optional[str] = None
    tipo_envio: Optional[str] = None
    empresa_id: Optional[int] = None
    empresa_nombre: Optional[str] = None
    actualizado_por: str
    producto_descripcion: Optional[str] = None

@app.post("/erp/ordenes/{orden_compra_id}/productos/{producto_codigo}/actualizar-erp")
def erp_orden_producto_actualizar_erp(orden_compra_id: int, producto_codigo: str, body: ActualizarYSubirErpRequest):
    """Seguimiento corrige datos de un producto YA confirmado/subido y
    los reenvía al ERP real (PUT /ordenes-proveedores/op/{id}) SIN
    cambiar el estado de seguimiento. A diferencia de /actualizar (que
    solo guarda en MySQL de Helbot), este endpoint SÍ dispara el
    subir_producto_al_erp_real y avisa por WebSocket."""
    try:
        resultado = op_seguimiento.actualizar_producto_seguimiento(
            orden_compra_id,
            producto_codigo,
            body.dict(exclude={"actualizado_por", "producto_descripcion"}),
            body.producto_descripcion,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.warning(f"Error guardando producto {producto_codigo} de orden {orden_compra_id} antes de actualizar en ERP: {e}")
        raise HTTPException(status_code=500, detail=f"Error guardando: {e}")

    error_erp = None    
    try:
        # mantener_op_actual=True: esta ruta es SIEMPRE una actualización
        # de un producto que ya vive en una OP real — nunca debe buscar
        # ni crear otra OP aunque el proveedor/empresa hayan cambiado en
        # el formulario, a diferencia de la primera confirmación (más
        # abajo, en /confirmar) que sí necesita esa búsqueda.
        op_seguimiento.subir_producto_al_erp_real(orden_compra_id, producto_codigo, mantener_op_actual=True)
        logger.info(f"Producto {producto_codigo} de orden {orden_compra_id} actualizado en el ERP real correctamente")
    except Exception as e:
        import traceback
        error_erp = str(e)
        logger.warning(f"No se pudo actualizar en el ERP real el producto {producto_codigo} de orden {orden_compra_id}: {e}")
        logger.warning(traceback.format_exc())
    emitir_alerta({
        "tipo": "op_actualizada_erp",
        "data": {
            "orden_compra_id": orden_compra_id,
            "producto_codigo": producto_codigo,
            "producto_descripcion": resultado.get("producto_descripcion"),
            "actualizado_por": body.actualizado_por,
            "error_erp": error_erp,
        },
    })
    resultado["error_erp"] = error_erp
    return resultado
# ============================================================
# Imágenes por producto (máximo 4) — funciona tanto para el flujo



# ============================================================
# Imágenes por producto (máximo 4) — funciona tanto para el flujo
# "crear proveedor" (op_id NULL) como para una OP real ya generada,
# porque ambas comparten la misma fila en op_producto_seguimiento
# identificada por (orden_compra_id, producto_codigo).
# ============================================================
MAX_IMAGENES_POR_PRODUCTO = 6
EXTENSIONES_PERMITIDAS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf", ".doc", ".docx"}


def _con_url(imagenes: list[dict]) -> list[dict]:
    """Agrega el campo 'url' (link completo y listo para <img src=...>)
    a cada imagen, usando el backend de almacenamiento activo. El
    frontend YA NO necesita construir la URL — la usa tal cual."""
    return [{**img, "url": almacenamiento.url_publica(img["ruta_archivo"])} for img in imagenes]


@app.get("/erp/ordenes/{orden_compra_id}/productos/{producto_codigo}/imagenes")
def listar_imagenes_producto(orden_compra_id: int, producto_codigo: str):
    return _con_url(op_seguimiento.listar_imagenes_por_producto(orden_compra_id, producto_codigo))







@app.get("/erp/ordenes/{orden_compra_id}/productos/pdf-consolidado-preview")
def erp_pdf_consolidado_preview(orden_compra_id: int, codigos: List[str] = Query(...)):
    """Vista previa EN VIVO (sin guardar nada en DB/disco) del PDF que
    resultaría de fusionar las imágenes/documentos de varios productos
    juntos. Se usa en el modal de envío en bloque (PanelEnvioBloque)
    ANTES de que exista un grupo_envio_id real — así ventas ve cómo
    quedaría el PDF consolidado mientras todavía está subiendo archivos
    producto por producto."""
    from fastapi import Response as _Response

    imagenes: list = []
    for codigo in codigos:
        imagenes.extend(op_seguimiento.listar_imagenes_por_producto(orden_compra_id, codigo))

    if not imagenes:
        raise HTTPException(status_code=404, detail="Todavía no hay archivos subidos en estos productos.")

    pdf_bytes = op_seguimiento._construir_pdf_desde_imagenes(imagenes)
    if pdf_bytes is None:
        raise HTTPException(status_code=404, detail="No se pudo generar el PDF con los archivos subidos.")

    return _Response(content=pdf_bytes, media_type="application/pdf")



@app.post("/erp/ordenes/{orden_compra_id}/productos/{producto_codigo}/imagenes")
async def subir_imagenes_producto(
    orden_compra_id: int,
    producto_codigo: str,
    archivos: List[UploadFile] = File(...),
):
    seguimiento_id = op_seguimiento.obtener_o_crear_seguimiento_id(orden_compra_id, producto_codigo)
    ya_existentes = op_seguimiento.contar_imagenes(seguimiento_id)

    if ya_existentes + len(archivos) > MAX_IMAGENES_POR_PRODUCTO:
        raise HTTPException(
            status_code=400,
            detail=f"Máximo {MAX_IMAGENES_POR_PRODUCTO} imágenes por producto (ya tienes {ya_existentes}).",
        )

    for archivo in archivos:
        ext = Path(archivo.filename or "").suffix.lower()
        if ext not in EXTENSIONES_PERMITIDAS:
            raise HTTPException(status_code=400, detail=f"Formato no permitido: {archivo.filename}")

        contenido = await archivo.read()
        ruta_archivo = almacenamiento.guardar(contenido, ext, str(seguimiento_id))

        op_seguimiento.guardar_imagen(
            seguimiento_id,
            ruta_archivo,
            archivo.filename or ruta_archivo,
        )

    # Regenerar siempre el PDF consolidado
    # Regenerar siempre el PDF consolidado
    op_seguimiento.generar_pdf_consolidado(
        orden_compra_id,
        producto_codigo,
    )

    emitir_alerta({
        "tipo": "producto_imagenes_actualizadas",
        "data": {
            "orden_compra_id": orden_compra_id,
            "producto_codigo": producto_codigo,
        },
    }, persistir=False)

    return _con_url(
        op_seguimiento.listar_imagenes_por_producto(
            orden_compra_id,
            producto_codigo,
        )
    )


@app.delete("/erp/ordenes/{orden_compra_id}/productos/{producto_codigo}/imagenes/{imagen_id}")
def eliminar_imagen_producto(orden_compra_id: int, producto_codigo: str, imagen_id: int):
    ruta_archivo = op_seguimiento.eliminar_imagen(imagen_id)

    if ruta_archivo is None:
        raise HTTPException(status_code=404, detail="Imagen no encontrada")

    try:
        almacenamiento.eliminar(ruta_archivo)
    except Exception as e:
        logger.warning(f"No se pudo borrar el archivo {ruta_archivo}: {e}")

    # Regenerar el PDF consolidado después de eliminar una imagen
    # Regenerar el PDF consolidado después de eliminar una imagen
    op_seguimiento.generar_pdf_consolidado(
        orden_compra_id,
        producto_codigo,
    )

    emitir_alerta({
        "tipo": "producto_imagenes_actualizadas",
        "data": {
            "orden_compra_id": orden_compra_id,
            "producto_codigo": producto_codigo,
        },
    }, persistir=False)

    return {"ok": True}
# ============================================================
# Foto de perfil del usuario logueado
# ============================================================
EXTENSIONES_PERFIL_PERMITIDAS = {".jpg", ".jpeg", ".png", ".webp"}


@app.post("/auth/perfil/foto")
async def subir_foto_perfil(
    archivo: UploadFile = File(...),
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    ext = Path(archivo.filename or "").suffix.lower()
    if ext not in EXTENSIONES_PERFIL_PERMITIDAS:
        raise HTTPException(status_code=400, detail=f"Formato no permitido: {archivo.filename}")

    contenido = await archivo.read()
    ruta_archivo = almacenamiento.guardar(contenido, ext, f"perfil_{usuario.id}")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # Borra la foto anterior (si tenía) para no acumular archivos huérfanos.
            cur.execute("SELECT foto_perfil FROM usuarios_helbot WHERE id = %s", (usuario.id,))
            fila = cur.fetchone()
            foto_anterior = fila.get("foto_perfil") if fila else None

            cur.execute(
                "UPDATE usuarios_helbot SET foto_perfil = %s WHERE id = %s",
                (ruta_archivo, usuario.id),
            )
    finally:
        conn.close()

    if foto_anterior:
        try:
            almacenamiento.eliminar(foto_anterior)
        except Exception as e:
            logger.warning(f"No se pudo borrar la foto de perfil anterior: {e}")

    return {"ok": True, "foto_perfil": ruta_archivo, "url": almacenamiento.url_publica(ruta_archivo)}


@app.delete("/auth/perfil/foto")
def eliminar_foto_perfil(usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT foto_perfil FROM usuarios_helbot WHERE id = %s", (usuario.id,))
            fila = cur.fetchone()
            foto_actual = fila.get("foto_perfil") if fila else None

            cur.execute(
                "UPDATE usuarios_helbot SET foto_perfil = NULL WHERE id = %s",
                (usuario.id,),
            )
    finally:
        conn.close()

    if foto_actual:
        try:
            almacenamiento.eliminar(foto_actual)
        except Exception as e:
            logger.warning(f"No se pudo borrar el archivo de foto de perfil: {e}")

    return {"ok": True}


# ============================================================
# Publicadas (detectadas en Peru Compras)
# ============================================================
def _guardar_publicadas_en_db(items: List[dict]) -> List[dict]:
    """Inserta lo nuevo (INSERT IGNORE por id) y devuelve solo los items
    que realmente se insertaron, para poder avisarlos por WebSocket."""
    if not items:
        return []
    conn = get_conn()
    nuevos = []
    try:
        with conn.cursor() as cur:
            for item in items:
                # TODO: ajustar las keys (id/acuerdo_marco/catalogo/...) al
                # shape real que devuelva buscar_publicadas() una vez conectado.
                cur.execute(
                    """
                    INSERT IGNORE INTO publicadas
                        (id, acuerdo_marco, catalogo, categoria, titulo, detalle_json)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (
                        item.get("id"),
                        item.get("acuerdo_marco"),
                        item.get("catalogo"),
                        item.get("categoria"),
                        item.get("titulo"),
                        guardar_json(item),
                    ),
                )
                if cur.rowcount:
                    nuevos.append(item)
    finally:
        conn.close()
    return nuevos


@app.post("/publicadas/buscar")
def publicadas_buscar(background_tasks: BackgroundTasks, filtro: dict = {}, uid: Optional[str] = None):
    uid_final = uid or perucompras_sesiones.activo_id
    sesion = perucompras_sesiones.sesion(uid_final) if uid_final else None
    if not sesion or not sesion.autenticado:
        raise HTTPException(status_code=401, detail="Sesión Peru Compras no activa. Inicia sesión primero.")

    def tarea():
        items = sesion.buscar_publicadas(filtro)
        nuevos = _guardar_publicadas_en_db(items)
        # buscar_publicadas() sigue siendo un STUB sin conectar (ver TODO
        # arriba del archivo) — los items que devuelve no traen C_OrdenCompra
        # ni C_Entidad reales, solo un id pelado de la tabla legacy `publicadas`.
        # La fuente real y correcta de "nueva_publicada" es monitor_publicadas.py
        # (vía _hacer_callback_nueva_orden), así que aquí NO se emite alerta
        # hasta que este endpoint esté realmente conectado al scraper.
        logger.info(f"publicadas_buscar: {len(items)} encontradas, {len(nuevos)} nuevas (sin notificar, endpoint stub)")

    background_tasks.add_task(tarea)
    return {"ok": True, "detalle": "Búsqueda de publicadas iniciada en background"}


@app.get("/publicadas")
def publicadas_listar(uid: Optional[str] = None):
    """
    Snapshot en memoria del monitor del usuario `uid` (o el usuario
    "activo" — el último logueado — si no se especifica).
    """
    uid_final = uid or perucompras_sesiones.activo_id
    m = monitor_de(uid_final) if uid_final else None
    if not m:
        return []
    return m.snapshot()


@app.get("/publicadas/{n_orden_compra}/entregas")
def publicadas_entregas(n_orden_compra: int, uid: Optional[str] = None):
    uid_final = uid or perucompras_sesiones.activo_id
    sesion = perucompras_sesiones.sesion(uid_final) if uid_final else None
    if not sesion or not sesion.autenticado:
        raise HTTPException(
            status_code=401,
            detail="Sesión Peru Compras no activa para este usuario. Inicia sesión primero.",
        )
    m = monitor_de(uid_final)
    return m.consultar_entregas(n_orden_compra) if m else []




@app.get("/publicadas/{n_orden_compra}/pdf")
def publicadas_pdf(n_orden_compra: int, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    """Proxy: descarga el PDF OCAM en el backend y lo reenvía como bytes
    puros, sin el header Content-Disposition: attachment que trae Peru
    Compras — así el iframe del frontend lo puede mostrar sin forzar
    descarga."""
    import requests as _requests
    from fastapi import Response as _Response

    url = (
        "https://apps1.perucompras.gob.pe/OrdenCompra/obtenerPdfOrdenPublico"
        f"?ID_OrdenCompra={n_orden_compra}&ImprimirCompleto=1"
    )
    try:
        r = _requests.get(url, timeout=25)
        r.raise_for_status()
    except Exception as e:
        logger.warning(f"Error descargando PDF OCAM de orden {n_orden_compra}: {e}")
        raise HTTPException(status_code=502, detail=f"No se pudo obtener el PDF: {e}")

    return _Response(content=r.content, media_type="application/pdf")


@app.get("/publicadas/{n_orden_compra}/pdf-fisica")
def publicadas_pdf_fisica(
    n_orden_compra: int,
    uid: Optional[str] = None,
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    """Proxy: descarga el PDF de la orden física (C_RutaPdf) desde el
    Azure Blob de Peru Compras y lo reenvía como bytes puros.

    OJO: el snapshot cacheado del monitor (/consulta) a veces trae
    C_RutaPdf en None para una orden todavía PUBLICADA, aunque el dato
    SÍ existe. consultar_entregas() (mismo endpoint que ya usa el
    frontend para pintar lugar/fecha de entrega) trae el dato real y
    actualizado, así que la usamos como fuente de verdad aquí."""
    import requests as _requests
    from fastapi import Response as _Response

    uid_final = uid or perucompras_sesiones.activo_id
    m = monitor_de(uid_final) if uid_final else None
    if not m:
        raise HTTPException(status_code=404, detail="No hay monitor activo para este usuario")

    entregas = m.consultar_entregas(n_orden_compra)
    item_entrega = entregas[0] if entregas else {}
    item_snapshot = m.obtener_por_id(n_orden_compra) or {}

    # OJO: NO usar {**item_snapshot, **item_entrega} a secas — si
    # item_entrega trae la llave C_RutaPdf presente pero en None (porque
    # consultaEntregas no está pensado para traer ese campo), pisa
    # silenciosamente el valor bueno que sí viene en item_snapshot desde
    # /consulta. Por eso la física fallaba y la OCAM (URL fija, sin este
    # merge) nunca fallaba. Regla: solo sobrescribe si el valor de
    # item_entrega es realmente útil (no None/no vacío).
    item = dict(item_snapshot)
    for _k, _v in item_entrega.items():
        if _v is not None and _v != "":
            item[_k] = _v

    logger.info(
        f"pdf-fisica OC {n_orden_compra}: "
        f"snapshot_tiene_ruta={bool(item_snapshot.get('C_RutaPdf'))}, "
        f"entrega_tiene_ruta={bool(item_entrega.get('C_RutaPdf'))}, "
        f"item_final_tiene_ruta={bool(item.get('C_RutaPdf'))}, "
        f"entregas_pLista_len={len(entregas)}"
    )

    if not item:
        raise HTTPException(status_code=404, detail="No se pudo consultar la entrega de esta orden")

    url = m.obtener_url_pdf(item, tipo="fisica")
    if not url:
        raise HTTPException(status_code=404, detail="Esta orden no tiene PDF de orden física disponible")

    # 🔎 DEBUG TEMPORAL — para confirmar si C_RutaPdf trae espacio antes de .pdf
    nombre_crudo = item.get("C_RutaPdf")
    logger.info(f"🔎 DEBUG C_RutaPdf crudo (repr) = {nombre_crudo!r}, longitud={len(nombre_crudo or '')}")

    try:
        r = _requests.get(url, timeout=25)
        logger.info(
            f"pdf-fisica OC {n_orden_compra}: GET {url!r} -> "
            f"status={r.status_code}, content-type={r.headers.get('content-type')}, bytes={len(r.content)}"
        )
        r.raise_for_status()

    except Exception as e:
        logger.warning(f"Error descargando PDF física de orden {n_orden_compra} (url={url!r}): {e}")
        raise HTTPException(status_code=502, detail=f"No se pudo obtener el PDF: {e}")

    return _Response(content=r.content, media_type="application/pdf")


@app.patch("/publicadas/{publicada_id}/estado")
def publicadas_actualizar_estado(publicada_id: str, body: EstadoGestionUpdate):
    if body.estado_gestion not in ("nueva", "registrada"):
        raise HTTPException(status_code=422, detail="estado_gestion debe ser 'nueva' o 'registrada'")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE publicadas SET estado_gestion = %s WHERE id = %s",
                (body.estado_gestion, publicada_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(status_code=404, detail="Publicada no encontrada")
    finally:
        conn.close()
    return {"ok": True}


def _marcar_publicada_registrada(publicada_id: str):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE publicadas SET estado_gestion = 'registrada' WHERE id = %s",
                (publicada_id,),
            )
    finally:
        conn.close()



@app.post("/erp/completar")
def erp_completar(req: ErpCompletarRequest):
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")
    try:
        resultado = erp_session.completar_orden(req.publicada_id, req.datos)
    except Exception as e:
        logger.warning(f"Error completando orden en ERP ({req.publicada_id}): {e}")
        raise HTTPException(status_code=502, detail=f"Error completando orden en ERP: {e}")

    try:
        _marcar_publicada_registrada(req.publicada_id)
    except Exception as e:
        logger.warning(f"No se pudo marcar publicada {req.publicada_id} como registrada: {e}")

    return {"ok": True, "resultado": resultado}


# ============================================================
# Ordenes (personal 1 registra -> personal ventas completa precio)
# ============================================================
@app.post("/ordenes", response_model=OrdenOut)
def ordenes_crear(orden: OrdenCreate):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO ordenes (publicada_id, producto, cantidad, registrado_por)
                VALUES (%s, %s, %s, %s)
                """,
                (orden.publicada_id, orden.producto, orden.cantidad, orden.registrado_por),
            )
            nuevo_id = cur.lastrowid
            cur.execute("SELECT * FROM ordenes WHERE id = %s", (nuevo_id,))
            fila = cur.fetchone()
    finally:
        conn.close()

    if orden.publicada_id:
        try:
            _marcar_publicada_registrada(orden.publicada_id)
        except Exception as e:
            logger.warning(f"No se pudo marcar publicada {orden.publicada_id} como registrada: {e}")

    return _fila_orden_a_out(fila)


@app.get("/ordenes", response_model=List[OrdenOut])
def ordenes_listar(estado_precio: Optional[str] = None):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if estado_precio:
                cur.execute(
                    "SELECT * FROM ordenes WHERE estado_precio = %s ORDER BY creado_en DESC",
                    (estado_precio,),
                )
            else:
                cur.execute("SELECT * FROM ordenes ORDER BY creado_en DESC")
            filas = cur.fetchall()
    finally:
        conn.close()
    return [_fila_orden_a_out(f) for f in filas]


@app.get("/ordenes/pendientes-precio", response_model=List[OrdenOut])
def ordenes_pendientes_precio():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM ordenes WHERE estado_precio = 'pendiente' ORDER BY creado_en DESC"
            )
            filas = cur.fetchall()
    finally:
        conn.close()
    return [_fila_orden_a_out(f) for f in filas]


@app.get("/ordenes/{orden_id}", response_model=OrdenOut)
def ordenes_detalle(orden_id: int):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM ordenes WHERE id = %s", (orden_id,))
            fila = cur.fetchone()
    finally:
        conn.close()
    if not fila:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    return _fila_orden_a_out(fila)


@app.post("/ordenes/{orden_id}/completar-precio", response_model=OrdenOut)
def ordenes_completar_precio(orden_id: int, body: PrecioUpdate):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM ordenes WHERE id = %s", (orden_id,))
            fila = cur.fetchone()
            if not fila:
                raise HTTPException(status_code=404, detail="Orden no encontrada")

            cur.execute(
                """
                UPDATE ordenes
                SET precio = %s, estado_precio = 'completado',
                    completado_por = %s, completado_en = NOW()
                WHERE id = %s
                """,
                (body.precio, body.completado_por, orden_id),
            )
            cur.execute("SELECT * FROM ordenes WHERE id = %s", (orden_id,))
            fila = cur.fetchone()
    finally:
        conn.close()

    # Si el ERP ya tiene endpoint real conectado, propaga el precio también allá.
    if erp_session.autenticado:
        try:
            erp_session.completar_precio(str(orden_id), body.precio)
        except Exception as e:
            logger.warning(f"No se pudo propagar el precio al ERP (orden {orden_id}): {e}")

    emitir_alerta({
        "tipo": "precio_completado",
        "data": {"id": orden_id, "producto": fila["producto"], "precio": body.precio},
    })

    return _fila_orden_a_out(fila)


def _fila_orden_a_out(fila: dict) -> OrdenOut:
    fila = dict(fila)
    for campo in ("creado_en", "completado_en"):
        if isinstance(fila.get(campo), datetime):
            fila[campo] = fila[campo].isoformat()
    if fila.get("precio") is not None:
        fila["precio"] = float(fila["precio"])
    return OrdenOut(**fila)


# Se registra AL FINAL, después de TODAS las rutas específicas de main.py
# (como /erp/ventas/seguimientos-productos), para que ninguna ruta genérica
# tipo /erp/ventas/{orden_compra_id} dentro de ventas_router le robe el
# match a las rutas específicas que se declaran arriba en este archivo.
app.include_router(ventas_router)


# ============================================================
# Run local: uvicorn main:app --reload --host 0.0.0.0 --port 4001
# ============================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=4002, reload=True)

#HOLA