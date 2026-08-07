"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Briefcase,
  Search,
  Loader2,
  LogIn,
  LogOut,
  User,
  Lock,
  AlertTriangle,
  RefreshCw,
FileSpreadsheet,
  ChevronRight,
  ChevronLeft,
  FileText,
} from "lucide-react";


import PerucomprasPanel from "./PerucomprasPanel";


interface EquipoVentasOperacionesProps {
  apiBase: string;
}

interface UsuarioPeruOption {
  uid: string;
  label: string;
}

interface EstadoUsuarioPeru {
  label: string;
  autenticado: boolean;
  estado: string;
}

interface SesionEstadoResp {
  perucompras: Record<string, EstadoUsuarioPeru>;
  perucompras_activo: string | null;
  erp: boolean;
}

interface Proforma {
  requerimiento: string;
  nRequerimiento: string | number;
  nProforma: string | number;
  procedimiento: string;
  estrategiaCompra: string;
  contratacionConFinanciamiento: string;
  proforma: string;
  fechaEmision: string;
  estado: string;
  observaciones: string;
  fechaLimiteCotizacion: string;
  totalCotizado: number;
  entidad: string;
  ruc: string;
  fichaTipo: string;
  indicador: "verde" | "amarillo" | "rojo" | string;
  puedeCotizar: boolean;
  esPaquete: string;
} 

interface FiltrosProformas {
  acuerdoMarco: string;
  catalogoElectronico: string;
  categoria: string;
  palabraClave: string;
  estado: string;
  procedimiento: string;
  tipoContratacion: string;
  estrategiaCompra: string;
  fechaInicial: string;
  fechaFinal: string;
}

interface AcuerdoOption {
  id: string;
  codigo: string;
  nombre: string;
}


interface CatalogoOption {
  id: string;
  nombre: string;
}

interface CategoriaOption {
  id: string;
  nombre: string;
}

interface FichaProductoCotizar {
  producto: string;
  fichaProducto: string;
  fichaTecnicaUrl: string;
  condicionesAdicionales: boolean;
  cantidad: number;
  proforma: string;
  monedaBase: string;
  precioUnitarioBase: number;
  precioUnitarioOfertado: number;
  precioUnitarioOfertadoPEN: number;
}

interface ProductoEntregaCotizar {
  producto: string;
  cantidad: number;
  precioUnitario: number;
  costoUnitarioEnvio: number;
  precioUnitarioTotal: number;
  igv: number;
  subTotal: number;
}

interface EntregaCotizar {
  nro: number;
  direccion: string;
  inicioEntrega: string;
  plazoMaximo: number;
  finEntrega: string;
  costoTotalProductos: number;
  subTotal: number;
  productos: ProductoEntregaCotizar[];
}

export interface CotizacionDetalle {
  entidadRuc: string;
  entidadNombre: string;
  tipoCompra: string;
  tipoCambio: number;
  totalPEN: number;
  estado: string;
  fichas: FichaProductoCotizar[];
  entregas: EntregaCotizar[];
  raw: any;
}

export function mapearCotizacionDetalle(raw: any): CotizacionDetalle {
  // Confirmado con la respuesta real de cargarCotizar: todo cuelga de pObjecto.
  const obj = raw?.pObjecto || {};
  const productosRaw: any[] = obj.productos || [];
  const entregasRaw: any[] = obj.entregas || [];

  const esPEN = (moneda: string) => (moneda || "PEN").toUpperCase() === "PEN";

  return {
    // C_UnidadEjecutora ya viene como "RUC NOMBRE [codigo]" en un solo string
    entidadRuc: "",
    entidadNombre: obj.C_UnidadEjecutora || "",
    tipoCompra: obj.C_Procedimiento || "",
    tipoCambio: Number(obj.N_TipoCambio || 0),
    totalPEN: Number(obj.N_Total || 0),
    estado: obj.C_Estado || "",
    fichas: productosRaw.map((p) => {
      // CASO PAQUETE: marca/cantidad/precio reales NO están en el nivel
      // "producto" (vienen en 0) sino en proformas[0] — mismo patrón que
      // ya usa obtener_catalogos_mysql en el backend. Si no hay proformas
      // (caso normal), cae en el propio producto.
      const pf = (p.proformas && p.proformas[0]) || p;
      const tc = Number(pf.N_TipoCambio || obj.N_TipoCambio || 1);
      const ofertado = Number(pf.N_PrecioOfertado ?? pf.N_PrecioUnitarioBase ?? 0);
      return {
        producto: p.C_Producto || pf.C_Producto || "",
        fichaProducto: pf.C_Ficha || "",
        fichaTecnicaUrl: pf.C_ArchivoDescriptivo
          ? `https://saeusceprod01.blob.core.windows.net/contproveedor/Documentos/Productos/${pf.C_ArchivoDescriptivo}`
          : "",
        condicionesAdicionales: (pf.C_AplicaCondicionesAdicionales || "").toUpperCase() === "SI",
        cantidad: Number(pf.N_Cantidad || 0),
        proforma: pf.C_Proforma || "",
        monedaBase: pf.C_Moneda || "PEN",
        precioUnitarioBase: Number(pf.N_PrecioUnitarioBase || 0),
        precioUnitarioOfertado: ofertado,
        precioUnitarioOfertadoPEN: esPEN(pf.C_Moneda) ? ofertado : ofertado * tc,
      };
    }),
    entregas: entregasRaw.map((e, idx) => ({
      nro: idx + 1,
      direccion: e.C_Direccion || "",
      inicioEntrega: e.C_FInicioEntrega || "",
      plazoMaximo: Number(e.N_Plazo || 0),
      finEntrega: e.C_FFinEntrega || "",
      costoTotalProductos: Number(e.N_CostoProductos || 0),
      subTotal: Number(e.N_SubTotal || 0),
      productos: (e.m_RProductoEntrega || []).map((pr: any) => ({
        producto: pr.C_Producto || "",
        cantidad: Number(pr.N_Cantidad || 0),
        precioUnitario: Number(pr.N_PrecioUnitarioBase || 0),
        costoUnitarioEnvio: Number(pr.N_CostoEnvio || 0),
        precioUnitarioTotal: Number(pr.N_PrecioUnitarioTotal || 0),
        igv: Number(pr.N_ImporteIGV || 0),
        subTotal: Number(pr.N_SubTotal || 0),
      })),
    })),
    raw,
  };
}

