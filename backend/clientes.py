"""
Helbot - clientes.py
---------------------
Módulo de CLIENTES de Nexus (espejo del ERP, igual que proveedores.py).

- Tabla `clientes`           (GET {ERP_API_BASE}/clients)
- Tabla `cliente_contactos`  (GET {ERP_API_BASE}/contacts/client/{id})
- Buscador con filtros (texto, departamento, provincia, distrito, estado,
  con/sin contactos) y cantidad de contactos por cliente.
- Endpoint de contactos de un cliente con TODA la información.

Se monta en main.py con:
    from clientes import router as clientes_router, crear_tablas as crear_tablas_clientes
    app.include_router(clientes_router)
    crear_tablas_clientes()   # una vez, en el startup
"""

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from typing import Optional

import io

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import Response
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

from erp_login import erp_session, ERP_API_BASE
from db import get_conn
from proveedores import norm, _limpio, _telefono_key, _dt  # mismos helpers que proveedores

logger = logging.getLogger("helbot.clientes")
router = APIRouter(prefix="/api/clientes", tags=["clientes"])

ERP_CLIENTES_URL = f"{ERP_API_BASE}/clients"


# ============================================================
# Esquema MySQL
# ============================================================
DDL = [
    """
    CREATE TABLE IF NOT EXISTS clientes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        erp_id INT NOT NULL,
        razon_social VARCHAR(255) NOT NULL,
        razon_social_norm VARCHAR(255) NOT NULL,
        ruc VARCHAR(100) NULL,
        codigo_unidad_ejecutora VARCHAR(255) NULL,
        sede VARCHAR(255) NULL,
        direccion VARCHAR(500) NULL,
        departamento VARCHAR(100) NULL,
        provincia VARCHAR(100) NULL,
        distrito VARCHAR(100) NULL,
        departamento_norm VARCHAR(100) NULL,
        provincia_norm VARCHAR(100) NULL,
        distrito_norm VARCHAR(100) NULL,
        telefono VARCHAR(50) NULL,
        email VARCHAR(150) NULL,
        activo TINYINT(1) NOT NULL DEFAULT 1,
        promedio_cobranza DECIMAL(14,2) NULL,
        erp_creado_en DATETIME NULL,
        erp_actualizado_en DATETIME NULL,
        sincronizado_en DATETIME NULL,
        creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_cliente_erp (erp_id),
        KEY idx_cli_ruc (ruc),
        KEY idx_cli_nombre (razon_social_norm),
        KEY idx_cli_ue (codigo_unidad_ejecutora),
        KEY idx_cli_ubic (departamento_norm, provincia_norm, distrito_norm)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """,
    """
    CREATE TABLE IF NOT EXISTS cliente_contactos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        cliente_id INT NOT NULL,
        erp_contacto_id INT NOT NULL,
        nombre VARCHAR(200) NULL,
        cargo VARCHAR(150) NULL,
        telefono VARCHAR(60) NULL,
        telefono_key VARCHAR(30) NOT NULL DEFAULT '',
        email VARCHAR(150) NULL,
        tipo VARCHAR(30) NULL,
        cumpleanos DATETIME NULL,
        nota TEXT NULL,
        usuario_destacado VARCHAR(150) NULL,
        erp_creado_en DATETIME NULL,
        erp_actualizado_en DATETIME NULL,
        sincronizado_en DATETIME NULL,
        UNIQUE KEY uq_cli_contacto (cliente_id, erp_contacto_id),
        KEY idx_cli_contacto_tel (telefono_key),
        CONSTRAINT fk_cli_contacto FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE CASCADE
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
# Utilidades
# ============================================================
def _num(v) -> Optional[float]:
    try:
        return None if v is None else float(v)
    except (TypeError, ValueError):
        return None


def _cortar(valor, n: int):
    """Recorta textos al largo de la columna para que un dato raro del ERP no rompa el sync."""
    if valor is None:
        return None
    s = str(valor)
    return s[:n]


def _pedir_lista(url: str) -> list:
    """GET al ERP. Soporta respuesta como lista pelada o como
    {data: [...], meta: {totalPages, pageSize}} (con paginación)."""
    r = erp_session.session.get(url, timeout=60)
    r.raise_for_status()
    j = r.json()
    if isinstance(j, list):
        return j
    items = list(j.get("data") or j.get("items") or [])
    meta = j.get("meta") or {}
    total_pages = int(meta.get("totalPages") or 1)
    size = meta.get("pageSize")
    # ⚠️ Si el ERP usa otros nombres de parámetros de paginación, ajústalos aquí.
    for p in range(2, total_pages + 1):
        rp = erp_session.session.get(url, params={"page": p, "pageSize": size}, timeout=60)
        rp.raise_for_status()
        jp = rp.json()
        items += list(jp.get("data") or jp.get("items") or []) if isinstance(jp, dict) else jp
    return items


# ============================================================
# Sincronización con el ERP
# ============================================================
def sincronizar_clientes_erp() -> dict:
    """GET /clients del ERP -> upsert por erp_id."""
    if not erp_session.autenticado:
        raise RuntimeError("Sesión ERP no activa")

    lista = _pedir_lista(ERP_CLIENTES_URL)
    ahora = datetime.now()
    nuevos = 0
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for c in lista:
                if not c.get("id") or not c.get("razonSocial"):
                    continue
                dep, prov, dist = _limpio(c.get("departamento")), _limpio(c.get("provincia")), _limpio(c.get("distrito"))
                cur.execute(
                    """
                    INSERT INTO clientes
                        (erp_id, razon_social, razon_social_norm, ruc, codigo_unidad_ejecutora, sede, direccion,
                         departamento, provincia, distrito,
                         departamento_norm, provincia_norm, distrito_norm,
                         telefono, email, activo, promedio_cobranza,
                         erp_creado_en, erp_actualizado_en, sincronizado_en)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON DUPLICATE KEY UPDATE
                        razon_social=VALUES(razon_social), razon_social_norm=VALUES(razon_social_norm),
                        ruc=VALUES(ruc), codigo_unidad_ejecutora=VALUES(codigo_unidad_ejecutora),
                        sede=VALUES(sede), direccion=VALUES(direccion),
                        departamento=VALUES(departamento), provincia=VALUES(provincia), distrito=VALUES(distrito),
                        departamento_norm=VALUES(departamento_norm), provincia_norm=VALUES(provincia_norm),
                        distrito_norm=VALUES(distrito_norm),
                        telefono=VALUES(telefono), email=VALUES(email), activo=VALUES(activo),
                        promedio_cobranza=VALUES(promedio_cobranza),
                        erp_creado_en=VALUES(erp_creado_en), erp_actualizado_en=VALUES(erp_actualizado_en),
                        sincronizado_en=VALUES(sincronizado_en)
                    """,
                    (
                        c["id"], _cortar(c["razonSocial"].strip(), 255), _cortar(norm(c["razonSocial"]), 255),
                        _cortar(_limpio(c.get("ruc")), 100), _cortar(_limpio(c.get("codigoUnidadEjecutora")), 255),
                        _cortar(_limpio(c.get("sede")), 255), _cortar(_limpio(c.get("direccion")), 500),
                        _cortar(dep, 100), _cortar(prov, 100), _cortar(dist, 100),
                        _cortar(norm(dep), 100), _cortar(norm(prov), 100), _cortar(norm(dist), 100),
                        _cortar(_limpio(c.get("telefono")), 255), _cortar(_limpio(c.get("email")), 255),
                        1 if c.get("estado") else 0, _num(c.get("promedioCobranza")),
                        _dt(c.get("createdAt")), _dt(c.get("updatedAt")), ahora,
                    ),
                )
                if cur.rowcount == 1:
                    nuevos += 1
        conn.commit()
    finally:
        conn.close()

    logger.info(f"sync clientes: {len(lista)} leídos, {nuevos} nuevos")
    return {"leidos": len(lista), "nuevos": nuevos, "actualizados": len(lista) - nuevos}


_lock_contactos = threading.Lock()
_estado_sync = {"corriendo": False, "total": 0, "hechos": 0, "contactos": 0, "fallidos": 0,
                "inicio": None, "fin": None, "error": None}


def _traer_contactos(erp_id: int):
    try:
        lista = _pedir_lista(f"{ERP_API_BASE}/contacts/client/{erp_id}")
        return erp_id, lista
    except Exception as e:
        logger.warning(f"contactos cliente {erp_id} falló: {e}")
        return erp_id, None
    finally:
        _estado_sync["hechos"] += 1


def sincronizar_contactos_erp(erp_ids: Optional[list] = None, workers: int = 4) -> dict:
    """Trae los contactos de cada cliente y los guarda completos. Si un
    contacto ya no existe en el ERP, se borra de Nexus."""
    if not erp_session.autenticado:
        raise RuntimeError("Sesión ERP no activa")

    completo = not erp_ids
    if completo:
        with _lock_contactos:
            if _estado_sync["corriendo"]:
                return {"detalle": "ya hay una sincronización de contactos corriendo"}
            _estado_sync.update(corriendo=True, total=0, hechos=0, contactos=0, fallidos=0,
                                inicio=datetime.now().isoformat(), fin=None, error=None)
    try:
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                if erp_ids:
                    fmt = ",".join(["%s"] * len(erp_ids))
                    cur.execute(f"SELECT id, erp_id FROM clientes WHERE erp_id IN ({fmt})", tuple(erp_ids))
                else:
                    cur.execute("SELECT id, erp_id FROM clientes")
                mapa = {f["erp_id"]: f["id"] for f in cur.fetchall()}
        finally:
            conn.close()

        if completo:
            _estado_sync["total"] = len(mapa)

        with ThreadPoolExecutor(max_workers=workers) as pool:
            resultados = list(pool.map(_traer_contactos, list(mapa.keys())))

        ahora = datetime.now()
        guardados = 0
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                for erp_id, contactos in resultados:
                    if contactos is None:           # falló la consulta: no tocar lo que ya hay
                        _estado_sync["fallidos"] += 1
                        continue
                    cid = mapa[erp_id]
                    ids_vistos = []
                    for c in contactos:
                        if not c.get("id"):
                            continue
                        ids_vistos.append(c["id"])
                        tel = _limpio(c.get("telefono"))
                        cur.execute(
                            """
                            INSERT INTO cliente_contactos
                                (cliente_id, erp_contacto_id, nombre, cargo, telefono, telefono_key, email,
                                 tipo, cumpleanos, nota, usuario_destacado,
                                 erp_creado_en, erp_actualizado_en, sincronizado_en)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                            ON DUPLICATE KEY UPDATE
                                nombre=VALUES(nombre), cargo=VALUES(cargo), telefono=VALUES(telefono),
                                telefono_key=VALUES(telefono_key), email=VALUES(email), tipo=VALUES(tipo),
                                cumpleanos=VALUES(cumpleanos), nota=VALUES(nota),
                                usuario_destacado=VALUES(usuario_destacado),
                                erp_creado_en=VALUES(erp_creado_en), erp_actualizado_en=VALUES(erp_actualizado_en),
                                sincronizado_en=VALUES(sincronizado_en)
                            """,
                            (
                                cid, c["id"], _cortar(_limpio(c.get("nombre")), 200), _cortar(_limpio(c.get("cargo")), 150),
                                _cortar(tel, 60), _cortar(_telefono_key(tel), 30), _cortar(_limpio(c.get("email")), 150),
                                _cortar(_limpio(c.get("tipo")), 30), _dt(c.get("cumpleanos")), _limpio(c.get("nota")),
                                None if c.get("usuarioDestacado") in (None, "") else str(c.get("usuarioDestacado"))[:150],
                                _dt(c.get("createdAt")), _dt(c.get("updatedAt")), ahora,
                            ),
                        )
                        guardados += 1
                    # borra los que ya no existen en el ERP
                    if ids_vistos:
                        fmt = ",".join(["%s"] * len(ids_vistos))
                        cur.execute(
                            f"DELETE FROM cliente_contactos WHERE cliente_id=%s AND erp_contacto_id NOT IN ({fmt})",
                            (cid, *ids_vistos),
                        )
                    else:
                        cur.execute("DELETE FROM cliente_contactos WHERE cliente_id=%s", (cid,))
            conn.commit()
        finally:
            conn.close()

        if completo:
            _estado_sync["contactos"] = guardados
        return {"clientes": len(mapa), "contactos": guardados}
    except Exception as e:
        logger.exception("sync contactos clientes falló")
        if completo:
            _estado_sync["error"] = str(e)
        raise
    finally:
        if completo:
            _estado_sync["corriendo"] = False
            _estado_sync["fin"] = datetime.now().isoformat()


# ============================================================
# API
# ============================================================
@router.post("/sync")
def sync_erp(background: BackgroundTasks, con_contactos: bool = True):
    try:
        res = sincronizar_clientes_erp()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error sincronizando clientes del ERP: {e}")
    if con_contactos:
        background.add_task(sincronizar_contactos_erp)
    return {**res, "contactos": "sincronizando en segundo plano" if con_contactos else "omitido"}


@router.get("/sync/estado")
def sync_estado():
    return _estado_sync


@router.get("/filtros")
def filtros(departamento: Optional[str] = None, provincia: Optional[str] = None):
    dep, prov = norm(departamento), norm(provincia)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT departamento_norm AS v FROM clientes WHERE departamento_norm IS NOT NULL ORDER BY v")
            departamentos = [f["v"] for f in cur.fetchall()]

            q, p = "SELECT DISTINCT provincia_norm AS v FROM clientes WHERE provincia_norm IS NOT NULL", []
            if dep:
                q += " AND departamento_norm=%s"; p.append(dep)
            cur.execute(q + " ORDER BY v", tuple(p))
            provincias = [f["v"] for f in cur.fetchall()]

            q, p = "SELECT DISTINCT distrito_norm AS v FROM clientes WHERE distrito_norm IS NOT NULL", []
            if dep:
                q += " AND departamento_norm=%s"; p.append(dep)
            if prov:
                q += " AND provincia_norm=%s"; p.append(prov)
            cur.execute(q + " ORDER BY v", tuple(p))
            distritos = [f["v"] for f in cur.fetchall()]
        return {"departamentos": departamentos, "provincias": provincias, "distritos": distritos}
    finally:
        conn.close()


def _where(q, departamento, provincia, distrito, activo, con_contactos):
    where, params = ["1=1"], []

    if activo is not None:
        where.append("c0.activo = %s"); params.append(1 if activo else 0)

    if q and q.strip():
        qn, dq = norm(q), _telefono_key(q)
        partes = [
            "c0.razon_social_norm LIKE %s",
            "c0.ruc LIKE %s",
            "c0.codigo_unidad_ejecutora LIKE %s",
            "EXISTS (SELECT 1 FROM cliente_contactos k WHERE k.cliente_id=c0.id AND (k.nombre LIKE %s OR k.email LIKE %s))",
        ]
        params += [f"%{qn}%", f"%{q.strip()}%", f"%{q.strip()}%", f"%{q.strip()}%", f"%{q.strip()}%"]
        if len(dq) >= 4:
            partes.append("EXISTS (SELECT 1 FROM cliente_contactos k WHERE k.cliente_id=c0.id AND k.telefono_key LIKE %s)")
            params.append(f"%{dq}%")
        where.append("(" + " OR ".join(partes) + ")")

    for col, val in (("departamento_norm", departamento), ("provincia_norm", provincia), ("distrito_norm", distrito)):
        if val and norm(val):
            where.append(f"c0.{col} = %s"); params.append(norm(val))

    if con_contactos is True:
        where.append("EXISTS (SELECT 1 FROM cliente_contactos k WHERE k.cliente_id=c0.id)")
    elif con_contactos is False:
        where.append("NOT EXISTS (SELECT 1 FROM cliente_contactos k WHERE k.cliente_id=c0.id)")

    return " AND ".join(where), params


@router.get("")
def buscar_clientes(
    q: Optional[str] = None,
    departamento: Optional[str] = None,
    provincia: Optional[str] = None,
    distrito: Optional[str] = None,
    activo: Optional[bool] = None,
    con_contactos: Optional[bool] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=200),
):
    where_sql, params = _where(q, departamento, provincia, distrito, activo, con_contactos)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) AS total FROM clientes c0 WHERE {where_sql}", tuple(params))
            total = cur.fetchone()["total"]

            cur.execute(
                f"""
                SELECT c0.*,
                       (SELECT COUNT(*) FROM cliente_contactos k WHERE k.cliente_id = c0.id) AS n_contactos
                FROM clientes c0
                WHERE {where_sql}
                ORDER BY c0.activo DESC, c0.razon_social_norm
                LIMIT %s OFFSET %s
                """,
                tuple(params + [limit, (page - 1) * limit]),
            )
            items = cur.fetchall()
    finally:
        conn.close()
    return {"total": total, "page": page, "limit": limit, "items": items}


@router.get("/exportar/excel")
def exportar_excel(
    q: Optional[str] = None,
    departamento: Optional[str] = None,
    provincia: Optional[str] = None,
    distrito: Optional[str] = None,
    activo: Optional[bool] = None,
    con_contactos: Optional[bool] = None,
):
    """Excel en UNA hoja: una fila por contacto (el cliente se repite en cada fila,
    así el filtro de Excel funciona). Cada cliente lleva un color pastel distinto."""
    where_sql, params = _where(q, departamento, provincia, distrito, activo, con_contactos)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT c0.* FROM clientes c0 WHERE {where_sql} ORDER BY c0.activo DESC, c0.razon_social_norm",
                tuple(params),
            )
            clientes = cur.fetchall()
            if not clientes:
                raise HTTPException(status_code=404, detail="No hay clientes con esos filtros")

            ids = [c["id"] for c in clientes]
            contactos_por = {}
            for i in range(0, len(ids), 500):
                trozo = ids[i:i + 500]
                fmt = ",".join(["%s"] * len(trozo))
                cur.execute(
                    f"SELECT * FROM cliente_contactos WHERE cliente_id IN ({fmt}) "
                    "ORDER BY cliente_id, (usuario_destacado IS NULL), nombre, id",
                    tuple(trozo),
                )
                for k in cur.fetchall():
                    contactos_por.setdefault(k["cliente_id"], []).append(k)
    finally:
        conn.close()

    def fecha(d):
        return d.strftime("%d/%m/%Y") if d else ""

    columnas = [
        ("N°", 6), ("Razón social", 45), ("RUC", 14), ("Cód. U.E.", 12), ("Sede", 18),
        ("Estado", 11), ("Departamento", 16), ("Provincia", 16), ("Distrito", 16), ("Dirección", 42),
        ("Teléfono cliente", 16), ("Email cliente", 30), ("Prom. cobranza", 14), ("N° contactos", 11),
        ("Contacto N°", 10), ("Nombre contacto", 32), ("Cargo", 26), ("Teléfono contacto", 18),
        ("Email contacto", 34), ("Cumpleaños (día/mes)", 14), ("Nota", 36), ("Destacado por", 18),
        ("ID contacto ERP", 12), ("Contacto creado", 14), ("Contacto actualizado", 16),
    ]

    # celeste, menta, crema, lila — se repiten en ciclo, el vecino nunca tiene el mismo color
    colores = ["DCEBFA", "DFF3E3", "FFF4D6", "EBE1F7"]
    linea_cliente = Border(top=Side(style="medium", color="94A3B8"))

    wb = Workbook()
    ws = wb.active
    ws.title = "Clientes"
    ws.append([c[0] for c in columnas])

    verde = PatternFill("solid", fgColor="059669")
    for idx, (_, ancho) in enumerate(columnas, 1):
        ws.column_dimensions[get_column_letter(idx)].width = ancho
        celda = ws.cell(row=1, column=idx)
        celda.font = Font(bold=True, color="FFFFFF")
        celda.fill = verde
        celda.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 32

    for n, cli in enumerate(clientes, 1):
        relleno = PatternFill("solid", fgColor=colores[(n - 1) % len(colores)])
        contactos = contactos_por.get(cli["id"], [])
        base = [
            n, cli["razon_social"], cli["ruc"] or "", cli["codigo_unidad_ejecutora"] or "",
            cli["sede"] or "", "ACTIVO" if cli["activo"] else "INACTIVO",
            cli["departamento"] or "", cli["provincia"] or "", cli["distrito"] or "",
            cli["direccion"] or "", cli["telefono"] or "", cli["email"] or "",
            float(cli["promedio_cobranza"]) if cli["promedio_cobranza"] is not None else "",
            len(contactos),
        ]
        filas = []
        if contactos:
            for j, k in enumerate(contactos, 1):
                filas.append(base + [
                    j, (k["nombre"] or "").strip(), (k["cargo"] or "").strip(), (k["telefono"] or "").strip(),
                    k["email"] or "", k["cumpleanos"].strftime("%d/%m") if k["cumpleanos"] else "",
                    k["nota"] or "", k["usuario_destacado"] or "", k["erp_contacto_id"],
                    fecha(k["erp_creado_en"]), fecha(k["erp_actualizado_en"]),
                ])
        else:
            filas.append(base + [""] * 11)

        for pos, fila in enumerate(filas):
            ws.append(fila)
            for celda in ws[ws.max_row]:
                celda.fill = relleno
                if pos == 0:
                    celda.border = linea_cliente

    ws.freeze_panes = "C2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(columnas))}{ws.max_row}"

    buf = io.BytesIO()
    wb.save(buf)
    nombre = f"clientes_{datetime.now():%Y%m%d_%H%M}.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )


@router.get("/{cliente_id}/contactos")
def contactos_de_cliente(cliente_id: int, refrescar: bool = False):
    """Todos los contactos de un cliente, con toda su información.
    refrescar=true -> primero vuelve a consultarlos al ERP (solo ese cliente)."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM clientes WHERE id=%s", (cliente_id,))
            cliente = cur.fetchone()
    finally:
        conn.close()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")

    if refrescar:
        try:
            sincronizar_contactos_erp([cliente["erp_id"]])
        except RuntimeError as e:
            raise HTTPException(status_code=409, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Error consultando contactos en el ERP: {e}")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM cliente_contactos WHERE cliente_id=%s ORDER BY (usuario_destacado IS NULL), nombre, id",
                (cliente_id,),
            )
            contactos = cur.fetchall()
    finally:
        conn.close()
    return {"cliente": cliente, "total": len(contactos), "contactos": contactos}