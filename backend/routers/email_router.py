"""
email_router.py
================
Módulo de correo para Nexus RPC — integración vía Microsoft Graph API.

Requiere en el .env del backend:
    AZURE_CLIENT_ID=...
    AZURE_TENANT_ID=...
    AZURE_CLIENT_SECRET=...

Instalar dependencia:
    pip install msal --break-system-packages

Registrar en tu app principal de FastAPI (main.py o donde tengas los include_router):
    from routers import email_router
    app.include_router(email_router.router, prefix="/api/email", tags=["Correo"])
"""

import os
import msal
import httpx
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, EmailStr
from typing import Optional

router = APIRouter()

# =====================================================
# CONFIG / AUTENTICACIÓN GRAPH
# =====================================================

CLIENT_ID = os.getenv("AZURE_CLIENT_ID")
TENANT_ID = os.getenv("AZURE_TENANT_ID")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET")

AUTHORITY = f"https://login.microsoftonline.com/{TENANT_ID}"
SCOPE = ["https://graph.microsoft.com/.default"]
GRAPH_BASE = "https://graph.microsoft.com/v1.0"

_msal_app = msal.ConfidentialClientApplication(
    CLIENT_ID,
    authority=AUTHORITY,
    client_credential=CLIENT_SECRET,
)

# Cache simple en memoria del token para no pedir uno nuevo en cada request.
# MSAL ya cachea internamente, pero igual guardamos la expiración por claridad.
_token_cache = {"access_token": None, "expira_en": None}


def obtener_token() -> str:
    """Obtiene (o reutiliza) el access token de aplicación para Graph."""
    ahora = datetime.utcnow()

    if _token_cache["access_token"] and _token_cache["expira_en"] and ahora < _token_cache["expira_en"]:
        return _token_cache["access_token"]

    resultado = _msal_app.acquire_token_for_client(scopes=SCOPE)

    if "access_token" not in resultado:
        raise HTTPException(
            status_code=500,
            detail=f"Error obteniendo token de Azure: {resultado.get('error_description', 'desconocido')}"
        )

    _token_cache["access_token"] = resultado["access_token"]
    # expires_in viene en segundos, restamos margen de 5 min por seguridad
    expira_seg = resultado.get("expires_in", 3600)
    _token_cache["expira_en"] = ahora + timedelta(seconds=expira_seg - 300)

    return resultado["access_token"]


async def graph_request(method: str, path: str, **kwargs) -> dict:
    """Wrapper para llamar a Microsoft Graph con el token ya resuelto."""
    token = obtener_token()
    headers = kwargs.pop("headers", {})
    headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.request(method, f"{GRAPH_BASE}{path}", headers=headers, **kwargs)

    if resp.status_code >= 400:
        raise HTTPException(status_code=resp.status_code, detail=resp.text)

    if resp.status_code == 204:
        return {}

    return resp.json()


# =====================================================
# MODELOS
# =====================================================

class EnviarCorreoBody(BaseModel):
    cuenta: EmailStr           # el buzón desde el que se envía (ej: ventas@multilimpsac.com)
    destinatarios: list[EmailStr]
    asunto: str
    cuerpo: str


# =====================================================
# HELPERS DE MAPEO (Graph -> formato que espera el frontend)
# =====================================================

def mapear_mensaje(msg: dict, carpeta: str) -> dict:
    remitente = msg.get("from", {}).get("emailAddress", {})
    return {
        "id": msg.get("id"),
        "remitente": remitente.get("name") or remitente.get("address", "Desconocido"),
        "remitenteEmail": remitente.get("address", ""),
        "asunto": msg.get("subject") or "(sin asunto)",
        "preview": msg.get("bodyPreview", ""),
        "cuerpo": msg.get("body", {}).get("content", msg.get("bodyPreview", "")),
        "fecha": msg.get("receivedDateTime") or msg.get("sentDateTime"),
        "leido": msg.get("isRead", False),
        "tieneAdjuntos": msg.get("hasAttachments", False),
        "carpeta": carpeta,
    }


CARPETA_A_GRAPH = {
    "entrada": "inbox",
    "enviados": "sentitems",
    "borradores": "drafts",
}


# =====================================================
# ENDPOINTS
# =====================================================

