"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, FileText, ImageIcon, X, ChevronLeft, ChevronRight, AlertTriangle, Search,
} from "lucide-react";
import { fetchConToken } from "../../helbot-shared";

interface FilaExtraccion {
  id: number;
  catalogo: string;
  fecha_guardado: string;
  requerimiento: string;
  proforma: string;
  n_proforma_id: string;
  color_semaforo: string;
  estado: string;
  procedimiento: string;
  fecha_emision: string;
  fecha_limite_cotizacion: string;
  entidad: string;
  ruc: string;
  producto: string;
  marca: string;
  codigo_unico: string;
  cantidad: number;
  precio_unitario_base: number;
  precio_ofertado: number;
  moneda: string;
  departamento: string;
  provincia: string;
  distrito: string;
  pdf_producto: string;
  pdf_requerimiento: string;
  imagen_producto: string;
}

interface Kpis {
  total: number;
  pendiente: number;
  restringida: number;
  cotizada: number;
  desierta: number;
  sin_estado: number;
}

function badgeSemaforo(color: string) {
  if (color === "ROJO") return "bg-red-50 text-red-700 border-red-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function badgeEstado(estado: string) {
  switch ((estado || "").toUpperCase()) {
    case "COTIZADA": return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "PENDIENTE": return "bg-amber-50 text-amber-700 border-amber-200";
    case "RESTRINGIDA": return "bg-red-50 text-red-700 border-red-200";
    case "DESIERTA": return "bg-slate-200 text-slate-600 border-slate-300";
    default: return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function formatearFechaHora(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-PE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const kpiVacios: Kpis = { total: 0, pendiente: 0, restringida: 0, cotizada: 0, desierta: 0, sin_estado: 0 };

export default function ExtraccionTabla({ apiBase, catalogos, uid, tick }: { apiBase: string; catalogos: string[]; uid: string; tick?: number }) {
  const [catalogoActivo, setCatalogoActivo] = useState("");
  const [filas, setFilas] = useState<FilaExtraccion[]>([]);
  const [total, setTotal] = useState(0);
    const [pagina, setPagina] = useState(1);
  const [porPagina] = useState(20);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [filtroMarca, setFiltroMarca] = useState("");
  const [filtroUbicacion, setFiltroUbicacion] = useState("");
  const [filtroEntidad, setFiltroEntidad] = useState("");
  const [filtroRuc, setFiltroRuc] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("");

  const [kpis, setKpis] = useState<Kpis>(kpiVacios);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (catalogos.length > 0 && !catalogoActivo) setCatalogoActivo(catalogos[0]);
  }, [catalogos, catalogoActivo]);

const armarParamsFiltro = useCallback(() => {
    const params = new URLSearchParams({ catalogo: catalogoActivo, uid });
    if (fechaInicio) params.set("fecha_inicio", fechaInicio);
    if (fechaFin) params.set("fecha_fin", fechaFin);
    if (filtroMarca) params.set("marca", filtroMarca);
    if (filtroUbicacion) params.set("ubicacion", filtroUbicacion);
    if (filtroEntidad) params.set("entidad", filtroEntidad);
    if (filtroRuc) params.set("ruc", filtroRuc);
    return params;
  }, [catalogoActivo, fechaInicio, fechaFin, filtroMarca, filtroUbicacion, filtroEntidad, filtroRuc, uid]);

  const cargarDatos = useCallback(async () => {
    if (!catalogoActivo) return;
    setCargando(true);
    setError("");
    try {
      const params = armarParamsFiltro();
      params.set("pagina", String(pagina));
      params.set("por_pagina", String(porPagina));
      if (filtroEstado) params.set("estado", filtroEstado);

      const r = await fetchConToken(`${apiBase}/perucompras/extraccion/datos?${params.toString()}`);
      if (!r.ok) throw new Error(`Error HTTP ${r.status}`);
      const data = await r.json();
      setFilas(Array.isArray(data.filas) ? data.filas : []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando datos");
      setFilas([]);
    } finally {
      setCargando(false);
    }
  }, [apiBase, catalogoActivo, pagina, porPagina, filtroEstado, armarParamsFiltro]);

  const cargarKpis = useCallback(async () => {
    if (!catalogoActivo) return;
    try {
      const params = armarParamsFiltro();
      const r = await fetchConToken(`${apiBase}/perucompras/extraccion/kpis?${params.toString()}`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setKpis({
        total: data.total || 0,
        pendiente: data.pendiente || 0,
        restringida: data.restringida || 0,
        cotizada: data.cotizada || 0,
        desierta: data.desierta || 0,
        sin_estado: data.sin_estado || 0,
      });
    } catch {
      setKpis(kpiVacios);
    }
  }, [apiBase, catalogoActivo, armarParamsFiltro]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);
  useEffect(() => { cargarKpis(); }, [cargarKpis]);

  // Se refresca solo cuando termina una extracción (tick cambia), sin
  // que el usuario tenga que tocar "Refrescar" a mano en esta pestaña.
  useEffect(() => {
    if (tick !== undefined) {
      cargarDatos();
      cargarKpis();
    }
  }, [tick]);


  useEffect(() => {
    setPagina(1);
  }, [catalogoActivo, fechaInicio, fechaFin, filtroMarca, filtroUbicacion, filtroEntidad, filtroRuc, filtroEstado]);

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

  const limpiarFiltros = () => {
    setFechaInicio("");
    setFechaFin("");
    setFiltroMarca("");
    setFiltroUbicacion("");
    setFiltroEntidad("");
    setFiltroRuc("");
    setFiltroEstado("");
  };

  return (
    <div>
      {/* Tabs por catálogo */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {catalogos.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCatalogoActivo(cat)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${
              catalogoActivo === cat
                ? "bg-[#4F46E5] border-[#4F46E5] text-white shadow-sm"
                : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* KPIs por estado */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
        <button type="button" onClick={() => setFiltroEstado("")} className={`text-left bg-white border rounded-lg px-3 py-2 transition-all ${!filtroEstado ? "border-slate-400 ring-2 ring-slate-300" : "border-slate-200 hover:border-slate-300"}`}>
          <p className="text-[10px] font-medium text-slate-400 uppercase">Total</p>
          <p className="text-lg font-bold text-slate-900">{kpis.total}</p>
        </button>
        <button type="button" onClick={() => setFiltroEstado((v) => v === "PENDIENTE" ? "" : "PENDIENTE")} className={`text-left bg-white border rounded-lg px-3 py-2 border-l-4 border-l-amber-400 transition-all ${filtroEstado === "PENDIENTE" ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-200 hover:border-amber-200"}`}>
          <p className="text-[10px] font-medium text-amber-600 uppercase">Pendientes</p>
          <p className="text-lg font-bold text-amber-700">{kpis.pendiente}</p>
        </button>
        <button type="button" onClick={() => setFiltroEstado((v) => v === "RESTRINGIDA" ? "" : "RESTRINGIDA")} className={`text-left bg-white border rounded-lg px-3 py-2 border-l-4 border-l-red-400 transition-all ${filtroEstado === "RESTRINGIDA" ? "border-red-400 ring-2 ring-red-200" : "border-slate-200 hover:border-red-200"}`}>
          <p className="text-[10px] font-medium text-red-600 uppercase">Restringidas</p>
          <p className="text-lg font-bold text-red-700">{kpis.restringida}</p>
        </button>
        <button type="button" onClick={() => setFiltroEstado((v) => v === "COTIZADA" ? "" : "COTIZADA")} className={`text-left bg-white border rounded-lg px-3 py-2 border-l-4 border-l-emerald-400 transition-all ${filtroEstado === "COTIZADA" ? "border-emerald-400 ring-2 ring-emerald-200" : "border-slate-200 hover:border-emerald-200"}`}>
          <p className="text-[10px] font-medium text-emerald-600 uppercase">Cotizadas</p>
          <p className="text-lg font-bold text-emerald-700">{kpis.cotizada}</p>
        </button>
        <button type="button" onClick={() => setFiltroEstado((v) => v === "DESIERTA" ? "" : "DESIERTA")} className={`text-left bg-white border rounded-lg px-3 py-2 border-l-4 border-l-slate-400 transition-all ${filtroEstado === "DESIERTA" ? "border-slate-400 ring-2 ring-slate-300" : "border-slate-200 hover:border-slate-300"}`}>
          <p className="text-[10px] font-medium text-slate-500 uppercase">Desiertas</p>
          <p className="text-lg font-bold text-slate-700">{kpis.desierta}</p>
        </button>
      </div>
      {/* Filtros */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Fecha inicio</label>
            <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Fecha fin</label>
            <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Marca</label>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={filtroMarca} onChange={(e) => setFiltroMarca(e.target.value)} placeholder="Ej. ECOLIMPIA" className="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Ubicación</label>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={filtroUbicacion} onChange={(e) => setFiltroUbicacion(e.target.value)} placeholder="Depto / prov / distrito" className="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Entidad</label>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={filtroEntidad} onChange={(e) => setFiltroEntidad(e.target.value)} placeholder="Nombre de la entidad" className="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">RUC</label>
            <input value={filtroRuc} onChange={(e) => setFiltroRuc(e.target.value)} placeholder="20601786355" className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>
        <div className="flex justify-end mt-2">
          <button type="button" onClick={limpiarFiltros} className="text-xs font-medium text-slate-500 hover:text-slate-800 px-3 py-1.5">
            Limpiar filtros
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Fecha extracción</th>
                <th className="px-3 py-2 text-left">Requerimiento</th>
                <th className="px-3 py-2 text-left">Proforma</th>
                <th className="px-3 py-2 text-center">Estado</th>
                <th className="px-3 py-2 text-center">Semáforo</th>
                <th className="px-3 py-2 text-left">Entidad</th>
                <th className="px-3 py-2 text-left">RUC</th>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-left">Marca</th>
                <th className="px-3 py-2 text-left">Código único</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-right">P. base</th>
                <th className="px-3 py-2 text-right">P. ofertado</th>
                <th className="px-3 py-2 text-left">Moneda</th>
                <th className="px-3 py-2 text-left">Ubicación</th>
                <th className="px-3 py-2 text-center">Foto</th>
                <th className="px-3 py-2 text-center">PDF producto</th>
                <th className="px-3 py-2 text-center">PDF requerimiento</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr><td colSpan={18} className="text-center py-10 text-slate-400"><Loader2 size={16} className="animate-spin inline mr-2" /> Cargando...</td></tr>
              ) : filas.length === 0 ? (
                <tr><td colSpan={18} className="text-center py-10 text-slate-400">Sin resultados para este catálogo/filtros.</td></tr>
              ) : (
                filas.map((f) => (
                  <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-500">{formatearFechaHora(f.fecha_guardado)}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{f.requerimiento}</td>
                    <td className="px-3 py-2">{f.proforma}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeEstado(f.estado)}`}>{f.estado || "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeSemaforo(f.color_semaforo)}`}>{f.color_semaforo}</span>
                    </td>
                    <td className="px-3 py-2 max-w-[220px] truncate" title={f.entidad}>{f.entidad}</td>
                    <td className="px-3 py-2">{f.ruc}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={f.producto}>{f.producto}</td>
                    <td className="px-3 py-2">{f.marca}</td>
                    <td className="px-3 py-2">{f.codigo_unico}</td>
                    <td className="px-3 py-2 text-right">{f.cantidad}</td>
                    <td className="px-3 py-2 text-right">{Number(f.precio_unitario_base || 0).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{Number(f.precio_ofertado || 0).toFixed(2)}</td>
                    <td className="px-3 py-2">{f.moneda}</td>
                    <td className="px-3 py-2 max-w-[180px] truncate" title={`${f.departamento} / ${f.provincia} / ${f.distrito}`}>
                      {[f.departamento, f.provincia, f.distrito].filter(Boolean).join(" / ") || "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {f.imagen_producto ? (
                        <button type="button" onClick={() => setPreview(f.imagen_producto)}>
                          <img src={f.imagen_producto} alt="producto" className="w-8 h-8 rounded object-cover border border-slate-200 mx-auto hover:scale-110 transition-transform" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                        </button>
                      ) : <ImageIcon size={14} className="text-slate-200 mx-auto" />}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {f.pdf_producto ? (
                        <a href={f.pdf_producto} target="_blank" rel="noopener noreferrer" title="Ver PDF del producto">
                          <FileText size={16} className="text-red-600 hover:text-red-700 mx-auto" />
                        </a>
                      ) : <FileText size={14} className="text-slate-200 mx-auto" />}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {f.pdf_requerimiento ? (
                        <a href={f.pdf_requerimiento} target="_blank" rel="noopener noreferrer" title="Ver PDF del requerimiento">
                          <FileText size={16} className="text-red-600 hover:text-red-700 mx-auto" />
                        </a>
                      ) : <FileText size={14} className="text-slate-200 mx-auto" />}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/60">
            <p className="text-xs text-slate-500">{(pagina - 1) * porPagina + 1}–{Math.min(pagina * porPagina, total)} de {total}</p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={pagina === 1} className="w-7 h-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 disabled:opacity-30">
                <ChevronLeft size={13} />
              </button>
              <span className="text-xs text-slate-600 px-2">{pagina} / {totalPaginas}</span>
              <button type="button" onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))} disabled={pagina === totalPaginas} className="w-7 h-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 disabled:opacity-30">
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center p-6" onClick={() => setPreview(null)}>
          <button onClick={() => setPreview(null)} className="absolute top-5 right-5 text-white/80 hover:text-white"><X size={22} /></button>
          <img src={preview} className="max-w-[90vw] max-h-[85vh] rounded-xl shadow-2xl" />
        </div>
      )}
    </div>
  );
}