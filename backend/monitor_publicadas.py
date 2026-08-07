"""
Helbot - monitor_publicadas.py
--------------------------------
Escanea periódicamente el endpoint real de Peru Compras
(OrdenCompra/consulta) para cada combinación (Acuerdo Marco, Catálogo)
que le indiques en ACUERDOS_CATALOGOS, y detecta órdenes nuevas en
estado PUBLICADA.
"""

import logging
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Callable, Optional
from db import get_conn

logger = logging.getLogger("helbot.monitor_publicadas")

BASE_URL = "https://catalogos.perucompras.gob.pe"
CONSULTA_URL = BASE_URL + "/OrdenCompra/consulta"
OBTENER_FILTROS_URL = BASE_URL + "/OrdenCompra/obtenerFiltros"

BASE_URL_ARCHIVOS: str = ""

from collections import defaultdict
import time


def obtener_acuerdos_catalogos(session) -> tuple[list[tuple[int, int]], dict[int, dict], dict[int, dict]]:
    """
    Llama a /OrdenCompra/obtenerFiltros.
    Devuelve:
      - combos: [(n_acuerdo, n_catalogo), ...]
      - acuerdos_info: {n_acuerdo: {"codigo": str, "nombre": str}}
      - catalogos_info: {n_catalogo: {"nombre": str, "n_acuerdo": int}}
    """
    headers = {
        "Content-Type": "text/plain;charset=UTF-8",
        "token": "null",
    }
    r = session.post(OBTENER_FILTROS_URL, headers=headers, data="", timeout=25)
    r.raise_for_status()

    secciones = r.text.split("¯")
    if len(secciones) < 2:
        logger.error("obtenerFiltros: respuesta con formato inesperado")
        return [], {}, {}

    global BASE_URL_ARCHIVOS
    logger.info(f"obtenerFiltros: total de secciones={len(secciones)}")
    for idx in range(min(len(secciones), 10)):
        logger.info(f"  secciones[{idx}] (primeros 80 chars) = {secciones[idx][:80]!r}")

    if len(secciones) > 7 and secciones[7].strip():
        BASE_URL_ARCHIVOS = secciones[7].strip()
        logger.info(f"BASE_URL_ARCHIVOS capturada: {BASE_URL_ARCHIVOS}")
    else:
        valor_seccion_7 = secciones[7] if len(secciones) > 7 else "NO EXISTE"
        logger.warning(
            f"BASE_URL_ARCHIVOS NO capturada: len(secciones)={len(secciones)}, "
            f"secciones[7]={valor_seccion_7!r}"
        )

    acuerdos_info: dict[int, dict] = {}
    for item in secciones[0].split("¬"):
        partes = item.split("^")
        if len(partes) < 3:
            continue
        try:
            id_acuerdo = int(partes[0].strip())
        except ValueError:
            continue

        nombre_crudo = partes[2].strip()
        # El nombre viene como "NOMBRE REAL * No Vigente" cuando el
        # acuerdo marco ya venció. Si no trae ese sufijo, está vigente.
        vigente = " * No Vigente" not in nombre_crudo
        nombre_limpio = nombre_crudo.split(" * No Vigente")[0].strip()

        acuerdos_info[id_acuerdo] = {
            "codigo": partes[1].strip(),
            "nombre": nombre_limpio,
            "vigente": vigente,
        }

    catalogos_info: dict[int, dict] = {}
    catalogos_por_acuerdo: dict[int, list[int]] = defaultdict(list)
    for item in secciones[1].split("¬"):
        partes = item.split("^")
        if len(partes) < 3:
            continue
        try:
            id_catalogo = int(partes[0].strip())
            id_acuerdo_padre = int(partes[2].strip())
        except ValueError:
            continue

        nombre_catalogo_crudo = partes[1].strip()
        vigente_catalogo = " * No Vigente" not in nombre_catalogo_crudo
        nombre_catalogo_limpio = nombre_catalogo_crudo.split(" * No Vigente")[0].strip()

        catalogos_info[id_catalogo] = {
            "nombre": nombre_catalogo_limpio,
            "n_acuerdo": id_acuerdo_padre,
            "vigente": vigente_catalogo,
        }
        catalogos_por_acuerdo[id_acuerdo_padre].append(id_catalogo)
    combos: list[tuple[int, int]] = []
    for id_acuerdo, ids_catalogo in catalogos_por_acuerdo.items():
        if id_acuerdo not in acuerdos_info:
            continue
        for id_catalogo in ids_catalogo:
            combos.append((id_acuerdo, id_catalogo))

    logger.info(
        f"obtenerFiltros: {len(acuerdos_info)} acuerdos, {len(catalogos_info)} catálogos, "
        f"{len(combos)} combinaciones a monitorear"
    )
    return combos, acuerdos_info, catalogos_info

