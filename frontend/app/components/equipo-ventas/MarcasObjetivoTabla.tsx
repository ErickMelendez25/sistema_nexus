"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, FileText, ImageIcon, X, ChevronLeft, ChevronRight,
  AlertTriangle, Tag, Search,
} from "lucide-react";
import { fetchConToken } from "../../helbot-shared";

interface FilaMarcaObjetivo {
  id: number;
  catalogo: string;
  requerimiento: string;
  proforma: string;
  estado: string;
  color_semaforo: string;
  procedimiento: string;
  entidad: string;
  ruc: string;
  producto: string;
  marca: string;
  codigo_unico: string;
  cantidad: number;
  precio_unitario_base: number;
  precio_ofertado: number;
  moneda: string;
  subtotal: number;
  departamento: string;
  provincia: string;
  distrito: string;
  fecha_guardado: string;
  pdf_producto: string;
  pdf_requerimiento: string;
  imagen_producto: string;
}

function badgeSemaforo(color: string) {
  if (color === "ROJO") return "bg-red-50 text-red-700 border-red-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

function formatearFechaHora(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-PE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function MarcasObjetivoTabla(
  {
    apiBase,
    catalogos,
    uid,
    tick,
  }: {
    apiBase: string;
    catalogos: string[];
    uid: string;
    tick?: number;
  }
) {
  const [filas, setFilas] = useState<FilaMarcaObjetivo[]>([]);
  const [marcasObjetivo, setMarcasObjetivo] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
    const [pagina, setPagina] = useState(1);
  const [porPagina] = useState(20);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const [catalogoFiltro, setCatalogoFiltro] = useState("");
  const [marcaFiltro, setMarcaFiltro] = useState("");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [preview, setPreview] = useState<string | null>(null);



const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (uid) params.set("uid", uid);
      if (catalogoFiltro) params.set("catalogo", catalogoFiltro);
      if (marcaFiltro) params.set("marca", marcaFiltro);
      if (fechaInicio) params.set("fecha_inicio", fechaInicio);
      if (fechaFin) params.set("fecha_fin", fechaFin);
      params.set("pagina", String(pagina));
      params.set("por_pagina", String(porPagina));

      const r = await fetchConToken(`${apiBase}/perucompras/extraccion/marcas-objetivo?${params.toString()}`);
      if (!r.ok) throw new Error(`Error HTTP ${r.status}`);
      const data = await r.json();
      setFilas(Array.isArray(data.filas) ? data.filas : []);
      setTotal(data.total || 0);
      setMarcasObjetivo(Array.isArray(data.marcas_objetivo) ? data.marcas_objetivo : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando proformas de marcas objetivo");
      setFilas([]);
    } finally {
      setCargando(false);
    }
  }, [apiBase, uid, pagina, porPagina, catalogoFiltro, marcaFiltro, fechaInicio, fechaFin]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);


  // Mismo patrón que RestringidosTabla: se refresca solo al terminar
  // una extracción global, sin botón manual.
  useEffect(() => {
    if (tick === undefined) return;
    cargarDatos();
  }, [tick]);


  useEffect(() => {
    setPagina(1);
  }, [catalogoFiltro, marcaFiltro, fechaInicio, fechaFin]);

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

  const limpiarFiltros = () => {
    setCatalogoFiltro("");
    setMarcaFiltro("");
    setFechaInicio("");
    setFechaFin("");
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Tag size={16} className="text-[#4F46E5]" />
          <p className="text-sm font-semibold text-slate-800">Proformas de marcas objetivo</p>
        </div>
        {marcasObjetivo.length > 0 && (
          <p className="text-xs text-slate-400">
            {marcasObjetivo.length} marca{marcasObjetivo.length !== 1 ? "s" : ""} configurada{marcasObjetivo.length !== 1 ? "s" : ""} en la lista "objetivo"
          </p>
        )}
      </div>

      {marcasObjetivo.length === 0 && !cargando && (
        <div className="mb-4 flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-sm rounded-lg px-4 py-3">
          <AlertTriangle size={15} />
          No hay marcas configuradas en la lista "objetivo" todavía — agrégalas en Configuración de marcas restringidas.
        </div>
      )}

      {/* Filtros */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Catálogo</label>
            <select value={catalogoFiltro} onChange={(e) => setCatalogoFiltro(e.target.value)} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm">
              <option value="">Todos</option>
              {catalogos.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Marca</label>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={marcaFiltro} onChange={(e) => setMarcaFiltro(e.target.value)} placeholder="Ej. ECOLIMPIA" className="w-full bg-white border border-slate-300 rounded-lg pl-8 pr-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Desde</label>
            <input type="date" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Hasta</label>
            <input type="date" value={fechaFin} onChange={(e) => setFechaFin(e.target.value)} className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm" />
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
                <th className="px-3 py-2 text-left">Detectado</th>
                <th className="px-3 py-2 text-left">Catálogo</th>
                <th className="px-3 py-2 text-left">Requerimiento</th>
                <th className="px-3 py-2 text-left">Proforma</th>
                <th className="px-3 py-2 text-center">Estado</th>
                <th className="px-3 py-2 text-center">Semáforo</th>
                <th className="px-3 py-2 text-left">Entidad</th>
                <th className="px-3 py-2 text-left">RUC</th>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-left">Marca</th>
                <th className="px-3 py-2 text-right">Subtotal</th>
                <th className="px-3 py-2 text-left">Ubicación</th>
                <th className="px-3 py-2 text-center">Foto</th>
                <th className="px-3 py-2 text-center">PDF producto</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr><td colSpan={14} className="text-center py-10 text-slate-400"><Loader2 size={16} className="animate-spin inline mr-2" /> Cargando...</td></tr>
              ) : filas.length === 0 ? (
                <tr><td colSpan={14} className="text-center py-10 text-slate-400">Sin proformas de marcas objetivo para estos filtros.</td></tr>
              ) : (
                filas.map((f) => (
                  <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-500">{formatearFechaHora(f.fecha_guardado)}</td>
                    <td className="px-3 py-2 text-slate-600">{f.catalogo}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{f.requerimiento}</td>
                    <td className="px-3 py-2">{f.proforma}</td>
                    <td className="px-3 py-2 text-center">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-slate-100 text-slate-600 border-slate-200">
                        {f.estado || "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeSemaforo(f.color_semaforo)}`}>{f.color_semaforo}</span>
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={f.entidad}>{f.entidad}</td>
                    <td className="px-3 py-2">{f.ruc}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={f.producto}>{f.producto}</td>
                    <td className="px-3 py-2 font-semibold text-[#4F46E5]">{f.marca}</td>
                    <td className="px-3 py-2 text-right font-semibold">{Number(f.subtotal || 0).toFixed(2)}</td>
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