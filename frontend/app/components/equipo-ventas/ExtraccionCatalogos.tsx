"use client";

import { useState, useEffect, useRef } from "react";
import { Download, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

import { fetchConToken } from "../../helbot-shared";

interface EstadoExtraccion {
  corriendo: boolean;
  catalogo_actual: string | null;
  catalogos_completados: number;
  total_catalogos: number;
  total_filas: number;
  iniciado_en: string | null;
  terminado_en: string | null;
  error: string | null;
}

export default function ExtraccionCatalogos({
  apiBase,
  uid,
  onEstadoChange,
}: {
  apiBase: string;
  uid: string;
  onEstadoChange?: (corriendo: boolean) => void;
}) {
  const [estado, setEstado] = useState<EstadoExtraccion | null>(null);
  const [lanzando, setLanzando] = useState(false);
  const intervalo = useRef<ReturnType<typeof setInterval> | null>(null);

    const consultarEstado = async () => {
    try {
      const r = await fetchConToken(`${apiBase}/perucompras/extraccion/estado`);
      const data: EstadoExtraccion = await r.json();
      setEstado(data);
      onEstadoChange?.(data.corriendo);
      if (!data.corriendo && intervalo.current) {
        clearInterval(intervalo.current);
        intervalo.current = null;
      }
    } catch {}
  };
  useEffect(() => {
    consultarEstado();
    return () => { if (intervalo.current) clearInterval(intervalo.current); };
  }, []);

const iniciarExtraccion = async () => {
    setLanzando(true);
    onEstadoChange?.(true);
    try {
      const params = new URLSearchParams({ uid });
      await fetchConToken(`${apiBase}/perucompras/extraccion/ejecutar?${params.toString()}`, { method: "POST" });
      intervalo.current = setInterval(consultarEstado, 3000);
      await consultarEstado();
    } finally {
      setLanzando(false);
    }
  };
  const corriendo = estado?.corriendo || lanzando;

  return (
    <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl px-3 py-2">
      <button
        type="button"
        onClick={iniciarExtraccion}
        disabled={corriendo}
        className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors"
      >
        {corriendo ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
        {corriendo ? "Extrayendo catálogos..." : "Extraer todos los catálogos"}
      </button>

      {estado && (
        <div className="text-xs text-slate-500">
          {estado.corriendo ? (
            <span>
              {estado.catalogo_actual ? `Catálogo: ${estado.catalogo_actual} · ` : ""}
              {estado.catalogos_completados}/{estado.total_catalogos} catálogos · {estado.total_filas} filas guardadas
            </span>
          ) : estado.error ? (
            <span className="flex items-center gap-1 text-red-600">
              <AlertTriangle size={12} /> {estado.error}
            </span>
          ) : estado.terminado_en ? (
            <span className="flex items-center gap-1 text-emerald-700">
              <CheckCircle2 size={12} /> Última extracción: {estado.total_filas} filas guardadas
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}