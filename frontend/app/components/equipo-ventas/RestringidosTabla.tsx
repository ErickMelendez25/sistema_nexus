"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, FileText, ImageIcon, X, ChevronLeft, ChevronRight,
  AlertTriangle, ShieldAlert, DollarSign, Search,
} from "lucide-react";

import { fetchConToken } from "../../helbot-shared";
import { mapearCotizacionDetalle, type CotizacionDetalle } from "./EquipoVentasOperaciones";

interface FilaRestringido {
  id: number;
  motivo: "semaforo" | "monto_minimo";
  marca_restringida: string;
  subtotal_restringido: number;
    estado_restriccion: "pendiente" | "restringido";
  estado_proforma: string;
  restringido_por: string | null;
  restringido_en: string | null;
  creado_en: string;
  catalogo: string;
  requerimiento: string;
  proforma: string;
  n_proforma_id: string;

  color_semaforo: string;
  procedimiento: string;
  entidad: string;
  ruc: string;
  producto: string;
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

interface KpisRestringidos {
  total: number;
  semaforo: number;
  monto_minimo: number;
}

function badgeMotivo(motivo: string) {
  if (motivo === "semaforo") return "bg-red-50 text-red-700 border-red-200";
  return "bg-amber-50 text-amber-700 border-amber-200";
}

function etiquetaMotivo(motivo: string) {
  return motivo === "semaforo" ? "Semáforo rojo" : "Monto mínimo";
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

const kpiVacios: KpisRestringidos = { total: 0, semaforo: 0, monto_minimo: 0 };

export default function RestringidosTabla({ apiBase, catalogos, uid, tick }: { apiBase: string; catalogos: string[]; uid: string; tick?: number }) {
  const [filas, setFilas] = useState<FilaRestringido[]>([]);
  const [total, setTotal] = useState(0);
    const [pagina, setPagina] = useState(1);
  const [porPagina] = useState(20);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

    const [catalogoFiltro, setCatalogoFiltro] = useState("");
  const [motivoFiltro, setMotivoFiltro] = useState<"" | "semaforo" | "monto_minimo">("");
  const [marcaFiltro, setMarcaFiltro] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState<"pendiente" | "restringido" | "">("pendiente");
  const [fechaInicio, setFechaInicio] = useState("");
  const [fechaFin, setFechaFin] = useState("");
  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
  const [restringiendo, setRestringiendo] = useState(false);
  const [kpis, setKpis] = useState<KpisRestringidos>(kpiVacios);
const [preview, setPreview] = useState<string | null>(null);
  const [verMasAbierto, setVerMasAbierto] = useState(false);
  const [filaVerMas, setFilaVerMas] = useState<FilaRestringido | null>(null);
  const [detalleVerMas, setDetalleVerMas] = useState<CotizacionDetalle | null>(null);
  const [cargandoVerMas, setCargandoVerMas] = useState(false);
  const [errorVerMas, setErrorVerMas] = useState("");

  const esPaquete = (f: FilaRestringido) => (f.procedimiento || "").toUpperCase().includes("PAQUETE");

  const abrirVerMas = async (f: FilaRestringido) => {
    setFilaVerMas(f);
    setVerMasAbierto(true);
    setDetalleVerMas(null);
    setErrorVerMas("");
    setCargandoVerMas(true);
    try {
      const params = new URLSearchParams({ uid });
      const r = await fetchConToken(`${apiBase}/perucompras/proformas/cotizar-detalle?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nRequerimiento: f.requerimiento,
          nProforma: f.n_proforma_id,
          nEsCompraPorPaquete: esPaquete(f) ? "1" : "0",
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || `Error HTTP ${r.status}`);
      }
      const raw = await r.json();
      setDetalleVerMas(mapearCotizacionDetalle(raw));
    } catch (e) {
      setErrorVerMas(e instanceof Error ? e.message : "No se pudo cargar el detalle");
    } finally {
      setCargandoVerMas(false);
    }
  };

const armarParams = useCallback(() => {
    const params = new URLSearchParams();
    params.set("uid", uid);
    if (catalogoFiltro) params.set("catalogo", catalogoFiltro);
    if (marcaFiltro) params.set("marca", marcaFiltro);
    // Se manda siempre explícito ("" para "Todas") — si no, el backend
    // aplicaría su default de "pendiente" aunque el usuario haya
    // elegido ver "Restringidas" o "Todas".
    params.set("estado", estadoFiltro);
    if (fechaInicio) params.set("fecha_inicio", fechaInicio);
    if (fechaFin) params.set("fecha_fin", fechaFin);
    return params;
  }, [catalogoFiltro, marcaFiltro, estadoFiltro, fechaInicio, fechaFin, uid]);

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const params = armarParams();
      if (motivoFiltro) params.set("motivo", motivoFiltro);
      params.set("pagina", String(pagina));
      params.set("por_pagina", String(porPagina));

      const r = await fetch(`${apiBase}/perucompras/extraccion/restringidos?${params.toString()}`);
      if (!r.ok) throw new Error(`Error HTTP ${r.status}`);
      const data = await r.json();
      setFilas(Array.isArray(data.filas) ? data.filas : []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando restringidos");
      setFilas([]);
    } finally {
      setCargando(false);
    }
  }, [apiBase, pagina, porPagina, motivoFiltro, armarParams]);

  const cargarKpis = useCallback(async () => {
    try {
      const params = armarParams();
      const r = await fetch(`${apiBase}/perucompras/extraccion/restringidos/kpis?${params.toString()}`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setKpis({ total: data.total || 0, semaforo: data.semaforo || 0, monto_minimo: data.monto_minimo || 0 });
    } catch {
      setKpis(kpiVacios);
    }
  }, [apiBase, armarParams]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

useEffect(() => {
    cargarKpis();
  }, [cargarKpis]);


  // Se refresca solo cuando termina una extracción global (ver
  // PerucomprasPanel → tickExtraccion), sin que el usuario tenga que
  // apretar "Refrescar" a mano en esta pestaña.
  useEffect(() => {
    if (tick === undefined) return;
    cargarDatos();
    cargarKpis();
  }, [tick]);

const confirmarRestriccion = async (ids: number[]) => {
    if (ids.length === 0) return;
    setRestringiendo(true);
    setError("");
    try {
        const r = await fetchConToken(`${apiBase}/perucompras/extraccion/restringidos/confirmar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, uid }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || `Error HTTP ${r.status}`);
      }
      const data = await r.json();
      if (Array.isArray(data.fallidos) && data.fallidos.length > 0) {
        const primerError = data.fallidos[0]?.error || "Perú Compras rechazó la restricción";
        throw new Error(
          `${data.actualizados} restringida(s), ${data.fallidos.length} falló(fallaron): ${primerError}`
        );
      }
      setSeleccionados(new Set());
      await cargarDatos();
      await cargarKpis();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo restringir");
    } finally {
      setRestringiendo(false);
    }
  };

useEffect(() => {
    setPagina(1);
    setSeleccionados(new Set());
  }, [catalogoFiltro, motivoFiltro, marcaFiltro, estadoFiltro, fechaInicio, fechaFin]);

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

