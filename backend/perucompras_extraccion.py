#perucompras_extraccion.py
# ==========================================================
# EXTRACTOR PROFORMAS PERUCOMPRAS
# VERSION FULL PROFESIONAL
# ==========================================================
import random
import requests
import time
import re
from datetime import datetime, timedelta




import os


import pandas as pd


import unicodedata
from difflib import get_close_matches




import hashlib
import logging
from db import get_conn

from monitor_publicadas import monitor_de
import perucompras_reportes

logger = logging.getLogger("helbot.perucompras_extraccion")



def normalizar_ficha(texto):

    if not texto:
        return ""

    texto = texto.upper()

    # eliminar saltos de linea
    texto = texto.replace("\n", " ")

    # eliminar espacios multiples
    texto = re.sub(r"\s+", " ", texto)

    # quitar espacios antes/despues de :
    texto = re.sub(r"\s*:\s*", ":", texto)

    # quitar espacios extremos
    texto = texto.strip()

    return texto

def limpiar_marca(texto):
    """
    Si el texto empieza con 'MARCA:' lo elimina y devuelve solo la marca limpia.
    Si no tiene prefijo, devuelve el texto tal cual.
    """
    if not texto:
        return ""
    texto = texto.upper().strip()
    # Elimina 'MARCA:' si está al inicio
    texto = re.sub(r'^MARCA\s*:\s*', '', texto)
    return texto.strip()


# ==========================================================
# EXTRAER NOMBRE PRODUCTO DESDE FICHA
# ==========================================================

def extraer_producto_desde_ficha(ficha):

    if not ficha:
        return ""

    texto = ficha.strip()

    # buscar todo lo que está antes de :
    match = re.match(r"^\s*([^:]+)\s*:", texto)

    if match:
        return match.group(1).strip().upper()

    return ""


# ==========================================================
# EXTRAER DEPARTAMENTO / PROVINCIA / DISTRITO
# ==========================================================
# Lista de departamentos
DEPARTAMENTOS_PERU = [
    "AMAZONAS","ANCASH","APURIMAC","AREQUIPA","AYACUCHO","CAJAMARCA","CALLAO",
    "CUSCO","HUANCAVELICA","HUANUCO","ICA","JUNIN","LA LIBERTAD","LAMBAYEQUE",
    "LIMA","LORETO","MADRE DE DIOS","MOQUEGUA","PASCO","PIURA","PUNO",
    "SAN MARTIN","TACNA","TUMBES","UCAYALI"
]

def normalizar_texto(texto):
    """
    Normaliza un texto: mayúsculas, sin tildes y sin espacios extras
    """
    texto = texto.upper().strip()
    texto = unicodedata.normalize('NFD', texto).encode('ascii', 'ignore').decode('utf-8')
    texto = re.sub(r'\s+', ' ', texto)
    return texto


LONGITUD_MAX_CATALOGO = 100  # debe ser <= al tamaño real de la columna `catalogo` en MySQL

def _slug_catalogo(nombre: str) -> str:
    """
    Convierte el nombre real del catálogo (ej. 'Papeles de Aseo y Limpieza')
    en una clave válida tipo constante (ej. 'PAPELES_DE_ASEO_Y_LIMPIEZA'),
    igual al formato que usaban las claves hardcodeadas antes.
    Se trunca a LONGITUD_MAX_CATALOGO para nunca reventar la columna MySQL,
    aunque venga un nombre kilométrico desde Perú Compras.
    """
    texto = normalizar_texto(nombre)  # ya existe arriba: mayúsculas + sin tildes
    texto = re.sub(r'[^A-Z0-9]+', '_', texto)
    texto = texto.strip('_')
    texto = texto[:LONGITUD_MAX_CATALOGO].rstrip('_')
    return texto or "CATALOGO_SIN_NOMBRE"

def extraer_departamento_robusto(direccion):
    """
    Extrae departamento, provincia y distrito de forma más robusta.
    Departamento y provincia se mantienen igual que antes.
    Distrito ahora toma todo el nombre completo.
    """
    if not direccion:
        return "", "", ""

    direccion = normalizar_texto(direccion)
    partes = [p.strip() for p in direccion.split("/") if p.strip()]

    departamento, provincia, distrito = "", "", ""

    if len(partes) >= 3:
        # Caso estándar: DEPARTAMENTO/PROVINCIA/DISTRITO
        departamento_cand = partes[-3].split()[-1]  # se mantiene como antes
        provincia_cand = partes[-2].split()[-1]    # se mantiene como antes
        distrito_cand = partes[-1]                  # <-- tomar todo el bloque completo

        # Validar departamento
        dep_match = get_close_matches(departamento_cand, DEPARTAMENTOS_PERU, n=1, cutoff=0.7)
        if dep_match:
            departamento = dep_match[0]

        provincia = provincia_cand
        distrito = distrito_cand  # ahora completo

    elif len(partes) == 2:
        provincia_cand = partes[-2].split()[-1]
        distrito_cand = partes[-1]  # <-- tomar todo el bloque completo

        provincia = provincia_cand
        distrito = distrito_cand

        dep_match = get_close_matches(partes[-2], DEPARTAMENTOS_PERU, n=1, cutoff=0.7)
        if dep_match:
            departamento = dep_match[0]

    elif len(partes) == 1:
        distrito_cand = partes[-1]  # <-- tomar todo el bloque completo
        distrito = distrito_cand

        dep_match = get_close_matches(direccion, DEPARTAMENTOS_PERU, n=1, cutoff=0.7)
        if dep_match:
            departamento = dep_match[0]

    return departamento, provincia, distrito

