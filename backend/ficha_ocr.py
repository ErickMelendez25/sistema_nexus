"""
Helbot - ficha_ocr.py
----------------------
OCR/parseo de la Orden de Compra (OCAM) que sube el personal 1.
Las OCAM de Perú Compras son PDFs con texto nativo (no escaneados), así
que se extraen directo con pdfplumber — no requieren OCR. Si algún día
llega un PDF escaneado (sin capa de texto), cae automáticamente al
fallback de OCR con Tesseract.
"""

import io
import re
import logging
from typing import Optional

from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel

from db import get_conn, guardar_json
from gemini_productos import extraer_productos_gemini

logger = logging.getLogger("helbot.ficha_ocr")
logging.basicConfig(level=logging.INFO)


class DatosFicha(BaseModel):
    unidad_ejecutora: Optional[str] = None
    codigo_unidad_ejecutora: Optional[str] = None
    expediente: Optional[str] = None
    entidad: Optional[str] = None
    producto: Optional[str] = None
    cantidad: Optional[str] = None
    monto: Optional[str] = None
    fecha: Optional[str] = None
    otros: Optional[dict] = None


# ============================================================
# Extracción de texto
# ============================================================
def extraer_texto_pdf(pdf_bytes: bytes) -> str:
    """PDF con texto nativo (caso normal de las OCAM de Perú Compras)."""
    try:
        import pdfplumber
        partes = []
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for pagina in pdf.pages:
                partes.append(pagina.extract_text() or "")
        texto = "\n".join(partes)
    except Exception as e:
        logger.warning(f"pdfplumber falló: {e}")
        texto = ""

    # Si el PDF no tenía capa de texto (escaneado), cae a OCR por imagen.
    if len(texto.strip()) < 30:
        logger.info("PDF sin texto nativo detectado, probando OCR por imagen...")
        texto = _ocr_pdf_escaneado(pdf_bytes)
    return texto


def _ocr_pdf_escaneado(pdf_bytes: bytes) -> str:
    try:
        from pdf2image import convert_from_bytes
        import pytesseract
        paginas = convert_from_bytes(pdf_bytes, dpi=300)
        return "\n".join(pytesseract.image_to_string(p, lang="spa") for p in paginas)
    except Exception as e:
        logger.warning(f"OCR de PDF escaneado falló (¿falta poppler-utils?): {e}")
        return ""


def extraer_texto_imagen(imagen_bytes: bytes) -> str:
    """Para cuando suben foto/captura en vez de PDF."""
    try:
        import pytesseract
        from PIL import Image
        img = Image.open(io.BytesIO(imagen_bytes))
        return pytesseract.image_to_string(img, lang="spa")
    except Exception as e:
        logger.warning(f"OCR de imagen falló: {e}")
        return ""


# ============================================================
# Parseo — ajustado al formato exacto de la OCAM de Perú Compras
# ============================================================
def _seccion(texto: str, inicio: str, finales: list[str]):

    texto_up = texto.upper()

    ini = texto_up.find(inicio.upper())

    if ini == -1:
        return ""

    fin = len(texto)

    for f in finales:
        pos = texto_up.find(f.upper(), ini)

        if pos != -1 and pos < fin:
            fin = pos

    return texto[ini:fin]



