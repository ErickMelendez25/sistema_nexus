"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  Search,
  Loader2,
  Phone,
  Mail,
  MapPin,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Building2,
  Users,
  Cake,
  StickyNote,
  Star,
  AlertTriangle,
  Copy,
  Check,
  Hash,
  CalendarDays,
  Download,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_HELBOT_API || "http://localhost:4001";
const BASE = `${API_BASE}/api/clientes`;
const POR_PAGINA = 10;

/* ============================== Tipos ============================== */
interface Cliente {
  id: number;
  erp_id: number;
  razon_social: string;
  ruc: string | null;
  codigo_unidad_ejecutora: string | null;
  sede: string | null;
  direccion: string | null;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  telefono: string | null;
  email: string | null;
  activo: number;
  promedio_cobranza: number | string | null;
  n_contactos: number;
  sincronizado_en: string | null;
}

interface ContactoCliente {
  id: number;
  erp_contacto_id: number;
  nombre: string | null;
  cargo: string | null;
  telefono: string | null;
  email: string | null;
  tipo: string | null;
  cumpleanos: string | null;
  nota: string | null;
  usuario_destacado: string | null;
  erp_creado_en: string | null;
  erp_actualizado_en: string | null;
  sincronizado_en: string | null;
}

interface Filtros {
  departamentos: string[];
  provincias: string[];
  distritos: string[];
}

interface EstadoSync {
  corriendo: boolean;
  total: number;
  hechos: number;
  contactos: number;
  fallidos: number;
  error: string | null;
}

/* ============================== Helpers ============================== */
const conZ = (iso: string) => (/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);

// Cumpleaños: el ERP lo guarda como medianoche de Perú (05:00 UTC), se muestra en UTC
// para que no se corra un día. Sin año, porque solo importa día y mes.
const fmtCumple = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(conZ(iso));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "long", timeZone: "UTC" });
};

const fmtFecha = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(conZ(iso));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
};

const fmtMonto = (v: number | string | null) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const soloTel = (t: string | null) => (t ? t.replace(/[^\d+]/g, "") : "");

