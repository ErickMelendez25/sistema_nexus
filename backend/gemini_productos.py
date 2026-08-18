"""
gemini_productos.py
Reemplazo de groq_productos.py usando Gemini (tier gratuito, cuota
diaria mucho más generosa que Groq free) — mismo contrato de salida:
{"productos": [...], "fuente": "gemini" | "regex_fallback", "tokens": {...} | None, "error": str | None}
"""
import os
import json
import re
import asyncio
import logging
from typing import Optional

import logging as _logging
_logging.getLogger("google_genai.models").setLevel(_logging.ERROR)


from google import genai
from google.genai import types

logger = logging.getLogger("helbot.gemini_productos")

# Cadena de modelos candidatos: si uno falla por 404 (no disponible
# para tu cuenta) o 429 (cuota agotada de ESE modelo puntual), se
# prueba el siguiente — cada modelo tiene su propia cuota separada, así
# que probar el siguiente no "gasta" nada del anterior. Se probó en
# vivo que gemini-flash-latest y gemini-2.5-flash-lite fallan para esta
# cuenta (404), y gemini-3.7-flash tiene cuota de solo 20/día -> se
# agota rápido. gemini-3.1-flash-lite es GA (no preview) desde mayo
# 2026 y suele tener mejor cuota dentro de su familia.
MODELOS_CANDIDATOS = [
    m.strip() for m in os.getenv(
        "LLM_MODELOS_PRODUCTOS_GEMINI",
        "gemini-3.1-flash-lite,gemini-2.5-flash-lite,gemini-3.5-flash-lite,gemini-3-flash-preview",
    ).split(",") if m.strip()
]

_cliente = None


def get_client() -> genai.Client:
    global _cliente
    if _cliente is None:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY no está configurada en el .env")
        _cliente = genai.Client(api_key=api_key)
    return _cliente