# ==========================================================
#  LOG PROFESIONAL CONSOLA
# ==========================================================

def log_linea():
    print("═" * 120)

def log_titulo(texto):
    log_linea()
    print(f"🚀 {texto.center(116)}")
    log_linea()

def log_catalogo(nombre):
    print("\n")
    log_linea()
    print(f"📦 CATÁLOGO: {nombre}".ljust(118))
    log_linea()

def log_requerimiento(req):
    print(f"\n🔎 REQUERIMIENTO: {req}")

def log_producto(registro):
    print(
        f"✔ #{registro['N°']:05} | "
        f"{registro['PRODUCTO'][:45]:45} | "
        f"MARCA: {registro['MARCA'][:15]:15} | "
        f"COD: {registro['CODIGO_UNICO'][:12]:12} | "
        f"PRECIO: {registro['PRECIO_OFERTADO']:>10} | "
        f"ENTIDAD: {registro['ENTIDAD'][:25]}"
    )


# ==========================================================
# 🧠 DICCIONARIO DE MARCAS
# ==========================================================

MARCAS_DICC = [
"W&M SIRYCATA","ITZEL","D-SANIZ","PÓMAC","MILLENNIUM","KYSER","SERCONSLIMP",
"COVENANT","C3 P","SUPREMIO","ULTRA+","RINRI","RAYMI","APOLO","BELONA",
"ISIS","ECOKASA","PARILU","SINCHY","CIRCE","DELSA","REGGIO","D SALOME",
"JARVIS","CICLÓN","ECOLIMPIA","SILGAL","DIONNE","SUAVISSA","PILLKO",
"AYCER","MAXCER","ANAX","STEEL FORJA","PLASTIC STEEL FORJA","DICALI",
"AITY","+ASEO","LAMOSA CLEAN","H TOOLS","DQ DELQUIMS","NOELIA",
"CELESTINA","JAWASS","VIANFORTPRO","BIODECOR","BLANUX","MUCHICK",
"YOREL","PROSERLIM","ZENCLEAN","GOOD CLEANER","TACLLA","EBRIEL",
"JAZAY","VICRO","LIFAL","RAGNAR","SALPE","REY PLAST","SMARTPLAST",
"CERCOR","CETOOL","ATOJ","BUGUI","ESTRELLA DEL NORTE","DARYAL",
"DULQUI","GP GRIUPOLY","OSCCONTA","INDUBRILL","KUELAP","RHOMANSA",
"INSOMED","NEW KRAL","ESE","MAXIMASS","WYPALL","JOGRANSA","DIMAGSA",
"PROLIM","BOMELSA","ECOSOFT","MAPIALE","TEXTILES ECOKASA","THN",
"DARYZA","SOLMATIC","DOÑA MARIA","AGLAB","ECONORACKS","FABARLI",
"DALHI","MAGINSA","MAFA","SCOTT","LIMCOFER","WHUAYRA","INVEMATT",
"YANNICK","INVERCOM PERU","SFOLL","DAYR","RS PASSIONES TEX",
"NEW AYMAX","PULIZIA","PERCUS","T&R CLEANER","DERMA PRO","FACIL",
"HOUSE LIVING","MVILLEGAS","BASA","AIME","JHANSE","ELITE",
"ARUBBA","WIPE MASTER","ARIESS","MEGACOM","YERICO","NORT COLTON",
"JEKMAYCAN","TOOLBOX","COMPAKTO1","SCARLETT","INSTITUCIONAL SUPER",
"ELITE PROFESSIONAL","MELISSA","GLAX","+PRO","HI LIMP","SUMAC",
"TOILÉ","THAILER","3Q PLASTICS","FONLEA","CERMAX CLEAN","3Q COTTONS",
"CAPACMAYO","FBK PERÚ","VIRUTEX","LACTISOFT","ALESSI","MAXTIC",
"PRL PARILU EXPRESS","MOTITA","LEONSOL","ALICAF","LYNO","ELLIA",
"PARACAS","CISNE","MASSIA","LA FOQUITA","PROLIMSO","CHACON",
"F FERNELLY","SIAL","GRAFI PAPEL","J&R STEEL CP","SANIT","FONCHY",
"FAMILY DOCTOR","BIGNER","MAYA","TUINIES","SUPER","WEST MICROSAFE",
"AYAX","KLEENEX","HANDEEL","BRILLOL'S","DERQUSA","Q MASTER","SUAVE",
"VIBALCA","PETALO","BUBBLE",
"KASQUI","KOMILON","COSTEÑO","MENESTRERO","DEL CIELO","PAISANA",
"CERRO GRANDE","JAPRIM","MOLINO ROJO","COSTEÑITO","OLLITA",
"FORTILIFE","PALMA REAL","DEL NORTE","PURA CAÑA","HOJA REDONDA",
"DEL HOGAR","DOÑA RUFI",
"VITALIA","CIELO"
]

# ==========================================================
# DETECTAR MARCA
# ==========================================================

def detectar_marca(ficha):

    texto = ficha.upper()

    match = re.search(r"MARCA\s*:\s*([A-Z0-9 +&'.-]+)", texto)

    if match:

        posible = match.group(1).strip()

        for marca in sorted(MARCAS_DICC, key=len, reverse=True):

            if posible.startswith(marca):
                return marca

    for marca in sorted(MARCAS_DICC, key=len, reverse=True):

        if f" {marca} " in f" {texto} ":
            return marca

    return ""


# ==========================================================
# EXTRAER CODIGO
# ==========================================================