def _extraer_productos(texto: str) -> list[dict]:
    """
    Extrae TODOS los productos de la tabla detallada de la página 2
    (la que trae Cantidad / Precio Unitario / Total (Sin IGV) / IGV /
    Importe (PEN)). Soporta 1 o más productos (fila '1', '2', '3'...).

    OJO: pdfplumber a veces pega las palabras del encabezado de columna
    sin espacio (ej. "PrecioUnitario"), así que el encabezado se busca
    con espacio OPCIONAL.

    OJO 2: cuando la descripción del producto es larga, el PDF la
    envuelve en varias líneas físicas. Marca/Código/Cantidad/Precios
    quedan TODOS pegados en la PRIMERA línea física de la fila, y las
    líneas siguientes son puro texto de descripción que continúa —
    incluyendo, muchas veces, una SEGUNDA mención de "MARCA:" dentro
    del propio texto descriptivo (ej. "...UNIDAD MARCA: P PROSERLIM
    ESCOBILLON..."). Por eso NO usamos la última aparición de "MARCA:"
    (esa es la decorativa, sin números después) — en su lugar buscamos
    la aparición de "MARCA:" que esté seguida DIRECTAMENTE por
    <marca> <código> <cantidad> <precios...>, que es la única
    combinación real de columnas. Todo el resto del texto (antes Y
    después de ese bloque) se concatena como la descripción completa.
    """
    m_header = re.search(r"Precio\s*Unitario", texto)
    if not m_header:
        logger.warning("_extraer_productos: no se encontró el encabezado 'Precio Unitario' en el texto del PDF")
        return []
    idx_header = m_header.start()

    m_fin = re.search(r"IMPORTE\s*TOTAL\s*\(?\s*PEN\s*\)?", texto[idx_header:])
    idx_fin = idx_header + m_fin.start() if m_fin else len(texto)
    bloque = texto[idx_header:idx_fin]

    productos = []
    filas = re.finditer(
        r"(?:^|\n)\s*(\d{1,2})\s+([A-ZÁÉÍÓÚÑ].*?)(?=\n\s*\d{1,2}\s+[A-ZÁÉÍÓÚÑ]|$)",
        bloque,
        re.DOTALL,
    )

    patron_datos = re.compile(
        r"MARCA:\s*(?P<marca>\S+(?:\s+\S+){0,3}?)\s+"
        r"(?P<codigo>[\w./]+(?:\s*-\s*[\w./]+)?)\s+"
        r"(?P<cantidad>\d{1,4})\s+"
        r"(?P<numeros>(?:[\d,]+\.\d{2}\s*){1,4})",
        re.DOTALL,
    )

    # Fallback: algunas OCAM (ej. el formato "FISICA" que trae Página 1
    # de 2 / Página 2 de 2) NO traen la etiqueta "MARCA:" en el texto
    # -> la columna Marca viene pegada directo antes del código, sin
    # ningún label. En ese caso anclamos por el CÓDIGO (patrón
    # NNN.NNNNNN típico de Perú Compras) en vez de por "MARCA:".
    patron_datos_sin_marca = re.compile(
        r"(?P<marca>[A-ZÁÉÍÓÚÑ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ]{2,}){0,3})\s+"
        r"(?P<codigo>\d{2,4}\.\d{4,8})\s+"
        r"(?P<cantidad>\d{1,4})\s+"
        r"(?P<numeros>(?:[\d,]+\.\d{2}\s*){1,4})",
        re.DOTALL,
    )

    for m in filas:
        contenido = m.group(2)

        m_datos = patron_datos.search(contenido)
        usa_marca_literal = m_datos is not None
        if not m_datos:
            m_datos = patron_datos_sin_marca.search(contenido)

        if not m_datos:
            logger.warning(
                f"_extraer_productos: no se pudo separar marca/código/cantidad en: {contenido[:120]!r}"
            )
            continue

        antes = contenido[:m_datos.start()]
        despues = contenido[m_datos.end():]
        descripcion = " ".join((antes + " " + despues).split())

        # La marca puede repetirse en más de una mención de "MARCA:" en
        # la fila (una vez en la columna real, y otra dentro del propio
        # texto de la descripción). Tomamos la mención con MÁS palabras
        # limpias (letras only, sin números, sin palabras gigantes que
        # delaten dos palabras pegadas por pérdida de espacio en el PDF
        # original) — así preferimos "P PROSERLIM" sobre solo "P" si
        # esa versión más completa aparece en alguna mención.
        candidatos_marca = [m_datos.group("marca").strip()]

        # Cuando NO hay "MARCA:" literal, el texto suele repetir el
        # CÓDIGO una segunda vez más adelante en la fila (artefacto del
        # wrap de columnas de pdfplumber), y justo antes de esa segunda
        # aparición suele venir la marca completa (ej. "ROLLOS
        # INSTITUCIONAL SUPER 004.022005"). La usamos como candidato
        # extra si es más larga que la que ya tenemos.
        if not usa_marca_literal:
            codigo_txt = m_datos.group("codigo")
            for m_otra in re.finditer(re.escape(codigo_txt), contenido):
                if m_otra.start() == m_datos.start("codigo"):
                    continue
                palabras_antes = contenido[:m_otra.start()].split()[-3:]
                palabras_antes = [p for p in palabras_antes if p.isalpha()]
                if palabras_antes:
                    candidatos_marca.append(" ".join(palabras_antes))

        for m_otra in re.finditer(r"MARCA:\s*", contenido):
            palabras = []
            for tok in contenido[m_otra.end():].split():
                if any(ch.isdigit() for ch in tok) or len(tok) > 15:
                    break
                palabras.append(tok)
                if len(palabras) >= 2:
                    break
            if palabras:
                candidatos_marca.append(" ".join(palabras))

        marca = max(candidatos_marca, key=lambda c: len(c.split()))
        codigo = " ".join(m_datos.group("codigo").split())
        cantidad = m_datos.group("cantidad")
        numeros = [n.replace(",", "") for n in m_datos.group("numeros").split()]
        precio_unitario = numeros[0] if numeros else None
        importe_pen = numeros[-1] if numeros else None

        productos.append({
            "descripcion": descripcion,
            "marca": marca,
            "codigo": codigo,
            "cantidad": cantidad,
            "precio_unitario": precio_unitario,
            "importe_pen": importe_pen,
        })

    return productos


