"""
Helbot - perucompras_plazo.py
-------------------------------
Modificación masiva de plazo de entrega (PlazoEntrega=1) — versión web
de mejora_plazo_automatico.py. Sin Selenium: el catalogo_id por acuerdo
se saca parseando el HTML de IndexMejora con la sesión de requests ya
autenticada (el <select> ya viene resuelto en el HTML del servidor).

NUEVO: obtener_departamentos()/obtener_provincias() quedan expuestas
para que el router las use y arme un selector de Departamento/Provincia
en el frontend — antes solo se usaban internamente (_get_departamentos/
_get_provincias) y el frontend no tenía forma de pedirlas. También
ejecutar_modificacion_plazo() ahora acepta departamento_codigo /
provincia_codigo opcionales en `seleccion` para restringir el alcance,
igual que el flujo Categoría → Departamento → Provincia de tu bot viejo
en tkinter (mejora_plazo_automatico.py).
"""
import time
import logging
from concurrent.futures import ThreadPoolExecutor
from bs4 import BeautifulSoup

logger = logging.getLogger("helbot.perucompras_plazo")

BASE_URL = "https://www.catalogos.perucompras.gob.pe"
INDEX_URL = f"{BASE_URL}/MejoraPlazo/IndexMejora"
NUEVO_PLAZO = "1"
GRUPO_PADRE = "324"
MAX_WORKERS = 3

# Idéntico a ACUERDOS_MARCO en mejora_plazo_automatico.py.
ACUERDOS_MARCO = {
    "EXT-CE-2024-3 MATERIALES E INSUMOS DE LIMPIEZA, PAPELES PARA ASEO Y LIMPIEZA": {
        "grupo_id": 96768,
        "categorias": [
            (326, 12180, "ESCOBILLONES"), (326, 12181, "LAVAVAJILLAS"),
            (326, 12182, "SUAVIZANTES_DE_ROPA"), (326, 12184, "DETERGENTES"),
            (326, 12185, "REMOVEDORES_DE_SARRO"), (326, 12186, "DESINFECTANTES"),
            (326, 12187, "DESENGRASANTES"), (326, 12188, "ESPONJAS_Y_FIBRAS"),
            (326, 12189, "SILICONA"), (326, 12190, "TINAS_Y_BATEAS"),
            (326, 12191, "TACHOS_BUZONES_Y_RECOLECTORES"), (326, 12192, "CERAS"),
            (326, 12193, "TOALLAS"), (326, 12194, "ATRAPA_POLVO"),
            (326, 12195, "MOPAS_Y_TRAPEADORES"), (326, 12196, "ALCOHOL_ETILICO_GEL"),
            (326, 12165, "CEPILLO_DENTAL"), (326, 12166, "LIMPIADORES"),
            (326, 12167, "RECOGEDORES"), (326, 12168, "AMBIENTADORES_Y_PASTILLAS"),
            (326, 12169, "JABON_HIGIENE_MANOS"), (326, 12170, "PANOS_Y_BAYETAS"),
            (326, 12171, "PASTA_DENTAL"), (326, 12172, "PULVERIZADORES_Y_ATOMIZADORES"),
            (326, 12173, "CARRITOS_PARA_LIMPIEZA"), (326, 12174, "JALADORES_DE_AGUA"),
            (326, 12175, "HIPOCLORITO_DE_SODIO"), (326, 12177, "BASTONES_Y_MANGOS"),
            (326, 12178, "CEPILLOS_Y_ESCOBILLAS"), (326, 12179, "ESCOBAS"),
        ],
    },
    "EXT-CE-2024-12 TUBERIAS, PINTURAS, CERÁMICOS, SANITARIOS, ACCESORIOS, Y COMPLEMENTOS EN GENERAL": {
        "grupo_id": 96768,
        "categorias": [
            (355, 12345, "TUBOS_INST_ELECTRICAS"), (355, 12312, "REDUCCION"),
            (355, 12313, "TEE"), (355, 12314, "TUBOS_INST_SANITARIAS"),
            (355, 12316, "CODO"), (355, 12317, "PEGAMENTO_TUBERIAS"),
            (355, 12318, "TAPON"), (355, 12319, "YEE"), (355, 12320, "UNION"),
            (353, 12324, "PINTURA_VIAL"), (353, 12325, "PINTURA_ARQUITECTONICA"),
            (353, 12326, "BASE"),
        ],
    },
    "EXT-CE-2024-16 ACCESORIOS DOMÉSTICOS Y BIENES PARA USOS DIVERSOS": {
        "grupo_id": 96768,
        "categorias": [
            (359, 12394, "BIDON"), (359, 12396, "BALDE"), (359, 12399, "VASO"),
            (359, 12400, "PLATO"), (358, 12498, "PLANCHA_PANEL_DRYWALL"),
            (358, 12383, "COLCHON"), (358, 12392, "CALAMINA_COBERTURA"),
            (358, 12398, "TABLEROS_MADERA"), (358, 12387, "CAMA_METAL_2_NIVELES"),
        ],
    },
    "EXT-CE-2024-17  BEBIDAS NO ALCOHÓLICAS": {
        "grupo_id": 96768,
        "categorias": [(371, 12423, "AGUA_MESA_DESCARTABLE")],
    },
    "EXT-CE-2024-18 CEREALES, ACEITE, AZUCARES Y MENESTRAS": {
        "grupo_id": 96768,
        "categorias": [
            (379, 12436, "ARROZ_PILADO"), (382, 12435, "ACEITE_VEGETAL"),
            (380, 12433, "AZUCAR"), (381, 12434, "LENTEJA"), (381, 12437, "FRIJOL"),
        ],
    },
    "EXT-CE-2024-26 MAQUINAS, EQUIPOS Y HERRAMIENTAS PARA JARDINERIA, SILVICULTURA Y AGRICULTURA": {
        "grupo_id": 96768,
        "categorias": [
            (377, 12457, "RASTRILLO_DE_METAL"), (377, 12458, "AZADON"),
            (377, 12459, "NAVAJA_DE_INJERTAR"), (377, 12460, "LIMA_DE_AFILAR"),
            (377, 12461, "MACHETE_CON_MANGO"), (377, 12462, "SERRUCHO_DE_PODA"),
            (377, 12454, "TIJERA_DE_PODAR"), (377, 12455, "HACHA"), (377, 12456, "HOZ"),
        ],
    },
}


