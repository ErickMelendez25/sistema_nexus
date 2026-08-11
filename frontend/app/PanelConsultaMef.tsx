"use client";

/**
 * PanelConsultaMef.tsx
 * ---------------------
 * Consulta mef_scraper.py (POST /mef/consultar) usando Unidad Ejecutora
 * + Expediente SIAF, y pinta el resultado con la MISMA tabla/estilo que
 * ya tenías en PanelMef (TabVentasErp). Pensado para vivir DENTRO de
 * CrearOrdenModal.tsx, justo debajo del recuadro indigo que muestra
 * "Unidad Ejecutora" / "Expediente SIAF" — y también, en su modo
 * "expandido", dentro de TabFichaOcr.tsx.
 *
 * Se auto-consulta cada vez que cambian `unidadEjecutora` o `expediente`
 * (props) — así que si abres OTRA publicada y el OCR llena esos dos
 * campos con otros valores, este panel se vuelve a disparar solo, sin
 * que tengas que tocar nada.
 *
 * NUEVO — props opcionales, retrocompatibles (default = comportamiento
 * original intacto para CrearOrdenModal):
 *  - expandirResultados: si true, la tabla se muestra directo, sin el
 *    botón colapsable "Ver resultados de la consulta".
 *  - loaderElegante: si true, mientras `cargando` se muestra un loader
 *    grande con temática de "magia resolviendo el captcha" en vez del
 *    spinner de texto pequeño de la cabecera.
 */

