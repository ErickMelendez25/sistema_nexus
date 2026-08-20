"""
migrar_historial_comercial.py

Migra el histórico de precios de proveedores y fletes desde la API de
Nexus RPC/Helbot hacia las tablas:
  - historial_precios_proveedor
  - historial_precios_flete

FLUJO REAL VERIFICADO (no asumido):
  1. GET /api/ventas?page=N&limit=100  -> solo para recolectar IDs de venta
     y saber meta.totalPages. Este endpoint NO trae proveedorId por producto,
     así que NO se usa para extraer precios.
  2. GET /api/ventas/{id}  -> detalle completo de la venta. Aquí SÍ vienen:
       - clienteId, departamentoEntrega, provinciaEntrega, distritoEntrega
       - ordenesProveedor[].proveedorId
       - ordenesProveedor[].productos[].codigo / precioUnitario / id
       - ordenesProveedor[].transportesAsignados[].transporteId / montoFlete
     Un solo GET por venta trae todo. No se llama a /api/ordenes-proveedores/*.

Uso (edita el bloque CONFIG de abajo con tus datos reales, y luego):
  python migrar_historial_comercial.py

No necesita variables de entorno — todo se configura directamente aquí
en el archivo. Primero corre con DRY_RUN = True (no inserta nada, solo
muestra el resumen), y cuando se vea bien cambia DRY_RUN = False.
"""

import sys
import time
import logging

import requests
import pymysql
from pymysql.cursors import DictCursor

import os
from dotenv import load_dotenv

# ============================================================
# CONFIG — edita estos valores con tus datos reales.
# ============================================================
API_BASE_URL = "https://manager-multilimpsac-production.up.railway.app"
API_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjUsImVtYWlsIjoibG9nMi5ycGNAZ3J1cG9lY29saW1wLmNvbSIsImlhdCI6MTc4NzE1MDU1MiwiZXhwIjoxNzg3MTkzNzUyfQ.ow17mwRqgpXwCepurXLjYbTtfweKRo066-9hvYY09YI"



load_dotenv()

MYSQL_HOST = os.environ["DB_HOST"]
MYSQL_PORT = int(os.environ["DB_PORT"])
MYSQL_USER = os.environ["DB_USER"]
MYSQL_PASSWORD = os.environ["DB_PASSWORD"]
MYSQL_DB = os.environ["DB_NAME"]
PAGE_SIZE = 100

# True = modo prueba, NO inserta nada, solo muestra resumen y ejemplos.
# False = inserta de verdad en las tablas.
DRY_RUN = False
# ============================================================

API_BASE_URL = API_BASE_URL.rstrip("/")

HEADERS = {"Authorization": f"Bearer {API_TOKEN}"}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("migrar_historial_comercial")


# ============================================================
# HTTP con reintentos + manejo de 429
# ============================================================
def get_con_reintentos(url, max_reintentos=5, timeout=20):
    espera = 1.5
    for intento in range(1, max_reintentos + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=timeout)
            if r.status_code == 429:
                retry_after = float(r.headers.get("Retry-After", espera))
                log.warning(f"429 recibido en {url} — esperando {retry_after}s (intento {intento})")
                time.sleep(retry_after)
                espera *= 2
                continue
            r.raise_for_status()
            return r.json()
        except requests.exceptions.RequestException as e:
            log.warning(f"Error en GET {url} (intento {intento}/{max_reintentos}): {e}")
            if intento == max_reintentos:
                log.error(f"Se agotaron los reintentos para {url}. Se omite.")
                return None
            time.sleep(espera)
            espera *= 2
    return None


# ============================================================
# Paso 1 — recolectar todos los IDs de venta, paginando
# ============================================================
def recolectar_ids_venta():
    ids = []
    page = 1
    total_pages = 1
    while page <= total_pages:
        url = f"{API_BASE_URL}/api/ventas?page={page}&limit={PAGE_SIZE}"
        data = get_con_reintentos(url)
        if data is None:
            log.error(f"No se pudo obtener la página {page}. Abortando recolección de IDs.")
            break
        items = data.get("items", [])
        meta = data.get("meta", {})
        total_pages = meta.get("totalPages", page)
        ids.extend(item["id"] for item in items)
        log.info(f"Página {page}/{total_pages} -> {len(items)} ventas (acumulado: {len(ids)})")
        page += 1
    return ids


