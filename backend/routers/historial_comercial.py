"""
Router de Historial Comercial — precios de referencia por proveedor y
fletes, usados por HistorialComercialCard.tsx en el frontend (Helbot).

Endpoints:
  GET /api/historial-comercial/proveedores
  GET /api/historial-comercial/fletes

Lógica de "nivel de coincidencia" (coincidencia):
  exacta       -> mismo producto+proveedor (o transporte) Y mismo cliente
                  Y misma ubicación exacta (departamento/provincia/distrito)
  aproximada   -> mismo producto+proveedor/transporte Y misma ubicación,
                  pero sin filtrar por cliente (o cliente no coincide)
  solo_entidad -> mismo producto+proveedor/transporte, sin filtrar ubicación
  sin_historial-> no hay ningún registro
"""

import logging
from typing import Optional

from fastapi import APIRouter, Query

from db import get_conn

logger = logging.getLogger("helbot.historial_comercial")

router = APIRouter(prefix="/api/historial-comercial", tags=["historial-comercial"])




# ============================================================
# Helpers comunes
# ============================================================
def _resumen_de(registros: list[dict]) -> dict:
    if not registros:
        return {
            "minimo": None,
            "promedio": None,
            "maximo": None,
            "ultimo": None,
            "operaciones": 0,
            "ultimaFecha": None,
            "cantidadTotal": None,
            "ultimaCantidad": None,
        }
    precios = [float(r["precio"]) for r in registros]
    cantidades = [r.get("cantidad") for r in registros if r.get("cantidad") is not None]
    # registros ya viene ordenado por fecha_operacion DESC
    return {
        "minimo": min(precios),
        "promedio": round(sum(precios) / len(precios), 4),
        "maximo": max(precios),
        "ultimo": precios[0],
        "operaciones": len(registros),
        "ultimaFecha": registros[0]["fecha"],
        "cantidadTotal": sum(cantidades) if cantidades else None,
        "ultimaCantidad": registros[0].get("cantidad"),
    }


def _por_cliente_de(pool_rows: list[dict]) -> list[dict]:
    """Agrupa por cliente_id: último precio + cantidad de operaciones,
    usando el pool más amplio (producto+proveedor / transporte), no solo
    el subset elegido — así el desglose por cliente siempre muestra
    contexto aunque la coincidencia principal sea 'solo_entidad'."""
    por_cliente: dict[int, dict] = {}
    for r in pool_rows:
        cid = r.get("cliente_id")
        if cid is None:
            continue
        if cid not in por_cliente:
            por_cliente[cid] = {
                "clienteId": cid,
                "clienteNombre": r.get("cliente_nombre") or f"Cliente #{cid}",
                "ultimoPrecio": float(r["precio"]),
                "ultimaCantidad": r.get("cantidad"),
                "ultimaFecha": r["fecha"],
                "codigoVenta": r.get("codigo_venta"),
                "codigoOp": r.get("codigo_op"),
                "operaciones": 0,
            }
        por_cliente[cid]["operaciones"] += 1
        # pool_rows viene ordenado DESC por fecha, así que el primero
        # que aparece por cliente ya es su más reciente.

    lista = list(por_cliente.values())
    lista.sort(key=lambda x: x["operaciones"], reverse=True)
    return lista





def _por_ubicacion_de(pool_rows: list[dict]) -> list[dict]:
    """Agrupa por combinación única de departamento/provincia/distrito:
    cantidad de operaciones, último precio y última fecha en esa zona.
    Usa el pool completo (no el subset filtrado) para que el ejecutivo
    vea TODAS las zonas donde hay historial de este producto/transporte,
    no solo la ubicación que está consultando ahora mismo."""
    por_ubi: dict[tuple, dict] = {}
    for r in pool_rows:
        depto = (r.get("departamento") or "").strip().upper()
        prov = (r.get("provincia") or "").strip().upper()
        dist = (r.get("distrito") or "").strip().upper()
        if not depto and not prov and not dist:
            continue  # sin ubicación registrada, no aporta al desglose
        key = (depto, prov, dist)
        if key not in por_ubi:
            por_ubi[key] = {
                "departamento": r.get("departamento"),
                "provincia": r.get("provincia"),
                "distrito": r.get("distrito"),
                "ultimoPrecio": float(r["precio"]),
                "ultimaCantidad": r.get("cantidad"),
                "ultimaFecha": r["fecha"],
                "codigoVenta": r.get("codigo_venta"),
                "codigoOp": r.get("codigo_op"),
                "operaciones": 0,
            }
        por_ubi[key]["operaciones"] += 1
        # pool_rows viene ordenado DESC por fecha, el primero por key
        # ya es el más reciente de esa ubicación.

    lista = list(por_ubi.values())
    lista.sort(key=lambda x: x["operaciones"], reverse=True)
    return lista




