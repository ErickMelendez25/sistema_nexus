"""
Helbot - op_seguimiento.py
----------------------------
Proxy hacia el ERP externo (Railway) para Órdenes de Proveedor (OP), más
la capa propia de Helbot que registra el llenado de datos por parte de
un usuario externo (proveedor/logística) y el flujo de aprobación por
el personal de seguimiento antes de subir esos datos al ERP real.

Flujo de estados en la tabla op_seguimiento:
  pendiente -> (usuario externo llena el formulario) -> preview
  preview   -> (seguimiento revisa y confirma)        -> subido

IMPORTANTE - TODO CRÍTICO:
  subir_al_erp() todavía NO escribe en el ERP real (Railway). Falta
  capturar en DevTools el endpoint real que usa el ERP para guardar
  proveedor/precio/comodato/flete en una OP (buscar el POST/PUT que se
  dispara al guardar esos campos manualmente en /provider-orders).
  Mientras tanto, subir_al_erp() solo actualiza el estado local a
  'subido' — los datos NO llegan de verdad al ERP hasta conectar eso.
"""

import logging
from datetime import datetime
import requests

from erp_login import erp_session, ERP_API_BASE
from db import get_conn, guardar_json

import uuid

logger = logging.getLogger("helbot.op_seguimiento")


def _limpiar_decimal(valor):
    """Convierte '' o None a None (NULL en MySQL) para columnas DECIMAL.
    El frontend a veces manda margen/margen_orden como string vacío
    ('') cuando no aplica (ej. margen_orden en un envío individual, no
    en bloque) — MySQL no puede castear '' a DECIMAL y lanza
    'Incorrect decimal value' (error 1366)."""
    if valor is None:
        return None
    if isinstance(valor, str) and valor.strip() == "":
        return None
    return valor


# Campos "clave" para saber si un producto quedó completo. No bloqueamos
# el envío si faltan (ventas puede mandar parcial), solo lo mostramos
# como advertencia en cards/notificaciones. 'comodato' y 'observaciones'
# quedan fuera porque son legítimamente opcionales.
CAMPOS_CLAVE_SEGUIMIENTO = [
    ("proveedor_nombre", "Proveedor"),
    ("proveedor_telefono", "Teléfono proveedor"),
    ("precio_producto", "Precio producto"),
    ("agencia_transporte", "Agencia de transporte"),
    ("precio_flete", "Precio flete"),
]



def calcular_margen(precio_total: float | None, precio_flete: float | None, monto_referencia: float | None) -> float | None:
    """
    margen % = ((monto_referencia - (precio_total + precio_flete)) / monto_referencia) * 100
    precio_total ya viene como precio_unitario * cantidad (calculado en el frontend).
    monto_referencia = montoVenta de la orden (producto único) o importe OCR
    del producto / montoVenta de la orden (varios productos), según el caso.
    """
    if not monto_referencia:
        return None
    try:
        costo = float(precio_total or 0) + float(precio_flete or 0)
        return round(((float(monto_referencia) - costo) / float(monto_referencia)) * 100, 2)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    

def calcular_campos_faltantes(fila: dict | None) -> list[str]:
    if not fila:
        return [label for _, label in CAMPOS_CLAVE_SEGUIMIENTO]
    es_agencia = (fila.get("tipo_envio") or "").upper() == "AGENCIA"
    campos = CAMPOS_CLAVE_SEGUIMIENTO if es_agencia else [
        (c, l) for c, l in CAMPOS_CLAVE_SEGUIMIENTO if c not in ("agencia_transporte", "precio_flete")
    ]
    faltantes = []
    for clave, label in campos:
        valor = fila.get(clave)
        if valor is None or (isinstance(valor, str) and valor.strip() == ""):
            faltantes.append(label)
    return faltantes


def calcular_margen(precio_total: float | None, precio_flete: float | None, monto_referencia: float | None) -> float | None:
    """
    margen % = ((monto_referencia - (precio_total + precio_flete)) / monto_referencia) * 100

    - precio_total: YA es precio_unitario * cantidad (se calcula en el frontend antes de llamar aquí).
    - monto_referencia: montoVenta de la orden (caso 1 producto por orden) o el
      importe OCR del producto / montoVenta de la orden (caso varios productos).
    Nunca se manda al ERP — solo vive en MySQL, igual que 'comodato'.
    """
    if not monto_referencia:
        return None
    try:
        costo = float(precio_total or 0) + float(precio_flete or 0)
        return round(((float(monto_referencia) - costo) / float(monto_referencia)) * 100, 2)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


ERP_ORDENES_PROVEEDOR = f"{ERP_API_BASE}/ordenes-proveedores"


# ============================================================
# Proxy de lectura hacia el ERP real (usa la sesión ya autenticada)
# ============================================================
def listar_ops_de_orden(orden_compra_id: int) -> list[dict]:
    """GET /ordenes-proveedores/{orden_compra_id}/op del ERP real."""
    if not erp_session.autenticado:
        raise RuntimeError("Sesión ERP no activa")
    r = erp_session.session.get(f"{ERP_ORDENES_PROVEEDOR}/{orden_compra_id}/op", timeout=20)
    r.raise_for_status()
    return r.json()



def erp_detalle_op(op_id: int) -> dict:
    """GET /ordenes-proveedores/op/{op_id} del ERP real — detalle completo
    de UNA OP (incluye transportesAsignados y pagos)."""
    if not erp_session.autenticado:
        raise RuntimeError("Sesión ERP no activa")
    r = erp_session.session.get(f"{ERP_ORDENES_PROVEEDOR}/op/{op_id}", timeout=20)
    r.raise_for_status()
    return r.json()

def detalle_op(op_id: int):
    op = erp_detalle_op(op_id)

    productos = op.get("productos", [])

    seguimientos = obtener_seguimientos_productos(op_id)

    for p in productos:
        codigo = str(p.get("codigo") or p.get("id") or "").strip()
        seg = seguimientos.get(codigo)

        p["_seguimiento"] = {
            "estado": seg["estado"] if seg else "pendiente",
            "proveedor_nombre": seg["proveedor_nombre"] if seg else "",
            "proveedor_telefono": seg["proveedor_telefono"] if seg else "",
            "precio_producto": seg["precio_producto"] if seg else "",
            "comodato": seg["comodato"] if seg else "",
            "agencia_transporte": seg["agencia_transporte"] if seg else "",
            "precio_flete": seg["precio_flete"] if seg else "",
            "observaciones": seg["observaciones"] if seg else "",
            "rellenado_por": seg["rellenado_por"] if seg else "",
            "rellenado_en": seg["rellenado_en"] if seg else "",
            "confirmado_por": seg["confirmado_por"] if seg else "",
            "confirmado_en": seg["confirmado_en"] if seg else "",
            "subido_por": seg["subido_por"] if seg else "",
            "subido_en": seg["subido_en"] if seg else "",
        }

        p["_seguimiento"]["campos_faltantes"] = calcular_campos_faltantes(seg)

    op["productos"] = productos
    return op

# ============================================================
# Capa Helbot — estado de seguimiento en MySQL
# ============================================================
def obtener_seguimiento(op_id: int) -> dict | None:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM op_seguimiento WHERE op_id = %s", (op_id,))
            return cur.fetchone()
    finally:
        conn.close()


def obtener_seguimientos_masivo(op_ids: list[int]) -> dict[int, dict]:
    """Para pintar el estado de seguimiento de varias OPs de una vez
    (ej. al listar las OPs de una orden de compra)."""
    if not op_ids:
        return {}
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            formato = ",".join(["%s"] * len(op_ids))
            cur.execute(f"SELECT * FROM op_seguimiento WHERE op_id IN ({formato})", tuple(op_ids))
            filas = cur.fetchall()
            return {f["op_id"]: f for f in filas}
    finally:
        conn.close()


def asegurar_fila(op_id: int, orden_compra_id: int, numero_ocam: str | None = None):
    """Crea la fila en 'pendiente' si no existe todavía (idempotente)."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT IGNORE INTO op_seguimiento (op_id, orden_compra_id, numero_ocam, estado)
                VALUES (%s, %s, %s, 'pendiente')
                """,
                (op_id, orden_compra_id, numero_ocam),
            )
    finally:
        conn.close()