/* ============================== Componente ============================== */
export function ModalConsultarClientes({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  // filtros
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [departamento, setDepartamento] = useState("");
  const [provincia, setProvincia] = useState("");
  const [distrito, setDistrito] = useState("");
  const [activo, setActivo] = useState("");
  const [conContactos, setConContactos] = useState("");
  const [pagina, setPagina] = useState(1);

  // datos
  const [filtros, setFiltros] = useState<Filtros>({ departamentos: [], provincias: [], distritos: [] });
  const [items, setItems] = useState<Cliente[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  // sync
  const [sincronizando, setSincronizando] = useState(false);
  const [estadoSync, setEstadoSync] = useState<EstadoSync | null>(null);
  const [msgSync, setMsgSync] = useState("");
  const [exportando, setExportando] = useState(false);

  // drawer de contactos
  const [clienteSel, setClienteSel] = useState<Cliente | null>(null);

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));

  /* ---- debounce del buscador ---- */
  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      setPagina(1);
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  /* ---- cargar filtros en cascada ---- */
  const cargarFiltros = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (departamento) p.set("departamento", departamento);
      if (provincia) p.set("provincia", provincia);
      const r = await fetch(`${BASE}/filtros?${p}`);
      if (r.ok) setFiltros(await r.json());
    } catch {
      /* los filtros son opcionales */
    }
  }, [departamento, provincia]);

  useEffect(() => {
    if (abierto) cargarFiltros();
  }, [abierto, cargarFiltros]);

  /* ---- buscar ---- */
  const buscar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const p = new URLSearchParams({ page: String(pagina), limit: String(POR_PAGINA) });
      if (qDebounced.trim()) p.set("q", qDebounced.trim());
      if (departamento) p.set("departamento", departamento);
      if (provincia) p.set("provincia", provincia);
      if (distrito) p.set("distrito", distrito);
      if (activo) p.set("activo", activo);
      if (conContactos) p.set("con_contactos", conContactos);
      const r = await fetch(`${BASE}?${p}`);
      if (!r.ok) throw new Error(`Error ${r.status}`);
      const j = await r.json();
      setItems(j.items || []);
      setTotal(j.total || 0);
    } catch (e: any) {
      setError(e?.message || "No se pudo consultar los clientes");
    } finally {
      setCargando(false);
    }
  }, [pagina, qDebounced, departamento, provincia, distrito, activo, conContactos]);

  useEffect(() => {
    if (abierto) buscar();
  }, [abierto, buscar]);

  /* ---- sincronizar con el ERP ---- */
  const sincronizar = async () => {
    setSincronizando(true);
    setMsgSync("");
    try {
      const r = await fetch(`${BASE}/sync`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `Error ${r.status}`);
      setMsgSync(`${j.leidos} clientes leídos (${j.nuevos} nuevos). Trayendo contactos…`);
      await buscar();
      await cargarFiltros();
      // sondea el progreso de contactos
      const timer = setInterval(async () => {
        try {
          const re = await fetch(`${BASE}/sync/estado`);
          const est: EstadoSync = await re.json();
          setEstadoSync(est);
          if (!est.corriendo) {
            clearInterval(timer);
            setSincronizando(false);
            setMsgSync(
              est.error
                ? `Error en contactos: ${est.error}`
                : `Listo: ${est.contactos} contactos sincronizados${est.fallidos ? ` (${est.fallidos} clientes fallaron)` : ""}.`
            );
            buscar();
          }
        } catch {
          clearInterval(timer);
          setSincronizando(false);
        }
      }, 2500);
    } catch (e: any) {
      setMsgSync(e?.message || "No se pudo sincronizar");
      setSincronizando(false);
    }
  };

  const exportarExcel = async () => {
    setExportando(true);
    setMsgSync("");
    try {
      const p = new URLSearchParams();
      if (qDebounced.trim()) p.set("q", qDebounced.trim());
      if (departamento) p.set("departamento", departamento);
      if (provincia) p.set("provincia", provincia);
      if (distrito) p.set("distrito", distrito);
      if (activo) p.set("activo", activo);
      if (conContactos) p.set("con_contactos", conContactos);
      const r = await fetch(`${BASE}/exportar/excel?${p}`);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `Error ${r.status}`);
      }
      const blob = await r.blob();
      const cd = r.headers.get("Content-Disposition") || "";
      const m = /filename="?([^";]+)"?/.exec(cd);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = m?.[1] || "clientes.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setMsgSync(e?.message || "No se pudo exportar");
    } finally {
      setExportando(false);
    }
  };

  const limpiar = () => {
    setQ("");
    setQDebounced("");
    setDepartamento("");
    setProvincia("");
    setDistrito("");
    setActivo("");
    setConContactos("");
    setPagina(1);
  };

  const hayFiltros = !!(q || departamento || provincia || distrito || activo || conContactos);

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-[1px]" onClick={onCerrar} />

      <div className="relative w-full max-w-5xl max-h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Cabecera */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
              <Users size={18} className="text-emerald-600" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-800">Consultar clientes</h2>
              <p className="text-xs text-slate-500">
                {cargando ? "Buscando…" : `${total} cliente${total !== 1 ? "s" : ""}`}
                {msgSync && <span className="ml-2 text-emerald-700">· {msgSync}</span>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={exportarExcel}
              disabled={exportando || total === 0}
              title="Descarga un Excel (una sola hoja) con los clientes que ves según los filtros"
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
            >
              {exportando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Exportar Excel
            </button>
            <button
              onClick={sincronizar}
              disabled={sincronizando}
              title="Trae clientes y contactos desde el ERP"
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:border-slate-300 disabled:opacity-60"
            >
              {sincronizando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {sincronizando && estadoSync?.corriendo && estadoSync.total > 0
                ? `Contactos ${estadoSync.hechos}/${estadoSync.total}`
                : "Sincronizar ERP"}
            </button>
            <button onClick={onCerrar} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Buscador + filtros */}
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/60 space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por razón social, RUC, código de unidad ejecutora, nombre/teléfono/correo de contacto…"
              className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-9 py-2.5 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
            />
            {q && (
              <button onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                <X size={14} />
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <Sel
              valor={departamento}
              onChange={(v) => { setDepartamento(v); setProvincia(""); setDistrito(""); setPagina(1); }}
              opciones={filtros.departamentos}
              vacio="Departamento"
            />
            <Sel
              valor={provincia}
              onChange={(v) => { setProvincia(v); setDistrito(""); setPagina(1); }}
              opciones={filtros.provincias}
              vacio="Provincia"
            />
            <Sel valor={distrito} onChange={(v) => { setDistrito(v); setPagina(1); }} opciones={filtros.distritos} vacio="Distrito" />
            <Sel
              valor={activo}
              onChange={(v) => { setActivo(v); setPagina(1); }}
              opciones={["true", "false"]}
              etiquetas={{ true: "Activos", false: "Inactivos" }}
              vacio="Estado"
            />
            <Sel
              valor={conContactos}
              onChange={(v) => { setConContactos(v); setPagina(1); }}
              opciones={["true", "false"]}
              etiquetas={{ true: "Con contactos", false: "Sin contactos" }}
              vacio="Contactos"
            />
            <button
              onClick={limpiar}
              disabled={!hayFiltros}
              className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-500 hover:text-slate-800 disabled:opacity-40"
            >
              <X size={13} /> Limpiar
            </button>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="mb-3 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
              <AlertTriangle size={15} /> {error}
            </div>
          )}

          {cargando && items.length === 0 ? (
            <div className="flex items-center justify-center gap-2 text-sm text-slate-500 py-16">
              <Loader2 size={16} className="animate-spin" /> Cargando clientes…
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-xl">
              <Building2 size={28} className="mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-semibold text-slate-700">Sin clientes</p>
              <p className="text-xs text-slate-500 mt-1">
                {hayFiltros ? "Ningún cliente coincide con los filtros." : "Aún no hay clientes. Usa «Sincronizar ERP» (necesitas la sesión del ERP activa)."}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {items.map((c) => (
                <CardCliente key={c.id} c={c} onVerContactos={() => setClienteSel(c)} />
              ))}
            </div>
          )}
        </div>

        {/* Paginador */}
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-200 bg-white">
          <p className="text-xs text-slate-400">
            {total === 0 ? "0 resultados" : `Mostrando ${(pagina - 1) * POR_PAGINA + 1}–${Math.min(pagina * POR_PAGINA, total)} de ${total}`}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina === 1}
              className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:border-slate-300 disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="px-3 text-sm text-slate-600">
              {pagina} / {totalPaginas}
            </span>
            <button
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={pagina >= totalPaginas}
              className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:border-slate-300 disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {clienteSel && <DrawerContactos cliente={clienteSel} onCerrar={() => { setClienteSel(null); buscar(); }} />}
    </div>
  );
}

