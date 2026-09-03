"""
ventas_router.py
-----------------
Router de FastAPI para Helbot que agrega:

  POST /erp/ventas                            -> crear una orden (venta) en el ERP real
  PUT  /erp/ventas/{orden_compra_id}           -> editar una orden ya creada
  GET  /erp/clientes/buscar?query=...          -> proxy de búsqueda de clientes
  GET  /erp/clientes/{cliente_id}/contactos    -> proxy de contactos de un cliente
  GET  /erp/catalogos-empresa?empresa_id=...   -> proxy de catálogos de una empresa
  POST /erp/agrupaciones-oc                    -> crear una agrupación de OCs
  GET  /erp/agrupaciones-oc/by-orden-compra/{orden_compra_id}

Todo pasa por `erp_session.session` (la MISMA sesión requests ya
autenticada contra el ERP que usa el resto de main.py — mismo patrón
que erp_proveedores()/erp_transportes()), así el frontend no maneja el
JWT del ERP: le pega a Helbot y Helbot reenvía con la sesión ya
logueada por el botón "Iniciar sesión" del ERP.

⚠️ ALTERNATIVA: en tus capturas de Network el frontend le pega DIRECTO
al ERP (Authorization: Bearer <jwt del ERP>, sin pasar por Helbot). Si
prefieres seguir así, este archivo es opcional — usa el erp-shared.ts
que te pasé tal cual y no necesitas nada de este router. Este router es
para si quieres centralizar todo (permisos, logs, alertas websocket) en
Helbot.

Los nombres de campos, payloads y endpoints (`/api/ventas`,
`/api/agrupaciones-oc`, `/api/agrupaciones-oc/by-orden-compra/{id}`)
son EXACTAMENTE los que capturaste en Network. Los de búsqueda de
clientes/contactos/catálogos (`/api/clientes`, `/api/catalogos-empresa`)
no salieron en tus capturas -> AJUSTA `ERP_CLIENTES_PATH` /
`ERP_CONTACTOS_PATH` / `ERP_CATALOGOS_PATH` de abajo a los reales.

============================================================
CÓMO INTEGRARLO EN main.py
============================================================
1) Copia este archivo junto a main.py (mismo folder que erp_login.py).
2) En main.py, junto a tus otros imports de routers:

       from ventas_router import router as ventas_router, configurar_alertas
       app.include_router(ventas_router)

   Y justo debajo de donde defines `emitir_alerta(...)` en main.py,
   agrega una sola línea:

       configurar_alertas(emitir_alerta)

   Eso le pasa la función `emitir_alerta` de main.py a este módulo sin
   crear un import circular (main.py importa este router; este router
   NO puede importar main.py de vuelta).
3) Listo — los endpoints quedan en http://<tu-helbot>:4001/erp/ventas, etc.
"""

from typing import Optional, Callable
import logging

from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form
from pydantic import BaseModel

from erp_login import erp_session, ERP_API_BASE
import op_seguimiento

logger = logging.getLogger("helbot.ventas_router")
router = APIRouter(prefix="/erp", tags=["ventas"])

# Se setea desde main.py vía configurar_alertas() para poder emitir por
# WebSocket sin crear un import circular con main.py.
_emitir_alerta: Optional[Callable[[dict], None]] = None


def configurar_alertas(fn: Callable[[dict], None]) -> None:
    global _emitir_alerta
    _emitir_alerta = fn


def _avisar(tipo: str, data: dict) -> None:
    if _emitir_alerta:
        try:
            _emitir_alerta({"tipo": tipo, "data": data})
        except Exception as e:
            logger.warning(f"No se pudo emitir alerta '{tipo}': {e}")


def _requiere_sesion_erp():
    if not erp_session.autenticado:
        raise HTTPException(status_code=401, detail="Sesión ERP no activa. Inicia sesión primero.")


# ============================================================
# Modelos — mismo shape que capturaste en Network
# ============================================================
class ConnectId(BaseModel):
    connect: dict  # {"id": <int>}


class ProductoVentaIn(BaseModel):
    codigo: str
    descripcion: str
    marca: str
    cantidad: int
    isCompleted: bool = False


class VentaCreateIn(BaseModel):
    empresa: dict  # {"connect": {"id": ...}}
    cliente: dict
    contactoCliente: dict
    catalogoEmpresa: dict
    codigoOcf: Optional[str] = None
    departamentoEntrega: Optional[str] = None
    direccionEntrega: Optional[str] = None
    distritoEntrega: Optional[str] = None
    provinciaEntrega: Optional[str] = None
    referenciaEntrega: Optional[str] = None
    documentoOce: Optional[str] = None
    documentoOcf: Optional[str] = None
    estadoVenta: str = "COMPLETADO"
    etapaSiaf: str
    fechaEntrega: str
    fechaForm: str
    fechaMaxForm: str
    fechaSiaf: str
    fuentesFinanciamiento: str
    montoVenta: float
    multipleFuentesFinanciamiento: bool = False
    numeroOcam: Optional[str] = None
    productos: list[ProductoVentaIn]
    siaf: Optional[str] = None
    ventaPrivada: Optional[bool] = None


