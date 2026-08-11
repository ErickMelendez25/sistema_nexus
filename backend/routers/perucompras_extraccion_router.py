from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends, Query
from fastapi.responses import FileResponse
import os
from datetime import datetime
from pydantic import BaseModel
from perucompras_login import perucompras_sesiones
from perucompras_extraccion import obtener_catalogos_mysql
from monitor_publicadas import monitor_de
from auth import obtener_usuario_actual, UsuarioToken
from db import get_conn

router = APIRouter(prefix="/perucompras/extraccion", tags=["perucompras-extraccion"])

_estado = {
    "corriendo": False,
    "catalogo_actual": None,
    "catalogos_completados": 0,
    "total_catalogos": 11,
    "total_filas": 0,
    "iniciado_en": None,
    "terminado_en": None,
    "error": None,
    "run_id": None,
}


def _crear_run(usuario_helbot: str, uid_perucompras: str) -> int:
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO perucompras_extraccion_runs
                    (usuario_helbot, uid_perucompras, iniciado_en, estado)
                VALUES (%s, %s, %s, 'corriendo')
                """,
                (usuario_helbot, uid_perucompras, datetime.now()),
            )
            return cur.lastrowid
    finally:
        conn.close()


def _cerrar_run(run_id: int, estado: str, error: str | None, total_filas: int):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE perucompras_extraccion_runs
                SET terminado_en = %s, estado = %s, error = %s, total_filas = %s
                WHERE id = %s
                """,
                (datetime.now(), estado, error, total_filas, run_id),
            )
    finally:
        conn.close()

def _tarea_extraccion(uid: str, run_id: int):
    pc_session = perucompras_sesiones.sesion(uid)
    m = monitor_de(uid)
    _estado.update({
        "corriendo": True, "catalogo_actual": None, "catalogos_completados": 0,
        "total_filas": 0, "iniciado_en": datetime.now().isoformat(),
        "terminado_en": None, "error": None, "run_id": run_id,
    })
    if m:
        m.pausar()
    try:
        obtener_catalogos_mysql(pc_session.session, progreso=_estado, pc_session_ref=pc_session, run_id=run_id, uid=uid)
        _cerrar_run(run_id, "completado", None, _estado["total_filas"])
    except Exception as e:
        _estado["error"] = str(e)
        _cerrar_run(run_id, "error", str(e), _estado["total_filas"])
    finally:
        if m:
            m.reanudar()
        _estado["corriendo"] = False
        _estado["terminado_en"] = datetime.now().isoformat()


@router.post("/ejecutar")
def ejecutar_extraccion(
    uid: str,
    background_tasks: BackgroundTasks,
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")
    if _estado["corriendo"]:
        return {"ok": True, "detalle": "Ya hay una extracción en curso"}

    usuario_helbot = usuario.nombre_completo or usuario.username
    run_id = _crear_run(usuario_helbot, uid)
    background_tasks.add_task(_tarea_extraccion, uid, run_id)
    return {"ok": True, "detalle": "Extracción iniciada en background", "run_id": run_id}


@router.get("/estado")
def estado_extraccion():
    return _estado


@router.get("/runs")
def listar_runs(
    uid: str = "",
    buscar: str = "",
    estado: str = "",
    desde: str = "",
    hasta: str = "",
    pagina: int = Query(1, ge=1),
    por_pagina: int = Query(10, ge=1, le=100),
):
    """Auditoría: quién extrajo, cuándo, con qué usuario de Perú Compras,
    y el desglose de filas por catálogo en esa corrida — paginado.
    Filtros: uid_perucompras exacto, texto libre (usuario_helbot o
    uid_perucompras), estado de la corrida, y rango de fechas sobre
    iniciado_en."""
    where = ["1=1"]
    params_where: list = []

    if uid:
        where.append("uid_perucompras = %s")
        params_where.append(uid)
    if buscar:
        where.append("(usuario_helbot LIKE %s OR uid_perucompras LIKE %s)")
        params_where.extend([f"%{buscar}%", f"%{buscar}%"])
    if estado:
        where.append("estado = %s")
        params_where.append(estado)
    if desde:
        where.append("iniciado_en >= %s")
        params_where.append(f"{desde} 00:00:00")
    if hasta:
        where.append("iniciado_en <= %s")
        params_where.append(f"{hasta} 23:59:59")

    where_sql = "WHERE " + " AND ".join(where)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT COUNT(*) AS total FROM perucompras_extraccion_runs {where_sql}",
                params_where,
            )
            total = cur.fetchone()["total"]

            offset = (pagina - 1) * por_pagina
            cur.execute(
                f"""
                SELECT id, usuario_helbot, uid_perucompras, iniciado_en, terminado_en,
                       estado, error, total_filas
                FROM perucompras_extraccion_runs
                {where_sql}
                ORDER BY iniciado_en DESC
                LIMIT %s OFFSET %s
                """,
                params_where + [por_pagina, offset],
            )
            runs = cur.fetchall()
            for run in runs:
                cur.execute(
                    """
                    SELECT catalogo, total_filas, nuevos_insertados
                    FROM perucompras_extraccion_runs_detalle
                    WHERE run_id = %s
                    ORDER BY catalogo
                    """,
                    (run["id"],),
                )
                run["detalle"] = cur.fetchall()
                for campo in ("iniciado_en", "terminado_en"):
                    if run.get(campo):
                        run[campo] = run[campo].isoformat()
            return {"total": total, "pagina": pagina, "por_pagina": por_pagina, "runs": runs}
    finally:
        conn.close()


