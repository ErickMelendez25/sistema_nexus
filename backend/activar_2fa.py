import os
import sys

from dotenv import load_dotenv
load_dotenv()

import pyotp
import qrcode
from cryptography.fernet import Fernet
from db import get_conn

if len(sys.argv) != 2:
    sys.exit("Uso: python activar_2fa.py nombre_de_usuario")

username = sys.argv[1]
fernet = Fernet(os.environ["TOTP_KEY"].encode())
secreto = pyotp.random_base32()

conn = get_conn()
try:
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE usuarios_helbot
               SET totp_secret = %s, totp_ultimo_paso = NULL,
                   token_version = token_version + 1
               WHERE username = %s AND activo = 1""",
            (fernet.encrypt(secreto.encode()).decode(), username),
        )
        if cur.rowcount == 0:
            sys.exit("Usuario no encontrado o inactivo")
    conn.commit()
finally:
    conn.close()

uri = pyotp.TOTP(secreto).provisioning_uri(name=username, issuer_name="Nexus RPC")
qr = qrcode.QRCode(border=1)
qr.add_data(uri)
qr.make()

print()
print(f"Escanea este QR con la app autenticadora ({username}):")
print()
qr.print_ascii(invert=True)
print()
print("Cuando la persona lo haya escaneado, escribe 'clear' para borrar la pantalla.")