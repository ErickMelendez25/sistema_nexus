"use client";

import { useState, useRef } from "react";
import {
  FileText, Building2, CalendarDays, Hash, MapPin, Landmark,
  Receipt, Truck, ClipboardList, FileStack, Upload, X, ArrowUp,
  ArrowDown, Loader2, CheckCircle2, AlertCircle, Download,
} from "lucide-react";

interface DocParaPagoProps {
  apiBase: string; // ej. process.env.NEXT_PUBLIC_API_BASE
}

type Plantilla = "eco" | "multi";

interface FormState {
  plantilla: Plantilla;
  fecha: string;
  num: string;
  area: string;
  entidad: string;
  ciudad: string;
  factura: string;
  guiaremi: string;
  guiaremiSellado: boolean;
  oc: string;
  ocam: string;
  archivo: string;
}

const INICIAL: FormState = {
  plantilla: "eco",
  fecha: "",
  num: "",
  area: "",
  entidad: "",
  ciudad: "",
  factura: "",
  guiaremi: "",
  guiaremiSellado: true,
  oc: "",
  ocam: "",
  archivo: "",
};

export default function DocParaPago({ apiBase }: DocParaPagoProps) {
  const [form, setForm] = useState<FormState>(INICIAL);
  const [pdfsExtra, setPdfsExtra] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ archivo: string; url: string } | null>(null);
  const inputArchivosRef = useRef<HTMLInputElement>(null);

  const actualizar = <K extends keyof FormState>(campo: K, valor: FormState[K]) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  const agregarPdfs = (files: FileList | null) => {
    if (!files) return;
    const nuevos = Array.from(files).filter((f) => f.type === "application/pdf");
    setPdfsExtra((prev) => [...prev, ...nuevos]);
    if (inputArchivosRef.current) inputArchivosRef.current.value = "";
  };

  const quitarPdf = (idx: number) =>
    setPdfsExtra((prev) => prev.filter((_, i) => i !== idx));

  const moverPdf = (idx: number, dir: -1 | 1) => {
    setPdfsExtra((prev) => {
      const copia = [...prev];
      const destino = idx + dir;
      if (destino < 0 || destino >= copia.length) return copia;
      [copia[idx], copia[destino]] = [copia[destino], copia[idx]];
      return copia;
    });
  };