import re

def _codigo_desde_nombre_acuerdo(nombre_completo: str) -> str | None:
    """Las claves de ACUERDOS_MARCO empiezan con su código real, ej.
    'EXT-CE-2024-3 MATERIALES...' -> código 'EXT-CE-2024-3'. Matchear
    por código es mucho más confiable que por texto completo (evita
    tildes, mayúsculas, espacios dobles, sufijos '* No Vigente', etc.)."""
    m = re.match(r"^([A-Z]+-[A-Z]+-\d{4}-\d+)", nombre_completo)
    return m.group(1) if m else None


def _obtener_acuerdos_dinamico(session) -> list[dict]:
    """tipo=1 -> lista de acuerdos reales de Perú Compras, vía HTTP puro
    (SIN Selenium, sin depender de que el <select> se renderice con JS).
    Confirmado ya funcional por _diagnostico_catalogos en tu bot viejo."""
    r = session.post(f"{BASE_URL}/MejoraPlazo/obtenerFiltros", data="1^", timeout=30)
    r.raise_for_status()
    raw = r.text or ""
    logger.info(f"[obtenerFiltros tipo=1] RAW (primeros 500): {raw[:500]!r}")
    acuerdos = []
    for item in raw.strip().split("¬"):
        campos = [x.strip() for x in item.strip().split("^") if x.strip() != ""]
        if campos:
            acuerdos.append({"id": campos[0], "campos": campos})
    return acuerdos