SCAN_INTERVAL = 60  # segundos entre escaneos completos


def _cargar_ordenes_vistas_db() -> set[int]:
    """Trae de MySQL todos los N_OrdenCompra ya notificados alguna vez."""
    try:
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT n_orden_compra FROM helbot_ordenes_vistas")
                filas = cur.fetchall()
                return {f["n_orden_compra"] for f in filas}
        finally:
            conn.close()
    except Exception as e:
        logger.error(f"Error cargando ordenes_vistas desde MySQL: {e}")
        return set()


def _guardar_ordenes_vistas_db(ids: list[int]):
    """Inserta en MySQL los N_OrdenCompra recién notificados como nuevos."""
    if not ids:
        return
    try:
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT IGNORE INTO helbot_ordenes_vistas (n_orden_compra) VALUES (%s)",
                    [(i,) for i in ids],
                )
        finally:
            conn.close()
    except Exception as e:
        logger.error(f"Error guardando ordenes_vistas en MySQL: {e}")


class MonitorPublicadas:
    def __init__(self, sesion_provider: Callable[[], "object"]):
        self._sesion_provider = sesion_provider
        self.ordenes_vistas: set[int] = _cargar_ordenes_vistas_db()
        self.ultimo_snapshot: list[dict] = []
        self.on_nueva_orden: Optional[Callable[[dict], None]] = None
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()
        self._combos_cache: list[tuple[int, int]] = []
        self._combos_cache_ts: float = 0
        self._acuerdos_info: dict[int, dict] = {}
        self._catalogos_info: dict[int, dict] = {}
        self._pausado = threading.Event()
        self._scan_lock = threading.Lock()   # 👈 AGREGAR ESTA LÍNEA

    def _consultar(self, sesion, n_acuerdo: int, n_catalogo: int) -> list[dict]:
        payload = {
            "N_Acuerdo": (None, str(n_acuerdo)),
            "N_Catalogo": (None, str(n_catalogo)),
            "N_Categoria": (None, ""),
            "C_Palabra": (None, ""),
            "C_Estado": (None, "PUBLICADA"),
            "N_SoloConPagoPend": (None, "0"),
            "C_Procedimiento": (None, ""),
            "N_EsCompraPaquete": (None, ""),
            "N_EstrategiaCompra": (None, ""),
        }
        headers = {"X-Requested-With": "XMLHttpRequest"}
        # 🔒 Mismo candado que usa la extracción de proformas — evita que
        # este scan del monitor dispare un request justo cuando la
        # extracción está a mitad de otro request con la MISMA sesión.
        with sesion.request_lock:
            r = sesion.session.post(
                CONSULTA_URL, files=payload, headers=headers, timeout=25,
                allow_redirects=False,   # 👈 clave: no seguir redirecciones
            )
        # 🔎 DEBUG — confirmar si hubo redirect (sesión muerta)
        logger.info(f"🔎 DEBUG _consultar status={r.status_code} location={r.headers.get('Location')!r}")
        logger.info(f"🔎 DEBUG _consultar Content-Type enviado: {r.request.headers.get('Content-Type')!r}")
        logger.info(f"🔎 DEBUG _consultar body enviado (primeros 300 bytes): {r.request.body[:300] if r.request.body else None!r}")

        if r.status_code in (301, 302, 303, 307, 308):
            logger.warning(
                f"Sesión Peru Compras muerta: /consulta redirigió a {r.headers.get('Location')!r} "
                f"para Acuerdo {n_acuerdo}/Catálogo {n_catalogo}"
            )
            raise RuntimeError("sesion_perdida")

        r.raise_for_status()
        data = r.json()
        if data.get("cod_rpta") != 0:
            logger.warning(
                f"Acuerdo {n_acuerdo}/Catálogo {n_catalogo} -> "
                f"cod_rpta={data.get('cod_rpta')} msg={data.get('mensaje_rpta')}"
            )
            return []
        return data.get("pLista") or []
    

    def obtener_url_pdf(self, item: dict, tipo: str = "fisica") -> Optional[str]:
        """
        Arma la URL pública del PDF de una orden, replicando la función
        JS verArchivo() del portal: rutas[1] + nombreArchivo.
        tipo="fisica" -> usa el campo C_RutaPdf (orden física)
        tipo="ocam"   -> usa el campo C_RutaPdfOC (orden digitalizada)
        """
        if item is None:
            logger.warning(f"obtener_url_pdf: item es None (tipo={tipo})")
            return None
        if not BASE_URL_ARCHIVOS:
            logger.warning(
                f"obtener_url_pdf: BASE_URL_ARCHIVOS vacía todavía "
                f"(orden {item.get('N_OrdenCompra')}, tipo={tipo})"
            )
            return None
        campo = "C_RutaPdf" if tipo == "fisica" else "C_RutaPdfOC"
        nombre_archivo = item.get(campo)
        if not nombre_archivo:
            logger.warning(
                f"obtener_url_pdf: orden {item.get('N_OrdenCompra')} no trae "
                f"campo '{campo}' (valor={nombre_archivo!r}), tipo={tipo}. "
                f"Campos disponibles: {list(item.keys())}"
            )
            return None
        # Normalizamos las barras para no depender de si BASE_URL_ARCHIVOS
        # o nombre_archivo traen o no el "/" de separación — esto es lo
        # que suele romper silenciosamente la URL de la física.
        from urllib.parse import quote

        base = BASE_URL_ARCHIVOS.rstrip("/")
        archivo = nombre_archivo.strip().lstrip("/")  # .strip() por si Perú Compras manda espacios raros en cualquier extremo
        # Codificamos SOLO el nombre del archivo (no la base), para que
        # espacios, tildes o caracteres especiales no rompan la petición
        # HTTP a Azure Blob Storage. safe="" fuerza a codificar incluso
        # el "/" si viniera dentro del nombre (no debería, pero por si acaso).
        archivo_codificado = quote(archivo, safe="")
        url_final = f"{base}/{archivo_codificado}"
        logger.info(
            f"🔎 DEBUG obtener_url_pdf tipo={tipo} orden={item.get('N_OrdenCompra')} "
            f"-> BASE_URL_ARCHIVOS={BASE_URL_ARCHIVOS!r} archivo={nombre_archivo!r} url={url_final!r}"
        )
        return url_final

    def _obtener_combos(self, session) -> list[tuple[int, int]]:
        ahora = time.time()
        if self._combos_cache and (ahora - self._combos_cache_ts) < 6 * 3600:
            return self._combos_cache
        try:
            combos, acuerdos_info, catalogos_info = obtener_acuerdos_catalogos(session)
            if combos:
                self._combos_cache = combos
                self._combos_cache_ts = ahora
                self._acuerdos_info = acuerdos_info
                self._catalogos_info = catalogos_info
        except Exception as e:
            logger.warning(f"Error refrescando acuerdos/catálogos: {e}")
        return self._combos_cache

    def escanear_una_vez(self) -> list[dict]:
        with self._scan_lock:
            sesion = self._sesion_provider()
            if not sesion.autenticado or not sesion.session:
                logger.warning("Escaneo omitido: sesión Peru Compras no activa")
                return self.ultimo_snapshot

            todas: dict[int, dict] = {}
            combos = self._obtener_combos(sesion.session)
            logger.info(f"Escaneando {len(combos)} combinaciones acuerdo/catálogo...")

            # Antes esto era un for secuencial: con decenas de combinaciones
            # acuerdo/catálogo, cada una esperando su propia respuesta HTTP,
            # el primer escaneo tras loguearse podía tardar minutos. Se
            # paraleliza con un pool de hilos — mismo patrón que ya usan
            # bot_stock_ultra.py y bot_mejoraplazo.py — para que las
            # decenas de requests salgan casi al mismo tiempo.
            MAX_WORKERS_SCAN = 5

            def _consultar_combo(combo: tuple[int, int]):
                n_acuerdo, n_catalogo = combo
                return self._consultar(sesion, n_acuerdo, n_catalogo)

            with ThreadPoolExecutor(max_workers=MAX_WORKERS_SCAN) as executor:
                futuros = {executor.submit(_consultar_combo, combo): combo for combo in combos}
                for futuro in as_completed(futuros):
                    n_acuerdo, n_catalogo = futuros[futuro]
                    try:
                        items = futuro.result()
                        acuerdo_meta = self._acuerdos_info.get(n_acuerdo, {})
                        catalogo_meta = self._catalogos_info.get(n_catalogo, {})
                        for it in items:
                            it["_n_acuerdo"] = n_acuerdo
                            it["_n_catalogo"] = n_catalogo
                            it["_acuerdo_codigo"] = acuerdo_meta.get("codigo", "")
                            it["_acuerdo_nombre"] = acuerdo_meta.get("nombre", "")
                            it["_catalogo_nombre"] = catalogo_meta.get("nombre", "")
                            todas[it["N_OrdenCompra"]] = it
                    except Exception as e:
                        logger.warning(f"Error consultando Acuerdo {n_acuerdo}/Catálogo {n_catalogo}: {e}")
                        # Si la respuesta ya no es JSON válido (típico cuando la
                        # sesión murió y el servidor redirige a la página de login
                        # devolviendo HTML), la sesión está muerta de verdad —
                        # marcamos el estado real para que el frontend deje de
                        # decir "conectado" y vuelva a ofrecer el botón de login.
                        if isinstance(e, ValueError) and "Expecting value" in str(e):
                            estado_previo = sesion.estado
                            sesion.estado = "perdida"
                            logger.warning(f"Sesión Peru Compras ({sesion.usuario}) marcada como perdida")
                            if estado_previo == "activa" and sesion.on_sesion_perdida:
                                try:
                                    sesion.on_sesion_perdida(sesion.usuario)
                                except Exception as cb_err:
                                    logger.warning(f"Error en callback on_sesion_perdida: {cb_err}")

            with self._lock:
                nuevas = [o for oid, o in todas.items() if oid not in self.ordenes_vistas]
                self.ordenes_vistas |= set(todas.keys())
                self.ultimo_snapshot = sorted(
                    todas.values(), key=lambda o: o["N_OrdenCompra"], reverse=True
                )

            if nuevas:
                _guardar_ordenes_vistas_db([o["N_OrdenCompra"] for o in nuevas])

            for nueva in nuevas:
                logger.info(f"Nueva publicada: {nueva.get('C_OrdenCompra')} — {nueva.get('C_Entidad')}")
                if self.on_nueva_orden:
                    try:
                        self.on_nueva_orden(nueva)
                    except Exception as e:
                        logger.error(f"Error en callback on_nueva_orden: {e}")

            return self.ultimo_snapshot
    def consultar_entregas(self, n_orden_compra: int) -> list[dict]:
        """
        Llama a /OrdenCompra/consultaEntregas para UNA orden puntual.
        Se hace bajo demanda (cuando el usuario abre el detalle de una
        card en el frontend), NO en cada escaneo, para no saturar la
        sesión con requests innecesarios.
        """
        sesion = self._sesion_provider()
        if not sesion.autenticado or not sesion.session:
            logger.warning("consultar_entregas: sesión Peru Compras no activa")
            return []
        try:
            headers = {"X-Requested-With": "XMLHttpRequest"}
            with sesion.request_lock:
                r = sesion.session.post(
                    CONSULTA_URL.replace("/consulta", "/consultaEntregas"),
                    data={"N_OrdenCompra": n_orden_compra},
                    headers=headers,
                    timeout=25,
                )
            r.raise_for_status()
            data = r.json()
            logger.info(f"🔎 DEBUG consultaEntregas OC {n_orden_compra} -> respuesta cruda: {data}")
            if data.get("cod_rpta") != 0:
                logger.warning(
                    f"consultaEntregas OC {n_orden_compra} -> "
                    f"cod_rpta={data.get('cod_rpta')} msg={data.get('mensaje_rpta')}"
                )
                return []
            return data.get("pLista") or []
        except Exception as e:
            logger.warning(f"Error consultando entregas de OC {n_orden_compra}: {e}")
            return []

    def _loop(self):
        while True:
            if not self._pausado.is_set():
                self.escanear_una_vez()
            if self._stop.wait(SCAN_INTERVAL):
                break

    def pausar(self):
        self._pausado.set()
        # Bloquea hasta que cualquier escaneo YA EN CURSO termine, antes
        # de devolver el control. Así _tarea_extraccion() no arranca la
        # extracción en paralelo con un scan a medias compitiendo por la
        # misma sesión HTTP.
        with self._scan_lock:
            pass
        logger.info("Monitor de publicadas pausado (extracción de catálogos en curso)")

    def reanudar(self):
        self._pausado.clear()
        logger.info("Monitor de publicadas reanudado")

    def iniciar(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info("Monitor de publicadas iniciado")

    def detener(self):
        self._stop.set()

    def snapshot(self) -> list[dict]:
        with self._lock:
            return list(self.ultimo_snapshot)

    def obtener_por_id(self, n_orden_compra: int) -> Optional[dict]:
        """Busca una orden puntual en el último snapshot cacheado
        (trae C_RutaPdf/C_RutaPdfOC, que consultar_entregas() NO trae)."""
        with self._lock:
            for o in self.ultimo_snapshot:
                if o.get("N_OrdenCompra") == n_orden_compra:
                    return o
        return None

from perucompras_login import perucompras_sesiones  # noqa: E402

# Un monitor independiente por cada usuario configurado — cada uno con su
# propio ordenes_vistas/snapshot, apuntando a su respectiva sesión.
monitores: dict[str, MonitorPublicadas] = {
    uid: MonitorPublicadas(sesion_provider=(lambda uid=uid: perucompras_sesiones.sesion(uid)))
    for uid in perucompras_sesiones.ids()
}


def monitor_de(uid: str) -> Optional[MonitorPublicadas]:
    return monitores.get(uid)