def rellenar_op(op_id: int, orden_compra_id: int, numero_ocam: str | None, datos: dict, rellenado_por: str) -> dict:
    """
    Usuario externo llena el formulario -> pasa a estado 'preview'.
    `datos` trae: proveedor_nombre, proveedor_telefono, precio_producto,
    comodato, agencia_transporte, precio_flete.
    """
    asegurar_fila(op_id, orden_compra_id, numero_ocam)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE op_seguimiento SET
                    estado = 'preview',
                    proveedor_nombre = %s,
                    proveedor_telefono = %s,
                    precio_producto = %s,
                    comodato = %s,
                    agencia_transporte = %s,
                    precio_flete = %s,
                    rellenado_por = %s,
                    rellenado_en = %s
                WHERE op_id = %s
                """,
                (
                    datos.get("proveedor_nombre"),
                    datos.get("proveedor_telefono"),
                    datos.get("precio_producto"),
                    datos.get("comodato"),
                    datos.get("agencia_transporte"),
                    datos.get("precio_flete"),
                    rellenado_por,
                    datetime.now(),
                    op_id,
                ),
            )
    finally:
        conn.close()
    return obtener_seguimiento(op_id)


def subir_al_erp(op_id: int, subido_por: str) -> dict:
    """
    Seguimiento confirma -> intenta escribir en el ERP real y, si sale
    bien, marca 'subido' localmente.

    TODO CRÍTICO: reemplazar el bloque de abajo por el POST/PUT real del
    ERP en cuanto lo captures en DevTools. Mientras tanto NO se escribe
    nada en el ERP real — solo se actualiza el estado local, para no
    bloquear el flujo de trabajo del equipo mientras se consigue el
    endpoint verdadero.
    """
    seguimiento = obtener_seguimiento(op_id)
    if not seguimiento:
        raise ValueError("No hay datos de seguimiento para esta OP")
    if seguimiento["estado"] != "preview":
        raise ValueError(f"La OP está en estado '{seguimiento['estado']}', se esperaba 'preview'")

    # ---- BLOQUE PENDIENTE DE CONECTAR AL ERP REAL ----
    # ejemplo de cómo se vería una vez tengamos el endpoint real:
    # r = erp_session.session.put(
    #     f"{ERP_ORDENES_PROVEEDOR}/op/{op_id}",
    #     json={
    #         "proveedorNombre": seguimiento["proveedor_nombre"],
    #         "precioUnitario": float(seguimiento["precio_producto"]),
    #         ...
    #     },
    #     timeout=20,
    # )
    # r.raise_for_status()
    logger.warning(
        f"subir_al_erp: TODO pendiente — falta el endpoint real de escritura del ERP. "
        f"OP {op_id} marcada como 'subido' SOLO localmente, sin escribir en Railway."
    )
    # ---------------------------------------------------

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE op_seguimiento SET estado = 'subido', subido_por = %s, subido_en = %s WHERE op_id = %s",
                (subido_por, datetime.now(), op_id),
            )
    finally:
        conn.close()
    return obtener_seguimiento(op_id)



# ============================================================
# Capa Helbot — seguimiento POR PRODUCTO (no por OP completa)
# ============================================================
def asegurar_filas_productos(op_id: int, orden_compra_id: int, numero_ocam: str | None, productos: list[dict]):
    """Crea una fila de seguimiento por cada producto de la OP, si no
    existe todavía (idempotente, gracias al UNIQUE KEY op_id+codigo).

    Si el ERP asignó un producto_codigo nuevo para este producto (p.ej.
    porque la OP se creó directo en el ERP con el código real de
    catálogo en vez del código secuencial que tenía en Helbot), busca
    por producto_descripcion una fila existente de esta orden y migra
    su producto_codigo en vez de crear una fila huérfana nueva — así no
    se pierde rellenado_por / confirmado_por / imágenes ya cargadas."""
    if not productos:
        return
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for p in productos:
                codigo = p.get("codigo") or p.get("id")
                if not codigo:
                    continue
                descripcion = p.get("descripcion")

                fila_migrable = None
                if descripcion:
                    cur.execute(
                        """
                        SELECT id FROM op_producto_seguimiento
                        WHERE orden_compra_id = %s
                          AND producto_descripcion = %s
                          AND producto_codigo != %s
                        LIMIT 1
                        """,
                        (orden_compra_id, descripcion, str(codigo)),
                    )
                    fila_migrable = cur.fetchone()

                if fila_migrable:
                    cur.execute(
                        """
                        UPDATE op_producto_seguimiento
                        SET producto_codigo = %s,
                            op_id = %s,
                            numero_ocam = %s,
                            producto_cantidad = %s
                        WHERE id = %s
                        """,
                        (str(codigo), op_id, numero_ocam, p.get("cantidad"), fila_migrable["id"]),
                    )
                    continue

                cur.execute(
                    """
                    INSERT IGNORE INTO op_producto_seguimiento
                        (op_id, orden_compra_id, numero_ocam, producto_codigo,
                         producto_descripcion, producto_cantidad, estado)
                    VALUES (%s, %s, %s, %s, %s, %s, 'pendiente')
                    """,
                    (
                        op_id,
                        orden_compra_id,
                        numero_ocam,
                        str(codigo),
                        descripcion,
                        p.get("cantidad"),
                    ),
                )
    finally:
        conn.close()


def asegurar_filas_productos_preview(
    orden_compra_id: int,
    numero_ocam: str | None,
    codigo_venta: str | None,
    productos: list[dict],
):
    """Crea (si no existe) una fila de seguimiento POR PRODUCTO para una
    orden de compra que TODAVÍA no tiene una OP real generada en el ERP
    (op_id = NULL). Se usa cuando el usuario hace clic en 'Generar orden
    de proveedor' y nOps == 0 — permite llenar el formulario de cada
    producto sin depender de que exista una OP real en Railway."""
    if not productos:
        return
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for p in productos:
                codigo = p.get("codigo")
                if not codigo:
                    continue
                cur.execute(
                    """
                    INSERT INTO op_producto_seguimiento
                        (op_id, orden_compra_id, numero_ocam, codigo_venta, producto_codigo,
                         producto_descripcion, producto_cantidad, estado)
                    VALUES (NULL, %s, %s, %s, %s, %s, %s, 'pendiente')
                    ON DUPLICATE KEY UPDATE codigo_venta = VALUES(codigo_venta)
                    """,
                    (
                        orden_compra_id,
                        numero_ocam,
                        codigo_venta,
                        str(codigo),
                        p.get("descripcion"),
                        p.get("cantidad"),
                    ),
                )
    finally:
        conn.close()


def guardar_montos_referencia(orden_compra_id: int, montos: list[dict]):
    """Guarda el 'Monto importe' de referencia POR PRODUCTO — lo llena
    Ventas en CrearOrdenModal cuando la orden tiene VARIOS productos
    (cada uno con su propio monto de referencia para calcular su margen
    individual, en vez de usar el montoVenta de TODA la orden). Nunca se
    manda al ERP — vive solo en MySQL, igual que 'comodato'. `montos` es
    una lista de dicts: {"codigo": str, "monto_referencia": float|None}."""
    if not montos:
        return
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for m in montos:
                codigo = m.get("codigo")
                if not codigo:
                    continue
                valor = _limpiar_decimal(m.get("monto_referencia"))
                cur.execute(
                    """
                    INSERT INTO op_producto_seguimiento
                        (op_id, orden_compra_id, producto_codigo, estado, monto_referencia)
                    VALUES (NULL, %s, %s, 'pendiente', %s)
                    ON DUPLICATE KEY UPDATE monto_referencia = VALUES(monto_referencia)
                    """,
                    (orden_compra_id, str(codigo), valor),
                )
    finally:
        conn.close()


def obtener_montos_referencia(orden_compra_id: int) -> list[dict]:
    """Lee los 'monto_referencia' guardados por producto para esta
    orden — contraparte de guardar_montos_referencia()."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT producto_codigo AS codigo, monto_referencia
                FROM op_producto_seguimiento
                WHERE orden_compra_id = %s AND monto_referencia IS NOT NULL
                """,
                (orden_compra_id,),
            )
            filas = cur.fetchall()
    finally:
        conn.close()
    return [
        {"codigo": f["codigo"], "monto_referencia": float(f["monto_referencia"]) if f["monto_referencia"] is not None else None}
        for f in filas
    ]


def obtener_seguimientos_de_orden(orden_compra_id: int) -> dict[str, dict]:
    """{producto_codigo: fila} de seguimiento para una orden de compra,
    sin importar si ya tiene op_id asignado o no (op_id puede ser NULL
    si la OP real todavía no existe en el ERP)."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM op_producto_seguimiento WHERE orden_compra_id = %s",
                (orden_compra_id,),
            )
            filas = cur.fetchall()
            for f in filas:
                f["campos_faltantes"] = calcular_campos_faltantes(f)
                _con_pdf_url(f)
            return filas
    finally:
        conn.close()



