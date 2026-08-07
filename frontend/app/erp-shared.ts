/**
 * erp-shared.ts
 * --------------
 * Helpers y tipos compartidos para hablar DIRECTO con el ERP
 * (manager-multilimpsac-production.up.railway.app), que es el mismo
 * origen que golpean los POST /api/ventas y POST /api/agrupaciones-oc
 * que me pasaste en las capturas de Network.
 *
 * ⚠️ SUPUESTO A REVISAR: en tus capturas, el request va con
 *   Authorization: Bearer <JWT del ERP>
 * Ese JWT NO es el token de Helbot (el que usa fetchConToken en
 * helbot-shared.ts) — es el token de tu sesión contra el ERP directo.
 * Ajusta `ERP_TOKEN_STORAGE_KEY` / `getErpToken()` de abajo a donde
 * realmente estés guardando ese JWT hoy (localStorage, cookie, un
 * store de auth, etc). Si en tu app ya existe un helper equivalente
 * (ej. `erpFetchConToken`), usa el tuyo y borra este archivo — está
 * pensado para que compile igual aunque no lo tengas todavía.
 */

export const ERP_BASE = "https://manager-multilimpsac-production.up.railway.app/api";

import { API_BASE, fetchConToken } from "./helbot-shared";

const ERP_TOKEN_STORAGE_KEY = "helbot_token"; // <-- AJUSTA a tu key real

export function getErpToken(): string | null {
  if (typeof window === "undefined") return null;

    const token = window.localStorage.getItem("helbot_token");

  console.log("ERP TOKEN =", token);
  return window.localStorage.getItem(ERP_TOKEN_STORAGE_KEY);
}

export async function erpFetch(path: string, init: RequestInit = {}) {
  const token = getErpToken();
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const res = await fetch(`${ERP_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.detail || `Error ${res.status} en ${path}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ============================================================
// Tipos — calcados 1:1 de los payloads que capturaste
// ============================================================
export interface ProductoVenta {
  codigo: string;
  descripcion: string;
  marca: string;
  cantidad: number;
  isCompleted: boolean;
}

export interface VentaCreatePayload {
  empresa: { connect: { id: number } };
  cliente: { connect: { id: number } };
  contactoCliente: { connect: { id: number } };
  catalogoEmpresa: { connect: { id: number } };
  codigoOcf: string | null;
  departamentoEntrega: string | null;
  direccionEntrega: string | null;
  distritoEntrega: string | null;
  provinciaEntrega: string | null;
  referenciaEntrega: string | null;
  documentoOce: string | null;
  documentoOcf: string | null;
  estadoVenta: string;
  etapaSiaf: string;
  fechaEntrega: string; // YYYY-MM-DD
  fechaForm: string; // YYYY-MM-DD
  fechaMaxForm: string; // YYYY-MM-DD
  fechaSiaf: string; // YYYY-MM-DD
  fuentesFinanciamiento: string;
  montoVenta: number;
  multipleFuentesFinanciamiento: boolean;
  numeroOcam: string | null;
  productos: ProductoVenta[];
  siaf: string | null;
  ventaPrivada: boolean | null;
}

export interface Venta extends Record<string, unknown> {
  id: number;
  codigoVenta: string;
  empresa: { id: number; razonSocial: string; ruc: string };
  cliente: { id: number; razonSocial: string; ruc: string };
  contactoCliente: { id: number; nombre: string; telefono: string | null };
  catalogoEmpresa: { id: number; nombre: string; descripcion: string };
  productos: ProductoVenta[];
  montoVenta: number;
}

export interface AgrupacionCreatePayload {
  codigoGrupo: string;
  descripcion?: string | null;
  fecha: string; // ISO
  ordenesCompraIds: number[];
}

export interface AgrupacionOC {
  id: number;
  codigoGrupo: string;
  descripcion: string | null;
  fecha: string;
  ordenesCompra: Array<{
    id: number;
    ordenCompraId: number;
    ordenCompra: {
      id: number;
      codigoVenta: string;
      montoVenta: number;
      // SUPUESTO CORREGIDO: el ERP no siempre pobla estas relaciones en
      // /api/agrupaciones-oc/by-orden-compra/:id (viste el caso real:
      // cliente venía undefined) — se marcan opcionales para que
      // TypeScript te obligue a usar "?." en cualquier lugar que las
      // consuma, en vez de asumir que siempre existen.
      empresa?: { razonSocial: string };
      cliente?: { razonSocial: string };
      // Campos extra para la card informativa del panel "Órdenes en
      // esta agrupación" — el ERP puede o no poblarlos según el
      // endpoint; se marcan opcionales y se leen con fallback "—" en
      // el componente.
      numeroOcam?: string | null;
      estadoVenta?: string | null;
      fechaEmision?: string | null;
      createdAt?: string | null;
      productos?: Array<{ codigo?: string }>;
      [key: string]: unknown;
    };
  }>;
}

// ============================================================
// Llamadas — mismos endpoints que viste en Network
// ============================================================
// IMPORTANTE: estos 3 ya NO pegan directo al ERP con erpFetch(). Pasan
// por el proxy /erp/ventas de ventas_router.py (montado en main.py),
// que reenvía usando erp_session.session — la MISMA sesión ya
// autenticada por Selenium que usan buscarClientes/contactosDeCliente/
// catalogosDeEmpresa/listarEmpresas de este mismo archivo. erpFetch()
// mandaba un Bearer adivinado (el JWT de Helbot, no el del ERP), y eso
// es lo que hacía tronar al ERP con 500.
export const crearVenta = async (payload: VentaCreatePayload): Promise<Venta> => {
  const r = await fetchConToken(`${API_BASE}/erp/ventas`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.detail || `Error ${r.status} creando la venta`);
  }
  return r.json();
};

export const actualizarVenta = async (id: number, payload: Partial<VentaCreatePayload>): Promise<Venta> => {
  const r = await fetchConToken(`${API_BASE}/erp/ventas/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.detail || `Error ${r.status} actualizando la venta`);
  }
  return r.json();
};

export const obtenerVenta = async (id: number): Promise<Venta> => {
  const r = await fetchConToken(`${API_BASE}/erp/ventas/${id}`);
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.detail || `Error ${r.status} obteniendo la venta`);
  }
  return r.json();
};

// Igual que crearVenta/actualizarVenta: pasan por el proxy /erp/... de
// ventas_router.py (con la sesión ERP real de Selenium) en vez de
// erpFetch() directo a Railway con un Bearer adivinado.
export const crearAgrupacion = async (payload: AgrupacionCreatePayload): Promise<AgrupacionOC> => {
  const r = await fetchConToken(`${API_BASE}/erp/agrupaciones-oc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.detail || `Error ${r.status} creando la agrupación`);
  }
  return r.json();
};



