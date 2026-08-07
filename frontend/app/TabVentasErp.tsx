"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Loader2,
  RefreshCw,
  DollarSign,
  AlertTriangle,
  Search,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  LucideIcon,
  FileText,
  FileCheck2,
  ExternalLink,
  Building2,
  MapPin,
  CalendarDays,
  X,
  SlidersHorizontal,
  ShieldCheck,
  Lock,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_HELBOT_API || "http://localhost:4001";

// ============================================================
// Tipos — shape real que devuelve el ERP (visto en el JSON de
// ejemplo). Se dejan opcionales + índice libre por seguridad,
// pero ya mapeados a los campos reales (montoVenta, estadoVenta,
// empresa.razonSocial, cliente.razonSocial, etc.)
// ============================================================
interface EmpresaRef {
  id?: number;
  ruc?: string;
  razonSocial?: string;
}

interface ClienteRef {
  id?: number;
  ruc?: string;
  razonSocial?: string;
  codigoUnidadEjecutora?: string;
  departamento?: string;
  sede?: string;
}

interface ContactoRef {
  id?: number;
  nombre?: string;
  cargo?: string;
}

interface CatalogoRef {
  id?: number;
  nombre?: string;
  descripcion?: string;
}

export interface VentaErp {
  id?: number | string;
  codigoVenta?: string;
  numeroOcam?: string;
  codigoOcf?: string;
  fechaEmision?: string;
  fechaEntrega?: string;
  fechaMaxForm?: string;
  createdAt?: string;
  updatedAt?: string;
  montoVenta?: number | string;
  netoCobrado?: number | string | null;
  estadoVenta?: string;
  estadoFacturacion?: string;
  estadoCobranza?: string | null;
  etapaActual?: string;
  provinciaEntrega?: string;
  distritoEntrega?: string;
  departamentoEntrega?: string;
  direccionEntrega?: string;
  referenciaEntrega?: string;
  siaf?: string;
  etapaSiaf?: string;
  documentoOce?: string | null;
  documentoOcf?: string | null;
  documentoPeruCompras?: string | null;
  empresa?: EmpresaRef;
  cliente?: ClienteRef;
  contactoCliente?: ContactoRef;
  catalogoEmpresa?: CatalogoRef;
  nOps?: number;
  nOpsEntregadas?: number;
  ventaPrivada?: boolean;

    productos?: {
    codigo?: string;
    marca?: string;
    descripcion?: string;
    cantidad?: number;
    isCompleted?: boolean;
    [key: string]: unknown;
  }[];
  [key: string]: unknown;

}

export interface OpSeguimiento {
  estado: "pendiente" | "preview" | "subido";
  rellenado_por?: string | null;
  subido_por?: string | null;
}

export interface OpResumen {
  id: number;
  codigoOp: string;
  estadoOp: string;
  totalProveedor: number;
  proveedor?: { razonSocial?: string };
  _seguimiento?: OpSeguimiento;
  [key: string]: unknown;
}

export interface DetalleSeguimientoProducto {
  orden_compra_id: number;
  producto_codigo: string;
  estado: "pendiente" | "preview" | "confirmado" | "subido";
  rellenado_por?: string | null;
  confirmado_por?: string | null;
  subido_por?: string | null;
  campos_faltantes?: string[];
}

export interface RespuestaVentasErp {
  ventas: VentaErp[];
  total: number;
  paginas: number;
  actualizado: string;
}

// ---- helpers para leer campos del shape real ----
// Exportados: HelbotPage.tsx los reutiliza para el panel dividido del tab
// "Monitor" y para el comparador Publicadas <-> Ventas ERP, así el código
// de venta se calcula EXACTAMENTE igual en los dos lugares.
export const codigoVentaDe = (v: VentaErp) =>
  String(v.codigoVenta || v.numeroOcam || `Venta #${v.id ?? "?"}`);
// alias por compatibilidad con el resto de este archivo
const titulo = codigoVentaDe;

// Específico para el comparador Publicadas <-> ERP: Peru Compras SIEMPRE
// identifica una orden por su código OCAM (ej. "OCAM-2026-500133-48-0"),
// así que la comparación debe hacerse contra `numeroOcam`, NUNCA contra
// `codigoVenta` (que es un código interno tipo "OCGRU944" y jamás va a
// calzar con el de Peru Compras).
export const ocamDe = (v: VentaErp) => String(v.numeroOcam || "");

export const empresaNombre = (v: VentaErp) => v.empresa?.razonSocial || "—";
export const clienteNombre = (v: VentaErp) => v.cliente?.razonSocial || "—";
export const estadoDe = (v: VentaErp) => v.estadoVenta || "—";
const etapaDe = (v: VentaErp) => v.etapaActual || "—";
const departamentoDe = (v: VentaErp) =>
  v.departamentoEntrega || v.cliente?.departamento || "—";

const fechaDe = (v: VentaErp) => v.fechaEmision || v.createdAt || "";
export const formatearFecha = (raw?: string) => {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
};

