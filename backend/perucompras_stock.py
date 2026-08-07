"""
Helbot - perucompras_stock.py
------------------------------
Modificación de stock en 2 fases (igual que tu VentanaSeleccion viejo):
  1) extraer_todo()      -> solo lectura, trae TODOS los productos y calcula
                             sus stats por categoría.
  2) modificar_seleccion() -> modifica SOLO las categorías que el usuario
                             marcó, usando los datos ya extraídos en (1).
Usa la sesión ya autenticada del uid (perucompras_sesiones).
"""
import re
import time
import random
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from bs4 import BeautifulSoup

logger = logging.getLogger("helbot.perucompras_stock")

BASE_URL = "https://www.catalogos.perucompras.gob.pe"
URL_LISTA = BASE_URL + "/MejoraBasica/_ListaProductosOfertados"
URL_MODIFICAR = BASE_URL + "/MejoraBasica/ModificarStock"

MAX_WORKERS_CATEGORIA = 7
MAX_WORKERS_MODIFICAR = 7

# Idéntica a COMBINACIONES en bot_stock_ultra.py.
COMBINACIONES = [
    (324, 326, 12180, "ESCOBILLONES"),
    (324, 326, 12181, "LAVAVAJILLAS"),
    (324, 326, 12182, "SUAVIZANTES_DE_ROPA"),
    (324, 326, 12184, "DETERGENTES"),
    (324, 326, 12185, "REMOVEDORES_DE_SARRO"),
    (324, 326, 12186, "DESINFECTANTES"),
    (324, 326, 12187, "DESENGRASANTES"),
    (324, 326, 12188, "ESPONJAS_Y_FIBRAS"),
    (324, 326, 12189, "SILICONA"),
    (324, 326, 12190, "TINAS_Y_BATEAS"),
    (324, 326, 12191, "TACHOS_BUZONES_Y_RECOLECTORES"),
    (324, 326, 12192, "CERAS"),
    (324, 326, 12193, "TOALLAS"),
    (324, 326, 12194, "ATRAPA_POLVO"),
    (324, 326, 12195, "MOPAS_Y_TRAPEADORES"),
    (324, 326, 12196, "ALCOHOL_ETILICO_GEL"),
    (324, 326, 12165, "CEPILLO_DENTAL"),
    (324, 326, 12166, "LIMPIADORES"),
    (324, 326, 12167, "RECOGEDORES"),
    (324, 326, 12168, "AMBIENTADORES_Y_PASTILLAS"),
    (324, 326, 12169, "JABON_HIGIENE_MANOS"),
    (324, 326, 12170, "PANOS_Y_BAYETAS"),
    (324, 326, 12171, "PASTA_DENTAL"),
    (324, 326, 12172, "PULVERIZADORES_Y_ATOMIZADORES"),
    (324, 326, 12173, "CARRITOS_PARA_LIMPIEZA"),
    (324, 326, 12174, "JALADORES_DE_AGUA"),
    (324, 326, 12175, "HIPOCLORITO_DE_SODIO"),
    (324, 326, 12177, "BASTONES_Y_MANGOS"),
    (324, 326, 12178, "CEPILLOS_Y_ESCOBILLAS"),
    (324, 326, 12179, "ESCOBAS"),
    (324, 327, 12163, "PAPEL_TOALLA"),
    (324, 327, 12164, "PAPEL_HIGIENICO"),
    (352, 355, 12345, "TUBOS_INSTALACIONES_ELECTRICAS"),
    (352, 355, 12312, "REDUCCION"),
    (352, 355, 12313, "TEE"),
    (352, 355, 12314, "TUBOS_INSTALACIONES_SANITARIAS"),
    (352, 355, 12316, "CODO"),
    (352, 355, 12317, "PEGAMENTO_PARA_TUBERIAS"),
    (352, 355, 12318, "TAPON"),
    (352, 355, 12319, "YEE"),
    (352, 355, 12320, "UNION"),
    (352, 353, 12324, "PINTURA_VIAL"),
    (352, 353, 12325, "PINTURA_ARQUITECTONICA"),
    (352, 353, 12326, "BASE"),
    (357, 359, 12394, "BIDON"),
    (357, 359, 12396, "BALDE"),
    (357, 359, 12399, "VASO"),
    (357, 359, 12400, "PLATO"),
    (357, 358, 12498, "PLANCHA_PANEL_DRYWALL"),
    (357, 358, 12383, "COLCHON"),
    (357, 358, 12392, "CALAMINA_PLANCHAS_COBERTURA"),
    (357, 358, 12398, "TABLEROS_MADERA_AGLOMERADA_CONTRACHAPADA"),
    (357, 358, 12387, "CAMA_FIJA_METAL_DOS_NIVELES"),
    (370, 371, 12423, "AGUA_MESA_DESCARTABLE"),
    (372, 379, 12436, "ARROZ_PILADO"),
    (372, 382, 12435, "ACEITE_VEGETAL"),
    (372, 380, 12433, "AZUCAR"),
    (372, 381, 12434, "LENTEJA"),
    (372, 381, 12437, "FRIJOL"),
    (376, 377, 12457, "RASTRILLO_DE_METAL"),
    (376, 377, 12458, "AZADON"),
    (376, 377, 12459, "NAVAJA_DE_INJERTAR"),
    (376, 377, 12460, "LIMA_DE_AFILAR"),
    (376, 377, 12461, "MACHETE_CON_MANGO"),
    (376, 377, 12462, "SERRUCHO_DE_PODA"),
    (376, 377, 12454, "TIJERA_DE_PODAR"),
    (376, 377, 12455, "HACHA"),
    (376, 377, 12456, "HOZ"),
]