# ============================================================
# Paso 2 — por cada venta, traer el detalle y extraer registros
# ============================================================
def extraer_registros_de_venta(venta):
    """
    Devuelve dos listas: registros_proveedor, registros_flete
    listos para insertar, a partir del detalle de UNA venta
    (GET /api/ventas/{id}).
    """
    registros_proveedor = []
    registros_flete = []

    venta_id = venta["id"]
    cliente_id = venta.get("clienteId")
    departamento = venta.get("departamentoEntrega")
    provincia = venta.get("provinciaEntrega")
    distrito = venta.get("distritoEntrega")
    fecha_operacion = (venta.get("fechaEmision") or venta.get("createdAt") or "")[:10]

    for op in venta.get("ordenesProveedor") or []:
        proveedor_id = op.get("proveedorId")
        orden_proveedor_id = op.get("id")

        # --- Precios de producto ---
        if proveedor_id:
            for prod in op.get("productos") or []:
                precio = prod.get("precioUnitario")
                if precio is None or precio == 0:
                    continue
                registros_proveedor.append({
                    "producto_codigo": prod.get("codigo"),
                    "producto_descripcion_snapshot": prod.get("descripcion"),
                    "unidad_medida": prod.get("unidadMedida"),
                    "proveedor_id": proveedor_id,
                    "cliente_id": cliente_id,
                    "venta_id": venta_id,
                    "orden_proveedor_id": orden_proveedor_id,
                    "op_producto_id": prod.get("id"),
                    "precio_unitario": precio,
                    "departamento": departamento,
                    "provincia": provincia,
                    "distrito": distrito,
                    "fecha_operacion": fecha_operacion,
                })
        else:
            log.warning(f"OP {orden_proveedor_id} de venta {venta_id} sin proveedorId — se omite precios de producto.")

        # --- Precios de flete (uno por transporteAsignado, NUNCA por producto) ---
        for ta in op.get("transportesAsignados") or []:
            monto = ta.get("montoFlete")
            transporte_id = ta.get("transporteId")
            if monto is None or not transporte_id:
                continue
            registros_flete.append({
                "transporte_id": transporte_id,
                "cliente_id": cliente_id,
                "venta_id": venta_id,
                "orden_proveedor_id": orden_proveedor_id,
                "transporte_asignado_id": ta.get("id"),
                "tipo_destino": ta.get("tipoDestino"),
                "precio_flete": monto,
                "precio_flete_pagado": ta.get("montoFletePagado"),
                # Regla 34: destino real del servicio = ubicación de la VENTA,
                # no la sede de la agencia. region/provincia/distrito del
                # transporteAsignado suelen venir null en tus datos reales.
                "departamento": departamento,
                "provincia": provincia,
                "distrito": distrito,
                "fecha_operacion": fecha_operacion,
            })

    return registros_proveedor, registros_flete


# ============================================================
# Paso 3 — inserción idempotente en MySQL
# ============================================================
SQL_INSERT_PROVEEDOR = """
INSERT INTO historial_precios_proveedor
  (producto_codigo, producto_descripcion_snapshot, unidad_medida,
   proveedor_id, cliente_id, venta_id, orden_proveedor_id, op_producto_id,
   precio_unitario, departamento, provincia, distrito,
   fecha_operacion, fuente)
VALUES
  (%(producto_codigo)s, %(producto_descripcion_snapshot)s, %(unidad_medida)s,
   %(proveedor_id)s, %(cliente_id)s, %(venta_id)s, %(orden_proveedor_id)s, %(op_producto_id)s,
   %(precio_unitario)s, %(departamento)s, %(provincia)s, %(distrito)s,
   %(fecha_operacion)s, 'MIGRACION_HISTORICA')
ON DUPLICATE KEY UPDATE
  precio_unitario = VALUES(precio_unitario),
  fecha_operacion = VALUES(fecha_operacion)
"""