def _recortar_texto_para_groq(texto: str, ventana: int = 3000) -> str:
    """
    Devuelve SOLO los fragmentos del texto que contienen tablas de
    productos, en vez del PDF completo.

    Las OCAM traen secciones enormes (DATOS DE LA ENTIDAD, DATOS DEL
    PROVEEDOR, DATOS DEL LUGAR DE ENTREGA, direcciones, RUCs, etc.) que
    no sirven para nada en la extracción de productos, pero Groq las
    cobra igual como tokens de entrada. Cada tabla de productos siempre
    termina en "IMPORTE TOTAL (PEN)", así que por cada aparición de ese
    marcador tomamos los `ventana` caracteres previos (de sobra para
    cubrir toda la tabla, encabezado incluido) y descartamos el resto.

    Si el documento repite la tabla en 2 páginas, se toman los 2
    bloques (uno por cada "IMPORTE TOTAL (PEN)" que aparezca).
    """
    marcador = re.compile(r"IMPORTE\s*TOTAL\s*\(?\s*PEN\s*\)?", re.IGNORECASE)
    spans = []
    for m in marcador.finditer(texto):
        inicio = max(0, m.start() - ventana)
        fin = m.end()
        spans.append([inicio, fin])

    if not spans:
        # No se encontró el marcador -> no hay forma segura de recortar,
        # se manda el texto completo para no perder productos.
        return texto

    # Fusiona bloques que se solapan (ej. 2 tablas muy seguidas).
    spans.sort()
    fusionados = [spans[0]]
    for inicio, fin in spans[1:]:
        if inicio <= fusionados[-1][1]:
            fusionados[-1][1] = max(fusionados[-1][1], fin)
        else:
            fusionados.append([inicio, fin])

    return "\n\n".join(texto[i:f] for i, f in fusionados)