def _es_elegible(item: dict) -> bool:
    """Mismo criterio de siempre: stock==2 o >=50000 se omite."""
    return item["stock_actual"] != 2 and item["stock_actual"] < 50000


def _extraer_categoria(session, combo) -> list[dict]:
    acuerdo, catalogo, categoria, nombre = combo
    params = {"N_Acuerdo": acuerdo, "N_Catalogo": catalogo, "N_Categoria": categoria, "C_Descripcion": ""}
    r = None
    for intento in range(1, 6):
        try:
            r = session.post(URL_LISTA, data=params, timeout=(15, 120))
            if r.status_code == 200:
                break
        except Exception as e:
            logger.warning(f"Timeout/error extrayendo {nombre} intento {intento}/5: {e}")
            time.sleep(3 * intento)
    if r is None:
        logger.error(f"Extracción de {nombre} falló definitivamente")
        return []

    soup = BeautifulSoup(r.text, "html.parser")
    filas = soup.select("#TablaProductos tbody tr")
    data = []
    for row in filas:
        cols = row.find_all("td")
        if len(cols) < 7:
            continue
        id_producto = None
        for a in row.find_all("a"):
            if a.has_attr("onclick") and "fnModificarStock" in a["onclick"]:
                m = re.search(r"fnModificarStock\((\d+)\)", a["onclick"])
                if m:
                    id_producto = m.group(1)
        try:
            stock_actual = int(cols[6].get_text(strip=True))
        except Exception:
            continue
        ficha = cols[1].get_text(" ", strip=True)
        precio = cols[4].get_text(strip=True)
        mc = re.search(r'([A-Z0-9\-]+)$', ficha)
        codigo = mc.group(1) if mc else "SIN-COD"
        item = {
            "id": id_producto, "categoria": nombre, "ficha_producto": ficha,
            "codigo": codigo, "precio_vigente": precio, "stock_actual": stock_actual,
            "stock_nuevo": None,
            "estado": "PENDIENTE" if _es_elegible({"stock_actual": stock_actual}) else "OMITIDO",
        }
        if not id_producto:
            item["estado"] = "SIN_ID"
        data.append(item)
    return data


