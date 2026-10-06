"""
Helbot - proveedores.py
------------------------
Módulo de PROVEEDORES de Nexus.

- Tabla propia `proveedores` (espejo del ERP + datos de Nexus).
- Tabla `proveedor_contactos` (contactos del ERP + teléfonos que los
  usuarios de Nexus escriben en el formulario). Nunca se pisan entre sí.
- Tabla `proveedor_etiquetas` (marca / categoría / catálogo) — el ERP no
  las expone en /proveedores, así que se administran desde Nexus.
- Sincronización con el ERP (GET /proveedores + GET /contacts/provider/{id}).
- Buscador con filtros (nombre, RUC, teléfono, departamento, provincia,
  distrito, marca, categoría, catálogo).

Se monta en main.py con:
    from proveedores import router as proveedores_router, crear_tablas as crear_tablas_proveedores
    app.include_router(proveedores_router)
    crear_tablas_proveedores()   # una vez, en el startup
"""

import os
import re
import logging
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from pydantic import BaseModel

from erp_login import erp_session, ERP_API_BASE
from db import get_conn

logger = logging.getLogger("helbot.proveedores")
router = APIRouter(prefix="/api/proveedores", tags=["proveedores"])

# Ojo: en el navegador viste https://api.gruecolimp.com/erp/proveedores.
# Si el ERP ya migró a ese dominio, define en Coolify:
#   ERP_API_BASE=https://api.gruecolimp.com/erp
# o solo para este módulo:
#   ERP_PROVEEDORES_URL=https://api.gruecolimp.com/erp/proveedores
ERP_PROVEEDORES_URL = os.getenv("ERP_PROVEEDORES_URL", f"{ERP_API_BASE}/providers")


# ============================================================
# Utilidades
# ============================================================
def norm(valor) -> Optional[str]:
    """MAYÚSCULAS, sin tildes, sin espacios dobles. 'lima'/'Lima'/'LIMA' -> 'LIMA'."""
    if valor is None:
        return None
    s = unicodedata.normalize("NFKD", str(valor))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"\s+", " ", s).strip().upper()
    return s or None


def _limpio(valor) -> Optional[str]:
    """El ERP guarda '-', '.', ',' cuando no hay dato. Eso es NULL."""
    if valor is None:
        return None
    s = str(valor).strip()
    return None if s in ("", "-", ".", ",") else s


def _telefono_key(telefono) -> str:
    """Solo dígitos, sin el 51 inicial: '+51 971 972 667' -> '971972667'."""
    d = re.sub(r"\D", "", telefono or "")
    if len(d) == 11 and d.startswith("51"):
        d = d[2:]
    return d


