"use client";

import { useEffect, useState } from "react";
import { X, Search, Package, Truck, MapPin, Loader2, ShieldAlert } from "lucide-react";
import { HistorialPrecioProveedor } from "./HistorialComercialCard";

const API_BASE = process.env.NEXT_PUBLIC_HELBOT_API || "http://localhost:4002";

/* ============================================================
   ModalConsultarPrecios
   ------------------------------------------------------------
   Botón "Consultar precios" -> abre este modal con DOS bloques
   independientes, porque en la base de datos el flete NO está
   ligado al producto (ver historial_precios_flete: solo tiene
   transporte_id + destino, no producto_codigo):

   1) Por producto  -> historial de PRECIOS (reutiliza
      HistorialPrecioProveedor tal cual ya la tienes).
   2) Por destino    -> historial de FLETES agrupado por
      transportista (nuevo endpoint /fletes/por-destino,
      no requiere saber el transporteId de antemano).

   Uso en tabventaserp.tsx:

     const [modalPreciosAbierto, setModalPreciosAbierto] = useState(false);
     ...
     <ModalConsultarPrecios
       abierto={modalPreciosAbierto}
       onCerrar={() => setModalPreciosAbierto(false)}
       proveedores={proveedores}
       clienteId={clienteSeleccionado?.id}
       departamentoInicial={departamento}
       provinciaInicial={provincia}
       distritoInicial={distrito}
     />
   ============================================================ */

interface TransportistaResumen {
  transporteId: number;
  transporteNombre: string | null;
  resumen: {
    minimo: number | null;
    promedio: number | null;
    maximo: number | null;
    ultimo: number | null;
    operaciones: number;
    ultimaFecha: string | null;
  };
  historial: {
    precio: number;
    cantidad?: number | null;
    fecha: string;
    clienteNombre?: string | null;
    codigoVenta?: string | null;
    codigoOp?: string | null;
  }[];
}