def extraer_codigo_desde_ficha(ficha):

    if not ficha:
        return ""

    texto = ficha.upper()

    texto = texto.replace("–", "-").replace("—", "-")
    texto = re.sub(r'\s+', ' ', texto).strip()

    texto = re.sub(r'\b\d{13,15}\b', ' ', texto)
    texto = re.sub(r'\b\d+(\.\d+)?\s*-\s*\d+(\.\d+)?\b', ' ', texto)

    corte = int(len(texto) * 0.65)
    texto_final = texto[corte:]

    patrones = [

        r'\b[A-Z0-9]+(?:\+[A-Z0-9]+){1,}\b',
        r'\b[A-Z0-9]+(?:-[A-Z0-9.%]+){2,}\b',
        r'\b[A-Z0-9]{2,}\s*-\s*[A-Z0-9.]+\b',
        r'\b[A-Z]{3,}\s+\d{3,8}\b|\b\d{3,8}\s+[A-Z]{3,}\b',
        r'\b[A-Z]{2,}\d+[A-Z0-9.%]*\b',
        r'\b\d{5,8}\b',
    ]

    for patron in patrones:

        matches = list(re.finditer(patron, texto_final))

        if matches:
            return matches[-1].group(0).strip()

    return ""


# ==========================================================
# OBTENER IMAGEN
# ==========================================================

def obtener_url_imagen_desde_pdf(pdf_url):

    if not pdf_url:
        return ""

    img_url = pdf_url.replace(
        "/Documentos/Productos/",
        "/Imagenes/Productos/"
    )

    img_url = img_url.rsplit(".", 1)[0] + ".jpg"

    return img_url


# ==========================================================
# EXTRACCION
# ==========================================================

