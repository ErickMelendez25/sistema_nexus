import bcrypt

password = b"Extrae_data2026"
hashed = bcrypt.hashpw(password, bcrypt.gensalt())
print(hashed.decode())