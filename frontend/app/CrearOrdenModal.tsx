"use client";

/**
 * CrearOrdenModal.tsx
 * ---------------------
 * Réplica de tu pantalla "OCGRU1016" (captura #1): descarga el PDF de
 * la orden publicada, lo pasa por el OCR de Helbot (mismo flujo que ya
 * tenías en RegistrarOrdenModal.tsx), usa esos datos para PRE-LLENAR el
 * formulario completo (Lugar de entrega / Datos generales / Contacto /
 * Productos), y al tocar "Guardar Datos" hace el POST /api/ventas
 * (crear) o PUT /api/ventas/:id (editar) directo contra el ERP — los
 * mismos endpoints/payloads que capturaste en Network.
 *
 * El botón + panel "Agrupar OC" vive en AgruparOrdenModal.tsx y se
 * importa acá tal cual.
 *
 * ============================================================
 * CÓMO INTEGRARLO EN TU APP (reemplaza a RegistrarOrdenModal.tsx)
 * ============================================================
 * 1) Copia este archivo + AgruparOrdenModal.tsx + erp-shared.ts a la
 *    misma carpeta donde tienes helbot-shared.ts.
 * 2) Ajusta en erp-shared.ts cómo obtienes el JWT del ERP
 *    (ERP_TOKEN_STORAGE_KEY / getErpToken).
 * 3) Ajusta los endpoints de búsqueda (buscarClientes,
 *    contactosDeCliente, catalogosDeEmpresa) a los reales de tu ERP —
 *    no salieron en tus capturas, así que son mi mejor supuesto.
 * 4) En la vista donde antes abrías <RegistrarOrdenModal p={p} />,
 *    cámbialo por <CrearOrdenModal publicada={p} empresaId={5} />
 *    (o el id de empresa que corresponda al usuario logueado).
 * 5) Revisa `mapOcrAFormulario()` más abajo — ahí está cada campo del
 *    OCR mapeado a su campo del formulario, con comentarios donde el
 *    mapeo es un supuesto mío y no un 1:1 confirmado.
 */

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  Loader2,
  AlertTriangle,
  FileScan,
  Building2,
  MapPin,
  Info,
  User,
  Package,
  Plus,
  Trash2,
  Search,
  Save,
  ArrowLeft,
  UploadCloud,
  X,
  FileText,
  Eye,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  CalendarDays,
} from "lucide-react";
import { API_BASE, fetchConToken, Publicada } from "./helbot-shared";
import {
  ProductoVenta,
  VentaCreatePayload,
  Venta,
  EmpresaOption,
  ContactoCreatePayload,
  AgrupacionListItem,
  AgrupacionOC,
  crearVenta,
  actualizarVenta,
  obtenerVenta,
  buscarClientes,
  contactosDeCliente,
  crearContacto,
  catalogosDeEmpresa,
  listarEmpresas,
  crearAgrupacion,
  agregarOrdenAAgrupacion,
  agrupacionPorOrdenCompra,
  agrupacionPorId,
  listarAgrupaciones,
  subirDocumento,
  guardarMontosReferenciaProductos,
  obtenerMontosReferenciaProductos,
} from "./erp-shared";
import PanelConsultaMef from "./PanelConsultaMef";

import { estiloEstado } from "./TabVentasErp";

// ============================================================
// Tipos de estado del formulario
// ============================================================
interface ContactoOption {
  id: number;
  nombre: string;
  telefono: string | null;
  cargo?: string | null;
}
interface ClienteOption {
  id: number;
  razonSocial: string;
  ruc: string;
  departamento?: string;
  provincia?: string;
  distrito?: string;
  sede?: string;
  codigoUnidad?: string;
  direccion?: string;
  promedioCobranza?: string | number;
  codigoUnidadEjecutora?: string;
}
interface CatalogoOption {
  id: number;
  nombre: string;
  descripcion: string;
}

interface CampoFaltante {
  id: string;
  label: string;
}

/** Producto del formulario + su "Monto importe" local — nunca se manda
 * al ERP junto con el resto de productos; se guarda aparte vía
 * guardarMontosReferenciaProductos(). Funciona igual que 'comodato'. */
interface ProductoVentaForm extends ProductoVenta {
  montoReferencia?: string;
}

interface FormState {
  // Empresa (nueva)
  empresa: EmpresaOption | null;
  // Cliente / contacto
  cliente: ClienteOption | null;
  contacto: ContactoOption | null;
  // Catálogo
  catalogoEmpresaId: number | null;
  catalogoLabel: string;
  // Lugar de entrega
  direccionEntrega: string;
  distritoEntrega: string;
  provinciaEntrega: string;
  departamentoEntrega: string;
  referenciaEntrega: string;
  // Datos generales
// Datos generales
  unidadEjecutora: string;
  fechaForm: string;
  fechaMaxForm: string;
  fechaEntrega: string;
  montoVenta: string;
  siaf: string;
  etapaSiaf: string;
  fechaSiaf: string;
  codigoOcf: string;
  numeroOcam: string;
  fuentesFinanciamiento: string;
  multipleFuentesFinanciamiento: boolean;
  // Productos
  // Productos
  productos: ProductoVentaForm[];
  // Otros
  ventaPrivada: boolean;
  estadoProgreso: "creacion" | "en_proceso" | "completo";
}

const hoyISO = () => new Date().toISOString().slice(0, 10);

const formularioVacio = (): FormState => ({
  empresa: { id: 5, razonSocial: "GRUPO ECOLIMP E.I.R.L.", ruc: "20611043873" },
  cliente: null,
  contacto: null,
  catalogoEmpresaId: null,
  catalogoLabel: "",
  direccionEntrega: "",
  distritoEntrega: "",
  provinciaEntrega: "",
  departamentoEntrega: "",
  referenciaEntrega: "",
  unidadEjecutora: "",
  fechaForm: hoyISO(),
  fechaMaxForm: hoyISO(),
  fechaEntrega: hoyISO(),
  montoVenta: "",
  siaf: "",
  etapaSiaf: "COM",
  fechaSiaf: hoyISO(),
  codigoOcf: "",
  numeroOcam: "",
  fuentesFinanciamiento: "00",
  multipleFuentesFinanciamiento: false,
  productos: [{ codigo: "", descripcion: "", marca: "", cantidad: 1, isCompleted: false, montoReferencia: "" }],
  ventaPrivada: false,
  estadoProgreso: "creacion",
});