class AgrupacionCreateIn(BaseModel):
    codigoGrupo: str
    descripcion: Optional[str] = None
    fecha: str  # ISO datetime
    ordenesCompraIds: list[int]


# ============================================================
# Ventas (Órdenes de Compra)
# ============================================================
@router.post("/ventas")
def crear_venta(body: VentaCreateIn):
    """Crea una orden nueva. Mismo payload/endpoint que POST /api/ventas
    en tus capturas de Network."""
    _requiere_sesion_erp()
    try:
        r = erp_session.session.post(
            f"{ERP_API_BASE}/ventas",
            json=body.dict(exclude_none=False),
            timeout=25,
        )
        r.raise_for_status()
    except Exception as e:
        logger.warning(f"Error creando venta en el ERP: {e}")
        raise HTTPException(status_code=502, detail=f"Error creando la orden en el ERP: {e}")

    venta = r.json()

    # Siembra las filas 'pendiente' de op_producto_seguimiento AQUÍ, en el
    # momento exacto en que logística crea la orden con sus productos —
    # así creado_en refleja la fecha real de creación de la orden, no la
    # fecha en que alguien de ventas rellena el formulario más tarde.
    try:
        op_seguimiento.asegurar_filas_productos_preview(
            orden_compra_id=venta.get("id"),
            numero_ocam=venta.get("numeroOcam"),
            codigo_venta=venta.get("codigoVenta"),
            productos=[p.dict() for p in body.productos],
        )
    except Exception as e:
        logger.warning(f"No se pudieron sembrar las filas de seguimiento para venta {venta.get('id')}: {e}")

    _avisar("venta_creada", {
        "id": venta.get("id"),
        "codigoVenta": venta.get("codigoVenta"),
        "cliente": (venta.get("cliente") or {}).get("razonSocial"),
        "montoVenta": venta.get("montoVenta"),
    })
    return venta


@router.put("/ventas/{orden_compra_id}")
def actualizar_venta(orden_compra_id: int, body: VentaCreateIn):
    """Edita una orden ya creada. Ajusta el método (PUT/PATCH) si tu ERP
    usa otro verbo para editar — no salió en tus capturas, solo el
    create (POST) y el detalle (GET)."""
    _requiere_sesion_erp()
    try:
        r = erp_session.session.put(
            f"{ERP_API_BASE}/ventas/{orden_compra_id}",
            json=body.dict(exclude_none=False),
            timeout=25,
        )
        r.raise_for_status()
    except Exception as e:
        logger.warning(f"Error actualizando venta {orden_compra_id} en el ERP: {e}")
        raise HTTPException(status_code=502, detail=f"Error actualizando la orden en el ERP: {e}")

    venta = r.json()

    # Mismo sembrado que en crear_venta — cubre el caso de que logística
    # agregue un producto NUEVO a una orden que ya existía. Los productos
    # que ya tenían fila no se tocan (ON DUPLICATE KEY solo actualiza
    # codigo_venta, nunca creado_en).
    try:
        op_seguimiento.asegurar_filas_productos_preview(
            orden_compra_id=venta.get("id"),
            numero_ocam=venta.get("numeroOcam"),
            codigo_venta=venta.get("codigoVenta"),
            productos=[p.dict() for p in body.productos],
        )
    except Exception as e:
        logger.warning(f"No se pudieron sembrar las filas de seguimiento para venta {venta.get('id')}: {e}")

    _avisar("venta_actualizada", {"id": venta.get("id"), "codigoVenta": venta.get("codigoVenta")})
    return venta


@router.get("/ventas/{orden_compra_id}")
def obtener_venta(orden_compra_id: int):
    _requiere_sesion_erp()
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/ventas/{orden_compra_id}", timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error consultando venta {orden_compra_id}: {e}")
        raise HTTPException(status_code=502, detail=f"Error consultando la orden en el ERP: {e}")


# ============================================================
# Búsquedas para el formulario (cliente / contacto / catálogo)
# ============================================================
# Rutas reales confirmadas (antes vivían en main.py, movidas acá para
# no duplicar/pisar registros de FastAPI). El path final que arma cada
# una (con el prefix="/erp" del router) es EXACTAMENTE el que ya llama
# erp-shared.ts: /erp/clientes, /erp/clientes/{id}/contactos,
# /erp/catalogos/empresa/{id}.

