from fastapi import APIRouter, HTTPException, Body
from perucompras_login import perucompras_sesiones


from monitor_publicadas import monitor_de
router = APIRouter(prefix="/perucompras", tags=["perucompras-filtros"])

BASE_URL = "https://catalogos.perucompras.gob.pe"


def parsear_categorias(texto_crudo: str) -> list[dict]:
    categorias = []
    for item in texto_crudo.split("¬"):
        item = item.strip()
        if not item or "^" not in item:
            continue
        id_cat, nombre = item.split("^", 1)
        categorias.append({"id": id_cat.strip(), "nombre": nombre.strip()})
    return categorias


@router.get("/acuerdos")
def acuerdos(uid: str):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    monitor = monitor_de(uid)
    if monitor is None:
        raise HTTPException(404, "No hay monitor configurado para este usuario")

    # Reutiliza la caché de 6h del monitor (obtener_acuerdos_catalogos);
    # si está vencida, la refresca sola.
    monitor._obtener_combos(pc_session.session)

    acuerdos_lista = [
        {"id": str(id_acuerdo), "codigo": info["codigo"], "nombre": info["nombre"]}
        for id_acuerdo, info in sorted(monitor._acuerdos_info.items())
    ]
    return {"acuerdos": acuerdos_lista}

@router.get("/catalogos")
def catalogos(uid: str, n_acuerdo: str):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    monitor = monitor_de(uid)
    if monitor is None:
        raise HTTPException(404, "No hay monitor configurado para este usuario")

    monitor._obtener_combos(pc_session.session)

    try:
        id_acuerdo = int(n_acuerdo)
    except ValueError:
        return {"catalogos": []}

    catalogos_lista = [
        {"id": str(id_catalogo), "nombre": info["nombre"]}
        for id_catalogo, info in sorted(monitor._catalogos_info.items())
        if info["n_acuerdo"] == id_acuerdo
    ]
    return {"catalogos": catalogos_lista}

