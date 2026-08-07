"use client";

/**
 * PanelConsultaMef.tsx
 * ---------------------
 * Consulta mef_scraper.py (POST /mef/consultar) usando Unidad Ejecutora
 * + Expediente SIAF, y pinta el resultado con la MISMA tabla/estilo que
 * ya tenías en PanelMef (TabVentasErp). Pensado para vivir DENTRO de
 * CrearOrdenModal.tsx, justo debajo del recuadro indigo que muestra
 * "Unidad Ejecutora" / "Expediente SIAF".
 *
 * Se auto-consulta cada vez que cambian `unidadEjecutora` o `expediente`
 * (props) — así que si abres OTRA publicada y el OCR llena esos dos
 * campos con otros valores, este panel se vuelve a disparar solo, sin
 * que tengas que tocar nada.
 *
 * ============================================================
 * SUPUESTOS QUE DEBES VERIFICAR (igual que en tus otros archivos):
 * ============================================================
 * 1) Doy por hecho que el router de mef_scraper.py (prefix="/mef") está
 *    montado en el MISMO backend que ya usas como API_BASE en
 *    helbot-shared.ts (o sea, la llamada final es
 *    `${API_BASE}/mef/consultar`). Si el scraper corre en otro puerto/
 *    servicio, cambia esa URL abajo en `consultar()`.
 * 2) MAPA_FASE_A_ETAPA_SIAF es el mismo mapa que ya usabas en PanelMef,
 *    pero como no vino en el snippet que compartiste, lo repuse con
 *    valores típicos (Compromiso/Devengado/Girado/Pagado). Ajusta los
 *    códigos si en tu ERP son distintos.
 */

import { useState, useEffect, useCallback } from "react";
import { FileText, Loader2, AlertTriangle, CheckCircle2, Wand2, ChevronUp, ChevronDown } from "lucide-react";
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

// Fase (texto que muestra el MEF) -> código de etapa SIAF de tu ERP.
// AJUSTA esto si tus códigos reales son otros.
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
// Componente principal
// ============================================================
interface PanelConsultaMefProps {
  /** Código de Unidad Ejecutora — es el `sec_ejec` que espera mef_scraper.py. Ej: "300708" */
  unidadEjecutora: string;
  /** Número de expediente SIAF — es el `expediente` que espera mef_scraper.py. Ej: "2482" */
  expediente: string;
  /**
   * ...
   */
onAplicarDatos?: (datos: DatosDerivadosMef) => void;
  /** Solo seguimiento puede aplicar los datos del MEF al formulario. */
  esSeguimiento?: boolean;
}

export default function PanelConsultaMef({ unidadEjecutora, expediente, onAplicarDatos, esSeguimiento }: PanelConsultaMefProps) {
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

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <FileText size={13} /> Consulta MEF — U.E. {unidadEjecutora} / Expediente {expediente}
        </p>
        {cargando ? (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Loader2 size={12} className="animate-spin" /> Consultando MEF...
          </span>
        ) : (
          <button type="button" onClick={consultar} className="text-[11px] text-[#4F46E5] font-medium hover:underline">
            Volver a consultar
          </button>
        )}
      </div>

      {!cargando && error && (
        <p className="text-[11px] text-red-600 flex items-center gap-1">
          <AlertTriangle size={11} /> {error}
        </p>
      )}

      {!cargando && !error && registros.length === 0 && (
        <p className="text-[11px] text-slate-400">Sin resultados en el MEF para este expediente.</p>
      )}

      {!cargando && registros.length > 0 && (
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

      {!cargando && mostrarResultados && registros.length > 0 && (
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