def _coincide_ubicacion(r, departamento, provincia, distrito):
    def norm(v):
        return (v or "").strip().upper()

    if departamento and norm(r.get("departamento")) != norm(departamento):
        return False
    if provincia and norm(r.get("provincia")) != norm(provincia):
        return False
    if distrito and norm(r.get("distrito")) != norm(distrito):
        return False
    return bool(departamento or provincia or distrito)


def _armar_respuesta(pool_rows: list[dict], clienteId, departamento, provincia, distrito) -> dict:
    subset_exacta = [
        r for r in pool_rows
        if _coincide_ubicacion(r, departamento, provincia, distrito)
        and (clienteId is None or r.get("cliente_id") == clienteId)
    ]
    subset_aprox = [r for r in pool_rows if _coincide_ubicacion(r, departamento, provincia, distrito)]

    if subset_exacta:
        seleccion, coincidencia = subset_exacta, "exacta"
    elif subset_aprox:
        seleccion, coincidencia = subset_aprox, "aproximada"
    elif pool_rows:
        seleccion, coincidencia = pool_rows, "solo_entidad"
    else:
        seleccion, coincidencia = [], "sin_historial"

    historial = [
        {
            "precio": r["precio"],
            "cantidad": r.get("cantidad"),
            "fecha": r["fecha"],
            "proveedorId": r.get("proveedor_id"),
            "proveedorNombre": r.get("proveedor_nombre"),
            "transporteId": r.get("transporte_id"),
            "transporteNombre": r.get("transporte_nombre"),
            "clienteNombre": r.get("cliente_nombre"),
            "ubicacion": ", ".join(filter(None, [r.get("distrito"), r.get("provincia"), r.get("departamento")])),
            "codigoVenta": r.get("codigo_venta"),
            "codigoOp": r.get("codigo_op"),
        }
        for r in seleccion[:10]
    ]
    return {
        "resumen": _resumen_de(seleccion),
        "coincidencia": coincidencia,
        "historial": historial,
        "porCliente": _por_cliente_de(pool_rows),
        "porUbicacion": _por_ubicacion_de(pool_rows),
    }


# ============================================================
# GET /api/historial-comercial/proveedores
# ============================================================
@router.get("/proveedores")
def historial_precios_proveedor(
    productoCodigo: str = Query(...),
    proveedorId: Optional[int] = Query(None),  # ya no filtra, se acepta por compatibilidad
    clienteId: Optional[int] = Query(None),
    departamento: Optional[str] = Query(None),
    provincia: Optional[str] = Query(None),
    distrito: Optional[str] = Query(None),
):
    conn = get_conn()
    try:
        sql = """
            SELECT
                h.proveedor_id     AS proveedor_id,
                pv.razon_social    AS proveedor_nombre,
                h.precio_unitario  AS precio,
                h.cantidad         AS cantidad,
                h.fecha_operacion  AS fecha,
                h.cliente_id       AS cliente_id,
                cl.razon_social    AS cliente_nombre,
                h.departamento     AS departamento,
                h.provincia        AS provincia,
                h.distrito         AS distrito,
                h.codigo_venta     AS codigo_venta,
                h.codigo_op        AS codigo_op
            FROM historial_precios_proveedor h
            LEFT JOIN clientes_cache cl ON cl.id = h.cliente_id
            LEFT JOIN proveedores_cache pv ON pv.id = h.proveedor_id
            WHERE h.producto_codigo = %s
            ORDER BY h.fecha_operacion DESC, h.fecha_registro DESC
        """
        with conn.cursor() as cur:
            cur.execute(sql, (productoCodigo,))
            pool_rows = cur.fetchall()

        for r in pool_rows:
            r["precio"] = float(r["precio"])
            r["cantidad"] = float(r["cantidad"]) if r.get("cantidad") is not None else None
            r["fecha"] = r["fecha"].isoformat() if r["fecha"] else None

        return _armar_respuesta(pool_rows, clienteId, departamento, provincia, distrito)
    except Exception:
        logger.exception("Error consultando historial de precios de proveedor")
        raise
    finally:
        conn.close()


