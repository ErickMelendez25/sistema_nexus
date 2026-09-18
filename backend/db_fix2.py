import pymysql

conexion = pymysql.connect(
    host="2.24.120.69",
    port=33061,
    user="root",
    password="NuevaPasswordRoot2026!",
    database="helbot_db",
)

alteraciones = [
    "ALTER TABLE op_producto_seguimiento MODIFY precio_producto DOUBLE",
    "ALTER TABLE op_producto_seguimiento MODIFY precio_flete DOUBLE",
    "ALTER TABLE op_producto_seguimiento MODIFY monto_referencia DOUBLE",
    "ALTER TABLE op_seguimiento MODIFY precio_producto DOUBLE",
    "ALTER TABLE op_seguimiento MODIFY precio_flete DOUBLE",
]

try:
    with conexion.cursor() as cursor:
        for sql in alteraciones:
            print("Ejecutando:", sql)
            cursor.execute(sql)
    conexion.commit()
    print("Listo. Columnas actualizadas a DOUBLE.")
finally:
    conexion.close()