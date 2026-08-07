"use client";

import React, { useState, useEffect, useRef } from "react";
import { Loader2, CheckCircle2, AlertTriangle, PlayCircle, ListChecks, RefreshCw } from "lucide-react";
import { fetchConToken } from "../../helbot-shared";

interface EstadoStock {
  fase: "ocioso" | "extrayendo" | "listo" | "modificando" | "completado";
  categoria_actual: string | null;
  categorias_completadas: number;
  total_categorias: number;
  total_a_modificar: number;
  procesados: number;
  iniciado_en: string | null;
  terminado_en: string | null;
  error: string | null;
}

interface StatsCategoria {
  categoria: string;
  total: number;
  pendientes: number;
  modificados: number;
  omitidos: number;
  errores: number;
}

interface FilaStock {
  id: string | null;
  categoria: string;
  ficha_producto: string;
  codigo: string;
  precio_vigente: string;
  stock_actual: number;
  stock_nuevo: number | null;
  estado: string;
}

function badgeEstado(estado: string) {
  if (estado === "MODIFICADO") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (estado === "OMITIDO") return "bg-slate-100 text-slate-500 border-slate-200";
  if (estado === "PENDIENTE") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-red-50 text-red-700 border-red-200";
}

export default function ModificarStock({ apiBase, uid }: { apiBase: string; uid: string }) {
  const [estado, setEstado] = useState<EstadoStock | null>(null);
  const [statsCategorias, setStatsCategorias] = useState<StatsCategoria[]>([]);
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());
  const [categoriaExpandida, setCategoriaExpandida] = useState<string | null>(null);
  const [filasDetalle, setFilasDetalle] = useState<FilaStock[]>([]);
  const [lanzando, setLanzando] = useState(false);
  const intervalo = useRef<ReturnType<typeof setInterval> | null>(null);

  const consultarEstado = async () => {
    try {
      const r = await fetchConToken(`${apiBase}/perucompras/stock/estado`);
      const data: EstadoStock = await r.json();
      setEstado(data);
      if (data.fase === "listo" || data.fase === "completado") {
        await cargarCategorias();
        if (intervalo.current) {
          clearInterval(intervalo.current);
          intervalo.current = null;
        }
      }
    } catch {}
  };

  const cargarCategorias = async () => {
    try {
      const r = await fetchConToken(`${apiBase}/perucompras/stock/categorias`);
      const data = await r.json();
      const lista: StatsCategoria[] = data.categorias || [];
      setStatsCategorias(lista);
      // Por defecto, todas seleccionadas (igual que "Seleccionar todo" del bot viejo)
      setSeleccionadas((prev) => (prev.size === 0 ? new Set(lista.map((c) => c.categoria)) : prev));
    } catch {}
  };

  useEffect(() => {
    consultarEstado();
    return () => {
      if (intervalo.current) clearInterval(intervalo.current);
    };
  }, []);

  const extraer = async () => {
    setLanzando(true);
    setStatsCategorias([]);
    setSeleccionadas(new Set());
    try {
      const params = new URLSearchParams({ uid });
      await fetchConToken(`${apiBase}/perucompras/stock/extraer?${params.toString()}`, { method: "POST" });
      intervalo.current = setInterval(consultarEstado, 2500);
      await consultarEstado();
    } finally {
      setLanzando(false);
    }
  };

  const ejecutarModificacion = async () => {
    if (seleccionadas.size === 0) return;
    setLanzando(true);
    try {
      const params = new URLSearchParams({ uid });
      await fetchConToken(`${apiBase}/perucompras/stock/modificar?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categorias: Array.from(seleccionadas) }),
      });
      intervalo.current = setInterval(consultarEstado, 2500);
      await consultarEstado();
    } finally {
      setLanzando(false);
    }
  };

  const verDetalle = async (categoria: string) => {
    if (categoriaExpandida === categoria) {
      setCategoriaExpandida(null);
      return;
    }
    setCategoriaExpandida(categoria);
    try {
      const params = new URLSearchParams({ categoria });
      const r = await fetchConToken(`${apiBase}/perucompras/stock/resultados?${params.toString()}`);
      const data = await r.json();
      setFilasDetalle(Array.isArray(data.filas) ? data.filas : []);
    } catch {
      setFilasDetalle([]);
    }
  };

  const toggleCategoria = (cat: string) => {
    setSeleccionadas((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(cat)) nuevo.delete(cat);
      else nuevo.add(cat);
      return nuevo;
    });
  };

  const seleccionarTodo = () => setSeleccionadas(new Set(statsCategorias.map((c) => c.categoria)));
  const deseleccionarTodo = () => setSeleccionadas(new Set());

    const fase = estado?.fase ?? "ocioso";
  const extrayendoAhora = fase === "extrayendo";
  const modificandoAhora = fase === "modificando";
  const corriendo = extrayendoAhora || modificandoAhora || lanzando;
  const totalPendientesSeleccionadas = statsCategorias
    .filter((c) => seleccionadas.has(c.categoria))
    .reduce((acc, c) => acc + c.pendientes, 0);

  return (
    <div>
      {/* Barra de acción principal */}
      <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 mb-5 flex-wrap">
        <button
          type="button"
          onClick={extraer}
          disabled={corriendo}
          className="flex items-center gap-2 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-40 transition-colors"
        >
          {extrayendoAhora ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          {extrayendoAhora ? "Extrayendo productos..." : "1. Extraer productos"}
        </button>

            <button
          type="button"
          onClick={ejecutarModificacion}
          disabled={corriendo || fase === "ocioso" || extrayendoAhora || seleccionadas.size === 0}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-40 transition-colors"
        >
          {modificandoAhora ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />}
          {modificandoAhora
            ? "Modificando stock..."
            : `2. Modificar seleccionadas (${totalPendientesSeleccionadas} productos)`}
        </button>

            {estado && (
          <div className="text-xs text-slate-500">
            {extrayendoAhora ? (
              <span>
                {estado.categoria_actual ? `Extrayendo: ${estado.categoria_actual} · ` : ""}
                {estado.categorias_completadas}/{estado.total_categorias} categorías
              </span>
            ) : modificandoAhora ? (
              <span>
                {estado.categoria_actual ? `Modificando: ${estado.categoria_actual} · ` : ""}
                {estado.procesados}/{estado.total_a_modificar} productos
              </span>
            ) : estado.error ? (
              <span className="flex items-center gap-1 text-red-600">
                <AlertTriangle size={12} /> {estado.error}
              </span>
            ) : fase === "completado" ? (
              <span className="flex items-center gap-1 text-emerald-700">
                <CheckCircle2 size={12} /> Modificación completada — revisa la tabla de abajo
              </span>
            ) : fase === "listo" ? (
              <span>Productos extraídos — selecciona categorías y modifica</span>
            ) : (
              <span>Sin extraer todavía</span>
            )}
          </div>
        )}
      </div>

        {statsCategorias.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl py-16 text-center text-slate-400 text-sm">
          {extrayendoAhora ? (
            <>
              <Loader2 size={18} className="animate-spin inline mr-2" /> Extrayendo productos, esto puede tardar unos minutos...
            </>
          ) : (
            "Empieza extrayendo los productos para ver las categorías disponibles."
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ListChecks size={15} className="text-indigo-600" />
              <p className="text-sm font-semibold text-slate-800">Categorías ({statsCategorias.length})</p>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={seleccionarTodo} className="text-xs font-medium text-indigo-600 hover:text-indigo-800">
                Seleccionar todo
              </button>
              <button type="button" onClick={deseleccionarTodo} className="text-xs font-medium text-slate-500 hover:text-slate-800">
                Deseleccionar todo
              </button>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-6">
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-center w-8">
                      <input
                        type="checkbox"
                        checked={seleccionadas.size === statsCategorias.length}
                        onChange={(e) => (e.target.checked ? seleccionarTodo() : deseleccionarTodo())}
                        className="w-3.5 h-3.5 rounded border-slate-300"
                      />
                    </th>
                    <th className="px-3 py-2 text-left">Categoría</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Pendientes</th>
                    <th className="px-3 py-2 text-right">Modificados</th>
                    <th className="px-3 py-2 text-right">Omitidos</th>
                    <th className="px-3 py-2 text-right">Errores</th>
                    <th className="px-3 py-2 text-center">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {statsCategorias.map((c) => (
                    <React.Fragment key={c.categoria}>
                      <tr className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={seleccionadas.has(c.categoria)}
                            onChange={() => toggleCategoria(c.categoria)}
                            className="w-3.5 h-3.5 rounded border-slate-300"
                          />
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-800">{c.categoria}</td>
                        <td className="px-3 py-2 text-right">{c.total}</td>
                        <td className="px-3 py-2 text-right text-amber-700 font-semibold">{c.pendientes}</td>
                        <td className="px-3 py-2 text-right text-emerald-700 font-semibold">{c.modificados}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{c.omitidos}</td>
                        <td className="px-3 py-2 text-right text-red-600">{c.errores}</td>
                        <td className="px-3 py-2 text-center">
                          <button type="button" onClick={() => verDetalle(c.categoria)} className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800">
                            {categoriaExpandida === c.categoria ? "Ocultar" : "Ver"}
                          </button>
                        </td>
                      </tr>
                      {categoriaExpandida === c.categoria && (
                        <tr>
                          <td colSpan={8} className="bg-slate-50/60 px-3 py-3">
                            <table className="w-full text-[11px]">
                              <thead className="text-slate-500">
                                <tr>
                                  <th className="text-left pb-1">Ficha</th>
                                  <th className="text-left pb-1">Código</th>
                                  <th className="text-right pb-1">Stock actual</th>
                                  <th className="text-right pb-1">Stock nuevo</th>
                                  <th className="text-center pb-1">Estado</th>
                                </tr>
                              </thead>
                              <tbody>
                                {filasDetalle.map((f, i) => (
                                  <tr key={i} className="border-t border-slate-200">
                                    <td className="py-1 max-w-[300px] truncate" title={f.ficha_producto}>{f.ficha_producto}</td>
                                    <td className="py-1">{f.codigo}</td>
                                    <td className="py-1 text-right">{f.stock_actual}</td>
                                    <td className="py-1 text-right font-semibold">{f.stock_nuevo ?? "—"}</td>
                                    <td className="py-1 text-center">
                                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeEstado(f.estado)}`}>{f.estado}</span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}