// Agrega una orden a un grupo YA EXISTENTE — a diferencia de
// crearAgrupacion() (que crea un grupo con un codigoGrupo nuevo), este
// endpoint no intenta crear nada, por eso no choca con el codigoGrupo
// único del ERP (ese choque es lo que te tiraba el 409 Conflict).
export const agregarOrdenAAgrupacion = async (
  agrupacionId: number,
  ordenCompraId: number
): Promise<AgrupacionOC> => {
  const r = await fetchConToken(`${API_BASE}/erp/agrupaciones-oc/${agrupacionId}/agregar-orden`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ordenCompraId }),
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.detail || `Error ${r.status} agregando la orden a la agrupación`);
  }
  return r.json();
};

export const agrupacionPorOrdenCompra = async (ordenCompraId: number): Promise<AgrupacionOC | null> => {
  try {
    const r = await fetchConToken(`${API_BASE}/erp/agrupaciones-oc/by-orden-compra/${ordenCompraId}`);
    if (!r.ok) return null; // el ERP puede responder 404 si no está agrupada — main.py/ventas_router ya lo normalizan a null
    return r.json();
  } catch {
    return null;
  }
};


export const agrupacionPorId = async (agrupacionId: number): Promise<AgrupacionOC | null> => {
  try {
    const r = await fetchConToken(`${API_BASE}/erp/agrupaciones-oc/${agrupacionId}`);
    if (!r.ok) return null;
    return r.json();
  } catch {
    return null;
  }
};
// Endpoints de búsqueda para Cliente / Contacto / Catálogo — no salieron
// en tus capturas de Network (probablemente porque ya estaban en caché
// cuando grabaste), así que estos paths son mi mejor supuesto siguiendo
// el resto de tu API REST (`/api/ventas`, `/api/agrupaciones-oc`, etc).
// AJÚSTALOS a los reales — son el único bloque que casi seguro hay que tocar.
export const buscarClientes = async (query: string) => {
  const r = await fetchConToken(`${API_BASE}/erp/clientes${query ? `?search=${encodeURIComponent(query)}` : ""}`);
  if (!r.ok) throw new Error(`Error ${r.status} buscando clientes`);
  return r.json() as Promise<
    Array<{
      id: number;
      razonSocial: string;
      ruc: string;
      departamento?: string;
      provincia?: string;
      distrito?: string;
      codigoUnidadEjecutora?: string;
    }>
  >;
};