@router.get("/clientes")
def erp_clientes(search: str = Query("")):
    """Proxy hacia GET /api/clients del ERP + filtro client-side por
    razón social/RUC/sede/código unidad/dirección/ubicación."""
    _requiere_sesion_erp()
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/clients", timeout=20)
        r.raise_for_status()
        clientes = r.json()

        if not search.strip():
            return clientes

        texto = search.strip().lower()
        resultado = []
        for c in clientes:
            razon = str(c.get("razonSocial", "")).lower()
            ruc = str(c.get("ruc", "")).lower()
            sede = str(c.get("sede", "")).lower()
            codigo = str(c.get("codigoUnidad", "")).lower()
            direccion = str(c.get("direccion", "")).lower()
            departamento = str(c.get("departamento", "")).lower()
            provincia = str(c.get("provincia", "")).lower()
            distrito = str(c.get("distrito", "")).lower()
            if (
                texto in razon or texto in ruc or texto in sede or texto in codigo
                or texto in direccion or texto in departamento or texto in provincia or texto in distrito
            ):
                resultado.append(c)
        return resultado
    except Exception as e:
        logger.warning(f"Error obteniendo clientes del ERP: {e}")
        raise HTTPException(status_code=502, detail=f"Error obteniendo clientes del ERP: {e}")


@router.get("/clientes/{cliente_id}/contactos")
def contactos_de_cliente(cliente_id: int):
    """Proxy hacia GET /api/contacts/client/:id del ERP. Devuelve
    directamente el array 'data' (el frontend no necesita el meta)."""
    _requiere_sesion_erp()
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/contacts/client/{cliente_id}", timeout=20)
        r.raise_for_status()
        data = r.json()
        return data.get("data", [])
    except Exception as e:
        logger.warning(f"Error obteniendo contactos del cliente {cliente_id}: {e}")
        raise HTTPException(status_code=502, detail=f"Error obteniendo contactos del ERP: {e}")


@router.get("/catalogos/empresa/{empresa_id}")
def catalogos_de_empresa(empresa_id: int):
    """Proxy hacia GET /api/catalogs/company/:id del ERP."""
    _requiere_sesion_erp()
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/catalogs/company/{empresa_id}", timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error obteniendo catálogos del ERP: {e}")
        raise HTTPException(status_code=502, detail=f"Error obteniendo catálogos del ERP: {e}")



@router.get("/empresas")
def erp_empresas():
    """Proxy hacia GET /api/companies del ERP."""
    _requiere_sesion_erp()
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/companies", timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error obteniendo empresas del ERP: {e}")
        raise HTTPException(status_code=502, detail=f"Error obteniendo empresas del ERP: {e}")


class ContactoCreateIn(BaseModel):
    nombre: str
    cargo: Optional[str] = None
    telefono: Optional[str] = None
    email: Optional[str] = None
    cumpleanos: Optional[str] = None
    nota: Optional[str] = None


@router.post("/clientes/{cliente_id}/contactos")
def crear_contacto(cliente_id: int, body: ContactoCreateIn):
    """Proxy hacia POST /api/contacts del ERP — crea un contacto ligado
    al cliente, con el mismo payload que arma el frontend real del ERP."""
    _requiere_sesion_erp()
    payload = {
        "nombre": body.nombre,
        "cargo": body.cargo,
        "telefono": body.telefono,
        "email": body.email,
        "tipo": "CLIENTE",
        "referenciaId": cliente_id,
        "clienteId": cliente_id,
        "cumpleanos": body.cumpleanos,
        "nota": body.nota,
    }
    try:
        r = erp_session.session.post(f"{ERP_API_BASE}/contacts", json=payload, timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error creando contacto para cliente {cliente_id}: {e}")
        raise HTTPException(status_code=502, detail=f"Error creando contacto en el ERP: {e}")
    





@router.post("/documentos/subir")
async def subir_documento(archivo: UploadFile = File(...), tipo: str = Form(...)):
    """Sube el PDF (OCE u OCF) al ERP y devuelve su URL pública.
    CONFIRMADO en Network real: POST /api/files, multipart con
    'file' (binary) y 'folder' ('general-uploads'), responde {"url": "..."}."""
    _requiere_sesion_erp()
    contenido = await archivo.read()
    try:
        r = erp_session.session.post(
            f"{ERP_API_BASE}/files",
            files={"file": (archivo.filename, contenido, archivo.content_type)},
            data={"folder": "general-uploads"},
            timeout=30,
        )
        r.raise_for_status()
        data = r.json()
        url = data.get("url")
        if not url:
            raise HTTPException(status_code=502, detail="El ERP no devolvió una URL de archivo")
        return {"url": url, "tipo": tipo}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Error subiendo documento {tipo}: {e}")
        raise HTTPException(status_code=502, detail=f"Error subiendo el documento al ERP: {e}")
    

@router.get("/agrupaciones-oc")
def listar_agrupaciones():
    """Proxy hacia GET /api/agrupaciones-oc del ERP — lista todas las
    agrupaciones existentes, usado para poblar el selector de
    'Agrupación existente' en AgruparOrdenModal.tsx."""
    _requiere_sesion_erp()
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/agrupaciones-oc", timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error listando agrupaciones OC: {e}")
        raise HTTPException(status_code=502, detail=f"Error obteniendo agrupaciones del ERP: {e}")

