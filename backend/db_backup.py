import pymysql
import json
from decimal import Decimal
from datetime import datetime, date

conexion = pymysql.connect(
    host="2.24.120.69",
    port=33061,
    user="root",
    password="NuevaPasswordRoot2026!",
    database="helbot_db",
    cursorclass=pymysql.cursors.DictCursor,
)

def convertir(o):
    if isinstance(o, (Decimal,)):
        return str(o)
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    raise TypeError(f"Tipo no serializable: {type(o)}")

tablas = ["op_producto_seguimiento", "op_seguimiento"]

try:
    with conexion.cursor() as cursor:
        respaldo = {}
        for tabla in tablas:
            cursor.execute(f"SELECT * FROM {tabla}")
            respaldo[tabla] = cursor.fetchall()
            print(f"{tabla}: {len(respaldo[tabla])} filas respaldadas")

    with open("backup_precios_antes_del_fix.json", "w", encoding="utf-8") as f:
        json.dump(respaldo, f, ensure_ascii=False, indent=2, default=convertir)

    print("Respaldo guardado en backup_precios_antes_del_fix.json")
finally:
    conexion.close()