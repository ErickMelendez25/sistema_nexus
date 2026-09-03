"""
corregir_creado_en_historico.py
---------------------------------
Script de UNA sola corrida: corrige retroactivamente la columna
creado_en de op_producto_seguimiento para todas las órdenes que YA
existen, usando el createdAt REAL de cada venta en el ERP.

Requisitos antes de correrlo:
  1. El backend de Helbot (main.py) debe estar CORRIENDO (ya sea local
     o en tu VPS), porque este script reusa /erp/ventas/{id} para traer
     el createdAt real sin tener que loguear Selenium de nuevo.
  2. Debe haber sesión ERP activa en ese backend — si no la hay, entra
     al frontend y dale clic al botón "Iniciar sesión" del ERP antes de
     correr este script (o descomenta el bloque de auto-login más abajo).

Uso:
    python corregir_creado_en_historico.py
    python corregir_creado_en_historico.py --api-base http://localhost:4001
    python corregir_creado_en_historico.py --dry-run   # solo muestra qué haría, no actualiza nada
"""

import argparse
import time
from datetime import datetime

import requests

from db import get_conn

API_BASE_DEFAULT = "http://localhost:4001"


def parsear_fecha_erp(raw: str | None):
    """'2026-09-03T15:48:38.067Z' -> datetime, o None si no se puede."""
    if not raw:
        return None
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except Exception:
        return None


def obtener_ordenes_a_corregir() -> list[int]:
    """orden_compra_id distintos que ya tienen filas en
    op_producto_seguimiento — son los candidatos a corregir."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT orden_compra_id FROM op_producto_seguimiento ORDER BY orden_compra_id"
            )
            filas = cur.fetchall()
            return [f["orden_compra_id"] for f in filas]
    finally:
        conn.close()


def actualizar_creado_en(orden_compra_id: int, nueva_fecha: datetime, dry_run: bool) -> int:
    """Actualiza creado_en de TODAS las filas de esta orden. Devuelve
    cuántas filas se tocaron."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if dry_run:
                cur.execute(
                    "SELECT COUNT(*) AS total FROM op_producto_seguimiento WHERE orden_compra_id = %s",
                    (orden_compra_id,),
                )
                return cur.fetchone()["total"]
            cur.execute(
                "UPDATE op_producto_seguimiento SET creado_en = %s WHERE orden_compra_id = %s",
                (nueva_fecha, orden_compra_id),
            )
            return cur.rowcount
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Corrige creado_en histórico usando el createdAt real del ERP.")
    parser.add_argument("--api-base", default=API_BASE_DEFAULT, help="URL base del backend Helbot ya corriendo")
    parser.add_argument("--dry-run", action="store_true", help="Solo muestra qué haría, sin escribir en MySQL")
    parser.add_argument("--espera-seg", type=float, default=0.3, help="Pausa entre requests al ERP (para no saturarlo)")
    args = parser.parse_args()

    print(f"API base: {args.api_base}")
    print(f"Modo: {'DRY-RUN (no escribe nada)' if args.dry_run else 'REAL (va a escribir en MySQL)'}\n")

    ordenes = obtener_ordenes_a_corregir()
    print(f"Órdenes distintas a revisar: {len(ordenes)}\n")

    ok = 0
    sin_venta = 0
    sin_fecha = 0
    errores = 0
    filas_actualizadas_total = 0

    for i, orden_compra_id in enumerate(ordenes, start=1):
        try:
            r = requests.get(f"{args.api_base}/erp/ventas/{orden_compra_id}", timeout=20)
            if r.status_code == 401:
                print("❌ Sesión ERP no activa en el backend. Inicia sesión ERP en el frontend y vuelve a correr el script.")
                return
            if not r.ok:
                print(f"[{i}/{len(ordenes)}] orden {orden_compra_id}: HTTP {r.status_code}, se omite")
                sin_venta += 1
                continue

            venta = r.json()
            created_raw = venta.get("createdAt")
            fecha = parsear_fecha_erp(created_raw)

            if not fecha:
                print(f"[{i}/{len(ordenes)}] orden {orden_compra_id}: sin createdAt válido ({created_raw!r}), se omite")
                sin_fecha += 1
                continue

            filas = actualizar_creado_en(orden_compra_id, fecha, args.dry_run)
            filas_actualizadas_total += filas
            ok += 1
            print(f"[{i}/{len(ordenes)}] orden {orden_compra_id}: creado_en -> {fecha.isoformat()} ({filas} fila(s))")

        except Exception as e:
            errores += 1
            print(f"[{i}/{len(ordenes)}] orden {orden_compra_id}: ERROR — {e}")

        time.sleep(args.espera_seg)

    print("\n" + "=" * 60)
    print("RESUMEN")
    print("=" * 60)
    print(f"Órdenes corregidas correctamente : {ok}")
    print(f"Filas de seguimiento actualizadas : {filas_actualizadas_total}")
    print(f"Órdenes sin venta en el ERP        : {sin_venta}")
    print(f"Órdenes sin createdAt válido       : {sin_fecha}")
    print(f"Errores                            : {errores}")
    if args.dry_run:
        print("\n⚠️  Esto fue un DRY-RUN — nada se escribió en MySQL.")
        print("   Corre de nuevo sin --dry-run para aplicar los cambios de verdad.")


if __name__ == "__main__":
    main()