def _obtener_catalogos_dinamico(session, acuerdo_id: str) -> list[dict]:
    """tipo=2^{acuerdo_id} -> catálogos reales de ese acuerdo."""
    r = session.post(f"{BASE_URL}/MejoraPlazo/obtenerFiltros", data=f"2^{acuerdo_id}", timeout=30)
    r.raise_for_status()
    raw = r.text or ""
    logger.info(f"[obtenerFiltros tipo=2 acuerdo={acuerdo_id}] RAW (primeros 500): {raw[:500]!r}")
    catalogos = []
    for item in raw.strip().split("¬"):
        campos = [x.strip() for x in item.strip().split("^") if x.strip() != ""]
        if campos:
            catalogos.append({"id": campos[0], "campos": campos})
    return catalogos


_CACHE_CATALOGO_ID: dict[str, str] = {}  # nombre_acuerdo_local -> catalogo_id (por proceso)


def _resolver_catalogo_id_por_acuerdo(session, nombre_acuerdo_local: str) -> str | None:
    if nombre_acuerdo_local in _CACHE_CATALOGO_ID:
        return _CACHE_CATALOGO_ID[nombre_acuerdo_local]

    codigo_local = _codigo_desde_nombre_acuerdo(nombre_acuerdo_local)
    if not codigo_local:
        logger.warning(f"No se pudo extraer código de '{nombre_acuerdo_local}'")
        return None

    acuerdos = _obtener_acuerdos_dinamico(session)
    acuerdo_match = None
    for a in acuerdos:
        if any(codigo_local in campo for campo in a["campos"]):
            acuerdo_match = a
            break
    if not acuerdo_match:
        logger.warning(f"No se encontró acuerdo real para código '{codigo_local}' — revisa el log RAW de tipo=1 arriba")
        return None

    catalogos = _obtener_catalogos_dinamico(session, acuerdo_match["id"])
    if not catalogos:
        logger.warning(f"Acuerdo id={acuerdo_match['id']} ({codigo_local}) no devolvió catálogos")
        return None

    catalogo_id = catalogos[0]["id"]
    _CACHE_CATALOGO_ID[nombre_acuerdo_local] = catalogo_id
    return catalogo_id


def _get_departamentos(session, grupo_id, categoria_id) -> list[dict]:
    body = f"3^{grupo_id}^{GRUPO_PADRE}^{categoria_id}"
    r = session.post(f"{BASE_URL}/MejoraPlazo/obtenerFiltros", data=body, timeout=30)
    r.raise_for_status()
    result = []
    for item in r.text.strip().split("¬"):
        p = item.strip().split("^")
        if len(p) >= 2 and p[0].strip():
            result.append({"codigo": p[0].strip(), "nombre": p[1].strip()})
    return result


def _get_provincias(session, dep_codigo) -> list[dict]:
    body = f"4^{dep_codigo}"
    r = session.post(f"{BASE_URL}/MejoraPlazo/obtenerFiltros", data=body, timeout=30)
    r.raise_for_status()
    result = []
    for item in r.text.strip().split("¬"):
        p = item.strip().split("^")
        if len(p) >= 2 and p[0].strip():
            result.append({"codigo": p[0].strip(), "nombre": p[1].strip()})
    return result


# ── WRAPPERS PÚBLICOS ───────────────────────────────────────────
# El router los llama directamente para armar el selector de
# Departamento/Provincia en el frontend — antes _get_departamentos y
# _get_provincias solo se usaban dentro de este mismo archivo.

def obtener_departamentos(pc_session, grupo_id: int, categoria_id: int) -> list[dict]:
    if not pc_session or not pc_session.session:
        return []
    return _get_departamentos(pc_session.session, grupo_id, categoria_id)


def obtener_provincias(pc_session, dep_codigo: str) -> list[dict]:
    if not pc_session or not pc_session.session:
        return []
    return _get_provincias(pc_session.session, dep_codigo)


