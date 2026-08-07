"""
routers/contratos.py
====================
Router FastAPI que expone los datos de contratos SEACE
desde la base de datos pladibot_db (MySQL).

Endpoints:
  GET  /api/contratos              → lista paginada con filtros
  GET  /api/contratos/stats        → conteos por estado
  GET  /api/contratos/{id}         → detalle completo de un contrato
  GET  /api/contratos/{id}/items   → items del contrato
  GET  /api/contratos/{id}/rtm     → RTM del contrato
  GET  /api/contratos/{id}/etapas  → etapas del contrato
  GET  /api/contratos/{id}/archivos→ archivos (contrato + cotización)
  GET  /api/contratos/{id}/cotizacion → datos completos de cotización
"""

import os
import logging
from typing import Optional, List
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

# ─── STORAGE BACKEND (leer desde .env) ───────────────────────────────────────
STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local")   # local | azure | aws
AZURE_CONN_STR  = os.getenv("AZURE_STORAGE_CONNECTION_STRING", "")
AZURE_CONTAINER = os.getenv("AZURE_CONTAINER_NAME", "seace-archivos")
AWS_BUCKET      = os.getenv("AWS_BUCKET_NAME", "seace-archivos")
AWS_REGION      = os.getenv("AWS_REGION", "us-east-1")

# ─── CARPETA LOCAL DINÁMICA (misma lógica que el scraper) ────────────────────
_DOCS = Path("D:/")
if not _DOCS.exists():
    _DOCS = Path.home()
CARPETA_SALIDA_LOCAL = _DOCS / "SEACE_PLADIBOT"

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel
import mysql.connector
from mysql.connector import pooling

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/contratos", tags=["contratos"])

# ─── POOL DE CONEXIONES ───────────────────────────────────────────────────────

_pool: Optional[pooling.MySQLConnectionPool] = None

def get_pool() -> pooling.MySQLConnectionPool:
    global _pool
    if _pool is None:
        _pool = pooling.MySQLConnectionPool(
            pool_name="pladibot_web",
            pool_size=20,
            host     = os.getenv("MYSQL_HOST",     "localhost"),
            user     = os.getenv("MYSQL_USER",     "root"),
            password = os.getenv("MYSQL_PASSWORD", "Erick2026#"),
            database = os.getenv("MYSQL_DATABASE", "pladibot_db"),
            charset  = "utf8mb4",
        )
        logger.info("✓ Pool MySQL pladibot_db iniciado")
    return _pool

def get_conn():
    return get_pool().get_connection()


# ─── MODELOS DE RESPUESTA ─────────────────────────────────────────────────────

class ContratoResumen(BaseModel):
    id_contrato          : int
    des_contratacion     : Optional[str]
    nom_objeto_contrato  : Optional[str]
    des_objeto_contrato  : Optional[str]
    nom_entidad          : Optional[str]
    nom_estado_contrato  : Optional[str]
    id_estado_contrato   : Optional[int]
    cotizar              : Optional[bool]
    fec_ini_cotizacion   : Optional[str]
    fec_fin_cotizacion   : Optional[str]
    fec_publica          : Optional[str]
    nom_etapa_contratacion: Optional[str]
    nom_tipo_cotizacion  : Optional[str]
    valor_max_uit        : Optional[float]
    nom_sigla            : Optional[str]
    nom_area_usuaria     : Optional[str]
    num_subsanaciones_total: Optional[int]
    nom_estado_cotiza    : Optional[str]
    total_archivos_contrato  : Optional[int]
    total_archivos_cotizacion: Optional[int]

class ContratoDetalle(ContratoResumen):
    nro_contratacion     : Optional[int]
    nom_sigla_cot        : Optional[str]
    nom_area_usuaria_cot : Optional[str]
    dir_organismo        : Optional[str]
    nom_tipo_invitacion  : Optional[str]
    des_ccmn             : Optional[str]
    des_justif_tip_invit : Optional[str]
    num_consultas        : Optional[int]
    num_invitaciones     : Optional[int]
    nom_usu_registro     : Optional[str]
    anio                 : Optional[int]
    updated_at           : Optional[str]

class Archivo(BaseModel):
    id_archivo      : Optional[int]
    nombre          : Optional[str]
    tipo            : Optional[str]
    extension       : Optional[str]
    tamanio         : Optional[str]
    url_descarga    : Optional[str]
    ruta_local      : Optional[str]
    contexto        : Optional[str]
    bytes           : Optional[int]
    rag_document_id : Optional[str] = None

class Item(BaseModel):
    id_contrato_item  : Optional[int]
    cod_cubso         : Optional[str]
    nom_cubso         : Optional[str]
    nom_moneda        : Optional[str]
    nom_unidad_medida : Optional[str]
    descripcion_item  : Optional[str]
    cantidad          : Optional[float]
    precio_total      : Optional[float]
    nom_distrito      : Optional[str]
    nom_estado_cotiza : Optional[str]

class ItemCotizacion(BaseModel):
    id_contrato_item  : Optional[int]
    cod_cubso         : Optional[str]
    nom_cubso         : Optional[str]
    nom_moneda        : Optional[str]
    nom_unidad_medida : Optional[str]
    descripcion_item  : Optional[str]
    cantidad          : Optional[float]
    precio_unitario   : Optional[float]
    precio_total      : Optional[float]

class Rtm(BaseModel):
    id_contrato_rtm   : Optional[int]
    nombre_rtm        : Optional[str]
    valor             : Optional[str]

