"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Mail, Inbox, Send, FileEdit, Search, RefreshCw, Paperclip, X, Loader2,
  Reply, ReplyAll, Forward, Trash2, Archive, MoreHorizontal, Users,
  TrendingUp, TrendingDown, CheckCircle2, AlertCircle, Star, ChevronLeft,
  Clock, Building2,
} from "lucide-react";

/* =====================================================
   TIPOS
===================================================== */

interface MensajeCorreo {
  id: string;
  remitente: string;
  remitenteEmail: string;
  asunto: string;
  preview: string;
  cuerpo: string;
  fecha: string; // ISO
  leido: boolean;
  tieneAdjuntos: boolean;
  carpeta: "entrada" | "enviados" | "borradores";
}

interface KpisCorreo {
  sin_leer: number;
  enviados_hoy: number;
  // Correos enviados a entidades que AÚN NO tienen respuesta — el backend
  // debe cruzar el hilo de "enviados" contra "entrada" por remitente/asunto.
  // Es el dato que más le importa al negocio: a quién hay que darle seguimiento.
  pendientes_respuesta: number;
  // Entidades (direcciones únicas) distintas contactadas hoy — mide
  // alcance real del equipo, no solo volumen de correos.
  entidades_contactadas_hoy: number;
}

type Carpeta = "entrada" | "enviados" | "borradores";

interface TabCorreoProps {
  apiBase: string;
  // cuenta que Nexus está monitoreando, ej: "ventas@multilimpsac.com"
  cuentaMonitor: string;
}

/* =====================================================
   HELPERS
===================================================== */

const formatFecha = (iso: string) => {
  const fecha = new Date(iso);
  const hoy = new Date();
  const esHoy = fecha.toDateString() === hoy.toDateString();

  if (esHoy) {
    return fecha.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
  }
  return fecha.toLocaleDateString("es-PE", { day: "2-digit", month: "short" });
};

const iniciales = (nombre: string) =>
  nombre
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";