def _consultar_y_modificar(session, catalogo_id, familia_id, categoria_id, prov_codigo) -> tuple[bool, int, str]:
    try:
        body_consulta = f"{catalogo_id}^{familia_id}^{categoria_id}^^{prov_codigo}"
        raw = ""
        for intento in range(1, 6):
            try:
                r = session.post(f"{BASE_URL}/MejoraPlazo/consultaMejoraPlazoEntrega",
                                  data=body_consulta.encode("utf-8"), timeout=180)
                r.raise_for_status()
                txt = r.text or ""
                if any(k in txt.lower() for k in ["login", "unauthorized", "<!doctype", "<html"]):
                    raise ValueError("Sesión expirada en consulta")
                raw = txt
                break
            except Exception as e:
                espera = 5 * intento
                logger.warning(f"Consulta falló intento {intento}/5 cat={categoria_id}: {e}")
                if intento < 5:
                    time.sleep(espera)
                else:
                    return False, 0, f"Consulta falló tras 5 intentos: {e}"

        if not raw.strip():
            return True, 0, "Sin fichas en esta provincia"

        sep = "\u00af"
        datos_raw = raw.split(sep)[1] if sep in raw else raw
        data_ids = []
        total_fichas = 0
        for item in datos_raw.split("¬"):
            item = item.strip()
            if not item:
                continue
            p = item.split("^")
            did = p[0].strip()
            if did and "-" in did and did != "Nro":
                total_fichas += 1
                pv = p[6].strip() if len(p) > 6 else ""
                pp = p[7].strip() if len(p) > 7 else ""
                if pv != "1" and pp != "1":
                    data_ids.append(did)

        if not data_ids:
            return True, 0, f"Todas las fichas ({total_fichas}) ya tienen plazo=1"

        LOTE = 500
        lotes = [data_ids[i:i + LOTE] for i in range(0, len(data_ids), LOTE)]
        total_modificadas = 0
        for num_lote, lote in enumerate(lotes, 1):
            body_mod = "¬".join(f"{did}^{NUEVO_PLAZO}^^" for did in lote)
            for intento in range(1, 6):
                try:
                    r_mod = session.post(f"{BASE_URL}/MejoraPlazo/modificarMejoraPlazoEntrega",
                                          data=body_mod.encode("utf-8"), timeout=120)
                    r_mod.raise_for_status()
                    txt_mod = r_mod.text or ""
                    if any(k in txt_mod.lower() for k in ["login", "unauthorized"]):
                        raise ValueError("Sesión expirada en modificación")
                    total_modificadas += len(lote)
                    time.sleep(1)
                    break
                except Exception as e:
                    espera = 5 * intento
                    logger.warning(f"Modificación lote {num_lote} falló intento {intento}/5: {e}")
                    if intento < 5:
                        time.sleep(espera)
                    else:
                        return False, total_modificadas, f"Lote {num_lote}/{len(lotes)} falló tras 5 intentos"

        return True, total_modificadas, f"{total_modificadas} fichas modificadas"
    except Exception as e:
        return False, 0, f"Excepción: {e}"