@router.get("/categorias")
def categorias(uid: str, n_catalogo: str):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    if not n_catalogo.strip():
        return {"categorias": []}

    resp = pc_session.session.post(
        f"{BASE_URL}/t_Proforma/listarCategoria",
        data=str(n_catalogo).strip(),
        headers={
            "Content-Type": "text/plain;charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Error al listar categorías en Perú Compras")

    return {"categorias": parsear_categorias(resp.text)}


@router.post("/buscar")
def buscar(uid: str, filtros: dict = Body(...)):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    payload = {
        "N_Acuerdo": (None, filtros.get("n_acuerdo", "")),
        "N_Catalogo": (None, filtros.get("n_catalogo", "")),
        "N_Categoria": (None, filtros.get("n_categoria", "")),
        "C_PalabraClave": (None, filtros.get("palabra_clave", "")),
        "C_Estado": (None, filtros.get("estado", "")),
        "C_Procedimiento": (None, filtros.get("procedimiento", "")),
        "N_EscompraPorPaquete": (None, filtros.get("compra_por_paquete", "")),
        "C_FechaInicio": (None, filtros.get("fecha_inicio", "")),
        "C_FechaFin": (None, filtros.get("fecha_fin", "")),
        "N_Estrategia": (None, filtros.get("estrategia", "")),
    }
    pc_session.session.headers.pop("Content-Type", None)  # 👈 evita Content-Type pegado sin boundary
    resp = pc_session.session.post(
        f"{BASE_URL}/t_Proforma/buscar",
        files=payload,
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Error al buscar en Perú Compras")

    return {"resultado_crudo": resp.text}




"""
Este bloque va DENTRO de tu perucompras_filtros.py, al final del archivo.
No reemplaza nada de lo que ya tienes (acuerdos, catalogos, categorias) —
solo se agrega debajo.
"""


def _fecha_ddmmyyyy(iso: str) -> str:
    """Convierte 'yyyy-mm-dd' (lo que manda <input type=date>) a 'dd/mm/yyyy'
    (lo que espera Perú Compras en C_FechaInicio / C_FechaFin)."""
    if not iso:
        return ""
    try:
        y, m, d = iso.split("-")
        return f"{d}/{m}/{y}"
    except Exception:
        return iso


def _indicador_desde_semaforo(valor) -> str:
    # Asunción: 1=verde, 2=amarillo, 3=rojo (semáforo de cumplimiento).
    # Ajustar si Perú Compras usa otra escala.
    mapa = {1: "verde", 2: "amarillo", 3: "rojo"}
    try:
        return mapa.get(int(valor), "gris")
    except Exception:
        return "gris"


@router.get("/proformas")
def proformas(
    uid: str,
    acuerdoMarco: str = "",
    catalogo: str = "",
    categoria: str = "",
    palabraClave: str = "",
    estado: str = "",
    procedimiento: str = "",
    tipoContratacion: str = "",
    estrategiaCompra: str = "",
    fechaInicial: str = "",
    fechaFinal: str = "",
):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    payload = {
        "N_Acuerdo": (None, acuerdoMarco),
        "N_Catalogo": (None, catalogo),
        "N_Categoria": (None, categoria),
        "C_PalabraClave": (None, palabraClave),
        "C_Estado": (None, estado),
        "C_Procedimiento": (None, procedimiento),
        "N_EscompraPorPaquete": (None, tipoContratacion),
        "C_FechaInicio": (None, _fecha_ddmmyyyy(fechaInicial)),
        "C_FechaFin": (None, _fecha_ddmmyyyy(fechaFinal)),
        "N_Estrategia": (None, estrategiaCompra),
    }

    pc_session.session.headers.pop("Content-Type", None)  # 👈 evita Content-Type pegado sin boundary
    resp = pc_session.session.post(
        f"{BASE_URL}/t_Proforma/buscar",
        files=payload,
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Error al buscar proformas en Perú Compras")

    try:
        data = resp.json()
    except Exception:
        raise HTTPException(502, "Perú Compras devolvió una respuesta no válida (no era JSON)")

    if data.get("cod_rpta") != 0:
        raise HTTPException(400, data.get("mensaje_rpta") or "Perú Compras rechazó la búsqueda")

    resultados = []
    for item in data.get("pLista") or []:
        resultados.append({
            "requerimiento": item.get("C_Requerimento", ""),
            # TODO Erick: confirma la clave exacta viendo el payload crudo (item.keys())
            "nRequerimiento": item.get("N_Requerimiento", item.get("N_Requerimento", "")),
            "nProforma": item.get("N_Proforma", ""),
            "procedimiento": item.get("C_Procedimiento", ""),
            "estrategiaCompra": item.get("C_EstrategiaCompra", ""),
            "contratacionConFinanciamiento": item.get("C_TipoFinanciamiento", ""),
            "proforma": item.get("C_Proforma", ""),
            "fechaEmision": item.get("C_FechaEmision", ""),
            "estado": item.get("C_Estado", ""),
            "observaciones": (item.get("c_estadomotivo") or "").strip(),
            "fechaLimiteCotizacion": item.get("C_FechLimCoti", ""),
            "totalCotizado": float(item.get("N_TotalCoti") or 0),
            "entidad": item.get("C_Entidad", ""),
            "ruc": item.get("C_Ruc", ""),
            "fichaTipo": item.get("C_FichaTipo", ""),
            "indicador": _indicador_desde_semaforo(item.get("N_EntidadIndicadorSemaforo")),
            "puedeCotizar": bool(item.get("N_Cotizar")),
            "esPaquete": str(item.get("N_EsCompraPorPaquete", "0")),
        })

    return resultados




@router.post("/proformas/cotizar-detalle")
def cotizar_detalle(uid: str, payload: dict = Body(...)):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")

    body = {
        "N_Requerimiento": payload.get("nRequerimiento", ""),
        "N_Proforma": payload.get("nProforma", ""),
        "N_EsCompraPorPaquete": payload.get("nEsCompraPorPaquete", "0"),
    }

    resp = pc_session.session.post(
        f"{BASE_URL}/t_Proforma/cargarCotizar",
        data=body,
        headers={"X-Requested-With": "XMLHttpRequest"},
    )
    if resp.status_code != 200:
        raise HTTPException(resp.status_code, "Error al cargar datos de cotización en Perú Compras")

    try:
        data = resp.json()
    except Exception:
        raise HTTPException(502, "Perú Compras devolvió una respuesta no válida (no era JSON) en cargarCotizar")

    # Devolvemos el JSON crudo tal cual; el mapeo a la forma que usa el modal
    # se hace en el frontend (mapearCotizacionDetalle), donde es más fácil
    # ajustar los nombres de campo una vez que confirmes la respuesta real.
    return data