// IMPORTANTE: nunca usar toISOString() aquí — convierte a UTC, y en
// Perú (UTC-5) eso adelanta la fecha un día completo en las horas de
// la tarde/noche (ej. 9pm del día 2 en Lima ya es día 3 en UTC).
// Se arma el string manualmente con los componentes en hora LOCAL.
const fechaLocalISO = (d: Date) => {
  const anio = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${anio}-${mes}-${dia}`;
};

const hoyISO = () => fechaLocalISO(new Date());

const mananaISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return fechaLocalISO(d);
};

const filtrosVacios = (): FiltrosProformas => ({
  acuerdoMarco: "",
  catalogoElectronico: "",
  categoria: "",
  palabraClave: "",
  estado: "",
  procedimiento: "",
  tipoContratacion: "",
  estrategiaCompra: "",
  fechaInicial: hoyISO(),
  fechaFinal: mananaISO(),
});

function badgeIndicador(indicador: string) {
  switch (indicador) {
    case "verde":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "amarillo":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "rojo":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function badgeEstadoProforma(estado: string) {
  switch (estado.toUpperCase()) {
    case "PENDIENTE":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "RESTRINGIDA":
      return "bg-red-50 text-red-700 border-red-200";
    case "COTIZADA":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "DESIERTA":
      return "bg-slate-200 text-slate-600 border-slate-300";
    default:
      return "bg-slate-100 text-slate-600 border-slate-200";
  }
}
function cardEstadoClasses(estado: string) {
  switch (estado.toUpperCase()) {
    case "COTIZADA":
      return {
        card: "border-emerald-200 bg-emerald-50/40 hover:border-emerald-300",
        header: "bg-emerald-50 border-emerald-100",
      };
    case "PENDIENTE":
      return {
        card: "border-amber-200 bg-amber-50/40 hover:border-amber-300",
        header: "bg-amber-50 border-amber-100",
      };
    case "RESTRINGIDA":
      return {
        card: "border-red-200 bg-red-50/40 hover:border-red-300",
        header: "bg-red-50 border-red-100",
      };
    case "DESIERTA":
      return {
        card: "border-slate-300 bg-slate-100/60 hover:border-slate-400",
        header: "bg-slate-200/70 border-slate-200",
      };
    default:
      return {
        card: "border-slate-200 bg-white hover:border-slate-300",
        header: "bg-slate-50 border-slate-100",
      };
  }
}



const inputCls =
  "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30 focus:border-[#4F46E5]";

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

export default function EquipoVentasOperaciones({ apiBase }: EquipoVentasOperacionesProps) {
  // ---------------- Login gate ----------------
  const [usuariosDisponibles, setUsuariosDisponibles] = useState<UsuarioPeruOption[]>([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true);
  const [sesion, setSesion] = useState<SesionEstadoResp | null>(null);
  const [uidActivo, setUidActivo] = useState<string>("");
  const [cargandoLogin, setCargandoLogin] = useState<string | null>(null);
  const [errorLogin, setErrorLogin] = useState("");
  const [mensajeEsperaLogin, setMensajeEsperaLogin] = useState(""); 

  const [mostrarLoginManual, setMostrarLoginManual] = useState(false);
  const [manualUsuario, setManualUsuario] = useState("");
  const [manualPassword, setManualPassword] = useState("");

  const cargarEstadoSesion = useCallback(async () => {
    try {
      const r = await fetch(`${apiBase}/sesion/estado`);
      const data: SesionEstadoResp = await r.json();
      setSesion(data);
      return data;
    } catch {
      return null;
    }
  }, [apiBase]);

  const cargarUsuarios = useCallback(async () => {
    setCargandoUsuarios(true);
    try {
      const r = await fetch(`${apiBase}/sesion/perucompras/usuarios`);
      const data: UsuarioPeruOption[] = await r.json();
      setUsuariosDisponibles(data);
    } catch {
      setUsuariosDisponibles([]);
    } finally {
      setCargandoUsuarios(false);
    }
  }, [apiBase]);

  useEffect(() => {
    cargarUsuarios();
    cargarEstadoSesion();
  }, [cargarUsuarios, cargarEstadoSesion]);


  // Este componente no tenía WebSocket propio — por eso el selector de
  // "Usuarios ya configurados" y el badge de sesión activa solo se
  // actualizaban al recargar la página. Con esto, cualquier login,
  // logout o pérdida de sesión que ocurra DESDE OTRO LUGAR (sidebar,
  // otro usuario en otra pestaña, keep-alive automático) se refleja
  // acá al instante — quedando sincronizado con el sidebar.
  useEffect(() => {
    const wsUrl = apiBase.replace(/^http/, "ws") + "/ws/alertas";
    let cancelado = false;
    let reconectarTimeout: ReturnType<typeof setTimeout> | null = null;

    function conectar() {
      if (cancelado) return;
      const ws = new WebSocket(wsUrl);
      ws.onmessage = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(ev.data);
          if (
            msg.tipo === "perucompras_login_ok" ||
            msg.tipo === "perucompras_logout" ||
            msg.tipo === "perucompras_sesion_perdida" ||
            msg.tipo === "perucompras_sesion_recuperada" ||
            msg.tipo === "perucompras_sesion_fallida"
          ) {
            cargarEstadoSesion();
            cargarUsuarios();
          }
        } catch {
          /* noop */
        }
      };
      ws.onclose = () => {
        if (!cancelado) reconectarTimeout = setTimeout(conectar, 4000);
      };
      ws.onerror = () => ws.close();
    }
    conectar();

    return () => {
      cancelado = true;
      if (reconectarTimeout) clearTimeout(reconectarTimeout);
    };
  }, [apiBase, cargarEstadoSesion, cargarUsuarios]);

  const esperarAutenticado = async (
    uid: string,
    timeoutMs = 90000,
    intervaloMs = 2000
  ): Promise<"ok" | "fallo" | "timeout"> => {
    const inicio = Date.now();
    let vistoCargando = false; // para no confundir el "desconectado" inicial con un fallo real
    while (Date.now() - inicio < timeoutMs) {
      const estado = await cargarEstadoSesion();
      const info = estado?.perucompras[uid];
      if (info?.autenticado) return "ok";
      if (info?.estado === "cargando") {
        vistoCargando = true;
      } else if (vistoCargando) {
        // Ya estuvo "cargando" y ahora volvió a "desconectado"/"perdida":
        // el backend agotó sus 5 intentos, cerró Chrome y limpió el perfil.
        // No tiene caso seguir esperando los 90s completos.
        return "fallo";
      }
      await new Promise((res) => setTimeout(res, intervaloMs));
    }
    return "timeout";
  };

const MAX_REINTENTOS_LOGIN = 2; // + el intento inicial = 3 intentos totales

  const loginConUsuarioPredefinido = async (uid: string, intento = 1) => {
    setErrorLogin("");
    setCargandoLogin(uid);
    setMensajeEsperaLogin(
      intento === 1
        ? "Iniciando sesión..."
        : `Hubo un retraso, reintentando inicio de sesión (${intento}/${MAX_REINTENTOS_LOGIN + 1})...`
    );
    try {
      await fetch(`${apiBase}/sesion/perucompras/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid }),
      });
      const resultado = await esperarAutenticado(uid);

      if (resultado === "ok") {
        setUidActivo(uid);
        return;
      }

      if (resultado === "fallo" && intento <= MAX_REINTENTOS_LOGIN) {
        // El backend ya cerró la ventana y limpió el perfil de este uid.
        // Volvemos a pedir login sin que el usuario tenga que tocar nada.
        await loginConUsuarioPredefinido(uid, intento + 1);
        return;
      }

      setErrorLogin(
        resultado === "timeout"
          ? "No se pudo iniciar sesión (timeout). Intenta nuevamente."
          : "No se pudo iniciar sesión tras varios intentos (captcha/verificación). Intenta nuevamente."
      );
    } catch {
      setErrorLogin("Error de conexión al iniciar sesión.");
    } finally {
      setMensajeEsperaLogin("");
      setCargandoLogin(null);
    }
  };

  const loginManual = async () => {
    if (!manualUsuario.trim() || !manualPassword.trim()) {
      setErrorLogin("Ingresa usuario y contraseña.");
      return;
    }
    setErrorLogin("");
    setCargandoLogin("__manual__");
    try {
      const r = await fetch(`${apiBase}/sesion/perucompras/login-manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario: manualUsuario.trim(), password: manualPassword }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || "No se pudo iniciar sesión");
      }
      const data = await r.json();
      const uid = data.uid as string;
      const ok = await esperarAutenticado(uid);
      if (ok) {
        setUidActivo(uid);
        await cargarUsuarios();
      } else {
        setErrorLogin("No se pudo iniciar sesión (timeout). Revisa las credenciales.");
      }
    } catch (e) {
      setErrorLogin(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCargandoLogin(null);
    }
  };


const [cerrandoSesionReal, setCerrandoSesionReal] = useState(false);

  const cerrarSesionRealPeru = async () => {
    if (!uidActivo || cerrandoSesionReal) return;
    setCerrandoSesionReal(true);
    const uidACerrar = uidActivo;
    try {
      // Este SÍ mata el proceso de Chrome de verdad y limpia el perfil
      // en el backend — a diferencia de "Cambiar de usuario" (arriba),
      // que solo resetea el estado local para poder ir y venir entre
      // perfiles ya logueados sin cerrar nada.
      await fetch(`${apiBase}/sesion/perucompras/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: uidACerrar }),
      });
    } catch {
      // Si falla la petición, igual limpiamos el estado local abajo —
      // en el peor caso queda el proceso de Chrome vivo en el servidor
      // hasta el próximo intento de login de este mismo uid.
    } finally {
      setCerrandoSesionReal(false);
    }

    cerrarSesionPeru();
    await cargarEstadoSesion();
    await cargarUsuarios();
  };


