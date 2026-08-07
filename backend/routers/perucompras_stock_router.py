from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from datetime import datetime
from pydantic import BaseModel
from perucompras_login import perucompras_sesiones
from perucompras_stock import extraer_todo, modificar_seleccion, calcular_stats_por_categoria
from auth import obtener_usuario_actual, UsuarioToken

router = APIRouter(prefix="/perucompras/stock", tags=["perucompras-stock"])

_estado = {
    "fase": "ocioso",  # ocioso | extrayendo | listo | modificando | completado
    "categoria_actual": None,
    "categorias_completadas": 0,
    "total_categorias": 0,
    "total_a_modificar": 0,
    "procesados": 0,
    "iniciado_en": None,
    "terminado_en": None,
    "error": None,
}
_items: list[dict] = []


def _tarea_extraer(uid: str):
    global _items
    pc_session = perucompras_sesiones.sesion(uid)
    _estado["iniciado_en"] = datetime.now().isoformat()
    _estado["terminado_en"] = None
    _estado["error"] = None
    try:
        _items = extraer_todo(pc_session, _estado)
    except Exception as e:
        _estado["error"] = str(e)
        _estado["fase"] = "ocioso"
    finally:
        _estado["terminado_en"] = datetime.now().isoformat()


def _tarea_modificar(uid: str, categorias: list[str]):
    pc_session = perucompras_sesiones.sesion(uid)
    _estado["iniciado_en"] = datetime.now().isoformat()
    _estado["terminado_en"] = None
    _estado["error"] = None
    try:
        modificar_seleccion(pc_session, _estado, _items, set(categorias))
    except Exception as e:
        _estado["error"] = str(e)
        _estado["fase"] = "listo"
    finally:
        _estado["terminado_en"] = datetime.now().isoformat()


@router.post("/extraer")
def extraer(uid: str, background_tasks: BackgroundTasks, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")
    if _estado["fase"] in ("extrayendo", "modificando"):
        return {"ok": True, "detalle": "Ya hay una operación en curso"}
    background_tasks.add_task(_tarea_extraer, uid)
    return {"ok": True, "detalle": "Extracción de stock iniciada en background"}


class SeleccionCategoriasIn(BaseModel):
    categorias: list[str]


@router.post("/modificar")
def modificar(
    uid: str,
    body: SeleccionCategoriasIn,
    background_tasks: BackgroundTasks,
    usuario: UsuarioToken = Depends(obtener_usuario_actual),
):
    pc_session = perucompras_sesiones.sesion(uid)
    if pc_session is None or not pc_session.autenticado or pc_session.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")
    if _estado["fase"] != "listo":
        raise HTTPException(400, "Primero debes extraer los productos antes de modificar")
    if not body.categorias:
        raise HTTPException(400, "Selecciona al menos una categoría")
    background_tasks.add_task(_tarea_modificar, uid, body.categorias)
    return {"ok": True, "detalle": f"Modificación iniciada en {len(body.categorias)} categoría(s)"}


@router.get("/estado")
def estado():
    return _estado


@router.get("/categorias")
def categorias():
    return {"categorias": calcular_stats_por_categoria(_items)}


@router.get("/resultados")
def resultados(categoria: str = ""):
    filas = [i for i in _items if not categoria or i["categoria"] == categoria]
    return {"total": len(filas), "filas": filas}