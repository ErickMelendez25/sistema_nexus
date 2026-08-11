"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  History,
  User,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  Download,
  Share2,
  Search,
  X,
} from "lucide-react";
import { fetchConToken } from "../../helbot-shared";

interface RunDetalle {
  catalogo: string;
  total_filas: number;
  nuevos_insertados: number;
}

interface Run {
  id: number;
  usuario_helbot: string;
  uid_perucompras: string;
  iniciado_en: string;
  terminado_en: string | null;
  estado: string;
  error: string | null;
  total_filas: number;
  detalle: RunDetalle[];
}

interface ReporteGenerado {
  id: number;
  tipo: "historial" | "marcas" | "restringidos" | "historial_acumulado";
  nombre_archivo: string;
  creado_en: string;
}

const LABEL_TIPO: Record<string, string> = {
  historial: "Proformas de esta corrida",
  historial_acumulado: "Historial acumulado (todo)",
  marcas: "Marcas objetivo",
  restringidos: "Restringidos",
};

function formatearFechaHora(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("es-PE", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AuditoriaExtraccion({ apiBase, uid, tick }: { apiBase: string; uid: string; tick?: number }) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [porPagina] = useState(20);
  const [cargando, setCargando] = useState(false);

  const [filtroTexto, setFiltroTexto] = useState("");
  const [busquedaDebounced, setBusquedaDebounced] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [filtroDesde, setFiltroDesde] = useState("");
  const [filtroHasta, setFiltroHasta] = useState("");

  const [reportesPorRun, setReportesPorRun] = useState<Record<number, ReporteGenerado[]>>({});
  const [descargando, setDescargando] = useState<number | null>(null);


  useEffect(() => {
    const t = setTimeout(() => setBusquedaDebounced(filtroTexto.trim()), 400);
    return () => clearTimeout(t);
  }, [filtroTexto]);

  useEffect(() => {
    setPagina(1);
  }, [busquedaDebounced, filtroEstado, filtroDesde, filtroHasta]);


  const cargarRuns = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams({ pagina: String(pagina), por_pagina: String(porPagina) });
      if (uid) params.set("uid", uid);
      if (busquedaDebounced) params.set("buscar", busquedaDebounced);
      if (filtroEstado !== "todos") params.set("estado", filtroEstado);
      if (filtroDesde) params.set("desde", filtroDesde);
      if (filtroHasta) params.set("hasta", filtroHasta);
      const r = await fetchConToken(`${apiBase}/perucompras/extraccion/runs?${params.toString()}`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setRuns(Array.isArray(data.runs) ? data.runs : []);
      setTotal(data.total || 0);
    } catch {
      setRuns([]);
      setTotal(0);
    } finally {
      setCargando(false);
    }
  }, [apiBase, pagina, porPagina, uid, busquedaDebounced, filtroEstado, filtroDesde, filtroHasta]);

  useEffect(() => {
    cargarRuns();
  }, [cargarRuns]);

  useEffect(() => {
    if (tick !== undefined) {
      cargarRuns();
    }
  }, [tick]);

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

  // ---------- Reportes por run: se cargan solos, sin click ----------
  useEffect(() => {
    runs
      .filter((run) => run.estado === "completado" && !reportesPorRun[run.id])
      .forEach((run) => {
        (async () => {
          try {
            const r = await fetchConToken(`${apiBase}/perucompras/extraccion/runs/${run.id}/reportes`);
            if (!r.ok) throw new Error();
            const data = await r.json();
            setReportesPorRun((prev) => ({ ...prev, [run.id]: data.reportes || [] }));
          } catch {
            setReportesPorRun((prev) => ({ ...prev, [run.id]: [] }));
          }
        })();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs]);

  const obtenerBlobReporte = async (reporteId: number): Promise<{ blob: Blob; nombre: string } | null> => {
    const r = await fetchConToken(`${apiBase}/perucompras/extraccion/reportes/${reporteId}/descargar`);
    if (!r.ok) return null;
    const disposition = r.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const nombre = match?.[1] || `reporte_${reporteId}.xlsx`;
    const blob = await r.blob();
    return { blob, nombre };
  };

  const descargarReporte = async (reporte: ReporteGenerado) => {
    setDescargando(reporte.id);
    try {
      const res = await obtenerBlobReporte(reporte.id);
      if (!res) return;
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.nombre;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDescargando(null);
    }
  };

  const compartirReporte = async (reporte: ReporteGenerado) => {
    setDescargando(reporte.id);
    try {
      const res = await obtenerBlobReporte(reporte.id);
      if (!res) return;
      const archivo = new File([res.blob], res.nombre, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: res.nombre });
      } else {
        const url = URL.createObjectURL(res.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = res.nombre;
        a.click();
        URL.revokeObjectURL(url);
        alert("Tu navegador no permite compartir archivos directo. Se descargó el archivo — adjúntalo manualmente en WhatsApp.");
      }
    } finally {
      setDescargando(null);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <History size={16} className="text-[#4F46E5]" />
        <p className="text-sm font-semibold text-slate-800">Historial de extracciones</p>
        {total > 0 && <span className="text-[10px] text-slate-400">({total} en total)</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4 bg-slate-50 border border-slate-200 rounded-xl p-2.5">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar por usuario o uid Perú Compras..."
            className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-[#4F46E5]"
          />
        </div>

        <select
          value={filtroEstado}
          onChange={(e) => setFiltroEstado(e.target.value)}
          className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#4F46E5]"
        >
          <option value="todos">Todos los estados</option>
          <option value="completado">Completado</option>
          <option value="error">Error</option>
          <option value="procesando">Procesando</option>
        </select>

        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={filtroDesde}
            onChange={(e) => setFiltroDesde(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#4F46E5]"
          />
          <span className="text-[10px] text-slate-400">a</span>
          <input
            type="date"
            value={filtroHasta}
            onChange={(e) => setFiltroHasta(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600 focus:outline-none focus:ring-1 focus:ring-[#4F46E5]"
          />
        </div>

        {(filtroTexto || filtroEstado !== "todos" || filtroDesde || filtroHasta) && (
          <button
            type="button"
            onClick={() => {
              setFiltroTexto("");
              setFiltroEstado("todos");
              setFiltroDesde("");
              setFiltroHasta("");
            }}
            className="flex items-center gap-1 text-[10px] font-medium text-slate-400 hover:text-red-500 transition-colors"
          >
            <X size={11} /> Limpiar filtros
          </button>
        )}
      </div>

      {cargando ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-8">
          <Loader2 size={14} className="animate-spin" /> Cargando...
        </div>
      ) : runs.length === 0 ? (
        <p className="text-xs text-slate-400 py-8 text-center">Todavía no hay corridas registradas.</p>
      ) : (
        <>
          <div className="space-y-3">
            {runs.map((run) => (
              <div key={run.id} className="border border-slate-200 rounded-xl p-3.5 bg-white">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="flex items-center gap-1 font-semibold text-slate-700">
                      <User size={12} /> {run.usuario_helbot || "—"}
                    </span>
                    <span className="text-slate-400">· uid Perú Compras: {run.uid_perucompras}</span>
                    <span className="text-slate-400">· {formatearFechaHora(run.iniciado_en)}</span>
                  </div>
                  <span
                    className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                      run.estado === "completado"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : run.estado === "error"
                        ? "bg-red-50 text-red-700 border-red-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                  >
                    {run.estado === "completado" ? (
                      <CheckCircle2 size={10} />
                    ) : run.estado === "error" ? (
                      <AlertTriangle size={10} />
                    ) : (
                      <Loader2 size={10} className="animate-spin" />
                    )}
                    {run.estado} · {run.total_filas} filas
                  </span>
                </div>

                {run.error && <p className="text-[11px] text-red-600 mb-2">{run.error}</p>}

                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(run.detalle || []).map((d) => (
                    <span
                      key={d.catalogo}
                      className="text-[10px] font-medium px-2 py-1 rounded-md bg-slate-50 border border-slate-200 text-slate-600"
                    >
                      {d.catalogo}: {d.total_filas} ({d.nuevos_insertados} nuevas)
                    </span>
                  ))}
                </div>

                {run.estado === "completado" && (
                  <div className="border-t border-slate-100 pt-2 mt-1">
                    {!reportesPorRun[run.id] ? (
                      <p className="text-[11px] text-slate-400 flex items-center gap-1">
                        <Loader2 size={11} className="animate-spin" /> Cargando reportes...
                      </p>
                    ) : reportesPorRun[run.id].length === 0 ? (
                      <p className="text-[11px] text-slate-400">No se generaron reportes en esta corrida.</p>
                    ) : (
                      <div className="grid grid-cols-4 gap-1.5">
                        {reportesPorRun[run.id].map((rep) => (
                          <div
                            key={rep.id}
                            className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg pl-1.5 pr-1 py-1 hover:border-emerald-300 hover:shadow-sm transition-all"
                          >
                            <div className="w-6 h-6 rounded-md bg-emerald-50 flex items-center justify-center shrink-0">
                              <FileSpreadsheet size={13} className="text-emerald-600" />
                            </div>
                            <span
                              className="text-[10px] font-medium text-slate-600 truncate flex-1 min-w-0"
                              title={LABEL_TIPO[rep.tipo] || rep.tipo}
                            >
                              {LABEL_TIPO[rep.tipo] || rep.tipo}
                            </span>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => descargarReporte(rep)}
                                disabled={descargando === rep.id}
                                title="Descargar"
                                className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-indigo-600 transition-colors disabled:opacity-40"
                              >
                                <Download size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => compartirReporte(rep)}
                                disabled={descargando === rep.id}
                                title="Enviar por WhatsApp"
                                className="p-1 rounded text-slate-400 hover:bg-slate-100 hover:text-emerald-600 transition-colors disabled:opacity-40"
                              >
                                <Share2 size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {total > porPagina && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
              <p className="text-xs text-slate-500">{total} corridas en total</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.max(1, p - 1))}
                  disabled={pagina === 1}
                  className="w-7 h-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 disabled:opacity-30"
                >
                  <ChevronLeft size={13} />
                </button>
                <span className="text-xs text-slate-600 px-2">
                  {pagina} / {totalPaginas}
                </span>
                <button
                  type="button"
                  onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                  disabled={pagina === totalPaginas}
                  className="w-7 h-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 disabled:opacity-30"
                >
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}