class RtmCotizacion(BaseModel):
    id_contrato_rtm   : Optional[int]
    nom_rtm           : Optional[str]
    valor_con_rtm     : Optional[str]
    valor_cot_rtm     : Optional[str]

class Etapa(BaseModel):
    id_etapa_contrato  : Optional[int]
    nom_etapa_contrato : Optional[str]
    fec_ini            : Optional[str]
    fec_fin            : Optional[str]

class Oferta(BaseModel):
    id_cotizacion    : Optional[int]
    cod_ruc          : Optional[str]
    nom_razon_social : Optional[str]
    precio_oferta    : Optional[float]
    precio_total     : Optional[float]
    plazo_ejecucion  : Optional[str]
    fec_cotiza       : Optional[str]
    nom_estado_cotiza: Optional[str]
    id_cubso         : Optional[int]
    cod_cubso        : Optional[str]
    cantidad         : Optional[float]
    nom_cubso        : Optional[str]
    descripcion_item : Optional[str]
    nom_unidad_medida: Optional[str]

class CotizacionCompleta(BaseModel):
    items   : List[ItemCotizacion]
    rtm     : List[RtmCotizacion]
    ofertas : List[Oferta]
    archivos: List[Archivo]

class Stats(BaseModel):
    total        : int
    vigentes     : int
    en_evaluacion: int
    culminados   : int
    otros        : int
    con_cotizar  : int

class PaginatedContratos(BaseModel):
    data        : List[ContratoResumen]
    total       : int
    page        : int
    page_size   : int
    total_pages : int


# ─── HELPERS ─────────────────────────────────────────────────────────────────

def row_to_dict(cursor, row):
    """Convierte una fila de MySQL a dict usando los nombres de columna."""
    cols = [d[0] for d in cursor.description]
    return dict(zip(cols, row))

def rows_to_list(cursor, rows):
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, r)) for r in rows]


# ─── ENDPOINTS ───────────────────────────────────────────────────────────────

@router.get("/stats", response_model=Stats)
def get_stats():
    """Conteos rápidos por estado para los KPI cards del dashboard."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT
                COUNT(*)                                          AS total,
                SUM(id_estado_contrato = 2)                       AS vigentes,
                SUM(id_estado_contrato = 3)                       AS en_evaluacion,
                SUM(id_estado_contrato = 4)                       AS culminados,
                SUM(id_estado_contrato NOT IN (2,3,4))            AS otros,
                SUM(cotizar = 1)                                   AS con_cotizar
            FROM contratos
        """)
        row = cur.fetchone()
        return Stats(
            total        = int(row[0] or 0),
            vigentes     = int(row[1] or 0),
            en_evaluacion= int(row[2] or 0),
            culminados   = int(row[3] or 0),
            otros        = int(row[4] or 0),
            con_cotizar  = int(row[5] or 0),
        )
    finally:
        cur.close()
        conn.close()






