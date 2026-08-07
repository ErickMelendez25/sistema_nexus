"""
Helbot - perucompras_marcas_router.py
---------------------------------------
CRUD de perucompras_marcas_config, para que el usuario agregue/quite
marcas de las 4 listas (restringida_semaforo, prohibida_500_1000,
excepcion_menor_500, objetivo) desde el frontend, sin tocar código.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from auth import obtener_usuario_actual, UsuarioToken
from db import get_conn

router = APIRouter(prefix="/perucompras/marcas", tags=["perucompras-marcas-config"])

LISTAS_VALIDAS = {"restringida_semaforo", "prohibida_500_1000", "excepcion_menor_500", "objetivo"}


@router.get("")
def listar_marcas(uid: str = ""):
    """Devuelve las marcas de las 4 listas, agrupadas, filtradas por el
    uid de Perú Compras que las configuró — el frontend arma las 4
    secciones a partir de esto."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if uid:
                cur.execute(
                    "SELECT id, lista, marca, creado_por, creado_en FROM perucompras_marcas_config WHERE uid_perucompras = %s ORDER BY lista, marca",
                    (uid,),
                )
            else:
                cur.execute(
                    "SELECT id, lista, marca, creado_por, creado_en FROM perucompras_marcas_config ORDER BY lista, marca"
                )
            filas = cur.fetchall()
            for f in filas:
                if f.get("creado_en"):
                    f["creado_en"] = f["creado_en"].isoformat()
            return filas
    finally:
        conn.close()

class MarcaIn(BaseModel):
    lista: str
    marca: str
    uid: str = ""


@router.post("")
def agregar_marca(body: MarcaIn, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    if body.lista not in LISTAS_VALIDAS:
        raise HTTPException(400, f"Lista inválida. Debe ser una de: {', '.join(LISTAS_VALIDAS)}")
    marca_limpia = body.marca.strip().upper()
    if not marca_limpia:
        raise HTTPException(400, "La marca no puede estar vacía")

    usuario_helbot = usuario.nombre_completo or usuario.username
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT IGNORE INTO perucompras_marcas_config (uid_perucompras, lista, marca, creado_por) VALUES (%s, %s, %s, %s)",
                (body.uid, body.lista, marca_limpia, usuario_helbot),
            )
            if cur.rowcount == 0:
                raise HTTPException(409, f"'{marca_limpia}' ya existe en la lista {body.lista}")
            nuevo_id = cur.lastrowid
        conn.commit()
    finally:
        conn.close()

    return {"ok": True, "id": nuevo_id, "lista": body.lista, "marca": marca_limpia}


@router.delete("/{marca_id}")
def eliminar_marca(marca_id: int, uid: str = "", usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if uid:
                cur.execute(
                    "DELETE FROM perucompras_marcas_config WHERE id = %s AND uid_perucompras = %s",
                    (marca_id, uid),
                )
            else:
                cur.execute("DELETE FROM perucompras_marcas_config WHERE id = %s", (marca_id,))
            if cur.rowcount == 0:
                raise HTTPException(404, "Marca no encontrada (o no pertenece a este usuario)")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}