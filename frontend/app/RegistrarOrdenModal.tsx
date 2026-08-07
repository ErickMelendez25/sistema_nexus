"use client";

import { useState } from "react";
import {
  Loader2,
  AlertTriangle,
  X,
  FileScan,
  Building2,
  Landmark,
  Package,
  Hash,
  DollarSign,
  CalendarDays,
  Truck,
  UserCircle2,
  ClipboardList,
  Sparkles,
} from "lucide-react";
import { API_BASE, fetchConToken, Publicada } from "./helbot-shared";

interface RegistrarOrdenModalProps {
  p: Publicada;
}

interface CampoDef {
  key: string;
  label: string;
  icon: React.ElementType;
  span?: 1 | 2;
}

const CAMPOS_PRINCIPALES: CampoDef[] = [
  { key: "entidad", label: "Entidad", icon: Landmark, span: 2 },
  { key: "unidad_ejecutora", label: "Unidad Ejecutora", icon: Building2 },
  { key: "codigo_unidad_ejecutora", label: "Código U.E.", icon: Hash },
  { key: "expediente", label: "Expediente SIAF", icon: ClipboardList },
  { key: "fecha", label: "Fecha", icon: CalendarDays },
  { key: "producto", label: "Producto", icon: Package, span: 2 },
  { key: "cantidad", label: "Cantidad", icon: Hash },
  { key: "monto", label: "Monto (S/)", icon: DollarSign },
];

const CAMPOS_OTROS: CampoDef[] = [
  { key: "numero_ocam", label: "N° OCAM", icon: Hash },
  { key: "estado", label: "Estado", icon: Sparkles },
  { key: "proveedor", label: "Proveedor", icon: UserCircle2, span: 2 },
  { key: "ruc_proveedor", label: "RUC Proveedor", icon: Hash },
  { key: "ruc_entidad", label: "RUC Entidad", icon: Hash },
  { key: "codigo_producto", label: "Código Producto", icon: Hash },
  { key: "plazo_entrega", label: "Plazo de Entrega", icon: Truck, span: 2 },
];

function CampoCard({ campo, valor }: { campo: CampoDef; valor: unknown }) {
  const Icon = campo.icon;
  const texto = valor === null || valor === undefined || valor === "" ? "—" : String(valor);
  const vacio = texto === "—";

  return (
    <div
      className={`bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 ${
        campo.span === 2 ? "sm:col-span-2" : ""
      }`}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <Icon size={12} className="text-[#4F46E5]" />
        <span
          style={{ fontFamily: "var(--font-mono)" }}
          className="text-[10px] font-medium text-slate-500 uppercase tracking-wide"
        >
          {campo.label}
        </span>
      </div>
      <p className={`text-sm font-medium leading-snug ${vacio ? "text-slate-300" : "text-slate-800"}`}>
        {texto}
      </p>
    </div>
  );
}

function SkeletonCampo({ span }: { span?: 1 | 2 }) {
  return (
    <div className={`bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 ${span === 2 ? "sm:col-span-2" : ""}`}>
      <div className="h-2.5 w-16 bg-slate-200 rounded animate-pulse mb-2" />
      <div className="h-3.5 w-24 bg-slate-200 rounded animate-pulse" />
    </div>
  );
}

export default function RegistrarOrdenModal({ p }: RegistrarOrdenModalProps) {
  const [registrarAbierto, setRegistrarAbierto] = useState(false);
  const [cargandoOcr, setCargandoOcr] = useState(false);
  const [datosOcr, setDatosOcr] = useState<Record<string, unknown> | null>(null);
  const [errorOcr, setErrorOcr] = useState("");

  const abrirRegistrarOrden = async () => {
    setRegistrarAbierto(true);
    setCargandoOcr(true);
    setErrorOcr("");
    setDatosOcr(null);
    try {
      const rPdf = await fetchConToken(`${API_BASE}/publicadas/${p.N_OrdenCompra}/pdf`);
      if (!rPdf.ok) throw new Error("No se pudo descargar el PDF de la orden");
      const blobPdf = await rPdf.blob();

      const fd = new FormData();
      fd.append("archivo", blobPdf, `${p.C_OrdenCompra}.pdf`);
      fd.append("publicada_id", p.C_OrdenCompra);

      const rOcr = await fetchConToken(`${API_BASE}/ficha/ocr`, {
        method: "POST",
        body: fd,
      });
      if (!rOcr.ok) {
        const body = await rOcr.json().catch(() => ({}));
        throw new Error(body.detail || "No se pudo aplicar el OCR");
      }
      const data = await rOcr.json();
      setDatosOcr(data.datos);
    } catch (e) {
      setErrorOcr(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCargandoOcr(false);
    }
  };

  const cerrarRegistrarOrden = () => {
    setRegistrarAbierto(false);
    setDatosOcr(null);
    setErrorOcr("");
  };

  const otros = (datosOcr?.otros as Record<string, unknown> | null) || null;

  return (
    <>
      <button
        onClick={abrirRegistrarOrden}
        className="mt-2 w-full flex items-center justify-center gap-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg py-2 hover:bg-emerald-700 transition-colors"
      >
        <FileScan size={13} />
        Registrar Orden
      </button>

      {registrarAbierto && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-[1px]" onClick={cerrarRegistrarOrden} />

          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-indigo-50/60 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#10172A] flex items-center justify-center shrink-0">
                  <FileScan size={16} className="text-white" />
                </div>
                <div>
                  <h3 style={{ fontFamily: "var(--font-display)" }} className="text-sm font-semibold text-slate-900 leading-none">
                    Registrar Orden
                  </h3>
                  <p style={{ fontFamily: "var(--font-mono)" }} className="text-[11px] text-slate-400 mt-1">
                    {p.C_OrdenCompra}
                  </p>
                </div>
              </div>
              <button
                onClick={cerrarRegistrarOrden}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            {/* Contenido */}
            <div className="flex-1 overflow-y-auto px-5 py-5">
              {cargandoOcr && (
                <div>
                  <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
                    <Loader2 size={13} className="animate-spin text-[#4F46E5]" />
                    Descargando PDF y extrayendo datos con OCR…
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {CAMPOS_PRINCIPALES.map((c) => (
                      <SkeletonCampo key={c.key} span={c.span} />
                    ))}
                  </div>
                </div>
              )}

              {!cargandoOcr && errorOcr && (
                <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl px-4 py-3">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">No se pudo procesar la orden</p>
                    <p className="text-red-600/80 mt-0.5">{errorOcr}</p>
                  </div>
                </div>
              )}

              {!cargandoOcr && !errorOcr && datosOcr && (
                <div className="space-y-6">
                  {/* Datos principales */}
                  <div>
                    <p
                      style={{ fontFamily: "var(--font-mono)" }}
                      className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5"
                    >
                      Datos de la orden
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {CAMPOS_PRINCIPALES.map((c) => (
                        <CampoCard key={c.key} campo={c} valor={datosOcr[c.key]} />
                      ))}
                    </div>
                  </div>

                  {/* Otros datos */}
                  {otros && (
                    <div>
                      <p
                        style={{ fontFamily: "var(--font-mono)" }}
                        className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2.5"
                      >
                        Proveedor y detalle
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        {CAMPOS_OTROS.map((c) => (
                          <CampoCard key={c.key} campo={c} valor={otros[c.key]} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            {!cargandoOcr && !errorOcr && datosOcr && (
              <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between">
                <p className="text-[11px] text-slate-400">Extraído automáticamente del PDF de la orden.</p>
                <button
                  onClick={cerrarRegistrarOrden}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-lg hover:bg-white transition-colors"
                >
                  Cerrar
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}