/* ============================== Select simple ============================== */
function Sel({
  valor,
  onChange,
  opciones,
  vacio,
  etiquetas,
}: {
  valor: string;
  onChange: (v: string) => void;
  opciones: string[];
  vacio: string;
  etiquetas?: Record<string, string>;
}) {
  return (
    <select
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
    >
      <option value="">{vacio}: todos</option>
      {opciones.map((o) => (
        <option key={o} value={o}>
          {etiquetas?.[o] ?? o}
        </option>
      ))}
    </select>
  );
}

/* ============================== Card de cliente ============================== */
function CardCliente({ c, onVerContactos }: { c: Cliente; onVerContactos: () => void }) {
  const ubic = [c.departamento, c.provincia, c.distrito].filter(Boolean).join(" · ");
  const cobranza = fmtMonto(c.promedio_cobranza);
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 hover:border-emerald-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-slate-800 truncate" title={c.razon_social}>
              {c.razon_social}
            </p>
            <span
              className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                c.activo ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"
              }`}
            >
              {c.activo ? "ACTIVO" : "INACTIVO"}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            {c.ruc && (
              <span className="flex items-center gap-1" style={{ fontFamily: "var(--font-mono)" }}>
                <Hash size={11} className="text-slate-300" /> RUC {c.ruc}
              </span>
            )}
            {c.codigo_unidad_ejecutora && (
              <span className="flex items-center gap-1" style={{ fontFamily: "var(--font-mono)" }}>
                <Building2 size={11} className="text-slate-300" /> U.E. {c.codigo_unidad_ejecutora}
              </span>
            )}
            {c.sede && <span>Sede: {c.sede}</span>}
            {cobranza && <span>Prom. cobranza: {cobranza}</span>}
          </div>

          {(ubic || c.direccion) && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-slate-500">
              <MapPin size={12} className="text-slate-300 shrink-0 mt-0.5" />
              <span className="truncate" title={[ubic, c.direccion].filter(Boolean).join(" — ")}>
                {[ubic, c.direccion].filter(Boolean).join(" — ")}
              </span>
            </p>
          )}

          {(c.telefono || c.email) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
              {c.telefono && (
                <span className="flex items-center gap-1">
                  <Phone size={11} className="text-slate-300" /> {c.telefono}
                </span>
              )}
              {c.email && (
                <span className="flex items-center gap-1">
                  <Mail size={11} className="text-slate-300" /> {c.email}
                </span>
              )}
            </div>
          )}
        </div>

        <button
          onClick={onVerContactos}
          className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
            c.n_contactos > 0
              ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
              : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
          }`}
        >
          <Users size={14} />
          Ver contactos
          <span
            className={`text-[11px] font-bold rounded-full min-w-[20px] h-5 px-1.5 flex items-center justify-center ${
              c.n_contactos > 0 ? "bg-emerald-600 text-white" : "bg-slate-300 text-white"
            }`}
          >
            {c.n_contactos}
          </span>
        </button>
      </div>
    </div>
  );
}