@router.get("/by-rag-id/{rag_document_id}/file")
def get_file_by_rag_id(rag_document_id: str, request: Request):
    """
    Sirve el archivo físico buscándolo por su rag_document_id.
    Usado por PDFViewer cuando el source viene de un archivo SEACE indexado.
    """
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT ruta_local, nombre, extension, id_contrato, id_archivo
            FROM archivos
            WHERE rag_document_id = %s
            LIMIT 1
        """, (rag_document_id,))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Archivo no encontrado para ese rag_document_id")

    ruta_local, nombre, extension, id_contrato, id_archivo = row

    # Reutilizar la misma lógica de reparación de ruta
    ruta = _reparar_ruta(ruta_local)
    if not ruta:
        raise HTTPException(status_code=404, detail=f"Archivo no existe en disco: {ruta_local}")

    ext = (extension or '').lower().strip('.')

    # Si es DOCX → convertir a PDF en vuelo para el visor
    if ext in ('docx', 'doc'):
        tmp_dir = tempfile.mkdtemp()
        try:
            pdf_path = Path(tmp_dir) / "output.pdf"
            ruta_ps  = str(ruta).replace("'", "\\'")
            pdf_ps   = str(pdf_path).replace("'", "\\'")
            ps_script = f"""
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Open('{ruta_ps}')
$doc.SaveAs2('{pdf_ps}', 17)
$doc.Close([ref]$false)
$word.Quit()
"""
            result = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
                capture_output=True, text=True, timeout=60
            )
            if not pdf_path.exists():
                raise HTTPException(status_code=500, detail=f"Error convirtiendo DOCX: {result.stderr}")
            pdf_bytes = pdf_path.read_bytes()
            return StreamingResponse(
                iter([pdf_bytes]),
                media_type="application/pdf",
                headers={"Content-Disposition": "inline", "Access-Control-Allow-Origin": "*"}
            )
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    mime, _ = mimetypes.guess_type(str(ruta))
    mime = mime or "application/octet-stream"
    return FileResponse(
        path=str(ruta),
        media_type=mime,
        headers={"Content-Disposition": "inline", "Access-Control-Allow-Origin": "*"}
    )


@router.get("", response_model=PaginatedContratos)
def list_contratos(
    page      : int            = Query(1,    ge=1),
    page_size : int            = Query(20,   ge=1, le=200),
    estado    : Optional[str]  = Query(None, description="vigente|en_evaluacion|culminado|todos"),
    q         : Optional[str]  = Query(None, description="Busca en código, entidad, descripción"),
    cotizar   : Optional[bool] = Query(None, description="Filtra solo los que se pueden cotizar"),
    anio      : Optional[int]  = Query(None),
    objeto    : Optional[int]  = Query(None, description="1=Bien, 2=Servicio, 3=Consultoría"),
    solo_mios : Optional[bool] = Query(None, description="Filtra contratos donde GRUPO ECOLIMP tiene oferta"),
):
    """
    Lista paginada de contratos con filtros.
    El frontend usa este endpoint para la grid principal.
    """
    conn = get_conn()
    cur  = conn.cursor()
    try:
        wheres = []
        params = []

        # Filtro por estado
        if estado and estado != "todos":
            mapa = {
                "vigente"      : 2,
                "en_evaluacion": 3,
                "culminado"    : 4,
            }
            id_est = mapa.get(estado.lower())
            if id_est:
                wheres.append("c.id_estado_contrato = %s")
                params.append(id_est)

        # Filtro cotizar
        if cotizar is not None:
            wheres.append("c.cotizar = %s")
            params.append(1 if cotizar else 0)

        # Filtro año
        # Filtro año
        if anio:
            wheres.append("c.anio = %s")
            params.append(anio)

        # Filtro objeto (Bien / Servicio / Consultoría)
        if objeto:
            wheres.append("c.id_objeto_contrato = %s")
            params.append(objeto)

        # Filtro "Mis ofertas" — contratos donde GRUPO ECOLIMP participó
        if solo_mios:
            wheres.append("""EXISTS (
                SELECT 1 FROM cotizacion_ofertas co
                WHERE co.id_contrato = c.id_contrato
                AND co.nom_razon_social LIKE %s
            )""")
            params.append("%GRUPO ECOLIMP%")


        # Búsqueda texto (incluye razón social de ofertas)
        if q and q.strip():
            like = f"%{q.strip()}%"
            wheres.append("""(
                c.des_contratacion    LIKE %s OR
                c.nom_entidad         LIKE %s OR
                c.des_objeto_contrato LIKE %s OR
                c.nom_sigla           LIKE %s OR
                EXISTS (
                    SELECT 1 FROM cotizacion_ofertas co
                    WHERE co.id_contrato = c.id_contrato
                    AND co.nom_razon_social LIKE %s
                )
            )""")
            params += [like, like, like, like, like]

        where_sql = ("WHERE " + " AND ".join(wheres)) if wheres else ""

        # Total
        cur.execute(f"SELECT COUNT(*) FROM contratos c {where_sql}", params)
        total = cur.fetchone()[0]

        # Datos
        offset = (page - 1) * page_size
        cur.execute(f"""
            SELECT
                c.id_contrato,
                c.des_contratacion,
                c.nom_objeto_contrato,
                c.des_objeto_contrato,
                c.nom_entidad,
                c.nom_estado_contrato,
                c.id_estado_contrato,
                c.cotizar,
                c.fec_ini_cotizacion,
                c.fec_fin_cotizacion,
                c.fec_publica,
                c.nom_etapa_contratacion,
                c.nom_tipo_cotizacion,
                c.valor_max_uit,
                c.nom_sigla,
                c.nom_area_usuaria,
                c.num_subsanaciones_total,
                c.nom_estado_cotiza,
                COALESCE(ac.n_contrato, 0) AS total_archivos_contrato,
                COALESCE(aq.n_cotizacion, 0) AS total_archivos_cotizacion
            FROM contratos c
            LEFT JOIN (
                SELECT id_contrato, COUNT(*) AS n_contrato
                FROM archivos WHERE contexto = 'contrato'
                GROUP BY id_contrato
            ) ac ON ac.id_contrato = c.id_contrato
            LEFT JOIN (
                SELECT id_contrato, COUNT(*) AS n_cotizacion
                FROM archivos WHERE contexto = 'cotizacion'
                GROUP BY id_contrato
            ) aq ON aq.id_contrato = c.id_contrato
            {where_sql}
            ORDER BY c.id_contrato DESC
            LIMIT %s OFFSET %s
        """, params + [page_size, offset])

        rows = rows_to_list(cur, cur.fetchall())

        # Normalizar tipos
        for r in rows:
            r["cotizar"] = bool(r.get("cotizar"))
            r["valor_max_uit"] = float(r["valor_max_uit"]) if r.get("valor_max_uit") else None

        import math
        return PaginatedContratos(
            data       = rows,
            total      = total,
            page       = page,
            page_size  = page_size,
            total_pages= math.ceil(total / page_size),
        )
    finally:
        cur.close()
        conn.close()


@router.get("/{id_contrato}", response_model=ContratoDetalle)
def get_contrato(id_contrato: int):
    """Detalle completo de un contrato por ID."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT
                c.*,
                COALESCE(ac.n_contrato, 0)   AS total_archivos_contrato,
                COALESCE(aq.n_cotizacion, 0) AS total_archivos_cotizacion
            FROM contratos c
            LEFT JOIN (
                SELECT id_contrato, COUNT(*) AS n_contrato
                FROM archivos WHERE contexto = 'contrato'
                GROUP BY id_contrato
            ) ac ON ac.id_contrato = c.id_contrato
            LEFT JOIN (
                SELECT id_contrato, COUNT(*) AS n_cotizacion
                FROM archivos WHERE contexto = 'cotizacion'
                GROUP BY id_contrato
            ) aq ON aq.id_contrato = c.id_contrato
            WHERE c.id_contrato = %s
        """, (id_contrato,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Contrato {id_contrato} no encontrado")
        data = row_to_dict(cur, row)
        data["cotizar"] = bool(data.get("cotizar"))
        # Excluir campos muy pesados que no se usan en el detalle UI
        data.pop("raw_detalle", None)
        data.pop("raw_completo_cotizacion", None)
        if data.get("valor_max_uit"):
            data["valor_max_uit"] = float(data["valor_max_uit"])
        if data.get("updated_at"):
            data["updated_at"] = str(data["updated_at"])
        return data
    finally:
        cur.close()
        conn.close()


@router.get("/{id_contrato}/archivos", response_model=List[Archivo])
def get_archivos(
    id_contrato: int,
    contexto: Optional[str] = Query(None, description="contrato|cotizacion|todos"),
):
    """
    Archivos del contrato.
    contexto=contrato    → solo los del contrato base
    contexto=cotizacion  → solo los de cotización
    contexto=todos o None→ todos
    """
    conn = get_conn()
    cur  = conn.cursor()
    try:
        if contexto and contexto != "todos":
            cur.execute("""
                SELECT id_archivo, nombre, tipo, extension,
                       tamanio, url_descarga, ruta_local, contexto, bytes,
                       rag_document_id
                FROM archivos
                WHERE id_contrato = %s AND contexto = %s
                ORDER BY contexto, id
            """, (id_contrato, contexto))
        else:
            cur.execute("""
                SELECT id_archivo, nombre, tipo, extension,
                       tamanio, url_descarga, ruta_local, contexto, bytes,
                       rag_document_id
                FROM archivos
                WHERE id_contrato = %s
                ORDER BY contexto, id
            """, (id_contrato,))
        return rows_to_list(cur, cur.fetchall())
    finally:
        cur.close()
        conn.close()


@router.get("/{id_contrato}/items", response_model=List[Item])
def get_items(id_contrato: int):
    """Items (productos/servicios) del contrato base."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT id_contrato_item, cod_cubso, nom_cubso,
                   nom_moneda, nom_unidad_medida, descripcion_item,
                   cantidad, precio_total, nom_distrito, nom_estado_cotiza
            FROM contrato_items
            WHERE id_contrato = %s
            ORDER BY id
        """, (id_contrato,))
        rows = rows_to_list(cur, cur.fetchall())
        for r in rows:
            r["cantidad"]    = float(r["cantidad"])    if r.get("cantidad")    else None
            r["precio_total"]= float(r["precio_total"])if r.get("precio_total")else None
        return rows
    finally:
        cur.close()
        conn.close()


@router.get("/{id_contrato}/rtm", response_model=List[Rtm])
def get_rtm(id_contrato: int):
    """Requisitos Técnicos Mínimos del contrato."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT id_contrato_rtm, nombre_rtm, valor
            FROM contrato_rtm
            WHERE id_contrato = %s
            ORDER BY id
        """, (id_contrato,))
        return rows_to_list(cur, cur.fetchall())
    finally:
        cur.close()
        conn.close()


@router.get("/{id_contrato}/etapas", response_model=List[Etapa])
def get_etapas(id_contrato: int):
    """Etapas del proceso de contratación."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT id_etapa_contrato, nom_etapa_contrato, fec_ini, fec_fin
            FROM contrato_etapas
            WHERE id_contrato = %s
            ORDER BY id
        """, (id_contrato,))
        return rows_to_list(cur, cur.fetchall())
    finally:
        cur.close()
        conn.close()


@router.get("/{id_contrato}/cotizacion", response_model=CotizacionCompleta)
def get_cotizacion(id_contrato: int):
    """
    Todo lo relacionado a la cotización de un contrato:
    items, RTM, ofertas recibidas y archivos de cotización.
    """
    conn = get_conn()
    cur  = conn.cursor()
    try:
        # Items cotización
        cur.execute("""
            SELECT id_contrato_item, cod_cubso, nom_cubso,
                   nom_moneda, nom_unidad_medida, descripcion_item,
                   cantidad, precio_unitario, precio_total
            FROM cotizacion_items
            WHERE id_contrato = %s ORDER BY id
        """, (id_contrato,))
        items = rows_to_list(cur, cur.fetchall())
        for r in items:
            r["cantidad"]       = float(r["cantidad"])       if r.get("cantidad")       else None
            r["precio_unitario"]= float(r["precio_unitario"])if r.get("precio_unitario")else None
            r["precio_total"]   = float(r["precio_total"])   if r.get("precio_total")   else None

        # RTM cotización
        cur.execute("""
            SELECT id_contrato_rtm, nom_rtm, valor_con_rtm, valor_cot_rtm
            FROM cotizacion_rtm
            WHERE id_contrato = %s ORDER BY id
        """, (id_contrato,))
        rtm = rows_to_list(cur, cur.fetchall())

        # Ofertas
        # Ofertas — JOIN con contrato_items para traer cantidad/cubso/descripcion
        # cuando la oferta es DESIERTO y esos datos están en contrato_items
        cur.execute("""
            SELECT
                co.id_cotizacion, co.cod_ruc, co.nom_razon_social,
                co.precio_oferta, co.precio_total, co.plazo_ejecucion,
                co.fec_cotiza, co.nom_estado_cotiza,
                co.id_cubso, co.cod_cubso,
                COALESCE(co.cantidad,    ci.cantidad)         AS cantidad,
                COALESCE(co.nom_cubso,   ci.nom_cubso)        AS nom_cubso,
                COALESCE(co.descripcion_item, ci.descripcion_item) AS descripcion_item,
                COALESCE(co.nom_unidad_medida, ci.nom_unidad_medida) AS nom_unidad_medida
            FROM cotizacion_ofertas co
            LEFT JOIN contrato_items ci
                ON ci.id_contrato = co.id_contrato
               AND ci.cod_cubso   = co.cod_cubso
            WHERE co.id_contrato = %s
            ORDER BY co.precio_total ASC
        """, (id_contrato,))
        ofertas = rows_to_list(cur, cur.fetchall())
        for r in ofertas:
            r["precio_oferta"] = float(r["precio_oferta"]) if r.get("precio_oferta") else None
            r["precio_total"]  = float(r["precio_total"])  if r.get("precio_total")  else None
            r["cantidad"]      = float(r["cantidad"])       if r.get("cantidad")      else None

        # Archivos cotización
        cur.execute("""
            SELECT id_archivo, nombre, tipo, extension,
                   tamanio, url_descarga, ruta_local, contexto, bytes
            FROM archivos
            WHERE id_contrato = %s AND contexto = 'cotizacion'
            ORDER BY id
        """, (id_contrato,))
        archivos = rows_to_list(cur, cur.fetchall())

        return CotizacionCompleta(
            items   = items,
            rtm     = rtm,
            ofertas = ofertas,
            archivos= archivos,
        )
    finally:
        cur.close()
        conn.close()


import mimetypes
from fastapi.responses import FileResponse


@router.get("/{id_contrato}/archivos/{id_archivo}/descargar")
def descargar_archivo_local(id_contrato: int, id_archivo: int, request: Request):
    logger.info(f"[DESCARGA] Petición desde {request.client.host} — contrato={id_contrato} archivo={id_archivo}")
    """
    Sirve el archivo según STORAGE_BACKEND:
      - local → FileResponse desde disco (ruta dinámica)
      - azure → redirect a SAS URL temporal
      - aws   → redirect a presigned URL
    """
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT ruta_local, nombre, extension
            FROM archivos
            WHERE id_contrato = %s AND id_archivo = %s
            LIMIT 1
        """, (id_contrato, id_archivo))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Archivo no encontrado en BD")

    ruta_local, nombre, extension = row

    if not ruta_local:
        raise HTTPException(status_code=404, detail="Este archivo no tiene ruta local guardada")

    # ── AZURE ─────────────────────────────────────────────────────────────────
    if STORAGE_BACKEND == "azure":
        try:
            from azure.storage.blob import BlobServiceClient, generate_blob_sas, BlobSasPermissions
            from datetime import timedelta, timezone, datetime as dt
            blob_name = Path(ruta_local).name   # la url guardada trae el nombre al final
            # si ruta_local es una URL completa, extraer solo el blob name
            if ruta_local.startswith("http"):
                blob_name = ruta_local.split("/")[-1]
            client      = BlobServiceClient.from_connection_string(AZURE_CONN_STR)
            blob_client = client.get_blob_client(container=AZURE_CONTAINER, blob=blob_name)
            sas = generate_blob_sas(
                account_name   = client.account_name,
                container_name = AZURE_CONTAINER,
                blob_name      = blob_name,
                account_key    = client.credential.account_key,
                permission     = BlobSasPermissions(read=True),
                expiry         = dt.now(timezone.utc) + timedelta(minutes=15),
            )
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=f"{blob_client.url}?{sas}")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error Azure: {e}")

    # ── AWS S3 ────────────────────────────────────────────────────────────────
    if STORAGE_BACKEND == "aws":
        try:
            import boto3
            s3_key = Path(ruta_local).name
            if ruta_local.startswith("http"):
                s3_key = ruta_local.split("/")[-1]
            s3  = boto3.client("s3", region_name=AWS_REGION)
            url = s3.generate_presigned_url(
                "get_object",
                Params     = {"Bucket": AWS_BUCKET, "Key": s3_key},
                ExpiresIn  = 900,   # 15 min
            )
            from fastapi.responses import RedirectResponse
            return RedirectResponse(url=url)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error AWS S3: {e}")

    # ── LOCAL (default) ───────────────────────────────────────────────────────
    # Reconstruir ruta dinámica: si la ruta guardada en BD pertenece
    # a otro usuario (distinto PC), reemplazar la parte fija por la actual.
    ruta = Path(ruta_local)
    if not ruta.exists():
        # Ruta relativa nueva (archivos\73469\...)
        ruta2 = CARPETA_SALIDA_LOCAL / ruta_local
        if ruta2.exists():
            ruta = ruta2
        else:
            # Ruta absoluta vieja con otro usuario
            partes = ruta.parts
            try:
                idx      = next(i for i, p in enumerate(partes) if p == "SEACE_PLADIBOT")
                relativa = Path(*partes[idx+1:])
                ruta3    = CARPETA_SALIDA_LOCAL / relativa
                if ruta3.exists():
                    ruta = ruta3
            except StopIteration:
                pass

    if not ruta.exists():
        raise HTTPException(status_code=404, detail=f"Archivo no encontrado en disco: {ruta_local}")

    mime, _ = mimetypes.guess_type(str(ruta))
    mime     = mime or "application/octet-stream"
    nombre_limpio = nombre or ruta.name

    return FileResponse(
        path       = str(ruta),
        media_type = mime,
        filename   = nombre_limpio,
        headers    = {
            "Content-Disposition": f'attachment; filename="{nombre_limpio}"',
            "Access-Control-Allow-Origin": "*",
        }
    )