def obtener_catalogos_mysql(session, progreso: dict | None = None, pc_session_ref=None, run_id: int | None = None, uid: str = ""):
    """
    `session` = pc_session.session, el requests.Session YA autenticado que
    usa perucompras_filtros.py (viene de perucompras_sesiones.sesion(uid)).
    No hace falta Selenium ni cookies nuevas — la sesión ya vive en memoria.
    `progreso` = dict compartido con el router, para reportar avance al frontend.
    """
    import contextlib
    # 🔒 Mismo candado que usa el monitor de publicadas (sesion.request_lock
    # en PeruComprasSession). Sin esto, el scan del monitor y esta
    # extracción competían por la misma sesión HTTP y Perú Compras la
    # mataba a la mitad, cortando el resto de catálogos.
    _lock_sesion = pc_session_ref.request_lock if pc_session_ref is not None else contextlib.nullcontext()

    log_titulo("EXTRACTOR PROFORMAS PERUCOMPRAS (vía sesión FastAPI)")

    session.headers.update({
        "User-Agent": "Mozilla/5.0",
        "Accept": "*/*",
        "Origin": "https://catalogos.perucompras.gob.pe",
        "Referer": "https://catalogos.perucompras.gob.pe/t_Proforma",
    })

    url_buscar = "https://catalogos.perucompras.gob.pe/t_Proforma/buscar"
    url_detalle = "https://catalogos.perucompras.gob.pe/t_Proforma/cargarCotizar"

    monitor = monitor_de(uid)
    if monitor is None:
        logger.error(f"No hay monitor configurado para uid='{uid}' — no se puede armar la lista de catálogos")
        return {}

    combos = monitor._obtener_combos(session)  # usa la misma caché de 6h que ya usa /perucompras/acuerdos

    catalogos: dict[str, dict] = {}
    claves_usadas: set[str] = set()

    for n_acuerdo, n_catalogo in combos:
        acuerdo_info = monitor._acuerdos_info.get(n_acuerdo, {})
        catalogo_info = monitor._catalogos_info.get(n_catalogo, {})

        # 🚫 Salta acuerdos marco que no están vigentes
        if not acuerdo_info.get("vigente", True):
            continue

        # 🚫 Salta catálogos individuales que no están vigentes,
        # aunque su acuerdo marco padre sí lo esté (caso EXT-CE-2024-12:
        # el acuerdo vive, pero "Cerámicos" y "Sanitarios" ya no).
        if not catalogo_info.get("vigente", True):
            continue

        nombre_catalogo = catalogo_info.get("nombre") or f"CATALOGO_{n_catalogo}"
        clave = _slug_catalogo(nombre_catalogo)

        # Si dos catálogos distintos generan la misma clave (nombres parecidos),
        # le agregamos el N_Catalogo al final para no pisarnos uno a otro.
        if clave in claves_usadas:
            clave = f"{clave}_{n_catalogo}"
        claves_usadas.add(clave)

        catalogos[clave] = {
            "N_Acuerdo": str(n_acuerdo),
            "N_Catalogo": str(n_catalogo),
        }

    if not catalogos:
        logger.warning(f"⚠️ No se encontraron catálogos vigentes para uid='{uid}' — revisa acuerdos_info")

    print(f"\n📋 CATÁLOGOS A EXTRAER ({len(catalogos)} vigentes): {list(catalogos.keys())}")

    resultado_final = {}

    fila_pagina = 1  # contador global que aumenta por cada producto registrado
    claves_vistas = set()  # para evitar duplicados

    

    # ==========================================================
    # FECHAS DINAMICAS
    # ==========================================================

    from datetime import datetime, timedelta

    # Fecha actual
    hoy = datetime.now()

    # Día de la semana
    dia_semana = hoy.weekday()

    # Lógica:
    # Viernes (4) → +3 días (hasta lunes)
    # Sábado (5) → +3 días (hasta martes)
    # Otros días → +1 día
    if dia_semana == 4:  # viernes
        dias_sumar = 3
    elif dia_semana == 5:  # sábado
        dias_sumar = 3
    else:
        dias_sumar = 1

    # Calcular fechas
    fecha_inicio_dt = hoy
    fecha_fin_dt = hoy + timedelta(days=dias_sumar)

    # Formato requerido
    fecha_inicio = fecha_inicio_dt.strftime("%d/%m/%Y")
    fecha_fin = fecha_fin_dt.strftime("%d/%m/%Y")

    print(f"\n📅 FILTRO FECHA: {fecha_inicio}  →  {fecha_fin}")

    marcas_config = perucompras_reportes.obtener_marcas_config(uid)
    catalogos_registros_globales: dict[str, list[dict]] = {}

    for nombre_catalogo, valores in catalogos.items():
    
 

        log_catalogo(nombre_catalogo)

        payload = {
            "N_Acuerdo": (None, valores["N_Acuerdo"]),
            "N_Catalogo": (None, valores["N_Catalogo"]),
            "N_Categoria": (None, ""),
            "C_PalabraClave": (None, ""),
           "C_Estado": (None, ""),
            "C_Procedimiento": (None, ""),
            "N_EscompraPorPaquete": (None, ""),
            "C_FechaInicio": (None, fecha_inicio),
            "C_FechaFin": (None, fecha_fin),
            "N_Estrategia": (None, "")
        }
        print("📡 Consultando API buscar...")

        with _lock_sesion:
            session.headers.pop("Content-Type", None)  # 👈 evita Content-Type pegado sin boundary
            r = session.post(
                url_buscar,
                files=payload,
                timeout=30,
            )
        print("✅ Respuesta recibida")

        try:
            data = r.json()
        except Exception as e:
            print(f"🛑 Respuesta NO es JSON (status={r.status_code}): {r.text[:300]}")
            logger.error(f"[{nombre_catalogo}] buscar() devolvió no-JSON: {r.text[:300]}")
            resultado_final[nombre_catalogo] = []
            catalogos_registros_globales[nombre_catalogo] = []
            registrar_detalle_run(run_id, nombre_catalogo, 0, 0)
            continue

        # 🔎 ESTO ES LO QUE FALTABA — antes asumías "vacío = no hay
        # registros" sin saber si Perú Compras estaba rechazando la
        # búsqueda por otro motivo.
        print(f"🔎 cod_rpta={data.get('cod_rpta')} mensaje_rpta={data.get('mensaje_rpta')!r}")
        logger.info(f"[{nombre_catalogo}] cod_rpta={data.get('cod_rpta')} mensaje_rpta={data.get('mensaje_rpta')}")

        lista = data.get("pLista")

        if not lista:
            print("⚠️ No se encontraron registros")
            resultado_final[nombre_catalogo] = []
            catalogos_registros_globales[nombre_catalogo] = []
            registrar_detalle_run(run_id, nombre_catalogo, 0, 0)
            continue

        registros_catalogo = []
        
        claves_vistas = set()

        fila_pagina = 1

        for item in lista:
            req_num = item.get("C_Requerimento", "???")
            log_requerimiento(req_num)


            req = item.get("N_Requerimento")
            proforma = item.get("N_Proforma")
            es_paquete = item.get("N_EsCompraPorPaquete","0")

            # --- Traer detalle del requerimiento
            if str(es_paquete) == "1":
                print("📦 REQUERIMIENTO ES PAQUETE")

                body_detalle = {
                    "N_Requerimiento": (None, str(req)),
                    "N_Proforma": (None, ""),
                    "N_EsCompraPorPaquete": (None, "1")
                }

            else:

                body_detalle = {
                    "N_Requerimiento": (None, str(req)),
                    "N_Proforma": (None, str(proforma if proforma else 0)),
                    "N_EsCompraPorPaquete": (None, "0")
                }

            # =========================================
            # PETICIÓN + PARSEO CON REINTENTOS
            # =========================================
            # No toda falla es "sesión muerta" — un timeout puntual o una
            # respuesta vacía momentánea NO deben tirar el catálogo entero.
            # Reintentamos hasta 3 veces con backoff antes de rendirnos.
            MAX_INTENTOS = 3
            detalle = None
            sesion_realmente_muerta = False

            for intento in range(1, MAX_INTENTOS + 1):
                try:
                    with _lock_sesion:
                        session.headers.pop("Content-Type", None)  # 👈 evita Content-Type pegado sin boundary
                        r2 = session.post(
                            url_detalle,
                            files=body_detalle,
                            timeout=30,
                        )
                    detalle = r2.json()
                    break  # éxito -> sale del loop de reintentos
                except Exception as e:
                    cuerpo = ""
                    try:
                        cuerpo = r2.text[:200]
                    except Exception:
                        pass
                    # Si el cuerpo trae HTML de login, es sesión muerta de
                    # verdad — no tiene sentido reintentar, cortamos ya.
                    if "<html" in cuerpo.lower() or "iniciar sesion" in cuerpo.lower() or "login" in cuerpo.lower():
                        print(f"⚠️ Respuesta HTML de login detectada — sesión real caída (intento {intento}/{MAX_INTENTOS}).")
                        sesion_realmente_muerta = True
                        break
                    print(f"⚠️ Fallo de red/parseo en intento {intento}/{MAX_INTENTOS} del requerimiento {req_num}: {e}")
                    if intento < MAX_INTENTOS:
                        pausa_reintento = random.uniform(1, 2) * intento
                        print(f"   Reintentando en {pausa_reintento:.1f}s...")
                        time.sleep(pausa_reintento)


            if detalle is None:
                if sesion_realmente_muerta:
                    # Solo aquí SÍ confirmamos que la sesión murió de verdad
                    # (Peru Compras devolvió HTML de login) — ahora sí tiene
                    # sentido cortar TODO el catálogo, porque cualquier
                    # petición siguiente va a fallar igual.
                    if pc_session_ref is not None:
                        pc_session_ref.estado = "perdida"
                        # Antes esto NO disparaba el callback on_sesion_perdida
                        # (el de main.py que cierra Chrome y avisa por WS) —
                        # solo se seteaba el estado en silencio. Se dispara acá
                        # igual que lo hace monitor_publicadas.py.
                        if getattr(pc_session_ref, "on_sesion_perdida", None):
                            try:
                                pc_session_ref.on_sesion_perdida(pc_session_ref.usuario)
                            except Exception as cb_err:
                                logger.warning(f"Error en callback on_sesion_perdida: {cb_err}")
                    logger.warning(
                        f"Sesión de Perú Compras confirmada muerta (HTML de login) en el "
                        f"requerimiento {req_num} del catálogo {nombre_catalogo}. "
                        f"Se guarda lo recolectado en este catálogo hasta ahora y se continúa con el siguiente."
                    )
                    break
                else:
                    # Timeout / respuesta vacía puntual — la sesión sigue
                    # viva (puede haberse renovado por keep-alive mientras
                    # tanto). NO abortamos el catálogo entero: solo nos
                    # saltamos este requerimiento y seguimos con el resto.
                    logger.warning(
                        f"Perú Compras no respondió JSON tras {MAX_INTENTOS} intentos en el "
                        f"requerimiento {req_num} del catálogo {nombre_catalogo} (timeout/red, "
                        f"sesión sigue activa). Se omite solo este requerimiento y se continúa "
                        f"con los demás del mismo catálogo."
                    )
                    continue

            if not isinstance(detalle, dict):
                print("⚠️ JSON inválido")
                continue

            obj = detalle.get("pObjecto")



            if not obj:
                print("⚠️ Requerimiento sin detalle")
                continue

            # =====================================
            # EXTRAER INDICADOR SEMAFORO ENTIDAD
            # =====================================
            semaforo_valor = int(obj.get("N_EntidadIndicadorSemaforo") or 0)

            semaforo_color = "ROJO" if semaforo_valor == 1 else "VERDE"




            productos = obj.get("productos", [])
            entregas = obj.get("entregas", [])

            es_paquete = int(obj.get("N_EsCompraPorPaquete") or 0)

            print(f"📦 Encontrados {len(productos)} productos en este requerimiento")

            print(f"📦 PAQUETE detectado: {len(entregas)} entregas")

            for p_idx, p in enumerate(productos, start=1):
                proformas = p.get("proformas") or [p]  # si no hay proformas, usamos el producto como fallback

                print(f"   🔹 Producto {p_idx}: {p.get('C_Producto','')} con {len(proformas)} proformas")

            # =========================================
            # CASO NORMAL (NO PAQUETE)
            # =========================================
            if es_paquete != 1:

                for p_idx, p in enumerate(productos, start=1):

                    proformas = p.get("proformas") or [p]

                    for pf_idx, pf in enumerate(proformas, start=1):
                        ficha = pf.get("C_Ficha", "")
                        marca = pf.get("C_Marca","") or detectar_marca(ficha)
                        marca = limpiar_marca(marca)
                        codigo = pf.get("C_Codigo_Unico","") or extraer_codigo_desde_ficha(ficha)
                        proforma_id = pf.get("N_Proforma") or item.get("N_Proforma")

                        
                        
                        codigo = codigo.replace(" ", "").upper()
                        detalle_id = (
                            str(pf.get("N_Item","")) +
                            str(pf.get("N_Secuencia","")) +
                            str(pf.get("N_ItemEntrega",""))
                        )

                        archivo_producto = pf.get("C_ArchivoDescriptivo","")
                        archivo_req = pf.get("C_RequerimientoPDF","")
                        pdf_producto = f"https://saeusceprod01.blob.core.windows.net/contproveedor/Documentos/Productos/{archivo_producto}" if archivo_producto else ""
                        pdf_requerimiento = f"https://saeusceprod01.blob.core.windows.net/contproveedor/Documentos/Requerimientos/{archivo_req}" if archivo_req else ""
                        imagen = obtener_url_imagen_desde_pdf(pdf_producto)
                        cantidad = pf.get("N_Cantidad",0)
                        precio_unitario = pf.get("N_PrecioUnitarioBase",0)
                        precio_ofertado = pf.get("N_PrecioOfertado",0)
                        producto_nombre = extraer_producto_desde_ficha(ficha) or pf.get("C_Producto","")

                        print(f"📌 PROFORMA_ID capturado: {proforma_id} para producto {producto_nombre}")

                        # Si hay entregas, iteramos sobre ellas; si no, creamos al menos un registro
                        entregas_a_usar = entregas or [{}]  # fallback: lista con un dict vacío

                        for e in entregas_a_usar:
                            detalles = e.get("pDetalle_Entregas", []) or [None]  # fallback: al menos un registro

                            for det in detalles:
                                direccion = e.get("C_Direccion","") if e else ""

                                departamento, provincia, distrito = extraer_departamento_robusto(direccion)

                                detalle_id = ""

                                if det:
                                    detalle_id = (
                                        str(det.get("N_Item","")) +
                                        str(det.get("N_Secuencia","")) +
                                        str(det.get("N_ItemEntrega",""))
                                    )


                                registro = {
                                    "N°": fila_pagina,
                                    "UID_PERUCOMPRAS": uid,
                                    "FECHA_GUARDADO": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                    "REQUERIMIENTO": item.get("C_Requerimento",""),
                                    "PROFORMA": item.get("C_Proforma",""),
                                    "N_PROFORMA_ID": proforma_id,   # 👈 AGREGA ESTA LINEA
                                    "N_ENTIDAD_SEMAFORO": semaforo_valor,
                                    "COLOR_SEMAFORO": semaforo_color,
                                    "ESTADO": (item.get("C_Estado") or "")[:30],
                           
                                    "PROCEDIMIENTO": obj.get("C_Procedimiento",""),
                                    "FECHA_EMISION": item.get("C_FechaEmision",""),
                                    "FECHA_LIMITE_COTIZACION": item.get("C_FechLimCoti",""),
                                    "ENTIDAD": item.get("C_Entidad",""),
                                    "RUC": item.get("C_Ruc",""),
                                    "PRODUCTO": producto_nombre,
                                    "FICHA_PRODUCTO": ficha,
                                    "MARCA": marca,
                                    "CODIGO_UNICO": codigo,
                                    "DETALLE_ENTREGA_ID": detalle_id,   # 👈 AGREGA ESTA LINEA
                                    "CANTIDAD": cantidad,
                                    "PRECIO_UNITARIO_BASE": precio_unitario,
                                    "PRECIO_OFERTADO": precio_ofertado,
                                    "MONEDA": p.get("C_Moneda",""),

                                    "DIRECCION_ENTREGA": e.get("C_Direccion","") if e else "",

                                    "DEPARTAMENTO": departamento,
                                    "PROVINCIA": provincia,
                                    "DISTRITO": distrito,
                                    "FECHA_INICIO_ENTREGA": e.get("C_FInicioEntrega","") if e else "",
                                    "FECHA_FIN_ENTREGA": e.get("C_FFinEntrega","") if e else "",
                                    "PLAZO_DIAS": e.get("N_Plazo","") if e else "",
                                    "SUBTOTAL": e.get("N_SubTotal",0) if e else 0,
                                    "COSTO_PRODUCTOS": e.get("N_CostoProductos",0) if e else 0,
                                    "COSTO_ENVIO": e.get("N_CostoEnvio",0) if e else 0,
                                    "IGV": e.get("N_ImporteIGV",0) if e else 0,
                                    "PDF_PRODUCTO": pdf_producto,
                                    "PDF_REQUERIMIENTO": pdf_requerimiento,
                                    "IMAGEN_PRODUCTO": imagen
                                }

                                # ================================
                                # CLAVE UNICA
                                # ================================

                                clave = (
                                    registro["REQUERIMIENTO"].strip(),
                                    registro["PROFORMA"].strip(),
                                    registro["RUC"].strip(),
                                    registro["CODIGO_UNICO"].strip(),
                                    normalizar_ficha(registro["FICHA_PRODUCTO"]),
                                    registro["DETALLE_ENTREGA_ID"]
                                )
                                # ================================
                                # CONTROL DUPLICADOS
                                # ================================

                                if clave not in claves_vistas:

                                    claves_vistas.add(clave)

                                    registros_catalogo.append(registro)

                                
                                    fila_pagina += 1

                                    log_producto(registro)

                                else:

                                    print("⚠️  DUPLICADO IGNORADO")

            # =========================================
            # CASO PAQUETE
            # =========================================
            # =========================================
            # CASO PAQUETE
            # =========================================
            else:

                print("📦 PROCESANDO PAQUETE")

                for prod_idx, prod in enumerate(productos, start=1):

                    nombre_producto = prod.get("C_Producto", "")

                    proformas = prod.get("proformas") or [prod]

                    for pf_idx, pf in enumerate(proformas, start=1):

                        ficha = pf.get("C_Ficha", "")

                        marca = limpiar_marca(pf.get("C_Marca") or detectar_marca(ficha))

                        codigo = (pf.get("C_Codigo_Unico") or extraer_codigo_desde_ficha(ficha))
                        codigo = str(codigo).replace(" ", "").upper()

                        # Primero intento tomar del producto/proforma
                        # Captura segura de N_PROFORMA_ID
                        if pf.get("N_Proforma") is not None:
                            proforma_id = pf["N_Proforma"]
                        elif prod.get("N_Proforma") is not None:
                            proforma_id = prod["N_Proforma"]
                        elif item.get("N_Proforma") is not None:
                            proforma_id = item["N_Proforma"]
                        else:
                            proforma_id = 0

                        
            

                        producto_nombre = extraer_producto_desde_ficha(ficha) or nombre_producto

                        print(f"📌 PROFORMA_ID capturado: {proforma_id} para producto {producto_nombre}")

                        for entrega in (entregas or [{}]):

                            direccion = entrega.get("C_Direccion", "")

                            departamento, provincia, distrito = extraer_departamento_robusto(direccion)

                            for item_entrega in (entrega.get("m_RProductoEntrega") or [{}]):

                                detalles = item_entrega.get("pDetalle_Entregas") or [None]

                    

                                for det_idx, det in enumerate(detalles, start=1):

                                    cantidad = det.get("N_Cantidad",0) if det else pf.get("N_Cantidad",0)

                                    precio = det.get("N_PrecioUnitarioBase",0) if det else pf.get("N_PrecioUnitarioBase",0)

                                    precio_ofertado = det.get("N_PrecioOfertado",precio) if det else pf.get("N_PrecioOfertado",precio)

                                    detalle_id = ""

                                    if det:
                                        detalle_id = f"{det.get('N_Item','')}{det.get('N_Secuencia','')}{det.get('N_ItemEntrega','')}"

                                    archivo_producto = pf.get("C_ArchivoDescriptivo","")

                                    pdf_producto = ""
                                    if archivo_producto:
                                        pdf_producto = f"https://saeusceprod01.blob.core.windows.net/contproveedor/Documentos/Productos/{archivo_producto}"

                                    imagen = obtener_url_imagen_desde_pdf(pdf_producto)


                                    registro = {
                                        "N°": fila_pagina,
                                        "UID_PERUCOMPRAS": uid,
                                        "FECHA_GUARDADO": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                                        "REQUERIMIENTO": req_num,
                                        "PROFORMA": pf.get("C_Proforma",""),
                                        "N_PROFORMA_ID": proforma_id,
                                        "N_ENTIDAD_SEMAFORO": semaforo_valor,
                                        "COLOR_SEMAFORO": semaforo_color,
                                        "ESTADO": (item.get("C_Estado") or "")[:30],
                           
                                        "PROCEDIMIENTO": obj.get("C_Procedimiento",""),
                                        "FECHA_EMISION": item.get("C_FechaEmision",""),
                                        "FECHA_LIMITE_COTIZACION": item.get("C_FechLimCoti",""),
                                        "ENTIDAD": item.get("C_Entidad",""),
                                        "RUC": item.get("C_Ruc",""),
                                        "PRODUCTO": producto_nombre,
                                        "FICHA_PRODUCTO": ficha,
                                        "MARCA": marca,
                                        "CODIGO_UNICO": codigo,
                                        "DETALLE_ENTREGA_ID": detalle_id,
                                        "CANTIDAD": cantidad,
                                        "PRECIO_UNITARIO_BASE": precio,
                                        "PRECIO_OFERTADO": precio_ofertado,
                                        "MONEDA": pf.get("C_Moneda",""),
                                        "DIRECCION_ENTREGA": direccion,
                                        "DEPARTAMENTO": departamento,
                                        "PROVINCIA": provincia,
                                        "DISTRITO": distrito,
                                        "FECHA_INICIO_ENTREGA": entrega.get("C_FInicioEntrega",""),
                                        "FECHA_FIN_ENTREGA": entrega.get("C_FFinEntrega",""),
                                        "PLAZO_DIAS": entrega.get("N_Plazo",""),
                                        "SUBTOTAL": det.get("N_SubTotal",0) if det else 0,
                                        "COSTO_PRODUCTOS": det.get("N_PrecioUnitarioTotal",0) if det else 0,
                                        
                                        "COSTO_ENVIO": entrega.get("N_CostoEnvio",0),
                                        "IGV": det.get("N_ImporteIGV",0) if det else 0,
                                        "PDF_PRODUCTO": pdf_producto,    
                                        "PDF_REQUERIMIENTO": "",
                                        "IMAGEN_PRODUCTO": imagen
                                    }

                                    clave = (
                                        str(registro["REQUERIMIENTO"]).strip(),
                                        str(registro["PROFORMA"]).strip(),
                                        str(registro["RUC"]).strip(),
                                        str(registro["CODIGO_UNICO"]).strip(),
                                        normalizar_ficha(str(registro["FICHA_PRODUCTO"])),
                                        str(detalle_id),
                                        prod_idx,
                                        pf_idx,
                                        det_idx
                                    )

                                    if clave not in claves_vistas:

                                        claves_vistas.add(clave)

                                        registros_catalogo.append(registro)

                                        fila_pagina += 1

                                        log_producto(registro)
                                    else:
                                        print("⚠️ DUPLICADO PAQUETE IGNORADO")

                  
                         

        log_linea()
        print(f"📊 TOTAL REGISTROS GUARDADOS: {len(registros_catalogo)}")

        nuevos, registros_con_id = insertar_registros_mysql(nombre_catalogo, registros_catalogo)
        print(f"💾 INSERTADOS {nuevos} REGISTROS NUEVOS EN MYSQL ({nombre_catalogo})")

        restringidos = perucompras_reportes.clasificar_restringidos(registros_con_id, marcas_config)
        perucompras_reportes.guardar_restringidos_mysql(run_id, nombre_catalogo, restringidos)
        print(f"🚫 {len(restringidos)} filas marcadas como restringidas en este catálogo")

        marcas_objetivo_filas = perucompras_reportes.clasificar_marcas_objetivo(registros_con_id, marcas_config)
        perucompras_reportes.guardar_marcas_objetivo_mysql(run_id, nombre_catalogo, marcas_objetivo_filas)
        print(f"🏷️  {len(marcas_objetivo_filas)} filas marcadas como marca objetivo en este catálogo")
        log_linea()

        registrar_detalle_run(run_id, nombre_catalogo, len(registros_catalogo), nuevos)

        catalogos_registros_globales[nombre_catalogo] = registros_con_id
        resultado_final[nombre_catalogo] = registros_catalogo
        if progreso is not None:
            progreso["catalogo_actual"] = nombre_catalogo
            progreso["catalogos_completados"] = progreso.get("catalogos_completados", 0) + 1
            progreso["total_filas"] = progreso.get("total_filas", 0) + len(registros_catalogo)

    # ==========================================
    # GENERAR ARCHIVO MARCAS
    # ==========================================

    print("\n📊 Generando reportes Excel (historial, marcas, restringidos, acumulado)...")
    try:
        perucompras_reportes.generar_todos_los_reportes(catalogos_registros_globales, run_id, uid)
    except Exception as e:
        logger.warning(f"No se pudieron generar los reportes Excel: {e}")

    print("\n🏁 EXTRACCIÓN COMPLETADA (guardada en MySQL + Excel)\n")
    return resultado_final



