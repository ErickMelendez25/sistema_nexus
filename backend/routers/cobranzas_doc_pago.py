"""
Endpoint: DOC PARA PAGO
Réplica exacta del comportamiento de CobranzasFrame (cobranzas.py),
expuesta como API para que la consuma DocParaPago.tsx.

Plantillas usadas: cobranza_1.docx (Grupo EcoLimp) / cobranza_2.docx (Ecolimp)
"""
import os
from typing import List

from docx import Document
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from . import cobranzas_common as common

router = APIRouter(prefix="/cobranzas/doc-pago", tags=["Cobranzas - Doc para pago"])

PLANTILLA_ECO = common.CARPETA_PLANTILLAS / "cobranza_1.docx"
PLANTILLA_ML = common.CARPETA_PLANTILLAS / "cobranza_2.docx"


@router.post("/generar")
async def generar_doc_pago(
    plantilla: str = Form(..., description="'eco' (Grupo EcoLimp) o 'multi' (Ecolimp)"),
    fecha: str = Form(...),
    num: str = Form(...),
    area: str = Form(...),
    entidad: str = Form(...),
    ciudad: str = Form(...),
    factura: str = Form(...),
    guiaremi: str = Form(...),
    oc: str = Form(...),
    ocam: str = Form(""),
    archivo: str = Form(...),
    guiaremi_sellado: bool = Form(True),
    pdfs_extra: List[UploadFile] = File(default=[]),
):
    campos_obligatorios = [fecha, num, area, entidad, ciudad, factura, guiaremi, oc, archivo]
    if not all(c.strip() for c in campos_obligatorios):
        raise HTTPException(400, "Completa todos los campos obligatorios.")

    if not num.isdigit():
        raise HTTPException(400, "El número de carta debe ser numérico.")

    ruta_plantilla = PLANTILLA_ECO if plantilla == "eco" else PLANTILLA_ML
    if not ruta_plantilla.exists():
        raise HTTPException(404, f"No se encontró la plantilla: {ruta_plantilla}")

    data = {
        "FECHA": common.formatear_fecha_es(fecha),
        "NUM": num,
        "AREA": area,
        "ENTIDAD": entidad,
        "CIUDAD": ciudad,
        "FACTURA": factura,
        "GUIAREMI": guiaremi,
        "OC": oc,
        "OCAM": ocam,
    }

    try:
        doc = Document(ruta_plantilla)
    except Exception as e:
        raise HTTPException(500, f"No se pudo abrir la plantilla.\n{e}")

    common.ajustar_si_ocam_vacio(doc, ocam)
    common.eliminar_marcadores_de_bloque(doc)
    common.reemplazar_marcadores(doc, data)
    common.quitar_texto_si(doc, " (cargo sellado)", not guiaremi_sellado)

    ruta_docx = common.CARPETA_SALIDA / f"{archivo}.docx"
    ruta_pdf_principal = common.CARPETA_SALIDA / f"{archivo}_principal.pdf"
    ruta_pdf_final = common.CARPETA_SALIDA / f"{archivo}.pdf"

    try:
        doc.save(ruta_docx)
    except Exception as e:
        raise HTTPException(500, f"No se pudo guardar el DOCX.\n{e}")

    try:
        await run_in_threadpool(common.crear_pdf_word, str(ruta_docx), str(ruta_pdf_principal))
        os.remove(ruta_docx)
    except Exception as e:
        raise HTTPException(500, f"Error al convertir a PDF.\n{e}")

    rutas_extra = common.guardar_pdfs_extra(pdfs_extra)
    try:
        lista_final = [str(ruta_pdf_principal)] + rutas_extra
        await run_in_threadpool(common.unir_pdfs, lista_final, str(ruta_pdf_final))
        if ruta_pdf_principal.exists():
            os.remove(ruta_pdf_principal)
    except Exception as e:
        raise HTTPException(500, f"Error al unir los PDFs.\n{e}")
    finally:
        common.limpiar_temporales(rutas_extra)

    return {
        "ok": True,
        "archivo": f"{archivo}.pdf",
        "url_descarga": f"/cobranzas/doc-pago/descargar/{archivo}.pdf",
    }


@router.get("/descargar/{nombre_archivo}")
async def descargar_doc_pago(nombre_archivo: str):
    ruta = common.CARPETA_SALIDA / nombre_archivo
    if not ruta.exists():
        raise HTTPException(404, "Archivo no encontrado")
    return FileResponse(ruta, media_type="application/pdf", filename=nombre_archivo)