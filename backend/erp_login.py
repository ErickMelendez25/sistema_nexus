"""
Helbot - erp_login.py
----------------------
Sesión persistente al ERP (frontend-production-b01e.up.railway.app /
manager-multilimpsac-production.up.railway.app).

Flujo:
1) login(email, password) -> POST al endpoint de login del ERP.
   Guarda el token/cookie que regrese y lo deja listo en self.session
   para todas las llamadas siguientes.
2) obtener_todas_ventas() -> recorre /api/ventas?page=N&limit=100
   página por página hasta agotarlas, y devuelve TODOS los registros
   juntos (con caché en memoria de `cache_segundos`).

⚠️ TODO CRÍTICO (verificar en DevTools -> Network -> Fetch/XHR al dar
clic en "Continuar" en el login):
  - ERP_LOGIN_ENDPOINT: la URL real del POST de login.
  - Nombres de los campos del body (ahora se manda "email"/"password").
  - Nombre del campo del token en la respuesta (ahora se busca
    token / access_token / accessToken / jwt).
  - Si en vez de header "Authorization: Bearer <token>" el ERP usa
    cookies de sesión (httpOnly), avísame: hay que cambiar el flujo
    (quitamos el manejo manual de token y dejamos que requests.Session
    guarde las cookies solo, que es incluso más simple).
"""

import os
import time
import logging
import threading

import requests

logger = logging.getLogger("helbot.erp_login")
logging.basicConfig(level=logging.INFO)

# ------------------------------------------------------------------
# Config
# ------------------------------------------------------------------

# Dominio del frontend (solo referencia, no se usa para llamadas HTTP,
# el login real se hace directo contra la API).
ERP_FRONTEND_LOGIN_URL = "https://frontend-production-b01e.up.railway.app/login"

# Dominio real de la API del ERP.
ERP_API_BASE = os.getenv("ERP_API_BASE", "https://manager-multilimpsac-production.up.railway.app/api")

# TODO: confirmar esta ruta viendo la request real de login en Network.
ERP_LOGIN_ENDPOINT = f"{ERP_API_BASE}/auth/login"

# Si el ERP tiene refresh de token, poner la ruta real. Si no existe,
# deja este valor así: el refresh simplemente volverá a hacer login
# completo cuando falle (ver _refresh_loop).
ERP_REFRESH_ENDPOINT = f"{ERP_API_BASE}/auth/refresh"

ERP_VENTAS_ENDPOINT = f"{ERP_API_BASE}/ventas"

# Credenciales por defecto (puedes sobreescribir con variables de
# entorno ERP_EMAIL / ERP_PASSWORD sin tocar este archivo).
ERP_EMAIL_DEFAULT = os.getenv("ERP_EMAIL", "log2.rpc@grupoecolimp.com")
ERP_PASSWORD_DEFAULT = os.getenv("ERP_PASSWORD", "ZMhc48Jq4Q")

TOKEN_REFRESH_INTERVAL = 25 * 60  # 25 min, ajustar según expiración real del token
VENTAS_CACHE_SEGUNDOS = 120       # cuánto tiempo se reusa el listado ya descargado


