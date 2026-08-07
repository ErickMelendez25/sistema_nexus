from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from datetime import datetime
from perucompras_login import perucompras_sesiones
from perucompras_plazo import (
    ejecutar_modificacion_plazo,
    listar_opciones,
    obtener_departamentos,
    obtener_provincias,
    ACUERDOS_MARCO,
)
from pydantic import BaseModel
from auth import obtener_usuario_actual, UsuarioToken

router = APIRouter(prefix="/perucompras/plazo", tags=["perucompras-plazo"])

_estado = {
    "corriendo": False, "combinacion_actual": None, "combinaciones_completadas": 0,
    "total_combinaciones": 0, "fichas_modificadas": 0, "combos_con_error": 0,
    "iniciado_en": None, "terminado_en": None, "error": None,
}
_resultados: list[dict] = []


class SeleccionPlazoIn(BaseModel):
    acuerdos: list[str] | None = None
    categorias: list[list[int]] | None = None
    # NUEVO — restringe el barrido geográfico. Igual que en el bot viejo:
    # si no vienen, se corre a nivel nacional (todos los departamentos y
    # provincias); si viene solo departamento_codigo, se corre en todas
    # las provincias de ESE departamento; si vienen ambos, se corre solo
    # en esa provincia puntual.
    departamento_codigo: str | None = None
    provincia_codigo: str | None = None


def _validar_sesion(uid: str):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")
    return pc_session


def _tarea(uid: str, seleccion: dict | None):
    global _resultados
    pc_session = perucompras_sesiones.sesion(uid)
    _estado["corriendo"] = True
    _estado["iniciado_en"] = datetime.now().isoformat()
    _estado["terminado_en"] = None
    _estado["error"] = None
    try:
        _resultados = ejecutar_modificacion_plazo(pc_session, _estado, seleccion)
    except Exception as e:
        _estado["error"] = str(e)
    finally:
        _estado["corriendo"] = False
        _estado["terminado_en"] = datetime.now().isoformat()


@router.get("/opciones")
def opciones():
    """Acuerdos + categorías disponibles para armar los checkboxes del frontend."""
    return {"opciones": listar_opciones()}


@router.get("/departamentos")
def departamentos(
    uid: str,
    acuerdo: str,
    familia: int,
    categoria: int,
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    """Departamentos disponibles para UNA categoría concreta de UN acuerdo.
    Requiere sesión activa de Perú Compras porque consulta en vivo el
    endpoint obtenerFiltros (tipo=3) — igual que hacía tkinter."""
    pc_session = _validar_sesion(uid)
    data = ACUERDOS_MARCO.get(acuerdo)
    if not data:
        raise HTTPException(404, f"Acuerdo no reconocido: {acuerdo}")
    try:
        deps = obtener_departamentos(pc_session, data["grupo_id"], categoria)
    except Exception as e:
        raise HTTPException(500, f"No se pudieron obtener los departamentos: {e}")
    return {"departamentos": deps}


@router.get("/provincias")
def provincias(
    uid: str,
    departamento_codigo: str,
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    """Provincias de un departamento (endpoint obtenerFiltros tipo=4)."""
    pc_session = _validar_sesion(uid)
    try:
        provs = obtener_provincias(pc_session, departamento_codigo)
    except Exception as e:
        raise HTTPException(500, f"No se pudieron obtener las provincias: {e}")
    return {"provincias": provs}


@router.post("/ejecutar")
def ejecutar(
    uid: str,
    background_tasks: BackgroundTasks,
    seleccion: SeleccionPlazoIn | None = None,
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    _validar_sesion(uid)
    if _estado["corriendo"]:
        return {"ok": True, "detalle": "Ya hay una modificación de plazo en curso"}
    seleccion_dict = seleccion.model_dump() if seleccion else None
    background_tasks.add_task(_tarea, uid, seleccion_dict)
    return {"ok": True, "detalle": "Modificación de plazo iniciada en background"}


@router.get("/estado")
def estado():
    return _estado


@router.get("/resultados")
def resultados():
    return {"total": len(_resultados), "filas": _resultados}