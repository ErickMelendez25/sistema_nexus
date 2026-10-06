"use client";

import { useCallback, useEffect, useState } from "react";
import {
  X,
  Search,
  Loader2,
  Phone,
  MapPin,
  RefreshCw,
  Plus,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Store,
  Package,
  Truck,
  History,
  Tag,
  Database,
  AlertTriangle,
  Building2,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_HELBOT_API || "http://localhost:4001";
const BASE = `${API_BASE}/api/proveedores`;
const POR_PAGINA = 10;

/* ============================== Tipos ============================== */
interface Contacto {
  id: number;
  nombre: string | null;
  cargo: string | null;
  telefono: string | null;
  email: string | null;
  origen: "erp" | "nexus";
}
interface Etiqueta {
  id: number;
  tipo: "marca" | "categoria" | "catalogo";
  valor: string;
}
interface Historial {
  ops: number;
  marcas: string[];
  categorias: string[];
  catalogos: string[];
  zonas: string[];
}
interface Proveedor {
  id: number;
  erp_id: number | null;
  razon_social: string;
  ruc: string | null;
  direccion: string | null;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  telefono_erp: string | null;
  email: string | null;
  contactos: Contacto[];
  etiquetas: Etiqueta[];
  historial?: Historial;
}
interface Filtros {
  departamentos: string[];
  provincias: string[];
  distritos: string[];
  marcas: string[];
  categorias: string[];
  catalogos: string[];
  zona_departamentos?: string[];
  zona_provincias?: string[];
  zona_distritos?: string[];
}
interface Resumen {
  filas: number;
  ops: number;
  proveedores: number;
  con_marca: number;
  con_categoria: number;
  con_catalogo: number;
}

interface Texto {
  q: string;
  marca: string;
  categoria: string;
  catalogo: string;
}
interface Sel {
  dep: string;
  prov: string;
  dist: string;
  zdep: string;
  zprov: string;
  zdist: string;
}

const TEXTO_VACIO: Texto = { q: "", marca: "", categoria: "", catalogo: "" };
const SEL_VACIO: Sel = { dep: "", prov: "", dist: "", zdep: "", zprov: "", zdist: "" };

const ESTILO_ETIQUETA: Record<string, string> = {
  marca: "bg-violet-50 text-violet-700 border-violet-200",
  categoria: "bg-emerald-50 text-emerald-700 border-emerald-200",
  catalogo: "bg-amber-50 text-amber-700 border-amber-200",
};

/* ============================ Utilidades ============================ */
const sinTildes = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const coincide = (valor: string, filtro: string) =>
  !!filtro.trim() && sinTildes(valor).includes(sinTildes(filtro));

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/* ============================= Modal ============================= */
export function ModalConsultarProveedores({
  abierto,
  onCerrar,
}: {
  abierto: boolean;
  onCerrar: () => void;
}) {
  const [texto, setTexto] = useState<Texto>(TEXTO_VACIO);
  const [textoDeb, setTextoDeb] = useState<Texto>(TEXTO_VACIO);
  const [sel, setSel] = useState<Sel>(SEL_VACIO);
  const [pagina, setPagina] = useState(1);
  const [recarga, setRecarga] = useState(0);
  const [verUbicacionProv, setVerUbicacionProv] = useState(false);

  const [filtros, setFiltros] = useState<Filtros | null>(null);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [items, setItems] = useState<Proveedor[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const [sincProv, setSincProv] = useState(false);
  const [iniciandoHist, setIniciandoHist] = useState(false);
  const [sondeo, setSondeo] = useState(0); // ticks restantes de actualización automática
  const [mensaje, setMensaje] = useState("");

  const hayZona = !!(sel.zdep || sel.zprov || sel.zdist);
  const hayVendio = !!(texto.marca.trim() || texto.categoria.trim() || texto.catalogo.trim());

  /* ---- debounce de los campos de texto ---- */
  useEffect(() => {
    const t = setTimeout(() => {
      setTextoDeb(texto);
      setPagina(1);
    }, 350);
    return () => clearTimeout(t);
  }, [texto]);

  /* ---- reset al cerrar ---- */
  useEffect(() => {
    if (!abierto) {
      setTexto(TEXTO_VACIO);
      setTextoDeb(TEXTO_VACIO);
      setSel(SEL_VACIO);
      setPagina(1);
      setItems([]);
      setTotal(0);
      setError("");
      setMensaje("");
      setSondeo(0);
      setVerUbicacionProv(false);
    }
  }, [abierto]);

  /* ---- Esc para cerrar + bloquear scroll del fondo ---- */
  useEffect(() => {
    if (!abierto) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    document.addEventListener("keydown", onKey);
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previo;
    };
  }, [abierto, onCerrar]);

  /* ---- opciones de dropdowns (cascadas) ---- */
  useEffect(() => {
    if (!abierto) return;
    const params = new URLSearchParams();
    if (sel.dep) params.set("departamento", sel.dep);
    if (sel.prov) params.set("provincia", sel.prov);
    if (sel.zdep) params.set("zona_departamento", sel.zdep);
    if (sel.zprov) params.set("zona_provincia", sel.zprov);
    fetch(`${BASE}/filtros?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setFiltros)
      .catch(() => setFiltros(null));
  }, [abierto, sel.dep, sel.prov, sel.zdep, sel.zprov, recarga]);

  /* ---- resumen del historial (cobertura de datos) ---- */
  const cargarResumen = useCallback(() => {
    fetch(`${BASE}/historial/resumen`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) =>
        setResumen({
          filas: num(d.filas),
          ops: num(d.ops),
          proveedores: num(d.proveedores),
          con_marca: num(d.con_marca),
          con_categoria: num(d.con_categoria),
          con_catalogo: num(d.con_catalogo),
        })
      )
      .catch(() => setResumen(null));
  }, []);

  useEffect(() => {
    if (abierto) cargarResumen();
  }, [abierto, cargarResumen]);

  /* ---- actualización automática mientras corre el sync del historial ---- */
  useEffect(() => {
    if (!abierto || sondeo <= 0) return;
    const t = setTimeout(() => {
      cargarResumen();
      setRecarga((x) => x + 1);
      setSondeo((s) => s - 1);
    }, 5000);
    return () => clearTimeout(t);
  }, [abierto, sondeo, cargarResumen]);

  /* ---- búsqueda ---- */
  useEffect(() => {
    if (!abierto) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (textoDeb.q.trim()) params.set("q", textoDeb.q.trim());
    if (textoDeb.marca.trim()) params.set("marca", textoDeb.marca.trim());
    if (textoDeb.categoria.trim()) params.set("categoria", textoDeb.categoria.trim());
    if (textoDeb.catalogo.trim()) params.set("catalogo", textoDeb.catalogo.trim());
    if (sel.dep) params.set("departamento", sel.dep);
    if (sel.prov) params.set("provincia", sel.prov);
    if (sel.dist) params.set("distrito", sel.dist);
    if (sel.zdep) params.set("zona_departamento", sel.zdep);
    if (sel.zprov) params.set("zona_provincia", sel.zprov);
    if (sel.zdist) params.set("zona_distrito", sel.zdist);
    params.set("page", String(pagina));
    params.set("limit", String(POR_PAGINA));

    setCargando(true);
    setError("");
    fetch(`${BASE}?${params.toString()}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        setItems(data.items || []);
        setTotal(data.total || 0);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError("No se pudo consultar los proveedores.");
      })
      .finally(() => setCargando(false));

    return () => controller.abort();
  }, [abierto, textoDeb, sel, pagina, recarga]);

  /* ---- sincronizaciones ---- */
  const sincronizarProveedores = useCallback(async () => {
    setSincProv(true);
    setMensaje("");
    try {
      const r = await fetch(`${BASE}/sync`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMensaje(data.detail || "No se pudo sincronizar los proveedores con el ERP.");
      } else {
        setMensaje(
          `Proveedores sincronizados: ${data.leidos} leídos, ${data.nuevos} nuevos. Los contactos se cargan en segundo plano.`
        );
        setRecarga((x) => x + 1);
      }
    } catch {
      setMensaje("No se pudo conectar con el backend.");
    } finally {
      setSincProv(false);
    }
  }, []);

  const sincronizarHistorial = useCallback(async () => {
    setIniciandoHist(true);
    setMensaje("");
    try {
      const r = await fetch(`${BASE}/historial/sync`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMensaje(data.detail || "No se pudo iniciar la lectura de OPs.");
      } else {
        setMensaje(
          "Leyendo las OPs del ERP en segundo plano. Los números se actualizan solos durante unos 2 minutos."
        );
        setSondeo(24);
      }
    } catch {
      setMensaje("No se pudo conectar con el backend.");
    } finally {
      setIniciandoHist(false);
    }
  }, []);

  /* ---- cambios de filtros ---- */
  const setSelect = (campo: keyof Sel, valor: string) => {
    setSel((s) => {
      const n = { ...s, [campo]: valor };
      if (campo === "dep") {
        n.prov = "";
        n.dist = "";
      }
      if (campo === "prov") n.dist = "";
      if (campo === "zdep") {
        n.zprov = "";
        n.zdist = "";
      }
      if (campo === "zprov") n.zdist = "";
      return n;
    });
    setPagina(1);
  };

  const setCampoTexto = (campo: keyof Texto, valor: string) =>
    setTexto((t) => ({ ...t, [campo]: valor }));

  const limpiarTodo = () => {
    setTexto(TEXTO_VACIO);
    setTextoDeb(TEXTO_VACIO);
    setSel(SEL_VACIO);
    setPagina(1);
  };

  /* ---- chips de filtros activos ---- */
  const activos: { id: string; grupo: string; valor: string; quitar: () => void }[] = [];
  if (texto.q.trim())
    activos.push({ id: "q", grupo: "Búsqueda", valor: texto.q.trim(), quitar: () => setCampoTexto("q", "") });
  if (texto.marca.trim())
    activos.push({ id: "marca", grupo: "Marca", valor: texto.marca.trim(), quitar: () => setCampoTexto("marca", "") });
  if (texto.categoria.trim())
    activos.push({ id: "categoria", grupo: "Categoría", valor: texto.categoria.trim(), quitar: () => setCampoTexto("categoria", "") });
  if (texto.catalogo.trim())
    activos.push({ id: "catalogo", grupo: "Catálogo", valor: texto.catalogo.trim(), quitar: () => setCampoTexto("catalogo", "") });
  if (sel.zdep) activos.push({ id: "zdep", grupo: "Entrega: dpto.", valor: sel.zdep, quitar: () => setSelect("zdep", "") });
  if (sel.zprov) activos.push({ id: "zprov", grupo: "Entrega: prov.", valor: sel.zprov, quitar: () => setSelect("zprov", "") });
  if (sel.zdist) activos.push({ id: "zdist", grupo: "Entrega: dist.", valor: sel.zdist, quitar: () => setSelect("zdist", "") });
  if (sel.dep) activos.push({ id: "dep", grupo: "Ubicado en dpto.", valor: sel.dep, quitar: () => setSelect("dep", "") });
  if (sel.prov) activos.push({ id: "prov", grupo: "Ubicado en prov.", valor: sel.prov, quitar: () => setSelect("prov", "") });
  if (sel.dist) activos.push({ id: "dist", grupo: "Ubicado en dist.", valor: sel.dist, quitar: () => setSelect("dist", "") });

  const totalPaginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const desde = total === 0 ? 0 : (pagina - 1) * POR_PAGINA + 1;
  const hasta = Math.min(total, pagina * POR_PAGINA);
  const historialVacio = resumen !== null && resumen.filas === 0;
  const sincronizandoHistorial = iniciandoHist || sondeo > 0;

  if (!abierto) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-3 overflow-y-auto"
      onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Consultar proveedores"
        className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 my-4"
      >
        {/* ======================= Header ======================= */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
              <Store size={16} className="text-indigo-600" />
            </div>
            <div>
              <h2 className="text-[14px] font-bold text-slate-800 leading-tight">Consultar proveedores</h2>
              <p className="text-[11px] text-slate-400 leading-tight">
                Encuentra quién ya vendió una marca, categoría o catálogo, y a dónde entregó
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={sincronizarProveedores}
              disabled={sincProv}
              title="Trae la lista de proveedores y sus contactos del ERP"
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 text-[11px] font-medium text-slate-600 px-2.5 py-1.5 hover:border-slate-300 hover:text-slate-800 disabled:opacity-50"
            >
              {sincProv ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Proveedores
            </button>
            <button
              onClick={sincronizarHistorial}
              disabled={sincronizandoHistorial}
              title="Lee las OPs del ERP y arma el historial: qué vendió cada proveedor y a dónde"
              className="flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-[11px] font-medium text-indigo-700 px-2.5 py-1.5 hover:bg-indigo-100 disabled:opacity-60"
            >
              {sincronizandoHistorial ? <Loader2 size={12} className="animate-spin" /> : <History size={12} />}
              {sondeo > 0 ? "Actualizando historial…" : "Historial de OPs"}
            </button>
            <button
              onClick={onCerrar}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Cerrar"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {/* ===================== Avisos ===================== */}
          {mensaje && (
            <p className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              {mensaje}
            </p>
          )}

          {historialVacio && (
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
              <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-800 leading-relaxed">
                Todavía no hay historial de OPs, por eso los filtros de marca, categoría, catálogo y zona de
                entrega salen vacíos. Pulsa primero <b>Proveedores</b> y después <b>Historial de OPs</b>.
              </p>
            </div>
          )}

          {resumen && resumen.filas > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-slate-400">
              <span className="flex items-center gap-1">
                <Database size={11} />
                Historial: <b className="text-slate-500">{resumen.ops}</b> OPs ·{" "}
                <b className="text-slate-500">{resumen.proveedores}</b> proveedores
              </span>
              <span>con marca: {resumen.con_marca}/{resumen.filas}</span>
              <span>con categoría: {resumen.con_categoria}/{resumen.filas}</span>
              <span>con catálogo: {resumen.con_catalogo}/{resumen.filas}</span>
              {(resumen.con_marca === 0 || resumen.con_categoria === 0 || resumen.con_catalogo === 0) && (
                <span className="text-amber-600 font-medium">
                  · Hay datos sin leer del ERP, avisa al desarrollador
                </span>
              )}
            </div>
          )}

          {/* ===================== Buscador ===================== */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={texto.q}
              onChange={(e) => setCampoTexto("q", e.target.value)}
              placeholder="Buscar por nombre, RUC, teléfono o contacto"
              className="w-full rounded-lg border border-slate-200 pl-9 pr-3 py-2.5 text-[12.5px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
            />
          </div>

          {/* ===================== Filtros ===================== */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            <Panel
              icono={<Package size={13} />}
              titulo="Lo que vendió"
              ayuda="Según las OPs donde el proveedor ya participó"
              color="violet"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3 gap-2">
                <CampoTexto
                  etiqueta="Marca"
                  lista="prov-marcas"
                  valor={texto.marca}
                  onChange={(v) => setCampoTexto("marca", v)}
                  placeholder="Ej. Bticino"
                />
                <CampoTexto
                  etiqueta="Categoría"
                  lista="prov-categorias"
                  valor={texto.categoria}
                  onChange={(v) => setCampoTexto("categoria", v)}
                  placeholder="Ej. Cable"
                />
                <CampoTexto
                  etiqueta="Catálogo"
                  lista="prov-catalogos"
                  valor={texto.catalogo}
                  onChange={(v) => setCampoTexto("catalogo", v)}
                  placeholder="Ej. Útiles"
                />
              </div>
              <datalist id="prov-marcas">
                {filtros?.marcas.map((m) => <option key={m} value={m} />)}
              </datalist>
              <datalist id="prov-categorias">
                {filtros?.categorias.map((m) => <option key={m} value={m} />)}
              </datalist>
              <datalist id="prov-catalogos">
                {filtros?.catalogos.map((m) => <option key={m} value={m} />)}
              </datalist>
            </Panel>

            <Panel
              icono={<Truck size={13} />}
              titulo="A dónde entregó"
              ayuda="Zona de entrega de esas OPs (no la dirección del proveedor)"
              color="sky"
            >
              <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3 gap-2">
                <CampoSelect
                  etiqueta="Departamento"
                  valor={sel.zdep}
                  onChange={(v) => setSelect("zdep", v)}
                  opciones={filtros?.zona_departamentos}
                />
                <CampoSelect
                  etiqueta="Provincia"
                  valor={sel.zprov}
                  onChange={(v) => setSelect("zprov", v)}
                  opciones={filtros?.zona_provincias}
                />
                <CampoSelect
                  etiqueta="Distrito"
                  valor={sel.zdist}
                  onChange={(v) => setSelect("zdist", v)}
                  opciones={filtros?.zona_distritos}
                />
              </div>
              {hayZona && hayVendio && (
                <p className="mt-2 text-[10.5px] text-sky-700 bg-sky-50 border border-sky-100 rounded-md px-2 py-1.5">
                  Se buscan proveedores que vendieron eso <b>en esa misma zona</b> (en la misma OP).
                </p>
              )}
            </Panel>
          </div>

          {/* Ubicación del proveedor (plegable) */}
          <div className="rounded-xl border border-slate-200">
            <button
              onClick={() => setVerUbicacionProv((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-left"
              aria-expanded={verUbicacionProv || !!(sel.dep || sel.prov || sel.dist)}
            >
              <span className="flex items-center gap-2 text-[12px] font-semibold text-slate-600">
                <Building2 size={13} className="text-slate-400" />
                Dónde está el proveedor
                <span className="text-[10.5px] font-normal text-slate-400">
                  su dirección registrada en el ERP
                </span>
              </span>
              <ChevronDown
                size={14}
                className={`text-slate-400 transition-transform ${
                  verUbicacionProv || sel.dep || sel.prov || sel.dist ? "rotate-180" : ""
                }`}
              />
            </button>
            {(verUbicacionProv || sel.dep || sel.prov || sel.dist) && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 px-3 pb-3">
                <CampoSelect
                  etiqueta="Departamento"
                  valor={sel.dep}
                  onChange={(v) => setSelect("dep", v)}
                  opciones={filtros?.departamentos}
                />
                <CampoSelect
                  etiqueta="Provincia"
                  valor={sel.prov}
                  onChange={(v) => setSelect("prov", v)}
                  opciones={filtros?.provincias}
                />
                <CampoSelect
                  etiqueta="Distrito"
                  valor={sel.dist}
                  onChange={(v) => setSelect("dist", v)}
                  opciones={filtros?.distritos}
                />
              </div>
            )}
          </div>

          {/* ===================== Filtros activos + conteo ===================== */}
          <div className="flex flex-wrap items-center gap-1.5 min-h-[26px]">
            <span className="text-[11px] text-slate-500 mr-1">
              {cargando ? "Buscando…" : `${total} proveedor${total === 1 ? "" : "es"}`}
            </span>
            {activos.map((a) => (
              <span
                key={a.id}
                className="flex items-center gap-1 text-[10.5px] bg-slate-100 text-slate-600 rounded-full pl-2 pr-1 py-0.5"
              >
                <span className="text-slate-400">{a.grupo}:</span>
                <b className="font-semibold">{a.valor}</b>
                <button
                  onClick={a.quitar}
                  className="w-3.5 h-3.5 rounded-full flex items-center justify-center hover:bg-slate-300/60"
                  aria-label={`Quitar filtro ${a.grupo}`}
                >
                  <X size={9} />
                </button>
              </span>
            ))}
            {activos.length > 0 && (
              <button onClick={limpiarTodo} className="text-[11px] text-indigo-600 hover:text-indigo-800 ml-1">
                Limpiar todo
              </button>
            )}
          </div>

          {error && (
            <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* ===================== Resultados ===================== */}
          {!cargando && !error && items.length === 0 && (
            <div className="flex flex-col items-center gap-1 rounded-xl bg-slate-50 border border-dashed border-slate-200 px-3 py-6 text-center">
              <Search size={18} className="text-slate-300" />
              <p className="text-[12px] font-medium text-slate-500">No hay proveedores con esos filtros</p>
              <p className="text-[11px] text-slate-400 max-w-md">
                {activos.length > 0
                  ? "Prueba quitando algún filtro, o revisa que el historial de OPs esté sincronizado."
                  : "Si la lista está vacía, usa \u201CProveedores\u201D y luego \u201CHistorial de OPs\u201D."}
              </p>
            </div>
          )}

          <div className="space-y-2 max-h-[52vh] overflow-y-auto pr-0.5">
            {cargando && items.length === 0 && (
              <div className="flex items-center gap-2 text-[11px] text-slate-400 px-1">
                <Loader2 size={13} className="animate-spin" /> Cargando…
              </div>
            )}
            {items.map((p) => (
              <TarjetaProveedor
                key={p.id}
                p={p}
                filtro={{
                  marca: textoDeb.marca,
                  categoria: textoDeb.categoria,
                  catalogo: textoDeb.catalogo,
                  zona: sel.zdep,
                }}
                onCambio={() => setRecarga((x) => x + 1)}
              />
            ))}
          </div>

          {/* ===================== Paginación ===================== */}
          {total > 0 && (
            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <button
                onClick={() => setPagina((x) => Math.max(1, x - 1))}
                disabled={pagina === 1}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:border-slate-300 disabled:opacity-30"
                aria-label="Página anterior"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-[11px] text-slate-500">
                {desde}–{hasta} de {total} · Página {pagina} de {totalPaginas}
              </span>
              <button
                onClick={() => setPagina((x) => Math.min(totalPaginas, x + 1))}
                disabled={pagina === totalPaginas}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:border-slate-300 disabled:opacity-30"
                aria-label="Página siguiente"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========================= Piezas de formulario ========================= */
const COLOR_PANEL: Record<string, { caja: string; icono: string; titulo: string }> = {
  violet: { caja: "border-violet-100 bg-violet-50/40", icono: "bg-violet-100 text-violet-600", titulo: "text-violet-800" },
  sky: { caja: "border-sky-100 bg-sky-50/40", icono: "bg-sky-100 text-sky-600", titulo: "text-sky-800" },
};

function Panel({
  icono,
  titulo,
  ayuda,
  color,
  children,
}: {
  icono: React.ReactNode;
  titulo: string;
  ayuda: string;
  color: "violet" | "sky";
  children: React.ReactNode;
}) {
  const c = COLOR_PANEL[color];
  return (
    <div className={`rounded-xl border p-3 ${c.caja}`}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className={`w-6 h-6 rounded-md flex items-center justify-center ${c.icono}`}>{icono}</span>
        <div className="leading-tight">
          <p className={`text-[12px] font-bold ${c.titulo}`}>{titulo}</p>
          <p className="text-[10.5px] text-slate-400">{ayuda}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function CampoTexto({
  etiqueta,
  valor,
  onChange,
  lista,
  placeholder,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  lista: string;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="block text-[10.5px] font-medium text-slate-500 mb-0.5">{etiqueta}</span>
      <input
        list={lista}
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[12px] text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
      />
    </label>
  );
}

function CampoSelect({
  etiqueta,
  valor,
  onChange,
  opciones,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
  opciones?: string[];
}) {
  return (
    <label className="block">
      <span className="block text-[10.5px] font-medium text-slate-500 mb-0.5">{etiqueta}</span>
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-[12px] text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
      >
        <option value="">Todos</option>
        {(opciones || []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ============================ Tarjeta ============================ */
function FilaChips({
  icono,
  titulo,
  items,
  filtro,
  clase,
  max = 5,
}: {
  icono: React.ReactNode;
  titulo: string;
  items: string[];
  filtro: string;
  clase: string;
  max?: number;
}) {
  const [todos, setTodos] = useState(false);
  if (items.length === 0) return null;

  // los que coinciden con el filtro van primero
  const ordenados = [...items].sort(
    (a, b) => Number(coincide(b, filtro)) - Number(coincide(a, filtro)) || a.localeCompare(b)
  );
  const visibles = todos ? ordenados : ordenados.slice(0, max);

  return (
    <div className="flex items-start gap-2">
      <span className="flex items-center gap-1 text-[10.5px] font-medium text-slate-400 w-[78px] shrink-0 pt-0.5">
        {icono}
        {titulo}
      </span>
      <div className="flex flex-wrap gap-1 min-w-0">
        {visibles.map((v) => {
          const resaltado = coincide(v, filtro);
          return (
            <span
              key={v}
              title={v}
              className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full border max-w-[240px] truncate ${clase} ${
                resaltado ? "ring-2 ring-indigo-300 font-bold" : ""
              }`}
            >
              {v}
            </span>
          );
        })}
        {items.length > max && (
          <button
            onClick={() => setTodos((t) => !t)}
            className="text-[10.5px] text-indigo-600 hover:text-indigo-800 px-1"
          >
            {todos ? "ver menos" : `+${items.length - max} más`}
          </button>
        )}
      </div>
    </div>
  );
}

function TarjetaProveedor({
  p,
  filtro,
  onCambio,
}: {
  p: Proveedor;
  filtro: { marca: string; categoria: string; catalogo: string; zona: string };
  onCambio: () => void;
}) {
  const [verEtiquetas, setVerEtiquetas] = useState(false);
  const [tipo, setTipo] = useState<"marca" | "categoria" | "catalogo">("marca");
  const [valor, setValor] = useState("");
  const [guardando, setGuardando] = useState(false);

  const h: Historial = p.historial ?? { ops: 0, marcas: [], categorias: [], catalogos: [], zonas: [] };
  const ubicacion = [p.distrito, p.provincia, p.departamento].filter(Boolean).join(", ");

  const agregar = async () => {
    if (!valor.trim()) return;
    setGuardando(true);
    try {
      await fetch(`${BASE}/${p.id}/etiquetas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, valor: valor.trim() }),
      });
      setValor("");
      onCambio();
    } finally {
      setGuardando(false);
    }
  };

  const quitar = async (id: number) => {
    await fetch(`${BASE}/etiquetas/${id}`, { method: "DELETE" });
    onCambio();
  };

  // teléfonos: contactos + el teléfono general del ERP, sin repetir
  const telefonosVistos = new Set<string>();
  const telefonos: { texto: string; nombre?: string | null; origen?: string }[] = [];
  const agregarTel = (tel?: string | null, nombre?: string | null, origen?: string) => {
    if (!tel) return;
    const key = tel.replace(/\D/g, "").replace(/^51(?=\d{9}$)/, "");
    if (!key || telefonosVistos.has(key)) return;
    telefonosVistos.add(key);
    telefonos.push({ texto: tel, nombre, origen });
  };
  p.contactos.forEach((c) => agregarTel(c.telefono, c.nombre, c.origen));
  agregarTel(p.telefono_erp, null, "erp");

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 hover:border-slate-300 transition-colors">
      {/* Cabecera */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-slate-800 truncate" title={p.razon_social}>
            {p.razon_social}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
            {p.ruc && (
              <span className="text-[11px] text-slate-500" style={{ fontFamily: "var(--font-mono)" }}>
                RUC {p.ruc}
              </span>
            )}
            {ubicacion && (
              <span className="flex items-center gap-1 text-[11px] text-slate-500 min-w-0">
                <MapPin size={11} className="text-slate-300 shrink-0" />
                <span className="truncate" title={p.direccion || ubicacion}>
                  {ubicacion}
                </span>
              </span>
            )}
          </div>
        </div>
        <span
          className={`shrink-0 text-[10.5px] font-semibold px-2 py-1 rounded-md ${
            h.ops > 0 ? "bg-indigo-50 text-indigo-700" : "bg-slate-50 text-slate-400"
          }`}
          title="Cantidad de OPs en las que participó"
        >
          {h.ops > 0 ? `${h.ops} OP${h.ops === 1 ? "" : "s"}` : "Sin OPs"}
        </span>
      </div>

      {/* Teléfonos */}
      {telefonos.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {telefonos.map((t) => (
            <a
              key={t.texto}
              href={`tel:${t.texto.replace(/\s/g, "")}`}
              title={t.origen === "nexus" ? "Registrado desde Nexus" : "Del ERP"}
              className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-indigo-50 text-[#4F46E5] hover:bg-indigo-100"
            >
              <Phone size={10} />
              {t.nombre ? `${t.nombre}: ` : ""}
              {t.texto}
              {t.origen === "nexus" && <span className="text-[9px] text-indigo-400 ml-0.5">Nexus</span>}
            </a>
          ))}
        </div>
      )}

      {/* Historial real de OPs */}
      {h.ops > 0 ? (
        <div className="mt-2.5 space-y-1.5 rounded-lg bg-slate-50/70 border border-slate-100 p-2.5">
          <FilaChips
            icono={<Package size={10} />}
            titulo="Marcas"
            items={h.marcas}
            filtro={filtro.marca}
            clase="bg-violet-50 text-violet-700 border-violet-200"
          />
          <FilaChips
            icono={<Tag size={10} />}
            titulo="Categorías"
            items={h.categorias}
            filtro={filtro.categoria}
            clase="bg-emerald-50 text-emerald-700 border-emerald-200"
            max={4}
          />
          <FilaChips
            icono={<Store size={10} />}
            titulo="Catálogos"
            items={h.catalogos}
            filtro={filtro.catalogo}
            clase="bg-amber-50 text-amber-700 border-amber-200"
          />
          <FilaChips
            icono={<Truck size={10} />}
            titulo="Entregó en"
            items={h.zonas}
            filtro={filtro.zona}
            clase="bg-sky-50 text-sky-700 border-sky-200"
            max={6}
          />
          {h.marcas.length === 0 && h.categorias.length === 0 && h.catalogos.length === 0 && (
            <p className="text-[10.5px] text-slate-400">
              Participó en OPs, pero el ERP no trae marca, categoría ni catálogo en esos productos.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-[10.5px] text-slate-400">
          Sin historial en OPs todavía. Si ya vendió, sincroniza el historial.
        </p>
      )}

      {/* Etiquetas manuales (plegable) */}
      <div className="mt-2">
        <button
          onClick={() => setVerEtiquetas((v) => !v)}
          className="flex items-center gap-1 text-[10.5px] font-medium text-slate-400 hover:text-slate-600"
          aria-expanded={verEtiquetas}
        >
          <ChevronDown size={11} className={`transition-transform ${verEtiquetas ? "rotate-180" : ""}`} />
          Etiquetas manuales ({p.etiquetas.length})
        </button>

        {verEtiquetas && (
          <div className="mt-1.5 space-y-2">
            {p.etiquetas.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {p.etiquetas.map((e) => (
                  <span
                    key={e.id}
                    className={`flex items-center gap-1 text-[10px] font-medium pl-2 pr-1 py-0.5 rounded-full border ${ESTILO_ETIQUETA[e.tipo]}`}
                    title={e.tipo}
                  >
                    {e.valor}
                    <button
                      onClick={() => quitar(e.id)}
                      className="w-3.5 h-3.5 rounded-full flex items-center justify-center hover:bg-black/10"
                      aria-label={`Quitar ${e.valor}`}
                    >
                      <X size={9} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex items-center gap-1.5">
              <select
                value={tipo}
                onChange={(e) => setTipo(e.target.value as typeof tipo)}
                className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600"
              >
                <option value="marca">Marca</option>
                <option value="categoria">Categoría</option>
                <option value="catalogo">Catálogo</option>
              </select>
              <input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && agregar()}
                placeholder="Agregar etiqueta manual"
                className="flex-1 min-w-0 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
              <button
                onClick={agregar}
                disabled={!valor.trim() || guardando}
                className="flex items-center gap-1 rounded-md bg-indigo-600 text-white text-[11px] font-semibold px-2 py-1 disabled:opacity-40 hover:bg-indigo-700"
              >
                {guardando ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                Agregar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}