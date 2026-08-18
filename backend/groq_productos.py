"""
groq_productos.py
Refina la extracción de productos de la OCAM usando Groq sobre el TEXTO
NATIVO que ya extrae pdfplumber en ficha_ocr.py (extraer_texto_pdf).
No usa visión: el texto ya es correcto, lo que falla es el regex al
separar descripcion/marca/codigo/cantidad/precios. Groq lo parsea mejor.
"""
import os
import json
import re
import asyncio
import logging
from groq import AsyncGroq, RateLimitError

logger = logging.getLogger("helbot.groq_productos")

# openai/gpt-oss-120b: modelo de texto vigente en Groq, con modo JSON.
# (llama-3.3-70b-versatile fue deprecado el 17/06/2026)
LLM_MODEL_PRODUCTOS = os.getenv("LLM_MODEL_PRODUCTOS", "openai/gpt-oss-120b")

_groq_client = None


def get_client() -> AsyncGroq:
    global _groq_client
    if _groq_client is None:
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY no está configurada en el .env")
        # max_retries=0: UN SOLO intento real a la API. Si el SDK
        # reintentaba por debajo, cada 429 disparaba varias llamadas
        # facturables sin que tú lo controlaras.
        _groq_client = AsyncGroq(api_key=api_key, max_retries=0)
    return _groq_client


SYSTEM_PROMPT = """Eres un extractor de datos de órdenes de compra del Estado peruano (OCAM de Perú Compras).
Recibirás el texto plano completo (ya extraído correctamente, con capa de texto nativo del PDF) de una orden de compra.
La tabla de productos tiene estas columnas: Nro | Ficha - producto | Marca | Código Único de Producto | Cantidad | (a veces Precio Unitario Total Sin IGV | IGV) | Importe (PEN).

REGLA CRÍTICA — NO TRUNQUES NADA:
- "descripcion" = el CONTENIDO COMPLETO de la columna "Ficha - producto", palabra por palabra, tal cual aparece — INCLUSO si ese texto vuelve a mencionar "MARCA:" o el código de producto dentro de sí mismo (pasa seguido en las OCAM, es normal, cópialo TODO igual, no te detengas ahí).
- "marca" = el CONTENIDO COMPLETO de la columna "Marca", que puede tener una o varias palabras (ej: "INSTITUCIONAL SUPER", nunca solo la primera palabra "INSTITUCIONAL").

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
2. IMPORTANTE: el documento puede tener varias páginas, y algunas OCAM/OCF repiten la MISMA tabla de productos en más de una página (ej. una versión resumida y otra con precio unitario/IGV desglosado). Si detectas el MISMO producto (mismo código, misma descripción, misma cantidad) en más de una página, inclúyelo en el resultado UNA SOLA VEZ — nunca lo dupliques. Si una de las páginas trae más datos (ej. precio_unitario que en la otra página no aparecía), usa esos datos más completos en la única entrada que devuelvas para ese producto.
2. cantidad, precio_unitario e importe_pen deben ser números (punto decimal, sin "S/", sin comas de miles, sin texto).
3. Si un dato no aparece en el texto, pon null — nunca inventes valores.
4. No agregues explicaciones, notas ni texto fuera del JSON.
"""


def _limpiar_json(texto: str) -> dict:
    texto = texto.strip()
    texto = re.sub(r"^```json", "", texto, flags=re.IGNORECASE).strip()
    texto = re.sub(r"^```", "", texto).strip()
    texto = re.sub(r"```$", "", texto).strip()
    return json.loads(texto)


def _normalizar(productos: list[dict]) -> list[dict]:
    """Deja los tipos igual que tu regex actual (strings), para no romper
    nada que ya use datos.otros['productos'] esperando strings."""
    normalizados = []
    for p in productos:
        cantidad = p.get("cantidad")
        precio = p.get("precio_unitario")
        importe = p.get("importe_pen")
        normalizados.append({
            "descripcion": p.get("descripcion"),
            "marca": p.get("marca"),
            "codigo": p.get("codigo"),
            "cantidad": str(cantidad) if cantidad is not None else None,
            "precio_unitario": f"{precio:.2f}" if isinstance(precio, (int, float)) else precio,
            "importe_pen": f"{importe:.2f}" if isinstance(importe, (int, float)) else importe,
        })
    return normalizados


def _deduplicar_productos(productos: list[dict]) -> list[dict]:
    """
    Las OCAM/OCF de Perú Compras suelen repetir la MISMA tabla de
    productos en más de una página del PDF (ej. página 1 = versión
    resumida sin precio unitario, página 2 = versión detallada con
    precio unitario/IGV) -> sin esto, Groq ve la tabla 2 veces y
    devuelve el mismo producto duplicado.

    Se agrupa por código (o por descripción+cantidad si no hay código)
    y se queda con UNA sola entrada por producto real, combinando el
    dato más completo de cada campo entre los duplicados (ej. si la
    página 1 no trae precio_unitario pero la página 2 sí, se usa el de
    la página 2).
    """
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


MAX_REINTENTOS_GROQ = 4  # además de los reintentos internos del cliente (max_retries=5)


async def extraer_productos_groq(texto_pdf: str) -> dict:
    """
    UN SOLO intento a Groq, sin reintentos propios ni del SDK. Si falla
    por lo que sea (rate limit, JSON roto, etc.) se cae directo al
    fallback de regex — nunca se gasta una segunda llamada.

    Devuelve:
    {
        "productos": [...],
        "fuente": "groq" | "regex_fallback",
        "tokens": {"prompt": int, "completion": int, "total": int} | None,
        "error": str | None,
    }
    """
    vacio = {"productos": [], "fuente": "regex_fallback", "tokens": None, "error": None}
    if not texto_pdf or not texto_pdf.strip():
        return vacio

    client = get_client()
    try:
        response = await client.chat.completions.create(
            model=LLM_MODEL_PRODUCTOS,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": f"Texto de la orden:\n\n{texto_pdf}"},
            ],
            temperature=0,
            max_completion_tokens=3000,
            response_format={"type": "json_object"},
        )
        contenido = response.choices[0].message.content
        data = _limpiar_json(contenido)
        productos = data.get("productos", [])
        if not isinstance(productos, list):
            raise ValueError("Groq no devolvió una lista de productos")

        uso = getattr(response, "usage", None)
        tokens = None
        if uso is not None:
            tokens = {
                "prompt": getattr(uso, "prompt_tokens", None),
                "completion": getattr(uso, "completion_tokens", None),
                "total": getattr(uso, "total_tokens", None),
            }

        productos = _deduplicar_productos(_normalizar(productos))
        return {"productos": productos, "fuente": "groq", "tokens": tokens, "error": None}

    except RateLimitError as e:
        logger.warning(f"Groq rate limit (sin reintentar, un solo intento por diseño): {e}")
        return {**vacio, "error": "rate_limit"}

    except Exception as e:
        logger.warning(f"extraer_productos_groq falló, se usará el regex como fallback: {e}")
        return {**vacio, "error": str(e)}