// Cuenta regresiva hasta fechaMaxForm — texto tipo "2d 5h" / "45m" /
// "Vencido". El componente de abajo se recalcula solo cada 30s, así
// que el número baja en vivo sin que nadie recargue la página.
function formatearTiempoRestante(ms: number): string {
  const totalSegundos = Math.floor(Math.abs(ms) / 1000);
  const dias = Math.floor(totalSegundos / 86400);
  const horas = Math.floor((totalSegundos % 86400) / 3600);
  const minutos = Math.floor((totalSegundos % 3600) / 60);
  if (dias > 0) return `${dias}d ${horas}h ${minutos}m`;
  if (horas > 0) return `${horas}h ${minutos}m`;
  return `${minutos}m`;
}
function ContadorVencimiento({ fechaMaxForm }: { fechaMaxForm?: string }) {
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    if (!fechaMaxForm) return;
    const intervalo = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(intervalo);
  }, [fechaMaxForm]);

  if (!fechaMaxForm) return null;
  const fechaLimite = new Date(fechaMaxForm).getTime();
  if (Number.isNaN(fechaLimite)) return null;

  const diferencia = fechaLimite - ahora;
  const vencido = diferencia <= 0;
  const porVencer = !vencido && diferencia < 24 * 60 * 60 * 1000; // menos de 24h

  return (
    <span
      title={`Fecha máxima: ${formatearFecha(fechaMaxForm)}`}
      className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${
        vencido
          ? "bg-red-50 text-red-700 border-red-200"
          : porVencer
          ? "bg-amber-50 text-amber-700 border-amber-200"
          : "bg-slate-50 text-slate-500 border-slate-200"
      }`}
    >
      <CalendarDays size={10} />
      {vencido ? "Vencido" : formatearTiempoRestante(diferencia)}
    </span>
  );
}


export const montoDe = (v: VentaErp): number | null => {
  const raw = v.montoVenta ?? v.total;
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  return Number.isFinite(n) ? n : null;
};

export const formatearMonto = (n: number) =>
  `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;


// Códigos de producto que ya aparecen dentro de alguna OP real del ERP
// (v.ordenesProveedor, que ya viene incluido en cada venta). Es la
// fuente de verdad real de "ya está en el ERP" — el campo p.isCompleted
// que manda el ERP no siempre viene actualizado (caso real: OCGRU984
// tenía 4 productos ya dentro de una OP creada, pero isCompleted
// seguía en false para esos 4).
function codigosEnOrdenesProveedorDe(v: VentaErp): Set<string> {
  const set = new Set<string>();
  const ops = (v as any).ordenesProveedor as { productos?: { codigo?: string }[] }[] | undefined;
  if (Array.isArray(ops)) {
    for (const op of ops) {
      for (const pr of op.productos || []) {
        const codigo = String(pr.codigo ?? "").trim();
        if (codigo) set.add(codigo);
      }
    }
  }
  return set;
}

export const progresoProductos = (
  v: VentaErp,
  seguimientosPorOrden?: Record<number, Record<string, string>>
) => {
  const productos = v.productos || [];
  const total = productos.length;
  const mapa = (v.id != null && seguimientosPorOrden?.[Number(v.id)]) || {};
  const codigosEnErp = codigosEnOrdenesProveedorDe(v);

  let pendientes = 0;
  let preview = 0;
  let confirmados = 0;
  let subidos = 0;
  let enErp = 0; // productos que ya estaban registrados directo en el ERP, sin pasar por Helbot

for (const p of productos) {
    const codigo = String(p.codigo ?? p.id ?? "").trim();
    if (p.isCompleted === true || codigosEnErp.has(codigo)) {
      enErp++;
      continue;
    }
    const estado = mapa[codigo] || "pendiente";
    if (estado === "preview") preview++;
    else if (estado === "confirmado") confirmados++;
    else if (estado === "subido") subidos++;
    else pendientes++;
  }

  const completados = preview + confirmados + subidos + enErp; // "avanzó algo"
  const confirmadosOSubidos = confirmados + subidos + enErp; // "ya no se edita"

  return { total, pendientes, preview, confirmados, subidos, enErp, completados, confirmadosOSubidos };
};
// Colores por estado — se ajustan a los valores reales del ERP
// (PENDIENTE, ATENDIDO, ANULADO, etc.) con fallback neutro.
export const estiloEstado = (estado: string) => {
  const e = estado.toUpperCase();
  if (e.includes("PENDIENTE")) return "bg-amber-50 text-amber-700 border-amber-200";
  if (e.includes("ANULA") || e.includes("RECHAZ")) return "bg-red-50 text-red-700 border-red-200";
  if (e.includes("ATENDID") || e.includes("COMPLET") || e.includes("APROB"))
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (e.includes("PROCESO") || e.includes("CURSO")) return "bg-blue-50 text-blue-700 border-blue-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
};

// Catálogo de la venta — nuevo filtro "Catálogo" en Ventas ERP.
export const catalogoNombreDe = (v: VentaErp) => v.catalogoEmpresa?.nombre || "—";



// Descripción corta de un producto — solo lo que va ANTES de los ":",
// que es la parte legible (ej. "ALCOHOL ETÍLICO GEL DE USO NO MEDICINAL"),
// el resto son specs técnicas (color, contenido, garantía) que no aportan
// para identificar de un vistazo qué es el producto.
export const descripcionCortaProducto = (descripcion?: string): string => {
  if (!descripcion) return "";
  const idx = descripcion.indexOf(":");
  return (idx === -1 ? descripcion : descripcion.slice(0, idx)).trim();
};

// Categorías (descripciones cortas) de TODOS los productos de una venta,
// sin repetir — para el filtro "Categoría" y para pintarlas en la card.
export const categoriasDeVenta = (v: VentaErp): string[] => {
  const set = new Set<string>();
  for (const p of v.productos || []) {
    const corta = descripcionCortaProducto(p.descripcion);
    if (corta) set.add(corta);
  }
  return Array.from(set);
};




// ============================================================
// Diccionario de categorías reales <-> categoría "canónica" del negocio,
// y a qué persona (Elías / Eliane / Victor) le corresponde cada una.
// Los textos crudos de productos vienen con muchas variantes (ej. "CEPILLO
// DENTAL PARA ADULTO", "CEPILLO DENTAL INFANTIL"), así que el match es por
// coincidencia de palabra completa contra la clave del diccionario, no por
// igualdad exacta.
// ============================================================
const DICCIONARIO_CATEGORIAS: Record<string, string[]> = {
  ESCOBILLONES: ["ELIAS"],
  LAVAVAJILLAS: ["ELIANE"],
  SUAVIZANTES_DE_ROPA: ["ELIANE"],
  DETERGENTES: ["ELIANE", "ELIAS"],
  REMOVEDORES_DE_SARRO: ["ELIANE"],
  DESINFECTANTES: ["ELIANE"],
  DESENGRASANTES: ["ELIANE"],
  ESPONJAS_Y_FIBRAS: ["ELIAS"],
  SILICONA: ["ELIANE"],
  TINAS_Y_BATEAS: ["ELIAS"],
  TACHOS_BUZONES_Y_RECOLECTORES: ["ELIAS"],
  CERAS: ["ELIANE"],
  TOALLAS: ["ELIAS"],
  ATRAPA_POLVO: ["ELIAS"],
  MOPAS_Y_TRAPEADORES: ["ELIAS"],
  ALCOHOL_ETILICO_GEL: ["ELIANE"],
  CEPILLO_DENTAL: ["ELIAS"],
  LIMPIADORES: ["ELIANE"],
  RECOGEDORES: ["ELIAS"],
  AMBIENTADORES_Y_PASTILLAS: ["ELIANE"],
  JABON_HIGIENE_MANOS: ["ELIAS", "ELIANE"],
  PAPEL_HIGIENICO:["ELIAS", "ELIANE"],
  PAPEL_TOALLA:["ELIAS", "ELIANE"],
  PANOS_Y_BAYETAS: ["ELIAS"],
  PASTA_DENTAL: ["ELIAS"],
  PULVERIZADORES_Y_ATOMIZADORES: ["ELIAS"],
  CARRITOS_PARA_LIMPIEZA: ["ELIAS"],
  JALADORES_DE_AGUA: ["ELIAS"],
  HIPOCLORITO_DE_SODIO: ["ELIANE"],
  BASTONES_Y_MANGOS: ["ELIAS"],
  CEPILLOS_Y_ESCOBILLAS: ["ELIAS"],
  ESCOBAS: ["ELIAS"],


  TUBO: ["VICTOR"],
  TUBOS_INST_ELECTRICAS: ["VICTOR"],
  REDUCCION: ["VICTOR"],
  TEE: ["VICTOR"],
  TUBOS_INST_SANITARIAS: ["VICTOR"],
  CODO: ["VICTOR"],
  PEGAMENTO_TUBERIAS: ["VICTOR"],
  TAPON: ["VICTOR"],
  YEE: ["VICTOR"],
  UNION: ["VICTOR"],
  PINTURA_VIAL: ["VICTOR"],
  PINTURA_ARQUITECTONICA: ["VICTOR"],
  BASE: ["VICTOR"],
  BIDON: ["VICTOR"],
  BALDE: ["VICTOR"],
  VASO: ["VICTOR"],
  PLATO: ["VICTOR"],
  PLANCHA_PANEL_DRYWALL: ["VICTOR"],
  COLCHON: ["VICTOR"],
  CALAMINA_COBERTURA: ["VICTOR"],
  TABLEROS_MADERA: ["VICTOR"],
  CAMA_METAL_2_NIVELES: ["VICTOR"],
  ARROZ_PILADO: ["VICTOR"],
  ACEITE_VEGETAL: ["VICTOR"],
  AZUCAR: ["VICTOR"],
  LENTEJA: ["VICTOR"],
  FRIJOL: ["VICTOR"],

  RASTRILLO_DE_METAL: ["ELIAS"],
  AZADON: ["ELIAS"],
  NAVAJA_DE_INJERTAR: ["ELIAS"],
  LIMA_DE_AFILAR: ["ELIAS"],
  MACHETE_CON_MANGO: ["ELIAS"],
  SERRUCHO_DE_PODA: ["ELIAS"],
  TIJERA_DE_PODAR: ["ELIAS"],
  HACHA: ["ELIAS"],
  HOZ: ["ELIAS"],
};

// Quita tildes, pasa a mayúsculas y colapsa cualquier símbolo raro en
// espacios — así "Cepillo Dental Adulto" y "CEPILLO_DENTAL" se comparan
// en igualdad de condiciones.
// Quita tildes, pasa a mayúsculas y colapsa cualquier símbolo raro en
// espacios — así "Cepillo Dental Adulto" y "CEPILLO_DENTAL" se comparan
// en igualdad de condiciones.
function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

// "CEPILLO_DENTAL" -> "Cepillo Dental" (para mostrar en el <select>).
function etiquetaClave(clave: string): string {
  return clave
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

// Palabras de relleno que se ignoran al construir las "raíces" de cada
// clave — no aportan para identificar la categoría.
const PALABRAS_FILLER = new Set(["DE", "Y", "PARA", "DEL", "LA", "EL", "LOS", "LAS", "CON", "SIN", "A"]);

// Reduce una palabra a su raíz (quita plural simple y recorta a 6
// caracteres), para que "TUBOS" y "TUBO" generen la misma raíz "TUBO", y
// para que abreviaciones como "INST" hagan match por prefijo contra
// "INSTALACIONES" (INSTALACIONES.startsWith("INST") === true).
function raizPalabra(palabra: string): string {
  let base = palabra;
  if (base.length > 4 && base.endsWith("ES")) base = base.slice(0, -2);
  else if (base.length > 3 && base.endsWith("S")) base = base.slice(0, -1);
  return base.length > 6 ? base.slice(0, 6) : base;
}

// Convierte una clave del diccionario (ej. "TUBOS_INST_ELECTRICAS") en
// una lista de raíces requeridas (ej. ["TUBO", "INST", "ELECTR"]).
function raicesDeClave(clave: string): string[] {
  return clave
    .split("_")
    .filter((w) => w && !PALABRAS_FILLER.has(w))
    .map(raizPalabra);
}

// Busca a qué clave del diccionario pertenece un texto crudo de producto.
// A diferencia de una frase exacta pegada, aquí basta con que TODAS las
// raíces de la clave aparezcan en CUALQUIER orden y con cualquier otra
// palabra en medio (ej. "TUBOS PARA INSTALACIONES ELECTRICAS" sí calza
// con la clave TUBOS_INST_ELECTRICAS, aunque tenga "PARA" entre medio y
// diga "INSTALACIONES" completo en vez de "INST").
export function claveDiccionarioDeTexto(textoCrudo: string): string | null {
  const palabrasTexto = normalizarTexto(textoCrudo).split(" ").filter(Boolean);
  if (palabrasTexto.length === 0) return null;

  const claves = Object.keys(DICCIONARIO_CATEGORIAS)
    .map((clave) => ({ clave, raices: raicesDeClave(clave) }))
    .filter((c) => c.raices.length > 0)
    // Prioriza la clave más específica (más raíces, o raíces más largas
    // en total) cuando el texto podría calzar con más de una.
    .sort((a, b) => {
      if (b.raices.length !== a.raices.length) return b.raices.length - a.raices.length;
      const largoA = a.raices.join("").length;
      const largoB = b.raices.join("").length;
      return largoB - largoA;
    });

  for (const { clave, raices } of claves) {
    const calza = raices.every((raiz) => palabrasTexto.some((palabra) => palabra.startsWith(raiz)));
    if (calza) return clave;
  }
  return null;
}

// Claves del diccionario que calzan con AL MENOS un producto de la venta.
export function clavesDiccionarioDeVenta(v: VentaErp): string[] {
  const set = new Set<string>();
  for (const p of v.productos || []) {
    const corta = descripcionCortaProducto(p.descripcion);
    const clave = corta ? claveDiccionarioDeTexto(corta) : null;
    if (clave) set.add(clave);
  }
  return Array.from(set);
}


// Personas (VICTOR/ELIAS/ELIANE) a las que pertenece una venta, según
// las categorías del diccionario que calzaron con sus productos. Una
// venta puede tener varias personas si mezcla productos de categorías
// distintas (ej. un producto de Victor y otro de Elias en la misma OC).
export function personasDeVenta(v: VentaErp): string[] {
  const set = new Set<string>();
  for (const clave of clavesDiccionarioDeVenta(v)) {
    (DICCIONARIO_CATEGORIAS[clave] || []).forEach((p) => set.add(p));
  }
  return Array.from(set).sort();
}

// "VICTOR" -> "Victor" (para mostrar en badges y el select).
function etiquetaPersona(p: string): string {
  return p.charAt(0) + p.slice(1).toLowerCase();
}


// Compara la fecha de una venta (fechaEmision/createdAt) contra un rango
// [inicio, fin] en formato "YYYY-MM-DD" (el que entrega <input type="date">).
// Si el input está vacío, ese extremo del rango no restringe nada.
// Compara la fecha de una venta (fechaEmision/createdAt) contra un rango
// [inicio, fin] en formato "YYYY-MM-DD" (el que entrega <input type="date">).
// Si el input está vacío, ese extremo del rango no restringe nada.
//
// IMPORTANTE: se compara usando la fecha en hora LOCAL del navegador
// (getFullYear/getMonth/getDate), no en UTC (toISOString), porque eso es
// justo lo que ve el usuario en la card (formatearFecha también usa hora
// local). Si se comparara en UTC, una venta que en pantalla dice "30 jun."
// podría entrar igual a un filtro de "01 jul. en adelante", porque en UTC
// esa misma fecha/hora ya cae en julio — desfase típico de huso horario
// (Perú es UTC-5).
function fechaEnRango(fechaVenta: string | undefined, desde: string, hasta: string): boolean {
  if (!desde && !hasta) return true;
  if (!fechaVenta) return false;
  const d = new Date(fechaVenta);
  if (Number.isNaN(d.getTime())) return false;
  const anio = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  const soloFecha = `${anio}-${mes}-${dia}`;
  if (desde && soloFecha < desde) return false;
  if (hasta && soloFecha > hasta) return false;
  return true;
}

// A qué persona del diccionario (VICTOR / ELIAS / ELIANE) corresponde el
// usuario logueado, comparando su nombre completo normalizado. Si no
// coincide con ninguna, devuelve null (= ve todas las categorías, como
// admin/gerencia/seguimiento).
function personaDeUsuario(nombre?: string | null): string | null {
  if (!nombre) return null;
  const norm = normalizarTexto(nombre);
  const personas = ["VICTOR", "ELIAS", "ELIANE"];
  return personas.find((p) => norm.includes(p)) || null;
}
// ============================================================
// Colores consistentes por usuario — la leyenda "Victor = rojo, Elias =
// azul". El color sale de un hash del nombre, así SIEMPRE es el mismo
// color para el mismo usuario sin tener que configurar nada a mano ni
// mantener una lista de usuarios en el código.
// ============================================================
const PALETA_USUARIOS = [
  { dot: "bg-red-500",     texto: "text-red-700",     fondo: "bg-red-50",     borde: "border-red-200" },
  { dot: "bg-blue-500",    texto: "text-blue-700",    fondo: "bg-blue-50",    borde: "border-blue-200" },
  { dot: "bg-emerald-500", texto: "text-emerald-700", fondo: "bg-emerald-50", borde: "border-emerald-200" },
  { dot: "bg-violet-500",  texto: "text-violet-700",  fondo: "bg-violet-50",  borde: "border-violet-200" },
  { dot: "bg-orange-500",  texto: "text-orange-700",  fondo: "bg-orange-50",  borde: "border-orange-200" },
  { dot: "bg-pink-500",    texto: "text-pink-700",    fondo: "bg-pink-50",    borde: "border-pink-200" },
  { dot: "bg-cyan-500",    texto: "text-cyan-700",    fondo: "bg-cyan-50",    borde: "border-cyan-200" },
  { dot: "bg-yellow-500",  texto: "text-yellow-700",  fondo: "bg-yellow-50",  borde: "border-yellow-200" },
];

export function colorUsuario(nombre?: string | null) {
  if (!nombre) return { dot: "bg-slate-300", texto: "text-slate-500", fondo: "bg-slate-50", borde: "border-slate-200" };
  let hash = 0;
  for (let i = 0; i < nombre.length; i++) hash = (hash * 31 + nombre.charCodeAt(i)) >>> 0;
  return PALETA_USUARIOS[hash % PALETA_USUARIOS.length];
}

// Estado general de una orden, para el filtro "Estado de seguimiento":
// - "confirmado": TODOS sus productos ya están confirmado/subido.
// - "preview": al menos uno tiene avance, pero no todos confirmados.
// - "pendiente": nadie ha tocado nada todavía.
export function estadoGeneralDe(
  v: VentaErp,
  seguimientosPorOrden?: Record<number, Record<string, string>>
): "pendiente" | "preview" | "confirmado" {
  const { total, completados, confirmadosOSubidos } = progresoProductos(v, seguimientosPorOrden);
  if (total === 0) return "pendiente";
  if (confirmadosOSubidos === total) return "confirmado";
  if (completados > 0) return "preview";
  return "pendiente";
}

const ITEMS_POR_PAGINA = 24; // 4 columnas x 6 filas en desktop

export interface TabVentasErpProps {
  ventas: VentaErp[];
  meta: { paginas: number; actualizado: string } | null;
  cargando: boolean;
  error: string;
  sinSesion: boolean;
  onRefrescar: (forzar?: boolean) => void;
  /** Abre el drawer de OPs para VER/gestionar las OPs que YA existen (nOps >= 1). */
  onAbrirOps?: (v: VentaErp) => void;
  /** Dispara la creación de la(s) OP(s) en el ERP para una venta que aún no tiene ninguna (nOps === 0). */
  onIniciarOps?: (v: VentaErp) => void;
  /** Abre CrearOrdenModal en modo "existente" para ver/editar esta venta ya creada. */
  onVerOrdenExistente?: (v: VentaErp) => void;
  /** {orden_compra_id: {producto_codigo: estado}} — para pintar X/Y sin completar en cada card. */
  seguimientosPorOrden?: Record<number, Record<string, string>>;
  /** {orden_compra_id: {producto_codigo: detalle}} — para mostrar "Rellenado por: X" en cada card. */
  detallesPorOrden?: Record<number, Record<string, DetalleSeguimientoProducto>>;
  /** Nombre del usuario logueado — para restringir el filtro de Categoría a lo asignado a esa persona en el diccionario. */
  usuarioActual?: string;
}
// NOTA: este componente YA NO trae sus propios datos — los recibe por
// props desde HelbotPage, que es quien hace fetch a /erp/ventas UNA sola
// vez y los comparte con este tab y con el panel dividido del tab
// "Monitor" (y los mantiene al día por WebSocket vía 'ventas_erp_actualizadas').
export default function TabVentasErp({ ventas, meta, cargando, error, sinSesion, onRefrescar, onAbrirOps, onIniciarOps, onVerOrdenExistente, seguimientosPorOrden, detallesPorOrden, usuarioActual }: TabVentasErpProps) {
  const [filtroTexto, setFiltroTexto] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [filtroDepartamento, setFiltroDepartamento] = useState("");
  const [filtroEtapa, setFiltroEtapa] = useState("");
  const [filtroCatalogo, setFiltroCatalogo] = useState("");

  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroPersona, setFiltroPersona] = useState("");
  const [filtroFechaInicio, setFiltroFechaInicio] = useState("");
  const [filtroFechaFin, setFiltroFechaFin] = useState("");
  const [filtroSeguimiento, setFiltroSeguimiento] = useState<"" | "pendiente" | "preview" | "confirmado">("");
  const [filtroRellenadoPor, setFiltroRellenadoPor] = useState("");
  const [filtroConfirmadoPor, setFiltroConfirmadoPor] = useState("");
  const [filtroPrivadas, setFiltroPrivadas] = useState(false);
  const [mostrarFiltros, setMostrarFiltros] = useState(false);

  const [pagina, setPagina] = useState(1);

  // ---- opciones de filtro derivadas de los datos reales ----
  const estadosDisponibles = useMemo(
    () => Array.from(new Set(ventas.map(estadoDe).filter((e) => e !== "—"))).sort(),
    [ventas]
  );
  const empresasDisponibles = useMemo(
    () => Array.from(new Set(ventas.map(empresaNombre).filter((e) => e !== "—"))).sort(),
    [ventas]
  );
  const departamentosDisponibles = useMemo(
    () => Array.from(new Set(ventas.map(departamentoDe).filter((e) => e !== "—"))).sort(),
    [ventas]
  );
const etapasDisponibles = useMemo(
    () => Array.from(new Set(ventas.map(etapaDe).filter((e) => e !== "—"))).sort(),
    [ventas]
  );
  const catalogosDisponibles = useMemo(
    () => Array.from(new Set(ventas.map(catalogoNombreDe).filter((e) => e !== "—"))).sort(),
    [ventas]
  );

  const categoriasDisponibles = useMemo(() => {
    const persona = personaDeUsuario(usuarioActual);
    const claves = new Set<string>();
    ventas.forEach((v) => clavesDiccionarioDeVenta(v).forEach((c) => claves.add(c)));
    const lista = Array.from(claves).filter((clave) => {
      if (!persona) return true; // admin/gerencia/seguimiento ven todas las categorías con datos
      return (DICCIONARIO_CATEGORIAS[clave] || []).includes(persona);
    });
    return lista.sort((a, b) => etiquetaClave(a).localeCompare(etiquetaClave(b)));
  }, [ventas, usuarioActual]);


// Personas disponibles para el filtro "Usuario" — solo las que
  // realmente tienen al menos una venta con datos en este momento.
  const personasDisponibles = useMemo(() => {
    const set = new Set<string>();
    ventas.forEach((v) => personasDeVenta(v).forEach((p) => set.add(p)));
    return Array.from(set).sort();
  }, [ventas]); 


  // Nombres únicos que rellenaron/confirmaron productos de UNA venta,
  // leyendo detallesPorOrden. Se usa para poblar los <select> y para
  // pintar los badges de color en cada card.
  const usuariosDeVenta = useCallback(
    (v: VentaErp, campo: "rellenado_por" | "confirmado_por"): string[] => {
      const mapa = (v.id != null && detallesPorOrden?.[Number(v.id)]) || {};
      const set = new Set<string>();
      for (const codigo of Object.keys(mapa)) {
        const valor = mapa[codigo]?.[campo];
        if (valor) set.add(valor);
      }
      return Array.from(set);
    },
    [detallesPorOrden]
  );

  const usuariosRellenoDisponibles = useMemo(() => {
    const set = new Set<string>();
    ventas.forEach((v) => usuariosDeVenta(v, "rellenado_por").forEach((u) => set.add(u)));
    return Array.from(set).sort();
  }, [ventas, usuariosDeVenta]);

  const usuariosConfirmoDisponibles = useMemo(() => {
    const set = new Set<string>();
    ventas.forEach((v) => usuariosDeVenta(v, "confirmado_por").forEach((u) => set.add(u)));
    return Array.from(set).sort();
  }, [ventas, usuariosDeVenta]);

const filtrosActivos = [
    filtroEstado, filtroEmpresa, filtroDepartamento, filtroEtapa,
    filtroCatalogo, filtroCategoria, filtroPersona, filtroFechaInicio, filtroFechaFin,
    filtroSeguimiento, filtroRellenadoPor, filtroConfirmadoPor, filtroTexto, filtroPrivadas,
  ].filter(Boolean).length;

  const filtradas = useMemo(() => {
    return ventas.filter((v) => {
      const okEstado = !filtroEstado || estadoDe(v) === filtroEstado;
      const okEmpresa = !filtroEmpresa || empresaNombre(v) === filtroEmpresa;
      const okDepartamento = !filtroDepartamento || departamentoDe(v) === filtroDepartamento;
      const okEtapa = !filtroEtapa || etapaDe(v) === filtroEtapa;
      const okCatalogo = !filtroCatalogo || catalogoNombreDe(v) === filtroCatalogo;
      const okCategoria = !filtroCategoria || clavesDiccionarioDeVenta(v).includes(filtroCategoria);
      const okPersona = !filtroPersona || personasDeVenta(v).includes(filtroPersona);
      const okFecha = fechaEnRango(fechaDe(v), filtroFechaInicio, filtroFechaFin);
      const okPrivada = !filtroPrivadas || v.ventaPrivada === true;

      // El filtro "Estado de seguimiento" solo debe afectar a las cards SIN

      // El filtro "Estado de seguimiento" solo debe afectar a las cards SIN
      // OP real (las que muestran la barra "X/Y sin completar"). Las cards
      // con OP ya generada ("1 OP · N entregada(s)") tienen su propio flujo
      // y badge informativo, pero no deben aparecer/desaparecer con este
      // filtro — por eso se excluyen aquí si hay OP.
      const okSeguimiento =
        !filtroSeguimiento ||
        ((v.nOps ?? 0) === 0 && estadoGeneralDe(v, seguimientosPorOrden) === filtroSeguimiento);
      const okRellenadoPor = !filtroRellenadoPor || usuariosDeVenta(v, "rellenado_por").includes(filtroRellenadoPor);
      const okConfirmadoPor = !filtroConfirmadoPor || usuariosDeVenta(v, "confirmado_por").includes(filtroConfirmadoPor);
      const okTexto = !filtroTexto || JSON.stringify(v).toLowerCase().includes(filtroTexto.toLowerCase());
      return okEstado && okEmpresa && okDepartamento && okEtapa && okCatalogo && okCategoria && okPersona && okFecha && okPrivada && okSeguimiento && okRellenadoPor && okConfirmadoPor && okTexto;
    });
  }, [
    ventas, filtroEstado, filtroEmpresa, filtroDepartamento, filtroEtapa, filtroCatalogo, filtroCategoria, filtroPersona,
    filtroFechaInicio, filtroFechaFin, filtroPrivadas, filtroSeguimiento, filtroRellenadoPor, filtroConfirmadoPor, filtroTexto, seguimientosPorOrden, usuariosDeVenta,
  ]);
  // reset de página cuando cambian los filtros
  useEffect(() => {
    setPagina(1);
  }, [
    filtroEstado, filtroEmpresa, filtroDepartamento, filtroEtapa, filtroCatalogo, filtroCategoria, filtroPersona,
    filtroFechaInicio, filtroFechaFin, filtroSeguimiento, filtroRellenadoPor, filtroConfirmadoPor, filtroTexto,
  ]);

  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / ITEMS_POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const paginadas = filtradas.slice(
    (paginaSegura - 1) * ITEMS_POR_PAGINA,
    paginaSegura * ITEMS_POR_PAGINA
  );

  const sumaMontos = filtradas.reduce((acc, v) => acc + (montoDe(v) || 0), 0);

  const limpiarFiltros = () => {
    setFiltroTexto("");
    setFiltroEstado("");
    setFiltroEmpresa("");
    setFiltroDepartamento("");
    setFiltroEtapa("");
    setFiltroCatalogo("");
    setFiltroCategoria("");
    setFiltroPersona("");
    setFiltroFechaInicio("");
    setFiltroFechaFin("");
    setFiltroSeguimiento("");
    setFiltroRellenadoPor("");
    setFiltroConfirmadoPor("");
    setFiltroPrivadas(false);
  };
  return (
    <div>
      <div className="flex items-start sm:items-end justify-between mb-6 flex-wrap gap-3">
        <div>

          <p className="text-sm text-slate-500 mt-1">
            {meta ? (
              <>
                {filtradas.length} de {ventas.length} registros · combinadas de {meta.paginas} página(s) ·
                actualizado{" "}
                <span style={{ fontFamily: "var(--font-mono)" }}>{formatearFecha(meta.actualizado)}</span>
              </>
            ) : (
              "Cargando…"
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
        <button
            onClick={() => setMostrarFiltros((x) => !x)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              mostrarFiltros || filtrosActivos > 0
                ? "bg-indigo-50 border-indigo-200 text-[#4F46E5]"
                : "bg-white border-slate-200 text-slate-700 hover:border-slate-300 hover:text-slate-900"
            }`}
          >
            <SlidersHorizontal size={14} />
            Filtros
            {filtrosActivos > 0 && (
              <span className="bg-[#4F46E5] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {filtrosActivos}
              </span>
            )}
          </button>
          <button
            onClick={() => setFiltroPrivadas((x) => !x)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
              filtroPrivadas
                ? "bg-fuchsia-600 border-fuchsia-600 text-white shadow-sm"
                : "bg-white border-fuchsia-200 text-fuchsia-700 hover:border-fuchsia-300 hover:bg-fuchsia-50"
            }`}
          >
            <Lock size={14} />
            Privadas
          </button>
          <button
            onClick={() => onRefrescar(true)}
            disabled={cargando}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm font-medium text-slate-700 hover:border-slate-300 hover:text-slate-900 transition-colors disabled:opacity-50"
          >
            {cargando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refrescar (todas las páginas)
          </button>
        </div>
      </div>

      {sinSesion && (
        <div className="mb-6 flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
          <AlertTriangle size={15} />
          No hay sesión activa en el ERP. Inicia sesión con el botón &quot;ERP&quot; en la parte de arriba y luego
          refresca aquí.
        </div>
      )}

      {error && !sinSesion && (
        <div className="mb-6 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          <AlertTriangle size={15} />
          {error}
        </div>
      )}

      {/* Buscador combinado */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          placeholder="Buscar en cualquier campo (cliente, código, dirección, contacto...)"
          value={filtroTexto}
          onChange={(e) => setFiltroTexto(e.target.value)}
          className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-9 py-2.5 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
        />
        {filtroTexto && (
          <button
            onClick={() => setFiltroTexto("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Panel de filtros por columna */}
      <div
        className={`grid transition-all duration-300 ease-out ${
          mostrarFiltros ? "grid-rows-[1fr] opacity-100 mb-6" : "grid-rows-[0fr] opacity-0 mb-0"
        }`}
      >
      <div className="overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4">
            <SelectFiltro label="Estado (ERP)" valor={filtroEstado} onChange={setFiltroEstado} opciones={estadosDisponibles} />
            <SelectFiltro label="Empresa" valor={filtroEmpresa} onChange={setFiltroEmpresa} opciones={empresasDisponibles} />
            <SelectFiltro label="Departamento" valor={filtroDepartamento} onChange={setFiltroDepartamento} opciones={departamentosDisponibles} />
            <SelectFiltro label="Etapa" valor={filtroEtapa} onChange={setFiltroEtapa} opciones={etapasDisponibles} />
            <SelectFiltro label="Catálogo" valor={filtroCatalogo} onChange={setFiltroCatalogo} opciones={catalogosDisponibles}  />

            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Categoría</label>
              <select
                value={filtroCategoria}
                onChange={(e) => setFiltroCategoria(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 hb-pulse-glow"
              >
                <option value="">Todos</option>
                {categoriasDisponibles.map((clave) => (
                  <option key={clave} value={clave}>{etiquetaClave(clave)}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Usuario (dueño de categoría)</label>
              <select
                value={filtroPersona}
                onChange={(e) => setFiltroPersona(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Todos</option>
                {personasDisponibles.map((p) => (
                  <option key={p} value={p}>{etiquetaPersona(p)}</option>
                ))}
              </select>
            </div>


            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Fecha inicio emisión de Orden</label>
              <input
                type="date"
                value={filtroFechaInicio}
                onChange={(e) => setFiltroFechaInicio(e.target.value)}
                max={filtroFechaFin || undefined}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Fecha fin emisión de Orden</label>
              <input
                type="date"
                value={filtroFechaFin}
                onChange={(e) => setFiltroFechaFin(e.target.value)}
                min={filtroFechaInicio || undefined}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>


            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Estado de seguimiento</label>  
              <select
                value={filtroSeguimiento}
                onChange={(e) => setFiltroSeguimiento(e.target.value as any)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Todos</option>
                <option value="pendiente">Sin completar</option>
                <option value="preview">En preview</option>
                <option value="confirmado">Confirmado por seguimiento</option>
              </select>
            </div>

            

            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Rellenado por</label>
              <select
                value={filtroRellenadoPor}
                onChange={(e) => setFiltroRellenadoPor(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Todos</option>
                {usuariosRellenoDisponibles.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Confirmado por</label>
              <select
                value={filtroConfirmadoPor}
                onChange={(e) => setFiltroConfirmadoPor(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Todos</option>
                {usuariosConfirmoDisponibles.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>

            <div className="flex items-end">
              <button
                onClick={limpiarFiltros}
                disabled={filtrosActivos === 0}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-500 hover:text-slate-800 hover:border-slate-300 transition-colors disabled:opacity-40 disabled:hover:border-slate-200 disabled:hover:text-slate-500"
              >
                <X size={13} /> Limpiar filtros
              </button>
            </div>
          </div>

          {/* Leyenda de colores por usuario — clic en un nombre filtra
              directo, sin tocar los selects de arriba. */}
          {(usuariosRellenoDisponibles.length > 0 || usuariosConfirmoDisponibles.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 bg-slate-50 border border-t-0 border-slate-200 rounded-b-xl px-4 py-3">
              <span className="text-[11px] font-medium text-slate-500 mr-1">Leyenda:</span>
              {usuariosRellenoDisponibles.map((u) => {
                const c = colorUsuario(u);
                const activo = filtroRellenadoPor === u;
                return (
                  <button
                    key={`r-${u}`}
                    onClick={() => setFiltroRellenadoPor((prev) => (prev === u ? "" : u))}
                    title={`Filtrar por rellenado por: ${u}`}
                    className={`flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${
                      activo ? `${c.fondo} ${c.texto} ${c.borde}` : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                    {u}
                  </button>
                );
              })}
              {usuariosConfirmoDisponibles.length > 0 && <span className="text-[11px] text-slate-300 mx-1">·</span>}
              {usuariosConfirmoDisponibles.map((u) => {
                const c = colorUsuario(u);
                const activo = filtroConfirmadoPor === u;
                return (
                  <button
                    key={`c-${u}`}
                    onClick={() => setFiltroConfirmadoPor((prev) => (prev === u ? "" : u))}
                    title={`Filtrar por confirmado por: ${u}`}
                    className={`flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-full border transition-colors ${
                      activo ? `${c.fondo} ${c.texto} ${c.borde}` : "bg-white text-slate-500 border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <ShieldCheck size={10} />
                    {u}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {sumaMontos > 0 && (
        <p style={{ fontFamily: "var(--font-mono)" }} className="text-xs text-slate-500 mb-4">
          Suma de montos visibles: <span className="font-semibold text-slate-800">{formatearMonto(sumaMontos)}</span>
        </p>
      )}

      {cargando && ventas.length === 0 ? (
        <SkeletonGrid />
      ) : filtradas.length === 0 && !sinSesion ? (
        <EmptyStateLocal
          icon={DollarSign}
          titulo="Sin registros"
          detalle="No se encontraron ventas con los filtros actuales, o el ERP no devolvió datos."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {paginadas.map((v, i) => (
              <CardVentaErp
                key={String(v.id ?? i)}
                v={v}
                onAbrirOps={onAbrirOps}
                onIniciarOps={onIniciarOps}
                onVerOrdenExistente={onVerOrdenExistente}
                seguimientosPorOrden={seguimientosPorOrden}
                detallesPorOrden={detallesPorOrden}
              />
            ))}
          </div>

          <Paginador
            paginaActual={paginaSegura}
            totalPaginas={totalPaginas}
            onCambiar={setPagina}
            totalRegistros={filtradas.length}
            porPagina={ITEMS_POR_PAGINA}
          />
        </>
      )}
    </div>
  );
}

function SelectFiltro({
  label,
  valor,
  onChange,
  opciones,
  destacar,
}: {
  label: string;
  valor: string;
  onChange: (v: string) => void;
  opciones: string[];
  /** true = el select parpadea para llamar la atención (ej. filtro nuevo o importante). */
  destacar?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-500 mb-1">{label}</label>
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full bg-white border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ${
          destacar ? "border-indigo-400 animate-pulse" : "border-slate-200"
        }`}
      >
        <option value="">Todos</option>
        {opciones.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

function Paginador({
  paginaActual,
  totalPaginas,
  onCambiar,
  totalRegistros,
  porPagina,
}: {
  paginaActual: number;
  totalPaginas: number;
  onCambiar: (p: number) => void;
  totalRegistros: number;
  porPagina: number;
}) {
  const inicio = (paginaActual - 1) * porPagina + 1;
  const fin = Math.min(paginaActual * porPagina, totalRegistros);

  // ventana de páginas visibles alrededor de la actual
  const paginas: (number | "…")[] = [];
  const ventana = 1;
  for (let p = 1; p <= totalPaginas; p++) {
    if (p === 1 || p === totalPaginas || (p >= paginaActual - ventana && p <= paginaActual + ventana)) {
      paginas.push(p);
    } else if (paginas[paginas.length - 1] !== "…") {
      paginas.push("…");
    }
  }

  return (
    <div className="flex items-center justify-between flex-wrap gap-3 mt-6 pt-4 border-t border-slate-100">
      <p className="text-xs text-slate-400" style={{ fontFamily: "var(--font-mono)" }}>
        Mostrando {inicio}–{fin} de {totalRegistros}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onCambiar(paginaActual - 1)}
          disabled={paginaActual === 1}
          className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-800 disabled:opacity-30 disabled:hover:border-slate-200 transition-colors"
        >
          <ChevronLeft size={14} />
        </button>
        {paginas.map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-2 text-slate-300 text-sm">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onCambiar(p)}
              className={`min-w-[32px] h-8 px-2 rounded-lg text-sm font-medium transition-colors ${
                p === paginaActual
                  ? "bg-[#4F46E5] text-white"
                  : "text-slate-600 hover:bg-slate-100 border border-transparent"
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onCambiar(paginaActual + 1)}
          disabled={paginaActual === totalPaginas}
          className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-800 disabled:opacity-30 disabled:hover:border-slate-200 transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

function DocumentoLink({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md bg-indigo-50 text-[#4F46E5] hover:bg-indigo-100 transition-colors"
    >
      <Icon size={11} />
      {label}
      <ExternalLink size={9} className="opacity-60" />
    </a>
  );
}

export function CardVentaErp({
  v,
  sinCoincidenciaPublicada,
  onAbrirOps,
  onIniciarOps,
  onVerOrdenExistente,
  seguimientosPorOrden,
  detallesPorOrden,
}: {
  v: VentaErp;
  /** true si este código de venta NO aparece en la lista de Publicadas — lo pinta el comparador del tab Monitor. */
  sinCoincidenciaPublicada?: boolean;
  /** Se llama al hacer clic en el bloque de OPs, solo si nOps >= 1. Abre el drawer para VER las OPs existentes. */
  onAbrirOps?: (v: VentaErp) => void;
  /** Se llama al hacer clic, solo si nOps === 0. Dispara la creación de la OP en el ERP. */
  onIniciarOps?: (v: VentaErp) => void;
  /** Se llama al hacer clic en cualquier otra parte de la card — abre CrearOrdenModal en modo "existente". */
  onVerOrdenExistente?: (v: VentaErp) => void;
  /** {orden_compra_id: {producto_codigo: estado}} — para pintar el progreso X/Y sin completar. */
  seguimientosPorOrden?: Record<number, Record<string, string>>;
  /** {orden_compra_id: {producto_codigo: detalle}} — para mostrar quién rellenó/confirmó. */
  detallesPorOrden?: Record<number, Record<string, DetalleSeguimientoProducto>>;
}) {
  const [expandido, setExpandido] = useState(false);
  const [mostrarTodasCategorias, setMostrarTodasCategorias] = useState(false);
  const monto = montoDe(v);
  const estado = estadoDe(v);

  const documentos: { href: string; label: string; icon: LucideIcon }[] = [];
  if (v.documentoOce) documentos.push({ href: v.documentoOce, label: "OCE", icon: FileText });
  if (v.documentoOcf) documentos.push({ href: v.documentoOcf, label: "OCF", icon: FileCheck2 });
  if (v.documentoPeruCompras)
    documentos.push({ href: v.documentoPeruCompras, label: "Perú Compras", icon: FileText });

// Mismo chequeo que en CardPublicada: si el usuario estaba
  // seleccionando texto para copiar, el mouseup no debe abrir el modal.
  const manejarClickCard = () => {
    const seleccion = window.getSelection();
    if (seleccion && seleccion.toString().length > 0) return;
    onVerOrdenExistente?.(v);
  };

return (
    <div
      onClick={manejarClickCard}
      className={`group relative bg-white border rounded-xl p-4 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 animate-[fadeIn_0.25s_ease-out] flex flex-col cursor-pointer ${
        sinCoincidenciaPublicada ? "border-amber-300 hover:border-amber-400" : "border-slate-200 hover:border-indigo-300"
      }`}
    >
      {personasDeVenta(v).length > 0 && (
        <div className="absolute top-3 right-3 flex flex-col items-end gap-1">
          {personasDeVenta(v).map((p) => {
            const c = colorUsuario(p);
            return (
              <span
                key={p}
                title={`Categoría(s) asignada(s) a ${etiquetaPersona(p)}`}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border ${c.fondo} ${c.texto} ${c.borde}`}
              >
                {etiquetaPersona(p)}
              </span>
            );
          })}
        </div>
      )}

      <p
        style={{ fontFamily: "var(--font-mono)" }}
        className="text-lg font-extrabold text-[#4F46E5] tracking-tight mb-0.5 truncate pr-16"
        title={titulo(v)}
      >
        {titulo(v)}
      </p>
      {v.numeroOcam && (
        <p style={{ fontFamily: "var(--font-mono)" }} className="text-xs text-slate-500 truncate block mb-2" title={v.numeroOcam}>
          #{String(v.id ?? "")} · {v.numeroOcam}
        </p>
      )}
      <div className="flex items-center gap-1.5 text-sm text-slate-600 mb-1.5">
        <Building2 size={13} className="text-slate-400 shrink-0" />
        <span className="truncate" title={clienteNombre(v)}>
          {clienteNombre(v)}
        </span>
      </div>

      {departamentoDe(v) !== "—" && (
        <div className="flex items-center gap-1.5 text-sm text-slate-500 mb-2">
          <MapPin size={13} className="text-slate-300 shrink-0" />
          <span className="truncate">{departamentoDe(v)}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-1.5 mb-1">
        <div className="flex items-center gap-1.5 text-xs text-slate-500">
          <CalendarDays size={13} className="text-slate-300 shrink-0" />
          <span style={{ fontFamily: "var(--font-mono)" }}>{formatearFecha(fechaDe(v))}</span>
        </div>
        <ContadorVencimiento fechaMaxForm={v.fechaMaxForm} />
      </div>
      {v.fechaMaxForm && (
        <p className="text-xs text-slate-500 mb-2">
          Vence: <span style={{ fontFamily: "var(--font-mono)" }} className="text-slate-700 font-medium">{formatearFecha(v.fechaMaxForm)}</span>
        </p>
      )}

      {categoriasDeVenta(v).length > 0 && (() => {
        const categorias = categoriasDeVenta(v);
        const LIMITE = 4;
        const visibles = mostrarTodasCategorias ? categorias : categorias.slice(0, LIMITE);
        const restantes = categorias.length - LIMITE;
        return (
          <div className="grid grid-cols-2 gap-1 mb-3">
            {visibles.map((cat) => (
              <span
                key={cat}
                title={cat}
                className="text-[11px] font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1 truncate"
              >
                {cat}
              </span>
            ))}
            {!mostrarTodasCategorias && restantes > 0 && (
              <button
                onClick={() => setMostrarTodasCategorias(true)}
                className="text-[11px] font-semibold text-[#4F46E5] bg-indigo-50 border border-indigo-200 rounded px-2 py-1 hover:bg-indigo-100 transition-colors"
              >
                +{restantes} más
              </button>
            )}
            {mostrarTodasCategorias && categorias.length > LIMITE && (
              <button
                onClick={() => setMostrarTodasCategorias(false)}
                className="col-span-2 text-[11px] font-semibold text-slate-500 bg-slate-50 border border-slate-200 rounded px-2 py-1 hover:bg-slate-100 transition-colors"
              >
                Ver menos
              </button>
            )}
          </div>
        );
      })()}



      {documentos.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {documentos.map((d) => (
            <DocumentoLink key={d.label} {...d} />
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between pt-2 border-t border-slate-100">
        <span className="text-xs text-slate-500 truncate">{empresaNombre(v)}</span>
        {monto != null && (
          <span
            style={{ fontFamily: "var(--font-mono)" }}
            className="text-base font-semibold text-slate-800 shrink-0"
          >
            {formatearMonto(monto)}
          </span>
        )}
      </div>


      <div className="mt-2 flex justify-center">
        <span className={`text-xs font-semibold px-3 py-1.5 rounded-full border ${estiloEstado(estado)}`}>
          {estado}
        </span>
      </div>

    {(() => {
      const { total, pendientes, preview, confirmados, subidos, confirmadosOSubidos, completados, enErp } = progresoProductos(v, seguimientosPorOrden);
      const hayAvance = completados > 0;
      const todoConfirmado = total > 0 && confirmadosOSubidos === total;

      if ((v.nOps ?? 0) >= 1) {
        const viaFormulario = confirmados + subidos; // confirmado o subido = pasó por el formulario de Helbot
        const soloErpDirecto = total > 0 && enErp === total; // el 100% vino directo del ERP, sin tocar Helbot
        return (
          <div className="mt-2">
            <button
              onClick={(e) => { e.stopPropagation(); onAbrirOps?.(v); }}
              className={`w-full flex items-center justify-between gap-2 border rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                soloErpDirecto
                  ? "bg-violet-50 hover:bg-violet-100 border-violet-200 text-violet-700"
                  : "bg-indigo-50 hover:bg-indigo-100 border-indigo-100 text-[#4F46E5]"
              }`}
            >
              <span>
                {total > 0 && !todoConfirmado
                  ? `${completados}/${total} · ${pendientes} sin completar`
                  : `${v.nOps} OP${v.nOps !== 1 ? "s" : ""} registrada${v.nOps !== 1 ? "s" : ""}`}
              </span>
              <ChevronRight size={14} />
            </button>
            {(enErp > 0 || viaFormulario > 0) && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {enErp > 0 && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-violet-100 text-violet-700 border-violet-300">
                    {enErp} llenado{enErp !== 1 ? "s" : ""} directo en ERP
                  </span>
                )}
                {viaFormulario > 0 && (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-indigo-50 text-[#4F46E5] border-indigo-200">
                    {viaFormulario} vía formulario
                  </span>
                )}
              </div>
            )}
          </div>
        );
      }
      // Arma un texto tipo "1 confirmado · 1 en preview" en vez de un
      // solo número global, para que se vea el estado real de cada uno.
      let etiqueta = "";
      if (total > 0) {
        if (todoConfirmado) {
          etiqueta = enErp === total
            ? `${total}/${total} ya registrado en el ERP`
            : `${confirmadosOSubidos}/${total} completado${enErp > 0 ? ` (${enErp} ya en ERP)` : " por seguimiento"}`;
        } else {
          const partes: string[] = [];
          if (enErp > 0) partes.push(`${enErp} ya en ERP`);
          if (confirmados + subidos > 0) partes.push(`${confirmados + subidos} confirmado${(confirmados + subidos) !== 1 ? "s" : ""}`);
          if (preview > 0) partes.push(`${preview} en preview`);
          if (pendientes > 0) partes.push(`${pendientes} sin completar`);
          etiqueta = `${completados}/${total} · ${partes.join(" · ")}`;
        }
      }

      // Nombres de quién rellenó / confirmó, sacados de detallesPorOrden.
      // Se juntan sin repetir para no listar el mismo nombre 5 veces si
      // llenó varios productos de la misma orden.
      const mapaDetalle = (v.id != null && detallesPorOrden?.[Number(v.id)]) || {};
      const nombresRellenado = new Set<string>();
      const nombresConfirmado = new Set<string>();
      for (const codigo of Object.keys(mapaDetalle)) {
        const d = mapaDetalle[codigo];
        if (d?.rellenado_por) nombresRellenado.add(d.rellenado_por);
        if (d?.confirmado_por) nombresConfirmado.add(d.confirmado_por);
      }

      return (
        <div className="mt-2">
          <button
            onClick={(e) => { e.stopPropagation(); onIniciarOps?.(v); }}
            className={`w-full flex items-center justify-between gap-2 border rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              todoConfirmado
                ? "bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700"
                : hayAvance
                ? "bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-700"
                : "bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-600"
            }`}
          >
            <span>{etiqueta}</span>
            <ChevronRight size={14} />
          </button>
          {(nombresRellenado.size > 0 || nombresConfirmado.size > 0) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {Array.from(nombresRellenado).map((n) => {
                const c = colorUsuario(n);
                return (
                  <span
                    key={`r-${n}`}
                    title={`Rellenado por ${n}`}
                    className={`flex items-center gap-1 text-[11px] font-medium pl-1.5 pr-2 py-1 rounded-full border ${c.fondo} ${c.texto} ${c.borde}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                    {n}
                  </span>
                );
              })}
          {Array.from(nombresConfirmado).map((n) => {
                const c = colorUsuario(n);
                return (
                  <span
                    key={`c-${n}`}
                    title={`Confirmado por ${n}`}
                    className={`flex items-center gap-1 text-[11px] font-medium pl-1.5 pr-2 py-1 rounded-full border ${c.fondo} ${c.texto} ${c.borde}`}
                  >
                    <ShieldCheck size={10} />
                    {n}
                  </span>
                );
              })}
            </div>
          )}
          {(() => {
            const productosConFaltantes = (v.productos || [])
              .map((p) => {
                const codigo = String(p.codigo ?? "").trim();
                const d = mapaDetalle[codigo];
                return d && d.estado === "preview" && (d.campos_faltantes?.length ?? 0) > 0
                  ? { codigo, faltantes: d.campos_faltantes as string[] }
                  : null;
              })
              .filter(Boolean) as { codigo: string; faltantes: string[] }[];
            if (productosConFaltantes.length === 0) return null;
            return (
              <div className="mt-1.5 space-y-0.5">
              {productosConFaltantes.map(({ codigo, faltantes }) => (
                  <p key={codigo} className="text-xs text-amber-700 truncate" title={faltantes.join(", ")}>
                    {codigo} — Falta: {faltantes.join(", ")}
                  </p>
                ))}
              </div>
            );
          })()}
        </div>
      );
    })()}
      <button
        onClick={(e) => { e.stopPropagation(); setExpandido((x) => !x); }}
        className="mt-3 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 transition-colors"
      >
        {expandido ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {expandido ? "Ocultar todos los campos" : "Ver todos los campos"}
      </button>
      {expandido && (
        <pre
          style={{ fontFamily: "var(--font-mono)" }}
          className="mt-2 text-[10px] bg-slate-50 border border-slate-100 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-all text-slate-600 max-h-64 overflow-y-auto"
        >
          {JSON.stringify(v, null, 2)}
        </pre>
      )} 
    </div>
  );
}

export function SkeletonGrid() {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
        <Loader2 size={15} className="animate-spin" /> Descargando todas las páginas del ERP…
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="bg-white border border-slate-200 rounded-xl p-4 animate-pulse"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div className="flex justify-between mb-3">
              <div className="h-3 w-10 bg-slate-100 rounded" />
              <div className="h-4 w-16 bg-slate-100 rounded-full" />
            </div>
            <div className="h-4 w-3/4 bg-slate-100 rounded mb-3" />
            <div className="h-3 w-1/2 bg-slate-100 rounded mb-2" />
            <div className="h-3 w-1/3 bg-slate-100 rounded mb-4" />
            <div className="flex justify-between pt-2 border-t border-slate-100">
              <div className="h-3 w-14 bg-slate-100 rounded" />
              <div className="h-4 w-16 bg-slate-100 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyStateLocal({ icon: Icon, titulo, detalle }: { icon: LucideIcon; titulo: string; detalle: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-200 rounded-xl bg-white/50 py-16">
      <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mb-3">
        <Icon size={24} className="text-[#4F46E5]" />
      </div>
      <p className="text-sm font-semibold text-slate-700">{titulo}</p>
      <p className="text-xs text-slate-500 mt-1 max-w-xs">{detalle}</p>
    </div>
  );
}