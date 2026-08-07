"use client";

/**
 * AgruparOrdenModal.tsx
 * ----------------------
 * Todo lo relacionado a "Agrupar Orden de Compra" (tu captura #2) más el
 * panel lateral que se ve en la captura #1 ("Grupo: ESSALUD" / "OCs
 * Relacionadas" / "Total del Grupo"), porque ambos leen del mismo
 * endpoint (GET /agrupaciones-oc/by-orden-compra/:id) y por eso viven
 * juntos acá.
 *
 * Se usa así desde tu página/CrearOrdenModal:
 *
 *   <AgruparOrdenPanel ordenCompraId={venta.id} codigoVenta={venta.codigoVenta} />
 *
 * El panel se encarga solo de:
 *  1) pedir la agrupación existente de esa OC (si ya está agrupada)
 *  2) mostrar el botón "Agrupar OC {codigo}" (si NO está agrupada)
 *  3) abrir el modal "Agrupar Orden de Compra" y crearla
 */

import { useEffect, useState, useCallback } from "react";
import { Users2, Loader2, X, ExternalLink, Ban } from "lucide-react";
import {
  AgrupacionOC,
  agrupacionPorOrdenCompra,
  crearAgrupacion,
} from "./erp-shared";

// ============================================================
// Modal: "Agrupar Orden de Compra" (captura #2)
// ============================================================
type TipoAgrupacion = "nueva" | "existente";

interface AgruparOrdenModalProps {
  ordenCompraId: number;
  codigoVenta: string;
  onClose: () => void;
  onAgrupado: (agrupacion: AgrupacionOC) => void;
  /** Si ya tienes una lista de grupos existentes para el selector "Agrupación existente". */
  gruposExistentes?: Array<{ id: number; codigoGrupo: string }>;
}

