"use client";

import { useEffect, useState } from "react";
import {
  TrendingDown, TrendingUp, Gauge, MapPin, Truck, Package,
  Loader2, Clock, ShieldCheck, ShieldAlert, Users,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_HELBOT_API || "http://localhost:4002";

/* ============================================================
   Tipos — deben calzar con la respuesta de:
   GET /api/historial-comercial/proveedores
   GET /api/historial-comercial/fletes
   ============================================================ */
interface ResumenComercial {
  minimo: number | null;
  promedio: number | null;
  maximo: number | null;
  ultimo: number | null;
  operaciones: number;
  ultimaFecha: string | null;
}

interface RegistroReciente {
  precio: number;
  fecha: string;
  proveedorId?: number | null;
  clienteNombre?: string | null;
  ubicacion?: string | null;
}

interface PorCliente {
  clienteId: number;
  clienteNombre: string;
  ultimoPrecio: number;
  operaciones: number;
}

interface RespuestaHistorial {
  resumen: ResumenComercial;
  coincidencia: "exacta" | "aproximada" | "solo_entidad" | "sin_historial";
  historial: RegistroReciente[];
  porCliente?: PorCliente[];
}

/* ============================================================
   Etiquetas de nivel de coincidencia — nunca mostrar un promedio
   general como si fuera específico del destino/cliente.
   ============================================================ */
const ETIQUETA_COINCIDENCIA: Record<RespuestaHistorial["coincidencia"], string> = {
  exacta: "Coincidencia exacta",
  aproximada: "Referencia por ubicación",
  solo_entidad: "Referencia general (sin ubicación)",
  sin_historial: "Sin historial",
};

/* ============================================================
   HistorialPrecioProveedor — se muestra cuando hay proveedor +
   producto seleccionados en el formulario.
   ============================================================ */
export function HistorialPrecioProveedor({
  codigo,
  proveedores,
  clienteId,
  departamento,
  provincia,
  distrito,
}: {
  codigo?: string | null;
  /** Catálogo completo de proveedores (ya cargado en el padre) — se usa
   * SOLO para resolver el nombre de cada proveedor que aparece en el
   * historial, no para filtrar la búsqueda. */
  proveedores?: { id: number; razonSocial: string }[];
  clienteId?: string | number | null;
  departamento?: string | null;
  provincia?: string | null;
  distrito?: string | null;
}) {
  const [data, setData] = useState<RespuestaHistorial | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!codigo) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    setCargando(true);

    const params = new URLSearchParams({ productoCodigo: codigo });
    if (clienteId) params.set("clienteId", String(clienteId));
    if (departamento) params.set("departamento", departamento);
    if (provincia) params.set("provincia", provincia);
    if (distrito) params.set("distrito", distrito);

    fetch(`${API_BASE}/api/historial-comercial/proveedores?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setCargando(false));

    return () => controller.abort();
  }, [codigo, clienteId, departamento, provincia, distrito]);

  if (!codigo) return null;

  return (
    <TarjetaHistorial
      icono={<Package size={13} />}
      colorClase="sky"
      titulo="Historial de precios — todos los proveedores"
      nombreEntidad={null}
      ubicacion={[distrito, provincia, departamento].filter(Boolean).join(" / ")}
      cargando={cargando}
      data={data}
      etiquetaColumna="Precio"
      proveedores={proveedores}
    />
  );
}

/* ============================================================
   HistorialPrecioFlete — se muestra cuando hay agencia de
   transporte seleccionada (tipo_envio === AGENCIA). Analiza por
   DESTINO del servicio (departamento/provincia/distrito de la
   venta), no por producto ni por la sede de la agencia.
   ============================================================ */
export function HistorialPrecioFlete({
  transporteId,
  transporteNombre,
  clienteId,
  departamento,
  provincia,
  distrito,
}: {
  transporteId?: string | number | null;
  transporteNombre?: string | null;
  clienteId?: string | number | null;
  departamento?: string | null;
  provincia?: string | null;
  distrito?: string | null;
}) {
  const [data, setData] = useState<RespuestaHistorial | null>(null);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!transporteId) {
      setData(null);
      return;
    }
    const controller = new AbortController();
    setCargando(true);

    const params = new URLSearchParams({ transporteId: String(transporteId) });
    if (clienteId) params.set("clienteId", String(clienteId));
    if (departamento) params.set("departamento", departamento);
    if (provincia) params.set("provincia", provincia);
    if (distrito) params.set("distrito", distrito);

    fetch(`${API_BASE}/api/historial-comercial/fletes?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setCargando(false));

    return () => controller.abort();
  }, [transporteId, clienteId, departamento, provincia, distrito]);

  if (!transporteId) return null;

  return (
    <TarjetaHistorial
      icono={<Truck size={13} />}
      colorClase="indigo"
      titulo="Historial de fletes"
      nombreEntidad={transporteNombre}
      ubicacion={[distrito, provincia, departamento].filter(Boolean).join(" / ")}
      cargando={cargando}
      data={data}
      etiquetaColumna="Flete"
    />
  );
}
/* ============================================================
   Tarjeta compartida — versión profesional para ejecutivos.
   ============================================================ */
