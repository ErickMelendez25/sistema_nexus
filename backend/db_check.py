import pymysql

conexion = pymysql.connect(
    host="2.24.120.69",
    port=33061,
    user="root",
    password="NuevaPasswordRoot2026!",
    database="helbot_db",
)

try:
    with conexion.cursor() as cursor:
        cursor.execute("""
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, NUMERIC_PRECISION, NUMERIC_SCALE, COLUMN_TYPE
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = %s
              AND COLUMN_NAME IN ('precio_producto', 'precio_flete', 'monto_referencia')
            ORDER BY TABLE_NAME, COLUMN_NAME
        """, ("helbot_db",))
        filas = cursor.fetchall()
        for fila in filas:
            print(fila)
finally:
    conexion.close()