const cerrarSesionPeru = () => {
    setUidActivo("");

    // Reset total del estado dependiente del usuario anterior.
    // Sin esto, al loguear con otro usuario seguías viendo la
    // búsqueda/paginación/filtros del usuario anterior hasta volver
    // a tocar cada cosa manualmente.
    setFiltros(filtrosVacios());
    setProformas([]);
    setBuscoAlMenosUnaVez(false);
    setErrorProformas("");
    setPaginaActual(1);
    setFiltroEstadoActivo(null);

    setAcuerdosDisponibles([]);
    setCatalogosDisponibles([]);
    setCategoriasDisponibles([]);

    setModalCotizarAbierto(false);
    setProformaSeleccionada(null);
    setCotizacionDetalle(null);
    setErrorCotizar("");
    setPdfViewerUrl(null);
  };

  const yaHayActivo = !!uidActivo && sesion?.perucompras[uidActivo]?.autenticado;

  // ---------------- Filtros + tabla de proformas ----------------
  const [filtros, setFiltros] = useState<FiltrosProformas>(filtrosVacios());
  const [proformas, setProformas] = useState<Proforma[]>([]);
  const [cargandoProformas, setCargandoProformas] = useState(false);
const [errorProformas, setErrorProformas] = useState("");
  const [buscoAlMenosUnaVez, setBuscoAlMenosUnaVez] = useState(false);