SQL_INSERT_FLETE = """
INSERT INTO historial_precios_flete
  (transporte_id, cliente_id, venta_id, orden_proveedor_id, transporte_asignado_id,
   tipo_destino, precio_flete, precio_flete_pagado,
   departamento, provincia, distrito, fecha_operacion, fuente)
VALUES
  (%(transporte_id)s, %(cliente_id)s, %(venta_id)s, %(orden_proveedor_id)s, %(transporte_asignado_id)s,
   %(tipo_destino)s, %(precio_flete)s, %(precio_flete_pagado)s,
   %(departamento)s, %(provincia)s, %(distrito)s, %(fecha_operacion)s, 'MIGRACION_HISTORICA')
ON DUPLICATE KEY UPDATE
  precio_flete = VALUES(precio_flete),
  precio_flete_pagado = VALUES(precio_flete_pagado),
  fecha_operacion = VALUES(fecha_operacion)
"""


def conectar_mysql():
    return pymysql.connect(
        host=MYSQL_HOST, port=MYSQL_PORT, user=MYSQL_USER,
        password=MYSQL_PASSWORD, database=MYSQL_DB,
        cursorclass=DictCursor, autocommit=False,
    )


def main():
    log.info(f"Iniciando migración — DRY_RUN={DRY_RUN}")

    ids_venta = recolectar_ids_venta()
    log.info(f"Total de ventas a procesar: {len(ids_venta)}")

    total_proveedor = 0
    total_flete = 0
    total_ventas_ok = 0
    total_ventas_error = 0
    muestra_proveedor = []
    muestra_flete = []

    conn = None if DRY_RUN else conectar_mysql()

    try:
        for i, venta_id in enumerate(ids_venta, start=1):
            detalle = get_con_reintentos(f"{API_BASE_URL}/api/ventas/{venta_id}")
            if detalle is None:
                total_ventas_error += 1
                continue

            registros_proveedor, registros_flete = extraer_registros_de_venta(detalle)

            if DRY_RUN:
                if len(muestra_proveedor) < 5:
                    muestra_proveedor.extend(registros_proveedor[:5 - len(muestra_proveedor)])
                if len(muestra_flete) < 5:
                    muestra_flete.extend(registros_flete[:5 - len(muestra_flete)])
            else:
                with conn.cursor() as cur:
                    for r in registros_proveedor:
                        cur.execute(SQL_INSERT_PROVEEDOR, r)
                    for r in registros_flete:
                        cur.execute(SQL_INSERT_FLETE, r)
                conn.commit()

            total_proveedor += len(registros_proveedor)
            total_flete += len(registros_flete)
            total_ventas_ok += 1

            if i % 50 == 0:
                log.info(f"Progreso: {i}/{len(ids_venta)} ventas procesadas...")

    except Exception as e:
        log.exception(f"Error inesperado, se detiene la migración: {e}")
        if conn:
            conn.rollback()
    finally:
        if conn:
            conn.close()

    # --- Resumen final ---
    log.info("=" * 60)
    log.info("RESUMEN DE MIGRACIÓN")
    log.info(f"  Ventas procesadas OK : {total_ventas_ok}")
    log.info(f"  Ventas con error     : {total_ventas_error}")
    log.info(f"  Registros proveedor  : {total_proveedor}")
    log.info(f"  Registros flete      : {total_flete}")
    log.info("=" * 60)

    if DRY_RUN:
        log.info("Muestra de registros PROVEEDOR (no insertados, DRY_RUN):")
        for r in muestra_proveedor:
            log.info(f"  {r}")
        log.info("Muestra de registros FLETE (no insertados, DRY_RUN):")
        for r in muestra_flete:
            log.info(f"  {r}")
        log.info("Corre con DRY_RUN=false para insertar de verdad.")


if __name__ == "__main__":
    main()