import subprocess
import webbrowser
import threading
import time

IP = "192.168.1.63"
PUERTO = 3003
subprocess.Popen(
    f'npm run dev -- -H {IP} -p {PUERTO}',
    shell=True
)
time.sleep(8)

webbrowser.open(
    f"http://{IP}:{PUERTO}/CH0100000000127?source=Vrio"
)

print(f"Frontend iniciado en http://{IP}:{PUERTO}")

while True:
    time.sleep(1)