@router.get("/runs/{run_id}/reportes")
def listar_reportes_run(run_id: int, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, tipo, nombre_archivo, creado_en FROM perucompras_reportes_generados WHERE run_id = %s ORDER BY tipo",
                (run_id,),
            )
            filas = cur.fetchall()
            for f in filas:
                if f.get("creado_en"):
                    f["creado_en"] = f["creado_en"].isoformat()
            return {"reportes": filas}
    finally:
        conn.close()


@router.get("/reportes/{reporte_id}/descargar")
def descargar_reporte(reporte_id: int, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT nombre_archivo, ruta_absoluta FROM perucompras_reportes_generados WHERE id = %s",
                (reporte_id,),
            )
            fila = cur.fetchone()
    finally:
        conn.close()
    if not fila or not os.path.exists(fila["ruta_absoluta"]):
        raise HTTPException(404, "Archivo no encontrado")
    return FileResponse(
        fila["ruta_absoluta"],
        filename=fila["nombre_archivo"],
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.get("/catalogos")
def listar_catalogos(uid: str = ""):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            if uid:
                cur.execute("SELECT DISTINCT catalogo FROM perucompras_extraccion WHERE uid_perucompras = %s ORDER BY catalogo", (uid,))
            else:
                cur.execute("SELECT DISTINCT catalogo FROM perucompras_extraccion ORDER BY catalogo")
            return [f["catalogo"] for f in cur.fetchall()]
    finally:
        conn.close()


def _armar_filtros(
    catalogo: str,
    fecha_inicio: str,
    fecha_fin: str,
    marca: str,
    ubicacion: str,
    entidad: str,
    ruc: str,
    estado: str,
    uid: str = "",
) -> tuple[str, list]:
    where = ["catalogo = %s"]
    params: list = [catalogo]
    if uid:
        where.append("uid_perucompras = %s")
        params.append(uid)
    if fecha_inicio:
        where.append("fecha_guardado >= %s")
        params.append(f"{fecha_inicio} 00:00:00")
    if fecha_fin:
        where.append("fecha_guardado <= %s")
        params.append(f"{fecha_fin} 23:59:59")
    if marca:
        where.append("marca LIKE %s")
        params.append(f"%{marca}%")
    if ubicacion:
        where.append("(departamento LIKE %s OR provincia LIKE %s OR distrito LIKE %s)")
        params.extend([f"%{ubicacion}%", f"%{ubicacion}%", f"%{ubicacion}%"])
    if entidad:
        where.append("entidad LIKE %s")
        params.append(f"%{entidad}%")
    if ruc:
        where.append("ruc LIKE %s")
        params.append(f"%{ruc}%")
    if estado:
        where.append("estado = %s")
        params.append(estado)
    return " AND ".join(where), params


@router.get("/datos")
def listar_datos(
    catalogo: str,
    fecha_inicio: str = "",
    fecha_fin: str = "",
    marca: str = "",
    ubicacion: str = "",
    entidad: str = "",
    ruc: str = "",
    estado: str = "",
    uid: str = "",
    pagina: int = Query(1, ge=1),
    por_pagina: int = Query(100, ge=1, le=500),
):
    where_sql, params = _armar_filtros(catalogo, fecha_inicio, fecha_fin, marca, ubicacion, entidad, ruc, estado, uid)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(f"SELECT COUNT(*) AS total FROM perucompras_extraccion WHERE {where_sql}", params)
            total = cur.fetchone()["total"]

            offset = (pagina - 1) * por_pagina
            cur.execute(
                f"""
                SELECT * FROM perucompras_extraccion
                WHERE {where_sql}
                ORDER BY fecha_guardado DESC
                LIMIT %s OFFSET %s
                """,
                params + [por_pagina, offset],
            )
            filas = cur.fetchall()
            for f in filas:
                if f.get("fecha_guardado"):
                    f["fecha_guardado"] = f["fecha_guardado"].isoformat()
            return {"total": total, "pagina": pagina, "por_pagina": por_pagina, "filas": filas}
    finally:
        conn.close()



@router.get("/restringidos")
def listar_restringidos(
    catalogo: str = "",
    motivo: str = "",
    marca: str = "",
    # "pendiente" por defecto: al abrir la tabla, lo primero que ve el
    # usuario son las CANDIDATAS todavía no confirmadas. El frontend
    # manda estado="" explícito para "Todas", o "restringido" para ver
    # el historial de las ya confirmadas.
    estado: str = "pendiente",
    fecha_inicio: str = "",
    fecha_fin: str = "",
    uid: str = "",
    pagina: int = Query(1, ge=1),
    por_pagina: int = Query(100, ge=1, le=500),
):
    """Filas marcadas como restringidas (por semáforo o monto mínimo),
    con el detalle completo de la proforma (JOIN contra
    perucompras_extraccion) para que el frontend no tenga que hacer
    una segunda consulta por fila."""
    where = ["1=1"]
    params: list = []
    if uid:
        where.append("e.uid_perucompras = %s")
        params.append(uid)
    if catalogo:
        where.append("r.catalogo = %s")
        params.append(catalogo)
    if motivo:
        where.append("r.motivo = %s")
        params.append(motivo)
    if estado:
        where.append("r.estado = %s")
        params.append(estado)
    if marca:
        where.append("r.marca LIKE %s")
        params.append(f"%{marca}%")
    if fecha_inicio:
        where.append("r.creado_en >= %s")
        params.append(f"{fecha_inicio} 00:00:00")
    if fecha_fin:
        where.append("r.creado_en <= %s")
        params.append(f"{fecha_fin} 23:59:59")
    where_sql = " AND ".join(where)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM perucompras_restringidos r
                JOIN perucompras_extraccion e ON e.id = r.extraccion_id
                WHERE {where_sql}
                """,
                params,
            )
            total = cur.fetchone()["total"]

            offset = (pagina - 1) * por_pagina
            cur.execute(
                f"""
                SELECT
                    r.id, r.motivo, r.marca AS marca_restringida, r.subtotal AS subtotal_restringido,
                    r.estado AS estado_restriccion, r.restringido_por, r.restringido_en,
                    r.creado_en, r.catalogo,
                    e.requerimiento, e.proforma, e.estado AS estado_proforma, e.color_semaforo, e.procedimiento,
                    e.entidad, e.ruc, e.producto, e.codigo_unico, e.cantidad,
                    e.precio_unitario_base, e.precio_ofertado, e.moneda,
                    e.departamento, e.provincia, e.distrito,
                    e.pdf_producto, e.pdf_requerimiento, e.imagen_producto, e.n_proforma_id
                FROM perucompras_restringidos r
                JOIN perucompras_extraccion e ON e.id = r.extraccion_id
                WHERE {where_sql}
                ORDER BY r.creado_en DESC
                LIMIT %s OFFSET %s
                """,
                params + [por_pagina, offset],
            )
            filas = cur.fetchall()
            for f in filas:
                if f.get("creado_en"):
                    f["creado_en"] = f["creado_en"].isoformat()
                if f.get("restringido_en"):
                    f["restringido_en"] = f["restringido_en"].isoformat()
            return {"total": total, "pagina": pagina, "por_pagina": por_pagina, "filas": filas}
    finally:
        conn.close()


@router.get("/restringidos/kpis")
def kpis_restringidos(
    catalogo: str = "",
    estado: str = "",
    fecha_inicio: str = "",
    fecha_fin: str = "",
    uid: str = "",
):
    """Conteo de restringidos por motivo (semáforo vs monto mínimo),
    para las tarjetas KPI del visor de restringidos."""
    where = ["1=1"]
    params: list = []
    join_extra = ""
    if catalogo:
        where.append("r.catalogo = %s")
        params.append(catalogo)
    if estado:
        where.append("r.estado = %s")
        params.append(estado)
    if fecha_inicio:
        where.append("r.creado_en >= %s")
        params.append(f"{fecha_inicio} 00:00:00")
    if fecha_fin:
        where.append("r.creado_en <= %s")
        params.append(f"{fecha_fin} 23:59:59")
    if uid:
        join_extra = "JOIN perucompras_extraccion e ON e.id = r.extraccion_id"
        where.append("e.uid_perucompras = %s")
        params.append(uid)
    where_sql = " AND ".join(where)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT r.motivo, COUNT(*) AS total
                FROM perucompras_restringidos r
                {join_extra}
                WHERE {where_sql}
                GROUP BY r.motivo
                """,
                params,
            )
            filas = cur.fetchall()
            conteos = {f["motivo"]: f["total"] for f in filas}
            return {
                "total": sum(conteos.values()),
                "semaforo": conteos.get("semaforo", 0),
                "monto_minimo": conteos.get("monto_minimo", 0),
            }
    finally:
        conn.close()