def ejecutar_modificacion_plazo(pc_session, progreso: dict, seleccion: dict | None = None) -> list[dict]:
    """
    seleccion (opcional) = {
        "acuerdos": ["EXT-CE-2024-3 ..."],           # nombres exactos = claves de ACUERDOS_MARCO
        "categorias": [[326, 12180], [326, 12181]],  # pares [familia_id, categoria_id]
        "departamento_codigo": "15",                 # NUEVO — opcional, restringe a 1 departamento
        "provincia_codigo": "1501",                  # NUEVO — opcional, restringe a 1 provincia
                                                       # (solo tiene efecto si departamento_codigo también viene)
    }
    Si seleccion es None (o viene vacía), se corre TODO — mismo
    comportamiento de antes. Si viene con acuerdos/categorías, solo se
    procesan esas. Si además viene departamento_codigo/provincia_codigo,
    se filtra el barrido geográfico a esa zona — así recuperas el
    control granular Categoría → Departamento → Provincia de tu bot
    viejo en tkinter.
    """
    session = pc_session.session
    resultados: list[dict] = []

    acuerdos_a_usar = seleccion.get("acuerdos") if seleccion else None
    categorias_a_usar = seleccion.get("categorias") if seleccion else None
    departamento_codigo = (seleccion.get("departamento_codigo") if seleccion else None) or None
    provincia_codigo = (seleccion.get("provincia_codigo") if seleccion else None) or None
    categorias_set = {tuple(c) for c in categorias_a_usar} if categorias_a_usar else None

    combos = []
    for nombre_acuerdo, data in ACUERDOS_MARCO.items():
        if acuerdos_a_usar and nombre_acuerdo not in acuerdos_a_usar:
            continue
        catalogo_id = _resolver_catalogo_id_por_acuerdo(session, nombre_acuerdo)
        if not catalogo_id:
            logger.warning(f"Acuerdo '{nombre_acuerdo}' no se pudo resolver — se omite")
            continue
        for cat in data["categorias"]:
            if categorias_set and (cat[0], cat[1]) not in categorias_set:
                continue
            combos.append((data["grupo_id"], cat, catalogo_id))

    progreso.update({
        "combinacion_actual": "Cargando departamentos/provincias...",
        "combinaciones_completadas": 0, "total_combinaciones": 0,
        "fichas_modificadas": 0, "combos_con_error": 0,
    })

    tareas = []
    for grupo_id, cat, catalogo_id in combos:
        try:
            deps = _get_departamentos(session, grupo_id, cat[1])
        except Exception as e:
            logger.warning(f"No se pudieron cargar departamentos de {cat[2]}: {e}")
            continue

        # Filtro geográfico: si se pidió un departamento específico, nos
        # quedamos solo con ese — evita barrer los 25 departamentos
        # cuando el usuario quería tocar uno solo.
        if departamento_codigo:
            deps = [d for d in deps if d["codigo"] == departamento_codigo]
            if not deps:
                logger.warning(
                    f"Departamento '{departamento_codigo}' no aparece para {cat[2]} — se omite esta categoría"
                )
                continue

        for dep in deps:
            try:
                provs = _get_provincias(session, dep["codigo"])
            except Exception as e:
                logger.warning(f"No se pudieron cargar provincias de {dep['nombre']}: {e}")
                continue

            # Filtro geográfico fino: provincia específica dentro del
            # departamento ya filtrado.
            if provincia_codigo:
                provs = [p for p in provs if p["codigo"] == provincia_codigo]

            for prov in provs:
                tareas.append((cat, dep, prov, catalogo_id))

    progreso["total_combinaciones"] = len(tareas)

    def _procesar(args):
        cat, dep, prov, catalogo_id = args
        ok, fichas, msg = _consultar_y_modificar(session, catalogo_id, cat[0], cat[1], prov["codigo"])
        fila = {
            "categoria": cat[2], "departamento": dep["nombre"], "provincia": prov["nombre"],
            "fichas_modificadas": fichas, "ok": ok, "mensaje": msg,
        }
        resultados.append(fila)
        progreso["combinacion_actual"] = f"{cat[2]} · {dep['nombre']} / {prov['nombre']}"
        progreso["combinaciones_completadas"] += 1
        progreso["fichas_modificadas"] += fichas
        if not ok:
            progreso["combos_con_error"] += 1
        return fila

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        list(ex.map(_procesar, tareas))

    return resultados


def listar_opciones() -> list[dict]:
    """Para el selector del frontend: acuerdos + categorías disponibles,
    sin tocar la sesión de Perú Compras (son datos locales conocidos)."""
    return [
        {
            "acuerdo": nombre,
            "categorias": [{"familia": c[0], "categoria": c[1], "nombre": c[2]} for c in data["categorias"]],
        }
        for nombre, data in ACUERDOS_MARCO.items()
    ]