@router.get("/kpis")
async def obtener_kpis(cuenta: str = Query(...)):
    """
    KPIs de la bandeja: recibidos hoy, sin leer, enviados hoy,
    y variación % de recibidos vs el mismo momento de ayer.
    """
    hoy_inicio = datetime.utcnow().strftime("%Y-%m-%dT00:00:00Z")
    ayer_inicio = (datetime.utcnow() - timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")
    ayer_fin = hoy_inicio

    # Recibidos hoy
    filtro_hoy = f"receivedDateTime ge {hoy_inicio}"
    recibidos_hoy = await graph_request(
        "GET",
        f"/users/{cuenta}/mailFolders/inbox/messages"
        f"?$filter={filtro_hoy}&$count=true&$top=1&$select=id",
        headers={"ConsistencyLevel": "eventual"},
    )

    # Recibidos ayer (mismo rango, para variación)
    filtro_ayer = f"receivedDateTime ge {ayer_inicio} and receivedDateTime lt {ayer_fin}"
    recibidos_ayer = await graph_request(
        "GET",
        f"/users/{cuenta}/mailFolders/inbox/messages"
        f"?$filter={filtro_ayer}&$count=true&$top=1&$select=id",
        headers={"ConsistencyLevel": "eventual"},
    )

    # Sin leer (bandeja de entrada)
    sin_leer = await graph_request(
        "GET",
        f"/users/{cuenta}/mailFolders/inbox/messages"
        f"?$filter=isRead eq false&$count=true&$top=1&$select=id",
        headers={"ConsistencyLevel": "eventual"},
    )

    # Enviados hoy
    enviados_hoy = await graph_request(
        "GET",
        f"/users/{cuenta}/mailFolders/sentitems/messages"
        f"?$filter=sentDateTime ge {hoy_inicio}&$count=true&$top=1&$select=id",
        headers={"ConsistencyLevel": "eventual"},
    )

    total_hoy = recibidos_hoy.get("@odata.count", 0)
    total_ayer = recibidos_ayer.get("@odata.count", 0)
    variacion = round(((total_hoy - total_ayer) / total_ayer) * 100, 1) if total_ayer > 0 else 0

    return {
        "recibidos_hoy": total_hoy,
        "sin_leer": sin_leer.get("@odata.count", 0),
        "enviados_hoy": enviados_hoy.get("@odata.count", 0),
        "variacion_recibidos": variacion,
    }


@router.get("/mensajes")
async def listar_mensajes(cuenta: str = Query(...), carpeta: str = Query("entrada")):
    """Lista los últimos 50 mensajes de la carpeta indicada."""
    carpeta_graph = CARPETA_A_GRAPH.get(carpeta, "inbox")

    data = await graph_request(
        "GET",
        f"/users/{cuenta}/mailFolders/{carpeta_graph}/messages"
        f"?$top=50&$orderby=receivedDateTime desc"
        f"&$select=id,subject,bodyPreview,body,from,receivedDateTime,sentDateTime,isRead,hasAttachments",
    )

    mensajes = [mapear_mensaje(m, carpeta) for m in data.get("value", [])]
    return {"mensajes": mensajes, "total": len(mensajes)}


@router.get("/mensajes/{mensaje_id}")
async def obtener_mensaje(mensaje_id: str, cuenta: str = Query(...)):
    """Detalle completo de un mensaje puntual."""
    msg = await graph_request("GET", f"/users/{cuenta}/messages/{mensaje_id}")
    return mapear_mensaje(msg, "entrada")


@router.patch("/mensajes/{mensaje_id}/leido")
async def marcar_leido(mensaje_id: str, cuenta: str = Query(...)):
    """Marca un mensaje como leído en el buzón real."""
    await graph_request(
        "PATCH",
        f"/users/{cuenta}/messages/{mensaje_id}",
        json={"isRead": True},
    )
    return {"ok": True}


@router.post("/enviar")
async def enviar_correo(body: EnviarCorreoBody):
    """Envío individual (o a varios destinatarios en un mismo correo)."""
    destinatarios_graph = [{"emailAddress": {"address": d}} for d in body.destinatarios]

    payload = {
        "message": {
            "subject": body.asunto,
            "body": {"contentType": "Text", "content": body.cuerpo},
            "toRecipients": destinatarios_graph,
        },
        "saveToSentItems": True,
    }

    await graph_request("POST", f"/users/{body.cuenta}/sendMail", json=payload)
    return {"ok": True, "enviados": len(body.destinatarios)}


@router.post("/enviar-masivo")
async def enviar_masivo(body: EnviarCorreoBody):
    """
    Envío masivo: manda un correo INDIVIDUAL a cada destinatario
    (en vez de un solo correo con todos en copia), para no exponer
    los correos de unos a otros. Devuelve cuántos tuvieron éxito/fallo.
    """
    exitosos = []
    fallidos = []

    for destinatario in body.destinatarios:
        payload = {
            "message": {
                "subject": body.asunto,
                "body": {"contentType": "Text", "content": body.cuerpo},
                "toRecipients": [{"emailAddress": {"address": destinatario}}],
            },
            "saveToSentItems": True,
        }
        try:
            await graph_request("POST", f"/users/{body.cuenta}/sendMail", json=payload)
            exitosos.append(destinatario)
        except HTTPException:
            fallidos.append(destinatario)

    return {
        "ok": True,
        "total": len(body.destinatarios),
        "exitosos": len(exitosos),
        "fallidos": fallidos,
    }