import bcrypt

password = b"Logi_wen2026"
hashed = bcrypt.hashpw(password, bcrypt.gensalt())
print(hashed.decode())