@router.get("/{id_contrato}/archivos/{id_archivo}/descargar-docx")
def descargar_docx(id_contrato: int, id_archivo: int, request: Request):
    """Sirve el DOCX convertido desde PDF."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT ruta_local, nombre
            FROM archivos
            WHERE id_contrato = %s AND id_archivo = %s
            LIMIT 1
        """, (id_contrato, id_archivo))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    ruta_local, nombre = row
    ruta = _reparar_ruta(ruta_local)
    if not ruta:
        raise HTTPException(status_code=404, detail="Archivo no encontrado en disco")

    docx_path = ruta.with_suffix('.docx')
    if not docx_path.exists():
        raise HTTPException(status_code=404, detail="DOCX convertido no encontrado")

    return FileResponse(
        path=str(docx_path),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=docx_path.name,
        headers={"Access-Control-Allow-Origin": "*"}
    )



import subprocess
import tempfile
import shutil
from fastapi.responses import StreamingResponse
from pathlib import Path


@router.get("/{id_contrato}/archivos/{id_archivo}/preview")
def preview_archivo(id_contrato: int, id_archivo: int):
    """Convierte docx a PDF y lo sirve para abrir en navegador."""
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT ruta_local, extension
            FROM archivos
            WHERE id_archivo = %s AND id_contrato = %s
            LIMIT 1
        """, (id_archivo, id_contrato))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Archivo no encontrado en BD")

    ruta_local = row[0]
    extension  = (row[1] or '').lower().strip('.')

    # Reparar ruta dinámica si cambió de usuario/PC
    ruta_check = Path(ruta_local) if ruta_local else None
    if ruta_check and not ruta_check.exists():
        # Ruta relativa nueva (archivos\73469\cotizacion\...)
        ruta_check2 = CARPETA_SALIDA_LOCAL / ruta_local
        if ruta_check2.exists():
            ruta_local = str(ruta_check2)
        else:
            # Ruta absoluta vieja con otro usuario (C:\Users\MSICROSS\...)
            partes = ruta_check.parts
            try:
                idx        = next(i for i, p in enumerate(partes) if p == "SEACE_PLADIBOT")
                relativa   = Path(*partes[idx+1:])
                ruta_check3 = CARPETA_SALIDA_LOCAL / relativa
                if ruta_check3.exists():
                    ruta_local = str(ruta_check3)
            except StopIteration:
                pass
    if not ruta_local or not Path(ruta_local).exists():
        raise HTTPException(status_code=404, detail=f"Archivo no existe en disco: {ruta_local}")

    if extension == 'pdf':
        return FileResponse(
            path=ruta_local,
            media_type="application/pdf",
            headers={"Content-Disposition": "inline"}
        )

    if extension in ('docx', 'doc'):
        tmp_dir = tempfile.mkdtemp()
        try:
            pdf_path = Path(tmp_dir) / "output.pdf"
            ruta_ps  = ruta_local.replace("'", "\\'")
            pdf_ps   = str(pdf_path).replace("'", "\\'")
            ps_script = f"""
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Open('{ruta_ps}')
$doc.SaveAs2('{pdf_ps}', 17)
$doc.Close([ref]$false)
$word.Quit()
"""
            result = subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
                capture_output=True, text=True, timeout=60
            )
            if not pdf_path.exists():
                raise HTTPException(status_code=500, detail=f"Error convirtiendo: {result.stderr}")
            pdf_bytes = pdf_path.read_bytes()
            return StreamingResponse(
                iter([pdf_bytes]),
                media_type="application/pdf",
                headers={"Content-Disposition": "inline"}
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error: {str(e)}")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    raise HTTPException(status_code=400, detail="Formato no soportado")


@router.post("/{id_contrato}/archivos/{id_archivo}/indexar")
def indexar_archivo(id_contrato: int, id_archivo: int):
    """Indexa un archivo local al RAG (ChromaDB) y guarda el document_id en BD."""
    import uuid
    from services.ocr_service import extract_text_from_pdf
    from services.embedding_service import process_and_store_document
    from routers.upload import load_registry, save_registry
    from datetime import datetime

    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT ruta_local, nombre, extension, rag_document_id
            FROM archivos
            WHERE id_archivo = %s AND id_contrato = %s
            LIMIT 1
        """, (id_archivo, id_contrato))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Archivo no encontrado en BD")

    ruta_local, nombre, extension, rag_document_id = row
    extension = (extension or '').lower().strip('.')

    # Reparar ruta dinámica (misma lógica que preview_archivo / descargar_archivo_local)
    ruta_check = Path(ruta_local) if ruta_local else None
    if ruta_check and not ruta_check.exists():
        ruta_check2 = CARPETA_SALIDA_LOCAL / ruta_local
        if ruta_check2.exists():
            ruta_local = str(ruta_check2)
        else:
            partes = ruta_check.parts
            try:
                idx = next(i for i, p in enumerate(partes) if p == "SEACE_PLADIBOT")
                relativa = Path(*partes[idx+1:])
                ruta_check3 = CARPETA_SALIDA_LOCAL / relativa
                if ruta_check3.exists():
                    ruta_local = str(ruta_check3)
            except StopIteration:
                pass

    if not ruta_local or not Path(ruta_local).exists():
        raise HTTPException(status_code=404, detail=f"Archivo no existe en disco: {ruta_local}")

    if rag_document_id:
        return {"document_id": rag_document_id, "already_indexed": True}

    pdf_path = ruta_local
    tmp_dir  = None
    if extension in ('docx', 'doc'):
        tmp_dir = tempfile.mkdtemp()
        tmp_pdf = Path(tmp_dir) / "output.pdf"
        ruta_ps = ruta_local.replace("'", "\\'")
        pdf_ps  = str(tmp_pdf).replace("'", "\\'")
        ps_script = f"""
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Open('{ruta_ps}')
$doc.SaveAs2('{pdf_ps}', 17)
$doc.Close([ref]$false)
$word.Quit()
"""
        result = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
            capture_output=True, text=True, timeout=60
        )
        if not tmp_pdf.exists():
            raise HTTPException(status_code=500, detail=f"Error convirtiendo DOCX: {result.stderr}")
        pdf_path = str(tmp_pdf)

    try:
        document_id = str(uuid.uuid4())
        safe_name   = (nombre or Path(ruta_local).name).replace(" ", "_")

        pages_data, was_ocr = extract_text_from_pdf(pdf_path)
        if not pages_data:
            raise HTTPException(status_code=500, detail="No se pudo extraer texto del archivo")

        chunks = process_and_store_document(
            pages_data  = pages_data,
            document_id = document_id,
            filename    = safe_name,
            was_ocr     = was_ocr
        )

        registry = load_registry()
        registry[document_id] = {
            "document_id"       : document_id,
            "filename"          : safe_name,
            "original_filename" : nombre or safe_name,
            "pages"             : len(pages_data),
            "chunks"            : chunks,
            "was_ocr"           : was_ocr,
            "status"            : "ready",
            "pdf_path"          : pdf_path,
            "uploaded_at"       : datetime.now().isoformat()
        }
        save_registry(registry)

        conn2 = get_conn()
        cur2  = conn2.cursor()
        try:
            cur2.execute("""
                UPDATE archivos SET rag_document_id = %s
                WHERE id_archivo = %s
            """, (document_id, id_archivo))
            conn2.commit()
        finally:
            cur2.close()
            conn2.close()

        return {"document_id": document_id, "chunks": chunks, "already_indexed": False}

    finally:
        if tmp_dir:
            shutil.rmtree(tmp_dir, ignore_errors=True)