def obtener_todos_seguimientos_productos() -> list[dict]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT orden_compra_id, producto_codigo, estado,
                       rellenado_por, confirmado_por, subido_por,
                       proveedor_nombre, proveedor_telefono, precio_producto,
                       agencia_transporte, precio_flete
                FROM op_producto_seguimiento
                """
            )
            filas = cur.fetchall()
    finally:
        conn.close()

    for f in filas:
        f["campos_faltantes"] = calcular_campos_faltantes(f)
    return filas

def obtener_estadisticas_seguimiento() -> dict:
    """Reporte de auditoría para gerencia: quién de ventas envió qué
    producto de qué orden para revisión, y quién de seguimiento lo
    confirmó. Devuelve:
      - detalle: una fila por cada producto que ya tuvo algún movimiento
        (no está en 'pendiente'), con nombres y fechas.
      - resumen: conteo por usuario de cuántos envió y cuántos confirmó.
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT orden_compra_id, numero_ocam, codigo_venta, producto_codigo,
                       producto_descripcion, estado, creado_en,
                       rellenado_por, rellenado_en,
                       confirmado_por, confirmado_en,
                       subido_por, subido_en
                FROM op_producto_seguimiento
                WHERE estado != 'pendiente'
                ORDER BY COALESCE(confirmado_en, rellenado_en) DESC
                """
            )
            detalle = cur.fetchall()
    finally:
        conn.close()

    resumen_por_usuario: dict[str, dict] = {}
    for fila in detalle:
        if fila.get("rellenado_por"):
            u = resumen_por_usuario.setdefault(fila["rellenado_por"], {"enviados": 0, "confirmados": 0})
            u["enviados"] += 1
        if fila.get("confirmado_por"):
            u = resumen_por_usuario.setdefault(fila["confirmado_por"], {"enviados": 0, "confirmados": 0})
            u["confirmados"] += 1

    resumen = [
        {"usuario": u, "enviados": v["enviados"], "confirmados": v["confirmados"]}
        for u, v in sorted(resumen_por_usuario.items())
    ]

    return {"detalle": detalle, "resumen": resumen}


def rellenar_producto_de_orden(
    orden_compra_id: int,
    producto_codigo: str,
    datos: dict,
    rellenado_por: str,
    numero_ocam: str | None = None,
    codigo_venta: str | None = None,
    producto_descripcion: str | None = None,
) -> dict:

    conn = get_conn()
    try:
        with conn.cursor() as cur:

            # 1. intentar UPDATE primero
            cur.execute(
                """
                UPDATE op_producto_seguimiento SET
                    estado = 'preview',
                    numero_ocam = COALESCE(%s, numero_ocam),
                    codigo_venta = COALESCE(%s, codigo_venta),
                    producto_descripcion = COALESCE(%s, producto_descripcion),
                    proveedor_nombre = %s,
                    proveedor_id = %s,
                    proveedor_telefono = %s,
                    precio_producto = %s,
                    comodato = %s,
                    margen = %s,
                    margen_orden = %s,
                    agencia_transporte = %s,
                    transporte_id = %s,
                    precio_flete = %s,
                    observaciones = %s,
                    observaciones_transporte = %s,
                    otras_observaciones = %s,
                    observaciones_externas = %s,
                    tipo_envio = %s,
                    empresa_id = COALESCE(%s, empresa_id),
                    empresa_nombre = COALESCE(%s, empresa_nombre),
                    rellenado_por = %s,
                    rellenado_en = %s
                WHERE orden_compra_id = %s AND producto_codigo = %s
                """,
                (
                    numero_ocam,
                    codigo_venta,
                    producto_descripcion,
                    datos.get("proveedor_nombre"),
                    datos.get("proveedor_id"),
                    datos.get("proveedor_telefono"),
                    datos.get("precio_producto"),
                    datos.get("comodato"),
                    _limpiar_decimal(datos.get("margen")),
                    _limpiar_decimal(datos.get("margen_orden")),
                    datos.get("agencia_transporte"),
                    datos.get("transporte_id"),
                    datos.get("precio_flete"),
                    datos.get("observaciones"),
                    datos.get("observaciones_transporte"),
                    datos.get("otras_observaciones"),
                    datos.get("observaciones_externas"),
                    datos.get("tipo_envio"),
                    datos.get("empresa_id"),
                    datos.get("empresa_nombre"),
                    rellenado_por,
                    datetime.now(),
                    orden_compra_id,
                    producto_codigo,
                ),
            )

            # 2. si no existe, CREARLO
            if cur.rowcount == 0:
                cur.execute(
                    """
                    INSERT INTO op_producto_seguimiento (
                        op_id,
                        orden_compra_id,
                        numero_ocam,
                        codigo_venta,
                        producto_codigo,
                        producto_descripcion,
                        estado,
                        proveedor_nombre,
                        proveedor_id,
                        proveedor_telefono,
                        precio_producto,
                        comodato,
                        margen,
                        margen_orden,
                        agencia_transporte,
                        transporte_id,
                        precio_flete,
                        observaciones,
                        observaciones_transporte,
                        otras_observaciones,
                        observaciones_externas,
                        tipo_envio,
                        empresa_id,
                        empresa_nombre,
                        rellenado_por,
                        rellenado_en
                    ) VALUES (%s,%s,%s,%s,%s,%s,'preview',%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        None,
                        orden_compra_id,
                        numero_ocam,
                        codigo_venta,
                        producto_codigo,
                        producto_descripcion,
                        datos.get("proveedor_nombre"),
                        datos.get("proveedor_id"),
                        datos.get("proveedor_telefono"),
                        datos.get("precio_producto"),
                        datos.get("comodato"),
                        _limpiar_decimal(datos.get("margen")),
                        _limpiar_decimal(datos.get("margen_orden")),
                        datos.get("agencia_transporte"),
                        datos.get("transporte_id"),
                        datos.get("precio_flete"),
                        datos.get("observaciones"),
                        datos.get("observaciones_transporte"),
                        datos.get("otras_observaciones"),
                        datos.get("observaciones_externas"),
                        datos.get("tipo_envio"),
                        datos.get("empresa_id"),
                        datos.get("empresa_nombre"),
                        rellenado_por,
                        datetime.now(),
                    ),
                )
            conn.commit()

            cur.execute(
                """
                SELECT * FROM op_producto_seguimiento
                WHERE orden_compra_id = %s AND producto_codigo = %s
                """,
                (orden_compra_id, producto_codigo),
            )

            fila = cur.fetchone()
            fila["campos_faltantes"] = calcular_campos_faltantes(fila)

    finally:
        conn.close()

    try:
        generar_pdf_consolidado(orden_compra_id, producto_codigo)
    except Exception as e:
        logger.warning(f"rellenar_producto_de_orden: no se pudo generar el PDF consolidado: {e}")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM op_producto_seguimiento WHERE orden_compra_id = %s AND producto_codigo = %s",
                (orden_compra_id, producto_codigo),
            )
            fila = cur.fetchone()
            fila["campos_faltantes"] = calcular_campos_faltantes(fila)
            return _con_pdf_url(fila)
    finally:
        conn.close()

    try:
        generar_pdf_consolidado(orden_compra_id, producto_codigo)
    except Exception as e:
        logger.warning(f"rellenar_producto_de_orden: no se pudo generar el PDF consolidado: {e}")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM op_producto_seguimiento WHERE orden_compra_id = %s AND producto_codigo = %s",
                (orden_compra_id, producto_codigo),
            )
            fila = cur.fetchone()
            fila["campos_faltantes"] = calcular_campos_faltantes(fila)
            return _con_pdf_url(fila)
    finally:
        conn.close()


def _asignar_grupo_envio(orden_compra_id: int, producto_codigo: str, grupo_envio_id: str):
    """Marca un producto como parte de un envío en bloque."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE op_producto_seguimiento SET grupo_envio_id = %s WHERE orden_compra_id = %s AND producto_codigo = %s",
                (grupo_envio_id, orden_compra_id, producto_codigo),
            )
    finally:
        conn.close()


def rellenar_productos_en_bloque(
    orden_compra_id: int,
    productos: list[dict],
    datos_compartidos: dict,
    rellenado_por: str,
    numero_ocam: str | None = None,
    codigo_venta: str | None = None,
) -> list[dict]:
    """
    Llena varios productos de una vez con datos COMPARTIDOS (proveedor,
    teléfono, tipo de envío, agencia de transporte, observaciones) pero
    precio_producto, precio_flete Y margen INDEPENDIENTES por producto.

    `productos` es una lista de dicts:
        {"codigo": str, "precio_producto": float, "precio_flete": float,
         "descripcion": str, "margen": float | None}

    Genera 'observaciones_transporte' con el desglose de flete por
    producto (igual para todos los del grupo) y etiqueta a todos con el
    mismo grupo_envio_id, para que seguimiento los vea agrupados.
    """
    grupo_envio_id = uuid.uuid4().hex[:10]

    lineas = []
    for p in productos:
        flete = float(p.get("precio_flete") or 0)
        desc = p.get("descripcion") or p["codigo"]
        lineas.append(f"• {desc} ({p['codigo']}): flete S/ {flete:.2f}")
    total_flete_grupo = sum(float(p.get("precio_flete") or 0) for p in productos)
    lineas.append(f"— TOTAL FLETE DEL ENVÍO: S/ {total_flete_grupo:.2f}")
    desglose_automatico = "\n".join(lineas)

    nota_usuario = (datos_compartidos.get("observaciones_transporte") or "").strip()
    observaciones_transporte_generadas = (
        f"{nota_usuario}\n\n{desglose_automatico}" if nota_usuario else desglose_automatico
    )

    resultados = []
    for p in productos:
        datos = {
            **datos_compartidos,
            "precio_producto": p.get("precio_producto"),
            "precio_flete": p.get("precio_flete"),
            "comodato": p.get("comodato"),
            "observaciones_externas": p.get("observaciones_externas"),
            "observaciones_transporte": observaciones_transporte_generadas,
            "margen": p.get("margen"),
            "margen_orden": p.get("margen_orden") or datos_compartidos.get("margen_orden"),
        }
        fila = rellenar_producto_de_orden(
            orden_compra_id=orden_compra_id,
            producto_codigo=p["codigo"],
            datos=datos,
            rellenado_por=rellenado_por,
            numero_ocam=numero_ocam,
            codigo_venta=codigo_venta,
            producto_descripcion=p.get("descripcion"),
        )
        _asignar_grupo_envio(orden_compra_id, p["codigo"], grupo_envio_id)
        fila["grupo_envio_id"] = grupo_envio_id
        resultados.append(fila)

    # IMPORTANTE: recién AHORA que todos los productos del bloque ya
    # tienen grupo_envio_id asignado, se genera UN SOLO PDF fusionado
    # con las imágenes de TODOS ellos — esto reemplaza los PDFs
    # individuales que rellenar_producto_de_orden generó arriba, uno
    # por producto, cuando ese producto todavía no tenía grupo.
    try:
        generar_pdf_consolidado_grupo(grupo_envio_id)
    except Exception as e:
        logger.warning(f"rellenar_productos_en_bloque: no se pudo generar el PDF consolidado del grupo: {e}")

    return resultados

def confirmar_producto_de_orden(orden_compra_id: int, producto_codigo: str, confirmado_por: str) -> dict:
    """Seguimiento revisa el 'preview' y lo aprueba -> pasa a 'confirmado'.
    A partir de aquí el formulario queda de solo lectura para cualquier
    rol que no sea 'seguimiento'; solo seguimiento puede seguir editando
    estos datos (ver actualizar_producto_seguimiento)."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT estado FROM op_producto_seguimiento WHERE orden_compra_id = %s AND producto_codigo = %s",
                (orden_compra_id, producto_codigo),
            )
            fila = cur.fetchone()
            if not fila:
                raise ValueError(f"No hay datos de seguimiento para el producto '{producto_codigo}'")
            if fila["estado"] != "preview":
                raise ValueError(f"El producto está en estado '{fila['estado']}', se esperaba 'preview'")

            cur.execute(
                """
                UPDATE op_producto_seguimiento SET
                    estado = 'confirmado',
                    confirmado_por = %s,
                    confirmado_en = %s
                WHERE orden_compra_id = %s AND producto_codigo = %s
                """,
                (confirmado_por, datetime.now(), orden_compra_id, producto_codigo),
            )
            cur.execute(
                "SELECT * FROM op_producto_seguimiento WHERE orden_compra_id = %s AND producto_codigo = %s",
                (orden_compra_id, producto_codigo),
            )
            fila = cur.fetchone()
            fila["campos_faltantes"] = calcular_campos_faltantes(fila)
            return fila
    finally:
        conn.close()