URL_RESTRINGIR = "https://catalogos.perucompras.gob.pe/t_Proforma/restringir"

# Mismo mapeo que usaba procesar_restringidos_excel.py / ejecutar_bot_restringir.py:
# el motivo interno de Helbot ("semaforo"/"monto_minimo") se traduce al
# texto exacto que espera el formulario real de Perú Compras.
MOTIVO_A_TEXTO_PERUCOMPRAS = {
    "semaforo": "POR INDICADOR SEMAFORO",
    "monto_minimo": "POR MONTO MINIMO DE ATENCION",
}


class ConfirmarRestriccionIn(BaseModel):
    ids: list[int]
    uid: str  # uid de Perú Compras — la sesión activa que va a hacer el POST real


def _restringir_en_perucompras(session, n_proforma_id: str, motivo_texto: str) -> tuple[bool, str]:
    """Llama al endpoint REAL de Perú Compras — mismo request exacto
    que usaba ejecutar_bot_restringir.py con Selenium+requests, ahora
    reutilizando la sesión ya autenticada en memoria (perucompras_sesiones)."""
    try:
        r = session.post(
            URL_RESTRINGIR,
            files={
                "archivo": (None, "undefined"),
                "N_Proformacompradetalle": (None, str(n_proforma_id)),
                "C_EstadoMotivo": (None, motivo_texto),
                "C_EstadoDescripcion": (None, motivo_texto),
            },
            headers={"X-Requested-With": "XMLHttpRequest"},
            timeout=30,
        )
        resp = r.json()
        if resp.get("cod_rpta") == 0:
            return True, ""
        return False, resp.get("mensaje_rpta") or "Perú Compras rechazó la restricción"
    except Exception as e:
        return False, f"Error de conexión con Perú Compras: {e}"