# ─── ONLYOFFICE INTEGRATION ──────────────────────────────────────────────────

from fastapi import Request
from fastapi.responses import JSONResponse
import json

ONLYOFFICE_SERVER = os.getenv("ONLYOFFICE_URL", "http://localhost:8080")
BACKEND_PUBLIC_URL = os.getenv("BACKEND_PUBLIC_URL", "http://localhost:8000")


SOFFICE = r"C:\Program Files\LibreOffice\program\soffice.exe"
TESSERACT = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

def _reparar_ruta(ruta_local: str) -> Optional[Path]:
    """Repara rutas dinámicas de archivos."""
    ruta = Path(ruta_local)
    if ruta.exists():
        return ruta
    ruta2 = CARPETA_SALIDA_LOCAL / ruta_local
    if ruta2.exists():
        return ruta2
    partes = ruta.parts
    try:
        idx = next(i for i, p in enumerate(partes) if p == "SEACE_PLADIBOT")
        relativa = Path(*partes[idx+1:])
        ruta3 = CARPETA_SALIDA_LOCAL / relativa
        if ruta3.exists():
            return ruta3
    except StopIteration:
        pass
    return None

def _pdf_tiene_texto(pdf_path: Path) -> bool:
    """Retorna True si el PDF tiene texto extraíble (no es escaneado)."""
    try:
        import fitz  # pymupdf
        doc = fitz.open(str(pdf_path))
        for page in doc:
            if page.get_text().strip():
                doc.close()
                return True
        doc.close()
        return False
    except Exception as e:
        logger.error(f"[PDF_CHECK] Error verificando texto: {e}")
        return False