export function AgruparOrdenModal({
  ordenCompraId,
  codigoVenta,
  onClose,
  onAgrupado,
  gruposExistentes = [],
}: AgruparOrdenModalProps) {
  const [tipo, setTipo] = useState<TipoAgrupacion>("nueva");
  const [codigoGrupo, setCodigoGrupo] = useState("");
  const [grupoExistenteId, setGrupoExistenteId] = useState<number | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const generarCodigo = () => {
    const sufijo = Math.random().toString(36).slice(2, 7).toUpperCase();
    setCodigoGrupo(`GRUPO-${sufijo}`);
  };

  const puedeGuardar =
    tipo === "nueva" ? codigoGrupo.trim().length > 0 : grupoExistenteId !== null;

  const guardar = async () => {
    setError("");
    if (!puedeGuardar) return;
    setGuardando(true);
    try {
      // NOTA: tu captura de Network solo muestra el flujo "crear nueva
      // agrupación" (POST /agrupaciones-oc con codigoGrupo nuevo). Si
      // "Agrupación existente" en tu backend es un endpoint distinto
      // (ej. PATCH /agrupaciones-oc/{id}/agregar-oc), cambia esta rama.
      const payload =
        tipo === "nueva"
          ? {
              codigoGrupo: codigoGrupo.trim(),
              descripcion: descripcion.trim() || null,
              fecha: new Date().toISOString(),
              ordenesCompraIds: [ordenCompraId],
            }
          : {
              codigoGrupo:
                gruposExistentes.find((g) => g.id === grupoExistenteId)?.codigoGrupo || "",
              fecha: new Date().toISOString(),
              ordenesCompraIds: [ordenCompraId],
            };

      const agrupacion = await crearAgrupacion(payload);
      onAgrupado(agrupacion);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo agrupar la orden");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-[1px]" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-start justify-between px-6 pt-6 pb-4">
          <div>
            <h3 style={{ fontFamily: "var(--font-display)" }} className="text-lg font-semibold text-slate-900">
              Agrupar Orden de Compra
            </h3>
            <p style={{ fontFamily: "var(--font-mono)" }} className="text-[11px] text-slate-400 mt-1">
              OC: {codigoVenta}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Tipo de agrupación
            </label>
            <select
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoAgrupacion)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30 focus:border-[#4F46E5]"
            >
              <option value="nueva">Crear nueva agrupación</option>
              <option value="existente" disabled={gruposExistentes.length === 0}>
                Agrupación existente {gruposExistentes.length === 0 ? "(sin grupos aún)" : ""}
              </option>
            </select>
          </div>

          {tipo === "nueva" ? (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  <span className="text-red-500">*</span> Código del grupo
                </label>
                <div className="flex gap-2">
                  <input
                    value={codigoGrupo}
                    onChange={(e) => setCodigoGrupo(e.target.value.toUpperCase())}
                    placeholder="Ej: GRUPO-001"
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30 focus:border-[#4F46E5]"
                  />
                  <button
                    onClick={generarCodigo}
                    className="text-sm font-medium text-[#4F46E5] hover:text-[#4338CA] px-2"
                  >
                    Generar
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Descripción (opcional)
                </label>
                <textarea
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                  placeholder="Descripción de la agrupación..."
                  rows={3}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30 focus:border-[#4F46E5]"
                />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                <span className="text-red-500">*</span> Selecciona el grupo
              </label>
              <select
                value={grupoExistenteId ?? ""}
                onChange={(e) => setGrupoExistenteId(Number(e.target.value) || null)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30 focus:border-[#4F46E5]"
              >
                <option value="">Selecciona...</option>
                {gruposExistentes.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.codigoGrupo}
                  </option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-2.5">
          <button
            onClick={onClose}
            disabled={guardando}
            className="px-4 py-2 rounded-full text-sm font-semibold text-slate-600 hover:bg-slate-200/70 transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={!puedeGuardar || guardando}
            className="px-5 py-2 rounded-full text-sm font-semibold text-white bg-[#3B5BFF] hover:bg-[#2f49d6] transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {guardando && <Loader2 size={14} className="animate-spin" />}
            Crear y Agrupar
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Panel lateral: "Grupo: X" + "OCs Relacionadas" + "Total del Grupo"
// (columna izquierda de la captura #1)
// ============================================================
interface AgruparOrdenPanelProps {
  ordenCompraId: number | null; // null mientras la OC todavía no se guardó (no tiene id)
  codigoVenta: string;
  className?: string;
}

const money = (n: number) => `S/ ${n.toFixed(2)}`;

export function AgruparOrdenPanel({ ordenCompraId, codigoVenta, className = "" }: AgruparOrdenPanelProps) {
  const [agrupacion, setAgrupacion] = useState<AgrupacionOC | null>(null);
  const [cargando, setCargando] = useState(false);
  const [modalAbierto, setModalAbierto] = useState(false);

  const recargar = useCallback(async () => {
    if (!ordenCompraId) return;
    setCargando(true);
    try {
      const data = await agrupacionPorOrdenCompra(ordenCompraId);
      setAgrupacion(data);
    } finally {
      setCargando(false);
    }
  }, [ordenCompraId]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  if (!ordenCompraId) {
    // La orden todavía no existe en el ERP (no se guardó) -> no se puede agrupar todavía.
    return (
      <div className={`text-[11px] text-slate-400 flex items-center gap-1.5 ${className}`}>
        <Ban size={12} />
        Guarda la orden para poder agruparla
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        onClick={() => setModalAbierto(true)}
        className="w-full flex items-center justify-center gap-2 bg-[#3B5BFF] text-white text-sm font-semibold rounded-full py-2.5 hover:bg-[#2f49d6] transition-colors"
      >
        <Users2 size={15} />
        Agrupar OC {codigoVenta}
      </button>

      {cargando && (
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-400">
          <Loader2 size={13} className="animate-spin" />
          Cargando agrupación...
        </div>
      )}

      {!cargando && agrupacion && (
        <div className="mt-4 bg-[#141B2E] rounded-xl p-4 text-white">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Users2 size={13} className="text-slate-400" />
            <span className="text-sm font-semibold">Grupo: {agrupacion.codigoGrupo}</span>
          </div>
          {agrupacion.descripcion && (
            <p style={{ fontFamily: "var(--font-mono)" }} className="text-[10px] uppercase tracking-wide text-slate-400 mb-3">
              {agrupacion.descripcion}
            </p>
          )}

          <p className="text-[11px] text-slate-400 mb-2">
            OCs Relacionadas ({agrupacion.ordenesCompra.length})
          </p>
          <div className="space-y-2 mb-3">
            {agrupacion.ordenesCompra.map((rel) => {
              const oc = rel.ordenCompra;
              const esActual = oc.id === ordenCompraId;
              return (
                <div
                  key={rel.id}
                  className={`rounded-lg px-3 py-2 border ${
                    esActual ? "border-slate-500/60 bg-white/5" : "border-transparent bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium flex items-center gap-1">
                      {oc.codigoVenta} {esActual && <span className="text-slate-400">(Actual)</span>}
                      {!esActual && <ExternalLink size={11} className="text-slate-400" />}
                    </span>
                    <span className="text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 rounded-full px-2 py-0.5">
                      {money(oc.montoVenta)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5">Cliente: {oc.cliente?.razonSocial || "—"}</p>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-white/10">
            <span className="text-xs text-slate-300">Total del Grupo:</span>
            <span className="text-sm font-bold">
              {money(agrupacion.ordenesCompra.reduce((acc, r) => acc + r.ordenCompra.montoVenta, 0))}
            </span>
          </div>
        </div>
      )}

      {modalAbierto && (
        <AgruparOrdenModal
          ordenCompraId={ordenCompraId}
          codigoVenta={codigoVenta}
          onClose={() => setModalAbierto(false)}
          onAgrupado={(a) => setAgrupacion(a)}
        />
      )}
    </div>
  );
}