const validar = (): string | null => {
    // Se restringe explícitamente a las keys de FormState que son string
    // (Exclude<..., "guiaremiSellado" | "plantilla">) — así TypeScript
    // ya no permite que "campo" apunte a un booleano y .trim() vuelve a
    // ser válido sin necesidad de castear nada dentro del for.
    const obligatorios: [Exclude<keyof FormState, "guiaremiSellado" | "plantilla">, string][] = [
      ["fecha", "Fecha"],
      ["num", "N.º de carta"],
      ["area", "Área"],
      ["entidad", "Entidad"],
      ["ciudad", "Ciudad"],
      ["factura", "Factura"],
      ["guiaremi", "Guía de remisión"],
      ["oc", "Orden de compra"],
      ["archivo", "Nombre de archivo"],
    ];
    for (const [campo, etiqueta] of obligatorios) {
      if (!form[campo].trim()) return `Falta completar: ${etiqueta}.`;
    }
    if (!/^\d+$/.test(form.num)) return "El N.º de carta debe ser numérico.";
    return null;
  };

  const generar = async () => {
    const errorValidacion = validar();
    if (errorValidacion) {
      setError(errorValidacion);
      return;
    }
    setError(null);
    setResultado(null);
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append("plantilla", form.plantilla);
      fd.append("fecha", form.fecha);
      fd.append("num", form.num);
      fd.append("area", form.area);
      fd.append("entidad", form.entidad);
      fd.append("ciudad", form.ciudad);
      fd.append("factura", form.factura);
      fd.append("guiaremi", form.guiaremi);
      fd.append("guiaremi_sellado", String(form.guiaremiSellado));
      fd.append("oc", form.oc);
      fd.append("ocam", form.ocam);
      fd.append("archivo", form.archivo);
      pdfsExtra.forEach((f) => fd.append("pdfs_extra", f));

      const res = await fetch(`${apiBase}/cobranzas/doc-pago/generar`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "No se pudo generar el documento.");
      setResultado({ archivo: data.archivo, url: `${apiBase}${data.url_descarga}` });
    } catch (e: any) {
      setError(e?.message || "Error inesperado al generar el documento.");
    } finally {
      setEnviando(false);
    }
  };

  const limpiar = () => {
    setForm(INICIAL);
    setPdfsExtra([]);
    setResultado(null);
    setError(null);
  };

  return (
    <div className="max-w-3xl mx-auto">
      {/* Encabezado */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-[#4F46E5] flex items-center justify-center shrink-0">
          <FileText size={19} className="text-white" strokeWidth={2} />
        </div>
        <div>
          <h1 style={{ fontFamily: "var(--font-display)" }} className="text-lg font-semibold text-slate-900">
            Doc para pago
          </h1>
          <p className="text-[12px] text-slate-500">Cobranzas · genera la carta y consolida los PDF adjuntos</p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        {/* Selector de plantilla */}
        <div className="px-6 pt-6">
          <p style={{ fontFamily: "var(--font-mono)" }} className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
            Plantilla
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                { id: "eco", label: "Grupo EcoLimp" },
                { id: "multi", label: "Ecolimp" },
              ] as { id: Plantilla; label: string }[]
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => actualizar("plantilla", opt.id)}
                className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] font-medium transition-colors ${
                  form.plantilla === opt.id
                    ? "border-[#4F46E5] bg-[#4F46E5]/5 text-[#4F46E5]"
                    : "border-slate-200 text-slate-500 hover:border-slate-300"
                }`}
              >
                <Building2 size={15} />
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Campos principales */}
        <div className="px-6 pt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo etiqueta="Fecha" icono={CalendarDays}>
            <input
              type="date"
              value={form.fecha}
              onChange={(e) => actualizar("fecha", e.target.value)}
              className="campo-input"
            />
          </Campo>

          <Campo etiqueta="N.º de carta" icono={Hash}>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Ej. 0145"
              value={form.num}
              onChange={(e) => actualizar("num", e.target.value)}
              className="campo-input"
            />
          </Campo>

          <Campo etiqueta="Área" icono={ClipboardList}>
            <input
              type="text"
              placeholder="Ej. Logística"
              value={form.area}
              onChange={(e) => actualizar("area", e.target.value)}
              className="campo-input"
            />
          </Campo>

          <Campo etiqueta="Entidad" icono={Landmark}>
            <input
              type="text"
              placeholder="Nombre de la entidad"
              value={form.entidad}
              onChange={(e) => actualizar("entidad", e.target.value)}
              className="campo-input"
            />
          </Campo>

          <Campo etiqueta="Ciudad" icono={MapPin}>
            <input
              type="text"
              placeholder="Ej. Huancayo"
              value={form.ciudad}
              onChange={(e) => actualizar("ciudad", e.target.value)}
              className="campo-input"
            />
          </Campo>

          <Campo etiqueta="Factura" icono={Receipt}>
            <input
              type="text"
              placeholder="Ej. F001-000123"
              value={form.factura}
              onChange={(e) => actualizar("factura", e.target.value)}
              className="campo-input"
            />
          </Campo>

            <Campo etiqueta="Guía de remisión" icono={Truck}>
            <input
              type="text"
              value={form.guiaremi}
              onChange={(e) => actualizar("guiaremi", e.target.value)}
              className="campo-input"
            />
            <label className="flex items-center gap-1.5 mt-1.5 text-[11.5px] text-slate-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.guiaremiSellado}
                onChange={(e) => actualizar("guiaremiSellado", e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-300 text-[#4F46E5] focus:ring-[#4F46E5]/30"
              />
              Incluir &quot;(cargo sellado)&quot;
            </label>
          </Campo>

          <Campo etiqueta="Orden de compra" icono={FileStack}>
            <input
              type="text"
              value={form.oc}
              onChange={(e) => actualizar("oc", e.target.value)}
              className="campo-input"
            />
          </Campo>

          <Campo etiqueta="OCAM (opcional)" icono={FileStack}>
            <input
              type="text"
              placeholder="Orden de compra Perú Compras"
              value={form.ocam}
              onChange={(e) => actualizar("ocam", e.target.value)}
              className="campo-input"
            />
          </Campo>

          <Campo etiqueta="Nombre de archivo de salida" icono={FileText}>
            <input
              type="text"
              placeholder="Ej. CARTA_0145_ENTIDAD"
              value={form.archivo}
              onChange={(e) => actualizar("archivo", e.target.value)}
              className="campo-input"
            />
          </Campo>
        </div>

        {/* PDFs adicionales, ordenables */}
        <div className="px-6 pt-6">
          <p style={{ fontFamily: "var(--font-mono)" }} className="text-[10px] text-slate-400 uppercase tracking-wide mb-2">
            PDF adicionales a consolidar (orden final del documento)
          </p>
          <button
            type="button"
            onClick={() => inputArchivosRef.current?.click()}
            className="flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-3 text-[12.5px] text-slate-500 hover:border-[#4F46E5] hover:text-[#4F46E5] transition-colors w-full justify-center"
          >
            <Upload size={15} />
            Agregar PDF
          </button>
          <input
            ref={inputArchivosRef}
            type="file"
            accept="application/pdf"
            multiple
            hidden
            onChange={(e) => agregarPdfs(e.target.files)}
          />

          {pdfsExtra.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {pdfsExtra.map((f, idx) => (
                <li
                  key={`${f.name}-${idx}`}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-[12.5px] text-slate-600"
                >
                  <span style={{ fontFamily: "var(--font-mono)" }} className="text-slate-400 shrink-0">
                    {idx + 1}.
                  </span>
                  <span className="truncate flex-1">{f.name}</span>
                  <button type="button" onClick={() => moverPdf(idx, -1)} disabled={idx === 0} className="icono-btn">
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moverPdf(idx, 1)}
                    disabled={idx === pdfsExtra.length - 1}
                    className="icono-btn"
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button type="button" onClick={() => quitarPdf(idx)} className="icono-btn hover:text-red-500">
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Mensajes de estado */}
        {error && (
          <div className="mx-6 mt-5 flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5 text-[12.5px] text-red-600">
            <AlertCircle size={15} className="shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        {resultado && (
          <div className="mx-6 mt-5 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-[12.5px] text-emerald-700">
            <span className="flex items-center gap-2">
              <CheckCircle2 size={15} />
              Documento generado: {resultado.archivo}
            </span>
            <a
              href={resultado.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white px-3 py-1.5 font-medium hover:bg-emerald-700 transition-colors shrink-0"
            >
              <Download size={13} />
              Descargar
            </a>
          </div>
        )}

        {/* Acciones */}
        <div className="flex items-center justify-end gap-2 px-6 py-5 mt-2">
          <button
            type="button"
            onClick={limpiar}
            className="px-4 py-2.5 rounded-xl text-[12.5px] font-medium text-slate-500 hover:bg-slate-100 transition-colors"
          >
            Limpiar
          </button>
          <button
            type="button"
            onClick={generar}
            disabled={enviando}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[12.5px] font-semibold bg-[#4F46E5] text-white hover:bg-[#4338CA] transition-colors disabled:opacity-60"
          >
            {enviando ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            {enviando ? "Generando…" : "Generar documento"}
          </button>
        </div>
      </div>

      <style jsx>{`
        .campo-input {
          width: 100%;
          font-size: 13px;
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
          color: #1e293b;
          transition: border-color 0.15s;
        }
        .campo-input:focus {
          outline: none;
          border-color: #4f46e5;
        }
        .icono-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 6px;
          color: #94a3b8;
          transition: background-color 0.15s, color 0.15s;
        }
        .icono-btn:hover:not(:disabled) {
          background-color: #f1f5f9;
        }
        .icono-btn:disabled {
          opacity: 0.35;
        }
      `}</style>
    </div>
  );
}

function Campo({
  etiqueta,
  icono: Icono,
  children,
}: {
  etiqueta: string;
  icono: any;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1.5 text-[11.5px] font-medium text-slate-500 mb-1.5">
        <Icono size={12.5} className="text-slate-400" />
        {etiqueta}
      </label>
      {children}
    </div>
  );
}