def actualizar_producto_seguimiento(orden_compra_id: int, producto_codigo: str, datos: dict, producto_descripcion: str | None = None) -> dict:
    """Permite a seguimiento corregir los datos de un producto YA
    enviado (preview o confirmado) SIN tocar el estado — a diferencia
    de rellenar_producto_de_orden, que siempre fuerza el estado a
    'preview'. La validación de que quien llama sea rol 'seguimiento'
    se hace en el endpoint de main.py, no acá."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE op_producto_seguimiento SET
                    producto_descripcion = COALESCE(%s, producto_descripcion),
                    proveedor_nombre = %s,
                    proveedor_id = %s,
                    proveedor_telefono = %s,
                    precio_producto = %s,
                    comodato = %s,
                    margen = %s,
                    margen_orden = %s,
                    agencia_transporte = %s,
                    transporte_id = %s,
                    precio_flete = %s,
                    observaciones = %s,
                    observaciones_transporte = %s,
                    otras_observaciones = %s,
                    observaciones_externas = %s,
                    tipo_envio = %s,
                    empresa_id = %s,
                    empresa_nombre = %s
                WHERE orden_compra_id = %s AND producto_codigo = %s
                """,
                (
                    producto_descripcion,
                    datos.get("proveedor_nombre"),
                    datos.get("proveedor_id"),
                    datos.get("proveedor_telefono"),
                    datos.get("precio_producto"),
                    datos.get("comodato"),
                    _limpiar_decimal(datos.get("margen")),
                    _limpiar_decimal(datos.get("margen_orden")),
                    datos.get("agencia_transporte"),
                    datos.get("transporte_id"),
                    datos.get("precio_flete"),
                    datos.get("observaciones"),
                    datos.get("observaciones_transporte"),
                    datos.get("otras_observaciones"),
                    datos.get("observaciones_externas"),
                    datos.get("tipo_envio"),
                    datos.get("empresa_id"),
                    datos.get("empresa_nombre"),
                    orden_compra_id,
                    producto_codigo,
                ),
            )
            # OJO: cursor.rowcount de un UPDATE en MySQL cuenta filas
            # MODIFICADAS, no filas ENCONTRADAS. Si el producto ya tenía
            # guardados exactamente los mismos valores que se están
            # reenviando (ej. seguimiento le da "Confirmar" sin haber
            # tocado nada, con el formulario ya autocompletado), rowcount
            # da 0 aunque la fila SÍ existe. Por eso ya no usamos rowcount
            # para decidir si existe — hacemos el SELECT directo y
            # comprobamos si vino algo.
            cur.execute(
                "SELECT * FROM op_producto_seguimiento WHERE orden_compra_id = %s AND producto_codigo = %s",
                (orden_compra_id, producto_codigo),
            )
            fila = cur.fetchone()
            if not fila:
                raise ValueError(f"No hay datos de seguimiento para el producto '{producto_codigo}'")
            fila["campos_faltantes"] = calcular_campos_faltantes(fila)
            return fila
    finally:
        conn.close()


def obtener_seguimientos_productos(op_id: int) -> dict[str, dict]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM op_producto_seguimiento WHERE op_id = %s",
                (op_id,),
            )
            filas = cur.fetchall()

            return {
                str(f["producto_codigo"]).strip(): f
                for f in filas
            }
    finally:
        conn.close()

def rellenar_producto(op_id: int, producto_codigo: str, datos: dict, rellenado_por: str) -> dict:
    """Usuario externo llena el formulario de UN producto -> 'preview'."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE op_producto_seguimiento SET
                    estado = 'preview',
                    proveedor_nombre = %s,
                    proveedor_telefono = %s,
                    precio_producto = %s,
                    comodato = %s,
                    agencia_transporte = %s,
                    precio_flete = %s,
                    observaciones = %s,
                    rellenado_por = %s,
                    rellenado_en = %s
                WHERE op_id = %s AND producto_codigo = %s
                """,
                (
                    datos.get("proveedor_nombre"),
                    datos.get("proveedor_telefono"),
                    datos.get("precio_producto"),
                    datos.get("comodato"),
                    datos.get("agencia_transporte"),
                    datos.get("precio_flete"),
                    datos.get("observaciones"),
                    rellenado_por,
                    datetime.now(),
                    op_id,
                    producto_codigo,
                ),
            )
            if cur.rowcount == 0:
                raise ValueError(f"No existe seguimiento para el producto '{producto_codigo}' de la OP {op_id}")
            cur.execute(
                "SELECT * FROM op_producto_seguimiento WHERE op_id = %s AND producto_codigo = %s",
                (op_id, producto_codigo),
            )
            return cur.fetchone()
    finally:
        conn.close()


def subir_producto_al_erp(op_id: int, producto_codigo: str, subido_por: str) -> dict:
    """Seguimiento confirma UN producto -> 'subido' (localmente, mismo
    TODO pendiente que subir_al_erp: falta el endpoint real de Railway)."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM op_producto_seguimiento WHERE op_id = %s AND producto_codigo = %s",
                (op_id, producto_codigo),
            )
            fila = cur.fetchone()
            if not fila:
                raise ValueError(f"No hay datos de seguimiento para el producto '{producto_codigo}'")
            if fila["estado"] != "preview":
                raise ValueError(f"El producto está en estado '{fila['estado']}', se esperaba 'preview'")

            logger.warning(
                f"subir_producto_al_erp: TODO pendiente — OP {op_id} producto "
                f"'{producto_codigo}' marcado 'subido' SOLO localmente, sin escribir en Railway."
            )

            cur.execute(
                """
                UPDATE op_producto_seguimiento SET estado = 'subido', subido_por = %s, subido_en = %s
                WHERE op_id = %s AND producto_codigo = %s
                """,
                (subido_por, datetime.now(), op_id, producto_codigo),
            )
            cur.execute(
                "SELECT * FROM op_producto_seguimiento WHERE op_id = %s AND producto_codigo = %s",
                (op_id, producto_codigo),
            )
            return cur.fetchone()
    finally:
        conn.close()



# ============================================================
# Capa Helbot — imágenes adjuntas por producto (máx. 4, controlado
# desde el endpoint en main.py)
# ============================================================
def obtener_o_crear_seguimiento_id(
    orden_compra_id: int,
    producto_codigo: str,
    op_id: int | None = None,
    numero_ocam: str | None = None,
) -> int:
    """Devuelve el id de la fila de op_producto_seguimiento para este
    producto, creándola vacía en 'pendiente' si todavía no existe.
    Necesario porque las imágenes se pueden subir ANTES de llenar el
    resto del formulario."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM op_producto_seguimiento WHERE orden_compra_id = %s AND producto_codigo = %s",
                (orden_compra_id, producto_codigo),
            )
            fila = cur.fetchone()
            if fila:
                return fila["id"]
            cur.execute(
                """
                INSERT INTO op_producto_seguimiento
                    (op_id, orden_compra_id, numero_ocam, producto_codigo, estado)
                VALUES (%s, %s, %s, %s, 'pendiente')
                """,
                (op_id, orden_compra_id, numero_ocam, producto_codigo),
            )
            return cur.lastrowid
    finally:
        conn.close()


