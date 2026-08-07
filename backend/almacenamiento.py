"""
Helbot - almacenamiento.py
----------------------------
Capa de abstracción de almacenamiento de archivos (imágenes de productos).

HOY: backend "local" — guarda en el disco de esta PC (Crosshair 18),
servido por /archivos vía StaticFiles en main.py. Así sigue funcionando
exactamente igual que ahora, sin ningún cambio de comportamiento.

EL DÍA QUE MIGRES a VPS/AWS/Azure: solo cambias la variable de entorno
STORAGE_BACKEND (a "s3" o "azure"), agregas las credenciales del bucket
en el .env, e instalas 1 librería (boto3 o azure-storage-blob). NINGÚN
otro archivo del proyecto necesita tocarse — main.py y op_seguimiento.py
ya hablan con esta capa, no con el disco directamente.
"""
import os
import uuid
from pathlib import Path
from abc import ABC, abstractmethod

STORAGE_BACKEND = os.getenv("STORAGE_BACKEND", "local").lower()  # "local" | "s3" | "azure"


class AlmacenamientoBase(ABC):
    @abstractmethod
    def guardar(self, contenido: bytes, extension: str, prefijo: str) -> str:
        """Guarda el archivo. Devuelve el valor que se persiste como
        ruta_archivo en la tabla op_producto_imagenes."""
        ...

    @abstractmethod
    def eliminar(self, ruta_archivo: str) -> None:
        ...

    @abstractmethod
    def url_publica(self, ruta_archivo: str) -> str:
        """URL completa lista para usar en <img src=...> en el frontend."""
        ...


# ============================================================
# HOY — disco local de esta PC
# ============================================================
class AlmacenamientoLocal(AlmacenamientoBase):
    def __init__(self):
        # Ruta configurable por variable de entorno, para que las imágenes
        # vivan FUERA de la carpeta del código (no se pierden si borras o
        # re-clonas el proyecto, y los backups quedan separados y simples).
        ruta_default = str(Path.home() / "HelbotData" / "op_productos")
        self.upload_dir = Path(os.getenv("UPLOAD_DIR", ruta_default))
        self.upload_dir.mkdir(parents=True, exist_ok=True)
        # Debe apuntar a la misma URL pública que usa el frontend para
        # llegar a este backend (NEXT_PUBLIC_HELBOT_API en el .env del front).
        self.api_base = os.getenv("HELBOT_API_PUBLIC", "http://localhost:4001")

    def guardar(self, contenido: bytes, extension: str, prefijo: str) -> str:
        nombre_unico = f"{prefijo}_{uuid.uuid4().hex}{extension}"
        destino = self.upload_dir / nombre_unico
        destino.write_bytes(contenido)
        return nombre_unico

    def eliminar(self, ruta_archivo: str) -> None:
        archivo = self.upload_dir / ruta_archivo
        if archivo.exists():
            archivo.unlink()

    def url_publica(self, ruta_archivo: str) -> str:
        return f"{self.api_base}/archivos/{ruta_archivo}"


# ============================================================
# MAÑANA (opción A) — AWS S3
# Activar con: STORAGE_BACKEND=s3, pip install boto3, y en el .env:
#   AWS_ACCESS_KEY_ID=...
#   AWS_SECRET_ACCESS_KEY=...
#   AWS_BUCKET_NAME=...
#   AWS_REGION=us-east-1  (o la región que uses)
# ============================================================
class AlmacenamientoS3(AlmacenamientoBase):
    def __init__(self):
        import boto3  # import perezoso: si no migras, no necesitas instalarlo
        self.bucket = os.environ["AWS_BUCKET_NAME"]
        self.region = os.environ.get("AWS_REGION", "us-east-1")
        self.prefijo_carpeta = os.getenv("AWS_UPLOAD_PREFIX", "op_productos")
        self.cliente = boto3.client(
            "s3",
            region_name=self.region,
            aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        )

    def guardar(self, contenido: bytes, extension: str, prefijo: str) -> str:
        clave = f"{self.prefijo_carpeta}/{prefijo}_{uuid.uuid4().hex}{extension}"
        self.cliente.put_object(
            Bucket=self.bucket, Key=clave, Body=contenido,
            ContentType=_content_type(extension),
        )
        return f"https://{self.bucket}.s3.{self.region}.amazonaws.com/{clave}"

    def eliminar(self, ruta_archivo: str) -> None:
        clave = ruta_archivo.split(f"{self.bucket}.s3.{self.region}.amazonaws.com/")[-1]
        self.cliente.delete_object(Bucket=self.bucket, Key=clave)

    def url_publica(self, ruta_archivo: str) -> str:
        return ruta_archivo  # ya es la URL completa, se guarda tal cual en la DB


# ============================================================
# MAÑANA (opción B) — Azure Blob Storage
# Activar con: STORAGE_BACKEND=azure, pip install azure-storage-blob, y:
#   AZURE_STORAGE_CONNECTION_STRING=...
#   AZURE_CONTAINER_NAME=...
# ============================================================
class AlmacenamientoAzure(AlmacenamientoBase):
    def __init__(self):
        from azure.storage.blob import BlobServiceClient
        self.container = os.environ["AZURE_CONTAINER_NAME"]
        self.cliente = BlobServiceClient.from_connection_string(
            os.environ["AZURE_STORAGE_CONNECTION_STRING"]
        )
        self.prefijo_carpeta = os.getenv("AZURE_UPLOAD_PREFIX", "op_productos")

    def guardar(self, contenido: bytes, extension: str, prefijo: str) -> str:
        nombre = f"{self.prefijo_carpeta}/{prefijo}_{uuid.uuid4().hex}{extension}"
        blob = self.cliente.get_blob_client(container=self.container, blob=nombre)
        blob.upload_blob(contenido, overwrite=True)
        return blob.url

    def eliminar(self, ruta_archivo: str) -> None:
        nombre = ruta_archivo.split(f"/{self.container}/")[-1]
        self.cliente.get_blob_client(container=self.container, blob=nombre).delete_blob()

    def url_publica(self, ruta_archivo: str) -> str:
        return ruta_archivo


def _content_type(extension: str) -> str:
    return {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
    }.get(extension.lower(), "application/octet-stream")


def obtener_almacenamiento() -> AlmacenamientoBase:
    if STORAGE_BACKEND == "s3":
        return AlmacenamientoS3()
    if STORAGE_BACKEND == "azure":
        return AlmacenamientoAzure()
    return AlmacenamientoLocal()


# Instancia única reutilizada en toda la app.
almacenamiento = obtener_almacenamiento()