# Mismo prompt que ya tenías validado en groq_productos.py — cópialo tal
# cual (SYSTEM_PROMPT completo, con los 2 ejemplos reales).
SYSTEM_PROMPT = """Eres un extractor de datos de órdenes de compra del Estado peruano (OCAM de Perú Compras).
Recibirás el texto plano completo (ya extraído correctamente, con capa de texto nativo del PDF) de una orden de compra.
La tabla de productos tiene estas columnas: Nro | Ficha - producto | Marca | Código Único de Producto | Cantidad | (a veces Precio Unitario Total Sin IGV | IGV) | Importe (PEN).

REGLA CRÍTICA — NO TRUNQUES NADA:
- "descripcion" = el CONTENIDO COMPLETO de la columna "Ficha - producto", palabra por palabra, tal cual aparece — INCLUSO si ese texto vuelve a mencionar "MARCA:" o el código de producto dentro de sí mismo (pasa seguido en las OCAM, es normal, cópialo TODO igual, no te detengas ahí).
- "marca" = el CONTENIDO COMPLETO de la columna "Marca", que puede tener una o varias palabras (ej: "INSTITUCIONAL SUPER", nunca solo la primera palabra "INSTITUCIONAL").
- "codigo" = el CONTENIDO COMPLETO de la columna "Código Único de Producto", INCLUYENDO cualquier sufijo que venga después de un guión (ej: "7755139002571 - 2"). El PDF a veces envuelve ese sufijo en una segunda línea visual dentro de la misma celda ("7755139002571" arriba y "- 2" abajo), pero es UN SOLO valor de código, NO lo recortes ni lo dejes solo en "7755139002571".

Ejemplo real 1 — así debe verse la salida correcta:
Texto de la fila: "1 PAPEL TOALLA: ROLLO UNA HOJA COL: BLANCO GOFRADO 300 MTS C/U 34 GR/M2 G.F: 12 MESES ON SITE PAQUETE X2 ROLLOS INSTITUCIONAL SUPER 004.022005  INSTITUCIONAL SUPER  004.022005  2500  94,872.00"
Salida correcta:
{
  "descripcion": "PAPEL TOALLA: ROLLO UNA HOJA COL: BLANCO GOFRADO 300 MTS C/U 34 GR/M2 G.F: 12 MESES ON SITE PAQUETE X2 ROLLOS INSTITUCIONAL SUPER 004.022005",
  "marca": "INSTITUCIONAL SUPER",
  "codigo": "004.022005",
  "cantidad": 2500,
  "importe_pen": 94872.00
}

Ejemplo real 2 — nota que "Marca" viene como "MARCA: CIELO" en la columna, pero el valor de marca es SOLO "CIELO" (sin la etiqueta). La descripción, en cambio, SIGUE completa e incluye esa mención de "MARCA: CIELO" dentro de sí:
Texto de la fila: "1 AGUA DE MESA DESCARTABLE: TIPO: SIN GAS CARBONICO U. DESPACHO: UNIDAD CONT.NETO: 20 L MARCA: CIELO GARANTÍA: DURANTE TODO LA VIDA ÚTIL DEL PRODUCTO 7750670009454  MARCA: CIELO  7750670009454  250  5,575.50"
Salida correcta:
{
  "descripcion": "AGUA DE MESA DESCARTABLE: TIPO: SIN GAS CARBONICO U. DESPACHO: UNIDAD CONT.NETO: 20 L MARCA: CIELO GARANTÍA: DURANTE TODO LA VIDA ÚTIL DEL PRODUCTO 7750670009454",
  "marca": "CIELO",
  "codigo": "7750670009454",
  "cantidad": 250,
  "importe_pen": 5575.50
}

Ejemplo real 3 — nota el código con sufijo tras guión (debe copiarse COMPLETO en "codigo") Y ADEMÁS nota que la columna "Ficha - producto" del PDF original REPITE ese mismo código al final de su propio texto (es una celda separada de la columna "Código Único de Producto", pero su contenido igual termina con esa repetición) — por eso "descripcion" TAMBIÉN debe terminar con esa repetición del código, igual que "codigo":
Texto de la fila: "1 ARROZ PILADO : GRADO DE CALIDAD: SUPERIOR LONGITUD DEL GRANO: DE 6.6 MM O MAS CONT.NETO: 50 KILOS MARCA: DEL NORTE UNIDAD DE DESPACHO: UNIDAD ENV.PRIMARIO: SACO DE POLIPROPILENO GARANTÍA: DURANTE TODALAVIDAÚTIL DEL PRODUCTO.CUMPLEREQ.DECALIDAD: SICUMPLEREQ.DEINOCUIDAD: SI 7755139002571 - 2  MARCA: DEL NORTE  7755139002571 - 2  28  6,208.22"
Salida correcta:
{
  "descripcion": "ARROZ PILADO : GRADO DE CALIDAD: SUPERIOR LONGITUD DEL GRANO: DE 6.6 MM O MAS CONT.NETO: 50 KILOS MARCA: DEL NORTE UNIDAD DE DESPACHO: UNIDAD ENV.PRIMARIO: SACO DE POLIPROPILENO GARANTÍA: DURANTE TODALAVIDAÚTIL DEL PRODUCTO.CUMPLEREQ.DECALIDAD: SICUMPLEREQ.DEINOCUIDAD: SI 7755139002571 - 2",
  "marca": "DEL NORTE",
  "codigo": "7755139002571 - 2",
  "cantidad": 28,
  "importe_pen": 6208.22
}

Devuelve SOLO un JSON válido, sin texto adicional, sin markdown, sin ```, con esta forma EXACTA:

{
  "productos": [
    {
      "descripcion": "string o null",
      "marca": "string o null",
      "codigo": "string o null",
      "cantidad": number o null,
      "precio_unitario": number o null,
      "importe_pen": number o null
    }
  ]
}

Reglas adicionales:
1. Devuelve UNA entrada por cada fila/producto de la tabla (puede haber 1 o varios productos).
2. IMPORTANTE: el documento puede tener varias páginas, y algunas OCAM/OCF repiten la MISMA tabla de productos en más de una página. Si detectas el MISMO producto (mismo código, misma descripción, misma cantidad) en más de una página, inclúyelo UNA SOLA VEZ.
3. cantidad, precio_unitario e importe_pen deben ser números (punto decimal, sin "S/", sin comas de miles, sin texto).
4. Si un dato no aparece en el texto, pon null — nunca inventes valores.
5. No agregues explicaciones, notas ni texto fuera del JSON.
"""