def contar_imagenes(seguimiento_id: int) -> int:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS total FROM op_producto_imagenes WHERE seguimiento_id = %s",
                (seguimiento_id,),
            )
            return cur.fetchone()["total"]
    finally:
        conn.close()


def guardar_imagen(seguimiento_id: int, ruta_archivo: str, nombre_original: str) -> dict:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO op_producto_imagenes (seguimiento_id, ruta_archivo, nombre_original) VALUES (%s, %s, %s)",
                (seguimiento_id, ruta_archivo, nombre_original),
            )
            nuevo_id = cur.lastrowid
            cur.execute("SELECT * FROM op_producto_imagenes WHERE id = %s", (nuevo_id,))
            return cur.fetchone()
    finally:
        conn.close()


def listar_imagenes_por_producto(orden_compra_id: int, producto_codigo: str) -> list[dict]:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM op_producto_seguimiento WHERE orden_compra_id = %s AND producto_codigo = %s",
                (orden_compra_id, producto_codigo),
            )
            fila = cur.fetchone()
            if not fila:
                return []
            cur.execute(
                "SELECT * FROM op_producto_imagenes WHERE seguimiento_id = %s ORDER BY subido_en ASC",
                (fila["id"],),
            )
            return cur.fetchall()
    finally:
        conn.close()


def eliminar_imagen(imagen_id: int) -> str | None:
    """Borra la fila de la imagen y devuelve la ruta del archivo físico
    para que main.py también lo borre del disco."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT ruta_archivo FROM op_producto_imagenes WHERE id = %s", (imagen_id,))
            fila = cur.fetchone()
            if not fila:
                return None
            cur.execute("DELETE FROM op_producto_imagenes WHERE id = %s", (imagen_id,))
            return fila["ruta_archivo"]
    finally:
        conn.close()





# ============================================================
# PDF consolidado — junta todas las fotos/documentos de un producto
# en un solo PDF, para que seguimiento vea todo junto al confirmar.
# ============================================================
import io as _io
import img2pdf as _img2pdf
from pypdf import PdfWriter as _PdfWriter, PdfReader as _PdfReader


def _construir_pdf_desde_imagenes(lista_imagenes: list[dict]) -> bytes | None:
    """Recibe filas de op_producto_imagenes (de UN producto o de VARIOS
    productos juntos) y las fusiona en un solo PDF en memoria. Devuelve
    None si ninguna imagen se pudo procesar. Es la misma lógica de
    conversión que antes vivía dentro de generar_pdf_consolidado, ahora
    reutilizable tanto para PDF individual como para PDF de bloque."""
    from almacenamiento import almacenamiento as _almacenamiento, STORAGE_BACKEND as _STORAGE_BACKEND
    import requests as _req

    writer = _PdfWriter()
    for img in lista_imagenes:
        nombre = (img.get("nombre_original") or img["ruta_archivo"]).lower()

        if _STORAGE_BACKEND == "local":
            ruta_local = _almacenamiento.upload_dir / img["ruta_archivo"]
            try:
                contenido = ruta_local.read_bytes()
            except Exception as e:
                logger.warning(f"_construir_pdf_desde_imagenes: no se pudo leer {ruta_local}: {e}")
                continue
        else:
            url = _almacenamiento.url_publica(img["ruta_archivo"])
            try:
                r = _req.get(url, timeout=30)
                r.raise_for_status()
                contenido = r.content
            except Exception as e:
                logger.warning(f"_construir_pdf_desde_imagenes: no se pudo descargar {url}: {e}")
                continue
        try:
            if nombre.endswith(".pdf"):
                reader = _PdfReader(_io.BytesIO(contenido))
                for pagina in reader.pages:
                    writer.add_page(pagina)
            elif nombre.endswith((".jpg", ".jpeg", ".png", ".webp", ".gif")):
                pdf_bytes = _img2pdf.convert(contenido)
                reader = _PdfReader(_io.BytesIO(pdf_bytes))
                for pagina in reader.pages:
                    writer.add_page(pagina)
            else:
                logger.warning(f"_construir_pdf_desde_imagenes: formato no soportado: {nombre}")
        except Exception as e:
            logger.warning(f"_construir_pdf_desde_imagenes: no se pudo procesar {nombre}: {e}")

    if len(writer.pages) == 0:
        return None
    buffer = _io.BytesIO()
    writer.write(buffer)
    buffer.seek(0)
    return buffer.getvalue()


def generar_pdf_consolidado(orden_compra_id: int, producto_codigo: str) -> dict | None:
    """Punto de entrada usado por subir/eliminar imágenes y por
    rellenar_producto_de_orden. Si el producto pertenece a un envío en
    bloque (grupo_envio_id NO es NULL), delega en
    generar_pdf_consolidado_grupo para que TODOS los productos del
    bloque compartan un solo PDF fusionado. Si es un envío individual,
    genera el PDF solo con las imágenes de este producto (igual que
    siempre)."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT grupo_envio_id FROM op_producto_seguimiento WHERE orden_compra_id = %s AND producto_codigo = %s",
                (orden_compra_id, producto_codigo),
            )
            fila = cur.fetchone()
            grupo_envio_id = fila.get("grupo_envio_id") if fila else None
    finally:
        conn.close()

    if grupo_envio_id:
        return generar_pdf_consolidado_grupo(grupo_envio_id)

    from almacenamiento import almacenamiento as _almacenamiento

    imagenes = listar_imagenes_por_producto(orden_compra_id, producto_codigo)
    if not imagenes:
        return None

    pdf_bytes = _construir_pdf_desde_imagenes(imagenes)
    if pdf_bytes is None:
        return None

    seguimiento_id = obtener_o_crear_seguimiento_id(orden_compra_id, producto_codigo)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT pdf_consolidado FROM op_producto_seguimiento WHERE orden_compra_id=%s AND producto_codigo=%s",
                (orden_compra_id, producto_codigo),
            )
            fila = cur.fetchone()
            pdf_anterior = fila.get("pdf_consolidado") if fila else None
    finally:
        conn.close()

    if pdf_anterior:
        try:
            _almacenamiento.eliminar(pdf_anterior)
        except Exception as e:
            logger.warning(f"No se pudo eliminar el PDF consolidado anterior: {e}")

    ruta_pdf = _almacenamiento.guardar(pdf_bytes, ".pdf", f"consolidado_{seguimiento_id}")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE op_producto_seguimiento SET pdf_consolidado=%s WHERE orden_compra_id=%s AND producto_codigo=%s",
                (ruta_pdf, orden_compra_id, producto_codigo),
            )
    finally:
        conn.close()

    return {"ruta_archivo": ruta_pdf, "url": _almacenamiento.url_publica(ruta_pdf)}


def generar_pdf_consolidado_grupo(grupo_envio_id: str) -> dict | None:
    """Junta las imágenes/documentos de TODOS los productos que
    comparten este grupo_envio_id (un envío en bloque) en un solo PDF,
    y guarda esa MISMA ruta en la columna pdf_consolidado de CADA
    producto del grupo — así todos muestran y suben al ERP el mismo
    archivo fusionado."""
    from almacenamiento import almacenamiento as _almacenamiento

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT orden_compra_id, producto_codigo, pdf_consolidado FROM op_producto_seguimiento WHERE grupo_envio_id = %s",
                (grupo_envio_id,),
            )
            filas_grupo = cur.fetchall()
    finally:
        conn.close()

    if not filas_grupo:
        return None

    imagenes_grupo = []
    for f in filas_grupo:
        imagenes_grupo.extend(
            listar_imagenes_por_producto(f["orden_compra_id"], f["producto_codigo"])
        )

    if not imagenes_grupo:
        return None

    pdf_bytes = _construir_pdf_desde_imagenes(imagenes_grupo)
    if pdf_bytes is None:
        return None

    pdf_anterior = filas_grupo[0].get("pdf_consolidado")
    if pdf_anterior:
        try:
            _almacenamiento.eliminar(pdf_anterior)
        except Exception as e:
            logger.warning(f"No se pudo eliminar el PDF consolidado de grupo anterior: {e}")

    ruta_pdf = _almacenamiento.guardar(pdf_bytes, ".pdf", f"consolidado_grupo_{grupo_envio_id}")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE op_producto_seguimiento SET pdf_consolidado=%s WHERE grupo_envio_id=%s",
                (ruta_pdf, grupo_envio_id),
            )
    finally:
        conn.close()

    return {"ruta_archivo": ruta_pdf, "url": _almacenamiento.url_publica(ruta_pdf)}

def _con_pdf_url(fila: dict) -> dict:
    """Agrega pdf_consolidado_url a una fila de seguimiento, si tiene PDF generado."""
    from almacenamiento import almacenamiento as _almacenamiento
    if fila and fila.get("pdf_consolidado"):
        fila["pdf_consolidado_url"] = _almacenamiento.url_publica(fila["pdf_consolidado"])
    else:
        fila["pdf_consolidado_url"] = None
    return fila






import requests as _requests
from db import get_conn as _get_conn