function TarjetaHistorial({
  icono,
  colorClase,
  titulo,
  nombreEntidad,
  ubicacion,
  cargando,
  data,
  etiquetaColumna,
  proveedores,
}: {
  icono: React.ReactNode;
  colorClase: "sky" | "indigo";
  titulo: string;
  nombreEntidad?: string | null;
  ubicacion?: string;
  cargando: boolean;
  data: RespuestaHistorial | null;
  etiquetaColumna: string;
  proveedores?: { id: number; razonSocial: string }[];
}) {
  const nombreProveedorDe = (id?: number | null) =>
    id != null ? proveedores?.find((p) => p.id === id)?.razonSocial : undefined;

  const estilos = {
    sky: {
      barra: "from-sky-400 to-sky-600",
      icono: "bg-sky-100 text-sky-600",
      valorHero: "text-sky-700",
      heroBg: "bg-sky-50 border-sky-100",
      chipExacta: "bg-emerald-50 border-emerald-200 text-emerald-700",
      chipAprox: "bg-amber-50 border-amber-200 text-amber-700",
      chipEntidad: "bg-slate-100 border-slate-200 text-slate-600",
      avatar: "bg-sky-100 text-sky-700",
    },
    indigo: {
      barra: "from-indigo-400 to-indigo-600",
      icono: "bg-indigo-100 text-indigo-600",
      valorHero: "text-indigo-700",
      heroBg: "bg-indigo-50 border-indigo-100",
      chipExacta: "bg-emerald-50 border-emerald-200 text-emerald-700",
      chipAprox: "bg-amber-50 border-amber-200 text-amber-700",
      chipEntidad: "bg-slate-100 border-slate-200 text-slate-600",
      avatar: "bg-indigo-100 text-indigo-700",
    },
  }[colorClase];

  const sinHistorial = !cargando && (!data || !data.resumen || data.resumen.operaciones === 0);

  const chipEstilo =
    data?.coincidencia === "exacta"
      ? estilos.chipExacta
      : data?.coincidencia === "aproximada"
      ? estilos.chipAprox
      : estilos.chipEntidad;

  const iniciales = (nombre?: string | null) =>
    (nombre || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("");

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Barra superior de acento */}
      <div className={`h-1 bg-gradient-to-r ${estilos.barra}`} />

      <div className="p-3.5 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${estilos.icono}`}>
              {icono}
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-bold leading-tight text-slate-800">{titulo}</p>
              {nombreEntidad && (
                <p className="text-[10.5px] text-slate-500 truncate mt-0.5">{nombreEntidad}</p>
              )}
              {ubicacion && (
                <p className="flex items-center gap-1 text-[10px] text-slate-400 mt-0.5">
                  <MapPin size={10} className="shrink-0" /> {ubicacion}
                </p>
              )}
            </div>
          </div>
          {cargando && <Loader2 size={14} className="animate-spin text-slate-400 shrink-0 mt-1" />}
        </div>

        {sinHistorial && (
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 border border-dashed border-slate-200 px-3 py-3">
            <ShieldAlert size={15} className="text-slate-300 shrink-0" />
            <p className="text-[11px] text-slate-400">
              Sin historial suficiente para esta combinación todavía.
            </p>
          </div>
        )}

        {!sinHistorial && data && (
          <>
            {/* Chip de nivel de confianza */}
            <div
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-semibold ${chipEstilo}`}
            >
              {data.coincidencia === "exacta" ? <ShieldCheck size={11} /> : <ShieldAlert size={11} />}
              {ETIQUETA_COINCIDENCIA[data.coincidencia]}
              <span className="opacity-60">·</span>
              {data.resumen.operaciones} operación{data.resumen.operaciones === 1 ? "" : "es"}
            </div>

            {/* Hero: último precio */}
            {data.resumen.ultimo != null && (
              <div className={`rounded-xl border px-3 py-2.5 flex items-center justify-between gap-2 ${estilos.heroBg}`}>
                <div>
                  <p className="text-[9.5px] font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-1">
                    <Clock size={10} /> Último {etiquetaColumna.toLowerCase()} registrado
                  </p>
                  {data.resumen.ultimaFecha && (
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {new Date(data.resumen.ultimaFecha).toLocaleDateString("es-PE", {
                        day: "2-digit", month: "long", year: "numeric",
                      })}
                    </p>
                  )}
                </div>
                <p className={`text-[20px] font-extrabold leading-none ${estilos.valorHero}`}>
                  S/ {Number(data.resumen.ultimo).toFixed(2)}
                </p>
              </div>
            )}

            {/* Mínimo / Promedio / Máximo */}
            <div className="grid grid-cols-3 gap-2">
              <Metrica icono={<TrendingDown size={12} />} etiqueta="Mínimo" valor={data.resumen.minimo} color="emerald" />
              <Metrica icono={<Gauge size={12} />} etiqueta="Promedio" valor={data.resumen.promedio} color="amber" />
              <Metrica icono={<TrendingUp size={12} />} etiqueta="Máximo" valor={data.resumen.maximo} color="rose" />
            </div>

            {/* Historial reciente */}
            {data.historial.length > 0 && (
              <div>
                <p className="text-[9.5px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                  Operaciones recientes
                </p>
                <div className="space-y-1 max-h-[140px] overflow-y-auto pr-0.5">
                  {data.historial.slice(0, 6).map((r, i) => {
                    const nombreProv = nombreProveedorDe(r.proveedorId);
                    const etiqueta = nombreProv || r.clienteNombre;
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-2 rounded-lg bg-slate-50 border border-slate-100 px-2 py-1.5"
                      >
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[8.5px] font-bold ${estilos.avatar}`}>
                          {iniciales(etiqueta)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10.5px] text-slate-600 truncate leading-tight">
                            {etiqueta || "Sin referencia"}
                          </p>
                          <p className="text-[9px] text-slate-400 leading-tight">
                            {new Date(r.fecha).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" })}
                          </p>
                        </div>
                        <span className={`text-[11px] font-bold shrink-0 ${estilos.valorHero}`}>
                          S/ {Number(r.precio).toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Por cliente */}
            {data.porCliente && data.porCliente.length > 0 && (
              <div className="pt-2 border-t border-slate-100">
                <p className="flex items-center gap-1 text-[9.5px] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                  <Users size={10} /> Precio más reciente por cliente
                </p>
                <div className="space-y-1">
                  {data.porCliente.slice(0, 4).map((c) => (
                    <div key={c.clienteId} className="flex items-center gap-2">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-[8.5px] font-bold ${estilos.avatar}`}>
                        {iniciales(c.clienteNombre)}
                      </div>
                      <span className="text-[10.5px] text-slate-500 truncate flex-1">{c.clienteNombre}</span>
                      <span className="text-[9.5px] text-slate-400 shrink-0">{c.operaciones} op.</span>
                      <span className={`text-[11px] font-bold shrink-0 ${estilos.valorHero}`}>
                        S/ {Number(c.ultimoPrecio).toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Metrica({
  icono, etiqueta, valor, color,
}: {
  icono: React.ReactNode; etiqueta: string; valor: number | null; color: "emerald" | "amber" | "rose";
}) {
  const estilos = {
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    rose: "bg-rose-50 border-rose-200 text-rose-700",
  }[color];
  return (
    <div className={`rounded-xl border px-2 py-1.5 flex flex-col items-center text-center ${estilos}`}>
      <div className="flex items-center gap-1 opacity-80">
        {icono}
        <span className="text-[8.5px] font-semibold uppercase tracking-wide">{etiqueta}</span>
      </div>
      <p className="text-[13px] font-extrabold leading-tight mt-1">
        {valor != null ? `S/ ${Number(valor).toFixed(2)}` : "—"}
      </p>
    </div>
  );
}