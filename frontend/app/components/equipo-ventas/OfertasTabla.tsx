"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";

import { fetchConToken } from "../../helbot-shared";

interface FilaOferta {
  id_catalogo_producto: number;
  descripcion: string;
  moneda: string;
  acuerdo: string;
  catalogo: string;
  categoria: string;
  estado_actual: string;
  precio_maximo: number | null;
  precio_actual_al_correr: number | null;
  intentos: number;
  motivo: string;
  detalle: string;
  enviado_en: string | null;
  enviado_por: string | null;
  envio_error: string | null;
  creado_en: string;
}

function badgeMotivo(motivo: string) {
  switch (motivo) {
    case "ok":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "reusado":
      return "bg-sky-50 text-sky-700 border-sky-200";
    case "sin_techo_encontrado":
    case "techo_seguridad":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "ok_no_confirmado":
    case "reusado_no_confirmado":
    case "sin_rango_encontrado":
    case "error_guardado":
      return "bg-red-50 text-red-700 border-red-200";
    case "deteccion_no_confiable":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

// Motivos donde el precio_maximo de la BD está confirmado como puesto
// de verdad en el campo de Perú Compras — únicos casos donde tiene
// sentido habilitar el envío de oferta.
const MOTIVOS_ENVIABLES = new Set(["ok", "reusado"]);

export default function OfertasTabla({ apiBase, uid, tick }: { apiBase: string; uid: string; tick?: number }) {
  const [filas, setFilas] = useState<FilaOferta[]>([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [porPagina] = useState(30);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const [runId, setRunId] = useState(0);
  const [opcionesAcuerdo, setOpcionesAcuerdo] = useState<string[]>([]);
  const [opcionesCatalogo, setOpcionesCatalogo] = useState<string[]>([]);
  const [opcionesCategoria, setOpcionesCategoria] = useState<string[]>([]);
  const [acuerdoSel, setAcuerdoSel] = useState("");
  const [catalogoSel, setCatalogoSel] = useState("");
  const [categoriaSel, setCategoriaSel] = useState("");
  const [precioMin, setPrecioMin] = useState("");
  const [precioMax, setPrecioMax] = useState("");

  const soloEnElTecho = () => {
    setPrecioMin("500");
    setPrecioMax("500");
    setPagina(1);
  };

  const limpiarFiltroPrecio = () => {
    setPrecioMin("");
    setPrecioMax("");
    setPagina(1);
  };


  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
const [mostrarModal, setMostrarModal] = useState(false);
const [enviando, setEnviando] = useState(false);


const alternarSeleccion = (id: number) => {
  setSeleccionados((prev) => {
    const s = new Set(prev);
    s.has(id) ? s.delete(id) : s.add(id);
    return s;
  });
};

const alternarTodos = () => {
  if (seleccionados.size === filas.length) {
    setSeleccionados(new Set());
  } else {
    setSeleccionados(new Set(filas.map((f) => f.id_catalogo_producto)));
  }
};

const enviarOfertas = async (ids: number[]) => {
  setEnviando(true);
  try {
    const params = new URLSearchParams({ uid, run_id: String(runId) });
    ids.forEach((id) => params.append("ids", String(id)));
    const r = await fetchConToken(`${apiBase}/perucompras/ofertas/enviar?${params.toString()}`, { method: "POST" });
    await r.json();
    setSeleccionados(new Set());
    await cargarDatos();
  } finally {
    setEnviando(false);
    setMostrarModal(false);
  }
};

  const cargarFiltros = useCallback(async () => {
    try {
      const r = await fetchConToken(`${apiBase}/perucompras/ofertas/resultados/filtros?uid=${encodeURIComponent(uid)}`);
      const data = await r.json();
      setRunId(data.run_id || 0);
      setOpcionesAcuerdo(Array.isArray(data.acuerdos) ? data.acuerdos : []);
      setOpcionesCatalogo(Array.isArray(data.catalogos) ? data.catalogos : []);
      setOpcionesCategoria(Array.isArray(data.categorias) ? data.categorias : []);
    } catch {
      // si falla, la tabla igual funciona sin filtros
    }
  }, [apiBase, uid]);

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const params = new URLSearchParams({
        uid,
        run_id: String(runId || 0),
        pagina: String(pagina),
        por_pagina: String(porPagina),
      });
      if (acuerdoSel) params.set("acuerdo", acuerdoSel);
      if (catalogoSel) params.set("catalogo", catalogoSel);
      if (categoriaSel) params.set("categoria", categoriaSel);
      if (precioMin !== "") params.set("precio_min", precioMin);
      if (precioMax !== "") params.set("precio_max", precioMax);
      const r = await fetchConToken(`${apiBase}/perucompras/ofertas/resultados?${params.toString()}`);
      if (!r.ok) throw new Error(`Error HTTP ${r.status}`);
      const data = await r.json();
      setFilas(Array.isArray(data.filas) ? data.filas : []);
      setTotal(data.total || 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando resultados");
      setFilas([]);
    } finally {
      setCargando(false);
    }
  }, [apiBase, uid, runId, pagina, porPagina, acuerdoSel, catalogoSel, categoriaSel, precioMin, precioMax]);

  // Al montar y cuando termina una corrida (tick cambia), recarga los filtros disponibles
  useEffect(() => {
    cargarFiltros();
  }, [cargarFiltros, tick]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const cambiarAcuerdo = (valor: string) => {
    setAcuerdoSel(valor);
    setCatalogoSel("");
    setCategoriaSel("");
    setPagina(1);
  };

  const cambiarCatalogo = (valor: string) => {
    setCatalogoSel(valor);
    setCategoriaSel("");
    setPagina(1);
  };

  const cambiarCategoria = (valor: string) => {
    setCategoriaSel(valor);
    setPagina(1);
  };

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={acuerdoSel}
          onChange={(e) => cambiarAcuerdo(e.target.value)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600 max-w-[220px]"
        >
          <option value="">Todos los acuerdos marco</option>
          {opcionesAcuerdo.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        <select
          value={catalogoSel}
          onChange={(e) => cambiarCatalogo(e.target.value)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600 max-w-[220px]"
        >
          <option value="">Todos los catálogos</option>
          {opcionesCatalogo.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={categoriaSel}
          onChange={(e) => cambiarCategoria(e.target.value)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600 max-w-[220px]"
        >
          <option value="">Todas las categorías</option>
          {opcionesCategoria.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <input
            type="number"
            step="0.01"
            placeholder="Precio min"
            value={precioMin}
            onChange={(e) => {
              setPrecioMin(e.target.value);
              setPagina(1);
            }}
            className="w-24 text-xs border border-slate-200 rounded-md px-2 py-1.5"
          />
          <span className="text-xs text-slate-400">–</span>
          <input
            type="number"
            step="0.01"
            placeholder="Precio max"
            value={precioMax}
            onChange={(e) => {
              setPrecioMax(e.target.value);
              setPagina(1);
            }}
            className="w-24 text-xs border border-slate-200 rounded-md px-2 py-1.5"
          />
        </div>

        <button
          type="button"
          onClick={soloEnElTecho}
          className="text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-md px-2 py-1.5 hover:bg-amber-100"
          title="Muestra solo los productos que quedaron en el techo de seguridad (500)"
        >
          Solo en el techo (500)
        </button>

        {(precioMin !== "" || precioMax !== "") && (
          <button
            type="button"
            onClick={limpiarFiltroPrecio}
            className="text-xs text-slate-400 hover:text-slate-600 underline"
          >
            Quitar filtro de precio
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          <AlertTriangle size={15} /> {error}
        </div>
      )}


    {seleccionados.size > 0 && (
    <div className="mb-3 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
        <span className="text-xs text-amber-800 font-medium">{seleccionados.size} seleccionado(s)</span>
        <button
        type="button"
        onClick={() => setMostrarModal(true)}
        disabled={enviando}
        className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md px-3 py-1.5 disabled:opacity-50"
        >
        Enviar oferta(s) seleccionada(s)
        </button>
    </div>
    )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                <tr>
                <th className="px-3 py-2 text-center">
                    <input type="checkbox" checked={filas.length > 0 && seleccionados.size === filas.length} onChange={alternarTodos} />
                </th>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-left">Acuerdo / Catálogo / Categoría</th>
                <th className="px-3 py-2 text-left">Estado actual</th>
                <th className="px-3 py-2 text-right">Precio en Perú Compras</th>
                <th className="px-3 py-2 text-right">Precio máximo</th>
                <th className="px-3 py-2 text-left">Moneda</th>
                <th className="px-3 py-2 text-right">Intentos</th>
                <th className="px-3 py-2 text-center">Resultado</th>
                <th className="px-3 py-2 text-center">Enviado</th>
                <th className="px-3 py-2 text-center">Acción</th>
                </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={11} className="text-center py-10 text-slate-400">
                    <Loader2 size={16} className="animate-spin inline mr-2" /> Cargando...
                  </td>
                </tr>
              ) : filas.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-10 text-slate-400">
                    Aún no hay resultados — dale a &quot;Buscar precios máximos&quot; arriba.
                  </td>
                </tr>
              ) : (
                filas.map((f) => (
                <tr key={f.id_catalogo_producto} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 text-center">
                    <input
                    type="checkbox"
                    checked={seleccionados.has(f.id_catalogo_producto)}
                    onChange={() => alternarSeleccion(f.id_catalogo_producto)}
                    disabled={!MOTIVOS_ENVIABLES.has(f.motivo) || f.precio_maximo === null}
                    />
                </td>
                <td className="px-3 py-2 max-w-[320px] truncate font-medium text-slate-800" title={f.descripcion}>
                    {f.descripcion}
                </td>
                <td className="px-3 py-2 max-w-[260px] truncate text-slate-500" title={`${f.acuerdo} / ${f.catalogo} / ${f.categoria}`}>
                    {f.catalogo} / {f.categoria}
                </td>
                <td className="px-3 py-2 text-slate-500">{f.estado_actual || "—"}</td>
                <td className="px-3 py-2 text-right text-slate-400">
                    {f.precio_actual_al_correr !== null ? Number(f.precio_actual_al_correr).toFixed(2) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-semibold">
                    {f.precio_maximo !== null ? Number(f.precio_maximo).toFixed(2) : "—"}
                </td>
                <td className="px-3 py-2">{f.moneda}</td>
                <td className="px-3 py-2 text-right text-slate-500">{f.intentos}</td>
                <td className="px-3 py-2 text-center">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badgeMotivo(f.motivo)}`} title={f.detalle}>
                    {f.motivo}
                    </span>
                </td>
                <td className="px-3 py-2 text-center">
                    {f.enviado_en ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                        Enviado
                    </span>
                    ) : f.envio_error ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-200" title={f.envio_error}>
                        Error
                    </span>
                    ) : (
                    <span className="text-[10px] text-slate-400">—</span>
                    )}
                </td>
                <td className="px-3 py-2 text-center">
                    <button
                    type="button"
                    disabled={!MOTIVOS_ENVIABLES.has(f.motivo) || f.precio_maximo === null || !!f.enviado_en || enviando}
                    onClick={() => {
                        setSeleccionados(new Set([f.id_catalogo_producto]));
                        setMostrarModal(true);
                    }}
                    className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                    Enviar
                    </button>
                </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/60">
            <p className="text-xs text-slate-500">
              {(pagina - 1) * porPagina + 1}–{Math.min(pagina * porPagina, total)} de {total}
            </p>
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
      </div>


      {mostrarModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5">
            <div className="flex items-center gap-2 text-amber-700 mb-2">
                <AlertTriangle size={18} />
                <h3 className="font-semibold text-sm">Confirmar envío de oferta</h3>
            </div>
            <p className="text-sm text-slate-600 mb-4">
                Estás por registrar <strong>{seleccionados.size}</strong> oferta(s) en Perú Compras con el
                precio máximo encontrado. Esta acción <strong>impacta directamente en el portal</strong> y
                no se puede deshacer desde acá. ¿Confirmás?
            </p>
            <div className="flex justify-end gap-2">
                <button
                type="button"
                onClick={() => setMostrarModal(false)}
                disabled={enviando}
                className="text-xs font-medium text-slate-500 px-3 py-1.5 rounded-md hover:bg-slate-100"
                >
                Cancelar
                </button>
                <button
                type="button"
                onClick={() => enviarOfertas(Array.from(seleccionados))}
                disabled={enviando}
                className="text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md px-3 py-1.5 disabled:opacity-50"
                >
                {enviando ? "Enviando..." : "Sí, enviar oferta(s)"}
                </button>
            </div>
            </div>
        </div>
        )}
    </div>
  );
}