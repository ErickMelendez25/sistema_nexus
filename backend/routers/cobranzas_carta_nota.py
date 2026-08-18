"""
Endpoint: CARTA NOTA DÉBITO
Réplica exacta del comportamiento de CobraFrame (cobra.py),
expuesta como API para que la consuma CartaNotaDebito.tsx.

Plantillas usadas (OJO, el mapeo es inverso al de doc-pago):
  - plantilla "eco"   (Grupo EcoLimp) -> cobra2.docx
  - plantilla "multi" (Ecolimp)       -> cobra1.docx
Así estaba en el original: self.PLANTILLA_GRUPO_ECOLIMP = cobra2.docx,
self.PLANTILLA_ECOLIMP = cobra1.docx, y obtener_plantilla() devuelve
GRUPO_ECOLIMP cuando var_empresa == "eco".

IMPORTANTE sobre fechas (igual que el original):
  - FECHA y FEC SÍ se formatean a texto largo en español
    ("1 de enero de 2026") vía common.formatear_fecha_es().
  - FECHAFAC NO se formatea: se guarda tal cual llega (dd/mm/aaaa),
    porque así lo hacía generar_carta() en cobra.py
    (fecha_factura = self.entry_fechafac.entry.get().strip(), sin pasar
    por formatear_fecha_es). El frontend debe enviarla ya en dd/mm/aaaa.
"""
import os
from typing import List

from docx import Document
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from . import cobranzas_common as common

router = APIRouter(prefix="/cobranzas/carta-nota", tags=["Cobranzas - Carta nota débito"])

# OJO: mapeo inverso respecto a doc-pago, tal cual el cobra.py original
PLANTILLA_ECO = common.CARPETA_PLANTILLAS / "cobra2.docx"   # Grupo EcoLimp
PLANTILLA_ML = common.CARPETA_PLANTILLAS / "cobra1.docx"    # Ecolimp


@router.post("/generar")
async def generar_carta_nota(
    plantilla: str = Form(..., description="'eco' (Grupo EcoLimp) o 'multi' (Ecolimp)"),
    fecha: str = Form(...),
    fec: str = Form(...),
    num: str = Form(...),
    area: str = Form(...),
    entidad: str = Form(...),
    ciudad: str = Form(...),
    factura: str = Form(...),
    fechafac: str = Form(...),
    monto: str = Form(...),
    montopenalidad: str = Form(...),
    oc: str = Form(...),
    ocam: str = Form(""),
    sf: str = Form(...),
    archivo: str = Form(...),
    pdfs_extra: List[UploadFile] = File(default=[]),
):

    print("🔥🔥🔥 CARTA NOTA ENDPOINT EJECUTADO 🔥🔥🔥")
    campos_obligatorios = [
        fecha, fec, num, area, entidad, ciudad, factura,
        fechafac, monto, montopenalidad, oc, sf, archivo,
    ]
    if not all(c.strip() for c in campos_obligatorios):
        raise HTTPException(400, "Completa todos los campos obligatorios.")
    if not num.isdigit():
        raise HTTPException(400, "El número de carta debe ser numérico.")

    ruta_plantilla = PLANTILLA_ECO if plantilla == "eco" else PLANTILLA_ML
    if not ruta_plantilla.exists():
        raise HTTPException(404, f"No se encontró la plantilla: {ruta_plantilla}")

    data = {
        "FECHA": common.formatear_fecha_es(fecha),
        "FEC": common.formatear_fecha_es(fec),
        "NUM": num,
        "AREA": area,
        "ENTIDAD": entidad,
        "CIUDAD": ciudad,
        "FACTURA": factura,
        "FECHAFAC": fechafac,  # sin formatear, igual que el original
        "MONTO": monto,
        "MONTOPENALIDAD": montopenalidad,
        "OC": oc,
        "OCAM": ocam,
        "SF": sf,
    }

    try:
        doc = Document(ruta_plantilla)
    except Exception as e:
        raise HTTPException(500, f"No se pudo abrir la plantilla.\n{e}")

    common.ajustar_si_ocam_vacio(doc, ocam)
    common.ajustar_referencia_ocam(doc, ocam)
    common.eliminar_marcadores_de_bloque(doc)
    common.reemplazar_marcadores(doc, data)
    
    ruta_docx = common.CARPETA_SALIDA / f"{archivo}.docx"
    ruta_pdf_principal = common.CARPETA_SALIDA / f"{archivo}_principal.pdf"
    ruta_pdf_final = common.CARPETA_SALIDA / f"{archivo}.pdf"



    print("========================================")
    print("CARPETA SALIDA:", common.CARPETA_SALIDA)
    print("DOCX GENERADO:", ruta_docx)
    print("PDF PRINCIPAL:", ruta_pdf_principal)
    print("PDF FINAL:", ruta_pdf_final)
    print("========================================")


    try:
        doc.save(ruta_docx)
    except Exception as e:
        raise HTTPException(500, f"No se pudo guardar el DOCX.\n{e}")

    try:
        await run_in_threadpool(common.crear_pdf_word, str(ruta_docx), str(ruta_pdf_principal))
        # os.remove(ruta_docx)
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
        "url_descarga": f"/cobranzas/carta-nota/descargar/{archivo}.pdf",
    }


@router.get("/descargar/{nombre_archivo}")
async def descargar_carta_nota(nombre_archivo: str):
    ruta = common.CARPETA_SALIDA / nombre_archivo
    if not ruta.exists():
        raise HTTPException(404, "Archivo no encontrado")
    return FileResponse(ruta, media_type="application/pdf", filename=nombre_archivo)