def insertar_registros_mysql(catalogo: str, registros: list[dict]) -> tuple[int, list[dict]]:
    if not registros:
        return 0, []
    conn = get_conn()
    insertados = 0
    registros_con_id = []

    ids_a_descartar = [] 
    try:
        with conn.cursor() as cur:
            for r in registros:
                ficha_hash = hashlib.md5(
                    normalizar_ficha(r["FICHA_PRODUCTO"]).encode("utf-8")
                ).hexdigest()
                columnas = [
                    "uid_perucompras", "catalogo", "fecha_guardado", "requerimiento", "proforma", "n_proforma_id",
                    "n_entidad_semaforo", "color_semaforo", "estado", "procedimiento", "fecha_emision",
                    "fecha_limite_cotizacion", "entidad", "ruc", "producto", "ficha_producto",
                    "ficha_hash", "marca", "codigo_unico", "detalle_entrega_id", "prod_idx", "pf_idx", "det_idx",
                    "cantidad", "precio_unitario_base", "precio_ofertado", "moneda", "direccion_entrega",
                    "departamento", "provincia", "distrito", "fecha_inicio_entrega",
                    "fecha_fin_entrega", "plazo_dias", "subtotal", "costo_productos",
                    "costo_envio", "igv", "pdf_producto", "pdf_requerimiento", "imagen_producto",
                ]
                valores = (
                    r.get("UID_PERUCOMPRAS", ""), catalogo, r["FECHA_GUARDADO"], r["REQUERIMIENTO"], r["PROFORMA"], r["N_PROFORMA_ID"],
                    r["N_ENTIDAD_SEMAFORO"], r["COLOR_SEMAFORO"], r.get("ESTADO") or "", r["PROCEDIMIENTO"], r["FECHA_EMISION"],
                    r["FECHA_LIMITE_COTIZACION"], r["ENTIDAD"], r["RUC"], r["PRODUCTO"], r["FICHA_PRODUCTO"],
                    ficha_hash, r["MARCA"], r["CODIGO_UNICO"], r["DETALLE_ENTREGA_ID"],
                    r.get("PROD_IDX", 0), r.get("PF_IDX", 0), r.get("DET_IDX", 0),
                    r["CANTIDAD"], r["PRECIO_UNITARIO_BASE"], r["PRECIO_OFERTADO"], r["MONEDA"], r["DIRECCION_ENTREGA"],
                    r["DEPARTAMENTO"], r["PROVINCIA"], r["DISTRITO"], r["FECHA_INICIO_ENTREGA"],
                    r["FECHA_FIN_ENTREGA"], r["PLAZO_DIAS"], r["SUBTOTAL"], r["COSTO_PRODUCTOS"],
                    r["COSTO_ENVIO"], r["IGV"], r["PDF_PRODUCTO"], r["PDF_REQUERIMIENTO"], r["IMAGEN_PRODUCTO"],
                )

                if len(columnas) != len(valores):
                    raise ValueError(
                        f"Desalineado: {len(columnas)} columnas vs {len(valores)} valores "
                        f"para el registro {r.get('N°')}"
                    )

                placeholders = ",".join(["%s"] * len(valores))
                cur.execute(
                    f"""
                    INSERT INTO perucompras_extraccion ({",".join(columnas)})
                    VALUES ({placeholders})
                    ON DUPLICATE KEY UPDATE
                        id = LAST_INSERT_ID(id),
                        estado = VALUES(estado),
                        n_entidad_semaforo = VALUES(n_entidad_semaforo),
                        color_semaforo = VALUES(color_semaforo),
                        precio_ofertado = VALUES(precio_ofertado),
                        subtotal = VALUES(subtotal),
                        fecha_guardado = VALUES(fecha_guardado)
                    """,
                    valores,
                )
                # Truco MySQL: con ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),
                # cur.lastrowid trae el id real de la fila (nueva o ya
                # existente) SIEMPRE — con INSERT IGNORE eso no era posible.
                r["_id"] = cur.lastrowid
                registros_con_id.append(r)
                if cur.rowcount == 1:
                    insertados += 1

                # Si esta proforma YA NO está pendiente (se cotizó, quedó
                # desierta, o se restringió por otra vía), cualquier
                # candidatura vieja en perucompras_restringidos que siga
                # 'pendiente' quedó obsoleta. La acumulamos aquí para
                # descartarla en un solo UPDATE al final — no una query
                # por fila dentro del loop.
                estado_actual = (r.get("ESTADO") or "").strip().upper()
                if estado_actual and estado_actual != "PENDIENTE":
                    ids_a_descartar.append(r["_id"])

            # 👇 DEBE ir DENTRO del "with conn.cursor() as cur:" de arriba.
            # Antes estaba afuera y el cursor ya estaba cerrado -> tronaba
            # con excepción cada vez que un catálogo tenía al menos una
            # proforma ya no-pendiente, matando TODA la extracción y
            # cortando de tajo el resto de catálogos sin aviso claro.
            if ids_a_descartar:
                formato = ",".join(["%s"] * len(ids_a_descartar))
                cur.execute(
                    f"""
                    UPDATE perucompras_restringidos
                    SET estado = 'descartado'
                    WHERE extraccion_id IN ({formato}) AND estado = 'pendiente'
                    """,
                    tuple(ids_a_descartar),
                )
                logger.info(f"[{catalogo}] {cur.rowcount} candidatas descartadas por cambio de estado real")

        conn.commit()
    finally:
        conn.close()
    return insertados, registros_con_id



def registrar_detalle_run(run_id: int | None, catalogo: str, total_filas: int, nuevos_insertados: int):
    if not run_id:
        return
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO perucompras_extraccion_runs_detalle
                    (run_id, catalogo, total_filas, nuevos_insertados)
                VALUES (%s, %s, %s, %s)
                """,
                (run_id, catalogo, total_filas, nuevos_insertados),
            )
    finally:
        conn.close()