export const contactosDeCliente = async (clienteId: number) => {
  const r = await fetchConToken(`${API_BASE}/erp/clientes/${clienteId}/contactos`);
  if (!r.ok) throw new Error(`Error ${r.status} obteniendo contactos`);
  return r.json() as Promise<
    Array<{ id: number; nombre: string; telefono: string | null; email: string | null; cargo: string | null }>
  >;
};

export interface ContactoCreatePayload {
  nombre: string;
  cargo?: string;
  telefono?: string;
  email?: string;
  cumpleanos?: string;
  nota?: string;
}

export const crearContacto = async (clienteId: number, payload: ContactoCreatePayload) => {
  const r = await fetchConToken(`${API_BASE}/erp/clientes/${clienteId}/contactos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Error ${r.status} creando contacto`);
  return r.json() as Promise<{ id: number; nombre: string; telefono: string | null; email: string | null; cargo: string | null }>;
};


export interface ContactoProveedor {
  id: number;
  nombre: string;
  telefono: string | null;
  email: string | null;
  cargo: string | null;
  cumpleanos?: string | null;
  nota?: string | null;
}

export const contactosDeProveedor = async (proveedorId: number) => {
  const r = await fetchConToken(`${API_BASE}/erp/proveedores/${proveedorId}/contactos`);
  if (!r.ok) throw new Error(`Error ${r.status} obteniendo contactos del proveedor`);
  return r.json() as Promise<{ data: ContactoProveedor[] }>;
};

export const crearContactoProveedor = async (proveedorId: number, payload: ContactoCreatePayload) => {
  const r = await fetchConToken(`${API_BASE}/erp/proveedores/${proveedorId}/contactos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Error ${r.status} creando contacto del proveedor`);
  return r.json() as Promise<ContactoProveedor>;
};

export const catalogosDeEmpresa = async (empresaId: number) => {
  const r = await fetchConToken(`${API_BASE}/erp/catalogos/empresa/${empresaId}`);
  if (!r.ok) throw new Error(`Error ${r.status} obteniendo catálogos`);
  return r.json() as Promise<
    Array<{ id: number; nombre: string; descripcion: string; empresaId: number }>
  >;
};

export interface EmpresaOption {
  id: number;
  razonSocial: string;
  ruc: string;
}

export const listarEmpresas = async () => {
  const r = await fetchConToken(`${API_BASE}/erp/empresas`);
  if (!r.ok) throw new Error(`Error ${r.status} obteniendo empresas`);
  return r.json() as Promise<EmpresaOption[]>;
};


export interface AgrupacionListItem {
  id: number;
  codigoGrupo: string;
  descripcion: string | null;
}

export const listarAgrupaciones = async () => {
  const r = await fetchConToken(`${API_BASE}/erp/agrupaciones-oc`);
  if (!r.ok) throw new Error(`Error ${r.status} obteniendo agrupaciones`);
  return r.json() as Promise<AgrupacionListItem[]>;
};

// Sube un PDF (OCE u OCF) vía el proxy /erp/documentos/subir de
// ventas_router.py, que a su vez le pega a POST /api/files del ERP
// (confirmado en Network: multipart con 'file' + 'folder', responde
// {"url": "..."}). Se pasa por fetchConToken porque quien golpea acá
// es Helbot, no el ERP directo — mismo patrón que crearVenta, etc.
export const subirDocumento = async (archivo: File, tipo: "OCE" | "OCF"): Promise<string> => {
  const fd = new FormData();
  fd.append("archivo", archivo);
  fd.append("tipo", tipo);
  const r = await fetchConToken(`${API_BASE}/erp/documentos/subir`, {
    method: "POST",
    body: fd,
  });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(body.detail || `Error ${r.status} subiendo el documento ${tipo}`);
  }
  const data = await r.json();
  return data.url as string;
};