def _limpiar_json(texto: str) -> dict:
    texto = texto.strip()
    texto = re.sub(r"^```json", "", texto, flags=re.IGNORECASE).strip()
    texto = re.sub(r"^```", "", texto).strip()
    texto = re.sub(r"```$", "", texto).strip()
    return json.loads(texto)


def _marca_sospechosa(marca: Optional[str], descripcion: Optional[str]) -> bool:
    """
    Detecta cuando Gemini alucinó y mezcló el campo 'marca' con texto
    de la descripción (pasa cuando la fila trae 2 menciones de
    "MARCA:" — una decorativa dentro de la descripción y otra la
    columna real — y el modelo las funde en una sola cadena larga).

    Señales de contaminación:
    - Trae palabras clave que SOLO deberían estar en la descripción
      (GARANTÍA, CONT.NETO, CUMPLE REQ, GRADO DE CALIDAD, etc.).
    - Tiene demasiadas palabras para ser una marca real.
    - Es casi tan larga como la descripción completa (se solaparon).
    """
    if not marca:
        return False
    marca_up = marca.upper()
    palabras_clave_descripcion = (
        "GARANT", "CONT.NETO", "CONT NETO", "CUMPLE REQ",
        "GRADO DE CALIDAD", "UNIDAD DE DESPACHO", "ENV.PRIMARIO",
        "VIDA ÚTIL", "VIDA UTIL", "LONGITUD DEL GRANO",
    )
    if any(clave in marca_up for clave in palabras_clave_descripcion):
        return True
    if len(marca.split()) > 6:
        return True
    if descripcion and len(marca) > 0.5 * len(descripcion):
        return True
    return False


def _normalizar(productos: list[dict]) -> list[dict]:
    normalizados = []
    for p in productos:
        cantidad = p.get("cantidad")
        precio = p.get("precio_unitario")
        importe = p.get("importe_pen")
        descripcion = p.get("descripcion")
        marca = p.get("marca")

        if _marca_sospechosa(marca, descripcion):
            logger.warning(
                f"Marca descartada por sospecha de alucinación (mezcla con descripción): {marca[:100]!r}"
            )
            marca = None

        normalizados.append({
            "descripcion": descripcion,
            "marca": marca,
            "codigo": p.get("codigo"),
            "cantidad": str(cantidad) if cantidad is not None else None,
            "precio_unitario": f"{precio:.2f}" if isinstance(precio, (int, float)) else precio,
            "importe_pen": f"{importe:.2f}" if isinstance(importe, (int, float)) else importe,
        })
    return normalizados

def _deduplicar_productos(productos: list[dict]) -> list[dict]:
    agrupados: dict[str, dict] = {}
    orden: list[str] = []
    for p in productos:
        clave = (p.get("codigo") or "").strip() or f"{p.get('descripcion','')}|{p.get('cantidad','')}"
        if clave not in agrupados:
            agrupados[clave] = dict(p)
            orden.append(clave)
        else:
            existente = agrupados[clave]
            for campo in ("descripcion", "marca", "codigo", "cantidad", "precio_unitario", "importe_pen"):
                if not existente.get(campo) and p.get(campo):
                    existente[campo] = p[campo]
    return [agrupados[k] for k in orden]

