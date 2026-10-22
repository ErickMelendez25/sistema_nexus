from fastapi import APIRouter, HTTPException, BackgroundTasks, Depends
from fastapi.responses import Response
from datetime import datetime
from pydantic import BaseModel
from perucompras_login import perucompras_sesiones
from perucompras_plazo import (
    ejecutar_modificacion_plazo, listar_opciones, obtener_departamentos, obtener_provincias,
)
from perucompras_reporte import ejecutar_reporte_resultados, generar_excel
from auth import obtener_usuario_actual, UsuarioToken

router = APIRouter(prefix="/perucompras/plazo", tags=["perucompras-plazo"])

_estado = {
    "corriendo": False, "combinacion_actual": None, "combinaciones_completadas": 0,
    "total_combinaciones": 0, "fichas_modificadas": 0, "combos_con_error": 0,
    "iniciado_en": None, "terminado_en": None, "error": None, "categorias": [],
}
_resultados: list[dict] = []


class SeleccionPlazoIn(BaseModel):
    acuerdos: list[str] | None = None
    categorias: list[list[int]] | None = None
    departamento_codigo: str | None = None
    provincia_codigo: str | None = None


def _validar_sesion(uid: str):
    pc = perucompras_sesiones.sesion(uid)
    if pc is None or not pc.autenticado or pc.session is None:
        raise HTTPException(401, "No hay sesión activa de Perú Compras para este usuario")
    return pc


def _tarea(uid: str, seleccion: dict | None):
    global _resultados
    pc = perucompras_sesiones.sesion(uid)
    try:
        _resultados = ejecutar_modificacion_plazo(pc, _estado, seleccion)
    except Exception as e:
        _estado["error"] = str(e)
    finally:
        _estado["corriendo"] = False
        _estado["terminado_en"] = datetime.now().isoformat()


@router.get("/opciones")
def opciones(uid: str, refrescar: bool = False, usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    pc = _validar_sesion(uid)
    try:
        return {"opciones": listar_opciones(pc, refrescar)}
    except Exception as e:
        raise HTTPException(500, f"No se pudieron leer los acuerdos: {e}")


@router.get("/departamentos")
def departamentos(uid: str, acuerdo: str, familia: int, categoria: int,
                  usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    pc = _validar_sesion(uid)
    try:
        return {"departamentos": obtener_departamentos(pc, acuerdo, familia, categoria)}
    except Exception as e:
        raise HTTPException(500, f"No se pudieron obtener los departamentos: {e}")


@router.get("/provincias")
def provincias(uid: str, acuerdo: str, familia: int, categoria: int, departamento_codigo: str,
               usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    pc = _validar_sesion(uid)
    try:
        return {"provincias": obtener_provincias(pc, acuerdo, familia, categoria, departamento_codigo)}
    except Exception as e:
        raise HTTPException(500, f"No se pudieron obtener las provincias: {e}")


@router.post("/ejecutar")
def ejecutar(uid: str, background_tasks: BackgroundTasks, seleccion: SeleccionPlazoIn | None = None,
             usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    _validar_sesion(uid)
    if _estado["corriendo"]:
        return {"ok": True, "detalle": "Ya hay una modificación de plazo en curso"}
    if _estado_reporte["corriendo"]:
        raise HTTPException(409, "Hay un reporte de resultados en curso. Espera a que termine.")
    _estado.update({
        "corriendo": True, "error": None, "terminado_en": None,
        "iniciado_en": datetime.now().isoformat(), "combinacion_actual": None,
        "combinaciones_completadas": 0, "total_combinaciones": 0,
        "fichas_modificadas": 0, "combos_con_error": 0, "categorias": [],
    })
    seleccion_dict = seleccion.model_dump() if seleccion else None
    background_tasks.add_task(_tarea, uid, seleccion_dict)
    return {"ok": True, "detalle": "Modificación de plazo iniciada en background"}


@router.get("/estado")
def estado():
    return _estado


@router.get("/resultados")
def resultados():
    return {"total": len(_resultados), "filas": _resultados}




# =====================================================================
# REPORTE DE RESULTADOS (solo lectura: NO modifica plazos)
# =====================================================================
_estado_reporte = {
    "corriendo": False, "combinacion_actual": None, "combinaciones_completadas": 0,
    "total_combinaciones": 0, "con_resultados": 0, "sin_resultados": 0,
    "combos_con_error": 0, "fichas_encontradas": 0, "categorias_total": 0,
    "categorias_procesadas": 0, "iniciado_en": None, "terminado_en": None, "error": None,
}
_resultados_reporte: list[dict] = []
_meta_reporte: dict = {}


def _tarea_reporte(uid: str, seleccion: dict | None):
    pc = perucompras_sesiones.sesion(uid)
    try:
        ejecutar_reporte_resultados(pc, _estado_reporte, seleccion, _resultados_reporte)
    except Exception as e:
        _estado_reporte["error"] = str(e)
    finally:
        _estado_reporte["corriendo"] = False
        _estado_reporte["terminado_en"] = datetime.now().isoformat()
        _meta_reporte.update({
            "usuario": getattr(pc, "usuario", "") or "",
            "iniciado_en": _estado_reporte["iniciado_en"],
            "terminado_en": _estado_reporte["terminado_en"],
        })


@router.post("/reporte/ejecutar")
def reporte_ejecutar(uid: str, background_tasks: BackgroundTasks, seleccion: SeleccionPlazoIn | None = None,
                     usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    _validar_sesion(uid)
    if _estado["corriendo"]:
        raise HTTPException(409, "Hay una modificación de plazo en curso. Espera a que termine.")
    if _estado_reporte["corriendo"]:
        return {"ok": True, "detalle": "Ya hay un reporte en curso"}
    _resultados_reporte.clear()
    _meta_reporte.clear()
    _estado_reporte.update({
        "corriendo": True, "error": None, "terminado_en": None,
        "iniciado_en": datetime.now().isoformat(), "combinacion_actual": None,
        "combinaciones_completadas": 0, "total_combinaciones": 0, "con_resultados": 0,
        "sin_resultados": 0, "combos_con_error": 0, "fichas_encontradas": 0,
        "categorias_total": 0, "categorias_procesadas": 0,
    })
    seleccion_dict = seleccion.model_dump() if seleccion else None
    background_tasks.add_task(_tarea_reporte, uid, seleccion_dict)
    return {"ok": True, "detalle": "Reporte de resultados iniciado en background"}


@router.get("/reporte/estado")
def reporte_estado():
    return _estado_reporte


@router.get("/reporte/resultados")
def reporte_resultados():
    return {"total": len(_resultados_reporte), "filas": _resultados_reporte}


@router.get("/reporte/excel")
def reporte_excel(usuario: UsuarioToken = Depends(obtener_usuario_actual)):
    if _estado_reporte["corriendo"]:
        raise HTTPException(409, "El reporte aún se está generando.")
    if not _resultados_reporte:
        raise HTTPException(404, "Todavía no hay resultados. Genera el reporte primero.")
    contenido = generar_excel(list(_resultados_reporte), dict(_meta_reporte))
    nombre = f"reporte_resultados_{datetime.now():%Y%m%d_%H%M}.xlsx"
    return Response(
        content=contenido,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )