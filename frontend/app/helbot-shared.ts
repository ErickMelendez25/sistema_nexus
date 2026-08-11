export const API_BASE =
  process.env.NEXT_PUBLIC_HELBOT_API || "http://localhost:4002";

export const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws/alertas";

/**
 * Envía automáticamente el token JWT al backend.
 */
export function fetchConToken(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = localStorage.getItem("helbot_token");

  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export interface Publicada {
  N_OrdenCompra: number;
  C_OrdenCompra: string;
  C_Entidad: string;
  C_EstadoOrden: string;
  C_FechaEstado: string;
  N_Total: number;
  C_Procedimiento: string;
  C_TipoContratacion: string;
  C_RutaPdfOC: string;

  _n_acuerdo?: number;
  _n_catalogo?: number;
  _acuerdo_codigo?: string;
  _acuerdo_nombre?: string;
  _catalogo_nombre?: string;
}

export interface EntregaDetalle {
  N_OrdenCompra: number;
  C_OrdenCompra: string;
  C_EstadoOrden: string;
  C_FechaEstado: string | null;
  C_LugarEntrega: string | null;
  C_InicioEntrega: string | null;
  C_FinEntrega: string | null;
  C_ExpedienteSIAF: string | null;
  C_OrdenCompraCab: string | null;
  N_SubTotal: number | null;
  N_Igv: number | null;
  N_Total: number;
}