class ErpSession:
    def __init__(self):
        self.session = requests.Session()
        self.token: str | None = None
        self.usuario: str | None = None
        self.password: str | None = None
        self.estado = "desconectado"  # desconectado | cargando | activa | perdida

        self.refresh_stop = threading.Event()
        self.refresh_thread: threading.Thread | None = None

        # ---- caché de ventas (todas las páginas ya combinadas) ----
        self._ventas_lock = threading.Lock()
        self._ventas_cache: list[dict] = []
        self._ventas_cache_ts: float = 0.0
        self._ventas_paginas_leidas: int = 0

    @property
    def autenticado(self) -> bool:
        return self.estado == "activa"

    # ------------------------------------------------------------
    # LOGIN
    # ------------------------------------------------------------
    def login(self, usuario: str | None = None, password: str | None = None) -> bool:
        usuario = usuario or ERP_EMAIL_DEFAULT
        password = password or ERP_PASSWORD_DEFAULT

        self.estado = "cargando"
        self.usuario = usuario
        self.password = password
        try:
            resp = self.session.post(
                ERP_LOGIN_ENDPOINT,
                json={"email": usuario, "password": password},  # TODO: ajustar nombres reales si difieren
                timeout=15,
            )
            resp.raise_for_status()

            # Intento leer JSON; si el ERP responde solo con cookie de
            # sesión (sin body de token), esto puede no traer nada útil
            # y no pasa nada: la sesión ya quedó con la cookie guardada.
            data = {}
            try:
                data = resp.json()
            except ValueError:
                data = {}

            # TODO TEMPORAL: quitar este log una vez identifiquemos el
            # campo real del token (puede exponer datos sensibles en logs).
            logger.info(f"Login ERP - respuesta cruda (status={resp.status_code}): {data}")
            logger.info(f"Login ERP - Set-Cookie recibido: {resp.headers.get('set-cookie')}")

            token = (
                data.get("token")
                or data.get("access_token")
                or data.get("accessToken")
                or data.get("jwt")
                or ((data.get("data") or {}).get("token") if isinstance(data.get("data"), dict) else None)
                or ((data.get("data") or {}).get("accessToken") if isinstance(data.get("data"), dict) else None)
                or ((data.get("user") or {}).get("token") if isinstance(data.get("user"), dict) else None)
            )

            if token:
                self.token = token
                self.session.headers.update({"Authorization": f"Bearer {self.token}"})
                logger.info("Login ERP OK (token recibido)")
            else:
                # No hubo token explícito -> asumimos autenticación por
                # cookie de sesión (requests.Session ya la guardó sola).
                logger.info("Login ERP OK (sin token explícito, se asume cookie de sesión)")

            self.estado = "activa"
            self._iniciar_refresh()
            # invalidar caché de ventas de la sesión anterior
            with self._ventas_lock:
                self._ventas_cache = []
                self._ventas_cache_ts = 0.0
            return True

        except Exception as e:
            self.estado = "perdida"
            logger.warning(f"Login ERP falló (revisa ERP_LOGIN_ENDPOINT / payload real): {e}")
            return False

    def login_async(self, usuario: str | None = None, password: str | None = None):
        threading.Thread(target=self.login, args=(usuario, password), daemon=True).start()

    def logout(self):
        self.refresh_stop.set()
        self.token = None
        self.session.headers.pop("Authorization", None)
        self.session.cookies.clear()
        self.estado = "desconectado"

    # -------- refresh periódico de token (si tu ERP lo soporta) --------
    def _refresh_loop(self):
        while not self.refresh_stop.wait(TOKEN_REFRESH_INTERVAL):
            if self.estado != "activa":
                continue
            try:
                resp = self.session.post(ERP_REFRESH_ENDPOINT, timeout=15)
                logger.info(f"Refresh ERP: status={resp.status_code}, url={ERP_REFRESH_ENDPOINT}")
                if resp.ok:
                    data = resp.json()
                    nuevo_token = data.get("token") or data.get("access_token") or data.get("accessToken")
                    if nuevo_token:
                        self.token = nuevo_token
                        self.session.headers.update({"Authorization": f"Bearer {self.token}"})
                        logger.info("Token ERP renovado")
                        continue
                raise ValueError("refresh no devolvió token válido")
            except Exception as e:
                logger.warning(f"Refresh de token ERP falló ({e}) — reintentando login completo...")
                if self.usuario and self.password:
                    ok = self.login(self.usuario, self.password)
                    logger.info(f"Re-login completo tras refresh fallido: {'OK' if ok else 'FALLÓ'}")

    def _iniciar_refresh(self):
        self.refresh_stop.clear()
        if self.refresh_thread is None or not self.refresh_thread.is_alive():
            self.refresh_thread = threading.Thread(target=self._refresh_loop, daemon=True)
            self.refresh_thread.start()

    # ------------------------------------------------------------
    # VENTAS — descarga TODAS las páginas y las combina
    # ------------------------------------------------------------
    def _extraer_registros_y_paginas(self, data) -> tuple[list[dict], int | None]:
        """
        Soporta varias formas típicas de respuesta paginada:
        - lista plana: [...]
        - { data: [...], total, totalPages }
        - { items: [...], total, totalPages }
        - { data: [...], meta: { total, totalPages } }
        """
        if isinstance(data, list):
            return data, None

        registros = data.get("data") or data.get("items") or data.get("results") or []
        meta = data.get("meta") if isinstance(data.get("meta"), dict) else data
        total_paginas = meta.get("totalPages") or meta.get("total_pages") or meta.get("lastPage")
        return registros, total_paginas

    def _descargar_todas_las_paginas(self, limit: int = 100, max_paginas: int = 500) -> tuple[list[dict], int]:
        if not self.autenticado:
            raise RuntimeError("Sesión ERP no autenticada. Llama a login() primero.")

        todas: list[dict] = []
        pagina = 1


        
        while pagina <= max_paginas:
            resp = self.session.get(
                ERP_VENTAS_ENDPOINT,
                params={"page": pagina, "limit": limit},
                timeout=20,
            )
            if resp.status_code == 401:
                # Token vencido de verdad — no esperamos a los 25 min del
                # refresh loop, marcamos la caída ahora mismo.
                self.estado = "perdida"
                self.session.headers.pop("Authorization", None)
                logger.warning("ERP: token rechazado (401) — sesión marcada como perdida")
            resp.raise_for_status()
            data = resp.json()

            registros, total_paginas = self._extraer_registros_y_paginas(data)
            if not registros:
                break

            todas.extend(registros)

            if total_paginas is not None and pagina >= total_paginas:
                pagina += 1
                break
            if total_paginas is None and len(registros) < limit:
                # no sabemos el total de páginas, pero esta página vino
                # incompleta -> asumimos que era la última.
                pagina += 1
                break

            pagina += 1

        if pagina > max_paginas:
            logger.warning("obtener_todas_ventas: corte de seguridad en %s páginas", max_paginas)

        paginas_leidas = pagina - 1
        logger.info(f"ERP ventas: {len(todas)} registros descargados en {paginas_leidas} páginas")
        return todas, paginas_leidas

    def obtener_todas_ventas(self, forzar: bool = False, limit: int = 100) -> dict:
        """
        Devuelve: { "ventas": [...], "total": int, "paginas": int, "actualizado": iso_str }
        Usa caché de VENTAS_CACHE_SEGUNDOS salvo que forzar=True.
        """
        with self._ventas_lock:
            ahora = time.time()
            cache_valida = self._ventas_cache and (ahora - self._ventas_cache_ts) < VENTAS_CACHE_SEGUNDOS
            if not forzar and cache_valida:
                registros = self._ventas_cache
                paginas = self._ventas_paginas_leidas
            else:
                registros, paginas = self._descargar_todas_las_paginas(limit=limit)
                self._ventas_cache = registros
                self._ventas_cache_ts = ahora
                self._ventas_paginas_leidas = paginas

        return {
            "ventas": registros,
            "total": len(registros),
            "paginas": paginas,
            "actualizado": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }

    # -------- otras llamadas de negocio ya existentes --------
    def completar_orden(self, orden_id: str, datos: dict) -> dict:
        resp = self.session.post(f"{ERP_API_BASE}/ordenes/{orden_id}/completar", json=datos, timeout=20)
        resp.raise_for_status()
        return resp.json()

    def completar_precio(self, orden_id: str, precio: float) -> dict:
        resp = self.session.post(f"{ERP_API_BASE}/ordenes/{orden_id}/precio", json={"precio": precio}, timeout=20)
        resp.raise_for_status()
        return resp.json()


erp_session = ErpSession()