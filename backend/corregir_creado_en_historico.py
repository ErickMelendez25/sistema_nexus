"""
corregir_creado_en_historico.py (v2 — segura)
------------------------------------------------
Corrige creado_en usando el MÍNIMO entre:
  - venta.createdAt (del ERP)
  - rellenado_en / confirmado_en / subido_en (ya guardados en la fila)

Esto evita el bug detectado: el ERP a veces "resetea" su propio
createdAt cuando la venta se edita después de creada (PUT), lo que
puede dejar creado_en DESPUÉS de rellenado_en/confirmado_en — un
absurdo de auditoría. Tomando el mínimo, creado_en NUNCA queda después
de ninguna acción ya conocida sobre esa fila.

Uso:
    python corregir_creado_en_historico.py --api-base https://api.gruecolimp.com --dry-run
    python corregir_creado_en_historico.py --api-base https://api.gruecolimp.com
"""

import argparse
import time
from datetime import datetime

import requests

from db import get_conn

API_BASE_DEFAULT = "http://localhost:4001"


def parsear_fecha_erp(raw) -> datetime | None:
    """Acepta datetime ya parseado, string ISO del ERP, o None."""
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except Exception:
        return None


def obtener_filas_a_corregir() -> list[dict]:
    """Trae TODAS las filas (no solo orden_compra_id distintos) porque
    cada fila puede tener su propio rellenado_en/confirmado_en/subido_en
    y necesita su propio mínimo calculado individualmente."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT id, orden_compra_id, producto_codigo,
                       rellenado_en, confirmado_en, subido_en, creado_en
                FROM op_producto_seguimiento
                ORDER BY orden_compra_id
                """
            )
            return cur.fetchall()
    finally:
        conn.close()


def actualizar_creado_en_por_id(fila_id: int, nueva_fecha: datetime, dry_run: bool) -> bool:
    if dry_run:
        return True
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE op_producto_seguimiento SET creado_en = %s WHERE id = %s",
                (nueva_fecha, fila_id),
            )
            return cur.rowcount > 0
    finally:
        conn.close()


def main():
    parser = argparse.ArgumentParser(description="Corrige creado_en tomando el mínimo entre createdAt del ERP y las fechas ya registradas.")
    parser.add_argument("--api-base", default=API_BASE_DEFAULT)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--espera-seg", type=float, default=0.3)
    args = parser.parse_args()

    print(f"API base: {args.api_base}")
    print(f"Modo: {'DRY-RUN (no escribe nada)' if args.dry_run else 'REAL (va a escribir en MySQL)'}\n")

    filas = obtener_filas_a_corregir()
    print(f"Filas a revisar: {len(filas)}\n")

    # Caché de createdAt por orden_compra_id — para no pedir la misma
    # venta al ERP una vez por cada producto que tenga.
    cache_venta_created: dict[int, datetime | None] = {}

    corregidas = 0
    sin_cambio = 0
    sin_venta = 0
    errores = 0

    ordenes_vistas = set()

    for i, fila in enumerate(filas, start=1):
        orden_id = fila["orden_compra_id"]
        try:
            if orden_id not in cache_venta_created:
                if orden_id not in ordenes_vistas:
                    ordenes_vistas.add(orden_id)
                r = requests.get(f"{args.api_base}/erp/ventas/{orden_id}", timeout=20)
                if r.status_code == 401:
                    print("❌ Sesión ERP no activa. Inicia sesión ERP en el frontend y vuelve a correr.")
                    return
                if not r.ok:
                    cache_venta_created[orden_id] = None
                else:
                    venta = r.json()
                    cache_venta_created[orden_id] = parsear_fecha_erp(venta.get("createdAt"))
                time.sleep(args.espera_seg)

            created_erp = cache_venta_created[orden_id]

            candidatos = [
                d for d in [
                    created_erp,
                    parsear_fecha_erp(fila.get("rellenado_en")),
                    parsear_fecha_erp(fila.get("confirmado_en")),
                    parsear_fecha_erp(fila.get("subido_en")),
                ]
                if d is not None
            ]

            if not candidatos:
                sin_venta += 1
                print(f"[{i}/{len(filas)}] orden {orden_id} / {fila['producto_codigo']}: sin ninguna fecha válida, se omite")
                continue

            # Normaliza a naive (sin tz) para poder comparar contra
            # datetimes de MySQL, que vienen sin tzinfo.
            candidatos_naive = [d.replace(tzinfo=None) if d.tzinfo else d for d in candidatos]
            fecha_correcta = min(candidatos_naive)

            actual = fila.get("creado_en")
            if actual is not None and actual == fecha_correcta:
                sin_cambio += 1
                continue

            actualizar_creado_en_por_id(fila["id"], fecha_correcta, args.dry_run)
            corregidas += 1
            print(
                f"[{i}/{len(filas)}] orden {orden_id} / {fila['producto_codigo']}: "
                f"creado_en {actual} -> {fecha_correcta}"
            )

        except Exception as e:
            errores += 1
            print(f"[{i}/{len(filas)}] orden {orden_id} / {fila.get('producto_codigo')}: ERROR — {e}")

    print("\n" + "=" * 60)
    print("RESUMEN")
    print("=" * 60)
    print(f"Filas corregidas   : {corregidas}")
    print(f"Filas sin cambio   : {sin_cambio}")
    print(f"Filas sin fecha    : {sin_venta}")
    print(f"Errores            : {errores}")
    if args.dry_run:
        print("\n⚠️  DRY-RUN — nada se escribió. Corre sin --dry-run para aplicar.")


if __name__ == "__main__":
    main()