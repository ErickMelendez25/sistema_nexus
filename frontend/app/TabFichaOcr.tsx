"use client";

import { useState } from "react";
import {
  Upload,
  FileScan,
  Loader2,
  AlertTriangle,
  Search,
  ChevronRight,
  CheckCircle2,
} from "lucide-react";
import { API_BASE, Publicada } from "./helbot-shared";
import PanelConsultaMef from "./PanelConsultaMef";

// ============================================================
// Tipos
// ============================================================
interface DatosFicha {
  unidad_ejecutora?: string | null;
  expediente?: string | null;
  entidad?: string | null;
  producto?: string | null;
  cantidad?: string | null;
  monto?: string | null;
  fecha?: string | null;
  otros?: Record<string, unknown> | null;
}

type MefForm = { sec_ejec: string; expediente: string };

// ============================================================
// Empty state local — mismo estilo que el resto del sistema
// ============================================================
function EstadoVacio({
  titulo,
  detalle,
}: {
  titulo: string;
  detalle: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-200 rounded-xl bg-white/50 py-14">
      <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mb-3">
        <FileScan size={22} className="text-[#4F46E5]" />
      </div>
      <p className="text-sm font-semibold text-slate-700">{titulo}</p>
      <p className="text-xs text-slate-500 mt-1 max-w-sm">{detalle}</p>
    </div>
  );
}