def extraer_todo(pc_session, progreso: dict) -> list[dict]:
    """FASE 1 — solo lectura. Trae TODOS los productos de TODAS las
    categorías y ya deja marcado PENDIENTE/OMITIDO/SIN_ID según el
    criterio de stock, pero SIN modificar nada todavía."""
    session = pc_session.session
    todos: list[dict] = []
    progreso.update({
        "fase": "extrayendo", "categoria_actual": None, "categorias_completadas": 0,
        "total_categorias": len(COMBINACIONES),
    })

    with ThreadPoolExecutor(max_workers=MAX_WORKERS_CATEGORIA) as executor:
        futuros = {executor.submit(_extraer_categoria, session, c): c for c in COMBINACIONES}
        for futuro in as_completed(futuros):
            combo = futuros[futuro]
            try:
                todos.extend(futuro.result())
            except Exception as e:
                logger.error(f"Categoría {combo[3]} falló: {e}")
            progreso["categoria_actual"] = combo[3]
            progreso["categorias_completadas"] += 1

    progreso["fase"] = "listo"
    return todos


def _modificar_item(session, item: dict):
    try:
        r = session.get(f"{URL_MODIFICAR}?ID_ProductoOfertado={item['id']}", timeout=30)
        soup = BeautifulSoup(r.text, "html.parser")
        token = soup.find("input", {"name": "__RequestVerificationToken"})
        if not token:
            item["estado"] = "ERROR"
            return
        nuevo_stock = random.randint(50000, 100000)
        payload = {
            "__RequestVerificationToken": token["value"],
            "ID_ProductoOfertado": item["id"],
            "N_Acuerdo": soup.find("input", {"name": "N_Acuerdo"})["value"],
            "N_Catalogo": soup.find("input", {"name": "N_Catalogo"})["value"],
            "N_Categoria": soup.find("input", {"name": "N_Categoria"})["value"],
            "N_Stock": str(nuevo_stock),
        }
        r2 = None
        for intento in range(1, 5):
            try:
                r2 = session.post(URL_MODIFICAR, data=payload, timeout=(10, 90))
                if r2.status_code == 200:
                    break
            except Exception:
                time.sleep(2 * intento)
        if r2 is None:
            item["estado"] = "TIMEOUT"
            return
        if "Modificar existencias" in r2.text:
            item["estado"] = "ERROR"
        else:
            item["estado"] = "MODIFICADO"
            item["stock_nuevo"] = nuevo_stock
    except Exception as e:
        item["estado"] = f"ERROR:{e}"


def modificar_seleccion(pc_session, progreso: dict, items: list[dict], categorias_seleccionadas: set[str]) -> None:
    """FASE 2 — modifica EN SITIO los items de `items` cuya categoría esté
    en categorias_seleccionadas y sigan en PENDIENTE. Todo lo demás
    (otras categorías, ya OMITIDO/SIN_ID) se queda intacto."""
    session = pc_session.session

    a_procesar = [
        i for i in items
        if i["categoria"] in categorias_seleccionadas and i["estado"] == "PENDIENTE"
    ]

    progreso.update({
        "fase": "modificando", "categoria_actual": None,
        "total_a_modificar": len(a_procesar), "procesados": 0,
    })

    def _uno(item):
        _modificar_item(session, item)
        progreso["procesados"] += 1
        progreso["categoria_actual"] = item["categoria"]

    with ThreadPoolExecutor(max_workers=MAX_WORKERS_MODIFICAR) as ex:
        list(ex.map(_uno, a_procesar))

    progreso["fase"] = "completado"


def calcular_stats_por_categoria(items: list[dict]) -> list[dict]:
    """Igual que _calcular_stats de VentanaSeleccion, pero agrupado."""
    por_cat: dict[str, list[dict]] = {}
    for i in items:
        por_cat.setdefault(i["categoria"], []).append(i)

    stats = []
    for nombre, filas in por_cat.items():
        stats.append({
            "categoria": nombre,
            "total": len(filas),
            "pendientes": sum(1 for f in filas if f["estado"] == "PENDIENTE"),
            "modificados": sum(1 for f in filas if f["estado"] == "MODIFICADO"),
            "omitidos": sum(1 for f in filas if f["estado"] == "OMITIDO"),
            "errores": sum(1 for f in filas if f["estado"] in ("ERROR", "TIMEOUT", "SIN_ID") or str(f["estado"]).startswith("ERROR:")),
        })
    stats.sort(key=lambda s: s["categoria"])
    return stats