def parsear_campos_ocam(texto: str) -> DatosFicha:
    def buscar(patron, fuente=texto, flags=re.IGNORECASE):
        m = re.search(patron, fuente, flags)
        return m.group(1).strip(" :\n") if m else None

    numero_ocam = buscar(r"(OCAM-\d{4}-\d+-\d+-\d+)")

    # =====================================================
    # BLOQUES POR SECCIÓN
    # =====================================================
    m_entidad = re.search(r"DATOS DE LA ENTIDAD(.*?)(?=DATOS DEL PROVEEDOR)", texto, re.DOTALL)
    bloque_entidad = m_entidad.group(1) if m_entidad else ""

    m_proveedor = re.search(
        r"DATOS DEL PROVEEDOR(.*?)(?=Nro Ficha|DATOS DE RESPONSABLES|DATOS DE LA CONTRATACIÓN|DATOS DEL LUGAR)",
        texto, re.DOTALL,
    )
    bloque_proveedor = m_proveedor.group(1) if m_proveedor else ""

    m_lugar = re.search(
        r"DATOS DEL LUGAR DE ENTREGA(.*?)(?=DATOS DE LA CONTRATACIÓN|DATOS DE RESPONSABLES|Nro Ficha|$)",
        texto, re.DOTALL,
    )
    bloque_lugar = m_lugar.group(1) if m_lugar else ""

    m_contratacion = re.search(
        r"DATOS DE LA CONTRATACIÓN(.*?)(?=DATOS DEL LUGAR DE ENTREGA|DATOS DE RESPONSABLES|Nro Ficha|$)",
        texto, re.DOTALL,
    )
    bloque_contratacion = m_contratacion.group(1) if m_contratacion else ""

    # Catálogo: el título va en 2 líneas separadas por la columna
    # derecha de "DATOS PARA EL PAGO DE LA PRESTACIÓN", así que
    # pdfplumber las mezcla en una sola línea, ej.:
    # "EXT-CE-2024-3 MATERIALES E INSUMOS DE LIMPIEZA, DATOS PARA EL
    # PAGO DE LA PRESTACIÓN". Tomamos esa primera línea completa y
    # cortamos todo lo que venga después de "DATOS PARA", que es donde
    # se pega el texto de la columna derecha.
    catalogo_raw = buscar(r"([A-Z]{2,6}-[A-Z]{2,6}-\d{4}-\d+\s+[^\n]+)")
    catalogo = None
    if catalogo_raw:
        catalogo = re.split(r",?\s*DATOS PARA", catalogo_raw)[0].strip().rstrip(",").strip()

    fecha = buscar(r"Fecha de formalización\s*:\s*(\d{2}/\d{2}/\d{4})")

    expediente = buscar(r"Expediente\s*SIAF\s*:\s*(\d+)", bloque_contratacion) or buscar(r"Expediente\s*SIAF\s*:\s*(\d+)")

    # Plazo de entrega: "Del 30/07/2026 al 04/08/2026" -> nos quedamos con la 2da fecha
    # Plazo de entrega: "Del 30/07/2026 al 04/08/2026" -> nos quedamos con la 2da fecha.
    # OJO: buscamos en el TEXTO COMPLETO, no en bloque_contratacion. La
    # etiqueta "DATOS DE LA CONTRATACIÓN" puede aparecer 2 veces en el
    # documento (una fragmentada por el layout en columnas de la página
    # 1, y la sección real y completa en la página 2) — bloque_contratacion
    # toma la PRIMERA aparición y se corta antes de llegar a la sección
    # de la página 2 donde realmente vive "Plazo de entrega", dejando
    # este campo vacío. Como la etiqueta "Plazo de entrega" es lo
    # bastante única en todo el documento, es más seguro buscarla
    # directo en el texto completo.
    m_plazo = re.search(
        r"Plazo de entrega\s*:\s*Del\s*(\d{2}/\d{2}/\d{4})\s*al\s*(\d{2}/\d{2}/\d{4})",
        texto,
    )
    fecha_max_entrega = m_plazo.group(2) if m_plazo else None
    plazo_entrega_raw = f"Del {m_plazo.group(1)} al {m_plazo.group(2)}" if m_plazo else None

    monto = buscar(r"IMPORTE\s+TOTAL\s*\(PEN\)\s*([\d,]+\.\d{2})")
    estado = buscar(r"Estado\s*:\s*([A-Z/ ]+)")

    # Lugar de entrega
    direccion_entrega = buscar(r"Dirección\s*:\s*([^\n]+)", bloque_lugar)
    referencia_entrega = buscar(r"Referencia\s*:\s*([^\n]+)", bloque_lugar)
    distrito_entrega = buscar(r"Distrito\s*:\s*([^\n]+)", bloque_lugar)
    provincia_entrega = buscar(r"Provincia\s*:\s*([^\n]+)", bloque_lugar)
    departamento_entrega = buscar(r"Departamento\s*:\s*([^\n]+)", bloque_lugar)

    # Fallback: algunas OCAM (ej. Puno) NO traen "Distrito:"/"Provincia:"/
    # "Departamento:" como etiquetas separadas -> en su lugar traen un
    # único campo "Ubigeo : DISTRITO / PROVINCIA / DEPARTAMENTO", ej.
    # "PUNO / PUNO / PUNO" o "JULI /CHUCUITO/ PUNO". Si algún campo
    # quedó vacío arriba, lo rellenamos partiendo ese Ubigeo por "/".
    if not (distrito_entrega and provincia_entrega and departamento_entrega):
        ubigeo_entrega = buscar(r"Ubigeo\s*:\s*([^\n]+)", bloque_lugar)
        if ubigeo_entrega:
            partes_ubigeo = [p.strip() for p in ubigeo_entrega.split("/")]
            if len(partes_ubigeo) == 3:
                distrito_entrega = distrito_entrega or partes_ubigeo[0]
                provincia_entrega = provincia_entrega or partes_ubigeo[1]
                departamento_entrega = departamento_entrega or partes_ubigeo[2]
            else:
                logger.warning(
                    f"Ubigeo de entrega con formato inesperado (no son 3 partes separadas por '/'): {ubigeo_entrega!r}"
                )

    # Entidad
    ruc_entidad = buscar(r"RUC\s*:\s*(\d{11})", bloque_entidad)
    entidad = buscar(r"Razón Social\s*:\s*([^\n]+)", bloque_entidad)
    ejecutora = buscar(r"Ejecutora\s*:\s*([^\n]+)", bloque_entidad)

    codigo_unidad = None
    ejecutora_nombre = None
    if ejecutora:
        m = re.search(r"\[(\d+)\]", ejecutora)
        if m:
            codigo_unidad = m.group(1)  # ej. "300708", tal cual, sin quitar ceros
        ejecutora_nombre = re.sub(r"\s*\[\d+\]", "", ejecutora).strip()

    productos = _extraer_productos(texto)
    primero = productos[0] if productos else {}

    # Proveedor
    ruc_proveedor = buscar(r"RUC\s*:\s*(\d{11})", bloque_proveedor)
    proveedor = buscar(r"Razón Social\s*:\s*(.*?)\s*Tipo de Entrega", bloque_proveedor, re.DOTALL)
    if proveedor:
        proveedor = " ".join(proveedor.split())

    # =====================================================
    # PRODUCTO — descripción multilínea completa + código + marca +
    # cantidad + precios, desde la fila "1 ..." de la tabla de productos.
    # El grupo 1 es GREEDY a propósito: como el texto de descripción a
    # veces repite la palabra "MARCA:" dentro de sí mismo, el greedy
    # hace que el regex se quede con la ÚLTIMA aparición de "MARCA:"
    # como el campo real de marca, y todo lo anterior como descripción.
    # =====================================================
    descripcion_producto = primero.get("descripcion")
    marca_producto = primero.get("marca")
    codigo_producto = primero.get("codigo")
    cantidad = primero.get("cantidad")
    precio_unitario = primero.get("precio_unitario")
    importe_pen_producto = primero.get("importe_pen")
    total_sin_igv = None  # _extraer_productos no separa esta columna todavía

    print("=" * 100)
    print(texto)
    print("=" * 100)

    return DatosFicha(
        unidad_ejecutora=codigo_unidad,       # ahora el NÚMERO "300708", no el nombre
        codigo_unidad_ejecutora=codigo_unidad,
        expediente=expediente,
        entidad=entidad,
        producto=descripcion_producto,
        cantidad=cantidad,
        monto=monto,
        fecha=fecha,
        otros={
            "numero_ocam": numero_ocam,
            "ejecutora_nombre": ejecutora_nombre,
            "ruc_entidad": ruc_entidad,
            "ruc_proveedor": ruc_proveedor,
            "proveedor": proveedor,
            "estado": estado,
            "codigo_producto": codigo_producto,
            "marca_producto": marca_producto,
            "precio_unitario": precio_unitario,
            "total_sin_igv": total_sin_igv,
            "importe_pen_producto": importe_pen_producto,
            "productos": productos,           # lista COMPLETA, para 2+ productos
            "plazo_entrega": plazo_entrega_raw,
            "fecha_max_entrega": fecha_max_entrega,
            "catalogo": catalogo,
            "direccion_entrega": direccion_entrega,
            "referencia_entrega": referencia_entrega,
            "distrito_entrega": distrito_entrega,
            "provincia_entrega": provincia_entrega,
            "departamento_entrega": departamento_entrega,
        },
    )