def _dt(valor) -> Optional[datetime]:
    if not valor:
        return None
    try:
        return datetime.fromisoformat(str(valor).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


# ============================================================
# Esquema MySQL
# ============================================================
DDL = [
    """
    CREATE TABLE IF NOT EXISTS proveedores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        erp_id INT NULL,
        razon_social VARCHAR(255) NOT NULL,
        razon_social_norm VARCHAR(255) NOT NULL,
        ruc VARCHAR(30) NULL,
        direccion VARCHAR(500) NULL,
        departamento VARCHAR(100) NULL,
        provincia VARCHAR(100) NULL,
        distrito VARCHAR(100) NULL,
        departamento_norm VARCHAR(100) NULL,
        provincia_norm VARCHAR(100) NULL,
        distrito_norm VARCHAR(100) NULL,
        telefono_erp VARCHAR(50) NULL,
        email VARCHAR(150) NULL,
        activo TINYINT(1) NOT NULL DEFAULT 1,
        origen ENUM('erp','nexus') NOT NULL DEFAULT 'erp',
        erp_creado_en DATETIME NULL,
        erp_actualizado_en DATETIME NULL,
        sincronizado_en DATETIME NULL,
        creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_proveedor_erp (erp_id),
        KEY idx_prov_ruc (ruc),
        KEY idx_prov_nombre (razon_social_norm),
        KEY idx_prov_ubic (departamento_norm, provincia_norm, distrito_norm)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS proveedor_contactos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        proveedor_id INT NOT NULL,
        erp_contacto_id INT NULL,
        nombre VARCHAR(150) NULL,
        cargo VARCHAR(100) NULL,
        telefono VARCHAR(50) NULL,
        telefono_key VARCHAR(30) NOT NULL DEFAULT '',
        email VARCHAR(150) NULL,
        origen ENUM('erp','nexus') NOT NULL,
        registrado_por VARCHAR(100) NULL,
        creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_contacto (proveedor_id, origen, telefono_key),
        KEY idx_contacto_tel (telefono_key),
        CONSTRAINT fk_contacto_prov FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS proveedor_etiquetas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        proveedor_id INT NOT NULL,
        tipo ENUM('marca','categoria','catalogo') NOT NULL,
        valor VARCHAR(150) NOT NULL,
        valor_norm VARCHAR(150) NOT NULL,
        creado_por VARCHAR(100) NULL,
        creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_etiqueta (proveedor_id, tipo, valor_norm),
        KEY idx_etiqueta_tipo (tipo, valor_norm),
        CONSTRAINT fk_etiqueta_prov FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS proveedor_historial (
        id INT AUTO_INCREMENT PRIMARY KEY,
        proveedor_id INT NOT NULL,
        op_id INT NOT NULL,
        orden_compra_id INT NOT NULL,
        numero_ocam VARCHAR(60) NULL,
        producto_codigo VARCHAR(80) NOT NULL DEFAULT '',
        producto_descripcion VARCHAR(500) NULL,
        marca VARCHAR(150) NULL,
        marca_norm VARCHAR(150) NULL,
        categoria VARCHAR(255) NULL,
        categoria_norm VARCHAR(255) NULL,
        catalogo VARCHAR(150) NULL,
        catalogo_norm VARCHAR(150) NULL,
        entrega_departamento VARCHAR(100) NULL,
        entrega_provincia VARCHAR(100) NULL,
        entrega_distrito VARCHAR(100) NULL,
        entrega_departamento_norm VARCHAR(100) NULL,
        entrega_provincia_norm VARCHAR(100) NULL,
        entrega_distrito_norm VARCHAR(100) NULL,
        sincronizado_en DATETIME NULL,
        UNIQUE KEY uq_hist (op_id, producto_codigo),
        KEY idx_hist_prov (proveedor_id),
        KEY idx_hist_marca (marca_norm),
        KEY idx_hist_cat (categoria_norm),
        KEY idx_hist_catalogo (catalogo_norm),
        KEY idx_hist_zona (entrega_departamento_norm, entrega_provincia_norm, entrega_distrito_norm),
        CONSTRAINT fk_hist_prov FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
]

def crear_tablas():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for ddl in DDL:
                cur.execute(ddl)
        conn.commit()
    finally:
        conn.close()


# ============================================================
# Sincronización con el ERP
# ============================================================
def sincronizar_proveedores_erp() -> dict:
    """GET /proveedores del ERP (lista completa, sin paginar) -> upsert por erp_id.
    Importante: la clave es erp_id, NO el RUC. En el ERP hay RUCs repetidos
    (CG DISTRIBUCIONES 137/194, IQ APOR 166/210, SALEM 255/281, CODISAL 155/257...)."""
    if not erp_session.autenticado:
        raise RuntimeError("Sesión ERP no activa")

    r = erp_session.session.get(ERP_PROVEEDORES_URL, timeout=60)
    r.raise_for_status()
    data = r.json()
    lista = data if isinstance(data, list) else (data.get("data") or data.get("items") or [])

    ahora = datetime.now()
    nuevos = 0
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for p in lista:
                if not p.get("id") or not p.get("razonSocial"):
                    continue
                dep, prov, dist = _limpio(p.get("departamento")), _limpio(p.get("provincia")), _limpio(p.get("distrito"))
                cur.execute(
                    """
                    INSERT INTO proveedores
                        (erp_id, razon_social, razon_social_norm, ruc, direccion,
                         departamento, provincia, distrito,
                         departamento_norm, provincia_norm, distrito_norm,
                         telefono_erp, email, activo, origen,
                         erp_creado_en, erp_actualizado_en, sincronizado_en)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'erp',%s,%s,%s)
                    ON DUPLICATE KEY UPDATE
                        razon_social=VALUES(razon_social),
                        razon_social_norm=VALUES(razon_social_norm),
                        ruc=VALUES(ruc), direccion=VALUES(direccion),
                        departamento=VALUES(departamento), provincia=VALUES(provincia), distrito=VALUES(distrito),
                        departamento_norm=VALUES(departamento_norm), provincia_norm=VALUES(provincia_norm),
                        distrito_norm=VALUES(distrito_norm),
                        telefono_erp=VALUES(telefono_erp), email=VALUES(email), activo=VALUES(activo),
                        erp_creado_en=VALUES(erp_creado_en), erp_actualizado_en=VALUES(erp_actualizado_en),
                        sincronizado_en=VALUES(sincronizado_en)
                    """,
                    (
                        p["id"], p["razonSocial"].strip(), norm(p["razonSocial"]),
                        _limpio(p.get("ruc")), _limpio(p.get("direccion")),
                        dep, prov, dist, norm(dep), norm(prov), norm(dist),
                        _limpio(p.get("telefono")), _limpio(p.get("email")),
                        1 if p.get("estado") else 0,
                        _dt(p.get("createdAt")), _dt(p.get("updatedAt")), ahora,
                    ),
                )
                if cur.rowcount == 1:
                    nuevos += 1
        conn.commit()
    finally:
        conn.close()

    logger.info(f"sync proveedores: {len(lista)} leídos, {nuevos} nuevos")
    return {"leidos": len(lista), "nuevos": nuevos, "actualizados": len(lista) - nuevos}


def _traer_contactos(erp_id: int):
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/contacts/provider/{erp_id}", timeout=20)
        r.raise_for_status()
        j = r.json()
        return erp_id, (j if isinstance(j, list) else (j.get("data") or []))
    except Exception as e:
        logger.warning(f"contactos proveedor {erp_id} falló: {e}")
        return erp_id, None


def sincronizar_contactos_erp(erp_ids: Optional[list[int]] = None, workers: int = 4) -> dict:
    """Trae los contactos de cada proveedor (GET /contacts/provider/{id}) y los
    guarda con origen='erp'. Los teléfonos de Nexus (origen='nexus') no se tocan."""
    if not erp_session.autenticado:
        raise RuntimeError("Sesión ERP no activa")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if erp_ids:
                fmt = ",".join(["%s"] * len(erp_ids))
                cur.execute(f"SELECT id, erp_id FROM proveedores WHERE erp_id IN ({fmt})", tuple(erp_ids))
            else:
                cur.execute("SELECT id, erp_id FROM proveedores WHERE erp_id IS NOT NULL AND activo = 1")
            mapa = {f["erp_id"]: f["id"] for f in cur.fetchall()}
    finally:
        conn.close()

    with ThreadPoolExecutor(max_workers=workers) as pool:
        resultados = list(pool.map(_traer_contactos, list(mapa.keys())))

    guardados = 0
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for erp_id, contactos in resultados:
                if not contactos:
                    continue
                for c in contactos:
                    tel = _limpio(c.get("telefono"))
                    # ⚠️ Verifica estos nombres de campo con la respuesta real de /contacts/provider/{id}
                    nombre = _limpio(c.get("nombre") or c.get("nombreContacto"))
                    cargo = _limpio(c.get("cargo") or c.get("tipo"))
                    key = _telefono_key(tel) or f"id{c.get('id')}"
                    cur.execute(
                        """
                        INSERT INTO proveedor_contactos
                            (proveedor_id, erp_contacto_id, nombre, cargo, telefono, telefono_key, email, origen)
                        VALUES (%s,%s,%s,%s,%s,%s,%s,'erp')
                        ON DUPLICATE KEY UPDATE
                            erp_contacto_id=VALUES(erp_contacto_id), nombre=VALUES(nombre),
                            cargo=VALUES(cargo), telefono=VALUES(telefono), email=VALUES(email)
                        """,
                        (mapa[erp_id], c.get("id"), nombre, cargo, tel, key, _limpio(c.get("email"))),
                    )
                    guardados += 1
        conn.commit()
    finally:
        conn.close()
    return {"proveedores": len(mapa), "contactos": guardados}


# ============================================================
# Historial: proveedor -> OP -> productos -> venta
# (marca / categoría / catálogo / zona de entrega)
# ============================================================
# Si el diagnóstico (/api/proveedores/historial/muestra) muestra otros
# nombres de campo, solo agrégalos a estas 3 listas.
CLAVES_MARCA = ("marca", "marcaProducto", "marcaNombre", "brand")
CLAVES_CATEGORIA = ("categoria", "categoriaProducto", "descripcionCortaProducto", "descripcionCorta")
CLAVES_CATALOGO = ("catalogoEmpresa", "catalogo", "catalogoNombre")

# ------------------------------------------------------------------
# Categorías por diccionario (misma lógica que claveDiccionarioDeTexto
# del frontend). El ERP no trae categoría, se calcula desde la descripción.
# ------------------------------------------------------------------
CLAVES_DICCIONARIO = [
    "ESCOBILLONES", "LAVAVAJILLAS", "SUAVIZANTES_DE_ROPA", "DETERGENTES",
    "REMOVEDORES_DE_SARRO", "DESINFECTANTES", "DESENGRASANTES", "ESPONJAS_Y_FIBRAS",
    "SILICONA", "TINAS_Y_BATEAS", "TACHOS_BUZONES_Y_RECOLECTORES", "CERAS", "TOALLAS",
    "ATRAPA_POLVO", "MOPAS_Y_TRAPEADORES", "ALCOHOL_ETILICO_GEL", "CEPILLO_DENTAL",
    "LIMPIADORES", "RECOGEDORES", "AMBIENTADORES_Y_PASTILLAS", "JABON_HIGIENE_MANOS",
    "PAPEL_HIGIENICO", "PAPEL_TOALLA", "PANOS_Y_BAYETAS", "PASTA_DENTAL",
    "PULVERIZADORES_Y_ATOMIZADORES", "CARRITOS_PARA_LIMPIEZA", "JALADORES_DE_AGUA",
    "HIPOCLORITO_DE_SODIO", "BASTONES_Y_MANGOS", "CEPILLOS_Y_ESCOBILLAS", "ESCOBAS",
    "TUBO", "TUBOS_INST_ELECTRICAS", "REDUCCION", "TEE", "TUBOS_INST_SANITARIAS",
    "CODO", "PEGAMENTO_TUBERIAS", "TAPON", "YEE", "UNION", "PINTURA_VIAL",
    "PINTURA_ARQUITECTONICA", "BASE", "BIDON", "BALDE", "VASO", "PLATO",
    "PLANCHA_PANEL_DRYWALL", "COLCHON", "CALAMINA_COBERTURA", "TABLEROS_MADERA",
    "CAMA_METAL_2_NIVELES", "ARROZ_PILADO", "ACEITE_VEGETAL", "AZUCAR", "LENTEJA", "FRIJOL",
    "RASTRILLO_DE_METAL", "AZADON", "NAVAJA_DE_INJERTAR", "LIMA_DE_AFILAR",
    "MACHETE_CON_MANGO", "SERRUCHO_DE_PODA", "TIJERA_DE_PODAR", "HACHA", "HOZ",
]
_FILLER = {"DE", "Y", "PARA", "DEL", "LA", "EL", "LOS", "LAS", "CON", "SIN", "A"}


def _norm_texto_cat(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).upper()
    return re.sub(r"[^A-Z0-9]+", " ", s).strip()


def _raiz(palabra: str) -> str:
    b = palabra
    if len(b) > 4 and b.endswith("ES"):
        b = b[:-2]
    elif len(b) > 3 and b.endswith("S"):
        b = b[:-1]
    return b[:6] if len(b) > 6 else b


def _raices_de_clave(clave: str) -> list:
    return [_raiz(w) for w in clave.split("_") if w and w not in _FILLER]


# Más específicas primero (más raíces, luego más largas), igual que en el frontend
_CLAVES_ORDENADAS = sorted(
    [(c, _raices_de_clave(c)) for c in CLAVES_DICCIONARIO if _raices_de_clave(c)],
    key=lambda x: (-len(x[1]), -len("".join(x[1]))),
)


def categoria_de_descripcion(descripcion) -> Optional[str]:
    """'CEPILLO DENTAL PARA ADULTO: ...' -> 'Cepillo Dental'. None si no calza."""
    if not descripcion:
        return None
    corta = str(descripcion).split(":")[0].strip()
    palabras = _norm_texto_cat(corta).split()
    if not palabras:
        return None
    for clave, raices in _CLAVES_ORDENADAS:
        if all(any(p.startswith(r) for p in palabras) for r in raices):
            return " ".join(w.capitalize() for w in clave.split("_"))
    return None


def _texto(v) -> Optional[str]:
    """Acepta string o dict ({nombre: ...}) y devuelve texto limpio."""
    if v is None:
        return None
    if isinstance(v, dict):
        for k in ("nombre", "name", "descripcion", "razonSocial", "label"):
            if v.get(k):
                return _limpio(v.get(k))
        return None
    return _limpio(v)


def _primero(d, claves) -> Optional[str]:
    if not isinstance(d, dict):
        return None
    for k in claves:
        t = _texto(d.get(k))
        if t:
            return t
    return None


def _ops_de_venta(venta: dict):
    """Devuelve (venta_id, lista_de_ops | None). La OP embebida en la venta es
    un resumen SIN proveedorId, así que solo se usa si trae el proveedor;
    si no, se pide la OP completa al ERP."""
    vid = venta.get("id")

    # Ventas sin OPs: no gastar un request
    if venta.get("nOps") == 0:
        return vid, []

    ops = venta.get("ordenesProveedor") or venta.get("ordenesProveedores")
    if (
        isinstance(ops, list) and ops
        and all(isinstance(o, dict) and "productos" in o and ("proveedorId" in o or "proveedor" in o) for o in ops)
    ):
        return vid, ops
    try:
        r = erp_session.session.get(f"{ERP_API_BASE}/ordenes-proveedores/{vid}/op", timeout=20)
        r.raise_for_status()
        j = r.json()
        return vid, (j if isinstance(j, list) else (j.get("data") or []))
    except Exception as e:
        logger.warning(f"historial: OPs de la venta {vid} fallaron: {e}")
        return vid, None


import threading

_lock_hist = threading.Lock()
_estado_hist = {
    "corriendo": False, "fase": "", "total": 0, "hechas": 0,
    "ops": 0, "filas": 0, "sin_proveedor": 0, "fallidas": 0,
    "error": None, "inicio": None, "fin": None,
}


def _guardar_ops_venta(cur, venta: dict, ops: list, mapa: dict, ahora):
    """Inserta las filas de historial de UNA venta. Devuelve (filas, ops_leidas, sin_proveedor)."""
    filas = ops_leidas = sin_proveedor = 0
    vid = venta["id"]
    prods_venta = {str(p.get("codigo") or "").strip(): p for p in (venta.get("productos") or [])}
    catalogo = _primero(venta, CLAVES_CATALOGO)
    dep = _limpio(venta.get("departamentoEntrega"))
    prov = _limpio(venta.get("provinciaEntrega"))
    dist = _limpio(venta.get("distritoEntrega"))

    for op in ops:
        op_id = op.get("id")
        prov_erp = op.get("proveedorId") or (op.get("proveedor") or {}).get("id")
        pid = mapa.get(prov_erp)
        if not op_id or not pid:
            sin_proveedor += 1
            continue
        ops_leidas += 1

        cur.execute("DELETE FROM proveedor_historial WHERE op_id = %s", (op_id,))
        for p in (op.get("productos") or [{}]):
            codigo = str(p.get("codigo") or "").strip()
            pv = prods_venta.get(codigo, {})
            marca = _primero(p, CLAVES_MARCA) or _primero(pv, CLAVES_MARCA)
            desc = (p.get("descripcion") or pv.get("descripcion") or "")[:500] or None
            categoria = (
                _primero(p, CLAVES_CATEGORIA)
                or _primero(pv, CLAVES_CATEGORIA)
                or categoria_de_descripcion(pv.get("descripcion") or p.get("descripcion"))
            )
            cur.execute(
                """
                INSERT IGNORE INTO proveedor_historial
                    (proveedor_id, op_id, orden_compra_id, numero_ocam, producto_codigo,
                     producto_descripcion, marca, marca_norm, categoria, categoria_norm,
                     catalogo, catalogo_norm,
                     entrega_departamento, entrega_provincia, entrega_distrito,
                     entrega_departamento_norm, entrega_provincia_norm, entrega_distrito_norm,
                     sincronizado_en)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    pid, op_id, vid, _limpio(venta.get("numeroOcam")), codigo[:80], desc,
                    marca, norm(marca), (categoria[:255] if categoria else None), norm(categoria),
                    catalogo, norm(catalogo),
                    dep, prov, dist, norm(dep), norm(prov), norm(dist),
                    ahora,
                ),
            )
            filas += 1
    return filas, ops_leidas, sin_proveedor