export function ModalConsultarPrecios({
  abierto,
  onCerrar,
  proveedores,
  clienteId,
  departamentoInicial,
  provinciaInicial,
  distritoInicial,
}: {
  abierto: boolean;
  onCerrar: () => void;
  proveedores?: { id: number; razonSocial: string }[];
  clienteId?: string | number | null;
  departamentoInicial?: string | null;
  provinciaInicial?: string | null;
  distritoInicial?: string | null;
}) {
  const [tab, setTab] = useState<"producto" | "flete">("producto");

  // --- Bloque producto (precios) ---
  const [codigoInput, setCodigoInput] = useState("");
  const [codigoBuscado, setCodigoBuscado] = useState<string | null>(null);

  // --- Bloque flete (por destino) ---
  const [departamento, setDepartamento] = useState(departamentoInicial || "");
  const [provincia, setProvincia] = useState(provinciaInicial || "");
  const [distrito, setDistrito] = useState(distritoInicial || "");
  const [destinoBuscado, setDestinoBuscado] = useState<{
    departamento: string; provincia: string; distrito: string;
  } | null>(null);
  const [transportistas, setTransportistas] = useState<TransportistaResumen[] | null>(null);
  const [cargandoFlete, setCargandoFlete] = useState(false);

  useEffect(() => {
    if (!abierto) {
      // reset al cerrar para no arrastrar resultados de la consulta anterior
      setCodigoInput("");
      setCodigoBuscado(null);
      setDestinoBuscado(null);
      setTransportistas(null);
      setTab("producto");
    }
  }, [abierto]);

  useEffect(() => {
    if (!destinoBuscado) {
      setTransportistas(null);
      return;
    }
    const controller = new AbortController();
    setCargandoFlete(true);
    const params = new URLSearchParams();
    if (destinoBuscado.departamento) params.set("departamento", destinoBuscado.departamento);
    if (destinoBuscado.provincia) params.set("provincia", destinoBuscado.provincia);
    if (destinoBuscado.distrito) params.set("distrito", destinoBuscado.distrito);

    fetch(`${API_BASE}/api/historial-comercial/fletes/por-destino?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => setTransportistas(data.transportistas || []))
      .catch(() => setTransportistas(null))
      .finally(() => setCargandoFlete(false));

    return () => controller.abort();
  }, [destinoBuscado]);

  if (!abierto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-slate-900/50 p-3 overflow-y-auto">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border border-slate-200 my-6">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h2 className="text-[14px] font-bold text-slate-800">Consultar precios</h2>
          <button
            onClick={onCerrar}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3">
          <BotonTab activo={tab === "producto"} onClick={() => setTab("producto")} icono={<Package size={13} />} texto="Por producto" />
          <BotonTab activo={tab === "flete"} onClick={() => setTab("flete")} icono={<Truck size={13} />} texto="Por destino (flete)" />
        </div>

        <div className="p-4 space-y-3">
          {tab === "producto" && (
            <>
              <div className="flex gap-2">
                <input
                  value={codigoInput}
                  onChange={(e) => setCodigoInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setCodigoBuscado(codigoInput.trim() || null)}
                  placeholder="Código de producto (ej. PROD-0123)"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-[12.5px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-300"
                />
                <button
                  onClick={() => setCodigoBuscado(codigoInput.trim() || null)}
                  disabled={!codigoInput.trim()}
                  className="shrink-0 flex items-center gap-1.5 rounded-lg bg-sky-600 text-white text-[12px] font-semibold px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-sky-700"
                >
                  <Search size={13} /> Buscar
                </button>
              </div>

              {!codigoBuscado && (
                <p className="text-[11px] text-slate-400 px-1">
                  Ingresa el código del producto para ver a qué precios se ha comprado antes,
                  con qué proveedores y en qué zonas.
                </p>
              )}

              {codigoBuscado && (
                <HistorialPrecioProveedor
                  codigo={codigoBuscado}
                  proveedores={proveedores}
                  clienteId={clienteId}
                  departamento={departamentoInicial}
                  provincia={provinciaInicial}
                  distrito={distritoInicial}
                />
              )}
            </>
          )}

          {tab === "flete" && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <input
                  value={departamento}
                  onChange={(e) => setDepartamento(e.target.value)}
                  placeholder="Departamento"
                  className="rounded-lg border border-slate-200 px-2.5 py-2 text-[12px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                />
                <input
                  value={provincia}
                  onChange={(e) => setProvincia(e.target.value)}
                  placeholder="Provincia"
                  className="rounded-lg border border-slate-200 px-2.5 py-2 text-[12px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                />
                <input
                  value={distrito}
                  onChange={(e) => setDistrito(e.target.value)}
                  placeholder="Distrito"
                  className="rounded-lg border border-slate-200 px-2.5 py-2 text-[12px] text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                />
              </div>
              <button
                onClick={() =>
                  setDestinoBuscado({
                    departamento: departamento.trim(),
                    provincia: provincia.trim(),
                    distrito: distrito.trim(),
                  })
                }
                disabled={!departamento.trim() && !provincia.trim() && !distrito.trim()}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 text-white text-[12px] font-semibold px-3 py-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-indigo-700"
              >
                <Search size={13} /> Buscar transportistas
              </button>

              {!destinoBuscado && (
                <p className="text-[11px] text-slate-400 px-1">
                  El flete no depende del producto sino del destino. Ingresa al menos un campo
                  de ubicación para ver qué transportistas ya han cotizado hacia esa zona.
                </p>
              )}

              {cargandoFlete && (
                <div className="flex items-center gap-2 text-[11px] text-slate-400 px-1">
                  <Loader2 size={13} className="animate-spin" /> Buscando historial de fletes…
                </div>
              )}

              {destinoBuscado && !cargandoFlete && (!transportistas || transportistas.length === 0) && (
                <div className="flex items-center gap-2 rounded-xl bg-slate-50 border border-dashed border-slate-200 px-3 py-3">
                  <ShieldAlert size={15} className="text-slate-300 shrink-0" />
                  <p className="text-[11px] text-slate-400">
                    No hay historial de fletes registrado hacia ese destino todavía.
                  </p>
                </div>
              )}

              {transportistas && transportistas.length > 0 && (
                <div className="space-y-2 max-h-[360px] overflow-y-auto pr-0.5">
                  {transportistas.map((t) => (
                    <div key={t.transporteId} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-indigo-50 border-b border-indigo-100">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Truck size={12} className="text-indigo-600 shrink-0" />
                          <span className="text-[12px] font-bold text-slate-800 truncate">
                            {t.transporteNombre || `Transportista #${t.transporteId}`}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0">
                          {t.resumen.operaciones} operación{t.resumen.operaciones === 1 ? "" : "es"}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 px-3 py-2">
                        <MiniMetrica etiqueta="Mínimo" valor={t.resumen.minimo} />
                        <MiniMetrica etiqueta="Promedio" valor={t.resumen.promedio} />
                        <MiniMetrica etiqueta="Máximo" valor={t.resumen.maximo} />
                      </div>
                      {t.resumen.ultimo != null && (
                        <p className="text-[10px] text-slate-400 px-3 pb-2">
                          Último flete: <span className="font-semibold text-slate-600">S/ {Number(t.resumen.ultimo).toFixed(2)}</span>
                          {t.resumen.ultimaFecha && (
                            <> · {new Date(t.resumen.ultimaFecha).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" })}</>
                          )}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function BotonTab({
  activo, onClick, icono, texto,
}: { activo: boolean; onClick: () => void; icono: React.ReactNode; texto: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-[12px] font-semibold border-b-2 transition-colors ${
        activo
          ? "border-sky-600 text-sky-700 bg-sky-50"
          : "border-transparent text-slate-400 hover:text-slate-600"
      }`}
    >
      {icono} {texto}
    </button>
  );
}

function MiniMetrica({ etiqueta, valor }: { etiqueta: string; valor: number | null }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="text-[8.5px] font-semibold uppercase tracking-wide text-slate-400">{etiqueta}</span>
      <span className="text-[11.5px] font-extrabold text-slate-800 mt-0.5">
        {valor != null ? `S/ ${Number(valor).toFixed(2)}` : "—"}
      </span>
    </div>
  );
}