// ---------------- Paginación ----------------
  const [paginaActual, setPaginaActual] = useState(1);
  const [filasPorPagina, setFilasPorPagina] = useState(20);

  // ---------------- Filtro rápido por KPI ----------------
  const [filtroEstadoActivo, setFiltroEstadoActivo] = useState<string | null>(null);

  // ---------------- Panel de filtros colapsable ----------------
  const [filtrosVisibles, setFiltrosVisibles] = useState(true);


  const [extraccionCorriendo, setExtraccionCorriendo] = useState(false);
  // ---------------- Modal Cotizar ----------------
  const [modalCotizarAbierto, setModalCotizarAbierto] = useState(false);
  const [proformaSeleccionada, setProformaSeleccionada] = useState<Proforma | null>(null);
  const [cotizacionDetalle, setCotizacionDetalle] = useState<CotizacionDetalle | null>(null);
    const [cargandoCotizar, setCargandoCotizar] = useState(false);
  const [errorCotizar, setErrorCotizar] = useState("");
  const [pdfViewerUrl, setPdfViewerUrl] = useState<string | null>(null);

  const abrirCotizar = async (p: Proforma) => {
    if (!p.puedeCotizar || !yaHayActivo) return;
    setProformaSeleccionada(p);
    setModalCotizarAbierto(true);
    setCotizacionDetalle(null);
    setErrorCotizar("");
    setPdfViewerUrl(null);
    setCargandoCotizar(true);
    try {
      const params = new URLSearchParams({ uid: uidActivo });
      const r = await fetch(`${apiBase}/perucompras/proformas/cotizar-detalle?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nRequerimiento: p.nRequerimiento,
          nProforma: p.nProforma,
          nEsCompraPorPaquete: p.esPaquete || "0",
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || `Error HTTP ${r.status}`);
      }
      const raw = await r.json();
      setCotizacionDetalle(mapearCotizacionDetalle(raw));
    } catch (e) {
      setErrorCotizar(e instanceof Error ? e.message : "No se pudo cargar la cotización");
    } finally {
      setCargandoCotizar(false);
    }
  };

const cerrarModalCotizar = () => {
    setModalCotizarAbierto(false);
    setProformaSeleccionada(null);
    setCotizacionDetalle(null);
    setErrorCotizar("");
    setPdfViewerUrl(null);
  };
  const actualizarPrecioFicha = (index: number, valor: number) => {
    setCotizacionDetalle((prev) => {
      if (!prev) return prev;
      const fichas = prev.fichas.map((f, i) =>
        i === index ? { ...f, precioUnitarioOfertado: valor, precioUnitarioOfertadoPEN: valor } : f
      );
      return { ...prev, fichas };
    });
  };

  const actualizarEntrega = (entregaIndex: number, campo: "plazoMaximo", valor: number) => {
    setCotizacionDetalle((prev) => {
      if (!prev) return prev;
      const entregas = prev.entregas.map((e, i) => (i === entregaIndex ? { ...e, [campo]: valor } : e));
      return { ...prev, entregas };
    });
  };

  const actualizarCostoEnvioProducto = (entregaIndex: number, productoIndex: number, valor: number) => {
    setCotizacionDetalle((prev) => {
      if (!prev) return prev;
      const entregas = prev.entregas.map((e, i) => {
        if (i !== entregaIndex) return e;
        const productos = e.productos.map((pr, pi) =>
          pi === productoIndex ? { ...pr, costoUnitarioEnvio: valor } : pr
        );
        return { ...e, productos };
      });
      return { ...prev, entregas };
    });
  };
  const actualizarFiltro = <K extends keyof FiltrosProformas>(campo: K, valor: FiltrosProformas[K]) =>
    setFiltros((f) => ({ ...f, [campo]: valor }));


const [categoriasDisponibles, setCategoriasDisponibles] = useState<CategoriaOption[]>([]);
  const [cargandoCategorias, setCargandoCategorias] = useState(false);


  const [catalogosDisponibles, setCatalogosDisponibles] = useState<CatalogoOption[]>([]);
  const [cargandoCatalogos, setCargandoCatalogos] = useState(false);

  useEffect(() => {
    if (!yaHayActivo || !filtros.acuerdoMarco) {
      setCatalogosDisponibles([]);
      return;
    }
    const cargar = async () => {
      setCargandoCatalogos(true);
      try {
        const params = new URLSearchParams({ uid: uidActivo, n_acuerdo: filtros.acuerdoMarco });
        const r = await fetch(`${apiBase}/perucompras/catalogos?${params.toString()}`);
        if (!r.ok) throw new Error();
        const data = await r.json();
        setCatalogosDisponibles(data.catalogos || []);
      } catch {
        setCatalogosDisponibles([]);
      } finally {
        setCargandoCatalogos(false);
      }
    };
    cargar();
  }, [filtros.acuerdoMarco, uidActivo, yaHayActivo, apiBase]);


  const [acuerdosDisponibles, setAcuerdosDisponibles] = useState<AcuerdoOption[]>([]);
  const [cargandoAcuerdos, setCargandoAcuerdos] = useState(false);

  useEffect(() => {
    if (!yaHayActivo) {
      setAcuerdosDisponibles([]);
      return;
    }
    const cargar = async () => {
      setCargandoAcuerdos(true);
      try {
        const params = new URLSearchParams({ uid: uidActivo });
        const r = await fetch(`${apiBase}/perucompras/acuerdos?${params.toString()}`);
        if (!r.ok) throw new Error();
        const data = await r.json();
        setAcuerdosDisponibles(data.acuerdos || []);
      } catch {
        setAcuerdosDisponibles([]);
      } finally {
        setCargandoAcuerdos(false);
      }
    };
    cargar();
  }, [yaHayActivo, uidActivo, apiBase]);

useEffect(() => {
    if (!yaHayActivo || !filtros.catalogoElectronico) {
      setCategoriasDisponibles([]);
      return;
    }
    const cargar = async () => {
      setCargandoCategorias(true);
      try {
        const params = new URLSearchParams({
          uid: uidActivo,
          n_catalogo: filtros.catalogoElectronico,
        });
        const r = await fetch(`${apiBase}/perucompras/categorias?${params.toString()}`);
        if (!r.ok) throw new Error();
        const data = await r.json();
        setCategoriasDisponibles(data.categorias || []);
      } catch {
        setCategoriasDisponibles([]);
      } finally {
        setCargandoCategorias(false);
      }
    };
    cargar();
  }, [filtros.catalogoElectronico, uidActivo, yaHayActivo, apiBase]);

  const buscarProformas = async () => {
    if (!yaHayActivo || extraccionCorriendo) return;
    setCargandoProformas(true);
    setErrorProformas("");
    setBuscoAlMenosUnaVez(true);
    try {
      const params = new URLSearchParams({
        uid: uidActivo,
        acuerdoMarco: filtros.acuerdoMarco,
        catalogo: filtros.catalogoElectronico,
        categoria: filtros.categoria,
        palabraClave: filtros.palabraClave,
        estado: filtros.estado,
        procedimiento: filtros.procedimiento,
        tipoContratacion: filtros.tipoContratacion,
        estrategiaCompra: filtros.estrategiaCompra,
        fechaInicial: filtros.fechaInicial,
        fechaFinal: filtros.fechaFinal,
      });
      const r = await fetch(`${apiBase}/perucompras/proformas?${params.toString()}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || `Error HTTP ${r.status}`);
      }
        const data: Proforma[] = await r.json();
      setProformas(data);
      setPaginaActual(1);
      setFiltroEstadoActivo(null);
    } catch (e) {
      setErrorProformas(e instanceof Error ? e.message : "No se pudo buscar proformas");
      setProformas([]);
    } finally {
      setCargandoProformas(false);
    }
  };

    const totalCotizadoGeneral = useMemo(
    () => proformas.reduce((acc, p) => acc + (Number(p.totalCotizado) || 0), 0),
    [proformas]
  );

const kpis = useMemo(() => {
    const cotizadas = proformas.filter((p) => p.estado.toUpperCase() === "COTIZADA").length;
    const pendientes = proformas.filter((p) => p.estado.toUpperCase() === "PENDIENTE").length;
    const restringidas = proformas.filter((p) => p.estado.toUpperCase() === "RESTRINGIDA").length;
    const desiertas = proformas.filter((p) => p.estado.toUpperCase() === "DESIERTA").length;
    const rojas = proformas.filter((p) => p.indicador === "rojo").length;
    return { total: proformas.length, cotizadas, pendientes, restringidas, desiertas, rojas };
  }, [proformas]);

