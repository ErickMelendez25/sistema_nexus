import msal
import requests
import os
from dotenv import load_dotenv

load_dotenv()

CLIENT_ID = os.getenv("AZURE_CLIENT_ID")
TENANT_ID = os.getenv("AZURE_TENANT_ID")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET")

AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPE = ["https://graph.microsoft.com/.default"]

app = msal.ConfidentialClientApplication(
    CLIENT_ID,
    authority=AUTHORITY,
    client_credential=CLIENT_SECRET
)

result = app.acquire_token_for_client(scopes=SCOPE)

if "access_token" in result:
    print("✅ Token obtenido correctamente")
    token = result["access_token"]

    # Prueba: listar usuarios del tenant (para confirmar que el token funciona)
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get("https://graph.microsoft.com/v1.0/users", headers=headers)
    print("Status:", resp.status_code)
    print(resp.json())
else:
    print("❌ Error obteniendo token:")
    print(result.get("error"))
    print(result.get("error_description"))