def _obtener_venta_erp(orden_compra_id: int) -> dict:
    """Trae la venta completa del ERP real (para sacar departamento de
    entrega y decidir ENTIDAD vs AGENCIA)."""
    r = erp_session.session.get(f"{ERP_API_BASE}/ventas/{orden_compra_id}", timeout=20)
    r.raise_for_status()
    return r.json()


def _obtener_contacto_proveedor(proveedor_id: int) -> dict | None:
    """GET /api/contacts/provider/{id} -> primer contacto (nombre, teléfono)."""
    logger.info(f"_obtener_contacto_proveedor: erp_session.autenticado={erp_session.autenticado}")
    r = erp_session.session.get(f"{ERP_API_BASE}/contacts/provider/{proveedor_id}", timeout=20)
    if not r.ok:
        logger.warning(f"GET /contacts/provider/{proveedor_id} falló ({r.status_code}): {r.text}")
    r.raise_for_status()
    data = r.json().get("data") or []
    return data[0] if data else None

import mimetypes as _mimetypes


def _subir_archivo_erp(contenido: bytes, nombre_archivo: str) -> str:
    """POST /api/files -> sube un archivo (cotización/imagen) y devuelve su URL pública."""
    content_type = _mimetypes.guess_type(nombre_archivo)[0] or "application/octet-stream"
    files = {"file": (nombre_archivo, contenido, content_type)}
    data = {"folder": "general-uploads"}
    r = erp_session.session.post(f"{ERP_API_BASE}/files", files=files, data=data, timeout=60)
    if not r.ok:
        logger.warning(f"POST /api/files falló ({r.status_code}): {r.text}")
    r.raise_for_status()
    return r.json()["url"]


def _buscar_op_existente(orden_compra_id: int, proveedor_id: int, empresa_id: int | None) -> dict | None:
    """Busca si ya existe una OP real en el ERP para esta orden, este
    proveedor Y esta empresa específicos. Antes solo se agrupaba por
    proveedor — eso mezclaba en la misma OP productos de un mismo
    proveedor pero de EMPRESAS distintas (ej. Multilimp vs Grupo
    Ecolimp), que deben quedar en OPs separadas."""
    ops = listar_ops_de_orden(orden_compra_id)
    for op in ops:
        if op.get("proveedorId") != proveedor_id:
            continue
        if op.get("empresaId") == empresa_id:
            return op
    return None


def _buscar_op_que_contiene_producto(orden_compra_id: int, producto_codigo: str) -> dict | None:
    """Busca la OP real donde este producto YA está guardado, sin
    importar el proveedor actual — es la fuente de verdad de dónde
    vive el producto, y evita crear una OP duplicada cuando la
    comparación por proveedor_id falla (ej. por tipos int/str)."""
    ops = listar_ops_de_orden(orden_compra_id)
    for op in ops:
        for p in (op.get("productos") or []):
            if str(p.get("codigo") or "").strip() == producto_codigo.strip():
                return op
    return None

def actualizar_datos_siaf(
    orden_compra_id: int,
    etapa_siaf: str,
    fecha_siaf: str,
    fuentes_financiamiento: str,
    multiple_fuentes_financiamiento: bool,
    monto_venta: float,
) -> dict:
    """
    Actualiza en el ERP real (PUT /api/ventas/{id}) los campos derivados
    de la consulta MEF: etapaSiaf, fechaSiaf, fuentesFinanciamiento,
    multipleFuentesFinanciamiento y montoVenta.

    El ERP exige el objeto COMPLETO en el PUT (con bloques {connect:{id}}
    para las relaciones) — no un PATCH parcial. Por eso se trae primero
    la venta tal cual está HOY en el ERP y se arma el payload completo,
    solo pisando los 5 campos que sí cambian.
    """
    venta = _obtener_venta_erp(orden_compra_id)

    def _solo_fecha(valor):
        """'2026-05-19T00:00:00.000Z' -> '2026-05-19'. Si ya viene como
        'YYYY-MM-DD' (caso de fecha_siaf, calculada en el frontend), la
        deja igual."""
        if not valor:
            return None
        return str(valor)[:10]

    payload = {
        "catalogoEmpresa": {"connect": {"id": venta.get("catalogoEmpresaId")}},
        "cliente": {"connect": {"id": venta.get("clienteId")}},
        "codigoOcf": venta.get("codigoOcf"),
        "contactoCliente": {"connect": {"id": venta.get("contactoClienteId")}},
        "departamentoEntrega": venta.get("departamentoEntrega"),
        "direccionEntrega": venta.get("direccionEntrega"),
        "distritoEntrega": venta.get("distritoEntrega"),
        "documentoOce": venta.get("documentoOce"),
        "documentoOcf": venta.get("documentoOcf"),
        "empresa": {"connect": {"id": venta.get("empresaId")}},
        "estadoVenta": venta.get("estadoVenta"),
        "etapaSiaf": etapa_siaf,
        "fechaEntrega": _solo_fecha(venta.get("fechaEntrega")),
        "fechaForm": _solo_fecha(venta.get("fechaForm")),
        "fechaMaxForm": _solo_fecha(venta.get("fechaMaxForm")),
        "fechaSiaf": _solo_fecha(fecha_siaf),
        "fuentesFinanciamiento": fuentes_financiamiento,
        "montoVenta": monto_venta,
        "multipleFuentesFinanciamiento": multiple_fuentes_financiamiento,
        "numeroOcam": venta.get("numeroOcam"),
        "productos": venta.get("productos"),
        "provinciaEntrega": venta.get("provinciaEntrega"),
        "referenciaEntrega": venta.get("referenciaEntrega"),
        "siaf": venta.get("siaf"),
    }

    r = erp_session.session.put(f"{ERP_API_BASE}/ventas/{orden_compra_id}", json=payload, timeout=30)
    if not r.ok:
        logger.warning(f"PUT /ventas/{orden_compra_id} (actualizar SIAF) falló ({r.status_code}): {r.text}")
    r.raise_for_status()
    return r.json()


def guardar_mef_actualizacion(
    orden_compra_id: int,
    siaf: str | None,
    expediente: str | None,
    etapa_siaf: str,
    fecha_siaf: str,
    fuentes_financiamiento: str,
    multiple_fuentes_financiamiento: bool,
    monto_venta: float,
    registros: list,
    completado_por: str | None,
) -> dict | None:
    """Guarda (o reemplaza) el snapshot de la última vez que alguien le
    dio 'Completar resultados en el ERP' para esta venta. Solo se
    guarda UNA fila por venta (uq_orden_mef) — siempre representa el
    último envío, no un historial completo."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO mef_actualizaciones
                    (orden_compra_id, siaf, expediente, etapa_siaf, fecha_siaf,
                     fuentes_financiamiento, multiple_fuentes_financiamiento,
                     monto_venta, registros_json, completado_por, completado_en)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    siaf = VALUES(siaf),
                    expediente = VALUES(expediente),
                    etapa_siaf = VALUES(etapa_siaf),
                    fecha_siaf = VALUES(fecha_siaf),
                    fuentes_financiamiento = VALUES(fuentes_financiamiento),
                    multiple_fuentes_financiamiento = VALUES(multiple_fuentes_financiamiento),
                    monto_venta = VALUES(monto_venta),
                    registros_json = VALUES(registros_json),
                    completado_por = VALUES(completado_por),
                    completado_en = VALUES(completado_en)
                """,
                (
                    orden_compra_id, siaf, expediente, etapa_siaf, fecha_siaf,
                    fuentes_financiamiento, multiple_fuentes_financiamiento,
                    monto_venta, guardar_json(registros), completado_por, datetime.now(),
                ),
            )
    finally:
        conn.close()
    return obtener_mef_actualizacion(orden_compra_id)


def obtener_mef_actualizacion(orden_compra_id: int) -> dict | None:
    """Devuelve el último snapshot guardado para esta venta, o None si
    nunca se le dio 'Completar resultados en el ERP'."""
    import json as _json
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM mef_actualizaciones WHERE orden_compra_id = %s", (orden_compra_id,))
            fila = cur.fetchone()
            if fila and fila.get("registros_json"):
                try:
                    fila["registros"] = _json.loads(fila["registros_json"])
                except Exception:
                    fila["registros"] = []
            return fila
    finally:
        conn.close()


def _limpiar_producto_para_create(p: dict) -> dict:
    """Los productos que YA existían en la OP vienen del ERP con campos
    como id, ordenProveedorId, createdAt, updatedAt, cantidadAlmacen —
    esos son propios de un registro ya guardado. Si se reenvían dentro
    de un bloque 'create' de Prisma, el ERP los rechaza con 400
    ('Unknown argument id') porque create es para filas NUEVAS, no para
    reenviar una fila existente con su id. Aquí nos quedamos solo con
    los campos que el create realmente necesita."""
    return {
        "codigo": p.get("codigo"),
        "descripcion": p.get("descripcion"),
        "unidadMedida": p.get("unidadMedida") or "UND",
        "cantidad": p.get("cantidad"),
        "cantidadTotal": p.get("cantidadTotal") if p.get("cantidadTotal") is not None else p.get("cantidad"),
        "cantidadCliente": p.get("cantidadCliente") if p.get("cantidadCliente") is not None else p.get("cantidad"),
        "precioUnitario": p.get("precioUnitario"),
        "total": p.get("total"),
    }