# ============================================================
# GET /api/historial-comercial/fletes
# ============================================================
@router.get("/fletes")
def historial_precios_flete(
    transporteId: int = Query(...),
    clienteId: Optional[int] = Query(None),
    departamento: Optional[str] = Query(None),
    provincia: Optional[str] = Query(None),
    distrito: Optional[str] = Query(None),
):
    conn = get_conn()
    try:
        sql = """
            SELECT
                h.transporte_id    AS transporte_id,
                tr.razon_social    AS transporte_nombre,
                h.precio_flete     AS precio,
                h.cantidad_total   AS cantidad,
                h.fecha_operacion  AS fecha,
                h.cliente_id       AS cliente_id,
                cl.razon_social    AS cliente_nombre,
                h.departamento     AS departamento,
                h.provincia        AS provincia,
                h.distrito         AS distrito,
                h.codigo_venta     AS codigo_venta,
                h.codigo_op        AS codigo_op
            FROM historial_precios_flete h
            LEFT JOIN clientes_cache cl ON cl.id = h.cliente_id
            LEFT JOIN transportes_cache tr ON tr.id = h.transporte_id
            WHERE h.transporte_id = %s
            ORDER BY h.fecha_operacion DESC, h.fecha_registro DESC
        """
        
        with conn.cursor() as cur:
            cur.execute(sql, (transporteId,))
            pool_rows = cur.fetchall()

        for r in pool_rows:
            r["precio"] = float(r["precio"])
            r["cantidad"] = float(r["cantidad"]) if r.get("cantidad") is not None else None
            r["fecha"] = r["fecha"].isoformat() if r["fecha"] else None

        return _armar_respuesta(pool_rows, clienteId, departamento, provincia, distrito)
    except Exception:
        logger.exception("Error consultando historial de precios de flete")
        raise
    finally:
        conn.close()




# ============================================================
# GET /api/historial-comercial/fletes/por-destino
# Uso: el ejecutivo aún no sabe qué transportista usar, solo
# conoce el destino. Devuelve TODOS los transportistas que
# tienen historial hacia ese destino, con su resumen de precio,
# para que el usuario elija con quién comparar/negociar.
# ============================================================
@router.get("/fletes/por-destino")
def historial_fletes_por_destino(
    departamento: Optional[str] = Query(None),
    provincia: Optional[str] = Query(None),
    distrito: Optional[str] = Query(None),
):
    if not (departamento or provincia or distrito):
        return {"transportistas": []}

    conn = get_conn()
    try:
        sql = """
            SELECT
                h.transporte_id    AS transporte_id,
                tr.razon_social    AS transporte_nombre,
                h.precio_flete     AS precio,
                h.cantidad_total   AS cantidad,
                h.fecha_operacion  AS fecha,
                h.cliente_id       AS cliente_id,
                cl.razon_social    AS cliente_nombre,
                h.departamento     AS departamento,
                h.provincia        AS provincia,
                h.distrito         AS distrito,
                h.codigo_venta     AS codigo_venta,
                h.codigo_op        AS codigo_op
            FROM historial_precios_flete h
            LEFT JOIN clientes_cache cl ON cl.id = h.cliente_id
            LEFT JOIN transportes_cache tr ON tr.id = h.transporte_id
            WHERE 1=1
        """
        params = []
        if departamento:
            sql += " AND UPPER(h.departamento) = UPPER(%s)"
            params.append(departamento)
        if provincia:
            sql += " AND UPPER(h.provincia) = UPPER(%s)"
            params.append(provincia)
        if distrito:
            sql += " AND UPPER(h.distrito) = UPPER(%s)"
            params.append(distrito)
        sql += " ORDER BY h.fecha_operacion DESC, h.fecha_registro DESC"

        with conn.cursor() as cur:
            cur.execute(sql, tuple(params))
            filas = cur.fetchall()

        for r in filas:
            r["precio"] = float(r["precio"])
            r["cantidad"] = float(r["cantidad"]) if r.get("cantidad") is not None else None
            r["fecha"] = r["fecha"].isoformat() if r["fecha"] else None

        # Agrupar por transportista: resumen + últimas operaciones
        agrupado: dict[int, list[dict]] = {}
        for r in filas:
            tid = r.get("transporte_id")
            agrupado.setdefault(tid, []).append(r)

        transportistas = []
        for tid, regs in agrupado.items():
            transportistas.append({
                "transporteId": tid,
                "transporteNombre": regs[0].get("transporte_nombre"),
                "resumen": _resumen_de(regs),
                "historial": [
                    {
                        "precio": r["precio"],
                        "cantidad": r.get("cantidad"),
                        "fecha": r["fecha"],
                        "clienteNombre": r.get("cliente_nombre"),
                        "codigoVenta": r.get("codigo_venta"),
                        "codigoOp": r.get("codigo_op"),
                    }
                    for r in regs[:5]
                ],
            })

        transportistas.sort(key=lambda t: t["resumen"]["operaciones"], reverse=True)
        return {"transportistas": transportistas}
    except Exception:
        logger.exception("Error consultando historial de fletes por destino")
        raise
    finally:
        conn.close()