def sincronizar_historial_erp(workers: int = 3, lote: int = 40) -> dict:
    """Procesa las ventas por LOTES y hace commit en cada lote, así el
    historial se va llenando en vivo y no se pierde si el proceso muere."""
    with _lock_hist:
        if _estado_hist["corriendo"]:
            return {"detalle": "ya hay una sincronización corriendo"}
        _estado_hist.update(
            corriendo=True, fase="leyendo ventas del ERP", total=0, hechas=0, ops=0,
            filas=0, sin_proveedor=0, fallidas=0, error=None,
            inicio=datetime.now().isoformat(), fin=None,
        )
    try:
        if not erp_session.autenticado:
            raise RuntimeError("Sesión ERP no activa")

        ventas = [v for v in erp_session.obtener_todas_ventas(forzar=True)["ventas"] if v.get("id")]
        ventas_por_id = {v["id"]: v for v in ventas}
        _estado_hist.update(total=len(ventas), fase="leyendo OPs")
        logger.info(f"historial: {len(ventas)} ventas por procesar")

        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id, erp_id FROM proveedores WHERE erp_id IS NOT NULL")
                mapa = {f["erp_id"]: f["id"] for f in cur.fetchall()}
        finally:
            conn.close()

        for i in range(0, len(ventas), lote):
            trozo = ventas[i:i + lote]
            with ThreadPoolExecutor(max_workers=workers) as pool:
                resultados = list(pool.map(_ops_de_venta, trozo))

            ahora = datetime.now()
            conn = get_conn()
            try:
                with conn.cursor() as cur:
                    for vid, ops in resultados:
                        if ops is None:
                            _estado_hist["fallidas"] += 1
                            continue
                        if not ops:
                            continue
                        f, o, s = _guardar_ops_venta(cur, ventas_por_id[vid], ops, mapa, ahora)
                        _estado_hist["filas"] += f
                        _estado_hist["ops"] += o
                        _estado_hist["sin_proveedor"] += s
                conn.commit()          # <- commit por lote
            finally:
                conn.close()

            _estado_hist["hechas"] = min(i + lote, len(ventas))
            logger.info(f"historial: {_estado_hist['hechas']}/{len(ventas)} ventas, {_estado_hist['filas']} filas")

        _estado_hist["fase"] = "terminado"
    except Exception as e:
        logger.exception("historial: falló la sincronización")
        _estado_hist["error"] = str(e)
        _estado_hist["fase"] = "error"
    finally:
        _estado_hist["corriendo"] = False
        _estado_hist["fin"] = datetime.now().isoformat()
    return dict(_estado_hist)