    const limpiarFiltros = () => {
    setCatalogoFiltro("");
    setMotivoFiltro("");
    setMarcaFiltro("");
    setEstadoFiltro("pendiente");
    setFechaInicio("");
    setFechaFin("");
  };

  return (
    <div>
<div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-red-600" />
          <p className="text-sm font-semibold text-slate-800">Proformas restringidas</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center rounded-lg border border-slate-200 overflow-hidden">
            {(
              [
                { valor: "pendiente", label: "Pendientes" },
                { valor: "restringido", label: "Restringidas" },
                { valor: "", label: "Todas" },
              ] as const
            ).map((op) => (
              <button
                key={op.valor}
                type="button"
                onClick={() => setEstadoFiltro(op.valor)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                  estadoFiltro === op.valor ? "bg-red-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {op.label}
              </button>
            ))}
          </div>

          {estadoFiltro === "pendiente" && seleccionados.size > 0 && (
            <button
              type="button"
              onClick={() => confirmarRestriccion(Array.from(seleccionados))}
              disabled={restringiendo}
              className="flex items-center gap-1.5 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
            >
              <ShieldAlert size={13} />
              {restringiendo ? "Restringiendo..." : `Restringir seleccionadas (${seleccionados.size})`}
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <button
          type="button"
          onClick={() => setMotivoFiltro("")}
          className={`text-left bg-white border rounded-lg px-3 py-2 transition-all ${!motivoFiltro ? "border-slate-400 ring-2 ring-slate-300" : "border-slate-200 hover:border-slate-300"}`}
        >
          <p className="text-[10px] font-medium text-slate-400 uppercase">Total restringidas</p>
          <p className="text-lg font-bold text-slate-900">{kpis.total}</p>
        </button>
        <button
          type="button"
          onClick={() => setMotivoFiltro((v) => (v === "semaforo" ? "" : "semaforo"))}
          className={`text-left bg-white border rounded-lg px-3 py-2 border-l-4 border-l-red-400 transition-all ${motivoFiltro === "semaforo" ? "border-red-400 ring-2 ring-red-200" : "border-slate-200 hover:border-red-200"}`}
        >
          <p className="text-[10px] font-medium text-red-600 uppercase flex items-center gap-1"><ShieldAlert size={11} /> Por semáforo</p>
          <p className="text-lg font-bold text-red-700">{kpis.semaforo}</p>
        </button>
        <button
          type="button"
          onClick={() => setMotivoFiltro((v) => (v === "monto_minimo" ? "" : "monto_minimo"))}
          className={`text-left bg-white border rounded-lg px-3 py-2 border-l-4 border-l-amber-400 transition-all ${motivoFiltro === "monto_minimo" ? "border-amber-400 ring-2 ring-amber-200" : "border-slate-200 hover:border-amber-200"}`}
        >
          <p className="text-[10px] font-medium text-amber-600 uppercase flex items-center gap-1"><DollarSign size={11} /> Por monto mínimo</p>
          <p className="text-lg font-bold text-amber-700">{kpis.monto_minimo}</p>
        </button>
      </div>

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
                {estadoFiltro === "pendiente" && (
                  <th className="px-3 py-2 text-center w-8">
                    <input
                      type="checkbox"
                      checked={filas.length > 0 && seleccionados.size === filas.length}
                      onChange={(e) =>
                        setSeleccionados(e.target.checked ? new Set(filas.map((f) => f.id)) : new Set())
                      }
                      className="w-3.5 h-3.5 rounded border-slate-300 text-red-600 focus:ring-red-500"
                    />
                  </th>
                )}
                <th className="px-3 py-2 text-left">Detectado</th>
                <th className="px-3 py-2 text-center">Motivo</th>
                <th className="px-3 py-2 text-center">Estado</th>
                <th className="px-3 py-2 text-left">Catálogo</th>
                <th className="px-3 py-2 text-left">Requerimiento</th>
                <th className="px-3 py-2 text-center">Tipo</th>
                <th className="px-3 py-2 text-left">Proforma</th>
                <th className="px-3 py-2 text-center">Semáforo</th>
                <th className="px-3 py-2 text-left">Entidad</th>
                <th className="px-3 py-2 text-left">RUC</th>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-left">Marca</th>
                <th className="px-3 py-2 text-right">Subtotal</th>
                <th className="px-3 py-2 text-left">Ubicación</th>
                <th className="px-3 py-2 text-center">Foto</th>
                <th className="px-3 py-2 text-center">PDF producto</th>
                <th className="px-3 py-2 text-center">Ver más</th>
                {estadoFiltro === "pendiente" && <th className="px-3 py-2 text-center">Acción</th>}
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr><td colSpan={estadoFiltro === "pendiente" ? 17 : 15} className="text-center py-10 text-slate-400"><Loader2 size={16} className="animate-spin inline mr-2" /> Cargando...</td></tr>
              ) : filas.length === 0 ? (
                <tr><td colSpan={estadoFiltro === "pendiente" ? 17 : 15} className="text-center py-10 text-slate-400">Sin proformas restringidas para estos filtros.</td></tr>
              ) : (
            filas.map((f) => (
                  <tr key={f.id} className="border-t border-slate-100 hover:bg-slate-50">
                    {estadoFiltro === "pendiente" && (
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={seleccionados.has(f.id)}
                          onChange={() =>
                            setSeleccionados((prev) => {
                              const nuevo = new Set(prev);
                              if (nuevo.has(f.id)) nuevo.delete(f.id);
                              else nuevo.add(f.id);
                              return nuevo;
                            })
                          }
                          className="w-3.5 h-3.5 rounded border-slate-300 text-red-600 focus:ring-red-500"
                        />
                      </td>
                    )}
                    <td className="px-3 py-2 text-slate-500">{formatearFechaHora(f.creado_en)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeMotivo(f.motivo)}`}>
                        {etiquetaMotivo(f.motivo)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                          f.estado_restriccion === "restringido"
                            ? "bg-slate-800 text-white border-slate-800"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }`}
                        title={f.estado_restriccion === "restringido" && f.restringido_por ? `Restringido por ${f.restringido_por}` : undefined}
                      >
                        {f.estado_restriccion === "restringido" ? "Restringida" : "Pendiente"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{f.catalogo}</td>
                    <td className="px-3 py-2 font-medium text-slate-800">{f.requerimiento}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${esPaquete(f) ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "bg-slate-100 text-slate-500 border-slate-200"}`}>
                        {esPaquete(f) ? "Paquete" : "Individual"}
                      </span>
                    </td>
                    <td className="px-3 py-2">{f.proforma}</td>

                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeSemaforo(f.color_semaforo)}`}>{f.color_semaforo}</span>
                    </td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={f.entidad}>{f.entidad}</td>
                    <td className="px-3 py-2">{f.ruc}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate" title={f.producto}>{f.producto}</td>
                    <td className="px-3 py-2 font-semibold text-slate-700">{f.marca_restringida}</td>

                    <td className="px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => abrirVerMas(f)}
                        className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 underline underline-offset-2"
                      >
                        Ver más
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{Number(f.subtotal_restringido || 0).toFixed(2)}</td>
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
                    {estadoFiltro === "pendiente" && (
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => confirmarRestriccion([f.id])}
                          disabled={restringiendo}
                          className="text-[10px] font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md px-2.5 py-1 transition-colors disabled:opacity-50"
                        >
                          Restringir
                        </button>
                      </td>
                    )}
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

      {verMasAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setVerMasAbierto(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
              <div>
                <p className="text-sm font-bold text-slate-900">{filaVerMas?.requerimiento}</p>
                <p className="text-xs text-slate-500">Proforma {filaVerMas?.proforma}</p>
              </div>
              <button type="button" onClick={() => setVerMasAbierto(false)} className="text-slate-400 hover:text-slate-700 text-xl leading-none px-2">×</button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {cargandoVerMas ? (
                <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
                  <Loader2 size={18} className="animate-spin" /> Cargando detalle...
                </div>
              ) : errorVerMas ? (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-100 text-red-700 text-xs px-4 py-3 rounded-lg">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {errorVerMas}
                </div>
              ) : detalleVerMas ? (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs">
                    <div>
                      <p className="text-slate-400">Entidad</p>
                      <p className="font-semibold text-slate-800">{detalleVerMas.entidadNombre}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Compra</p>
                      <p className="font-semibold text-slate-800">{detalleVerMas.tipoCompra}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Total (PEN)</p>
                      <p className="font-semibold text-slate-800">{detalleVerMas.totalPEN.toLocaleString("es-PE", { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Estado</p>
                      <p className="font-semibold text-slate-800">{detalleVerMas.estado}</p>
                    </div>
                  </div>

                  <div className="border border-slate-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-xs min-w-[800px]">
                      <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">Producto</th>
                          <th className="px-3 py-2 text-left font-medium">Ficha-Producto</th>
                          <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                          <th className="px-3 py-2 text-right font-medium">P. unit. base</th>
                          <th className="px-3 py-2 text-right font-medium">P. unit. ofertado</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detalleVerMas.fichas.map((f, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="px-3 py-2 max-w-[220px]">{f.producto}</td>
                            <td className="px-3 py-2 max-w-[280px] line-clamp-2 text-slate-600">{f.fichaProducto}</td>
                            <td className="px-3 py-2 text-right">{f.cantidad}</td>
                            <td className="px-3 py-2 text-right">{f.precioUnitarioBase.toFixed(2)}</td>
                            <td className="px-3 py-2 text-right font-semibold">{f.precioUnitarioOfertado.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-4">
                    {detalleVerMas.entregas.map((e, ei) => (
                      <div key={ei} className="border border-slate-200 rounded-xl overflow-hidden">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 px-4 py-3 text-xs">
                          <div><p className="text-slate-400">Dirección</p><p className="font-semibold text-slate-800">{e.direccion}</p></div>
                          <div><p className="text-slate-400">Inicio</p><p className="font-semibold text-slate-800">{e.inicioEntrega}</p></div>
                          <div><p className="text-slate-400">Fin</p><p className="font-semibold text-slate-800">{e.finEntrega}</p></div>
                          <div><p className="text-slate-400">Sub Total</p><p className="font-bold text-slate-900">{e.subTotal.toFixed(2)}</p></div>
                        </div>
                        <table className="w-full text-xs min-w-[600px]">
                          <thead className="bg-white text-[10px] uppercase text-slate-400 border-t border-slate-100">
                            <tr>
                              <th className="px-3 py-2 text-left font-medium">Producto</th>
                              <th className="px-3 py-2 text-right font-medium">Cantidad</th>
                              <th className="px-3 py-2 text-right font-medium">Sub Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.productos.map((pr, pi) => (
                              <tr key={pi} className="border-t border-slate-100">
                                <td className="px-3 py-2 max-w-[220px]">{pr.producto}</td>
                                <td className="px-3 py-2 text-right">{pr.cantidad}</td>
                                <td className="px-3 py-2 text-right font-semibold">{pr.subTotal.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}