import requests

GOTENBERG_URL = "http://localhost:3001/forms/libreoffice/convert"

def _convertir_pdf_a_docx(pdf_path: Path) -> Optional[Path]:
    """
    Conversión REAL PDF → DOCX usando LibreOffice (Gotenberg).
    Mucho mejor que pdf2docx.
    """

    docx_path = pdf_path.with_suffix(".docx")

    if docx_path.exists():
        return docx_path

    try:
        with open(pdf_path, "rb") as f:
            files = {
                "files": (pdf_path.name, f, "application/pdf")
            }

            response = requests.post(
                GOTENBERG_URL,
                files=files,
                timeout=120
            )

        if response.status_code != 200:
            print("❌ Gotenberg error:", response.text)
            return None

        docx_path.write_bytes(response.content)

        print(f"✓ CONVERTIDO PRO: {docx_path}")
        return docx_path

    except Exception as e:
        print(f"❌ Error conversión Gotenberg: {e}")
        return None



@router.get("/{id_contrato}/archivos/{id_archivo}/onlyoffice-config")
def get_onlyoffice_config(id_contrato: int, id_archivo: int, request: Request):
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            SELECT nombre, extension, ruta_local
            FROM archivos
            WHERE id_archivo = %s AND id_contrato = %s
            LIMIT 1
        """, (id_archivo, id_contrato))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row:
        raise HTTPException(status_code=404, detail="Archivo no encontrado")

    nombre, extension, ruta_local = row
    ext = (extension or '').lower().strip('.')


    # URL que ve el browser del cliente (para cargar el editor JS)
    host_header = request.headers.get("host", "192.168.1.63:8000")
    backend_url_browser = f"http://{host_header}"
    if ":3000" in backend_url_browser:
        backend_url_browser = backend_url_browser.replace(":3000", ":8000")

    # Si es PDF, convertir a DOCX primero y servir el DOCX
    # PDF → abrir directo en OnlyOffice sin conversión
    # PDF → intentar convertir a DOCX si tiene texto, sino abrir como PDF (solo lectura)
    if ext == 'pdf':
        import time
        callback_url = f"{BACKEND_PUBLIC_URL}/api/contratos/{id_contrato}/archivos/{id_archivo}/onlyoffice-callback"
        key = f"contrato_{id_contrato}_archivo_{id_archivo}_{int(time.time())}"
        download_url = f"{backend_url_browser}/api/contratos/{id_contrato}/archivos/{id_archivo}/descargar"     
        return {
            "document": {
                "fileType": "pdf",
                "key": key,
                "title": nombre or f"archivo_{id_archivo}.pdf",
                "url": download_url,
                "permissions": {"download": True, "edit": False, "print": True}
            },
            "documentType": "word",
            "editorConfig": {
                "callbackUrl": callback_url,
                "lang": "es",
                "user": {"id": "pladibot-user", "name": "PLADIBOT"},
                "customization": {
                    "autosave": False, "forcesave": False,
                    "logo": {"visible": False},
                    "compactHeader": True, "toolbarNoTabs": True,
                }
            }
        }


    doc_type_map = {
        'docx': 'word', 'doc': 'word',
        'pdf' : 'word',
        'xlsx': 'cell', 'xls': 'cell',
        'pptx': 'slide', 'ppt': 'slide',
    }
    file_type_map = {
        'docx': 'docx', 'doc': 'doc',
        'pdf' : 'pdf',
    }
    doc_type  = doc_type_map.get(ext, 'word')
    file_type = file_type_map.get(ext, ext)

    download_url = f"{backend_url_browser}/api/contratos/{id_contrato}/archivos/{id_archivo}/descargar"
    callback_url = f"{BACKEND_PUBLIC_URL}/api/contratos/{id_contrato}/archivos/{id_archivo}/onlyoffice-callback"

    import time
    key = f"contrato_{id_contrato}_archivo_{id_archivo}_{int(time.time())}"

    return {
        "document": {
            "fileType" : file_type,
            "key"      : key,
            "title"    : nombre or f"archivo_{id_archivo}.{ext}",
            "url"      : download_url,
            "permissions": {"download": True, "edit": True, "print": True}
        },
        "documentType": doc_type,
        "editorConfig": {
            "callbackUrl": callback_url,
            "lang"       : "es",
            "user"       : {"id": "pladibot-user", "name": "PLADIBOT"},
            "customization": {
                "autosave": True, "forcesave": True,
                "logo": {"visible": False},
                "compactHeader": True, "toolbarNoTabs": True,
            }
        }
    }


@router.post("/{id_contrato}/archivos/{id_archivo}/onlyoffice-callback")
async def onlyoffice_callback(id_contrato: int, id_archivo: int, request: Request):
    """
    OnlyOffice llama aquí cuando el usuario guarda el documento.
    Status 2 = listo para descargar. Descargamos y sobreescribimos el archivo local.
    """
    import httpx

    body = await request.json()
    status = body.get("status")
    logger.info(f"[CALLBACK] status={status} body={body}")

    # Status 2 = documento guardado y listo para descargar
    # Status 6 = forcesave
    if status in (2, 6):
        download_url = body.get("url")
        if not download_url:
            return JSONResponse({"error": 0})

        # Obtener ruta local del archivo
        conn = get_conn()
        cur  = conn.cursor()
        try:
            cur.execute("""
                SELECT ruta_local, nombre, extension
                FROM archivos
                WHERE id_archivo = %s AND id_contrato = %s
                LIMIT 1
            """, (id_archivo, id_contrato))
            row = cur.fetchone()
        finally:
            cur.close()
            conn.close()

        if not row:
            return JSONResponse({"error": 0})

        ruta_local, nombre, extension = row

        # Reparar ruta dinámica
        ruta = Path(ruta_local)
        if not ruta.exists():
            ruta2 = CARPETA_SALIDA_LOCAL / ruta_local
            if ruta2.exists():
                ruta = ruta2
            else:
                partes = ruta.parts
                try:
                    idx = next(i for i, p in enumerate(partes) if p == "SEACE_PLADIBOT")
                    relativa = Path(*partes[idx+1:])
                    ruta3 = CARPETA_SALIDA_LOCAL / relativa
                    if ruta3.exists():
                        ruta = ruta3
                except StopIteration:
                    pass

        # Descargar el archivo editado desde OnlyOffice y guardar
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(download_url, timeout=30)
                resp.raise_for_status()
                ruta.write_bytes(resp.content)
                logger.info(f"✓ Archivo guardado desde OnlyOffice: {ruta}")
        except Exception as e:
            logger.error(f"Error guardando desde OnlyOffice: {e}")

    # OnlyOffice requiere siempre {"error": 0} para confirmar
    return JSONResponse({"error": 0})