@router.get("/historial/estado")
def estado_historial():
    return _estado_hist


def registrar_contacto_nexus(erp_proveedor_id: int, telefono: Optional[str], nombre: Optional[str] = None,
                             registrado_por: Optional[str] = None):
    """Se llama desde op_seguimiento.rellenar_producto_de_orden: guarda el
    'Teléfono proveedor' que escribió el usuario de Nexus como contacto
    origen='nexus' (si ese número ya existe para el proveedor, no duplica)."""
    key = _telefono_key(telefono)
    if not key:
        return
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM proveedores WHERE erp_id = %s", (erp_proveedor_id,))
            prov = cur.fetchone()
            if not prov:
                return
            cur.execute(
                "SELECT id FROM proveedor_contactos WHERE proveedor_id = %s AND telefono_key = %s LIMIT 1",
                (prov["id"], key),
            )
            if cur.fetchone():
                return
            cur.execute(
                """
                INSERT INTO proveedor_contactos (proveedor_id, nombre, telefono, telefono_key, origen, registrado_por)
                VALUES (%s,%s,%s,%s,'nexus',%s)
                """,
                (prov["id"], nombre, telefono.strip(), key, registrado_por),
            )
        conn.commit()
    finally:
        conn.close()


# ============================================================
# API
# ============================================================
class EtiquetaIn(BaseModel):
    tipo: str   # marca | categoria | catalogo
    valor: str