# ============================================================
# Agrupaciones de OC ("Agrupar Orden de Compra")
# ============================================================
@router.post("/agrupaciones-oc")
def crear_agrupacion(body: AgrupacionCreateIn):
    """Mismo endpoint/payload que POST /api/agrupaciones-oc en tus
    capturas de Network (codigoGrupo, descripcion, fecha, ordenesCompraIds)."""
    _requiere_sesion_erp()
    try:
        r = erp_session.session.post(
            f"{ERP_API_BASE}/agrupaciones-oc",
            json=body.dict(),
            timeout=20,
        )
        r.raise_for_status()
    except Exception as e:
        logger.warning(f"Error creando agrupación de OC: {e}")
        raise HTTPException(status_code=502, detail=f"Error creando la agrupación en el ERP: {e}")

    agrupacion = r.json()
    _avisar("orden_agrupada", {
        "id": agrupacion.get("id"),
        "codigoGrupo": agrupacion.get("codigoGrupo"),
        "ordenesCompraIds": body.ordenesCompraIds,
    })
    return agrupacion



class AgregarOrdenIn(BaseModel):
    ordenCompraId: int


@router.put("/agrupaciones-oc/{agrupacion_id}/agregar-orden")
def agregar_orden_a_agrupacion(agrupacion_id: int, body: AgregarOrdenIn):
    """Agrega una orden a un grupo YA EXISTENTE. Confirmado en Network
    real del ERP: POST /api/agrupaciones-oc/{id}/ordenes-compra."""
    _requiere_sesion_erp()
    try:
        r = erp_session.session.post(
            f"{ERP_API_BASE}/agrupaciones-oc/{agrupacion_id}/ordenes-compra",
            json={"ordenCompraId": body.ordenCompraId},
            timeout=20,
        )
        r.raise_for_status()
    except Exception as e:
        logger.warning(f"Error agregando orden {body.ordenCompraId} a agrupación {agrupacion_id}: {e}")
        raise HTTPException(status_code=502, detail=f"Error agregando la orden a la agrupación en el ERP: {e}")

    resultado = r.json()
    _avisar("orden_agrupada", {
        "id": resultado.get("id", agrupacion_id),
        "codigoGrupo": resultado.get("codigoGrupo"),
        "ordenesCompraIds": [body.ordenCompraId],
    })
    return resultado


@router.get("/agrupaciones-oc/{agrupacion_id}")
def agrupacion_por_id(agrupacion_id: int):
    """Proxy hacia GET /api/agrupaciones-oc/:id del ERP — trae el
    detalle completo de un grupo (código, descripción y TODAS sus
    órdenes) directamente por su propio id, sin depender de conocer
    primero una orden de compra dentro de él."""
    _requiere_sesion_erp()
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/agrupaciones-oc/{agrupacion_id}", timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        logger.warning(f"Error consultando agrupación {agrupacion_id}: {e}")
        raise HTTPException(status_code=502, detail=f"Error consultando la agrupación en el ERP: {e}")

@router.get("/agrupaciones-oc/by-orden-compra/{orden_compra_id}")
def agrupacion_por_orden_compra(orden_compra_id: int):
    """Mismo endpoint que GET /api/agrupaciones-oc/by-orden-compra/{id}
    en tus capturas. Si la orden no está agrupada, el ERP normalmente
    responde 404 — acá lo convertimos en `None` para que el frontend no
    tenga que andar cazando el status code."""
    _requiere_sesion_erp()
    try:
        r = erp_session.session.get(
            f"{ERP_API_BASE}/agrupaciones-oc/by-orden-compra/{orden_compra_id}",
            timeout=20,
        )
        if r.status_code == 404:
            return None
        r.raise_for_status()
        return r.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"Error consultando agrupación de orden {orden_compra_id}: {e}")
        raise HTTPException(status_code=502, detail=f"Error consultando la agrupación en el ERP: {e}")