const proformasFiltradas = useMemo(() => {
    if (!filtroEstadoActivo) return proformas;
    return proformas.filter((p) => p.estado.toUpperCase() === filtroEstadoActivo);
  }, [proformas, filtroEstadoActivo]);

  const totalPaginas = Math.max(1, Math.ceil(proformasFiltradas.length / filasPorPagina));

  const proformasPaginadas = useMemo(() => {
    const inicio = (paginaActual - 1) * filasPorPagina;
    return proformasFiltradas.slice(inicio, inicio + filasPorPagina);
  }, [proformasFiltradas, paginaActual, filasPorPagina]);

  const toggleFiltroEstado = (estado: string) => {
    setFiltroEstadoActivo((actual) => (actual === estado ? null : estado));
    setPaginaActual(1);
  };

  const cambiarFilasPorPagina = (valor: number) => {
    setFilasPorPagina(valor);
    setPaginaActual(1);
  };

  const irAPagina = (n: number) => setPaginaActual(Math.min(Math.max(1, n), totalPaginas));

  // ============================================================
  // PANTALLA 1 — Login gate
  // ============================================================
  if (!yaHayActivo) {
    return (
      <div className="max-w-3xl mx-auto py-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm">
            <Briefcase size={20} />
          </div>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)" }} className="text-xl font-bold text-slate-900">
              Equipo Ventas · Operaciones
            </h1>
            <p className="text-sm text-slate-500">Inicia sesión en Peru Compras para continuar</p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
          <div>
            <p className="text-sm font-semibold text-slate-700 mb-3">Usuarios ya configurados</p>
            {cargandoUsuarios ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 size={14} className="animate-spin" /> Cargando usuarios...
              </div>
            ) : usuariosDisponibles.length === 0 ? (
              <p className="text-xs text-slate-400">No hay usuarios preconfigurados todavía.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {usuariosDisponibles.map((u) => {
                  const activo = sesion?.perucompras[u.uid]?.autenticado;
                  return (
                    <button
                      key={u.uid}
                      type="button"
                      onClick={() => (activo ? setUidActivo(u.uid) : loginConUsuarioPredefinido(u.uid))}
                      disabled={cargandoLogin === u.uid}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left transition-colors ${
                        activo
                          ? "border-emerald-200 bg-emerald-50 hover:bg-emerald-100"
                          : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40"
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <span
                          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                            activo ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          <User size={14} />
                        </span>
                        <span>
                          <span className="block text-sm font-semibold text-slate-800">{u.label}</span>
                          <span className="block text-[11px] text-slate-400">
                            {activo ? "Sesión activa — entrar" : "Iniciar sesión"}
                          </span>
                        </span>
                      </span>
                      {cargandoLogin === u.uid ? (
                        <Loader2 size={15} className="animate-spin text-slate-400 shrink-0" />
                      ) : (
                        <ChevronRight size={15} className="text-slate-300 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setMostrarLoginManual((v) => !v)}
              className="text-xs font-semibold text-[#4F46E5] hover:underline"
            >
              {mostrarLoginManual ? "Ocultar" : "¿Otro usuario? Iniciar sesión manualmente"}
            </button>

            {mostrarLoginManual && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Usuario</label>
                    <div className="relative">
                      <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        value={manualUsuario}
                        onChange={(e) => setManualUsuario(e.target.value)}
                        placeholder="ej. susel.casimiro02"
                        className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Contraseña</label>
                    <div className="relative">
                      <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="password"
                        value={manualPassword}
                        onChange={(e) => setManualPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                      />
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={loginManual}
                  disabled={cargandoLogin === "__manual__"}
                  className="flex items-center gap-2 bg-[#10172A] text-white text-sm font-semibold rounded-lg px-4 py-2.5 hover:bg-[#1B2438] disabled:opacity-40 transition-colors"
                >
                  {cargandoLogin === "__manual__" ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <LogIn size={15} />
                  )}
                  Iniciar sesión
                </button>
              </div>
            )}
          </div>

          {mensajeEsperaLogin && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600">
              <Loader2 size={13} className="animate-spin" /> {mensajeEsperaLogin}
            </p>
          )}

          {errorLogin && (
            <p className="flex items-center gap-1.5 text-xs text-red-600">
              <AlertTriangle size={13} /> {errorLogin}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ============================================================
  // PANTALLA 2 — Interfaz moderna de Proformas
  // ============================================================
  return (
    <div>
      <div className="flex items-start sm:items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0">
            <Briefcase size={20} />
          </div>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)" }} className="text-xl font-bold text-slate-900">
              Equipo Ventas · Operaciones
            </h1>
            <p className="text-sm text-slate-500">
              Sesión activa: <span className="font-semibold text-slate-700">{sesion?.perucompras[uidActivo]?.label}</span>
            </p>
          </div>
        </div>
      <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={cerrarSesionPeru}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-red-600 border border-slate-200 hover:border-red-200 rounded-lg px-3 py-2 transition-colors"
          >
            <LogOut size={13} /> Cambiar de usuario
          </button>
          <button
            type="button"
            onClick={cerrarSesionRealPeru}
            disabled={cerrandoSesionReal}
            title="Cierra la sesión de verdad en Peru Compras y cierra la ventana del navegador"
            className="flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-white border border-red-200 hover:bg-red-600 hover:border-red-600 rounded-lg px-3 py-2 transition-colors disabled:opacity-40"
          >
            {cerrandoSesionReal ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <LogOut size={13} />
            )}
            Cerrar sesión
          </button>
        </div>

      </div>

      <div className="mt-6">
        <PerucomprasPanel apiBase={apiBase} uid={uidActivo} onExtraccionEstadoChange={setExtraccionCorriendo} />
      </div>

    {filtrosVisibles ? (
      <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-slate-800">Filtro de proformas</p>
          <button
            type="button"
            onClick={() => setFiltrosVisibles(false)}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            Ocultar filtros <ChevronRight size={13} className="rotate-90" />
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Campo label="Acuerdo Marco">
            <select
              value={filtros.acuerdoMarco}
              onChange={(e) => actualizarFiltro("acuerdoMarco", e.target.value)}
              disabled={cargandoAcuerdos || acuerdosDisponibles.length === 0}
              className={inputCls}
            >
              <option value="">
                {cargandoAcuerdos ? "Cargando acuerdos..." : "Seleccione Acuerdo Marco"}
              </option>
              {acuerdosDisponibles.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.codigo} — {a.nombre}
                </option>
              ))}
            </select>
          </Campo>
            <Campo label="Catálogo Electrónico">
            <select
              value={filtros.catalogoElectronico}
              onChange={(e) => actualizarFiltro("catalogoElectronico", e.target.value)}
              disabled={cargandoCatalogos || catalogosDisponibles.length === 0}
              className={inputCls}
            >
              <option value="">
                {cargandoCatalogos
                  ? "Cargando catálogos..."
                  : !filtros.acuerdoMarco
                  ? "Elige un Acuerdo Marco primero"
                  : "Seleccione catálogo"}
              </option>
              {catalogosDisponibles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Campo>
            <Campo label="Categoría">
            <select
              value={filtros.categoria}
              onChange={(e) => actualizarFiltro("categoria", e.target.value)}
              disabled={cargandoCategorias || categoriasDisponibles.length === 0}
              className={inputCls}
            >
                <option value="">
                {cargandoCategorias
                  ? "Cargando categorías..."
                  : !filtros.catalogoElectronico
                  ? "Elige un Catálogo primero"
                  : categoriasDisponibles.length === 0
                  ? "Sin categorías para este catálogo"
                  : "Seleccione categoría"}
              </option>
              {categoriasDisponibles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Palabra clave">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={filtros.palabraClave}
                onChange={(e) => actualizarFiltro("palabraClave", e.target.value)}
                className={inputCls + " pl-8"}
              />
            </div>
          </Campo>
          <Campo label="Estado">
            <select value={filtros.estado} onChange={(e) => actualizarFiltro("estado", e.target.value)} className={inputCls}>
              <option value="">Seleccione estado</option>
              <option value="PENDIENTE">Pendiente</option>
              <option value="RESTRINGIDA">Restringida</option>
              <option value="COTIZADA">Cotizada</option>
            </select>
          </Campo>
          <Campo label="Procedimiento">
            <input
              value={filtros.procedimiento}
              onChange={(e) => actualizarFiltro("procedimiento", e.target.value)}
              className={inputCls}
            />
          </Campo>
          <Campo label="Tipo de contratación">
            <input
              value={filtros.tipoContratacion}
              onChange={(e) => actualizarFiltro("tipoContratacion", e.target.value)}
              className={inputCls}
            />
          </Campo>
          <Campo label="Estrategia de compra">
            <input
              value={filtros.estrategiaCompra}
              onChange={(e) => actualizarFiltro("estrategiaCompra", e.target.value)}
              className={inputCls}
            />
          </Campo>
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Fecha inicial">
              <input
                type="date"
                value={filtros.fechaInicial}
                onChange={(e) => actualizarFiltro("fechaInicial", e.target.value)}
                className={inputCls}
              />
            </Campo>
            <Campo label="Fecha final">
              <input
                type="date"
                value={filtros.fechaFinal}
                onChange={(e) => actualizarFiltro("fechaFinal", e.target.value)}
                className={inputCls}
              />
            </Campo>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-slate-100">
          <button
            type="button"
            onClick={() => setFiltros(filtrosVacios())}
            className="text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            Limpiar filtros
          </button>
          <button
            type="button"
            onClick={buscarProformas}
            disabled={cargandoProformas || extraccionCorriendo}
            title={extraccionCorriendo ? "Espera a que termine la extracción de catálogos" : undefined}
            className="flex items-center gap-2 bg-[#4F46E5] hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg px-5 py-2.5 disabled:opacity-40 transition-colors"
          >
            {cargandoProformas ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            Iniciar búsqueda
          </button>
          {extraccionCorriendo && (
            <p className="text-xs text-amber-600 mt-2">
              ⏸La extracción de catálogos está en curso — espera a que termine para buscar proformas manualmente.
            </p>
          )}
        </div>
      </div>
      ) : (
        <div className="flex justify-end mb-6">
          <button
            type="button"
            onClick={() => setFiltrosVisibles(true)}
            className="flex items-center gap-1.5 bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 text-xs font-semibold text-slate-600 hover:text-indigo-700 rounded-lg px-3.5 py-2 shadow-sm transition-colors"
          >
            <Search size={13} /> Mostrar filtros <ChevronRight size={13} />
          </button>
        </div>
      )}

        {buscoAlMenosUnaVez && proformas.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
          <button
            type="button"
            onClick={() => setFiltroEstadoActivo(null)}
            className={`text-left bg-white border rounded-2xl px-4 py-3.5 transition-all ${
              !filtroEstadoActivo
                ? "border-slate-400 ring-2 ring-slate-300"
                : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Total resultados</p>
            <p style={{ fontFamily: "var(--font-display)" }} className="text-2xl font-bold text-slate-900 mt-1">
              {kpis.total}
            </p>
          </button>

          <button
            type="button"
            onClick={() => toggleFiltroEstado("COTIZADA")}
            className={`text-left bg-white border rounded-2xl px-4 py-3.5 border-l-4 border-l-emerald-400 transition-all ${
              filtroEstadoActivo === "COTIZADA"
                ? "border-emerald-400 ring-2 ring-emerald-200"
                : "border-slate-200 hover:border-emerald-200"
            }`}
          >
            <p className="text-[11px] font-medium text-emerald-600 uppercase tracking-wide">Cotizadas</p>
            <p style={{ fontFamily: "var(--font-display)" }} className="text-2xl font-bold text-emerald-700 mt-1">
              {kpis.cotizadas}
            </p>
          </button>

          <button
            type="button"
            onClick={() => toggleFiltroEstado("PENDIENTE")}
            className={`text-left bg-white border rounded-2xl px-4 py-3.5 border-l-4 border-l-amber-400 transition-all ${
              filtroEstadoActivo === "PENDIENTE"
                ? "border-amber-400 ring-2 ring-amber-200"
                : "border-slate-200 hover:border-amber-200"
            }`}
          >
            <p className="text-[11px] font-medium text-amber-600 uppercase tracking-wide">Pendientes</p>
            <p style={{ fontFamily: "var(--font-display)" }} className="text-2xl font-bold text-amber-700 mt-1">
              {kpis.pendientes}
            </p>
          </button>

          <button
            type="button"
            onClick={() => toggleFiltroEstado("RESTRINGIDA")}
            className={`text-left bg-white border rounded-2xl px-4 py-3.5 border-l-4 border-l-red-400 transition-all ${
              filtroEstadoActivo === "RESTRINGIDA"
                ? "border-red-400 ring-2 ring-red-200"
                : "border-slate-200 hover:border-red-200"
            }`}
          >
            <p className="text-[11px] font-medium text-red-600 uppercase tracking-wide">Restringidas</p>
            <p style={{ fontFamily: "var(--font-display)" }} className="text-2xl font-bold text-red-700 mt-1">
              {kpis.restringidas}
            </p>
          </button>

          <button
            type="button"
            onClick={() => toggleFiltroEstado("DESIERTA")}
            className={`text-left bg-white border rounded-2xl px-4 py-3.5 border-l-4 border-l-slate-400 transition-all ${
              filtroEstadoActivo === "DESIERTA"
                ? "border-slate-400 ring-2 ring-slate-300"
                : "border-slate-200 hover:border-slate-300"
            }`}
          >
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Desiertas</p>
            <p style={{ fontFamily: "var(--font-display)" }} className="text-2xl font-bold text-slate-700 mt-1">
              {kpis.desiertas}
            </p>
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-wrap gap-2">
            <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <FileSpreadsheet size={15} className="text-[#4F46E5]" />
            Lista de proformas
            {filtroEstadoActivo && (
              <span className="flex items-center gap-1 text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full pl-2 pr-1 py-0.5">
                {filtroEstadoActivo}
                <button
                  type="button"
                  onClick={() => setFiltroEstadoActivo(null)}
                  className="hover:bg-indigo-100 rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none"
                >
                  ×
                </button>
              </span>
            )}
          </p>
          <div className="flex items-center gap-3">
            {proformas.length > 0 && (
              <span className="text-xs text-slate-500">
                {proformas.length} resultado{proformas.length !== 1 ? "s" : ""} · Total S/{" "}
                {totalCotizadoGeneral.toLocaleString("es-PE", { minimumFractionDigits: 2 })}
              </span>
            )}
            <button
              type="button"
              onClick={buscarProformas}
              disabled={cargandoProformas}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 disabled:opacity-40"
            >
              <RefreshCw size={12} className={cargandoProformas ? "animate-spin" : ""} /> Refrescar
            </button>
          </div>
        </div>

        {errorProformas && (
          <div className="flex items-start gap-2.5 bg-red-50 border-b border-red-100 text-red-700 text-xs px-5 py-3">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <span>{errorProformas}</span>
          </div>
        )}

        {!buscoAlMenosUnaVez ? (
          <div className="py-14 text-center text-sm text-slate-400">
            Ajusta los filtros y da clic en &quot;Iniciar búsqueda&quot;.
          </div>
        ) : cargandoProformas ? (
          <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> Buscando proformas...
          </div>
        ) : proformas.length === 0 ? (
          <div className="py-14 text-center text-sm text-slate-400">Sin resultados para estos filtros.</div>
        ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 p-5">
            {proformasPaginadas.map((p, i) => (
            <div
                key={`${p.proforma}-${i}`}
                className={`border rounded-xl overflow-hidden hover:shadow-sm transition-all flex flex-col ${
                  cardEstadoClasses(p.estado).card
                }`}
              >
                {/* Header: requerimiento + indicador */}
                <div
                  className={`flex items-center justify-between gap-2 px-4 py-3 border-b ${
                    cardEstadoClasses(p.estado).header
                  }`}
                >
                  <div className="min-w-0">
                    <p style={{ fontFamily: "var(--font-mono)" }} className="text-sm font-bold text-slate-900 truncate">
                      {p.requerimiento}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">{p.procedimiento}</p>
                  </div>
                  <span
                    className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeIndicador(
                      p.indicador
                    )}`}
                  >
                    {p.indicador}
                  </span>
                </div>

                {/* Body */}
                <div className="px-4 py-3 flex-1 space-y-2.5">
                  <div>
                    <p className="text-[11px] text-slate-400">Entidad</p>
                    <p className="text-xs font-medium text-slate-700 line-clamp-2" title={p.entidad}>
                      {p.entidad}
                    </p>
                    <p style={{ fontFamily: "var(--font-mono)" }} className="text-[11px] text-slate-400 mt-0.5">
                      RUC {p.ruc}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-2 pt-1">
                    <div>
                      <p className="text-[11px] text-slate-400">Estrategia</p>
                      <p className="text-xs text-slate-600 truncate" title={p.estrategiaCompra}>
                        {p.estrategiaCompra || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400">Financiamiento</p>
                      <p className="text-xs text-slate-600 truncate" title={p.contratacionConFinanciamiento}>
                        {p.contratacionConFinanciamiento || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400">Proforma</p>
                      <p style={{ fontFamily: "var(--font-mono)" }} className="text-xs text-slate-700">
                        {p.proforma}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400">Ficha tipo</p>
                      <p className="text-xs text-slate-600">{p.fichaTipo || "—"}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400">F. emisión</p>
                      <p style={{ fontFamily: "var(--font-mono)" }} className="text-xs text-slate-600">
                        {p.fechaEmision}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400">F. límite</p>
                      <p style={{ fontFamily: "var(--font-mono)" }} className="text-xs text-slate-600">
                        {p.fechaLimiteCotizacion}
                      </p>
                    </div>
                  </div>

                  {p.observaciones && (
                    <div className="pt-1">
                      <p className="text-[11px] text-slate-400">Observaciones</p>
                      <p className="text-xs text-slate-500 line-clamp-2" title={p.observaciones}>
                        {p.observaciones}
                      </p>
                    </div>
                  )}
                </div>

                {/* Footer: estado + total + acción */}
                <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 bg-white/70">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${badgeEstadoProforma(
                        p.estado
                      )}`}
                    >
                      {p.estado}
                    </span>
                    <span
                      style={{ fontFamily: "var(--font-mono)" }}
                      className="text-sm font-bold text-slate-900 truncate"
                    >
                      S/ {Number(p.totalCotizado || 0).toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  {p.puedeCotizar ? (
                    <button
                      type="button"
                      onClick={() => abrirCotizar(p)}
                      className="shrink-0 flex items-center gap-1 bg-[#10172A] text-white text-[11px] font-semibold rounded-lg px-3 py-1.5 hover:bg-[#1B2438] transition-colors"
                    >
                      Cotizar
                    </button>
                  ) : (
                    <span className="shrink-0 text-[11px] font-semibold text-slate-400 border border-slate-200 rounded-lg px-3 py-1.5">
                      No Cotizar
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {proformas.length > 0 && (
          <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-3.5 border-t border-slate-100 bg-slate-50/60">
            <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>
                Mostrando{" "}
                <span className="font-semibold text-slate-700">
                  {(paginaActual - 1) * filasPorPagina + 1}–
                  {Math.min(paginaActual * filasPorPagina, proformasFiltradas.length)}
                </span>{" "}
                de <span className="font-semibold text-slate-700">{proformasFiltradas.length}</span>
              </span>
              <select
                value={filasPorPagina}
                onChange={(e) => cambiarFilasPorPagina(Number(e.target.value))}
                className="ml-2 border border-slate-200 rounded-md text-xs px-2 py-1 text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                <option value={10}>10 / página</option>
                <option value={20}>20 / página</option>
                <option value={50}>50 / página</option>
                <option value={100}>100 / página</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => irAPagina(paginaActual - 1)}
                disabled={paginaActual === 1}
                className="flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 text-slate-500 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronLeft size={14} />
              </button>

              {Array.from({ length: totalPaginas }, (_, i) => i + 1)
                .filter(
                  (n) =>
                    n === 1 ||
                    n === totalPaginas ||
                    Math.abs(n - paginaActual) <= 1
                )
                .reduce<number[]>((acc, n) => {
                  if (acc.length && n - acc[acc.length - 1] > 1) acc.push(-1);
                  acc.push(n);
                  return acc;
                }, [])
                .map((n, idx) =>
                  n === -1 ? (
                    <span key={`gap-${idx}`} className="w-7 text-center text-xs text-slate-300">
                      …
                    </span>
                  ) : (
                    <button
                      key={n}
                      type="button"
                      onClick={() => irAPagina(n)}
                      className={`w-7 h-7 rounded-md text-xs font-medium transition-colors ${
                        n === paginaActual
                          ? "bg-[#4F46E5] text-white"
                          : "text-slate-600 hover:bg-white border border-transparent hover:border-slate-200"
                      }`}
                    >
                      {n}
                    </button>
                  )
                )}

              <button
                type="button"
                onClick={() => irAPagina(paginaActual + 1)}
                disabled={paginaActual === totalPaginas}
                className="flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 text-slate-500 hover:bg-white disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {modalCotizarAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
        <div
            className={`bg-white rounded-2xl shadow-2xl w-full ${
              pdfViewerUrl ? "max-w-[1400px]" : "max-w-6xl"
            } max-h-[92vh] overflow-hidden flex flex-col transition-[max-width] duration-150`}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
                  <FileSpreadsheet size={16} />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">{proformaSeleccionada?.requerimiento}</p>
                  <p className="text-xs text-slate-500">Cotizar proforma {proformaSeleccionada?.proforma}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={cerrarModalCotizar}
                className="text-slate-400 hover:text-slate-700 text-xl leading-none px-2"
              >
                ×
              </button>
            </div>

            <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {cargandoCotizar ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
                  <Loader2 size={18} className="animate-spin" /> Cargando datos de cotización...
                </div>
              ) : errorCotizar ? (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 text-xs px-4 py-3 rounded-lg">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {errorCotizar}
                </div>
              ) : cotizacionDetalle ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs">
                    <div>
                      <p className="text-slate-400">Entidad</p>
                      <p className="font-semibold text-slate-800">
                        {cotizacionDetalle.entidadRuc} — {cotizacionDetalle.entidadNombre}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Compra</p>
                      <p className="font-semibold text-slate-800">{cotizacionDetalle.tipoCompra}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Tipo de cambio</p>
                      <p className="font-semibold text-slate-800">{cotizacionDetalle.tipoCambio}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Total (PEN)</p>
                      <p className="font-semibold text-slate-800">
                        {cotizacionDetalle.totalPEN.toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">Estado</p>
                      <p className="font-semibold text-slate-800">{cotizacionDetalle.estado}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                      Seleccionar Fichas-Productos
                    </p>
                    <div className="border border-slate-200 rounded-xl overflow-x-auto">
                      <table className="w-full text-xs min-w-[900px]">
                        <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Producto</th>
                            <th className="px-3 py-2 text-left font-medium">Ficha-Producto</th>
                            <th className="px-3 py-2 text-left font-medium">Ficha-Técnica</th>
                            <th className="px-3 py-2 text-left font-medium">Condiciones</th>
                            <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                            <th className="px-3 py-2 text-left font-medium">Proforma</th>
                            <th className="px-3 py-2 text-left font-medium">Moneda</th>
                            <th className="px-3 py-2 text-right font-medium">P. unit. base</th>
                            <th className="px-3 py-2 text-right font-medium">P. unit. ofertado</th>
                            <th className="px-3 py-2 text-right font-medium">P. unit. ofertado PEN</th>
                          </tr>
                        </thead>
                        <tbody>
                          {cotizacionDetalle.fichas.map((f, i) => (
                            <tr key={i} className="border-t border-slate-100">
                              <td className="px-3 py-2 max-w-[220px]">{f.producto}</td>
                              <td className="px-3 py-2 max-w-[280px]">
                                <span className="line-clamp-2 text-slate-600" title={f.fichaProducto}>
                                  {f.fichaProducto}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                {f.fichaTecnicaUrl ? (
                                  <button
                                    type="button"
                                    onClick={() => setPdfViewerUrl(f.fichaTecnicaUrl)}
                                    className="text-red-600 hover:text-red-700"
                                    title="Ver ficha técnica"
                                  >
                                    <FileText size={18} />
                                  </button>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                    f.condicionesAdicionales
                                      ? "bg-amber-50 text-amber-700 border-amber-200"
                                      : "bg-slate-100 text-slate-500 border-slate-200"
                                  }`}
                                >
                                  {f.condicionesAdicionales ? "SI" : "NO"}
                                </span>
                              </td>
                              <td className="px-3 py-2 text-right">{f.cantidad}</td>
                              <td className="px-3 py-2">{f.proforma}</td>
                              <td className="px-3 py-2">{f.monedaBase}</td>
                              <td className="px-3 py-2 text-right">{f.precioUnitarioBase.toFixed(2)}</td>
                              <td className="px-3 py-2 text-right">
                                <input
                                  type="number"
                                  value={f.precioUnitarioOfertado}
                                  onChange={(e) => actualizarPrecioFicha(i, Number(e.target.value))}
                                  className="w-24 border border-slate-300 rounded px-2 py-1 text-right text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                                />
                              </td>
                              <td className="px-3 py-2 text-right font-semibold">
                                {f.precioUnitarioOfertadoPEN.toFixed(2)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Cotizar entregas</p>
                    <div className="space-y-4">
                      {cotizacionDetalle.entregas.map((e, ei) => (
                        <div key={ei} className="border border-slate-200 rounded-xl overflow-hidden">
                          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 bg-slate-50 px-4 py-3 text-xs items-end">
                            <div>
                              <p className="text-slate-400">Nro</p>
                              <p className="font-semibold text-slate-800">{e.nro}</p>
                            </div>
                            <div className="col-span-2">
                              <p className="text-slate-400">Dirección</p>
                              <p className="font-semibold text-slate-800">{e.direccion}</p>
                            </div>
                            <div>
                              <p className="text-slate-400">Inicio</p>
                              <p className="font-semibold text-slate-800">{e.inicioEntrega}</p>
                            </div>
                            <div>
                              <p className="text-slate-400 mb-1">Plazo máximo</p>
                              <input
                                type="number"
                                value={e.plazoMaximo}
                                onChange={(ev) => actualizarEntrega(ei, "plazoMaximo", Number(ev.target.value))}
                                className="w-16 border border-slate-300 rounded px-2 py-1 text-xs"
                              />
                            </div>
                            <div>
                              <p className="text-slate-400">Fin de entrega</p>
                              <p className="font-semibold text-slate-800">{e.finEntrega}</p>
                            </div>
                            <div>
                              <p className="text-slate-400">Sub Total</p>
                              <p className="font-bold text-slate-900">{e.subTotal.toFixed(2)}</p>
                            </div>
                          </div>
                          <table className="w-full text-xs min-w-[700px]">
                            <thead className="bg-white text-[10px] uppercase text-slate-400 border-t border-slate-100">
                              <tr>
                                <th className="px-3 py-2 text-left font-medium">Producto</th>
                                <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                                <th className="px-3 py-2 text-right font-medium">P. unitario</th>
                                <th className="px-3 py-2 text-right font-medium">Costo envío</th>
                                <th className="px-3 py-2 text-right font-medium">P. unit. total</th>
                                <th className="px-3 py-2 text-right font-medium">IGV</th>
                                <th className="px-3 py-2 text-right font-medium">Sub Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {e.productos.map((pr, pi) => (
                                <tr key={pi} className="border-t border-slate-100">
                                  <td className="px-3 py-2 max-w-[220px]">{pr.producto}</td>
                                  <td className="px-3 py-2 text-right">{pr.cantidad}</td>
                                  <td className="px-3 py-2 text-right">{pr.precioUnitario.toFixed(2)}</td>
                                  <td className="px-3 py-2 text-right">
                                    <input
                                      type="number"
                                      value={pr.costoUnitarioEnvio}
                                      onChange={(ev) => actualizarCostoEnvioProducto(ei, pi, Number(ev.target.value))}
                                      className="w-20 border border-slate-300 rounded px-2 py-1 text-right text-xs"
                                    />
                                  </td>
                                  <td className="px-3 py-2 text-right">{pr.precioUnitarioTotal.toFixed(2)}</td>
                                  <td className="px-3 py-2 text-right">{pr.igv.toFixed(2)}</td>
                                  <td className="px-3 py-2 text-right font-semibold">{pr.subTotal.toFixed(2)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  </div>

                  <details className="text-[11px] text-slate-400">
                    <summary className="cursor-pointer select-none">Ver respuesta cruda de cargarCotizar</summary>
                    <pre className="mt-2 bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto">
                      {JSON.stringify(cotizacionDetalle.raw, null, 2)}
                    </pre>
                  </details>
                </>
            ) : null}
            </div>

            {pdfViewerUrl && (
              <div className="w-[440px] border-l border-slate-200 bg-slate-50 flex flex-col shrink-0">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
                  <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <FileText size={14} className="text-red-600" /> Ficha técnica
                  </p>
                  <button
                    type="button"
                    onClick={() => setPdfViewerUrl(null)}
                    className="text-slate-400 hover:text-slate-700 text-lg leading-none px-1"
                  >
                    ×
                  </button>
                </div>
                <iframe src={pdfViewerUrl} title="Ficha técnica PDF" className="flex-1 w-full" />
              </div>
            )}
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50">
              <button
                type="button"
                onClick={cerrarModalCotizar}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 px-3 py-2"
              >
                Cerrar
              </button>
              <button
                type="button"
                className="text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded-lg px-4 py-2.5 transition-colors"
              >
                No Cotizar
              </button>
              <button
                type="button"
                className="bg-[#4F46E5] hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg px-5 py-2.5 transition-colors"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}