@router.post("/sync")
def sync_erp(background: BackgroundTasks, con_contactos: bool = True):
    try:
        res = sincronizar_proveedores_erp()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if con_contactos:
        background.add_task(sincronizar_contactos_erp)  # ~280 requests, va en segundo plano
    return {**res, "contactos": "sincronizando en segundo plano" if con_contactos else "omitido"}


@router.post("/historial/sync")
def sync_historial(background: BackgroundTasks):
    if not erp_session.autenticado:
        raise HTTPException(status_code=409, detail="Sesión ERP no activa")
    if _estado_hist["corriendo"]:
        return {"estado": "ya está corriendo", **_estado_hist}
    background.add_task(sincronizar_historial_erp)
    return {"estado": "iniciado en segundo plano"}


@router.get("/historial/resumen")
def resumen_historial():
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) AS filas, COUNT(DISTINCT op_id) AS ops, COUNT(DISTINCT proveedor_id) AS proveedores,
                       SUM(marca IS NOT NULL) AS con_marca, SUM(categoria IS NOT NULL) AS con_categoria,
                       SUM(catalogo IS NOT NULL) AS con_catalogo
                FROM proveedor_historial
                """
            )
            return cur.fetchone()
    finally:
        conn.close()


@router.get("/historial/muestra")
def muestra_historial():
    """DIAGNÓSTICO: devuelve los campos reales de una venta con OP, para ver
    cómo se llaman marca / categoría / catálogo en el ERP."""
    if not erp_session.autenticado:
        raise HTTPException(status_code=409, detail="Sesión ERP no activa")
    ventas = erp_session.obtener_todas_ventas()["ventas"]
    for v in ventas[:40]:
        vid, ops = _ops_de_venta(v)
        if ops:
            op = ops[0]
            return {
                "venta_id": vid,
                "venta_keys": sorted(v.keys()),
                "catalogoEmpresa": v.get("catalogoEmpresa"),
                "zona": [v.get("departamentoEntrega"), v.get("provinciaEntrega"), v.get("distritoEntrega")],
                "producto_de_venta": (v.get("productos") or [None])[0],
                "op_keys": sorted(op.keys()),
                "producto_de_op": (op.get("productos") or [None])[0],
                "proveedor_de_op": op.get("proveedor"),
            }
    return {"detail": "No encontré ventas con OP en las primeras 40"}


@router.get("/filtros")
def filtros(
    departamento: Optional[str] = None,
    provincia: Optional[str] = None,
    zona_departamento: Optional[str] = None,
    zona_provincia: Optional[str] = None,
):
    """Valores para los dropdowns. Departamento -> provincia -> distrito en cascada."""
    dep, prov = norm(departamento), norm(provincia)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT departamento_norm AS v FROM proveedores WHERE activo=1 AND departamento_norm IS NOT NULL ORDER BY v")
            departamentos = [f["v"] for f in cur.fetchall()]

            q, p = "SELECT DISTINCT provincia_norm AS v FROM proveedores WHERE activo=1 AND provincia_norm IS NOT NULL", []
            if dep:
                q += " AND departamento_norm=%s"; p.append(dep)
            cur.execute(q + " ORDER BY v", tuple(p))
            provincias = [f["v"] for f in cur.fetchall()]

            q, p = "SELECT DISTINCT distrito_norm AS v FROM proveedores WHERE activo=1 AND distrito_norm IS NOT NULL", []
            if dep:
                q += " AND departamento_norm=%s"; p.append(dep)
            if prov:
                q += " AND provincia_norm=%s"; p.append(prov)
            cur.execute(q + " ORDER BY v", tuple(p))
            distritos = [f["v"] for f in cur.fetchall()]

            out = {"departamentos": departamentos, "provincias": provincias, "distritos": distritos}

            # marcas / categorías / catálogos = los del historial de OPs + las etiquetas manuales
            for tipo, clave in (("marca", "marcas"), ("categoria", "categorias"), ("catalogo", "catalogos")):
                cur.execute(
                    f"""
                    SELECT valor FROM (
                        SELECT DISTINCT {tipo} AS valor FROM proveedor_historial WHERE {tipo} IS NOT NULL
                        UNION
                        SELECT DISTINCT valor FROM proveedor_etiquetas WHERE tipo=%s
                    ) t ORDER BY valor
                    """,
                    (tipo,),
                )
                out[clave] = [f["valor"] for f in cur.fetchall()]

            # zonas de ENTREGA (de las OPs), en cascada
            zdep, zprov = norm(zona_departamento), norm(zona_provincia)
            cur.execute("SELECT DISTINCT entrega_departamento_norm AS v FROM proveedor_historial WHERE entrega_departamento_norm IS NOT NULL ORDER BY v")
            out["zona_departamentos"] = [f["v"] for f in cur.fetchall()]

            q, p = "SELECT DISTINCT entrega_provincia_norm AS v FROM proveedor_historial WHERE entrega_provincia_norm IS NOT NULL", []
            if zdep:
                q += " AND entrega_departamento_norm=%s"; p.append(zdep)
            cur.execute(q + " ORDER BY v", tuple(p))
            out["zona_provincias"] = [f["v"] for f in cur.fetchall()]

            q, p = "SELECT DISTINCT entrega_distrito_norm AS v FROM proveedor_historial WHERE entrega_distrito_norm IS NOT NULL", []
            if zdep:
                q += " AND entrega_departamento_norm=%s"; p.append(zdep)
            if zprov:
                q += " AND entrega_provincia_norm=%s"; p.append(zprov)
            cur.execute(q + " ORDER BY v", tuple(p))
            out["zona_distritos"] = [f["v"] for f in cur.fetchall()]
            return out
    finally:
        conn.close()


@router.get("")
def buscar_proveedores(
    q: Optional[str] = None,
    departamento: Optional[str] = None,      # dónde ESTÁ el proveedor
    provincia: Optional[str] = None,
    distrito: Optional[str] = None,
    marca: Optional[str] = None,             # lo que YA vendió (historial de OPs)
    categoria: Optional[str] = None,
    catalogo: Optional[str] = None,
    zona_departamento: Optional[str] = None, # a dónde YA entregó
    zona_provincia: Optional[str] = None,
    zona_distrito: Optional[str] = None,
    activo: Optional[bool] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
):
    where, params = ["1=1"], []

    if activo is not None:
        where.append("p.activo = %s"); params.append(1 if activo else 0)

    if q and q.strip():
        qn, dq = norm(q), _telefono_key(q)
        partes = ["p.razon_social_norm LIKE %s", "p.ruc LIKE %s",
                  "EXISTS (SELECT 1 FROM proveedor_contactos c WHERE c.proveedor_id=p.id AND c.nombre LIKE %s)"]
        params += [f"%{qn}%", f"%{q.strip()}%", f"%{q.strip()}%"]
        if len(dq) >= 4:
            partes.append("EXISTS (SELECT 1 FROM proveedor_contactos c WHERE c.proveedor_id=p.id AND c.telefono_key LIKE %s)")
            params.append(f"%{dq}%")
        where.append("(" + " OR ".join(partes) + ")")

    # ubicación del proveedor
    for col, val in (("departamento_norm", departamento), ("provincia_norm", provincia), ("distrito_norm", distrito)):
        if val and norm(val):
            where.append(f"p.{col} = %s"); params.append(norm(val))

    # historial de OPs
    attrs = [("marca", marca), ("categoria", categoria), ("catalogo", catalogo)]
    zonas = [("entrega_departamento", zona_departamento), ("entrega_provincia", zona_provincia), ("entrega_distrito", zona_distrito)]
    hay_zona = any(v and norm(v) for _, v in zonas)

    if hay_zona:
        # Todo en la MISMA fila del historial: "marca X hacia Arequipa" = la misma OP
        h_cond, h_par = [], []
        for col, val in attrs:
            if val and norm(val):
                h_cond.append(f"h.{col}_norm LIKE %s"); h_par.append(f"%{norm(val)}%")
        for col, val in zonas:
            if val and norm(val):
                h_cond.append(f"h.{col}_norm = %s"); h_par.append(norm(val))
        where.append("EXISTS (SELECT 1 FROM proveedor_historial h WHERE h.proveedor_id=p.id AND " + " AND ".join(h_cond) + ")")
        params += h_par
    else:
        # Sin zona: historial de OPs O etiqueta manual, por cada atributo
        for col, val in attrs:
            if val and norm(val):
                where.append(
                    f"(EXISTS (SELECT 1 FROM proveedor_historial h WHERE h.proveedor_id=p.id AND h.{col}_norm LIKE %s)"
                    " OR EXISTS (SELECT 1 FROM proveedor_etiquetas e WHERE e.proveedor_id=p.id AND e.tipo=%s AND e.valor_norm LIKE %s))"
                )
                params += [f"%{norm(val)}%", col, f"%{norm(val)}%"]

    where_sql = " AND ".join(where)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) AS total FROM proveedores p WHERE {where_sql}", tuple(params))
            total = cur.fetchone()["total"]

            cur.execute(
                f"SELECT p.* FROM proveedores p WHERE {where_sql} ORDER BY p.activo DESC, p.razon_social_norm LIMIT %s OFFSET %s",
                tuple(params + [limit, (page - 1) * limit]),
            )
            items = cur.fetchall()

            ids = [i["id"] for i in items]
            contactos, etiquetas, historial = {}, {}, {}
            if ids:
                fmt = ",".join(["%s"] * len(ids))
                cur.execute(f"SELECT * FROM proveedor_contactos WHERE proveedor_id IN ({fmt}) ORDER BY origen, id", tuple(ids))
                for c in cur.fetchall():
                    contactos.setdefault(c["proveedor_id"], []).append(c)
                cur.execute(f"SELECT * FROM proveedor_etiquetas WHERE proveedor_id IN ({fmt}) ORDER BY tipo, valor", tuple(ids))
                for e in cur.fetchall():
                    etiquetas.setdefault(e["proveedor_id"], []).append(e)
                cur.execute(
                    f"""
                    SELECT proveedor_id, COUNT(DISTINCT op_id) AS ops,
                           GROUP_CONCAT(DISTINCT marca SEPARATOR '|') AS marcas,
                           GROUP_CONCAT(DISTINCT categoria SEPARATOR '|') AS categorias,
                           GROUP_CONCAT(DISTINCT catalogo SEPARATOR '|') AS catalogos,
                           GROUP_CONCAT(DISTINCT entrega_departamento SEPARATOR '|') AS zonas
                    FROM proveedor_historial WHERE proveedor_id IN ({fmt}) GROUP BY proveedor_id
                    """,
                    tuple(ids),
                )
                for h in cur.fetchall():
                    historial[h["proveedor_id"]] = {
                        "ops": h["ops"],
                        "marcas": [x for x in (h["marcas"] or "").split("|") if x],
                        "categorias": [x for x in (h["categorias"] or "").split("|") if x],
                        "catalogos": [x for x in (h["catalogos"] or "").split("|") if x],
                        "zonas": [x for x in (h["zonas"] or "").split("|") if x],
                    }
            for i in items:
                i["contactos"] = contactos.get(i["id"], [])
                i["etiquetas"] = etiquetas.get(i["id"], [])
                i["historial"] = historial.get(i["id"], {"ops": 0, "marcas": [], "categorias": [], "catalogos": [], "zonas": []})
    finally:
        conn.close()
    return {"total": total, "page": page, "limit": limit, "items": items}


@router.get("/{proveedor_id}")
def detalle_proveedor(proveedor_id: int):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM proveedores WHERE id=%s", (proveedor_id,))
            p = cur.fetchone()
            if not p:
                raise HTTPException(status_code=404, detail="Proveedor no encontrado")
            cur.execute("SELECT * FROM proveedor_contactos WHERE proveedor_id=%s ORDER BY origen, id", (proveedor_id,))
            p["contactos"] = cur.fetchall()
            cur.execute("SELECT * FROM proveedor_etiquetas WHERE proveedor_id=%s ORDER BY tipo, valor", (proveedor_id,))
            p["etiquetas"] = cur.fetchall()
            return p
    finally:
        conn.close()


@router.post("/{proveedor_id}/etiquetas")
def agregar_etiqueta(proveedor_id: int, body: EtiquetaIn):
    if body.tipo not in ("marca", "categoria", "catalogo"):
        raise HTTPException(status_code=400, detail="tipo debe ser marca, categoria o catalogo")
    valor = body.valor.strip()
    if not valor:
        raise HTTPException(status_code=400, detail="valor vacío")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT IGNORE INTO proveedor_etiquetas (proveedor_id, tipo, valor, valor_norm) VALUES (%s,%s,%s,%s)",
                (proveedor_id, body.tipo, valor, norm(valor)),
            )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


@router.delete("/etiquetas/{etiqueta_id}")
def quitar_etiqueta(etiqueta_id: int):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM proveedor_etiquetas WHERE id=%s", (etiqueta_id,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}