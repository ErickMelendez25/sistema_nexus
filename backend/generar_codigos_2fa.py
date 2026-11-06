import csv
import hashlib
import secrets
import sys
from datetime import datetime, timedelta

from dotenv import load_dotenv
load_dotenv()

from db import get_conn

ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # sin 0/O ni 1/I para evitar confusiones
HORAS_VALIDEZ = 72


def nuevo_codigo() -> str:
    c = "".join(secrets.choice(ALFABETO) for _ in range(12))
    return f"{c[:4]}-{c[4:8]}-{c[8:]}"


def hash_codigo(codigo: str) -> str:
    limpio = codigo.replace("-", "").replace(" ", "").upper()
    return hashlib.sha256(limpio.encode()).hexdigest()


expira = datetime.utcnow() + timedelta(hours=HORAS_VALIDEZ)
resultados = []

conn = get_conn()
try:
    with conn.cursor() as cur:
        if len(sys.argv) > 1:
            # Reset de UN usuario (perdió el celular, etc.)
            cur.execute(
                "SELECT username FROM usuarios_helbot WHERE username = %s AND activo = 1",
                (sys.argv[1],),
            )
        else:
            # TODOS los activos que aún no tienen 2FA
            cur.execute(
                "SELECT username FROM usuarios_helbot WHERE activo = 1 AND totp_secret IS NULL"
            )
        usuarios = cur.fetchall()

        if not usuarios:
            sys.exit("No hay usuarios para procesar.")

        for u in usuarios:
            codigo = nuevo_codigo()
            cur.execute(
                """UPDATE usuarios_helbot
                   SET totp_secret = NULL, totp_ultimo_paso = NULL, totp_pendiente = NULL,
                       enrol_hash = %s, enrol_expira = %s, enrol_intentos = 0,
                       sesion_id = NULL, token_version = token_version + 1
                   WHERE username = %s""",
                (hash_codigo(codigo), expira, u["username"]),
            )
            resultados.append((u["username"], codigo))
    conn.commit()
finally:
    conn.close()

with open("codigos_2fa.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["usuario", "codigo_invitacion", "vence_utc"])
    for usuario, codigo in resultados:
        w.writerow([usuario, codigo, expira.strftime("%Y-%m-%d %H:%M")])

print()
for usuario, codigo in resultados:
    print(f"{usuario:35} {codigo}")
print(f"\n{len(resultados)} códigos generados. Vencen en {HORAS_VALIDEZ} horas.")
print("Guardados en codigos_2fa.csv: envía cada código a su dueño y BORRA ese archivo.")