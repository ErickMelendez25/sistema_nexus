from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from datetime import datetime
from pydantic import BaseModel
from perucompras_login import perucompras_sesiones
from perucompras_stock import extraer_todo, modificar_seleccion, calcular_stats_por_categoria
from auth import obtener_usuario_actual, UsuarioToken

router = APIRouter(prefix="/perucompras/stock", tags=["perucompras-stock"])

_estado = {
    "fase": "ocioso",
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
_uid_items: str | None = None


def _validar_sesion(uid: str):
    pc = perucompras_sesiones.sesion(uid)
    if pc is None or not pc.autenticado or pc.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")
    return pc


def _tarea_extraer(uid: str):
    global _items, _uid_items
    pc = perucompras_sesiones.sesion(uid)
    try:
        _items = extraer_todo(pc, _estado)
        _uid_items = uid
    except Exception as e:
        _estado["error"] = str(e)
        _estado["fase"] = "ocioso"
    finally:
        _estado["terminado_en"] = datetime.now().isoformat()


def _tarea_modificar(uid: str, categorias: list[str]):
    pc = perucompras_sesiones.sesion(uid)
    try:
        modificar_seleccion(pc, _estado, _items, set(categorias))
    except Exception as e:
        _estado["error"] = str(e)
        _estado["fase"] = "listo"
    finally:
        _estado["terminado_en"] = datetime.now().isoformat()


@router.post("/extraer")
def extraer(uid: str, background_tasks: BackgroundTasks, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    _validar_sesion(uid)
    if _estado["fase"] in ("extrayendo", "modificando"):
        return {"ok": True, "detalle": "Ya hay una operación en curso"}
    _items.clear()
    _estado.update({"fase": "extrayendo", "error": None, "terminado_en": None,
                    "iniciado_en": datetime.now().isoformat(),
                    "categorias_completadas": 0, "total_categorias": 0, "categoria_actual": None})
    background_tasks.add_task(_tarea_extraer, uid)
    return {"ok": True, "detalle": "Extracción de stock iniciada en background"}


class SeleccionCategoriasIn(BaseModel):
    categorias: list[str]


@router.post("/modificar")
def modificar(uid: str, body: SeleccionCategoriasIn, background_tasks: BackgroundTasks,
              usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    _validar_sesion(uid)
    if _estado["fase"] not in ("listo", "completado"):
        raise HTTPException(400, "Primero debes extraer los productos antes de modificar")
    if _uid_items != uid:
        raise HTTPException(400, "Los productos extraídos son de otro usuario. Vuelve a extraer con este usuario.")
    if not body.categorias:
        raise HTTPException(400, "Selecciona al menos una categoría")
    _estado.update({"fase": "modificando", "error": None, "terminado_en": None,
                    "iniciado_en": datetime.now().isoformat(), "procesados": 0, "total_a_modificar": 0})
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