def _quitar_producto_de_op(op_id: int, op_data: dict, producto_codigo: str):
    """Reescribe una OP real quitándole SOLO 'producto_codigo', dejando
    el resto de productos intactos."""
    productos_restantes = [
        _limpiar_producto_para_create(p) for p in (op_data.get("productos") or []) if p.get("codigo") != producto_codigo
    ]
    total_restante = sum(
        float(p.get("precioUnitario") or 0) * float(p.get("cantidad") or 0) for p in productos_restantes
    )
    payload = {
        "ordenCompraId": op_data.get("ordenCompraId"),
        "empresaId": op_data.get("empresaId"),
        "proveedorId": op_data.get("proveedorId"),
        "contactoProveedorId": op_data.get("contactoProveedorId"),
        "fechaEntrega": None,
        "formaPago": op_data.get("formaPago") or "CONTADO",
        "notaAdicional": None,
        "notaPago": None,
        "notaPedido": op_data.get("notaPedido"),
        "observaciones": op_data.get("observaciones"),
        "pagos": {"deleteMany": {}, "create": []},
        "productos": {"deleteMany": {}, "create": productos_restantes},
        "tipoPago": op_data.get("tipoPago") or "PENDIENTE",
        "totalProveedor": total_restante,
        "transportesAsignados": {"update": [], "create": [], "deleteMany": {}},
        "estadoRolOp": "COMPLETADO",
        "embalaje": None,
        "etiquetado": None,
    }
    r = erp_session.session.put(f"{ERP_API_BASE}/ordenes-proveedores/op/{op_id}", json=payload, timeout=30)
    if not r.ok:
        logger.warning(f"PUT /ordenes-proveedores/op/{op_id} (quitar producto) falló ({r.status_code}): {r.text}")
    r.raise_for_status()


def _calcular_flete_total_grupo(orden_compra_id: int, producto_codigo: str, proveedor_id: int, empresa_id: int | None, transporte_id: int) -> float:
    """
    En el ERP el transporte se asigna UNA sola vez por OP, no por
    producto. Si este producto se envió en bloque junto con otros
    (grupo_envio_id) o simplemente comparte proveedor+empresa+agencia
    con otros productos ya confirmados, el monto de flete que se sube
    debe ser la SUMA de todos, no solo el de este producto.
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT grupo_envio_id FROM op_producto_seguimiento WHERE orden_compra_id = %s AND producto_codigo = %s",
                (orden_compra_id, producto_codigo),
            )
            fila = cur.fetchone()
            grupo_envio_id = fila.get("grupo_envio_id") if fila else None

            if grupo_envio_id:
                cur.execute(
                    """
                    SELECT COALESCE(SUM(precio_flete), 0) AS total
                    FROM op_producto_seguimiento
                    WHERE orden_compra_id = %s AND grupo_envio_id = %s
                    """,
                    (orden_compra_id, grupo_envio_id),
                )
            else:
                cur.execute(
                    """
                    SELECT COALESCE(SUM(precio_flete), 0) AS total
                    FROM op_producto_seguimiento
                    WHERE orden_compra_id = %s AND proveedor_id = %s
                      AND (empresa_id <=> %s) AND transporte_id = %s
                      AND estado IN ('confirmado', 'subido')
                    """,
                    (orden_compra_id, proveedor_id, empresa_id, transporte_id),
                )
            resultado = cur.fetchone()
            return float(resultado["total"]) if resultado else 0.0
    finally:
        conn.close()



def subir_producto_al_erp_real(orden_compra_id: int, producto_codigo: str, mantener_op_actual: bool = False) -> dict:
    """
    Orquesta TODO lo que hacías a mano en /provider-orders/create:
      1. Lee los datos confirmados en op_producto_seguimiento.
      2. Busca el contacto del proveedor (nombre/teléfono).
      3. Decide ENTIDAD (Lima) vs AGENCIA según el departamento de entrega.
      4. Sube las imágenes/fotos guardadas en Helbot al ERP real.
      5. Crea o actualiza la OP en el ERP real con PUT /ordenes-proveedores/op/{id}.

    IMPORTANTE: si la orden y el proveedor NO tienen todavía ninguna OP
    creada en el ERP real, esta función lanza RuntimeError — la creación
    desde cero de una OP nueva (primera vez con ese proveedor) aún no
    está conectada; hace falta capturar ese endpoint de creación.
    """
    conn = _get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM op_producto_seguimiento WHERE orden_compra_id = %s AND producto_codigo = %s",
                (orden_compra_id, producto_codigo),
            )
            seg = cur.fetchone()
    finally:
        conn.close()

    if not seg:
        raise ValueError(f"No hay datos de seguimiento para el producto '{producto_codigo}'")
    if not seg.get("proveedor_id"):
        raise ValueError("Falta seleccionar el proveedor (proveedor_id vacío) antes de subir al ERP")
    

    logger.warning(
        f"[DEBUG-AGENCIA] producto={producto_codigo} tipo_envio={seg.get('tipo_envio')!r} "
        f"transporte_id={seg.get('transporte_id')!r} agencia_transporte={seg.get('agencia_transporte')!r} "
        f"precio_flete={seg.get('precio_flete')!r}"
    )

    proveedor_id = int(seg["proveedor_id"])
    precio_producto = float(seg["precio_producto"]) if seg.get("precio_producto") else 0
    precio_flete = float(seg["precio_flete"]) if seg.get("precio_flete") else 0

    # Empresa asignada por Seguimiento a ESTE producto. Si todavía no la
    # cambió (recién llega del formulario de Ventas), cae a la empresa
    # de la orden principal — así "al principio todos jalan la empresa
    # con la que fue creada la orden" se cumple automáticamente.

    empresa_id = int(seg["empresa_id"]) if seg.get("empresa_id") else None

    # 1. Contacto del proveedor
    contacto = _obtener_contacto_proveedor(proveedor_id)
    contacto_proveedor_id = contacto["id"] if contacto else None

    # 2. Venta -> decidir ENTIDAD vs AGENCIA por departamento de entrega
    # 2. Decidir ENTIDAD vs AGENCIA: prioridad a lo que el usuario eligió
    # explícitamente en el formulario (tipo_envio); si no eligió nada,
    # se detecta automáticamente por el departamento de entrega.
    venta = _obtener_venta_erp(orden_compra_id)
    tipo_envio = (seg.get("tipo_envio") or "").upper()
    if tipo_envio == "ENTIDAD":
        es_lima = True
    elif tipo_envio == "AGENCIA":
        es_lima = False
    else:
        departamento_entrega = (venta.get("departamentoEntrega") or "").upper()
        es_lima = "LIMA" in departamento_entrega


# Cantidad y descripción reales desde la venta del ERP (más confiable
    # que lo guardado en Helbot, que puede no haberse poblado si el
    # producto nunca pasó por el flujo de "asegurar filas").
    cantidad_venta = None
    descripcion_venta = None
    for p_venta in (venta.get("productos") or []):
        if str(p_venta.get("codigo") or "").strip() == producto_codigo.strip():
            cantidad_venta = p_venta.get("cantidad")
            descripcion_venta = p_venta.get("descripcion")
            break
# 3. Buscar la OP destino.
    op_actual = _buscar_op_que_contiene_producto(orden_compra_id, producto_codigo)

    if mantener_op_actual and op_actual:
        # Ruta de "Actualizar en el ERP" (producto que YA vive en una OP
        # real, ej. después de que seguimiento lo confirmó una vez).
        # Aquí NUNCA se busca ni se crea otra OP, aunque el proveedor o
        # la empresa hayan cambiado en el formulario — se actualiza EN
        # SITIO la misma OP donde el producto ya está. Mover el producto
        # a otra OP (o crear una nueva) solo tiene sentido la PRIMERA
        # vez que se confirma, que es la rama de abajo.
        op_existente = op_actual
    else:
        # REGLA #1, siempre primero: ¿el proveedor elegido YA tiene una
        # OP abierta en esta orden? Si la tiene, el producto se fusiona
        # ahí sin importar dónde vivía antes — esto es lo que evita que
        # dos OPs terminen con el mismo proveedor (como pasó con
        # OPGRU985-1 y OPGRU985-4, ambas proveedor 50).
        op_destino_existente = _buscar_op_existente(orden_compra_id, proveedor_id, empresa_id)

        mismo_lugar = op_actual and str(op_actual.get("id")) == str((op_destino_existente or {}).get("id"))

        if op_destino_existente and not mismo_lugar:
            # Ya existe una OP para este proveedor -> ahí va el producto.
            # Si el producto vivía en OTRA OP (proveedor viejo), se saca
            # de esa primero para no duplicarlo.
            if op_actual and str(op_actual.get("id")) != str(op_destino_existente.get("id")):
                _quitar_producto_de_op(op_actual["id"], op_actual, producto_codigo)
            op_existente = op_destino_existente

        elif op_actual and (
                str(op_actual.get("proveedorId")) != str(proveedor_id)
                or str(op_actual.get("empresaId")) != str(empresa_id)
            ):
            # El proveedor nuevo NO tiene ninguna OP todavía, y el
            # producto ya vivía en la OP de OTRO proveedor.
            productos_en_op_actual = op_actual.get("productos") or []
            if len(productos_en_op_actual) == 1:
                # Esa OP es SOLO de este producto — se reusa y se le
                # cambia el proveedor, para no dejar una OP huérfana vacía.
                op_existente = op_actual
            else:
                # La OP tiene otros productos — se saca solo este y se
                # crea una OP nueva para el proveedor nuevo.
                _quitar_producto_de_op(op_actual["id"], op_actual, producto_codigo)
                op_existente = None
        else:
            # Caso normal: el producto no vivía en ninguna OP, o ya vivía
            # en la OP correcta (mismo proveedor).
            op_existente = op_actual

    es_op_nueva = op_existente is None

    # 4. Subir imágenes guardadas en Helbot al ERP real (como "cotización")
    url_cotizacion = None

    # Siempre regenerar el PDF consolidado antes de enviarlo al ERP
    generar_pdf_consolidado(orden_compra_id, producto_codigo)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT pdf_consolidado
                FROM op_producto_seguimiento
                WHERE orden_compra_id=%s
                AND producto_codigo=%s
                """,
                (orden_compra_id, producto_codigo),
            )

            fila_pdf = cur.fetchone()
    finally:
        conn.close()

    if fila_pdf and fila_pdf.get("pdf_consolidado"):

        from almacenamiento import almacenamiento as _almacenamiento, STORAGE_BACKEND as _STORAGE_BACKEND

        try:
            if _STORAGE_BACKEND == "local":
                ruta_local = _almacenamiento.upload_dir / fila_pdf["pdf_consolidado"]
                contenido = ruta_local.read_bytes()
            else:
                url_pdf = _almacenamiento.url_publica(fila_pdf["pdf_consolidado"])
                respuesta = requests.get(url_pdf, timeout=30)
                respuesta.raise_for_status()
                contenido = respuesta.content

            url_cotizacion = _subir_archivo_erp(
                contenido,
                "Cotizacion_Consolidada.pdf",
            )

        except Exception as e:

            logger.warning(
                f"No se pudo subir el PDF consolidado al ERP: {e}"
            )
    # 5. Armar el producto a agregar/actualizar en la OP
    # Armar el producto a agregar/actualizar en la OP