import { useState, useEffect, useCallback } from "react";
import {
  FileText,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Wand2,
  Sparkles,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import { API_BASE, fetchConToken } from "./helbot-shared";

// ============================================================
// Tipos — calzan con lo que devuelve parse_result() en mef_scraper.py
// ============================================================
interface RegistroMef {
  Ciclo?: string;
  Fase?: string;
  Sec?: string;
  Corr?: string;
  Doc?: string;
  Numero?: string;
  Fecha?: string;
  FF?: string;
  Moneda?: string;
  Monto?: string;
  "Est."?: string;
  "Fecha Proceso"?: string;
  "Id Trx"?: string;
  [key: string]: unknown;
}

interface DataMef {
  anio?: string;
  entidad?: string;
  nombreEntidad?: string;
  expediente?: string;
  tipoOperacion?: string;
  descripcionOperacion?: string;
  modalidadCompra?: string;
  descripcionModalidad?: string;
  tipoProceso?: string;
  descripcionProceso?: string;
  registros: RegistroMef[];
}

interface RespuestaMef {
  ok: boolean;
  intentos?: string;
  sec_ejec?: string;
  expediente?: string;
  data?: DataMef;
  error?: string;
}

export interface DatosDerivadosMef {
  etapaSiaf: string;
  fechaSiaf: string;
  fuentesFinanciamiento: string;
  multipleFuentesFinanciamiento: boolean;
  montoVenta: number;
}

// Fase (columna "Fase" de la tabla del MEF, viene como letra única, ej.
// "C") -> código de Etapa SIAF real del ERP (select con COM/DEV/PAG/
// SSIAF/RES/GIR/GIR-F). Solo tengo confirmado "C" -> COM por tu
// ejemplo; el resto son mi mejor supuesto por significado (D=Devengado,
// P=Pagado, G=Girado, R=Rendido, S=SSIAF, F=Girado-Financiero).
// VERIFICA cada uno la próxima vez que te salga esa fase en la tabla,
// y ajusta aquí si no calza.
const MAPA_FASE_A_ETAPA_SIAF: Record<string, string> = {
  C: "COM",
  D: "DEV",
  P: "PAG",
  G: "GIR",
  R: "RES",
  S: "SSIAF",
  F: "GIR-F",
};
function parsearMonto(raw: unknown): number {
  if (raw === null || raw === undefined) return 0;
  const limpio = String(raw).replace(/,/g, "").trim();
  const n = Number(limpio);
  return Number.isFinite(n) ? n : 0;
}

// El MEF entrega la fecha como dd/mm/yyyy (a veces con hora pegada,
// ej. "20/07/2026 14:32"). Nos quedamos solo con la fecha y la
// convertimos a yyyy-mm-dd para el <input type="date"> del formulario.
function formatearFechaParaErp(raw: unknown): string {
  const soloFecha = String(raw || "").trim().split(" ")[0];
  const m = soloFecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return "";
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function CampoFicha({ label, codigo, descripcion }: { label: string; codigo?: string; descripcion?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-400 font-medium">{label}</p>
      <p className="text-xs text-slate-700">
        <span className="font-semibold text-slate-800">{codigo || "—"}</span>
        {descripcion ? <span className="text-slate-500"> — {descripcion}</span> : null}
      </p>
    </div>
  );
}

// ============================================================
// Loader "mágico" — resolviendo captcha. Solo se usa cuando la prop
// loaderElegante=true (TabFichaOcr). El resto de usos no lo ve nunca.
// ============================================================
function LoaderMagico() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-4">
      <style jsx>{`
        @keyframes nx-wand-glow {
          0%, 100% { transform: rotate(-8deg) scale(1); filter: drop-shadow(0 0 0px rgba(79,70,229,0.5)); }
          50% { transform: rotate(8deg) scale(1.08); filter: drop-shadow(0 0 6px rgba(79,70,229,0.55)); }
        }
        @keyframes nx-sparkle {
          0%, 100% { opacity: 0.2; transform: scale(0.7) rotate(0deg); }
          50% { opacity: 1; transform: scale(1.15) rotate(25deg); }
        }
        @keyframes nx-ring {
          0% { transform: scale(0.85); opacity: 0.5; }
          100% { transform: scale(1.6); opacity: 0; }
        }
        @keyframes nx-dot-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
        .nx-wand { animation: nx-wand-glow 1.8s ease-in-out infinite; transform-origin: 70% 70%; }
        .nx-sparkle-a { animation: nx-sparkle 1.6s ease-in-out infinite; }
        .nx-sparkle-b { animation: nx-sparkle 1.6s ease-in-out 0.5s infinite; }
        .nx-ring { animation: nx-ring 1.8s ease-out infinite; }
        .nx-dot { animation: nx-dot-bounce 1.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .nx-wand, .nx-sparkle-a, .nx-sparkle-b, .nx-ring, .nx-dot { animation: none !important; }
        }
      `}</style>

      <div className="relative w-16 h-16 flex items-center justify-center">
        <span className="nx-ring absolute inset-0 rounded-full border-2 border-indigo-300" />
        <span className="absolute inset-0 rounded-full bg-indigo-50" />
        <Wand2 size={24} className="nx-wand relative z-10 text-[#4F46E5]" strokeWidth={2.25} />
        <Sparkles size={13} className="nx-sparkle-a absolute -top-1 -right-1 text-amber-400" />
        <Sparkles size={10} className="nx-sparkle-b absolute -bottom-0.5 -left-1.5 text-indigo-400" />
      </div>

      <div className="text-center">
        <p className="text-sm font-semibold text-slate-700">Resolviendo captcha automáticamente…</p>
        <p className="text-[11px] text-slate-400 mt-1">Consultando el MEF — esto toma unos segundos</p>
      </div>

      <div className="flex gap-1.5">
        <span className="nx-dot w-1.5 h-1.5 rounded-full bg-indigo-400" style={{ animationDelay: "0ms" }} />
        <span className="nx-dot w-1.5 h-1.5 rounded-full bg-indigo-400" style={{ animationDelay: "150ms" }} />
        <span className="nx-dot w-1.5 h-1.5 rounded-full bg-indigo-400" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}

// ============================================================
// Componente principal
// ============================================================
interface PanelConsultaMefProps {
  /** Código de Unidad Ejecutora — es el `sec_ejec` que espera mef_scraper.py. Ej: "300708" */
  unidadEjecutora: string;
  /** Número de expediente SIAF — es el `expediente` que espera mef_scraper.py. Ej: "2482" */
  expediente: string;
  onAplicarDatos?: (datos: DatosDerivadosMef) => void;
  /** Solo seguimiento puede aplicar los datos del MEF al formulario. */
  esSeguimiento?: boolean;
  /** Si true, la tabla se muestra directo sin el botón colapsable "Ver resultados". Default: false (comportamiento original). */
  expandirResultados?: boolean;
  /** Si true, usa el loader grande con temática de magia mientras consulta. Default: false (comportamiento original). */
  loaderElegante?: boolean;
}

export default function PanelConsultaMef({
  unidadEjecutora,
  expediente,
  onAplicarDatos,
  esSeguimiento,
  expandirResultados = false,
  loaderElegante = false,
}: PanelConsultaMefProps) {
  const puedeAplicarDatos = !!esSeguimiento;
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<DataMef | null>(null);
  const [aplicado, setAplicado] = useState(false);
  const [mostrarResultados, setMostrarResultados] = useState(false);

  const consultar = useCallback(async () => {
    if (!unidadEjecutora || !expediente) return;
    setCargando(true);
    setError("");
    setAplicado(false);
    try {
      // Punto de ajuste #1 si el scraper vive en otro backend/puerto.
      const r = await fetchConToken(`${API_BASE}/mef/consultar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sec_ejec: unidadEjecutora, expediente }),
      });

      // mef_scraper.py responde 422 + { detail: { ok:false, error } }
      // cuando no logra resolver el captcha/expediente — leemos el body
      // igual aunque !r.ok para sacar el mensaje real.
      const body = await r.json().catch(() => ({}));

      if (!r.ok) {
        const detalle = (body?.detail ?? body) as RespuestaMef;
        throw new Error(detalle?.error || `Error HTTP ${r.status} consultando el MEF`);
      }

      const respuesta = body as RespuestaMef;
      if (!respuesta.ok || !respuesta.data) {
        throw new Error(respuesta.error || "El MEF no devolvió datos");
      }

      setData(respuesta.data);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "No se pudo consultar el MEF");
    } finally {
      setCargando(false);
    }
  }, [unidadEjecutora, expediente]);

  // Se dispara solo cada vez que cambian Unidad Ejecutora / Expediente,
  // o sea, cada vez que entras a OTRA publicada y el OCR llena esos dos
  // campos con valores distintos.
  useEffect(() => {
    consultar();
  }, [consultar]);

  const registros = data?.registros || [];
  const tablaVisible = expandirResultados ? registros.length > 0 : mostrarResultados;

  const derivado: DatosDerivadosMef | null = (() => {
    if (registros.length === 0) return null;
    const primera = registros[0];
    const etapaSiaf = MAPA_FASE_A_ETAPA_SIAF[primera["Fase"] || ""] || primera["Fase"] || "";
    const fechaSiaf = formatearFechaParaErp(primera["Fecha"]);

    let fuentesFinanciamiento: string;
    let multipleFuentesFinanciamiento: boolean;
    let montoVenta: number;

    if (registros.length === 1) {
      fuentesFinanciamiento = String(primera["FF"] ?? "");
      multipleFuentesFinanciamiento = false;
      montoVenta = parsearMonto(primera["Monto"]);
    } else {
      const ffUnicos = Array.from(new Set(registros.map((r) => String(r["FF"] ?? "")).filter(Boolean)));
      fuentesFinanciamiento = ffUnicos.join(",");
      multipleFuentesFinanciamiento = true;
      montoVenta = registros.reduce((acc, r) => acc + parsearMonto(r["Monto"]), 0);
    }

    return { etapaSiaf, fechaSiaf, fuentesFinanciamiento, multipleFuentesFinanciamiento, montoVenta };
  })();

  if (!unidadEjecutora || !expediente) return null;

  const mostrarLoaderElegante = cargando && loaderElegante;

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <FileText size={13} /> Consulta MEF — U.E. {unidadEjecutora} / Expediente {expediente}
        </p>
        {!mostrarLoaderElegante &&
          (cargando ? (
            <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
              <Loader2 size={12} className="animate-spin" /> Consultando MEF...
            </span>
          ) : (
            <button type="button" onClick={consultar} className="text-[11px] text-[#4F46E5] font-medium hover:underline">
              Volver a consultar
            </button>
          ))}
      </div>

      {mostrarLoaderElegante && <LoaderMagico />}

      {!cargando && error && (
        <p className="text-[11px] text-red-600 flex items-center gap-1">
          <AlertTriangle size={11} /> {error}
        </p>
      )}

      {!cargando && !error && registros.length === 0 && (
        <p className="text-[11px] text-slate-400">Sin resultados en el MEF para este expediente.</p>
      )}

      {!cargando && !expandirResultados && registros.length > 0 && (
        <button
          type="button"
          onClick={() => setMostrarResultados((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-lg bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors text-left"
        >
          <span className="text-xs font-medium text-slate-700 flex items-center gap-1.5">
            <FileText size={12} className="text-[#4F46E5]" />
            {mostrarResultados ? "Ocultar" : "Ver"} resultados de la consulta ({registros.length} registro{registros.length !== 1 ? "s" : ""})
          </span>
          {mostrarResultados ? (
            <ChevronUp size={14} className="text-slate-400 shrink-0" />
          ) : (
            <ChevronDown size={14} className="text-slate-400 shrink-0" />
          )}
        </button>
      )}

      {!cargando && tablaVisible && registros.length > 0 && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">Datos del Expediente Administrativo</h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <CampoFicha label="Año" codigo={data?.anio} />
              <CampoFicha label="Expediente" codigo={data?.expediente} />
              <CampoFicha label="Entidad" codigo={data?.entidad} descripcion={data?.nombreEntidad} />
              <CampoFicha label="Tipo Operación" codigo={data?.tipoOperacion} descripcion={data?.descripcionOperacion} />
              <CampoFicha label="Modalidad Compra" codigo={data?.modalidadCompra} descripcion={data?.descripcionModalidad} />
              <CampoFicha label="Tipo Proceso" codigo={data?.tipoProceso} descripcion={data?.descripcionProceso} />
            </div>
          </div>

        <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[920px] text-[11px] border-collapse">
              <thead style={{ backgroundColor: "#8DC63F" }} className="text-white">
                <tr className="divide-x divide-white/25">
                  <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-[10px]">Ciclo</th>
                  <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-[10px]">Fase</th>
                  <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wide text-[10px]">Sec</th>
                  <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wide text-[10px]">Corr</th>
                  <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wide text-[10px]">Doc</th>
                  <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-[10px]">Numero</th>
                  <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-[10px]">Fecha</th>
                  <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wide text-[10px]">FF</th>
                  <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-[10px]">Moneda</th>
                  <th className="px-3 py-2.5 text-right font-semibold uppercase tracking-wide text-[10px]">Monto</th>
                  <th className="px-3 py-2.5 text-center font-semibold uppercase tracking-wide text-[10px]">Est.</th>
                  <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-[10px]">Fecha Proceso</th>
                  <th className="px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-[10px]">Id Trx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {registros.map((reg, i) => (
                  <tr
                    key={i}
                    className={`divide-x divide-slate-200 hover:bg-indigo-50/40 transition-colors ${
                      i % 2 === 1 ? "bg-violet-50/30" : "bg-white"
                    }`}
                  >
                    <td className="px-2.5 py-2.5 text-slate-700 font-medium">{reg["Ciclo"]}</td>
                    <td className="px-2.5 py-2.5 text-slate-700 font-medium">{reg["Fase"]}</td>
                    <td className="px-2.5 py-2.5 text-center text-slate-600">{reg["Sec"]}</td>
                    <td className="px-2.5 py-2.5 text-center text-slate-600">{reg["Corr"]}</td>
                    <td className="px-2.5 py-2.5 text-center text-slate-600">{reg["Doc"]}</td>
                    <td style={{ fontFamily: "var(--font-mono)" }} className="px-2.5 py-2.5 text-slate-800 break-words">
                      {reg["Numero"]}
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)" }} className="px-2.5 py-2.5 text-slate-600">
                      {reg["Fecha"]}
                    </td>
                    <td className="px-2.5 py-2.5 text-center text-slate-600">{reg["FF"]}</td>
                    <td className="px-2.5 py-2.5 text-slate-500">{reg["Moneda"]}</td>
                    <td style={{ fontFamily: "var(--font-mono)" }} className="px-2.5 py-2.5 text-right font-semibold text-slate-800">
                      {parsearMonto(reg["Monto"]).toLocaleString("es-PE", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-2.5 py-2.5 text-center">
                      <span className="inline-flex px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">
                        {reg["Est."]}
                      </span>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)" }} className="px-2.5 py-2.5 text-slate-600">
                      <div className="leading-tight">
                        <p>{String(reg["Fecha Proceso"] || "").split(" ")[0]}</p>
                        <p className="text-slate-400">{String(reg["Fecha Proceso"] || "").split(" ")[1]}</p>
                      </div>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)" }} className="px-2.5 py-2.5 font-bold text-slate-800">
                      {reg["Id Trx"]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {onAplicarDatos && derivado && (
            <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[11px] text-slate-500 max-w-md">
                {registros.length === 1
                  ? `Se llenará el formulario con: etapa ${derivado.etapaSiaf}, fuente ${derivado.fuentesFinanciamiento}, monto S/ ${derivado.montoVenta.toLocaleString(
                      "es-PE",
                      { minimumFractionDigits: 2 }
                    )}.`
                  : `Se combinarán ${registros.length} registros: fuentes múltiples y suma de montos (S/ ${derivado.montoVenta.toLocaleString(
                      "es-PE",
                      { minimumFractionDigits: 2 }
                    )}).`}
              </p>
                <button
                type="button"
                onClick={() => {
                  onAplicarDatos(derivado);
                  setAplicado(true);
                }}
                disabled={!puedeAplicarDatos}
                title={puedeAplicarDatos ? undefined : "Solo el rol de seguimiento puede aplicar estos datos"}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg px-4 py-2 text-xs transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Wand2 size={13} />
                Usar estos datos en el formulario
              </button>
            </div>
          )}
          {aplicado && (
            <p className="px-5 pb-3 pt-1 text-[11px] text-emerald-700 flex items-center gap-1">
              <CheckCircle2 size={11} /> Datos aplicados al formulario — revisa "Datos generales" antes de guardar.
            </p>
          )}
        </div>
      )}
    </div>
  );
}