async def extraer_productos_gemini(texto_pdf: str) -> dict:
    """
    Prueba cada modelo de MODELOS_CANDIDATOS en orden:
    - 404 (no disponible para esta cuenta) o 429 (cuota de ESE modelo
      agotada) -> se pasa al siguiente modelo de inmediato, sin esperar
      (no cuesta nada, la petición nunca se procesó del lado de Google).
    - 503 (servidor saturado) -> se reintenta el MISMO modelo hasta 2
      veces con espera corta, porque es temporal.
    - Cualquier otro error (JSON roto, etc.) -> se corta ahí mismo y
      cae a regex_fallback, sin seguir probando modelos.
    Si TODOS los candidatos fallan por 404/429, recién ahí cae a
    regex_fallback.
    """
    vacio = {"productos": [], "fuente": "regex_fallback", "tokens": None, "error": None}
    if not texto_pdf or not texto_pdf.strip():
        return vacio

    MAX_INTENTOS_503_POR_MODELO = 2
    ESPERA_503_SEGUNDOS = 5

    errores_por_modelo: list[str] = []

    for modelo in MODELOS_CANDIDATOS:
        for intento in range(1, MAX_INTENTOS_503_POR_MODELO + 1):
            try:
                cliente = get_client()
                response = await cliente.aio.models.generate_content(
                    model=modelo,
                    contents=f"{SYSTEM_PROMPT}\n\nTexto de la orden:\n\n{texto_pdf}",
                    config=types.GenerateContentConfig(
                        temperature=0,
                        response_mime_type="application/json",
                        max_output_tokens=8192,
                    ),
                )

                finish_reason = None
                if response.candidates:
                    finish_reason = getattr(response.candidates[0], "finish_reason", None)
                    if finish_reason is not None and str(finish_reason) != "FinishReason.STOP":
                        logger.warning(f"[{modelo}] terminó con finish_reason={finish_reason} (no STOP) — posible corte de salida")

                contenido = response.text
                if not contenido or not contenido.strip():
                    raise ValueError(f"[{modelo}] devolvió respuesta vacía (finish_reason={finish_reason})")

                try:
                    data = _limpiar_json(contenido)
                except json.JSONDecodeError as je:
                    logger.warning(f"[{modelo}] devolvió JSON inválido ({je}). Texto crudo (primeros 500 chars): {contenido[:500]!r}")
                    raise

                productos = data.get("productos", [])
                if not isinstance(productos, list):
                    raise ValueError(f"[{modelo}] no devolvió una lista de productos")

                tokens = None
                uso = getattr(response, "usage_metadata", None)
                if uso is not None:
                    tokens = {
                        "prompt": getattr(uso, "prompt_token_count", None),
                        "completion": getattr(uso, "candidates_token_count", None),
                        "total": getattr(uso, "total_token_count", None),
                    }

                productos = _deduplicar_productos(_normalizar(productos))
                logger.info(f"[{modelo}] extracción OK ({tokens.get('total') if tokens else '?'} tokens)")
                return {"productos": productos, "fuente": "gemini", "tokens": tokens, "error": None}

            except Exception as e:
                texto_error = str(e)
                es_503 = "503" in texto_error or "UNAVAILABLE" in texto_error
                es_404 = "404" in texto_error or "NOT_FOUND" in texto_error
                es_429 = "429" in texto_error or "RESOURCE_EXHAUSTED" in texto_error

                if es_503 and intento < MAX_INTENTOS_503_POR_MODELO:
                    espera = ESPERA_503_SEGUNDOS * intento
                    logger.warning(f"[{modelo}] 503 (saturado, intento {intento}/{MAX_INTENTOS_503_POR_MODELO}), reintentando en {espera}s...")
                    await asyncio.sleep(espera)
                    continue

                if es_404 or es_429:
                    motivo = "no disponible para esta cuenta" if es_404 else "cuota agotada"
                    logger.warning(f"[{modelo}] descartado ({motivo}), probando siguiente modelo candidato...")
                    errores_por_modelo.append(f"{modelo}: {type(e).__name__}: {e}")
                    break  # pasa al siguiente modelo del for externo

                # Error real (JSON roto, etc.) — no sigue probando modelos.
                logger.warning(f"[{modelo}] falló, se usará el regex como fallback: {type(e).__name__}: {e}")
                return {**vacio, "error": f"{modelo}: {e}"}

    logger.warning(f"Todos los modelos candidatos fallaron por 404/429, se usará el regex como fallback: {errores_por_modelo}")
    return {**vacio, "error": "todos_los_candidatos_agotados: " + " | ".join(errores_por_modelo)}