router = APIRouter(prefix="/ficha", tags=["Ficha OCR"])


@router.post("/ocr")
async def ocr_ficha(
    archivo: UploadFile = File(...),
    publicada_id: Optional[str] = Form(None),
    solo_ubigeo: bool = Form(False),
):
    contenido = await archivo.read()
    nombre = (archivo.filename or "").lower()
    es_pdf = nombre.endswith(".pdf") or archivo.content_type == "application/pdf"

    texto = extraer_texto_pdf(contenido) if es_pdf else extraer_texto_imagen(contenido)

    if not texto.strip():
        raise HTTPException(status_code=422, detail="No se pudo extraer texto de la ficha")

    datos = parsear_campos_ocam(texto)

    # solo_ubigeo=true -> el caller solo necesita departamento/provincia/
    # distrito de entrega (ya viene del regex en parsear_campos_ocam), no
    # necesita productos -> no vale la pena gastar tokens de Groq aquí.
    if solo_ubigeo:
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO fichas_ocr (publicada_id, datos_extraidos) VALUES (%s,%s)",
                    (publicada_id, guardar_json(datos.dict())),
                )
        finally:
            conn.close()
        return {"ok": True, "datos": datos, "texto_crudo": texto}

    # Recorta el texto ANTES de mandarlo a Groq: solo el bloque de la(s)
    # tabla(s) de productos, no la ficha completa (entidad/proveedor/
    # lugar de entrega no sirven para esto y solo suman tokens de
    # entrada, subiendo el riesgo de 429).
    texto_para_groq = _recortar_texto_para_groq(texto)

    try:
        resultado_ia = await extraer_productos_gemini(texto_para_groq)
    except Exception as e:
        logger.warning(f"Gemini no pudo refinar productos, se usa el resultado del regex: {e}")
        resultado_ia = {"productos": [], "fuente": "regex_fallback", "tokens": None, "error": str(e)}

    productos_groq = resultado_ia["productos"]
    fuente_productos = resultado_ia["fuente"]        # "gemini" | "regex_fallback"
    tokens_groq = resultado_ia["tokens"]              # {"prompt","completion","total"} | None

    if productos_groq:
        # Antes de pisar la lista con la de Gemini: matcheamos cada
        # producto de Gemini con el que ya había sacado el regex
        # (_extraer_productos), usando un código NORMALIZADO (sin
        # espacios) y, si eso falla, el código BASE (la parte antes del
        # guión) — porque Gemini a veces trunca el sufijo "- N" y ya no
        # coincide exacto con lo que sacó el regex.
        def _normalizar_codigo(c: str) -> str:
            return re.sub(r"\s+", "", c or "")

        productos_regex_por_codigo = {}
        productos_regex_por_base = {}
        for p_r in datos.otros.get("productos", []):
            cod_r = (p_r.get("codigo") or "").strip()
            if not cod_r:
                continue
            norm_r = _normalizar_codigo(cod_r)
            productos_regex_por_codigo[norm_r] = p_r
            productos_regex_por_base[norm_r.split("-")[0]] = p_r

        for p in productos_groq:
            codigo_groq = (p.get("codigo") or "").strip()
            norm_groq = _normalizar_codigo(codigo_groq)
            p_regex = (
                productos_regex_por_codigo.get(norm_groq)
                or productos_regex_por_base.get(norm_groq)
                or productos_regex_por_base.get(norm_groq.split("-")[0])
            )

            if not p.get("marca") and p_regex and p_regex.get("marca"):
                logger.info(f"Rellenando marca faltante desde el regex para código {codigo_groq!r}: {p_regex['marca']!r}")
                p["marca"] = p_regex["marca"]

            if not p.get("descripcion") and p_regex and p_regex.get("descripcion"):
                p["descripcion"] = p_regex["descripcion"]

            # El código es un dato estructurado -> el regex es más
            # confiable que la IA para esto. Si el regex encontró un
            # código MÁS COMPLETO (con sufijo "- N" que Gemini truncó),
            # usamos el del regex en vez del de Gemini.
            if p_regex and p_regex.get("codigo"):
                norm_regex_codigo = _normalizar_codigo(p_regex["codigo"])
                if len(norm_regex_codigo) > len(norm_groq):
                    logger.info(f"Código truncado por Gemini ({codigo_groq!r}), usando el completo del regex: {p_regex['codigo']!r}")
                    p["codigo"] = p_regex["codigo"]

        datos.otros["productos"] = productos_groq
        primero = productos_groq[0]
        datos.producto = primero.get("descripcion") or datos.producto
        datos.cantidad = primero.get("cantidad") or datos.cantidad
        datos.otros["marca_producto"] = primero.get("marca") or datos.otros.get("marca_producto")
        datos.otros["codigo_producto"] = primero.get("codigo") or datos.otros.get("codigo_producto")
        datos.otros["precio_unitario"] = primero.get("precio_unitario") or datos.otros.get("precio_unitario")
        datos.otros["importe_pen_producto"] = primero.get("importe_pen") or datos.otros.get("importe_pen_producto")
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO fichas_ocr (publicada_id, datos_extraidos) VALUES (%s,%s)",
                (publicada_id, guardar_json(datos.dict())),
            )
    finally:
        conn.close()

    return {
        "ok": True,
        "datos": datos,
        "texto_crudo": texto,
        "fuente_productos": fuente_productos,
        "tokens_groq": tokens_groq,
    }