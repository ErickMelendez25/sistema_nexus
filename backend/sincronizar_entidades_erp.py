"""
sincronizar_entidades_erp.py
------------------------------
Copia (solo LECTURA, solo GET) los nombres de clientes, proveedores y
transportes desde el ERP externo (Railway) hacia 3 tablas locales:
clientes_cache, proveedores_cache, transportes_cache.

Esto NO modifica absolutamente nada en el ERP. Solo lee la lista
(igual que hace el navegador al abrir el formulario) y la guarda
localmente para que el historial de precios pueda mostrar nombres
sin tener que llamar al ERP en cada request.

Se puede correr las veces que quieras — usa ON DUPLICATE KEY UPDATE,
así que no duplica nada, solo actualiza si el nombre cambió.

Uso:
    python sincronizar_entidades_erp.py
"""

import os
import requests
import pymysql
from dotenv import load_dotenv

load_dotenv()

# ============================================================
# Config — AJUSTA API_TOKEN con tu token real del ERP (el mismo
# que usa el frontend, lo puedes sacar del header Authorization
# en el Network tab, igual que hiciste con el otro script)
# ============================================================
API_BASE = "https://manager-multilimpsac-production.up.railway.app"
API_TOKEN = os.getenv("ERP_API_TOKEN", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjUsImVtYWlsIjoibG9nMi5ycGNAZ3J1cG9lY29saW1wLmNvbSIsImlhdCI6MTc4NzE1MDU1MiwiZXhwIjoxNzg3MTkzNzUyfQ.ow17mwRqgpXwCepurXLjYbTtfweKRo066-9hvYY09YI")




DB_CONFIG = dict(
    host=os.environ["DB_HOST"],
    port=int(os.environ["DB_PORT"]),
    user=os.environ["DB_USER"],
    password=os.environ["DB_PASSWORD"],
    database=os.environ["DB_NAME"],
    cursorclass=pymysql.cursors.DictCursor,
    autocommit=True,
)
# endpoint del ERP -> tabla local donde se guarda
FUENTES = [
    ("/api/clients", "clientes_cache"),
    ("/api/providers", "proveedores_cache"),
    ("/api/transports", "transportes_cache"),
]


def obtener_lista(endpoint: str) -> list[dict]:
    """Hace un GET simple al ERP. Solo lectura, no modifica nada."""
    resp = requests.get(
        f"{API_BASE}{endpoint}",
        headers={"Authorization": f"Bearer {API_TOKEN}"},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    # ajusta esto si tu API envuelve la lista en {"data": [...]}
    return data if isinstance(data, list) else data.get("data", [])


def sincronizar_tabla(cur, endpoint: str, tabla: str) -> int:
    registros = obtener_lista(endpoint)
    for r in registros:
        cur.execute(
            f"""
            INSERT INTO {tabla} (id, razon_social, ruc)
            VALUES (%s, %s, %s)
            ON DUPLICATE KEY UPDATE
                razon_social = VALUES(razon_social),
                ruc = VALUES(ruc)
            """,
            (r["id"], r.get("razonSocial", ""), r.get("ruc")),
        )
    return len(registros)


def main():
    print("Iniciando sincronización de nombres (solo lectura del ERP)...")
    conn = pymysql.connect(**DB_CONFIG)
    try:
        with conn.cursor() as cur:
            for endpoint, tabla in FUENTES:
                cantidad = sincronizar_tabla(cur, endpoint, tabla)
                print(f"  {tabla}: {cantidad} registros sincronizados")
    finally:
        conn.close()
    print("Listo. No se modificó nada en el ERP, solo se leyó.")


if __name__ == "__main__":
    main()