function ddmmyyyyAIso(fecha: string): string {
  const m = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return fecha;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

// Los documentoOce/documentoOcf que vienen del ERP son URLs completas
// (ej. ".../OCAM-2026-1499-25-0_1784731552208.pdf") — esto saca solo el
// nombre de archivo para mostrarlo en el visor, igual que archivo.name.
function nombreDesdeUrl(url: string): string {
  try {
    const limpio = url.split("?")[0].split("#")[0];
    const partes = limpio.split("/");
    return decodeURIComponent(partes[partes.length - 1] || url);
  } catch {
    return url;
  }
}


// Quita la extensión (.pdf, .jpg, etc) de un nombre de archivo, para
// usarlo como valor de N° OCAM sin la extensión colgando.
function nombreSinExtension(nombre: string): string {
  const idx = nombre.lastIndexOf(".");
  return idx > 0 ? nombre.slice(0, idx) : nombre;
}


// El campo codigoUnidadEjecutora que devuelve el ERP para el cliente
// viene como texto descriptivo completo, ej.
// "471 - ESCUELA NAVAL DE LA COMANDANCIA GENERAL DE LA MARINA - LA PERLA"
// -> esto extrae SOLO el código numérico ("471") y lo rellena con ceros
// a la izquierda hasta 6 dígitos ("000471"), que es el formato que
// espera el campo Unidad Ejecutora / PanelConsultaMef (igual al que
// entrega el OCR directo del PDF).
function extraerCodigoUnidadEjecutora(raw: string | null | undefined): string {
  if (!raw) return "";
  const primeraParte = raw.split(" - ")[0].trim();
  const soloDigitos = primeraParte.replace(/\D/g, "");
  if (!soloDigitos) return "";
  return soloDigitos.padStart(6, "0");
}

// ============================================================
// Similitud de texto — para autoseleccionar el catálogo que más se
// parece al título detectado por el OCR (ej. "EXT-CE-2024-3 MATERIALES
// E INSUMOS DE LIMPIEZA..."). Usa coeficiente de Dice sobre bigramas de
// caracteres: tolera tildes, mayúsculas y orden de palabras distinto,
// pero exige un parecido MUY alto antes de autoseleccionar — si nada
// supera el umbral, no se selecciona nada y el usuario elige a mano.
// ============================================================
function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita tildes
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigramas(s: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

function similitudDice(a: string, b: string): number {
  const na = normalizarTexto(a);
  const nb = normalizarTexto(b);
  if (!na || !nb) return 0;
  const bigA = bigramas(na);
  const bigB = bigramas(nb);
  if (bigA.length === 0 || bigB.length === 0) return na === nb ? 1 : 0;

  const conteoB = new Map<string, number>();
  for (const bg of bigB) conteoB.set(bg, (conteoB.get(bg) || 0) + 1);

  let coincidencias = 0;
  for (const bg of bigA) {
    const disponibles = conteoB.get(bg) || 0;
    if (disponibles > 0) {
      coincidencias++;
      conteoB.set(bg, disponibles - 1);
    }
  }
  return (2 * coincidencias) / (bigA.length + bigB.length);
}

// "Casi al 100%" — ajusta este número si ves que rechaza catálogos que
// sí deberwere autoseleccionarse, o que acepta catálogos incorrectos.
const UMBRAL_SIMILITUD_CATALOGO = 0.6;
/**
 * Mapea el JSON que devuelve /ficha/ocr (mismo shape que ya usabas en
 * RegistrarOrdenModal: datosOcr + datosOcr.otros) a los campos del
 * formulario. Cada línea con "// SUPUESTO" es un mapeo que armé por
 * similitud de nombre/propósito — verifícalo contra tu ficha real.
 */
function mapOcrAFormulario(datosOcr: Record<string, unknown>, base: FormState): FormState {
  const otros = (datosOcr.otros as Record<string, unknown>) || {};
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

const productosOcr = (otros.productos as Array<Record<string, unknown>> | undefined) || [];
  const productosMapeados: ProductoVentaForm[] = productosOcr.map((p) => ({
    codigo: str(p.codigo),
    descripcion: str(p.descripcion),
    marca: str(p.marca),
    cantidad: Number(p.cantidad) || 1,
    isCompleted: false,
    // Solo se autorellena cuando hay 2+ productos (nr 1, nr 2...), que es
    // justo cuando la UI muestra el campo "Monto importe (ref. margen)".
    montoReferencia: productosOcr.length > 1 ? str(p.importe_pen).replace(/,/g, "") : "",
  }));

  const fechaMaxRaw = str(otros.fecha_max_entrega);

  return {
    ...base,
    cliente: base.cliente,
    unidadEjecutora: str(datosOcr.unidad_ejecutora) || base.unidadEjecutora,
    direccionEntrega: str(otros.direccion_entrega) || base.direccionEntrega,
    referenciaEntrega: str(otros.referencia_entrega) || base.referenciaEntrega,
    distritoEntrega: str(otros.distrito_entrega) || base.distritoEntrega,
    provinciaEntrega: str(otros.provincia_entrega) || base.provinciaEntrega,
    departamentoEntrega: str(otros.departamento_entrega) || base.departamentoEntrega,
    fechaForm: base.fechaForm, // siempre hoy, no viene del OCR
    fechaMaxForm: fechaMaxRaw ? ddmmyyyyAIso(fechaMaxRaw) : base.fechaMaxForm,
    montoVenta: str(datosOcr.monto).replace(/,/g, "") || base.montoVenta,
    siaf: str(datosOcr.expediente) || base.siaf,
    codigoOcf: str(otros.ruc_entidad) || base.codigoOcf,
    numeroOcam: str(otros.numero_ocam) || base.numeroOcam,
    productos: productosMapeados.length > 0 ? productosMapeados : base.productos,
  };
}



/**
 * Convierte una Venta ya creada en el ERP (la que llega de
 * ventaExistente, o la que se trae al clickear otra card del mismo
 * grupo) directo al FormState — sin pasar por OCR, porque estos datos
 * YA están confirmados en el ERP.
 */
function mapVentaAFormulario(venta: Venta): FormState {
  const v = venta as any;
  const base = formularioVacio();
  return {
    ...base,
    empresa: v.empresa ? { id: v.empresa.id, razonSocial: v.empresa.razonSocial, ruc: v.empresa.ruc } : base.empresa,
    cliente: v.cliente
      ? {
          id: v.cliente.id,
          razonSocial: v.cliente.razonSocial,
          ruc: v.cliente.ruc,
          departamento: v.cliente.departamento,
          provincia: v.cliente.provincia,
          distrito: v.cliente.distrito,
          sede: v.cliente.sede,
          codigoUnidad: v.cliente.codigoUnidad,
          direccion: v.cliente.direccion,
          promedioCobranza: v.cliente.promedioCobranza,
        }
      : null,
    contacto: v.contactoCliente
      ? {
          id: v.contactoCliente.id,
          nombre: v.contactoCliente.nombre,
          telefono: v.contactoCliente.telefono,
          cargo: v.contactoCliente.cargo,
        }
      : null,
    catalogoEmpresaId: v.catalogoEmpresa?.id ?? null,
    catalogoLabel: v.catalogoEmpresa ? `${v.catalogoEmpresa.nombre} - ${v.catalogoEmpresa.descripcion}` : "",
    direccionEntrega: v.direccionEntrega || "",
    distritoEntrega: v.distritoEntrega || "",
    provinciaEntrega: v.provinciaEntrega || "",
    departamentoEntrega: v.departamentoEntrega || "",
    referenciaEntrega: v.referenciaEntrega || "",
    unidadEjecutora: extraerCodigoUnidadEjecutora(v.cliente?.codigoUnidadEjecutora),
    fechaForm: String(v.fechaForm || base.fechaForm).slice(0, 10),
    fechaMaxForm: String(v.fechaMaxForm || base.fechaMaxForm).slice(0, 10),
    fechaEntrega: String(v.fechaEntrega || base.fechaEntrega).slice(0, 10),
    montoVenta: v.montoVenta != null ? String(v.montoVenta) : "",
    siaf: v.siaf || "",
    etapaSiaf: v.etapaSiaf || base.etapaSiaf,
    fechaSiaf: String(v.fechaSiaf || base.fechaSiaf).slice(0, 10),
    codigoOcf: v.codigoOcf || "",
    numeroOcam: v.numeroOcam || "",
    fuentesFinanciamiento: v.fuentesFinanciamiento || base.fuentesFinanciamiento,
    multipleFuentesFinanciamiento: !!v.multipleFuentesFinanciamiento,
    productos:
      Array.isArray(v.productos) && v.productos.length > 0
        ? v.productos.map((p: any) => ({
            codigo: p.codigo || "",
            descripcion: p.descripcion || "",
            marca: p.marca || "",
            cantidad: Number(p.cantidad) || 1,
            isCompleted: !!p.isCompleted,
            montoReferencia: "",
          }))
        : base.productos,
    ventaPrivada: !!v.ventaPrivada,
    estadoProgreso:
      String(v.estadoVenta || "").toUpperCase() === "COMPLETADO"
        ? "completo"
        : String(v.estadoVenta || "").toUpperCase() === "PENDIENTE"
          ? "en_proceso"
          : "creacion",
  };
}
// ============================================================
// Sub-componentes de campo (mismo estilo visual que ya usas)
// ============================================================
function Card({
  icon: Icon,
  title,
  children,
  headerExtra,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  headerExtra?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3.5">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-[#4F46E5]" />
          <h4 className="text-[13px] font-semibold text-slate-800">{title}</h4>
        </div>
        {headerExtra}
      </div>
      {children}
    </div>
  );
}
function Field({
  label,
  children,
  span = 1,
}: {
  label: string;
  children: React.ReactNode;
  span?: 1 | 2 | 3 | 4;
}) {
  const spanClass = { 1: "", 2: "sm:col-span-2", 3: "sm:col-span-3", 4: "sm:col-span-4" }[span];
  return (
    <div className={spanClass}>
      <label className="block text-[11px] font-medium text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30 focus:border-[#4F46E5]";

// ============================================================
// Loader de OCR + IA — versión "premium": anillo giratorio con
// degradado, icono que cambia de forma con cada etapa, halo pulsante
// y partículas flotando de fondo. El texto NUNCA menciona qué motor
// de IA se usa por debajo (Gemini, tokens, etc.) — eso es interno,
// el usuario solo debe ver magia funcionando.
//
// El backend hace OCR + IA en UNA sola llamada, pero la duración real
// varía. Este loader nunca miente llegando a 100% solo: avanza hasta
// ~92% y se queda ahí, esperando a que `activo` pase a false (la
// respuesta real ya llegó).
// ============================================================
const ETAPAS_OCR: { texto: string; Icono: React.ElementType }[] = [
  { texto: "Descargando el documento", Icono: FileScan },
  { texto: "Leyendo cada detalle del PDF", Icono: Search },
  { texto: "Detectando los productos", Icono: Sparkles },
  { texto: "Armando tu formulario", Icono: Package },
];

// Partículas de fondo con posiciones FIJAS (no Math.random()) — así no
// hay mismatch de hidratación entre servidor y cliente en Next.js.
const PARTICULAS_LOADER = [
  { left: 10, top: 20, size: 4, opacity: 0.6, duracion: 3.2, retraso: 0 },
  { left: 85, top: 15, size: 3, opacity: 0.5, duracion: 2.6, retraso: 0.4 },
  { left: 20, top: 75, size: 5, opacity: 0.4, duracion: 3.8, retraso: 0.8 },
  { left: 75, top: 80, size: 3, opacity: 0.55, duracion: 3.0, retraso: 0.2 },
  { left: 50, top: 10, size: 2.5, opacity: 0.45, duracion: 2.9, retraso: 1.1 },
  { left: 90, top: 55, size: 4, opacity: 0.35, duracion: 3.5, retraso: 0.6 },
  { left: 15, top: 45, size: 3, opacity: 0.5, duracion: 3.1, retraso: 1.4 },
];

function LoaderOcrProfesional({ activo }: { activo: boolean }) {
  const [etapaIdx, setEtapaIdx] = useState(0);
  const [progreso, setProgreso] = useState(0);

  useEffect(() => {
    if (!activo) {
      setEtapaIdx(0);
      setProgreso(0);
      return;
    }
    const intervaloEtapa = setInterval(() => {
      setEtapaIdx((i) => (i + 1) % ETAPAS_OCR.length);
    }, 1900);
    const intervaloProgreso = setInterval(() => {
      setProgreso((p) => (p < 92 ? p + (92 - p) * 0.06 : p));
    }, 180);
    return () => {
      clearInterval(intervaloEtapa);
      clearInterval(intervaloProgreso);
    };
  }, [activo]);

  const etapaActual = ETAPAS_OCR[etapaIdx];
  const IconoActual = etapaActual.Icono;

  return (
    <div className="relative bg-gradient-to-b from-[#0B1120] to-[#151E36] border border-slate-800 rounded-2xl px-6 py-16 flex flex-col items-center gap-7 overflow-hidden">
      {/* Partículas flotantes de fondo, puro ambiente "mágico" */}
      <div className="absolute inset-0 pointer-events-none">
        {PARTICULAS_LOADER.map((p, i) => (
          <span
            key={i}
            className="absolute rounded-full bg-[#818CF8]"
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: p.size,
              height: p.size,
              opacity: p.opacity,
              animation: `hb-flotar ${p.duracion}s ease-in-out ${p.retraso}s infinite`,
            }}
          />
        ))}
      </div>

      {/* Anillo giratorio con degradado + icono central que cambia por etapa */}
      <div className="relative w-28 h-28 flex items-center justify-center">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: "conic-gradient(from 0deg, #4F46E5, #818CF8, #C4B5FD, #4F46E5)",
            animation: "hb-girar 2.2s linear infinite",
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))",
          }}
        />
        <div className="absolute inset-[6px] rounded-full bg-[#0B1120] flex items-center justify-center">
          <div key={etapaIdx} className="hb-icono-aparece text-[#A5B4FC]">
            <IconoActual size={30} strokeWidth={1.75} />
          </div>
        </div>
        {/* Halo pulsante detrás del anillo */}
        <div
          className="absolute -inset-2 rounded-full opacity-40"
          style={{
            background: "radial-gradient(circle, rgba(129,140,248,0.35) 0%, transparent 70%)",
            animation: "hb-pulso-halo 1.8s ease-in-out infinite",
          }}
        />
      </div>

      <div className="text-center relative z-10">
        <p key={etapaIdx} className="text-sm font-semibold text-slate-100 hb-texto-aparece">
          {etapaActual.texto}
        </p>
        <p className="text-[11px] text-slate-500 mt-1.5">
          {Math.round(progreso)}% completado · esto puede tardar unos segundos
        </p>
      </div>

      {/* Barra de progreso fina con el mismo degradado del anillo */}
      <div className="relative z-10 w-48 h-1 rounded-full bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#4F46E5] via-[#818CF8] to-[#C4B5FD]"
          style={{ width: `${progreso}%`, transition: "width 0.25s ease-out" }}
        />
      </div>

      <style jsx>{`
        @keyframes hb-girar {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes hb-pulso-halo {
          0%, 100% { transform: scale(0.9); opacity: 0.25; }
          50% { transform: scale(1.15); opacity: 0.5; }
        }
        @keyframes hb-flotar {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-10px) scale(1.15); }
        }
        .hb-icono-aparece {
          animation: hb-icono-in 0.35s ease-out;
        }
        @keyframes hb-icono-in {
          from { opacity: 0; transform: scale(0.6) rotate(-15deg); }
          to { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        .hb-texto-aparece {
          animation: hb-texto-in 0.35s ease-out;
        }
        @keyframes hb-texto-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
// ============================================================
// Visor de documentos — pestañas OCE / OCF con iframe de PDF
// ============================================================
function VisorDocumentos({
  docActivo,
  onCambiarDoc,
  urlOce,
  urlOcf,
  nombreOce,
  nombreOcf,
  compacto = false,
}: {
  docActivo: "oce" | "ocf";
  onCambiarDoc: (d: "oce" | "ocf") => void;
  urlOce: string | null;
  urlOcf: string | null;
  nombreOce: string | null;
  nombreOcf: string | null;
  compacto?: boolean;
}) {
  const urlActiva = docActivo === "oce" ? urlOce : urlOcf;
  const nombreActivo = docActivo === "oce" ? nombreOce : nombreOcf;

  return (
    <div
      className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col"
      style={{ height: compacto ? 480 : "calc(100vh - 48px)" }}
    >
      <div className="flex items-center border-b border-slate-200 shrink-0">
        <button
          type="button"
          onClick={() => onCambiarDoc("oce")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition-colors ${
            docActivo === "oce"
              ? "text-[#4F46E5] border-b-2 border-[#4F46E5] bg-indigo-50/40"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <FileText size={13} /> OCE (OCAM)
        </button>
        <button
          type="button"
          onClick={() => onCambiarDoc("ocf")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition-colors ${
            docActivo === "ocf"
              ? "text-[#4F46E5] border-b-2 border-[#4F46E5] bg-indigo-50/40"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <FileText size={13} /> OCF (Física)
        </button>
      </div>

      {nombreActivo && (
        <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[11px] text-slate-500 truncate shrink-0">
          {nombreActivo}
        </div>
      )}

      <div className="flex-1 min-h-0 bg-slate-100">
        {urlActiva ? (
          <iframe
            src={`${urlActiva}#navpanes=0&toolbar=0&statusbar=0`}
            className="w-full h-full"
            title={docActivo === "oce" ? "Vista OCE" : "Vista OCF"}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-2 text-slate-400">
            <FileText size={22} />
            <p className="text-xs">
              Aún no hay {docActivo === "oce" ? "OCE" : "OCF"} cargado.
              <br />
              Sube un archivo o espera la carga automática.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Buscador de cliente (por razón social o RUC)
// ============================================================
function ClienteSearchField({
  value,
  onChange,
}: {
  value: ClienteOption | null;
  onChange: (c: ClienteOption) => void;
}) {
  const [query, setQuery] = useState(value?.razonSocial || "");
  const [opciones, setOpciones] = useState<ClienteOption[]>([]);


  const opcionesFiltradas = opciones.filter((c) => {
    const texto = query.trim().toLowerCase();

    return (
        c.razonSocial?.toLowerCase().includes(texto) ||
        c.ruc?.toLowerCase().includes(texto) ||
        c.departamento?.toLowerCase().includes(texto) ||
        c.provincia?.toLowerCase().includes(texto) ||
        c.distrito?.toLowerCase().includes(texto)
    );
    });
  const [abierto, setAbierto] = useState(false);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => setQuery(value?.razonSocial || ""), [value]);

useEffect(() => {
    if (!abierto) {
      setOpciones([]);
      return;
    }
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        // query vacío incluido a propósito: al hacer clic sin escribir
        // nada, también se listan opciones (igual que BuscadorEntidad
        // en OpsDrawer.tsx). Si buscarClientes("") no trae nada del
        // backend, revisa ese endpoint — debe soportar query vacío.
        setOpciones(await buscarClientes(query.trim()));
      } catch (e) {
        console.error("Error buscando clientes:", e);
        setOpciones([]);
      } finally {
        setBuscando(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query, abierto]);

  return (
    <div className="relative">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAbierto(true);
          }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          placeholder="Buscar cliente por razón social o RUC..."
          className={inputCls + " pr-9"}
        />
        <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
      </div>
        {abierto && (
        <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {buscando && (
            <div className="px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
              <Loader2 size={12} className="animate-spin" /> Buscando...
            </div>
          )}
            {!buscando && opcionesFiltradas.length === 0 && (
                <div className="px-3 py-2 text-xs text-slate-400">
                    Sin resultados
                </div>
            )}
          {opcionesFiltradas.map((c) => (
            <button
              key={c.id}
                onMouseDown={() => {
                    onChange(c);
                    setQuery(c.razonSocial);
                    setAbierto(false);
                }}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm"
            >
              <p className="font-medium text-slate-800">{c.razonSocial}</p>
              <p className="text-[11px] text-slate-400">RUC {c.ruc}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ContactoSearchField({
  clienteId,
  value,
  onChange,
  onCrearNuevo,
  recargarKey,
}: {
  clienteId: number | null;
  value: ContactoOption | null;
  onChange: (c: ContactoOption) => void;
  onCrearNuevo: () => void;
  recargarKey: number;
}) {
  const [opciones, setOpciones] = useState<ContactoOption[]>([]);
  const [cargando, setCargando] = useState(false);

useEffect(() => {
    if (!clienteId) {
      setOpciones([]);
      return;
    }
    setCargando(true);
    contactosDeCliente(clienteId)
      .then((lista) => {
        setOpciones(lista);
        // Si el cliente ya tiene contactos, selecciona el primero
        // automáticamente — así el campo nunca queda vacío si hay data.
        if (lista.length > 0) {
          onChange(lista[0]);
        }
      })
      .catch(() => setOpciones([]))
      .finally(() => setCargando(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteId, recargarKey]);

    return (
    <div className="grid grid-cols-[1fr_auto] gap-3">
      <select
        disabled={!clienteId || cargando}
        value={value?.id ?? ""}
        onChange={(e) => {
          const c = opciones.find((o) => o.id === Number(e.target.value));
          if (c) onChange(c);
        }}
        className={inputCls + " disabled:bg-slate-50 disabled:text-slate-400"}
      >
        <option value="">{cargando ? "Cargando contactos..." : "Selecciona un contacto"}</option>
        {opciones.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onCrearNuevo}
        disabled={!clienteId}
        title="Nuevo contacto"
        className="h-[38px] px-3 flex items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-500 hover:border-[#4F46E5] hover:text-[#4F46E5] disabled:opacity-40 transition-colors"
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

// Empresas que siempre se muestran como chip visible — el resto se
// oculta detrás de "Ver más" para no saturar el encabezado del modal.
const EMPRESAS_DESTACADAS = ["GRUPO ECOLIMP E.I.R.L.", "MULTILIMP S.A.C.", "ECOLIMP EMPRESARIAL E.I.R.L."];

function EmpresaSelect({
  value,
  onChange,
}: {
  value: EmpresaOption | null;
  onChange: (e: EmpresaOption) => void;
}) {
  const [opciones, setOpciones] = useState<EmpresaOption[]>([]);
  const [cargando, setCargando] = useState(true);
  const [verTodas, setVerTodas] = useState(false);

  useEffect(() => {
    listarEmpresas()
      .then(setOpciones)
      .catch((e) => {
        console.error("Error cargando empresas (revisa si es 401 -> token/sesión vencida):", e);
        setOpciones([]);
      })
      .finally(() => setCargando(false));
  }, []);

  const destacadas = opciones.filter((e) => EMPRESAS_DESTACADAS.includes(e.razonSocial.trim().toUpperCase()));
  const restantes = opciones.filter((e) => !EMPRESAS_DESTACADAS.includes(e.razonSocial.trim().toUpperCase()));
  // Respaldo: si por algún motivo ningún nombre calza exacto con las
  // destacadas (ej. cambió el texto en el ERP), muestra las primeras 3
  // igual, para no dejar el selector vacío.
  const listaDestacada = destacadas.length > 0 ? destacadas : opciones.slice(0, 3);
  const listaRestante = destacadas.length > 0 ? restantes : opciones.slice(3);

  if (cargando) {
    return <div className="text-xs text-slate-400 px-1 py-2">Cargando empresas...</div>;
  }

  const chip = (e: EmpresaOption) => {
    const activa = value?.id === e.id;
    return (
      <button
        key={e.id}
        type="button"
        onClick={() => onChange(e)}
        className={`text-xs font-semibold rounded-full px-3.5 py-2 border transition-colors ${
          activa
            ? "bg-[#4F46E5] border-[#4F46E5] text-white"
            : "bg-white/5 border-white/10 text-slate-200 hover:bg-white/10"
        }`}
      >
        {e.razonSocial}
      </button>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {listaDestacada.map(chip)}

      {!verTodas && listaRestante.length > 0 && (
        <button
          type="button"
          onClick={() => setVerTodas(true)}
          className="text-xs font-semibold text-[#818CF8] hover:text-white underline decoration-dotted"
        >
          Ver más ({listaRestante.length})
        </button>
      )}

      {verTodas && listaRestante.map(chip)}

      {verTodas && listaRestante.length > 0 && (
        <button
          type="button"
          onClick={() => setVerTodas(false)}
          className="text-xs font-semibold text-slate-400 hover:text-white underline decoration-dotted"
        >
          Ver menos
        </button>
      )}
    </div>
  );
}

function CatalogoSelect({
  empresaId,
  value,
  onChange,
}: {
  empresaId: number | null;
  value: number | null;
  onChange: (c: CatalogoOption) => void;
}) {
  const [opciones, setOpciones] = useState<CatalogoOption[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!empresaId) {
      setOpciones([]);
      return;
    }
    setCargando(true);
    catalogosDeEmpresa(empresaId)
      .then(setOpciones)
      .catch(() => setOpciones([]))
      .finally(() => setCargando(false));
  }, [empresaId]);

    return (
    <select
      disabled={!empresaId || cargando}
      value={value ?? ""}
      onChange={(e) => {
        const c = opciones.find((o) => o.id === Number(e.target.value));
        if (c) onChange(c);
      }}
      className={inputCls + " disabled:bg-slate-50 disabled:text-slate-400"}
    >
      <option value="">{cargando ? "Cargando catálogos..." : "Selecciona un catálogo"}</option>
      {opciones.map((c) => (
        <option key={c.id} value={c.id}>
          {c.nombre} - {c.descripcion}
        </option>
      ))}
    </select>
  );
}


// Catálogo estándar SIAF de Fuentes de Financiamiento del Perú.
// Confirmado por tu captura: 09 y 13 existen tal cual. Los otros 3
// códigos (00/18/19) son el resto del catálogo oficial del MEF — si tu
// ERP usa una lista distinta o recortada, ajusta este array.


const FUENTES_FINANCIAMIENTO_OPCIONES = [
  { codigo: "00", nombre: "RECURSOS ORDINARIOS" },
  { codigo: "04", nombre: "CONTRIBUCIONES A FONDOS" },
  { codigo: "07", nombre: "FONDO DE COMPENSACIÓN MUNICIPAL" },
  { codigo: "08", nombre: "IMPUESTOS MUNICIPALES" },
  { codigo: "09", nombre: "RECURSOS DIRECTAMENTE RECAUDADOS" },
  { codigo: "13", nombre: "DONACIONES Y TRANSFERENCIAS" },
  { codigo: "15", nombre: "FONDO DE COMPENSACIÓN REGIONAL" },
  { codigo: "18", nombre: "CANON Y SOBRECANON, REGALÍAS, RENTA DE ADUANAS Y PARTICIPACIONES" },
  { codigo: "19", nombre: "RECURSOS POR OPERACIONES OFICIALES DE CRÉDITO" },
];


// Dropdown compacto con checkboxes para elegir 1 o varias fuentes de
// financiamiento — botón muestra "código" si hay una sola seleccionada,
// o "código +N ..." si hay varias, igual que en tu boceto.
function FuenteFinanciamientoSelect({
  value,
  onChange,
}: {
  value: string; // códigos separados por coma, ej. "09,13"
  onChange: (codigos: string[]) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const seleccionados = value ? value.split(",").filter(Boolean) : [];

  useEffect(() => {
    const cerrarSiClickFuera = (e: MouseEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false);
      }
    };
    document.addEventListener("mousedown", cerrarSiClickFuera);
    return () => document.removeEventListener("mousedown", cerrarSiClickFuera);
  }, []);

  const alternar = (codigo: string) => {
    const nuevo = seleccionados.includes(codigo)
      ? seleccionados.filter((c) => c !== codigo)
      : [...seleccionados, codigo];
    onChange(nuevo);
  };

  const etiqueta =
    seleccionados.length === 0
      ? "Selecciona..."
      : seleccionados.length === 1
      ? seleccionados[0]
      : `${seleccionados[0]} +${seleccionados.length - 1} ...`;

  return (
    <div ref={contenedorRef} className="relative">
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        className="flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:border-[#4F46E5] transition-colors"
      >
        {etiqueta}
        <ChevronRight size={12} className={`text-slate-400 transition-transform ${abierto ? "rotate-90" : ""}`} />
      </button>

      {abierto && (
        <div className="absolute z-30 right-0 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-64 overflow-y-auto">
          {FUENTES_FINANCIAMIENTO_OPCIONES.map((f) => {
            const marcado = seleccionados.includes(f.codigo);
            return (
              <label
                key={f.codigo}
                className="flex items-start gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <input type="checkbox" checked={marcado} onChange={() => alternar(f.codigo)} className="mt-0.5" />
                <span>
                  <span className="font-semibold">{f.codigo}</span> - {f.nombre}
                </span>
              </label>
            );
          })}
          {seleccionados.length > 1 && (
            <p className="px-3 pt-2 mt-1 border-t border-slate-100 text-[10px] text-slate-400">
              {seleccionados.length} fuentes seleccionadas — se guardará como múltiples fuentes de financiamiento.
            </p>
          )}
        </div>
      )}
    </div>
  );
}





// "Grupo activo" recordado entre creaciones seguidas de órdenes — así
// el usuario elige el grupo UNA vez y las siguientes órdenes que cree
// (en otra publicada, otro modal) ya vienen precargadas con el mismo
// grupo, sin tener que volver a buscarlo cada vez.
const GRUPO_ACTIVO_STORAGE_KEY = "helbot_grupo_activo";

interface GrupoActivoGuardado {
  id: number;
  codigoGrupo: string;
}

function leerGrupoActivo(): GrupoActivoGuardado | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(GRUPO_ACTIVO_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function guardarGrupoActivo(g: GrupoActivoGuardado | null) {
  if (typeof window === "undefined") return;
  if (g) sessionStorage.setItem(GRUPO_ACTIVO_STORAGE_KEY, JSON.stringify(g));
  else sessionStorage.removeItem(GRUPO_ACTIVO_STORAGE_KEY);
}


// ============================================================
// Componente principal
// ============================================================
interface CrearOrdenModalProps {
  /** Solo en modo "ocr" — card de Perú Compras sin venta en el ERP todavía. */
  publicada?: Publicada;
  /** Solo en modo "existente" — card de una venta YA creada en el ERP, solo para ver/editar. */
  ventaExistente?: Venta;
  /** Solo en modo "existente" — el N_OrdenCompra REAL de Perú Compras (no el id
   * de la venta del ERP) para poder reintentar traer el OCF si el ERP no lo tiene. */
  nOrdenCompra?: number;
  onClose?: () => void;
  onGuardado?: (venta: Venta) => void;

  /** Permite usar los botones de Seguimiento y MEF. */
  esSeguimiento?: boolean;

  /** Permite usar los botones como administrador. */
  esAdmin?: boolean;
}

type ModoCrearOrden = "ocr" | "existente" | "blank";

export default function CrearOrdenModal({
    publicada,
    ventaExistente,
    nOrdenCompra,
    onClose,
    onGuardado,
    esSeguimiento = false,
    esAdmin = false,
  }: CrearOrdenModalProps) {
  const modo: ModoCrearOrden = ventaExistente ? "existente" : publicada ? "ocr" : "blank";

  const [form, setForm] = useState<FormState>(() =>
    modo === "existente" && ventaExistente ? mapVentaAFormulario(ventaExistente) : formularioVacio()
  );
  const [ventaGuardada, setVentaGuardada] = useState<Venta | null>(ventaExistente ?? null);

  // Se incrementa cada vez que se limpia el formulario para una orden
  // nueva en blanco. Usarlo como `key` en el bloque del formulario
  // fuerza a React a DESTRUIR y volver a MONTAR todos los inputs desde
  // cero — así ningún campo puede quedar "pegado" con un valor viejo,
  // sin importar el motivo (controlado, no controlado, ref suelto, etc).
  const [formInstanceKey, setFormInstanceKey] = useState(0);

  const [cargandoOcr, setCargandoOcr] = useState(modo === "ocr");
  const [errorOcr, setErrorOcr] = useState("");



  const [fuenteProductosOcr, setFuenteProductosOcr] = useState<"gemini" | "regex_fallback" | null>(null);
  const [tokensGroqOcr, setTokensGroqOcr] = useState<{ prompt: number | null; completion: number | null; total: number | null } | null>(null);
  const idPeticionOcrRef = useRef(0);


  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState("");

// Visor de documentos (OCE = PDF OCAM, OCF = Orden Física)
  const [archivoOce, setArchivoOce] = useState<File | null>(null);
  const [archivoOcf, setArchivoOcf] = useState<File | null>(null);
  const [urlOce, setUrlOce] = useState<string | null>(null);
  const [urlOcf, setUrlOcf] = useState<string | null>(null);
  const [docActivo, setDocActivo] = useState<"oce" | "ocf">("oce");

  // Cuando la venta YA está guardada en el ERP sin OCF (porque al
  // crearla, Perú Compras todavía no tenía el archivo físico listo en
  // Azure), y luego SÍ lo encontramos con los reintentos, no lo
  // guardamos solo — avisamos al usuario y esperamos su confirmación
  // para subirlo al ERP y actualizar la venta.
  const [ocfPendienteDeActualizar, setOcfPendienteDeActualizar] = useState(false);
  const [actualizandoOcf, setActualizandoOcf] = useState(false);
  const [errorActualizarOcf, setErrorActualizarOcf] = useState("");

// Panel lateral (Agrupar OC) — colapsable con jalador. Cerrado por
  // defecto, independientemente de si la orden ya se guardó o no.
  const [sidebarAbierto, setSidebarAbierto] = useState(false);
  // Cantidad de órdenes ya agrupadas, para mostrarla como badge en el
  // botón de "mostrar panel" cuando está cerrado. Se actualiza desde
  // AgruparOrdenPanel — ver nota más abajo sobre cómo conectarlo.
  const [cantidadAgrupadas, setCantidadAgrupadas] = useState(0);

  // Toast de campos faltantes — lista clickeable con scroll + parpadeo
  const [camposFaltantes, setCamposFaltantes] = useState<CampoFaltante[]>([]);
  const [campoResaltado, setCampoResaltado] = useState<string | null>(null);
  const refsCampos = useRef<Record<string, HTMLDivElement | null>>({});






// ---- Agrupación de la orden (nuevo, sustituye el flujo de 2 pasos) ----
  type ModoAgrupacion = "individual" | "nueva" | "existente";
  const [modoAgrupacion, setModoAgrupacion] = useState<ModoAgrupacion>("individual");
  const [codigoGrupoNuevo, setCodigoGrupoNuevo] = useState("");
  const [descripcionGrupoNuevo, setDescripcionGrupoNuevo] = useState("");
  const [gruposExistentes, setGruposExistentes] = useState<AgrupacionListItem[]>([]);
  const [grupoExistenteId, setGrupoExistenteId] = useState<number | null>(null);
  const [cargandoGrupos, setCargandoGrupos] = useState(false);
  const [aplicandoGrupo, setAplicandoGrupo] = useState(false);
  const [errorGrupo, setErrorGrupo] = useState("");
  const [grupoAplicado, setGrupoAplicado] = useState<GrupoActivoGuardado | null>(null);
  const [grupoDetalle, setGrupoDetalle] = useState<AgrupacionOC | null>(null);
  const [cargandoGrupoDetalle, setCargandoGrupoDetalle] = useState(false);

// Al montar: si hay un "grupo activo" recordado de la última orden
  // creada, precarga el selector en "existente" con ese grupo — pero
  // SOLO en el flujo de crear una orden desde una publicada (modo
  // "ocr"), que es donde tiene sentido encadenar varias OCs seguidas al
  // mismo grupo. En "Crear orden" en blanco y al abrir una venta ya
  // existente, el selector siempre parte en "Orden individual".
  useEffect(() => {
    if (modo !== "ocr") return;
    const activo = leerGrupoActivo();
    if (activo) {
      setModoAgrupacion("existente");
      setGrupoExistenteId(activo.id);
    }
  }, [modo]);
// Carga la lista real de grupos cuando el usuario elige "existente"
  // (o ya venía precargada desde el grupo activo recordado).
  useEffect(() => {
    if (modoAgrupacion !== "existente") return;
    setCargandoGrupos(true);
    listarAgrupaciones()
      .then(setGruposExistentes)
      .catch(() => setGruposExistentes([]))
      .finally(() => setCargandoGrupos(false));
  }, [modoAgrupacion]);

  // Apenas el usuario selecciona un grupo del dropdown (o cambia de
  // grupo), trae y muestra de inmediato TODAS las órdenes que ya
  // pertenecen a ese grupo — sin esperar a que guarde nada todavía.
  useEffect(() => {
    if (modoAgrupacion !== "existente" || !grupoExistenteId) {
      return;
    }
    let cancelado = false;
    setCargandoGrupoDetalle(true);
    agrupacionPorId(grupoExistenteId)
      .then((detalle) => {
        if (cancelado) return;
        setGrupoDetalle(detalle);
        if (detalle) setCantidadAgrupadas(detalle.ordenesCompra.length);
      })
      .finally(() => {
        if (!cancelado) setCargandoGrupoDetalle(false);
      });
    return () => {
      cancelado = true;
    };
  }, [modoAgrupacion, grupoExistenteId]);

  // Trae el detalle completo del grupo (TODAS las órdenes que ya
  // pertenecen a él) para pintarlo en el panel lateral. Se llama justo
  // después de guardar/agrupar la orden actual.
const cargarGrupoDetalle = useCallback(async (ordenCompraId: number) => {
    setCargandoGrupoDetalle(true);
    try {
      const detalle = await agrupacionPorOrdenCompra(ordenCompraId);
      setGrupoDetalle(detalle);
      if (detalle) {
        // Esta orden SÍ pertenece a un grupo -> la barra debe reflejarlo
        // seleccionando "Grupo existente" con ese grupo ya elegido, en
        // vez de quedarse en "Orden individual" por defecto. Aplica
        // tanto al abrir una card ya existente (ERP o Publicadas) como
        // al cambiar de OC dentro del mismo grupo.
        setCantidadAgrupadas(detalle.ordenesCompra.length);
        setModoAgrupacion("existente");
        setGrupoExistenteId(detalle.id);
        setGrupoAplicado({ id: detalle.id, codigoGrupo: detalle.codigoGrupo });
      } else {
        // No pertenece a ningún grupo -> "Orden individual" por defecto.
        setCantidadAgrupadas(0);
        setModoAgrupacion("individual");
        setGrupoExistenteId(null);
        setGrupoAplicado(null);
      }
    } finally {
      setCargandoGrupoDetalle(false);
    }
  }, []);



// Trae los "Monto importe (ref. margen)" guardados aparte en MySQL
// (nunca viajan en el payload al ERP, por eso hay que pedirlos por
// separado con obtenerMontosReferenciaProductos) y los fusiona por
// código dentro de form.productos. Sin esto, montoReferencia siempre
// queda en "" al recargar una venta ya guardada.
const cargarMontosReferencia = useCallback(async (ordenCompraId: number) => {
    try {
      const montos = await obtenerMontosReferenciaProductos(ordenCompraId);
      if (!montos || montos.length === 0) return;
      setForm((f) => ({
        ...f,
        productos: f.productos.map((p) => {
          const match = montos.find((m) => m.codigo === p.codigo);
          return match && match.monto_referencia != null
            ? { ...p, montoReferencia: String(match.monto_referencia) }
            : p;
        }),
      }));
    } catch (e) {
      console.warn(`No se pudieron cargar los montos de referencia de orden ${ordenCompraId}:`, e);
    }
  }, []);



  // Click en OTRA card de "Órdenes en esta agrupación" — trae esa venta
  // completa del ERP y la vuelca en el MISMO formulario, remontando los
  // inputs (mismo truco que iniciarOrdenEnBlanco), para saltar entre las
  // OCs de un grupo sin cerrar el modal.
  const [cargandoOtraVenta, setCargandoOtraVenta] = useState(false);
 const cargarOtraVentaDelGrupo = async (ordenCompraId: number) => {
    if (ordenCompraId === ventaGuardada?.id) return;
    setCargandoOtraVenta(true);
    setErrorGuardar("");
    try {
      const venta = await obtenerVenta(ordenCompraId);
      setForm(mapVentaAFormulario(venta));
      setVentaGuardada(venta);
      setFormInstanceKey((k) => k + 1);

      // Refresca el visor con los documentos de ESTA otra orden del
      // grupo — si no tiene, se limpia para no dejar pegado el PDF de
      // la orden anterior.
      const v = venta as any;
      setUrlOce(v.documentoOce || null);
      setUrlOcf(v.documentoOcf || null);
      setArchivoOce(null);
      setArchivoOcf(null);
      setDocActivo(v.documentoOce ? "oce" : "ocf");

      await cargarGrupoDetalle(venta.id);
      await cargarMontosReferencia(venta.id);
    } catch (e) {
      setErrorGuardar(e instanceof Error ? e.message : "No se pudo cargar esa orden del grupo");
    } finally {
      setCargandoOtraVenta(false);
    }
  };
  const [modalContactoAbierto, setModalContactoAbierto] = useState(false);
  const [contactosRecargarKey, setContactosRecargarKey] = useState(0);
  const [nuevoContacto, setNuevoContacto] = useState<ContactoCreatePayload>({ nombre: "", cargo: "", telefono: "", email: "" });
  const [guardandoContacto, setGuardandoContacto] = useState(false);
  const [errorContacto, setErrorContacto] = useState("");

  const guardarNuevoContacto = async () => {
    if (!form.cliente || !nuevoContacto.nombre.trim()) return;
    setGuardandoContacto(true);
    setErrorContacto("");
    try {
      const creado = await crearContacto(form.cliente.id, nuevoContacto);
      set("contacto", { id: creado.id, nombre: creado.nombre, telefono: creado.telefono, cargo: creado.cargo });
      setContactosRecargarKey((k) => k + 1);
      setModalContactoAbierto(false);
      setNuevoContacto({ nombre: "", cargo: "", telefono: "", email: "" });
    } catch (e) {
      setErrorContacto(e instanceof Error ? e.message : "No se pudo crear el contacto");
    } finally {
      setGuardandoContacto(false);
    }
  };





const aplicarAgrupacion = async (ordenCompraId: number) => {
    if (modoAgrupacion === "individual") {
      guardarGrupoActivo(null); // el usuario cortó la racha de agrupar
      setGrupoDetalle(null);
      setGrupoAplicado(null);
      setCantidadAgrupadas(0);
      return;
    }
    setAplicandoGrupo(true);
    setErrorGrupo("");
    try {
      if (modoAgrupacion === "nueva") {
        if (!codigoGrupoNuevo.trim()) throw new Error("Ingresa un código para el grupo");
        const agrupacion = await crearAgrupacion({
          codigoGrupo: codigoGrupoNuevo.trim(),
          descripcion: descripcionGrupoNuevo.trim() || null,
          fecha: new Date().toISOString(),
          ordenesCompraIds: [ordenCompraId],
        });
        const nuevo = { id: agrupacion.id, codigoGrupo: agrupacion.codigoGrupo };
        setGrupoAplicado(nuevo);
        guardarGrupoActivo(nuevo);
        // Limpia el formulario de "nuevo grupo" — ya cumplió su función,
        // y así no queda texto viejo si el usuario abre el sidebar de nuevo.
        setCodigoGrupoNuevo("");
        setDescripcionGrupoNuevo("");
        // Cambia a "existente" apuntando al grupo recién creado, para
        // que la SIGUIENTE orden ya se sume a este mismo grupo directo.
        setModoAgrupacion("existente");
        setGrupoExistenteId(nuevo.id);
      } else {
        if (!grupoExistenteId) throw new Error("Selecciona un grupo");
        const grupo = gruposExistentes.find((g) => g.id === grupoExistenteId);
        if (!grupo) throw new Error("Grupo no encontrado");
        // Grupo YA existente → se agrega la orden a él, NO se crea uno
        // nuevo con el mismo código (eso era el 409 Conflict).
        const agrupacion = await agregarOrdenAAgrupacion(grupo.id, ordenCompraId);
        const activo = { id: agrupacion.id ?? grupo.id, codigoGrupo: agrupacion.codigoGrupo ?? grupo.codigoGrupo };
        setGrupoAplicado(activo);
        guardarGrupoActivo(activo);
      }
      // Éxito (nueva o existente): abre el sidebar para que el usuario
      // SIEMPRE vea la confirmación "✓ Agrupada en..." y el panel con
      // las órdenes del grupo — sin esto, el sidebar cerrado por
      // defecto hacía parecer que no había pasado nada.
      setSidebarAbierto(true);
    } catch (e) {
      setErrorGrupo(e instanceof Error ? e.message : "No se pudo agrupar la orden");
      setSidebarAbierto(true); // si falla, abre el panel para que el error sea visible
    } finally {
      setAplicandoGrupo(false);
    }
  };

const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Limpia TODO el modal para empezar una orden nueva desde cero,
  // manual — sin arrastrar el código, cliente, productos ni nada de
  // la venta que se acaba de guardar.
const iniciarOrdenEnBlanco = () => {
    setForm(formularioVacio());
    setVentaGuardada(null);
    setErrorGuardar("");
    setCamposFaltantes([]);
    setCampoResaltado(null);
    setFuenteProductosOcr(null);
    setTokensGroqOcr(null);

    // Documentos (OCE/OCF) — se limpian porque ya no corresponden a
    // esta nueva orden manual.
    if (urlOce) URL.revokeObjectURL(urlOce);
    if (urlOcf) URL.revokeObjectURL(urlOcf);
    setArchivoOce(null);
    setArchivoOcf(null);
    setUrlOce(null);
    setUrlOcf(null);
    setDocActivo("oce");

    // Agrupación — si la orden que se acaba de guardar quedó agrupada
    // (ya sea porque recién se creó un grupo nuevo, o se sumó a uno
    // existente), la SIGUIENTE orden en blanco continúa apuntando a ESE
    // MISMO grupo en modo "Grupo existente" — así encadenas varias
    // órdenes al mismo grupo sin volver a buscarlo cada vez. Si la
    // orden anterior era "individual" (sin grupo), la siguiente
    // también parte en "individual".
    if (grupoAplicado) {
      setModoAgrupacion("existente");
      setGrupoExistenteId(grupoAplicado.id);
      // grupoDetalle y grupoAplicado se conservan tal cual — ya están
      // al día porque guardar() llamó a cargarGrupoDetalle() justo
      // después de crear la orden anterior.
    } else {
      setModoAgrupacion("individual");
      setGrupoExistenteId(null);
      setGrupoDetalle(null);
      setCantidadAgrupadas(0);
    }
    setCodigoGrupoNuevo("");
    setDescripcionGrupoNuevo("");
    setErrorGrupo("");

    // Fuerza el remontaje completo de todos los inputs del formulario
    // — garantiza que campos como N° OCAM, SIAF, etc. queden 100%
    // en blanco visualmente, sin excepción.
    setFormInstanceKey((k) => k + 1);
  };

  // Revisa qué campos están vacíos (cliente, contacto, catálogo, monto y,
  // por producto, descripción y marca). Se usa para armar el toast con
  // enlaces directos a cada campo.
// Se recalcula automáticamente cada vez que cambia cualquier campo del
  // formulario — cubre TODO: cliente, contacto, catálogo, lugar de
  // entrega, datos generales y cada producto.
  const camposFaltantesCalculados = useMemo((): CampoFaltante[] => {
    const faltantes: CampoFaltante[] = [];

    if (!form.cliente) faltantes.push({ id: "campo-cliente", label: "Cliente" });
    if (!form.contacto) faltantes.push({ id: "campo-contacto", label: "Contacto" });
    if (!form.catalogoEmpresaId) faltantes.push({ id: "campo-catalogo", label: "Catálogo" });

    if (!form.direccionEntrega.trim()) faltantes.push({ id: "campo-direccion", label: "Dirección de entrega" });
    if (!form.distritoEntrega.trim()) faltantes.push({ id: "campo-distrito", label: "Distrito de entrega" });
    if (!form.provinciaEntrega.trim()) faltantes.push({ id: "campo-provincia", label: "Provincia de entrega" });
    if (!form.departamentoEntrega.trim()) faltantes.push({ id: "campo-departamento", label: "Departamento de entrega" });
    if (!form.referenciaEntrega.trim()) faltantes.push({ id: "campo-referencia", label: "Referencia de entrega" });

    if (!(Number(form.montoVenta) > 0)) faltantes.push({ id: "campo-monto", label: "Monto de venta" });
    // Número de SIAF y Fecha de SIAF ahora son OPCIONALES — dejarlos en
    // blanco ya NO bloquea "Guardar Datos". Cuando no hay SIAF, la
    // Etapa SIAF se muestra automáticamente como "SIN SIAF" (ver el
    // <select> de Etapa SIAF más abajo).
    if (!form.codigoOcf.trim()) faltantes.push({ id: "campo-ocf", label: "OCF (RUC comprador)" });
    if (!form.numeroOcam.trim()) faltantes.push({ id: "campo-ocam", label: "N° OCAM" });
    form.productos.forEach((p, idx) => {
      if (!p.codigo.trim()) faltantes.push({ id: `campo-producto-${idx}-codigo`, label: `Producto ${idx + 1} — Código` });
      if (!p.descripcion.trim()) faltantes.push({ id: `campo-producto-${idx}-descripcion`, label: `Producto ${idx + 1} — Descripción` });
      if (!p.marca.trim()) faltantes.push({ id: `campo-producto-${idx}-marca`, label: `Producto ${idx + 1} — Marca` });
      if (!(p.cantidad > 0)) faltantes.push({ id: `campo-producto-${idx}-cantidad`, label: `Producto ${idx + 1} — Cantidad` });
    });

    return faltantes;
  }, [form]);

  // Muestra el toast solo, sin que el usuario tenga que hacer click en
  // "Guardar Datos". Espera a que termine el OCR para no mostrar el
  // toast mientras el formulario todavía se está pre-llenando.
  useEffect(() => {
    if (cargandoOcr) return;
    setCamposFaltantes(camposFaltantesCalculados);
  }, [camposFaltantesCalculados, cargandoOcr]);

  // Scroll hasta el campo y lo deja parpadeando en rojo unos segundos.
  const irACampo = (id: string) => {
    const el = refsCampos.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setCampoResaltado(id);
    setTimeout(() => setCampoResaltado((actual) => (actual === id ? null : actual)), 2600);
  };

  // 1) Descarga el PDF + corre el OCR (idéntico a RegistrarOrdenModal.tsx)
  //    y con eso resuelve también el cliente por RUC.
  const correrOcr = useCallback(async () => {
    if (!publicada) return;
    const miId = ++idPeticionOcrRef.current;
    setCargandoOcr(true);
    setErrorOcr("");
    try {
      const rPdf = await fetchConToken(`${API_BASE}/publicadas/${publicada.N_OrdenCompra}/pdf`);
      if (!rPdf.ok) throw new Error("No se pudo descargar el PDF de la orden");
      const blobPdf = await rPdf.blob();

      const fd = new FormData();
      fd.append("archivo", blobPdf, `${publicada.C_OrdenCompra}.pdf`);
      fd.append("publicada_id", publicada.C_OrdenCompra);

      const rOcr = await fetchConToken(`${API_BASE}/ficha/ocr`, { method: "POST", body: fd });
      if (!rOcr.ok) {
        const body = await rOcr.json().catch(() => ({}));
        throw new Error(body.detail || "No se pudo aplicar el OCR");
      }
      const data = await rOcr.json();
      if (idPeticionOcrRef.current !== miId) return; // respuesta obsoleta, se ignora
      const datosOcr = data.datos as Record<string, unknown>;
      setFuenteProductosOcr(data.fuente_productos ?? null);
      setTokensGroqOcr(data.tokens_groq ?? null);

      setForm((f) => mapOcrAFormulario(datosOcr, f));
      // Intentar auto-seleccionar el catálogo comparando el texto del
      // OCR (ej. "EXT-CE-2024-18 CEREALES, ACEITE...") contra la lista
      // real de catálogos de la empresa.
    const textoCatalogoOcr = String((datosOcr.otros as Record<string, unknown> | undefined)?.catalogo || "");
      if (textoCatalogoOcr) {
        try {
          const catalogos = await catalogosDeEmpresa(5); // TODO: usar form.empresa.id si cambia de empresa

          let mejor: CatalogoOption | null = null;
          let mejorScore = 0;
          for (const c of catalogos) {
            // Comparamos por separado: solo nombre (ej. "EXT-CE-2024-3"),
            // solo descripción (ej. "MATERIALES E INSUMOS DE LIMPIEZA"),
            // y el concatenado — y nos quedamos con el MEJOR de los tres.
            // Esto evita que texto extra en la descripción del ERP (que
            // el OCR no trae) arruine el puntaje total.
            const scoreNombre = similitudDice(textoCatalogoOcr, c.nombre);
            const scoreDescripcion = similitudDice(textoCatalogoOcr, c.descripcion);
            const scoreConcatenado = similitudDice(textoCatalogoOcr, `${c.nombre} ${c.descripcion}`);
            const score = Math.max(scoreNombre, scoreDescripcion, scoreConcatenado);

            // Log temporal — revisa la consola del navegador para ver
            // qué puntaje saca cada catálogo y ajustar el umbral si hace
            // falta. Bórralo cuando ya confirmes que funciona bien.
            console.log(
              `[catálogo] "${c.nombre} - ${c.descripcion}" → score ${score.toFixed(2)}`
            );

            if (score > mejorScore) {
              mejorScore = score;
              mejor = c;
            }
          }

          if (mejor && mejorScore >= UMBRAL_SIMILITUD_CATALOGO) {
            set("catalogoEmpresaId", mejor.id);
            set("catalogoLabel", `${mejor.nombre} - ${mejor.descripcion}`);
          }
          // Si ningún catálogo supera el umbral, no se selecciona nada
          // — el usuario elige manualmente en el <select>.
        } catch (e) {
          // si falla, el usuario elige el catálogo a mano — pero
          // logueamos para saber SI fue un 401 (token vencido) o un
          // error real de datos.
          console.error("Error auto-seleccionando catálogo (revisa si es 401):", e);
        }
      }

      // Resolver cliente por RUC de la entidad detectada en el OCR
    // Resolver cliente por RUC de la entidad detectada en el OCR
    // Resolver cliente por RUC de la entidad detectada en el OCR
      const rucEntidad = String((datosOcr.otros as Record<string, unknown> | undefined)?.ruc_entidad || "");
      if (rucEntidad) {
        try {
          const candidatos = await buscarClientes(rucEntidad);
          const match = candidatos.find((c) => c.ruc === rucEntidad) || candidatos[0];
            if (match) {
            set("cliente", match);
            set("departamentoEntrega", match.departamento || "");
            set("provinciaEntrega", match.provincia || "");
            set("distritoEntrega", match.distrito || "");
            // El OCR ya pudo haber traído su propia unidadEjecutora del
            // PDF (mapOcrAFormulario corre ANTES que esto) — solo se
            // completa con la del cliente si el OCR no trajo ninguna.
            setForm((f) => (f.unidadEjecutora ? f : { ...f, unidadEjecutora: extraerCodigoUnidadEjecutora(match.codigoUnidadEjecutora) }));
          }
        } catch (e) {
          // si falla la búsqueda, el usuario elige el cliente a mano abajo
          // — pero logueamos para saber SI fue un 401 (token vencido).
          console.error("Error auto-seleccionando cliente por RUC (revisa si es 401):", e);
        }
      }
      } catch (e) {
      if (idPeticionOcrRef.current !== miId) return;
      setErrorOcr(e instanceof Error ? e.message : "Error desconocido procesando el OCR");
    } finally {
      if (idPeticionOcrRef.current === miId) setCargandoOcr(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicada]);

// Descarga el PDF OCAM (OCE) y la Orden Física (OCF) de la publicada y
  // los deja precargados en el visor y en los campos de subida — el
  // usuario solo los reemplaza si de verdad necesita subir otro archivo.
const cargarDocumentosBase = useCallback(async () => {
    if (!publicada) return;

    // OCE (PDF OCAM) — normalmente disponible al instante, un solo
    // intento basta.
    try {
      const rOcam = await fetchConToken(`${API_BASE}/publicadas/${publicada.N_OrdenCompra}/pdf`);
      if (rOcam.ok) {
        const blob = await rOcam.blob();
        const archivo = new File([blob], `${publicada.C_OrdenCompra}-OCE.pdf`, { type: "application/pdf" });
        setArchivoOce(archivo);
        setUrlOce(URL.createObjectURL(archivo));
      }
    } catch {
      // si falla, el usuario sube el OCE a mano
    }

    // OCF (Orden Física) — Perú Compras puede tardar unos segundos en
    // dejar el PDF físico disponible en Azure recién publicada la
    // orden. Sin reintentos, un solo fallo momentáneo dejaba el campo
    // vacío para siempre (el catch lo tragaba en silencio). Usamos el
    // mismo patrón de reintentos que ya funciona en abrirPdfFisica().
    const INTENTOS_OCF = 6;
    const ESPERA_MS_OCF = 4000;

    for (let intento = 1; intento <= INTENTOS_OCF; intento++) {
      try {
        const rFisica = await fetchConToken(`${API_BASE}/publicadas/${publicada.N_OrdenCompra}/pdf-fisica`);
        if (rFisica.ok) {
          const blob = await rFisica.blob();
          const archivo = new File([blob], `${publicada.C_OrdenCompra}-OCF.pdf`, { type: "application/pdf" });
          setArchivoOcf(archivo);
          setUrlOcf(URL.createObjectURL(archivo));
          break; // éxito -> sale del loop de reintentos
        }
        // 404 puede ser transitorio (archivo aún subiendo a Azure) —
        // se reintenta salvo que sea el último intento.
        if (intento === INTENTOS_OCF) {
          console.warn(`No se pudo cargar el OCF tras ${INTENTOS_OCF} intentos — el usuario puede subirlo a mano.`);
          break;
        }
      } catch {
        if (intento === INTENTOS_OCF) break;
        // si falla, el usuario sube el OCF a mano tras agotar los intentos
      }
      await new Promise((res) => setTimeout(res, ESPERA_MS_OCF));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicada]);

 const handleSubirOce = (archivo: File) => {
    if (urlOce) URL.revokeObjectURL(urlOce);
    setArchivoOce(archivo);
    setUrlOce(URL.createObjectURL(archivo));
    setDocActivo("oce");
    // Si el N° OCAM todavía está vacío (nadie lo escribió a mano ni vino
    // de un OCR previo), se autocompleta con el nombre del archivo
    // subido, sin la extensión (.pdf, .jpg, etc).
    if (!form.numeroOcam.trim()) {
      set("numeroOcam", nombreSinExtension(archivo.name));
    }
  };

const handleSubirOcf = (archivo: File) => {
    if (urlOcf) URL.revokeObjectURL(urlOcf);
    setArchivoOcf(archivo);
    setUrlOcf(URL.createObjectURL(archivo));
    setDocActivo("ocf");
  };

  // El usuario confirma en el banner que sí quiere actualizar la venta
  // con el OCF que recién se encontró automáticamente (se había
  // guardado sin él porque Perú Compras aún no lo tenía listo en Azure
  // al momento de crear la orden).
const confirmarActualizarOcf = async () => {
    if (!archivoOcf || !ventaGuardada) return;
    if (!form.empresa || !form.cliente || !form.contacto || !form.catalogoEmpresaId) {
      setErrorActualizarOcf("Faltan datos del formulario (cliente/contacto/catálogo) para poder guardar.");
      return;
    }
    setActualizandoOcf(true);
    setErrorActualizarOcf("");
    try {
      const url = await subirDocumento(archivoOcf, "OCF");

      // El backend exige el body COMPLETO en el PUT — mandar solo
      // { documentoOcf: url } daba 422 "Field required" en el resto de
      // campos. Se arma el mismo payload que usa guardar().
      const payload: VentaCreatePayload = {
        empresa: { connect: { id: form.empresa.id } },
        cliente: { connect: { id: form.cliente.id } },
        contactoCliente: { connect: { id: form.contacto.id } },
        catalogoEmpresa: { connect: { id: form.catalogoEmpresaId } },
        codigoOcf: form.codigoOcf || null,
        departamentoEntrega: form.departamentoEntrega || null,
        direccionEntrega: form.direccionEntrega || null,
        distritoEntrega: form.distritoEntrega || null,
        provinciaEntrega: form.provinciaEntrega || null,
        referenciaEntrega: form.referenciaEntrega || null,
        documentoOce: urlOce,
        documentoOcf: url,
        estadoVenta: MAPA_ESTADO_PROGRESO_A_ESTADO_VENTA[form.estadoProgreso],
        etapaSiaf: form.etapaSiaf,
        fechaEntrega: form.fechaMaxForm,
        fechaForm: form.fechaForm,
        fechaMaxForm: form.fechaMaxForm,
        fechaSiaf: form.fechaSiaf,
        fuentesFinanciamiento: form.fuentesFinanciamiento,
        montoVenta: Number(form.montoVenta),
        multipleFuentesFinanciamiento: form.multipleFuentesFinanciamiento,
        numeroOcam: form.numeroOcam || null,
        productos: form.productos.map(({ montoReferencia, ...p }) => p),
        siaf: form.siaf || null,
        ventaPrivada: form.ventaPrivada,
      };

      const ventaActualizada = await actualizarVenta(ventaGuardada.id, payload);
      setVentaGuardada(ventaActualizada);
      setUrlOcf(url);
      setOcfPendienteDeActualizar(false);
      onGuardado?.(ventaActualizada);
    } catch (e) {
      setErrorActualizarOcf(e instanceof Error ? e.message : "No se pudo actualizar el OCF");
    } finally {
      setActualizandoOcf(false);
    }
  };

  const [autocompletandoOce, setAutocompletandoOce] = useState(false);
  const [errorAutocompletarOce, setErrorAutocompletarOce] = useState("");

  // Corre el mismo OCR que usa correrOcr() pero sobre el archivo YA
  // subido a mano en "Orden de Compra Electrónica (OCE)" — para cuando
  // se crea una orden en blanco (o se reemplaza el OCE) y se quiere
  // pre-llenar el formulario igual que con "Registrar orden" desde una
  // card de Perú Compras.
  const autocompletarDesdeOce = useCallback(async () => {
    if (!archivoOce) return;
    setAutocompletandoOce(true);
    setErrorAutocompletarOce("");
    try {
      const fd = new FormData();
      fd.append("archivo", archivoOce, archivoOce.name);
      fd.append("publicada_id", publicada?.C_OrdenCompra || "");

      const rOcr = await fetchConToken(`${API_BASE}/ficha/ocr`, { method: "POST", body: fd });
      if (!rOcr.ok) {
        const body = await rOcr.json().catch(() => ({}));
        throw new Error(body.detail || "No se pudo aplicar el OCR");
      }
      const data = await rOcr.json();
      const datosOcr = data.datos as Record<string, unknown>;
      setFuenteProductosOcr(data.fuente_productos ?? null);
      setTokensGroqOcr(data.tokens_groq ?? null);

      setForm((f) => mapOcrAFormulario(datosOcr, f));

      // Verifica que el N° OCAM detectado por el OCR coincida con el
      // nombre del archivo subido (sin extensión). Si NO coinciden, se
      // avisa — pero se conserva el valor del OCR, porque viene del
      // texto real leído dentro del PDF y es más confiable que el
      // nombre del archivo (que el usuario pudo haber renombrado).
      const numeroOcamOcr = String((datosOcr.otros as Record<string, unknown> | undefined)?.numero_ocam || "");
      const nombreArchivoSinExt = nombreSinExtension(archivoOce.name);
      if (numeroOcamOcr && nombreArchivoSinExt && numeroOcamOcr.trim() !== nombreArchivoSinExt.trim()) {
        setErrorAutocompletarOce(
          `El N° OCAM detectado por el OCR ("${numeroOcamOcr}") no coincide con el nombre del archivo ("${nombreArchivoSinExt}"). Se usó el dato del OCR — revísalo.`
        );
      }

      // Mismo auto-match de catálogo que ya usa correrOcr()
      const textoCatalogoOcr = String((datosOcr.otros as Record<string, unknown> | undefined)?.catalogo || "");
      if (textoCatalogoOcr && form.empresa) {
        try {
          const catalogos = await catalogosDeEmpresa(form.empresa.id);
          let mejor: CatalogoOption | null = null;
          let mejorScore = 0;
          for (const c of catalogos) {
            const scoreNombre = similitudDice(textoCatalogoOcr, c.nombre);
            const scoreDescripcion = similitudDice(textoCatalogoOcr, c.descripcion);
            const scoreConcatenado = similitudDice(textoCatalogoOcr, `${c.nombre} ${c.descripcion}`);
            const score = Math.max(scoreNombre, scoreDescripcion, scoreConcatenado);
            if (score > mejorScore) {
              mejorScore = score;
              mejor = c;
            }
          }
          if (mejor && mejorScore >= UMBRAL_SIMILITUD_CATALOGO) {
            set("catalogoEmpresaId", mejor.id);
            set("catalogoLabel", `${mejor.nombre} - ${mejor.descripcion}`);
          }
        } catch {
          // si falla, el usuario elige el catálogo a mano
        }
      }

      // Mismo auto-match de cliente por RUC que ya usa correrOcr()
      const rucEntidad = String((datosOcr.otros as Record<string, unknown> | undefined)?.ruc_entidad || "");
      if (rucEntidad) {
        try {
          const candidatos = await buscarClientes(rucEntidad);
          const match = candidatos.find((c) => c.ruc === rucEntidad) || candidatos[0];
          if (match) {
            set("cliente", match);
            set("departamentoEntrega", match.departamento || "");
            set("provinciaEntrega", match.provincia || "");
            set("distritoEntrega", match.distrito || "");
            setContactosRecargarKey((k) => k + 1);
            setForm((f) => (f.unidadEjecutora ? f : { ...f, unidadEjecutora: extraerCodigoUnidadEjecutora(match.codigoUnidadEjecutora) }));
          }
        } catch {
          // si falla, el usuario elige el cliente a mano
        }
      }
      } catch (e) {
      setErrorAutocompletarOce(e instanceof Error ? e.message : "Error desconocido procesando el OCR");
    } finally {
      setAutocompletandoOce(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archivoOce, publicada, form.empresa]);

  // Reintenta descargar el OCF (Orden Física) directo de Perú Compras.
  // nOrdenCompra AQUÍ debe ser el N_OrdenCompra real de Perú Compras, no
  // ningún id del ERP — es el mismo id que usan los botones "Ver Orden
  // Física" de las cards.
  const cargarOcfConReintentos = useCallback(async (nOc: number, marcarParaActualizar = false) => {
    const INTENTOS_OCF = 6;
    const ESPERA_MS_OCF = 4000;

    for (let intento = 1; intento <= INTENTOS_OCF; intento++) {
      try {
        const rFisica = await fetchConToken(`${API_BASE}/publicadas/${nOc}/pdf-fisica`);
        if (rFisica.ok) {
          const blob = await rFisica.blob();
          const archivo = new File([blob], `OCF-${nOc}.pdf`, { type: "application/pdf" });
          setArchivoOcf(archivo);
          setUrlOcf(URL.createObjectURL(archivo));
          if (marcarParaActualizar) setOcfPendienteDeActualizar(true);
          return;
        }
        if (intento === INTENTOS_OCF) {
          console.warn(`No se pudo cargar el OCF (N_OrdenCompra ${nOc}) tras ${INTENTOS_OCF} intentos.`);
          return;
        }
      } catch {
        if (intento === INTENTOS_OCF) return;
      }
      await new Promise((res) => setTimeout(res, ESPERA_MS_OCF));
    }
  }, []);

useEffect(() => {
    if (modo === "ocr") {
      correrOcr();
      cargarDocumentosBase();
    }
    if (modo === "existente" && ventaExistente) {
      // Trae de una vez el detalle de agrupación de ESTA venta, para
      // que el sidebar muestre las OCs del mismo grupo sin que el
      // usuario tenga que hacer nada.
      cargarGrupoDetalle(ventaExistente.id);
      // Trae también los montos de referencia por producto guardados
      // aparte — sin esto, "Monto importe (ref. margen)" siempre
      // aparece vacío aunque ya se haya guardado antes.
      cargarMontosReferencia(ventaExistente.id);

      // La venta YA tiene sus documentos subidos al ERP (documentoOce /
      // documentoOcf son URLs absolutas, no archivos locales que haya
      // que descargar) — se cargan directo en el visor.
      const v = ventaExistente as any;
      if (v.documentoOce) {
        setUrlOce(v.documentoOce);
        setDocActivo("oce");
      }
     if (v.documentoOcf) {
        setUrlOcf(v.documentoOcf);
      } else if (nOrdenCompra) {
        // El OCF quedó vacío en el ERP — probablemente porque Azure aún
        // no tenía el archivo listo cuando se guardó esta venta. Se
        // reintenta traerlo directo de Perú Compras, usando el
        // N_OrdenCompra REAL (viene de la card de Publicadas, NO el id
        // de la venta del ERP — antes se usaba ventaExistente.id y por
        // eso el pdf-fisica siempre fallaba).
        cargarOcfConReintentos(nOrdenCompra, true);
      } else {
        console.warn("No se pudo reintentar el OCF: falta el N_OrdenCompra de Perú Compras para esta venta.");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo]);

  // Limpieza de las URLs de vista previa al desmontar el modal
  useEffect(() => {
    return () => {
      if (urlOce) URL.revokeObjectURL(urlOce);
      if (urlOcf) URL.revokeObjectURL(urlOcf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Producto: agregar / quitar / editar filas
  const actualizarProducto = (idx: number, patch: Partial<ProductoVentaForm>) =>
    setForm((f) => ({
      ...f,
      productos: f.productos.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    }));

  const agregarProducto = () =>
    setForm((f) => ({
      ...f,
      productos: [...f.productos, { codigo: "", descripcion: "", marca: "", cantidad: 1, isCompleted: false, montoReferencia: "" }],
    }));

  const quitarProducto = (idx: number) =>
    setForm((f) => ({ ...f, productos: f.productos.filter((_, i) => i !== idx) }));


  // Mapea el valor del <select> "estadoProgreso" del formulario al
// string real que espera el ERP en el campo `estadoVenta`.
// ⚠️ SUPUESTO: solo confirmé "COMPLETADO" porque era el valor
// hardcodeado que ya funcionaba. Los otros dos ("PENDIENTE" y
// "EN_PROCESO") son mi mejor apuesta por convención típica de ERPs.
// VERIFICA los valores reales abriendo estiloEstado() en TabVentasErp.tsx
// (ahí debe haber un switch/if con los strings exactos que el ERP
// devuelve para cada estado) y ajusta este mapa si no calzan.
const MAPA_ESTADO_PROGRESO_A_ESTADO_VENTA: Record<
  FormState["estadoProgreso"],
  string
> = {
  creacion: "CREADO",
  en_proceso: "PENDIENTE",
  completo: "COMPLETADO",
};

const puedeGuardar = camposFaltantesCalculados.length === 0;

const puedeUsarBotones = esSeguimiento || esAdmin;

const guardar = async () => {
    if (camposFaltantesCalculados.length > 0) return; // el toast ya muestra qué falta
    if (!form.empresa || !form.cliente || !form.contacto || !form.catalogoEmpresaId) return;
    setErrorGuardar("");
    setGuardando(true);
    try {
      // archivoOce/archivoOcf existen cuando hay un PDF NUEVO (recién
      // descargado de la publicada o subido a mano) que aún no está en
      // el ERP -> hay que subirlo primero para conseguir su URL real.
      // Si no hay archivo nuevo pero sí hay urlOce/urlOcf (venta ya
      // existente que ya traía sus documentos), se reusa esa URL tal
      // cual, sin volver a subir nada.
      let documentoOceUrl: string | null = archivoOce ? null : urlOce;
      let documentoOcfUrl: string | null = archivoOcf ? null : urlOcf;

      if (archivoOce) {
        documentoOceUrl = await subirDocumento(archivoOce, "OCE");
      }
      if (archivoOcf) {
        documentoOcfUrl = await subirDocumento(archivoOcf, "OCF");
      }

    const payload: VentaCreatePayload = {
        empresa: { connect: { id: form.empresa.id } },
        cliente: { connect: { id: form.cliente.id } },
        contactoCliente: { connect: { id: form.contacto.id } },
        catalogoEmpresa: { connect: { id: form.catalogoEmpresaId } },
        codigoOcf: form.codigoOcf || null,
        departamentoEntrega: form.departamentoEntrega || null,
        direccionEntrega: form.direccionEntrega || null,
        distritoEntrega: form.distritoEntrega || null,
        provinciaEntrega: form.provinciaEntrega || null,
        referenciaEntrega: form.referenciaEntrega || null,
        documentoOce: documentoOceUrl,
        documentoOcf: documentoOcfUrl,
        estadoVenta: MAPA_ESTADO_PROGRESO_A_ESTADO_VENTA[form.estadoProgreso],
        etapaSiaf: form.etapaSiaf,
        fechaEntrega: form.fechaMaxForm,
        fechaForm: form.fechaForm,
        fechaMaxForm: form.fechaMaxForm,
        fechaSiaf: form.fechaSiaf,
        fuentesFinanciamiento: form.fuentesFinanciamiento,
        montoVenta: Number(form.montoVenta),
        multipleFuentesFinanciamiento: form.multipleFuentesFinanciamiento,
        numeroOcam: form.numeroOcam || null,
        productos: form.productos.map(({ montoReferencia, ...p }) => p),
        siaf: form.siaf || null,
        ventaPrivada: form.ventaPrivada,
      };

        const venta = ventaGuardada
        ? await actualizarVenta(ventaGuardada.id, payload)
        : await crearVenta(payload);

      setVentaGuardada(venta);
      onGuardado?.(venta);

      // Si la orden tiene VARIOS productos, cada uno pudo recibir su
      // propio "Monto importe" (referencia para calcular su margen
      // individual) — se guarda aparte, nunca va dentro del payload
      // que se manda al ERP.
      if (form.productos.length > 1) {
        try {
          await guardarMontosReferenciaProductos(
            venta.id,
            form.productos
              .filter((p) => p.codigo.trim())
              .map((p) => ({
                codigo: p.codigo.trim(),
                monto_referencia: p.montoReferencia ? Number(p.montoReferencia) : null,
              }))
          );
        } catch (e) {
          console.warn("No se pudieron guardar los montos de referencia por producto:", e);
        }
      }

      // Solo se agrupa automáticamente la PRIMERA vez que se crea la
      // venta (no en cada edición posterior) — si ya estaba en un
      // grupo, editar no debe volver a mandarla a agrupar.
      if (!ventaGuardada) {
        await aplicarAgrupacion(venta.id);
      }

      // Refresca el panel de "Órdenes en esta agrupación" con el
      // estado más reciente del ERP — así se ve de inmediato la orden
      // recién guardada dentro de su grupo.
      await cargarGrupoDetalle(venta.id);
    } catch (e) {
      setErrorGuardar(e instanceof Error ? e.message : "No se pudo guardar la orden");
    } finally {
      setGuardando(false);
    }
  };

return (
    <div className="min-h-screen bg-slate-100">
      <style jsx global>{`
        @keyframes hb-campo-pulso {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4);
            outline: 2px solid transparent;
          }
          50% {
            box-shadow: 0 0 0 6px rgba(239, 68, 68, 0.18);
            outline: 2px solid #ef4444;
          }
        }
        .hb-campo-resaltado {
          animation: hb-campo-pulso 0.85s ease-in-out 3;
        }
        @keyframes hb-slide-in {
          from { transform: translateY(8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .hb-slide-in {
          animation: hb-slide-in 0.25s ease-out;
        }
      `}</style>

      {/* Botón "Regresar" flotante — siempre visible arriba, sin importar el scroll */}
      <button
        type="button"
        onClick={onClose}
        className="fixed top-4 left-4 z-40 flex items-center gap-1.5 bg-white border border-slate-200 shadow-lg rounded-full pl-3 pr-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900 hover:shadow-xl transition-all"
      >
        <ArrowLeft size={16} />
        Regresar
      </button>

      {/* Barra superior de fechas, igual a tu captura */}
      <div className="bg-emerald-500 text-white text-[11px] font-medium px-6 py-1.5 flex justify-between">
        <span>Creado: {new Date().toLocaleDateString("es-PE")}</span>
        <span>Actualizado: {new Date().toLocaleString("es-PE")}</span>
      </div>

<div className="flex flex-col lg:flex-row relative">
{/* ================= Sidebar (colapsable) ================= */}
        <div
          className={`relative shrink-0 transition-all duration-300 ease-in-out ${
            sidebarAbierto ? "w-full lg:w-[260px] min-h-[calc(100vh-30px)]" : "w-0 h-0 lg:h-auto lg:min-h-[calc(100vh-30px)]"
          }`}
        >
        <aside
          className={`relative bg-[#10172A] text-white h-full overflow-hidden transition-all duration-300 ease-in-out ${
            sidebarAbierto ? "px-4 py-5" : "px-0 py-0 lg:py-5"
          }`}
        >
        <div
            className={`w-[228px] transition-opacity duration-200 ${
              sidebarAbierto ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
          >
            {cargandoOcr && (
              <div className="flex items-center gap-2 text-xs text-slate-300 mb-4">
                <Loader2 size={13} className="animate-spin" />
                Extrayendo datos del PDF (OCR)...
              </div>
            )}
            {errorOcr && (
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-300 text-[11px] rounded-lg px-3 py-2 mb-4">
                <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                {errorOcr}
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1.5">Agrupación</label>
            <div className="grid grid-cols-3 gap-2 mb-2">
                {(["individual", "nueva", "existente"] as const).map((modo) => (
                  <button
                    key={modo}
                    type="button"
                    onClick={() => {
                      setModoAgrupacion(modo);
                      // Al salir de "existente" (o volver a elegirlo desde
                      // otro modo), limpia el panel para no arrastrar el
                      // detalle del grupo anterior mientras carga el nuevo.
                      if (modo !== "existente") {
                        setGrupoDetalle(null);
                        setCantidadAgrupadas(0);
                      }
                    }}
                    className={`text-xs font-medium rounded-lg py-2 transition-colors ${
                      modoAgrupacion === modo
                        ? "bg-[#4F46E5] text-white"
                        : "bg-white/5 text-slate-300 hover:bg-white/10"
                    }`}
                  >
                    {modo === "individual" ? "Orden individual" : modo === "nueva" ? "Nuevo grupo" : "Grupo existente"}
                  </button>
                ))}
              </div>

              {modoAgrupacion === "nueva" && (
                <div className="grid grid-cols-1 gap-2">
                  <input
                    value={codigoGrupoNuevo}
                    onChange={(e) => setCodigoGrupoNuevo(e.target.value.toUpperCase())}
                    placeholder="Código del grupo"
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-[#4F46E5]"
                  />
                  <input
                    value={descripcionGrupoNuevo}
                    onChange={(e) => setDescripcionGrupoNuevo(e.target.value)}
                    placeholder="Descripción (opcional)"
                    className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-[#4F46E5]"
                  />
                </div>
              )}

              {modoAgrupacion === "existente" && (
                <select
                  value={grupoExistenteId ?? ""}
                  onChange={(e) => setGrupoExistenteId(Number(e.target.value) || null)}
                  disabled={cargandoGrupos}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-[#4F46E5] disabled:opacity-50"
                >
                  <option value="" className="text-slate-900">
                    {cargandoGrupos ? "Cargando grupos..." : "Selecciona un grupo..."}
                  </option>
                  {gruposExistentes.map((g) => (
                    <option key={g.id} value={g.id} className="text-slate-900">
                      {g.codigoGrupo}
                      {g.descripcion ? ` — ${g.descripcion}` : ""}
                    </option>
                  ))}
                </select>
              )}

            {grupoAplicado && (
                <p className="text-[11px] text-emerald-400 mt-1.5">
                  ✓ Agrupada en "{grupoAplicado.codigoGrupo}" — la próxima orden que crees se sumará aquí automáticamente.
                </p>
              )}
              {errorGrupo && <p className="text-[11px] text-red-400 mt-1.5">{errorGrupo}</p>}
            </div>

            {/* Órdenes que ya pertenecen a esta agrupación */}
            {(grupoDetalle || cargandoGrupoDetalle) && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <label className="block text-[11px] font-medium text-slate-300 mb-1.5">
                  Órdenes en esta agrupación
                  {grupoDetalle && (
                    <span className="ml-1.5 text-slate-500">· {grupoDetalle.codigoGrupo}</span>
                  )}
                </label>

                {cargandoGrupoDetalle && (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                    <Loader2 size={12} className="animate-spin" /> Cargando órdenes del grupo...
                  </div>
                )}

                {!cargandoGrupoDetalle && grupoDetalle && grupoDetalle.ordenesCompra.length === 0 && (
                  <p className="text-[11px] text-slate-500">Aún no hay órdenes en este grupo.</p>
                )}

                {!cargandoGrupoDetalle && grupoDetalle && grupoDetalle.ordenesCompra.length > 0 && (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {grupoDetalle.ordenesCompra.map((item) => {
                      const esLaActual = item.ordenCompraId === ventaGuardada?.id;
                      const oc = item.ordenCompra;
                      const estado = oc.estadoVenta || "";
                      const fecha = oc.fechaEmision || oc.createdAt;
                      const cantidadProductos = Array.isArray(oc.productos) ? oc.productos.length : null;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => cargarOtraVentaDelGrupo(item.ordenCompraId)}
                          disabled={esLaActual || cargandoOtraVenta}
                          title={esLaActual ? "Ya estás viendo esta orden" : "Ver esta orden en el formulario"}
                          className={`w-full text-left rounded-xl px-3 py-2.5 text-[11px] border transition-colors disabled:cursor-default ${
                            esLaActual
                              ? "bg-[#4F46E5]/15 border-[#4F46E5]/50"
                              : "bg-white/5 border-white/10 hover:border-[#4F46E5]/40 hover:bg-white/10"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
                            <span style={{ fontFamily: "var(--font-mono)" }} className="font-bold text-slate-100 truncate">
                              {oc.codigoVenta}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              {estado && (
                                <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full border ${estiloEstado(estado)}`}>
                                  {estado}
                                </span>
                              )}
                              {esLaActual && (
                                <span className="text-[9px] font-bold text-[#4F46E5] bg-[#4F46E5]/20 rounded-full px-1.5 py-0.5">
                                  ACTUAL
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 text-slate-300 mb-1">
                            <Building2 size={11} className="text-slate-500 shrink-0" />
                            <span className="truncate">{oc.cliente?.razonSocial || "Cliente —"}</span>
                          </div>

                          {oc.numeroOcam && (
                            <p style={{ fontFamily: "var(--font-mono)" }} className="text-slate-500 truncate mb-1.5">
                              {oc.numeroOcam}
                            </p>
                          )}

                          <div className="flex items-center justify-between pt-1.5 border-t border-white/10">
                            <span style={{ fontFamily: "var(--font-mono)" }} className="text-emerald-400 font-bold">
                              S/ {Number(oc.montoVenta ?? 0).toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                            </span>
                            <div className="flex items-center gap-2 text-slate-500">
                              {cantidadProductos != null && (
                                <span className="flex items-center gap-1">
                                  <Package size={10} /> {cantidadProductos}
                                </span>
                              )}
                              {fecha && (
                                <span className="flex items-center gap-1">
                                  <CalendarDays size={10} />
                                  {new Date(fecha).toLocaleDateString("es-PE", { day: "2-digit", month: "short" })}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            </div>
        </aside>
            {/* Jalador para OCULTAR el panel — vive AFUERA del <aside>
                (que tiene overflow-hidden para la animación de ancho) así
                no lo recorta cuando sobresale con -right-4. */}
          {sidebarAbierto && (
            <button
              type="button"
              onClick={() => setSidebarAbierto(false)}
              title="Ocultar panel de agrupación"
              className="flex absolute top-6 -right-4 h-10 w-8 items-center justify-center rounded-r-lg bg-[#4F46E5] hover:bg-[#4338CA] text-white border border-white/20 shadow-lg shadow-black/30 z-30 transition-colors"
            >
              <ChevronLeft size={16} strokeWidth={2.75} />
            </button>
          )}
        </div>

        {/* Jalador para MOSTRAR el panel, cuando está cerrado */}
        {!sidebarAbierto && (
          <button
            type="button"
            onClick={() => setSidebarAbierto(true)}
            title="Mostrar panel de agrupación"
            className="flex fixed lg:absolute top-6 left-0 h-10 w-8 items-center justify-center rounded-r-lg bg-[#4F46E5] hover:bg-[#4338CA] text-white border border-white/20 shadow-lg shadow-black/30 z-20 transition-colors"
          >
            <ChevronRight size={16} strokeWidth={2.75} />
            {cantidadAgrupadas > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none">
                {cantidadAgrupadas}
              </span>
            )}
          </button>
        )}

    {/* ================= Contenido ================= */}
        <main className="flex-1 min-w-0 px-6 py-4">
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_500px] gap-4 items-start">
            <div key={formInstanceKey} className="space-y-3 min-w-0">
          {/* Encabezado tipo tarjeta */}
    {/* Encabezado tipo tarjeta + selector de cliente */}
    <div className="bg-[#10172A] text-white rounded-2xl px-6 py-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                  <Building2 size={20} />
                </div>
                <div className="min-w-0">
                  <h1 style={{ fontFamily: "var(--font-display)" }} className="text-xl font-bold leading-none">
                    {ventaGuardada?.codigoVenta ?? publicada?.C_OrdenCompra ?? "Nueva orden"}
                  </h1>
                  {form.numeroOcam && (
                    <p className="text-[16px] text-slate-400 mt-1">{form.numeroOcam}</p>
                  )}
                

                </div>
              </div>

              <div className="flex items-start gap-3 flex-wrap">
                
                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1">Empresa</label>
                  <EmpresaSelect
                    value={form.empresa}
                    onChange={(e) => {
                      set("empresa", e);
                      // Al cambiar de empresa se resetea el catálogo elegido,
                      // porque los catálogos dependen de la empresa.
                      set("catalogoEmpresaId", null);
                      set("catalogoLabel", "");
                    }}
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-medium text-slate-400 mb-1">Tipo de venta</label>
                  <select
                    value={form.ventaPrivada ? "privada" : "estado"}
                    onChange={(e) => set("ventaPrivada", e.target.value === "privada")}
                    className="bg-blue/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-black focus:outline-none focus:ring-1 focus:ring-[#4F46E5]"
                  >
                    <option value="estado" className="text-slate-900">Venta al Estado</option>
                    <option value="privada" className="text-slate-900">Venta Privada</option>
                  </select>
                </div>
                {ventaGuardada && (
                  <button
                    type="button"
                    onClick={iniciarOrdenEnBlanco}
                    title="Limpia todo el formulario para llenar una orden nueva manual"
                    className="shrink-0 flex items-center gap-1.5 bg-white/100 hover:bg-green/20 text-black text-xs font-semibold rounded-full px-3.5 py-2 transition-colors self-end"
                  >
                    <Plus size={13} />
                    Nueva orden en blanco
                  </button>
                )}
              </div>
            </div>
            <div
              ref={(el) => { refsCampos.current["campo-cliente"] = el; }}
              className={`mt-3 pt-3 border-t border-white/10 transition-shadow ${campoResaltado === "campo-cliente" ? "hb-campo-resaltado" : ""}`}
            >
            <label className="block text-[11px] font-medium text-slate-300 mb-1.5">Buscar cliente (RUC, razón social...)</label>
                <ClienteSearchField
                value={form.cliente}
                onChange={(c) => {
                  set("cliente", c);
                  set("contacto", null);
                  if (c.departamento) set("departamentoEntrega", c.departamento);
                  if (c.provincia) set("provinciaEntrega", c.provincia);
                  if (c.distrito) set("distritoEntrega", c.distrito);
                  set("unidadEjecutora", extraerCodigoUnidadEjecutora(c.codigoUnidadEjecutora));
                  // Fuerza que ContactoSearchField vuelva a pedir los
                  // contactos y auto-seleccione el primero, incluso si
                  // el cliente elegido es EL MISMO que ya estaba (mismo
                  // id -> el useEffect de abajo no se dispara solo con
                  // clienteId, necesita este empujón extra).
                  setContactosRecargarKey((k) => k + 1);
                }}
              />
            </div>
            {form.cliente && (
              <div className="mt-4 pt-4 border-t border-white/10 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-400">
                      <th className="pr-4 pb-2 font-medium">Razón Social</th>
                      <th className="pr-4 pb-2 font-medium">RUC</th>
                      <th className="pr-4 pb-2 font-medium">Sede</th>
                      <th className="pr-4 pb-2 font-medium">Código Unidad</th>
                      <th className="pr-4 pb-2 font-medium">Dirección</th>
                      <th className="pb-2 font-medium">Promedio Cobranza</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="text-slate-100">
                      <td className="pr-4 py-1">{form.cliente.razonSocial}</td>
                      <td className="pr-4 py-1">{form.cliente.ruc}</td>
                      <td className="pr-4 py-1">{form.cliente.sede || "—"}</td>
                      <td className="pr-4 py-1">{form.cliente.codigoUnidad || "—"}</td>
                      <td className="pr-4 py-1">
                        {form.cliente.direccion ||
                          [form.cliente.distrito, form.cliente.provincia, form.cliente.departamento].filter(Boolean).join(" - ") ||
                          "—"}
                      </td>
                      <td className="py-1">{form.cliente.promedioCobranza ?? "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {cargandoOcr ? (
            <LoaderOcrProfesional activo={cargandoOcr} />
          ) : (
            <>
              {fuenteProductosOcr && (
                <div
                  className={`flex items-center gap-2 text-[11px] rounded-lg px-3 py-2 border ${
                    fuenteProductosOcr === "gemini"
                      ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                      : "bg-amber-50 border-amber-200 text-amber-700"
                  }`}
                >
                  {fuenteProductosOcr === "gemini" ? <Sparkles size={12} className="shrink-0" /> : <AlertTriangle size={12} className="shrink-0" />}
                  <span>
                    {fuenteProductosOcr === "gemini"
                      ? "✨ La IA leyó tu orden y completó el formulario automáticamente"
                      : "El formulario se completó automáticamente — revisa los productos antes de guardar."}
                  </span>
                </div>
              )}

              {/* Cliente / Contacto */}
                {/* Lugar de entrega + Contacto, lado a lado como en el boceto */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="lg:col-span-2">
                  <Card icon={MapPin} title="Lugar de entrega">
                    <div className="space-y-4">
                      <div
                        ref={(el) => { refsCampos.current["campo-direccion"] = el; }}
                        className={`rounded-lg ${campoResaltado === "campo-direccion" ? "hb-campo-resaltado" : ""}`}
                      >
                        <Field label="Dirección">
                          <input
                            value={form.direccionEntrega}
                            onChange={(e) => set("direccionEntrega", e.target.value)}
                            className={inputCls}
                          />
                        </Field>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div
                          ref={(el) => { refsCampos.current["campo-distrito"] = el; }}
                          className={`rounded-lg ${campoResaltado === "campo-distrito" ? "hb-campo-resaltado" : ""}`}
                        >
                          <Field label="Distrito">
                            <input
                              value={form.distritoEntrega}
                              onChange={(e) => set("distritoEntrega", e.target.value)}
                              className={inputCls}
                            />
                          </Field>
                        </div>
                        <div
                          ref={(el) => { refsCampos.current["campo-provincia"] = el; }}
                          className={`rounded-lg ${campoResaltado === "campo-provincia" ? "hb-campo-resaltado" : ""}`}
                        >
                          <Field label="Provincia">
                            <input
                              value={form.provinciaEntrega}
                              onChange={(e) => set("provinciaEntrega", e.target.value)}
                              className={inputCls}
                            />
                          </Field>
                        </div>
                        <div
                          ref={(el) => { refsCampos.current["campo-departamento"] = el; }}
                          className={`rounded-lg ${campoResaltado === "campo-departamento" ? "hb-campo-resaltado" : ""}`}
                        >
                          <Field label="Departamento">
                            <input
                              value={form.departamentoEntrega}
                              onChange={(e) => set("departamentoEntrega", e.target.value)}
                              className={inputCls}
                            />
                          </Field>
                        </div>
                      </div>

                      <div
                        ref={(el) => { refsCampos.current["campo-referencia"] = el; }}
                        className={`rounded-lg ${campoResaltado === "campo-referencia" ? "hb-campo-resaltado" : ""}`}
                      >
                        <Field label="Referencia">
                          <input
                            value={form.referenciaEntrega}
                            onChange={(e) => set("referenciaEntrega", e.target.value)}
                            className={inputCls}
                          />
                        </Field>
                      </div>
                    </div>
                  </Card>
                </div>

                <Card icon={User} title="Contacto">
                  {!form.cliente && (
                    <p className="text-xs text-slate-400 mb-3 flex items-center gap-1.5">
                      <Search size={12} /> Selecciona primero un cliente arriba para ver sus contactos.
                    </p>
                  )}
                  <div className="space-y-3">
                    <div
                      ref={(el) => { refsCampos.current["campo-contacto"] = el; }}
                      className={`rounded-lg ${campoResaltado === "campo-contacto" ? "hb-campo-resaltado" : ""}`}
                    >
                      <Field label="Contacto">
                        <ContactoSearchField
                          clienteId={form.cliente?.id ?? null}
                          value={form.contacto}
                          onChange={(c) => set("contacto", c)}
                          onCrearNuevo={() => setModalContactoAbierto(true)}
                          recargarKey={contactosRecargarKey}
                        />
                      </Field>
                    </div>
                    <Field label="Rol">
                      <input
                        value={form.contacto?.cargo || ""}
                        disabled
                        placeholder="—"
                        className={inputCls + " bg-slate-50 text-slate-400"}
                      />
                    </Field>
                    <Field label="Celular">
                      <input
                        value={form.contacto?.telefono || ""}
                        disabled
                        placeholder="—"
                        className={inputCls + " bg-slate-50 text-slate-400"}
                      />
                    </Field>
                  </div>
                </Card>
              </div>

                {(form.unidadEjecutora || form.siaf) && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 flex flex-wrap gap-x-8 gap-y-1 text-xs">
                  <div>
                    <span className="text-slate-500">Unidad Ejecutora: </span>
                    <span className="font-semibold text-slate-800">{form.unidadEjecutora || "—"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Expediente SIAF: </span>
                    <span className="font-semibold text-slate-800">{form.siaf || "—"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500">Cantidad: </span>
                    <span className="font-semibold text-slate-800">{form.productos[0]?.cantidad ?? "—"}</span>
                  </div>
                </div>
              )}


              {form.unidadEjecutora && form.siaf && (
                  <PanelConsultaMef
                    unidadEjecutora={form.unidadEjecutora}
                    expediente={form.siaf}
                    esSeguimiento={puedeUsarBotones}
                    onAplicarDatos={(datos) => {
                    set("etapaSiaf", datos.etapaSiaf);
                    set("fechaSiaf", datos.fechaSiaf);
                    set("fuentesFinanciamiento", datos.fuentesFinanciamiento);
                    set("multipleFuentesFinanciamiento", datos.multipleFuentesFinanciamiento);
                    set("montoVenta", String(datos.montoVenta));
                  }}
                />
              )}


              {/* Datos generales */}
                {/* Datos generales */}
            <Card
                icon={Info}
                title="Datos generales"
                headerExtra={
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">Fuentes de financiamiento:</span>
                    <FuenteFinanciamientoSelect
                      value={form.fuentesFinanciamiento}
                      onChange={(codigos) => {
                        set("fuentesFinanciamiento", codigos.join(","));
                        set("multipleFuentesFinanciamiento", codigos.length > 1);
                      }}
                    />
                  </div>
                }
              >
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div
                    ref={(el) => { refsCampos.current["campo-catalogo"] = el; }}
                    className={`rounded-lg ${campoResaltado === "campo-catalogo" ? "hb-campo-resaltado" : ""}`}
                  >
                    <Field label="Catálogo">
                      <CatalogoSelect
                        empresaId={form.empresa?.id ?? null}
                        value={form.catalogoEmpresaId}
                        onChange={(c) => {
                          set("catalogoEmpresaId", c.id);
                          set("catalogoLabel", `${c.nombre} - ${c.descripcion}`);
                        }}
                      />
                    </Field>
                  </div>
                  <Field label="Fecha formalización">
                    <input type="date" value={form.fechaForm} onChange={(e) => set("fechaForm", e.target.value)} className={inputCls} />
                  </Field>
                  <Field label="Fecha máxima de entrega">
                    <input type="date" value={form.fechaMaxForm} onChange={(e) => set("fechaMaxForm", e.target.value)} className={inputCls} />
                  </Field>
                  <div
                    ref={(el) => { refsCampos.current["campo-monto"] = el; }}
                    className={`rounded-lg ${campoResaltado === "campo-monto" ? "hb-campo-resaltado" : ""}`}
                  >
                    <Field label="Monto de venta (S/)">
                      <input
                        type="number"
                        step="0.01"
                        value={form.montoVenta}
                        onChange={(e) => set("montoVenta", e.target.value)}
                        className={inputCls}
                      />
                    </Field>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mt-4">
                  <div
                    ref={(el) => { refsCampos.current["campo-siaf"] = el; }}
                    className={`rounded-lg ${campoResaltado === "campo-siaf" ? "hb-campo-resaltado" : ""}`}
                  >
                    <Field label="Número de SIAF">
                      <input value={form.siaf} onChange={(e) => set("siaf", e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                  <Field label="Etapa SIAF">
                    <select
                      value={form.siaf.trim() ? form.etapaSiaf : "SIAF"}
                      disabled={!form.siaf.trim()}
                      onChange={(e) => set("etapaSiaf", e.target.value)}
                      className={inputCls + " disabled:bg-slate-50 disabled:text-slate-400"}
                    >
                      <option value="SIAF">SIAF</option>
                      <option value="COM">COM</option>
                      <option value="DEV">DEV</option>
                      <option value="PAG">PAG</option>
                      <option value="SSIAF">SSIAF</option>
                      <option value="RES">RES</option>
                      <option value="GIR">GIR</option>
                      <option value="GIR-F">GIR-F</option>
                    </select>
                    {!form.siaf.trim() && (
                      <p className="text-[10px] text-slate-400 mt-1">Sin N° de SIAF — la etapa queda como "SIAF".</p>
                    )}
                  </Field>
                  <Field label="Fecha de SIAF">
                    <input type="date" value={form.fechaSiaf} onChange={(e) => set("fechaSiaf", e.target.value)} className={inputCls} />
                  </Field>
                  <div
                    ref={(el) => { refsCampos.current["campo-ocf"] = el; }}
                    className={`rounded-lg ${campoResaltado === "campo-ocf" ? "hb-campo-resaltado" : ""}`}
                  >
                    <Field label="OCF (RUC comprador)">
                      <input value={form.codigoOcf} onChange={(e) => set("codigoOcf", e.target.value)} className={inputCls} />
                    </Field>
                  </div>
                  <div
                    ref={(el) => { refsCampos.current["campo-ocam"] = el; }}
                    className={`rounded-lg ${campoResaltado === "campo-ocam" ? "hb-campo-resaltado" : ""}`}
                  >
                    <Field label="N° OCAM">
                      <input
                        value={form.numeroOcam}
                        onChange={(e) => set("numeroOcam", e.target.value)}
                        className={inputCls}
                        name="numero-ocam-nunca-autocompletar"
                        autoComplete="off"
                        data-lpignore="true"
                        data-1p-ignore
                      />
                    </Field>
                  </div>
                </div>


                {/* Placeholders de subida de OCE/OCF — no había endpoint de
                    subida en tus capturas; queda listo el hueco visual y
                    el handler para que lo conectes cuando lo tengas. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                {/* OCE — Orden de Compra Electrónica (PDF OCAM) */}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">
                      Orden de Compra Electrónica (OCE)
                    </label>
                    <div className="flex items-center gap-2">
                    <label
                        className={`flex-1 flex items-center gap-2 border border-dashed rounded-lg px-3 py-2.5 text-xs cursor-pointer transition-colors overflow-hidden ${
                          archivoOce || urlOce
                            ? "border-emerald-300 text-emerald-700 bg-emerald-50/50"
                            : "border-slate-300 text-slate-500 hover:border-[#4F46E5] hover:text-[#4F46E5]"
                        }`}
                      >
                        {archivoOce || urlOce ? <CheckCircle2 size={14} className="shrink-0" /> : <UploadCloud size={14} className="shrink-0" />}
                        <span className="truncate">{archivoOce ? archivoOce.name : urlOce ? nombreDesdeUrl(urlOce) : "Subir OCE"}</span>
                        <input
                          type="file"
                          accept="application/pdf,image/*"
                          className="hidden"
                          onChange={(e) => {
                            const archivo = e.target.files?.[0];
                            if (archivo) handleSubirOce(archivo);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {archivoOce && (
                        <button
                          type="button"
                          onClick={autocompletarDesdeOce}
                          disabled={autocompletandoOce}
                          title="Autocompletar formulario leyendo este OCE con OCR"
                          className="shrink-0 h-[38px] w-[38px] flex items-center justify-center rounded-lg border border-indigo-200 text-[#4F46E5] hover:bg-indigo-50 disabled:opacity-40 transition-colors"
                        >
                          {autocompletandoOce ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                        </button>
                      )}
                      {urlOce && (
                        <button
                          type="button"
                          onClick={() => setDocActivo("oce")}
                          title="Ver OCE"
                          className="shrink-0 h-[38px] w-[38px] flex items-center justify-center rounded-lg border border-slate-300 text-slate-500 hover:border-[#4F46E5] hover:text-[#4F46E5] transition-colors"
                        >
                          <Eye size={14} />
                        </button>
                      )}
                    </div>
                    {errorAutocompletarOce && (
                      <p className="text-[11px] text-amber-600 mt-1.5 flex items-start gap-1">
                        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                        {errorAutocompletarOce}
                      </p>
                    )}
                  </div>

                  {/* OCF — Orden de Compra Física */}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">
                      Orden de Compra Física (OCF)
                    </label>
                    <div className="flex items-center gap-2">
                    <label
                        className={`flex-1 flex items-center gap-2 border border-dashed rounded-lg px-3 py-2.5 text-xs cursor-pointer transition-colors overflow-hidden ${
                          archivoOcf || urlOcf
                            ? "border-emerald-300 text-emerald-700 bg-emerald-50/50"
                            : "border-slate-300 text-slate-500 hover:border-[#4F46E5] hover:text-[#4F46E5]"
                        }`}
                      >
                        {archivoOcf || urlOcf ? <CheckCircle2 size={14} className="shrink-0" /> : <UploadCloud size={14} className="shrink-0" />}
                        <span className="truncate">{archivoOcf ? archivoOcf.name : urlOcf ? nombreDesdeUrl(urlOcf) : "Subir OCF"}</span>
                        <input
                          type="file"
                          accept="application/pdf,image/*"
                          className="hidden"
                          onChange={(e) => {
                            const archivo = e.target.files?.[0];
                            if (archivo) handleSubirOcf(archivo);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      {urlOcf && (
                        <button
                          type="button"
                          onClick={() => setDocActivo("ocf")}
                          title="Ver OCF"
                          className="shrink-0 h-[38px] w-[38px] flex items-center justify-center rounded-lg border border-slate-300 text-slate-500 hover:border-[#4F46E5] hover:text-[#4F46E5] transition-colors"
                        >
                          <Eye size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* En pantallas chicas no hay panel fijo a la derecha, así
                    que el visor se muestra aquí abajo, compacto. */}
                <div className="xl:hidden mt-4">
                  <VisorDocumentos
                    docActivo={docActivo}
                    onCambiarDoc={setDocActivo}
                    urlOce={urlOce}
                    urlOcf={urlOcf}
                    nombreOce={archivoOce?.name || (urlOce ? nombreDesdeUrl(urlOce) : null)}
                    nombreOcf={archivoOcf?.name || (urlOcf ? nombreDesdeUrl(urlOcf) : null)}
                    compacto
                  />
                </div>
              </Card>

              {/* Productos */}
            <Card icon={Package} title="Productos">
                {camposFaltantes.some((c) => c.id.startsWith("campo-producto-")) && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2 mb-3">
                    <AlertTriangle size={13} className="shrink-0" />
                    Faltan datos en algunos productos — revisa los campos marcados en rojo.
                  </div>
                )}
                <div className="space-y-3">
                {form.productos.map((p, idx) => (
                    <div
                      key={idx}
                      className={`grid grid-cols-1 gap-3 items-end ${
                        form.productos.length > 1
                          ? "sm:grid-cols-[1fr_2fr_1fr_0.7fr_0.9fr_auto]"
                          : "sm:grid-cols-[1fr_2fr_1fr_0.7fr_auto]"
                      }`}
                    >
                    <div
                        ref={(el) => { refsCampos.current[`campo-producto-${idx}-codigo`] = el; }}
                        className={`rounded-lg ${campoResaltado === `campo-producto-${idx}-codigo` ? "hb-campo-resaltado" : ""}`}
                      >
                        <Field label="Código">
                          <input value={p.codigo} onChange={(e) => actualizarProducto(idx, { codigo: e.target.value })} className={inputCls} />
                        </Field>
                      </div>
                    <div
                        ref={(el) => { refsCampos.current[`campo-producto-${idx}-descripcion`] = el; }}
                        className={`rounded-lg ${campoResaltado === `campo-producto-${idx}-descripcion` ? "hb-campo-resaltado" : ""}`}
                      >
                        <Field label="Descripción">
                          <input
                            value={p.descripcion}
                            onChange={(e) => actualizarProducto(idx, { descripcion: e.target.value })}
                            className={inputCls}
                          />
                        </Field>
                      </div>
                    <div
                        ref={(el) => { refsCampos.current[`campo-producto-${idx}-marca`] = el; }}
                        className={`rounded-lg ${campoResaltado === `campo-producto-${idx}-marca` ? "hb-campo-resaltado" : ""}`}
                      >
                        <Field label="Marca">
                          <input value={p.marca} onChange={(e) => actualizarProducto(idx, { marca: e.target.value })} className={inputCls} />
                        </Field>
                      </div>
                        <div
                        ref={(el) => { refsCampos.current[`campo-producto-${idx}-cantidad`] = el; }}
                        className={`rounded-lg ${campoResaltado === `campo-producto-${idx}-cantidad` ? "hb-campo-resaltado" : ""}`}
                      >
                        <Field label="Cantidad">
                          <input
                            type="number"
                            value={p.cantidad}
                            onChange={(e) => actualizarProducto(idx, { cantidad: Number(e.target.value) })}
                            className={inputCls}
                          />
                        </Field>
                      </div>
                      {form.productos.length > 1 && (
                        <div>
                          <Field label="Monto importe (ref. margen)">
                            <input
                              type="number"
                              step="0.01"
                              value={p.montoReferencia || ""}
                              onChange={(e) => actualizarProducto(idx, { montoReferencia: e.target.value })}
                              placeholder="0.00"
                              className={inputCls}
                            />
                          </Field>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => quitarProducto(idx)}
                        disabled={form.productos.length === 1}
                        className="h-[38px] w-[38px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-30"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={agregarProducto}
                  className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-[#3B5BFF] hover:text-[#2f49d6]"
                >
                  <Plus size={15} />
                  Agregar producto
                </button>
              </Card>

              {ocfPendienteDeActualizar && (
                <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
                    <span>
                      Se encontró la Orden Física en Perú Compras — esta venta se había guardado sin ella.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={confirmarActualizarOcf}
                    disabled={actualizandoOcf}
                    className="shrink-0 flex items-center gap-1.5 bg-emerald-600 text-white font-semibold rounded-lg px-3.5 py-1.5 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                  >
                    {actualizandoOcf ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    Actualizar OCF
                  </button>
                </div>
              )}

              {errorActualizarOcf && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  {errorActualizarOcf}
                </div>
              )}

              {errorGuardar && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  {errorGuardar}
                </div>
              )}

              {/* El botón Regresar ahora es flotante (arriba) y Guardar
                  Datos es flotante (abajo, más adelante en este archivo) —
                  aquí solo queda el selector de estado de progreso.
                  pb-24 deja espacio para que el botón flotante no tape lo último. */}
              <div className="flex items-center justify-end pt-2 pb-24">
                <select
                  value={form.estadoProgreso}
                  onChange={(e) => set("estadoProgreso", e.target.value as FormState["estadoProgreso"])}
                  className="border border-slate-300 rounded-full px-3 py-1.5 text-xs font-medium text-slate-600"
                >
                  <option value="creacion">Creación</option>
                  <option value="en_proceso">PENDIENTE</option>
                  <option value="completo">COMPLETADO</option>
                </select>
              </div>
            </>
          )}
          </div>

        <aside className="hidden xl:block xl:sticky xl:top-6 self-start">
            <VisorDocumentos
              docActivo={docActivo}
              onCambiarDoc={setDocActivo}
              urlOce={urlOce}
              urlOcf={urlOcf}
              nombreOce={archivoOce?.name || (urlOce ? nombreDesdeUrl(urlOce) : null)}
              nombreOcf={archivoOcf?.name || (urlOcf ? nombreDesdeUrl(urlOcf) : null)}
            />
          </aside>
          </div>
      </main>
      </div>

    {/* Botón flotante "Guardar Datos" — siempre visible, sin bajar hasta
          el final. Solo el rol Seguimiento puede guardar; el resto lo ve
          deshabilitado con una nota explicando por qué. */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {!puedeUsarBotones && (
          <p className="text-[11px] font-medium text-slate-500 bg-white border border-slate-200 rounded-full px-3 py-1 shadow-md">
            Solo Seguimiento o Admin puede guardar esta orden
          </p>
        )}
        <button
          type="button"
          onClick={guardar}
          disabled={!puedeUsarBotones || guardando || aplicandoGrupo}
          className={`flex items-center gap-2 text-white text-sm font-semibold rounded-full px-8 py-3.5 shadow-2xl transition-colors disabled:opacity-40 ${
            puedeGuardar ? "bg-[#3B5BFF] hover:bg-[#2f49d6]" : "bg-slate-400 hover:bg-slate-500"
          }`}
        >
          {guardando || aplicandoGrupo ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {aplicandoGrupo ? "Agrupando..." : "Guardar Datos"}
        </button>
      </div>

      {camposFaltantes.length > 0 && (
        <div className="fixed bottom-5 right-5 z-[350] w-[320px] max-w-[90vw] bg-white border border-red-200 rounded-2xl shadow-2xl shadow-red-900/10 overflow-hidden hb-slide-in">
          <div className="flex items-center justify-between gap-2 bg-red-50 px-4 py-2.5 border-b border-red-100">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-600" />
              <span className="text-xs font-semibold text-red-700">
                Faltan {camposFaltantes.length} dato{camposFaltantes.length !== 1 ? "s" : ""} por rellenar
              </span>
            </div>
            <button onClick={() => setCamposFaltantes([])} className="text-red-400 hover:text-red-700">
              <X size={14} />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {camposFaltantes.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => irACampo(c.id)}
                className="w-full flex items-center justify-between gap-2 px-4 py-2 text-left text-xs text-slate-700 hover:bg-red-50 transition-colors"
              >
                {c.label}
                <ChevronRight size={13} className="text-slate-300 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {modalContactoAbierto && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setModalContactoAbierto(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 style={{ fontFamily: "var(--font-display)" }} className="text-base font-semibold text-slate-900">
                Nuevo contacto — {form.cliente?.razonSocial}
              </h3>
              <button onClick={() => setModalContactoAbierto(false)} className="text-slate-400 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <Field label="Nombre completo">
                <input
                  value={nuevoContacto.nombre}
                  onChange={(e) => setNuevoContacto((c) => ({ ...c, nombre: e.target.value }))}
                  className={inputCls}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Cargo">
                  <input
                    value={nuevoContacto.cargo || ""}
                    onChange={(e) => setNuevoContacto((c) => ({ ...c, cargo: e.target.value }))}
                    className={inputCls}
                  />
                </Field>
                <Field label="Teléfono">
                  <input
                    value={nuevoContacto.telefono || ""}
                    onChange={(e) => setNuevoContacto((c) => ({ ...c, telefono: e.target.value }))}
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field label="Email">
                <input
                  value={nuevoContacto.email || ""}
                  onChange={(e) => setNuevoContacto((c) => ({ ...c, email: e.target.value }))}
                  className={inputCls}
                />
              </Field>

              {errorContacto && (
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertTriangle size={12} /> {errorContacto}
                </p>
              )}

              <button
                type="button"
                onClick={guardarNuevoContacto}
                disabled={!nuevoContacto.nombre.trim() || guardandoContacto}
                className="w-full flex items-center justify-center gap-2 bg-[#3B5BFF] text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-40 hover:bg-[#2f49d6] transition-colors"
              >
                {guardandoContacto ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                Crear contacto
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}