# Armar el producto a agregar/actualizar en la OP
    cantidad_producto = cantidad_venta or seg.get("producto_cantidad") or 0
    descripcion_producto = descripcion_venta or seg.get("producto_descripcion") or ""
    producto_erp = {
        "codigo": producto_codigo,
        "descripcion": descripcion_producto,
        "unidadMedida": "UND",
        "cantidad": cantidad_producto,
        "cantidadTotal": cantidad_producto,
        "cantidadCliente": cantidad_producto,
        "precioUnitario": precio_producto,
        "total": precio_producto * cantidad_producto,
    }

    # Mezcla el producto nuevo con los productos que YA tenía la OP
    # (sin duplicar el mismo código). Si la OP es nueva, no hay previos.
    # Mezcla el producto nuevo con los productos que YA tenía la OP
    # (sin duplicar el mismo código). Si la OP es nueva, no hay previos.
    # Los previos se limpian con _limpiar_producto_para_create porque
    # van dentro de un bloque 'create' de Prisma — no aceptan id/
    # ordenProveedorId/createdAt/updatedAt del registro ya existente.
    productos_previos = (op_existente.get("productos") or []) if op_existente else []
    productos_actuales = [
        _limpiar_producto_para_create(p) for p in productos_previos if p.get("codigo") != producto_codigo
    ]
    productos_actuales.append(producto_erp)
    total_proveedor = sum(float(p.get("precioUnitario") or 0) * float(p.get("cantidad") or 0) for p in productos_actuales)

    # Nota de pedido: si la OP ya existía, se respeta la que tenía; si es
    # nueva, se usa la observación del producto como nota de pedido inicial.
    nota_pedido = op_existente.get("notaPedido") if op_existente else (seg.get("observaciones") or "")

    # Transporte: si es Lima -> ENTIDAD (sin agencia); si no -> AGENCIA (con transporte_id)
    logger.warning(f"[DEBUG-AGENCIA] tipo_envio_leido={tipo_envio!r} es_lima={es_lima}")
    if not es_lima:
        if not seg.get("transporte_id"):
            logger.error(f"[DEBUG-AGENCIA] ⚠️ FALLA AQUÍ: transporte_id vacío, seg completo={seg}")
            raise ValueError("El departamento de entrega no es Lima — falta seleccionar la agencia de transporte")
        transporte_payload = {
            "transporteId": int(seg["transporte_id"]),
            "notaTransporte": seg.get("observaciones_transporte") or "",
            "montoFlete": _calcular_flete_total_grupo(
                orden_compra_id, producto_codigo, proveedor_id, empresa_id, int(seg["transporte_id"])
            ),
            "tipoDestino": "CLIENTE",
        }
        if url_cotizacion:
            transporte_payload["cotizacionTransporte"] = url_cotizacion

        if es_op_nueva:
            # Creación: el shape usa {create: [...]} sin update/deleteMany
            transportes_asignados = {"create": [transporte_payload]}
        else:
            asignados_previos = op_existente.get("transportesAsignados") or []
            if asignados_previos:
                transportes_asignados = {
                    "update": [{"where": {"id": asignados_previos[0]["id"]}, "data": transporte_payload}],
                    "create": [],
                    "deleteMany": {"id": {"notIn": [asignados_previos[0]["id"]]}},
                }
            else:
                # OP existente que TODAVÍA no tiene transporte (ej. venía de
                # ENTIDAD) -> mismo shape que una OP nueva: solo "create",
                # SIN "deleteMany" vacío (deleteMany:{} sin filtro borra
                # TODO, incluyendo el registro recién creado en el mismo
                # request — eso es lo que causaba que el transporte
                # desapareciera al pasar de ENTIDAD a AGENCIA).
                transportes_asignados = {"create": [transporte_payload]}    
    else:
        if es_op_nueva:
            transportes_asignados = {"create": []}
        else:
            asignados_previos = op_existente.get("transportesAsignados") or []
            if asignados_previos:
                transportes_asignados = {
                    "update": [],
                    "create": [],
                    "deleteMany": {"id": {"in": [a["id"] for a in asignados_previos]}},
                }
            else:
                transportes_asignados = {"update": [], "create": [], "deleteMany": {}}

    if es_op_nueva:
        # POST /ordenes-proveedores/{ordenCompraId}/op — crea la OP desde cero
        payload = {
            "ordenCompraId": orden_compra_id,
            "empresaId": empresa_id or venta.get("empresaId"),
            "proveedorId": proveedor_id,
            "contactoProveedorId": contacto_proveedor_id,
            "fechaEntrega": None,
            "formaPago": "CONTADO",
            "notaAdicional": None,
            "notaPago": None,
            "notaPedido": nota_pedido,
            "observaciones": seg.get("otras_observaciones") or None,
            "pagos": {"create": []},
            "productos": {"create": productos_actuales},
            "tipoPago": "PENDIENTE",
            "totalProveedor": total_proveedor,
            "transportesAsignados": transportes_asignados,
            "estadoRolOp": "COMPLETADO",
            "embalaje": None,
            "etiquetado": None,
        }
        r = erp_session.session.post(f"{ERP_API_BASE}/ordenes-proveedores/{orden_compra_id}/op", json=payload, timeout=30)
        if not r.ok:
            logger.warning(f"POST /ordenes-proveedores/{orden_compra_id}/op falló ({r.status_code}): {r.text}")
        r.raise_for_status()
        return r.json() 

    # PUT /ordenes-proveedores/op/{id} — actualiza la OP que ya existía
    # PUT /ordenes-proveedores/op/{id} — actualiza la OP que ya existía
    op_id = op_existente["id"]
    payload = {
        "ordenCompraId": orden_compra_id,
        "empresaId": empresa_id or op_existente.get("empresaId"),
        "proveedorId": proveedor_id,
        "contactoProveedorId": contacto_proveedor_id,
        "fechaEntrega": None,
        "formaPago": op_existente.get("formaPago") or "CONTADO",
        "notaAdicional": None,
        "notaPago": None,
        "notaPedido": nota_pedido,
        "observaciones": seg.get("otras_observaciones") or None,
        "pagos": {"deleteMany": {}, "create": []},
        "productos": {"deleteMany": {}, "create": productos_actuales},
        "tipoPago": op_existente.get("tipoPago") or "PENDIENTE",
        "totalProveedor": total_proveedor,
        "transportesAsignados": transportes_asignados,
        "estadoRolOp": "COMPLETADO",
        "embalaje": None,
        "etiquetado": None,
    }
    import json as _json
    logger.warning(f"[DEBUG-AGENCIA] PAYLOAD ENVIADO AL ERP:\n{_json.dumps(payload, indent=2, default=str)}")

    r = erp_session.session.put(f"{ERP_API_BASE}/ordenes-proveedores/op/{op_id}", json=payload, timeout=30)
    if not r.ok:
        logger.warning(f"PUT /ordenes-proveedores/op/{op_id} falló ({r.status_code}): {r.text}")
    r.raise_for_status()

    respuesta_json = r.json()
    logger.warning(f"[DEBUG-AGENCIA] RESPUESTA DEL ERP:\n{_json.dumps(respuesta_json, indent=2, default=str)}")
    return respuesta_json