@router.post("/restringidos/confirmar")
def confirmar_restringidos(
    body: ConfirmarRestriccionIn,
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    """
    Botón "Restringir": por cada id seleccionado, llama de verdad al
    endpoint /t_Proforma/restringir de Perú Compras usando la sesión
    activa del uid indicado. Solo si Perú Compras responde OK
    (cod_rpta == 0) se marca estado='restringido' en MySQL — si falla,
    la fila se queda en 'pendiente' y se reporta el motivo del error.
    """
    if not body.ids:
        raise HTTPException(400, "No se enviaron ids para restringir")

    pc_session = perucompras_sesiones.sesion(body.uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    usuario_helbot = usuario.nombre_completo or usuario.username

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            formato = ",".join(["%s"] * len(body.ids))
            cur.execute(
                f"""
                SELECT r.id, r.motivo, r.extraccion_id, e.n_proforma_id
                FROM perucompras_restringidos r
                JOIN perucompras_extraccion e ON e.id = r.extraccion_id
                WHERE r.id IN ({formato}) AND r.estado = 'pendiente'
                """,
                tuple(body.ids),
            )
            filas = cur.fetchall()
    finally:
        conn.close()

    if not filas:
        return {"ok": True, "actualizados": 0, "fallidos": [], "detalle": "Nada pendiente para esos ids"}

    exitosos: list[int] = []
    extracciones_exitosas: list[int] = []
    fallidos: list[dict] = []

    for f in filas:
        motivo_texto = MOTIVO_A_TEXTO_PERUCOMPRAS.get(f["motivo"], f["motivo"])
        ok, error = _restringir_en_perucompras(pc_session.session, f["n_proforma_id"], motivo_texto)
        if ok:
            exitosos.append(f["id"])
            extracciones_exitosas.append(f["extraccion_id"])
        else:
            fallidos.append({"id": f["id"], "n_proforma_id": f["n_proforma_id"], "error": error})

    if exitosos:
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                formato = ",".join(["%s"] * len(exitosos))
                cur.execute(
                    f"""
                    UPDATE perucompras_restringidos
                    SET estado = 'restringido', restringido_por = %s, restringido_en = %s
                    WHERE id IN ({formato})
                    """,
                    (usuario_helbot, datetime.now(), *exitosos),
                )

                # IMPORTANTE: esto es lo que faltaba. Perú Compras YA
                # restringió la proforma de verdad (cod_rpta == 0), pero
                # perucompras_extraccion.estado seguía diciendo
                # "PENDIENTE" porque solo actualizábamos la tabla de
                # candidatas, nunca la proforma real. Sin esto, la
                # tabla "Proformas extraídas" y sus KPIs (pendiente/
                # restringida) quedaban desincronizados con la realidad.
                formato_extracciones = ",".join(["%s"] * len(extracciones_exitosas))
                cur.execute(
                    f"""
                    UPDATE perucompras_extraccion
                    SET estado = 'RESTRINGIDA'
                    WHERE id IN ({formato_extracciones})
                    """,
                    tuple(extracciones_exitosas),
                )
            conn.commit()
        finally:
            conn.close()

    return {"ok": True, "actualizados": len(exitosos), "fallidos": fallidos}





@router.get("/kpis")
def kpis_estado(
    catalogo: str,
    fecha_inicio: str = "",
    fecha_fin: str = "",
    marca: str = "",
    ubicacion: str = "",
    entidad: str = "",
    ruc: str = "",
    uid: str = "",
):
    where_sql, params = _armar_filtros(catalogo, fecha_inicio, fecha_fin, marca, ubicacion, entidad, ruc, "", uid)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT UPPER(COALESCE(estado, '')) AS estado, COUNT(*) AS total
                FROM perucompras_extraccion
                WHERE {where_sql}
                GROUP BY UPPER(COALESCE(estado, ''))
                """,
                params,
            )
            filas = cur.fetchall()
            conteos = {f["estado"]: f["total"] for f in filas}
            total = sum(conteos.values())
            return {
                "total": total,
                "pendiente": conteos.get("PENDIENTE", 0),
                "restringida": conteos.get("RESTRINGIDA", 0),
                "cotizada": conteos.get("COTIZADA", 0),
                "desierta": conteos.get("DESIERTA", 0),
                "sin_estado": conteos.get("", 0),
            }
    finally:
        conn.close()



class ActualizarMarcaObjetivoIn(BaseModel):
    proveedor_nombre: str | None = None
    precio: float | None = None


@router.get("/marcas-objetivo")
def listar_marcas_objetivo(
    catalogo: str = "",
    marca: str = "",
    fecha_inicio: str = "",
    fecha_fin: str = "",
    uid: str = "",
    pagina: int = Query(1, ge=1),
    por_pagina: int = Query(100, ge=1, le=500),
):
    where = ["1=1"]
    params: list = []
    if catalogo:
        where.append("m.catalogo = %s")
        params.append(catalogo)
    if marca:
        where.append("m.marca LIKE %s")
        params.append(f"%{marca}%")
    if fecha_inicio:
        where.append("m.creado_en >= %s")
        params.append(f"{fecha_inicio} 00:00:00")
    if fecha_fin:
        where.append("m.creado_en <= %s")
        params.append(f"{fecha_fin} 23:59:59")
    if uid:
        where.append("e.uid_perucompras = %s")
        params.append(uid)
    where_sql = " AND ".join(where)
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM perucompras_marcas_objetivo m
                JOIN perucompras_extraccion e ON e.id = m.extraccion_id
                WHERE {where_sql}
                """,
                params,
            )
            total = cur.fetchone()["total"]

            offset = (pagina - 1) * por_pagina
            cur.execute(
                f"""
                SELECT
                    m.id, m.marca, m.proveedor_nombre, m.precio,
                    m.actualizado_por, m.actualizado_en, m.creado_en, m.catalogo,
                    e.requerimiento, e.proforma, e.estado, e.color_semaforo, e.procedimiento,
                    e.entidad, e.ruc, e.producto, e.codigo_unico, e.cantidad,
                    e.precio_unitario_base, e.precio_ofertado, e.moneda, e.subtotal,
                    e.departamento, e.provincia, e.distrito,
                    e.pdf_producto, e.pdf_requerimiento, e.imagen_producto, e.fecha_guardado
                FROM perucompras_marcas_objetivo m
                JOIN perucompras_extraccion e ON e.id = m.extraccion_id
                WHERE {where_sql}
                ORDER BY m.creado_en DESC
                LIMIT %s OFFSET %s
                """,
                params + [por_pagina, offset],
            )
            filas = cur.fetchall()
            for f in filas:
                if f.get("creado_en"):
                    f["creado_en"] = f["creado_en"].isoformat()
                if f.get("actualizado_en"):
                    f["actualizado_en"] = f["actualizado_en"].isoformat()
                if f.get("fecha_guardado"):
                    f["fecha_guardado"] = f["fecha_guardado"].isoformat()

            # El frontend usa esto SOLO para el contador "N marcas
            # configuradas" y el aviso "sin marcas todavía" — antes este
            # endpoint nunca lo devolvía, así que el frontend siempre
            # caía al fallback [] aunque SÍ hubiera marcas objetivo
            # configuradas (y SÍ hubiera filas reales, como en tu caso).
            if uid:
                cur.execute(
                    "SELECT DISTINCT marca FROM perucompras_marcas_config WHERE lista = 'objetivo' AND uid_perucompras = %s ORDER BY marca",
                    (uid,),
                )
            else:
                cur.execute(
                    "SELECT DISTINCT marca FROM perucompras_marcas_config WHERE lista = 'objetivo' ORDER BY marca"
                )
            marcas_objetivo = [f["marca"] for f in cur.fetchall()]

            return {
                "total": total, "pagina": pagina, "por_pagina": por_pagina,
                "filas": filas, "marcas_objetivo": marcas_objetivo,
            }
    finally:
        conn.close()


@router.put("/marcas-objetivo/{marca_objetivo_id}")
def actualizar_marca_objetivo(
    marca_objetivo_id: int,
    body: ActualizarMarcaObjetivoIn,
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    """Rellena/edita proveedor y precio de una fila de marca objetivo."""
    usuario_helbot = usuario.nombre_completo or usuario.username
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE perucompras_marcas_objetivo
                SET proveedor_nombre = %s, precio = %s,
                    actualizado_por = %s, actualizado_en = %s
                WHERE id = %s
                """,
                (body.proveedor_nombre, body.precio, usuario_helbot, datetime.now(), marca_objetivo_id),
            )
            if cur.rowcount == 0:
                raise HTTPException(404, "Fila no encontrada")
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}