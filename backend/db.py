"""
Helbot - db.py
--------------
Config y helpers de MySQL compartidos por perucompras_login, erp_login,
ficha_ocr y main. Un solo lugar para no duplicar credenciales ni pelear
con imports circulares.
"""

import os
import json
import pymysql
from dbutils.pooled_db import PooledDB

DB_CONFIG = dict(
    host=os.getenv("DB_HOST", "localhost"),
    user=os.getenv("DB_USER", "root"),
    password=os.getenv("DB_PASSWORD", "Erick2026#"),
    
    database=os.getenv("DB_NAME", "helbot_db"),
    cursorclass=pymysql.cursors.DictCursor,
    autocommit=True,
    ssl={"ssl": {}},
)

pool = PooledDB(
    creator=pymysql,
    maxconnections=20,
    mincached=2,
    maxcached=5,
    blocking=True,
    ping=1,
    **DB_CONFIG,
)

def get_conn():
    return pool.connection()


def init_db():
    ddl = """
    CREATE TABLE IF NOT EXISTS publicadas (
        id VARCHAR(64) PRIMARY KEY,
        acuerdo_marco VARCHAR(255),
        catalogo VARCHAR(255),
        categoria VARCHAR(255),
        titulo VARCHAR(500),
        detalle_json JSON,
        detectada_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        estado_gestion ENUM('nueva','registrada') DEFAULT 'nueva'
    );
    CREATE TABLE IF NOT EXISTS fichas_ocr (
        id INT AUTO_INCREMENT PRIMARY KEY,
        publicada_id VARCHAR(64),
        datos_extraidos JSON,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    );
CREATE TABLE IF NOT EXISTS ordenes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        publicada_id VARCHAR(64),
        producto VARCHAR(500),
        cantidad INT,
        precio DECIMAL(12,2) NULL,
        estado_precio ENUM('pendiente','completado') DEFAULT 'pendiente',
        registrado_por VARCHAR(120),
        completado_por VARCHAR(120) NULL,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        completado_en DATETIME NULL
    );
    CREATE TABLE IF NOT EXISTS op_seguimiento (
        op_id INT PRIMARY KEY,
        orden_compra_id INT NOT NULL,
        numero_ocam VARCHAR(64),
        estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        proveedor_nombre VARCHAR(255),
        proveedor_telefono VARCHAR(50),
        precio_producto DECIMAL(12,2),
        comodato VARCHAR(255),
        agencia_transporte VARCHAR(255),
        precio_flete DECIMAL(12,2),
        rellenado_por VARCHAR(120),
        rellenado_en DATETIME,
        subido_por VARCHAR(120),
        subido_en DATETIME,
creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        actualizado_en DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS op_producto_seguimiento (
        id INT AUTO_INCREMENT PRIMARY KEY,
        op_id INT NULL,
        orden_compra_id INT NOT NULL,
        numero_ocam VARCHAR(64),
        codigo_venta VARCHAR(64),
        producto_codigo VARCHAR(64) NOT NULL,
        producto_descripcion TEXT,
        producto_cantidad INT,
        estado ENUM('pendiente','preview','confirmado','subido') NOT NULL DEFAULT 'pendiente',
        proveedor_nombre VARCHAR(255),
        proveedor_telefono VARCHAR(64),
        precio_producto DECIMAL(12,2),
        comodato VARCHAR(255),
        agencia_transporte VARCHAR(255),
        precio_flete DECIMAL(12,2),
        observaciones TEXT,
        rellenado_por VARCHAR(120),
        rellenado_en DATETIME,
        subido_por VARCHAR(120),
        subido_en DATETIME,
        UNIQUE KEY uq_orden_producto (orden_compra_id, producto_codigo)
    );
    CREATE TABLE IF NOT EXISTS op_producto_imagenes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        seguimiento_id INT NOT NULL,
        ruta_archivo VARCHAR(255) NOT NULL,
        nombre_original VARCHAR(255),
        subido_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (seguimiento_id) REFERENCES op_producto_seguimiento(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS usuarios_helbot (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        nombre_completo VARCHAR(150),
        rol VARCHAR(50) DEFAULT 'seguimiento',
        catalogos_permitidos JSON,
        activo BOOLEAN NOT NULL DEFAULT TRUE,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notificaciones_helbot (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tipo VARCHAR(50) NOT NULL,
        emisor VARCHAR(120) NULL,
        data JSON,
        leida BOOLEAN NOT NULL DEFAULT FALSE,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS notificaciones_leidas (
        notificacion_id INT NOT NULL,
        usuario VARCHAR(120) NOT NULL,
        leida_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (notificacion_id, usuario),
        FOREIGN KEY (notificacion_id) REFERENCES notificaciones_helbot(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS mef_actualizaciones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        orden_compra_id INT NOT NULL,
        siaf VARCHAR(64),
        expediente VARCHAR(64),
        etapa_siaf VARCHAR(20),
        fecha_siaf VARCHAR(20),
        fuentes_financiamiento VARCHAR(255),
        multiple_fuentes_financiamiento BOOLEAN,
        monto_venta DECIMAL(12,2),
        registros_json JSON,
        completado_por VARCHAR(120),
        completado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_orden_mef (orden_compra_id)
    );
    CREATE TABLE IF NOT EXISTS helbot_ordenes_vistas (
        n_orden_compra INT PRIMARY KEY,
        fecha_visto DATETIME DEFAULT CURRENT_TIMESTAMP
    );
   


    CREATE TABLE IF NOT EXISTS perucompras_extraccion (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid_perucompras VARCHAR(100) NOT NULL DEFAULT '',
        catalogo VARCHAR(60) NOT NULL,
        fecha_guardado DATETIME NOT NULL,
        requerimiento VARCHAR(60),
        proforma VARCHAR(60),
        n_proforma_id VARCHAR(60),
        n_entidad_semaforo INT,
        color_semaforo VARCHAR(20),
        estado VARCHAR(30),
        procedimiento VARCHAR(120),
        fecha_emision VARCHAR(20),
        fecha_limite_cotizacion VARCHAR(20),
        entidad VARCHAR(255),
        ruc VARCHAR(20),
        producto VARCHAR(255),
        ficha_producto TEXT,
        ficha_hash CHAR(32),
        marca VARCHAR(100),
        codigo_unico VARCHAR(100),
        detalle_entrega_id VARCHAR(60),
        cantidad DECIMAL(14,2),
        precio_unitario_base DECIMAL(14,4),
        precio_ofertado DECIMAL(14,4),
        moneda VARCHAR(10),
        direccion_entrega VARCHAR(255),
        departamento VARCHAR(60),
        provincia VARCHAR(60),
        distrito VARCHAR(60),
        fecha_inicio_entrega VARCHAR(20),
        fecha_fin_entrega VARCHAR(20),
        prod_idx INT NOT NULL DEFAULT 0,
        pf_idx INT NOT NULL DEFAULT 0,
        det_idx INT NOT NULL DEFAULT 0,
        plazo_dias VARCHAR(20),
        subtotal DECIMAL(14,2),
        costo_productos DECIMAL(14,2),
        costo_envio DECIMAL(14,2),
        igv DECIMAL(14,2),
        pdf_producto VARCHAR(500),
        pdf_requerimiento VARCHAR(500),
        imagen_producto VARCHAR(500),
        UNIQUE KEY uq_clave (uid_perucompras, requerimiento, proforma, ruc, codigo_unico, detalle_entrega_id, ficha_hash, prod_idx, pf_idx, det_idx),
        KEY idx_fecha (fecha_guardado),
        KEY idx_estado (estado),
        KEY idx_marca (marca),
        KEY idx_entidad (entidad(100)),
        KEY idx_ruc (ruc),
        KEY idx_departamento (departamento),
        KEY idx_uid (uid_perucompras)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS perucompras_extraccion_runs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        usuario_helbot VARCHAR(150),
        uid_perucompras VARCHAR(100),
        iniciado_en DATETIME NOT NULL,
        terminado_en DATETIME NULL,
        estado VARCHAR(20) NOT NULL DEFAULT 'corriendo',
        error TEXT NULL,
        total_filas INT NOT NULL DEFAULT 0,
        KEY idx_iniciado (iniciado_en)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS perucompras_extraccion_runs_detalle (
        id INT AUTO_INCREMENT PRIMARY KEY,
        run_id INT NOT NULL,
        catalogo VARCHAR(60) NOT NULL,
        total_filas INT NOT NULL DEFAULT 0,
        nuevos_insertados INT NOT NULL DEFAULT 0,
        FOREIGN KEY (run_id) REFERENCES perucompras_extraccion_runs(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS perucompras_marcas_config (
        id INT AUTO_INCREMENT PRIMARY KEY,
        uid_perucompras VARCHAR(100) NOT NULL DEFAULT '',
        lista ENUM('restringida_semaforo','prohibida_500_1000','excepcion_menor_500','objetivo') NOT NULL,
        marca VARCHAR(150) NOT NULL,
        creado_por VARCHAR(150),
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_lista_marca (uid_perucompras, lista, marca),
        KEY idx_uid_marcas (uid_perucompras)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS perucompras_restringidos (
        id INT AUTO_INCREMENT PRIMARY KEY,
        run_id INT NULL,
        extraccion_id INT NOT NULL,
        catalogo VARCHAR(60) NOT NULL,
        motivo ENUM('semaforo','monto_minimo') NOT NULL,
        marca VARCHAR(150),
        subtotal DECIMAL(14,2),
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (extraccion_id) REFERENCES perucompras_extraccion(id) ON DELETE CASCADE,
        UNIQUE KEY uq_extraccion_motivo (extraccion_id, motivo)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS perucompras_marcas_objetivo (
        id INT AUTO_INCREMENT PRIMARY KEY,
        run_id INT NULL,
        extraccion_id INT NOT NULL,
        catalogo VARCHAR(60) NOT NULL,
        marca VARCHAR(150),
        proveedor_nombre VARCHAR(255) NULL,
        precio DECIMAL(14,2) NULL,
        actualizado_por VARCHAR(150) NULL,
        actualizado_en DATETIME NULL,
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (extraccion_id) REFERENCES perucompras_extraccion(id) ON DELETE CASCADE,
        UNIQUE KEY uq_extraccion (extraccion_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            for stmt in ddl.strip().split(";"):
                if stmt.strip():
                    cur.execute(stmt)
    finally:
        conn.close()

    _seed_marcas_perucompras()


def _seed_marcas_perucompras():
    """Carga las marcas que ANTES estaban hardcodeadas en zt.py y
    filtrar_marcas_proformas.py — solo la primera vez (INSERT IGNORE),
    para que el comportamiento inicial sea idéntico y de ahí en
    adelante el usuario las administre desde el frontend."""
    restringida_semaforo = [
        "ECOLIMPIA","DICALI","CICLÓN","ANAX","ECOLOGICO INDUBRILL","FACIL","FÁCIL",
        "INSOMED","BLANUX","ATOJ","DULQUI","RAYMI","AIME","KUELAP",
        "Q MASTER","ECO CLEAN","PÓMAC","ESTRELLA DEL NORTE","REGGIO",
        "DERMA PRO","TOOLS","ISIS","MUCHICK","APOLO","SINCHY","CISNE","DIONNE",
        "VIANFORTPRO","BELONA","BOMELSA","PROTEGE",
        "AYCER","SILGAL","BRICEL","MAXCER","GRIUPOLY","SIRYCATA",
        "CERCOR","CETOOL","JARVIS","REYSER","CIRCE","LIFAL","THN","ITZEL","FONLEA","JAZAY",
        "CERMAX","NOELIA","WADA","YOREL","CICLÓN LÍDER EN EL NORTE","ULTRA+",
        "J&R STEEL CP","BUGUI(H)","RINRI","DIMAGSA","COMPAKTO1","TOILÉ",
        "APOLO CALIDAD GARANTIZADA",
    ]
    prohibida_500_1000 = [
        "EBRIEL","PARACAS","ELITE","INSTITUCIONAL SUPER","SUPER",
        "S SUPREMIO PROFESIONAL","C3 P PROTECCION EN TUS MANOS","S SUPREMIO",
        "369 CALIDAD X 3","ESE","SUPREMIO","PARILU","BASA",
        "SCOTT","WYPALL","KLEENEX","DAYR","PARILÚ","REY PLAST",
    ]
    excepcion_menor_500 = [
        "369 CALIDAD X 3","SUPER","INSTITUCIONAL SUPER","BASA","SCOTT","KLEENEX","WYPALL","PARILU",
        "PARILÚ","REY PLAST","DAYR","S SUPREMIO PROFESIONAL","C3 P PROTECCION EN TUS MANOS","S SUPREMIO","SUPREMIO",
    ]
    objetivo = [
        "S SUPREMIO PROFESIONAL","SUPREMIO","S SUPREMIO",
        "C3 P PROTECCION EN TUS MANOS","369 CALIDAD X 3","DOÑA MARIA",
    ]

    filas = (
        [("restringida_semaforo", m) for m in restringida_semaforo]
        + [("prohibida_500_1000", m) for m in prohibida_500_1000]
        + [("excepcion_menor_500", m) for m in excepcion_menor_500]
        + [("objetivo", m) for m in objetivo]
    )

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT IGNORE INTO perucompras_marcas_config (lista, marca, creado_por) VALUES (%s, %s, 'sistema')",
                filas,
            )
    finally:
        conn.close()


def guardar_json(valor) -> str:
    return json.dumps(valor, default=str, ensure_ascii=False)