/* ============================== Panel lateral de contactos ============================== */
function DrawerContactos({ cliente, onCerrar }: { cliente: Cliente; onCerrar: () => void }) {
  const [contactos, setContactos] = useState<ContactoCliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState("");
  const [copiado, setCopiado] = useState("");
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;

  const cargar = useCallback(
    async (refrescar: boolean, auto = false) => {
      refrescar ? setRefrescando(true) : setCargando(true);
      setError("");
      try {
        const r = await fetch(`${BASE}/${cliente.id}/contactos${refrescar ? "?refrescar=true" : ""}`);
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.detail || `Error ${r.status}`);
        setContactos(j.contactos || []);
      } catch (e: any) {
        setError(
          auto
            ? `No se pudo actualizar desde el ERP (${e?.message || "error"}). Mostrando los datos guardados.`
            : e?.message || "No se pudieron traer los contactos"
        );
      } finally {
        setCargando(false);
        setRefrescando(false);
      }
    },
    [cliente.id]
  );

  // Al abrir: muestra al instante lo guardado y enseguida lo actualiza desde el ERP
  useEffect(() => {
    let cancelado = false;
    (async () => {
      await cargar(false);
      if (!cancelado) await cargar(true, true);
    })();
    return () => {
      cancelado = true;
    };
  }, [cargar]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && cerrarRef.current();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const copiar = async (texto: string, key: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(key);
      setTimeout(() => setCopiado(""), 1500);
    } catch {
      /* sin permiso de portapapeles */
    }
  };

  const f = filtro.trim().toLowerCase();
  const visibles = f
    ? contactos.filter((c) =>
        [c.nombre, c.cargo, c.telefono, c.email, c.nota].some((x) => (x || "").toLowerCase().includes(f))
      )
    : contactos;

  return (
    <div className="fixed inset-0 z-[120] flex justify-end">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onCerrar} />
      <div className="relative w-full max-w-md h-full bg-white shadow-2xl flex flex-col animate-[fadeIn_0.2s_ease-out]">
        {/* Cabecera del panel */}
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Contactos del cliente</p>
              <h3 className="text-sm font-bold text-slate-800 leading-snug">{cliente.razon_social}</h3>
              <p className="text-xs text-slate-500 mt-0.5" style={{ fontFamily: "var(--font-mono)" }}>
                {cliente.ruc ? `RUC ${cliente.ruc}` : ""}
                {cliente.ruc && cliente.codigo_unidad_ejecutora ? " · " : ""}
                {cliente.codigo_unidad_ejecutora ? `U.E. ${cliente.codigo_unidad_ejecutora}` : ""}
              </p>
            </div>
            <button onClick={onCerrar} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0">
              <X size={18} />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="Filtrar contactos…"
                className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              />
            </div>
            <button
              onClick={() => cargar(true)}
              disabled={refrescando}
              title="Vuelve a consultar los contactos de este cliente en el ERP"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:border-slate-300 disabled:opacity-60"
            >
              {refrescando ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              ERP
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            {visibles.length}
            {f ? ` de ${contactos.length}` : ""} contacto{visibles.length !== 1 ? "s" : ""}
            {refrescando && <span className="ml-2 text-emerald-600">· actualizando desde el ERP…</span>}
          </p>
        </div>

        {/* Lista de contactos */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/60">
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2.5">
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          {cargando ? (
            <div className="flex items-center justify-center gap-2 text-sm text-slate-500 py-12">
              <Loader2 size={15} className="animate-spin" /> Cargando…
            </div>
          ) : visibles.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl bg-white">
              <Users size={24} className="mx-auto text-slate-300 mb-2" />
              <p className="text-sm font-semibold text-slate-700">Sin contactos</p>
              <p className="text-xs text-slate-500 mt-1">
                {f ? "Ninguno coincide con el filtro." : "Este cliente no tiene contactos. Prueba el botón «ERP» para volver a consultarlo."}
              </p>
            </div>
          ) : (
            visibles.map((c) => {
              const cumple = fmtCumple(c.cumpleanos);
              const tel = (c.telefono || "").trim();
              return (
                <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-3.5">
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center text-sm font-semibold shrink-0">
                      {(c.nombre || "?").trim().charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-slate-800 truncate" title={c.nombre || ""}>
                          {(c.nombre || "Sin nombre").trim()}
                        </p>
                        {c.usuario_destacado && (
                          <span title={`Destacado por: ${c.usuario_destacado}`}>
                            <Star size={13} className="text-amber-500 fill-amber-400 shrink-0" />
                          </span>
                        )}
                      </div>
                      {c.cargo && (
                        <span className="inline-block mt-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-[#4F46E5] border border-indigo-100">
                          {c.cargo.trim()}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs">
                    {tel && (
                      <Fila icono={<Phone size={12} />}>
                        <a href={`tel:${soloTel(tel)}`} className="text-slate-700 hover:text-emerald-700 font-medium">
                          {tel}
                        </a>
                        <BtnCopiar activo={copiado === `t${c.id}`} onClick={() => copiar(tel, `t${c.id}`)} />
                      </Fila>
                    )}
                    {c.email && (
                      <Fila icono={<Mail size={12} />}>
                        <a href={`mailto:${c.email}`} className="text-slate-700 hover:text-emerald-700 truncate">
                          {c.email}
                        </a>
                        <BtnCopiar activo={copiado === `e${c.id}`} onClick={() => copiar(c.email!, `e${c.id}`)} />
                      </Fila>
                    )}
                    {cumple && (
                      <Fila icono={<Cake size={12} />}>
                        <span className="text-slate-600">Cumpleaños: {cumple}</span>
                      </Fila>
                    )}
                    {c.nota && (
                      <Fila icono={<StickyNote size={12} />}>
                        <span className="text-slate-600 whitespace-pre-wrap">{c.nota}</span>
                      </Fila>
                    )}
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-400">
                    <span style={{ fontFamily: "var(--font-mono)" }}>ID ERP {c.erp_contacto_id}</span>
                    {c.tipo && <span>Tipo: {c.tipo}</span>}
                    <span className="flex items-center gap-1">
                      <CalendarDays size={10} /> Creado {fmtFecha(c.erp_creado_en)}
                    </span>
                    <span>Actualizado {fmtFecha(c.erp_actualizado_en)}</span>
                    {c.usuario_destacado && <span>Destacado: {c.usuario_destacado}</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function Fila({ icono, children }: { icono: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-slate-300 mt-0.5 shrink-0">{icono}</span>
      <div className="flex items-center gap-2 min-w-0 flex-1">{children}</div>
    </div>
  );
}

function BtnCopiar({ activo, onClick }: { activo: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title="Copiar" className="text-slate-300 hover:text-slate-600 shrink-0">
      {activo ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
    </button>
  );
}