// ============================================================
// Módulo principal — Ficha OCR + consulta MEF
// ============================================================
export default function TabFichaOcr({ publicadas }: { publicadas: Publicada[] }) {
  const [publicadaId, setPublicadaId] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [cargandoOcr, setCargandoOcr] = useState(false);
  const [datos, setDatos] = useState<DatosFicha | null>(null);
  const [errorOcr, setErrorOcr] = useState("");

  const [mef, setMef] = useState<MefForm>({ sec_ejec: "", expediente: "" });
  const [mefConsultado, setMefConsultado] = useState<MefForm>({ sec_ejec: "", expediente: "" });

  const [completando, setCompletando] = useState(false);
  const [erpOk, setErpOk] = useState(false);

  const subirFicha = async () => {
    if (!archivo) return;
    setCargandoOcr(true);
    setErrorOcr("");
    try {
      const fd = new FormData();
      fd.append("archivo", archivo);
      if (publicadaId) fd.append("publicada_id", publicadaId);
      const r = await fetch(`${API_BASE}/ficha/ocr`, { method: "POST", body: fd });
      if (!r.ok) throw new Error((await r.json()).detail || "Error OCR");
      const d = await r.json();
      setDatos(d.datos as DatosFicha);
    } catch (e) {
      setErrorOcr(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCargandoOcr(false);
    }
  };

  const consultarMef = () => {
    setMefConsultado({ sec_ejec: mef.sec_ejec, expediente: mef.expediente });
  };

  const completarErp = async () => {
    if (!publicadaId || !datos) return;
    setCompletando(true);
    try {
      const r = await fetch(`${API_BASE}/erp/completar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicada_id: publicadaId, origen: "ocr", datos }),
      });
      setErpOk(r.ok);
    } finally {
      setCompletando(false);
    }
  };

  const hayResultados = !!datos || (mefConsultado.sec_ejec && mefConsultado.expediente);

  return (
    <div className="space-y-6">
      {/* ================= ENCABEZADO ================= */}
      <div>
        <h2
          style={{ fontFamily: "var(--font-display)" }}
          className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight"
        >
          Ficha OCR + MEF
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Extrae los datos de la orden por OCR, o consulta el MEF directamente con los códigos del expediente.
        </p>
      </div>

      {/* ================= ENTRADAS — dos tarjetas lado a lado ================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* -------- Subir ficha -------- */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3
            style={{ fontFamily: "var(--font-display)" }}
            className="font-semibold text-slate-900 mb-1 tracking-tight text-sm"
          >
            Subir ficha
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Opcional — aplica OCR para prellenar el ERP. También puedes registrar todo directo en la plataforma ERP.
          </p>

          <select
            value={publicadaId}
            onChange={(e) => setPublicadaId(e.target.value)}
            style={{ fontFamily: "var(--font-mono)" }}
            className="w-full mb-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="">Vincular a publicada (opcional)</option>
            {publicadas.map((p) => (
              <option key={p.N_OrdenCompra} value={p.C_OrdenCompra}>
                {p.C_OrdenCompra} — {p.C_Entidad}
              </option>
            ))}
          </select>

          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-300 rounded-lg py-7 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
            <Upload size={19} className="text-slate-400" />
            <span className="text-xs text-slate-500 text-center px-4">
              {archivo ? archivo.name : "Click para subir ficha (imagen o PDF)"}
            </span>
            <input
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            />
          </label>

          <button
            onClick={subirFicha}
            disabled={!archivo || cargandoOcr}
            className="mt-3 w-full flex items-center justify-center gap-2 bg-[#10172A] text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-40 hover:bg-[#1B2438] transition-colors"
          >
            {cargandoOcr ? <Loader2 size={15} className="animate-spin" /> : <FileScan size={15} />}
            Aplicar OCR
          </button>
          {errorOcr && (
            <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
              <AlertTriangle size={12} />
              {errorOcr}
            </p>
          )}
        </div>

        {/* -------- Consulta MEF -------- */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3
            style={{ fontFamily: "var(--font-display)" }}
            className="font-semibold text-slate-900 mb-1 tracking-tight text-sm"
          >
            Consulta MEF (código 1 / código 2)
          </h3>
          <p className="text-xs text-slate-500 mb-4">
            Si no usaste OCR, completa manualmente estos 2 códigos. Helbot resuelve el captcha automáticamente.
          </p>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="nx-label text-[10px] text-slate-500 uppercase tracking-wide font-medium mb-1 block">
                Código 1 · Unidad Ejecutora
              </label>
              <input
                placeholder="Ej. 300708"
                maxLength={6}
                value={mef.sec_ejec}
                onChange={(e) => setMef({ ...mef, sec_ejec: e.target.value.replace(/\D/g, "") })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && mef.sec_ejec && mef.expediente) consultarMef();
                }}
                style={{ fontFamily: "var(--font-mono)" }}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wide font-medium mb-1 block">
                Código 2 · Expediente
              </label>
              <input
                placeholder="Ej. 2482"
                maxLength={10}
                value={mef.expediente}
                onChange={(e) => setMef({ ...mef, expediente: e.target.value.replace(/\D/g, "") })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && mef.sec_ejec && mef.expediente) consultarMef();
                }}
                style={{ fontFamily: "var(--font-mono)" }}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>

          <button
            onClick={consultarMef}
            disabled={!mef.sec_ejec || !mef.expediente}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-40 hover:bg-emerald-700 transition-colors"
          >
            <Search size={15} />
            Consultar (resuelve captcha automáticamente)
          </button>

          {mefConsultado.sec_ejec && mefConsultado.expediente && (
            <p className="text-[11px] text-slate-400 mt-2.5 text-center">
              Resultados abajo — U.E. {mefConsultado.sec_ejec} / Expediente {mefConsultado.expediente}
            </p>
          )}
        </div>
      </div>

      {!hayResultados && (
        <EstadoVacio
          titulo="Aún no hay datos"
          detalle="Sube una ficha o consulta el MEF con los códigos para ver los resultados aquí abajo, a ancho completo."
        />
      )}

      {/* ================= DATOS EXTRAÍDOS POR OCR — ancho completo ================= */}
      {datos && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
            <div>
              <h3
                style={{ fontFamily: "var(--font-display)" }}
                className="font-semibold text-slate-900 tracking-tight text-sm"
              >
                Datos extraídos por OCR
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Editables antes de enviar al ERP.</p>
            </div>
            <button
              onClick={completarErp}
              disabled={!publicadaId || completando}
              className="flex items-center justify-center gap-2 bg-emerald-600 text-white font-medium rounded-lg px-4 py-2 text-xs disabled:opacity-40 hover:bg-emerald-700 transition-colors shrink-0"
            >
              {completando ? <Loader2 size={13} className="animate-spin" /> : <ChevronRight size={13} />}
              Completar ERP
            </button>
          </div>

          {!publicadaId && (
            <p className="text-[11px] text-amber-600 mb-3 flex items-center gap-1">
              <AlertTriangle size={11} />
              Selecciona una publicada arriba para poder completar el ERP.
            </p>
          )}
          {erpOk && (
            <p className="text-xs text-emerald-700 mb-3 flex items-center gap-1">
              <CheckCircle2 size={12} /> ERP actualizado
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(datos)
              .filter(([k]) => k !== "otros")
              .map(([campo, valor]) => (
                <div key={campo}>
                  <label
                    style={{ fontFamily: "var(--font-mono)" }}
                    className="text-[10px] text-slate-500 uppercase tracking-wide font-medium"
                  >
                    {campo.replace(/_/g, " ")}
                  </label>
                  <input
                    value={(valor as string) || ""}
                    onChange={(e) => setDatos({ ...datos, [campo]: e.target.value })}
                    className="w-full mt-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
                  />
                </div>
              ))}
          </div>
        </div>
      )}

      {/* ================= RESULTADOS MEF — ancho completo, tabla sin recortes ================= */}
      {mefConsultado.sec_ejec && mefConsultado.expediente && (
        <PanelConsultaMef
          unidadEjecutora={mefConsultado.sec_ejec}
          expediente={mefConsultado.expediente}
          expandirResultados
          loaderElegante
        />
      )}
    </div>
  );
}