// Paleta de avatares — colores profesionales y consistentes por persona
// (mismo nombre = mismo color siempre), en vez de todos indigo parejo.
const PALETA_AVATAR = [
  { bg: "bg-indigo-50", text: "text-indigo-600", border: "border-indigo-100" },
  { bg: "bg-sky-50", text: "text-sky-600", border: "border-sky-100" },
  { bg: "bg-emerald-50", text: "text-emerald-600", border: "border-emerald-100" },
  { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-100" },
  { bg: "bg-rose-50", text: "text-rose-600", border: "border-rose-100" },
  { bg: "bg-violet-50", text: "text-violet-600", border: "border-violet-100" },
  { bg: "bg-cyan-50", text: "text-cyan-700", border: "border-cyan-100" },
];

const colorAvatar = (nombre: string) => {
  let hash = 0;
  for (let i = 0; i < nombre.length; i++) hash = nombre.charCodeAt(i) + ((hash << 5) - hash);
  return PALETA_AVATAR[Math.abs(hash) % PALETA_AVATAR.length];
};

function Avatar({ nombre, tamano = 36 }: { nombre: string; tamano?: number }) {
  const c = colorAvatar(nombre);
  return (
    <div
      style={{ width: tamano, height: tamano, fontSize: Math.max(10, Math.round(tamano * 0.36)) }}
      className={`rounded-full ${c.bg} ${c.text} border ${c.border} flex items-center justify-center font-semibold shrink-0`}
    >
      {iniciales(nombre)}
    </div>
  );
}

/* =====================================================
   MODAL: REDACTAR / RESPONDER
===================================================== */

function ModalRedactar({
  abierto,
  onCerrar,
  onEnviar,
  enviando,
  destinatarioInicial,
  asuntoInicial,
  cuerpoInicial,
}: {
  abierto: boolean;
  onCerrar: () => void;
  onEnviar: (data: { destinatarios: string[]; asunto: string; cuerpo: string }) => Promise<void>;
  enviando: boolean;
  destinatarioInicial?: string;
  asuntoInicial?: string;
  cuerpoInicial?: string;
}) {
  const [modoMasivo, setModoMasivo] = useState(false);
  const [destinatarios, setDestinatarios] = useState(destinatarioInicial || "");
  const [asunto, setAsunto] = useState(asuntoInicial || "");
  const [cuerpo, setCuerpo] = useState(cuerpoInicial || "");

  useEffect(() => {
    if (abierto) {
      setDestinatarios(destinatarioInicial || "");
      setAsunto(asuntoInicial || "");
      setCuerpo(cuerpoInicial || "");
      setModoMasivo(false);
    }
  }, [abierto, destinatarioInicial, asuntoInicial, cuerpoInicial]);

  if (!abierto) return null;

  const listaDestinatarios = destinatarios
    .split(/[,;\n]/)
    .map((d) => d.trim())
    .filter(Boolean);

  const puedeEnviar = listaDestinatarios.length > 0 && asunto.trim() && cuerpo.trim() && !enviando;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => !enviando && onCerrar()} />
      <div className="relative w-full max-w-xl bg-white border border-slate-200 rounded-2xl shadow-2xl shadow-slate-900/10 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 style={{ fontFamily: "var(--font-display)" }} className="text-[15px] font-semibold text-slate-900">
            Redactar correo
          </h3>
          <button onClick={onCerrar} disabled={enviando} className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-50">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-3.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setModoMasivo(false)}
              className={`text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                !modoMasivo ? "bg-[#4F46E5] text-white" : "bg-slate-100 text-slate-500 hover:text-slate-800"
              }`}
            >
              Individual
            </button>
            <button
              onClick={() => setModoMasivo(true)}
              className={`flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors ${
                modoMasivo ? "bg-[#4F46E5] text-white" : "bg-slate-100 text-slate-500 hover:text-slate-800"
              }`}
            >
              <Users size={12} /> Masivo
            </button>
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wide text-slate-400 mb-1 block font-medium" style={{ fontFamily: "var(--font-mono)" }}>
              {modoMasivo ? "Destinatarios (separados por coma o uno por línea)" : "Para"}
            </label>
            {modoMasivo ? (
              <textarea
                value={destinatarios}
                onChange={(e) => setDestinatarios(e.target.value)}
                rows={3}
                placeholder="correo1@empresa.com, correo2@empresa.com..."
                className="w-full text-[13px] bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-none"
              />
            ) : (
              <input
                value={destinatarios}
                onChange={(e) => setDestinatarios(e.target.value)}
                placeholder="destinatario@empresa.com"
                className="w-full text-[13px] bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
              />
            )}
            {modoMasivo && listaDestinatarios.length > 0 && (
              <p className="text-[10px] text-slate-400 mt-1">{listaDestinatarios.length} destinatario(s) detectado(s)</p>
            )}
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wide text-slate-400 mb-1 block font-medium" style={{ fontFamily: "var(--font-mono)" }}>
              Asunto
            </label>
            <input
              value={asunto}
              onChange={(e) => setAsunto(e.target.value)}
              placeholder="Asunto del mensaje"
              className="w-full text-[13px] bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase tracking-wide text-slate-400 mb-1 block font-medium" style={{ fontFamily: "var(--font-mono)" }}>
              Mensaje
            </label>
            <textarea
              value={cuerpo}
              onChange={(e) => setCuerpo(e.target.value)}
              rows={8}
              placeholder="Escribe tu mensaje..."
              className="w-full text-[13px] bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-none"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50">
          <button
            onClick={onCerrar}
            disabled={enviando}
            className="px-4 py-2 rounded-lg text-[12.5px] font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => onEnviar({ destinatarios: listaDestinatarios, asunto, cuerpo })}
            disabled={!puedeEnviar}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] transition-colors disabled:opacity-40"
          >
            {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {enviando ? "Enviando..." : modoMasivo ? "Enviar a todos" : "Enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =====================================================
   KPI PILL — franja de estadísticas compacta
===================================================== */

function KpiPill({
  icon: Icono,
  label,
  valor,
  tono,
  destacado,
}: {
  icon: typeof Inbox;
  label: string;
  valor: number;
  tono: "indigo" | "amber" | "emerald" | "red";
  /** Resalta esta card como la más importante (fondo + borde de color),
   * en vez del blanco neutro que usan las demás KPI. */
  destacado?: boolean;
}) {
  const estilos = {
    indigo: { bg: "bg-indigo-50", text: "text-[#4F46E5]", borde: "border-indigo-200" },
    amber: { bg: "bg-amber-50", text: "text-amber-600", borde: "border-amber-200" },
    emerald: { bg: "bg-emerald-50", text: "text-emerald-600", borde: "border-emerald-200" },
    red: { bg: "bg-red-50", text: "text-red-600", borde: "border-red-200" },
  }[tono];

  return (
    <div
      className={`flex items-center gap-3 rounded-xl px-4 py-2.5 flex-1 min-w-[170px] border ${
        destacado ? `${estilos.bg} ${estilos.borde}` : "bg-white border-slate-200"
      }`}
    >
      <div className={`w-9 h-9 rounded-lg ${estilos.bg} ${estilos.text} flex items-center justify-center shrink-0`}>
        <Icono size={16} />
      </div>
      <div className="min-w-0">
        <p
          className={`text-[10px] uppercase tracking-wide font-medium leading-none mb-1 ${destacado ? estilos.text : "text-slate-400"}`}
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {label}
        </p>
        <span
          style={{ fontFamily: "var(--font-display)" }}
          className={`text-lg font-bold leading-none ${destacado ? estilos.text : "text-slate-800"}`}
        >
          {valor}
        </span>
      </div>
    </div>
  );
}

/* =====================================================
   COMPONENTE PRINCIPAL
===================================================== */

export default function TabCorreo({ apiBase, cuentaMonitor }: TabCorreoProps) {
  const [carpeta, setCarpeta] = useState<Carpeta>("entrada");
  const [mensajes, setMensajes] = useState<MensajeCorreo[]>([]);
  const [seleccionado, setSeleccionado] = useState<MensajeCorreo | null>(null);
    const [kpis, setKpis] = useState<KpisCorreo>({ sin_leer: 0, enviados_hoy: 0, pendientes_respuesta: 0, entidades_contactadas_hoy: 0 });
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [datosRespuesta, setDatosRespuesta] = useState<{ destinatario?: string; asunto?: string; cuerpo?: string }>({});

  /* -------- CARGA DE DATOS -------- */

  const cargarKpis = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/email/kpis?cuenta=${encodeURIComponent(cuentaMonitor)}`);
      const data = await res.json();
      // Fallback defensivo — si el backend no manda un campo, no se
      // propaga `undefined` hacia el render (eso era lo que producía
      // "NaN%" y números vacíos en las KPI cards).
      setKpis({
        sin_leer: Number(data?.sin_leer) || 0,
        enviados_hoy: Number(data?.enviados_hoy) || 0,
        pendientes_respuesta: Number(data?.pendientes_respuesta) || 0,
        entidades_contactadas_hoy: Number(data?.entidades_contactadas_hoy) || 0,
      });
    } catch (e) {
      console.error("Error cargando KPIs de correo:", e);
    }
  }, [apiBase, cuentaMonitor]);

  const cargarMensajes = useCallback(async (mostrarRefresh = false) => {
    if (mostrarRefresh) setRefrescando(true);
    try {
      const res = await fetch(
        `${apiBase}/api/email/mensajes?cuenta=${encodeURIComponent(cuentaMonitor)}&carpeta=${carpeta}`
      );
      const data = await res.json();
      setMensajes(Array.isArray(data?.mensajes) ? data.mensajes : []);
    } catch (e) {
      console.error("Error cargando mensajes:", e);
      setMensajes([]);
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, [apiBase, cuentaMonitor, carpeta]);

  useEffect(() => {
    setCargando(true);
    cargarMensajes();
  }, [cargarMensajes]);

  useEffect(() => {
    cargarKpis();
    const interval = setInterval(cargarKpis, 60000);
    return () => clearInterval(interval);
  }, [cargarKpis]);

  const abrirMensaje = async (msg: MensajeCorreo) => {
    setSeleccionado(msg);
    if (!msg.leido) {
      setMensajes((prev) => prev.map((m) => (m.id === msg.id ? { ...m, leido: true } : m)));
      try {
        await fetch(`${apiBase}/api/email/mensajes/${msg.id}/leido`, { method: "PATCH" });
        cargarKpis();
      } catch (e) {
        console.error("Error marcando como leído:", e);
      }
    }
  };

  const manejarEnviar = async ({ destinatarios, asunto, cuerpo }: { destinatarios: string[]; asunto: string; cuerpo: string }) => {
    setEnviando(true);
    try {
      const endpoint = destinatarios.length > 1 ? "/api/email/enviar-masivo" : "/api/email/enviar";
      await fetch(`${apiBase}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cuenta: cuentaMonitor, destinatarios, asunto, cuerpo }),
      });
      setModalAbierto(false);
      cargarKpis();
      if (carpeta === "enviados") cargarMensajes();
    } catch (e) {
      console.error("Error enviando correo:", e);
    } finally {
      setEnviando(false);
    }
  };

  const abrirRespuesta = (msg: MensajeCorreo) => {
    setDatosRespuesta({
      destinatario: msg.remitenteEmail,
      asunto: msg.asunto.startsWith("RE:") ? msg.asunto : `RE: ${msg.asunto}`,
      cuerpo: `\n\n---\nEl ${formatFecha(msg.fecha)}, ${msg.remitente} escribió:\n${msg.preview}`,
    });
    setModalAbierto(true);
  };

  const abrirNuevo = () => {
    setDatosRespuesta({});
    setModalAbierto(true);
  };

  /* -------- FILTRO LOCAL DE BÚSQUEDA -------- */

  const mensajesFiltrados = useMemo(() => {
    if (!busqueda.trim()) return mensajes;
    const q = busqueda.toLowerCase();
    return mensajes.filter(
      (m) =>
        m.asunto.toLowerCase().includes(q) ||
        m.remitente.toLowerCase().includes(q) ||
        m.preview.toLowerCase().includes(q)
    );
  }, [mensajes, busqueda]);

  const carpetas: { id: Carpeta; label: string; icon: typeof Inbox }[] = [
    { id: "entrada", label: "Entrada", icon: Inbox },
    { id: "enviados", label: "Enviados", icon: Send },
    { id: "borradores", label: "Borradores", icon: FileEdit },
  ];

  return (
    <div className="flex flex-col h-full bg-white">
      {/* ============== HEADER ============== */}
      <div className="shrink-0 flex items-center justify-between gap-4 px-6 py-3.5 border-b border-slate-200">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-indigo-50 text-[#4F46E5] flex items-center justify-center shrink-0">
            <Mail size={17} />
          </div>
          <div className="min-w-0">
            <h2 style={{ fontFamily: "var(--font-display)" }} className="text-[15px] font-semibold text-slate-900 leading-tight">
              Correo
            </h2>
            <p style={{ fontFamily: "var(--font-mono)" }} className="text-[11px] text-slate-400 truncate">
              {cuentaMonitor}
            </p>
          </div>
        </div>

        <button
          onClick={abrirNuevo}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] transition-colors shrink-0"
        >
          <FileEdit size={14} />
          Redactar
        </button>
      </div>

      {/* ============== KPIs ============== */}
      <div className="shrink-0 flex flex-wrap gap-3 px-6 py-3 border-b border-slate-200 bg-slate-50/60">
        <KpiPill icon={Clock} label="Pendientes de respuesta" valor={kpis.pendientes_respuesta} tono="red" destacado />
        <KpiPill icon={AlertCircle} label="Sin leer" valor={kpis.sin_leer} tono="amber" />
        <KpiPill icon={CheckCircle2} label="Enviados hoy" valor={kpis.enviados_hoy} tono="emerald" />
        <KpiPill icon={Building2} label="Entidades contactadas hoy" valor={kpis.entidades_contactadas_hoy} tono="indigo" />
      </div>

      {/* ============== CUERPO: carpetas + lista + lectura ============== */}
      <div className="flex flex-1 min-h-0">
        {/* Carpetas */}
        <div className="w-48 shrink-0 border-r border-slate-200 py-3 px-2 hidden md:block bg-slate-50/40">
          {carpetas.map((c) => (
            <button
              key={c.id}
              onClick={() => { setCarpeta(c.id); setSeleccionado(null); }}
              className={`flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors mb-1 ${
                carpeta === c.id
                  ? "bg-white text-[#4F46E5] border border-slate-200 shadow-sm shadow-slate-900/5"
                  : "text-slate-500 hover:bg-white/70 hover:text-slate-800"
              }`}
            >
              <c.icon size={15} />
              {c.label}
            </button>
          ))}
        </div>

        {/* Lista de mensajes */}
        <div className={`${seleccionado ? "hidden lg:flex" : "flex"} flex-col w-full lg:w-[380px] shrink-0 border-r border-slate-200`}>
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-200">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar correo..."
                className="w-full text-[12px] bg-slate-50 border border-slate-200 rounded-md pl-7 pr-2 py-1.5 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
              />
            </div>
            <button
              onClick={() => cargarMensajes(true)}
              title="Actualizar"
              className="p-1.5 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0"
            >
              <RefreshCw size={14} className={refrescando ? "animate-spin" : ""} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {cargando ? (
              <div className="flex items-center justify-center py-12 text-slate-400">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : mensajesFiltrados.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
                <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mb-3">
                  <Mail size={20} className="text-slate-300" />
                </div>
                <p className="text-[12.5px] text-slate-500 font-medium">
                  {busqueda ? "Sin resultados para tu búsqueda" : "No hay mensajes aquí"}
                </p>
                <p className="text-[11px] text-slate-400 mt-1">
                  {busqueda ? "Prueba con otro término." : "Los correos nuevos aparecerán en esta carpeta."}
                </p>
              </div>
            ) : (
              mensajesFiltrados.map((m) => (
                <button
                  key={m.id}
                  onClick={() => abrirMensaje(m)}
                  className={`flex items-start gap-2.5 w-full text-left px-3 py-3 border-b border-slate-100 transition-colors ${
                    seleccionado?.id === m.id
                      ? "bg-indigo-50/70 border-l-2 border-l-[#4F46E5] pl-[10px]"
                      : "hover:bg-slate-50"
                  }`}
                >
                  <Avatar nombre={m.remitente} tamano={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[12.5px] truncate ${!m.leido ? "font-semibold text-slate-900" : "font-medium text-slate-600"}`}>
                        {m.remitente}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0" style={{ fontFamily: "var(--font-mono)" }}>
                        {formatFecha(m.fecha)}
                      </span>
                    </div>
                    <p className={`text-[12px] truncate ${!m.leido ? "text-slate-800" : "text-slate-500"}`}>{m.asunto}</p>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5">{m.preview}</p>
                  </div>
                  <div className="flex flex-col items-center gap-1 shrink-0 mt-1">
                    {!m.leido && <span className="w-1.5 h-1.5 rounded-full bg-[#4F46E5]" />}
                    {m.tieneAdjuntos && <Paperclip size={11} className="text-slate-400" />}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Panel de lectura */}
        <div className={`${seleccionado ? "flex" : "hidden lg:flex"} flex-1 flex-col min-w-0 bg-white`}>
          {!seleccionado ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center px-6">
              <div className="w-14 h-14 rounded-full bg-slate-50 flex items-center justify-center mb-3">
                <Mail size={24} className="text-slate-300" />
              </div>
              <p className="text-[13px] text-slate-500 font-medium">Selecciona un mensaje para leerlo</p>
              <p className="text-[11px] text-slate-400 mt-1">Elige un correo de la lista de la izquierda.</p>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
                <div className="min-w-0">
                  <button
                    onClick={() => setSeleccionado(null)}
                    className="lg:hidden flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800 mb-2 font-medium"
                  >
                    <ChevronLeft size={13} /> Volver
                  </button>
                  <h3 style={{ fontFamily: "var(--font-display)" }} className="text-[16px] font-semibold text-slate-900 truncate">
                    {seleccionado.asunto}
                  </h3>
                  <div className="flex items-center gap-2 mt-2">
                    <Avatar nombre={seleccionado.remitente} tamano={28} />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-medium text-slate-800 truncate">{seleccionado.remitente}</p>
                      <p className="text-[10.5px] text-slate-400 truncate" style={{ fontFamily: "var(--font-mono)" }}>
                        {seleccionado.remitenteEmail} · {new Date(seleccionado.fecha).toLocaleString("es-PE")}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => abrirRespuesta(seleccionado)}
                    title="Responder"
                    className="p-2 rounded-md text-slate-400 hover:text-[#4F46E5] hover:bg-indigo-50 transition-colors"
                  >
                    <Reply size={15} />
                  </button>
                  <button title="Responder a todos" className="p-2 rounded-md text-slate-400 hover:text-[#4F46E5] hover:bg-indigo-50 transition-colors">
                    <ReplyAll size={15} />
                  </button>
                  <button title="Reenviar" className="p-2 rounded-md text-slate-400 hover:text-[#4F46E5] hover:bg-indigo-50 transition-colors">
                    <Forward size={15} />
                  </button>
                  <span className="w-px h-5 bg-slate-200 mx-1" />
                  <button title="Archivar" className="p-2 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                    <Archive size={15} />
                  </button>
                  <button title="Eliminar" className="p-2 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2 size={15} />
                  </button>
                  <button title="Más opciones" className="p-2 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
                    <MoreHorizontal size={15} />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5">
                <p className="text-[13.5px] text-slate-700 leading-relaxed whitespace-pre-wrap">{seleccionado.cuerpo}</p>
              </div>

              <div className="shrink-0 px-5 py-3 border-t border-slate-200 flex items-center gap-2">
                <button
                  onClick={() => abrirRespuesta(seleccionado)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12.5px] font-medium text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors"
                >
                  <Reply size={14} />
                  Responder
                </button>
                <button
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-[12.5px] font-medium text-slate-600 bg-slate-50 border border-slate-200 hover:bg-slate-100 transition-colors"
                >
                  <Forward size={14} />
                  Reenviar
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <ModalRedactar
        abierto={modalAbierto}
        onCerrar={() => setModalAbierto(false)}
        onEnviar={manejarEnviar}
        enviando={enviando}
        destinatarioInicial={datosRespuesta.destinatario}
        asuntoInicial={datosRespuesta.asunto}
        cuerpoInicial={datosRespuesta.cuerpo}
      />
    </div>
  );
}