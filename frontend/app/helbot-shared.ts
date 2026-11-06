export const API_BASE =
  process.env.NEXT_PUBLIC_HELBOT_API || "http://localhost:4002";

export const WS_URL = API_BASE.replace(/^http/, "ws") + "/ws/alertas";

/**
 * Envía automáticamente el token JWT al backend.
 */
export async function fetchConToken(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = localStorage.getItem("helbot_token");

  const r = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  // Sesión expulsada / revocada / vencida: avisa y vuelve al login.
  // Solo con estos mensajes, para no romper el 401 de "sin sesión ERP".
  if (r.status === 401 && token) {
    const b = await r.clone().json().catch(() => ({}));
    const detalle = String(b.detail || "");
    if (/Sesión revocada|se cerró porque|Sesión expirada|Token inválido/.test(detalle)) {
      localStorage.setItem("helbot_aviso", detalle);
      localStorage.removeItem("helbot_token");
      localStorage.removeItem("helbot_usuario");
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
  }

  return r;
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