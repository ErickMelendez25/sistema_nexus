"use client";

import {
  X, Package, Building2, Users, MessageSquareText, FileText,
} from "lucide-react";
import { useState } from "react";
import { EmpresaOption } from "./erp-shared";

interface ProductoBloqueForm {
  codigo: string;
  descripcion: string;
  precio_producto: string;
  precio_flete: string;
  comodato: string;
  observaciones_externas: string;
}

interface CompartidoBloque {
  proveedor_nombre: string;
  proveedor_telefono: string;
  tipo_envio: string;
  agencia_transporte: string;
  observaciones: string;
  otras_observaciones: string;
  observaciones_transporte: string;
}

interface Props {
  items: ProductoBloqueForm[];
  actualizarItem: (
    codigo: string,
    campo: "precio_producto" | "precio_flete" | "comodato" | "observaciones_externas",
    valor: string
  ) => void;

  compartido: CompartidoBloque;
  actualizarCompartido: (campo: keyof CompartidoBloque, valor: string) => void;
  soloLectura: boolean;

  empresas: EmpresaOption[];
  mostrarSelectorEmpresa: boolean;
  empresaId: string;
  onEmpresaChange: (v: string) => void;

  totalProductos: number;
  totalFlete: number;
  pdfConsolidadoUrl?: string | null;

  renderBuscadorProveedor: () => React.ReactNode;
  renderBuscadorTransporte: () => React.ReactNode;
  renderContactoProveedor: () => React.ReactNode;
  renderSelectorImagenes: (codigo: string) => React.ReactNode;
  cantidadImagenes: (codigo: string) => number;
}

const TEXTO_OBS_AGENCIA =
  "LLAMAR 1 HORA ANTES A JOHANA CEL: 941 567 335 (LUNES A VIERNES: DE 8:30 AM A 6:00 PM, SÁBADOS: 9:00 AM - 12:00 PM) EMITIR LA GUÍA CON LA DIRECCIÓN DE ENTREGA";
const TEXTO_OBS_ENTIDAD =
  "LLAMAR 1 HORA ANTES A JOHANA CEL: 941 567 335 (LUNES A VIERNES: DE 8:30 AM A 12:00 PM - DE 2:00 PM A 4:00 PM)- EMITIR LA GUÍA CON LA DIRECCIÓN DE ENTREGA";

export default function FormularioBloqueModal({
  items,
  actualizarItem,
  compartido,
  actualizarCompartido,
  soloLectura,
  empresas,
  mostrarSelectorEmpresa,
  empresaId,
  onEmpresaChange,
  totalProductos,
  totalFlete,
  pdfConsolidadoUrl,
  renderBuscadorProveedor,
  renderBuscadorTransporte,
  renderContactoProveedor,
  renderSelectorImagenes,
  cantidadImagenes,
}: Props) {
    const [tabActivo, setTabActivo] = useState<string | null>(
    items[0]?.codigo ?? null
  );

  const elegirTipoEnvio = (tipo: "ENTIDAD" | "AGENCIA") => {
    if (soloLectura) return;
    actualizarCompartido("tipo_envio", tipo);
    actualizarCompartido("observaciones", tipo === "AGENCIA" ? TEXTO_OBS_AGENCIA : TEXTO_OBS_ENTIDAD);
  };

  return (
    <div className="space-y-3">
      {/* Grid 2x2 — datos comunes a TODO el bloque */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* 1. Información del proveedor */}
        <div className="rounded-xl border border-slate-200 border-l-4 border-l-[#4F46E5] bg-slate-50/40 p-4 space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
            <div className="w-7 h-7 rounded-lg bg-[#4F46E5]/10 flex items-center justify-center shrink-0 text-[#4F46E5]">
              <Package size={14} />
            </div>
            <p className="text-[13px] font-bold text-[#4F46E5]">1. Información del proveedor</p>
          </div>

          {renderBuscadorProveedor()}
          {renderContactoProveedor()}

          <CampoSimple
            label="Teléfono proveedor"
            value={compartido.proveedor_telefono}
            onChange={(v) => actualizarCompartido("proveedor_telefono", v)}
            disabled={soloLectura}
            placeholder="+51 937 119 045"
          />

          {mostrarSelectorEmpresa && (
            <div>
              <label className="block text-[11px] font-medium text-indigo-700 mb-1">
                Empresa (aplica a todo el bloque)
              </label>
              <select
                value={empresaId}
                disabled={soloLectura}
                onChange={(e) => onEmpresaChange(e.target.value)}
                className="w-full bg-white border border-indigo-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-50 disabled:text-slate-500"
              >
                <option value="">Mantener empresa individual de cada producto</option>
                {empresas.map((em) => (
                  <option key={em.id} value={em.id}>{em.razonSocial}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* 2. Tipo de envío */}
        {/* 2. Tipo de envío */}
        <div className="rounded-xl border border-slate-200 border-l-4 border-l-amber-400 bg-slate-50/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 text-amber-600">
                <Building2 size={14} />
              </div>
              <p className="text-[13px] font-bold text-amber-700">2. Tipo de envío</p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => elegirTipoEnvio("ENTIDAD")}
                disabled={soloLectura}
                className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors disabled:opacity-40 ${
                  compartido.tipo_envio === "ENTIDAD"
                    ? "bg-amber-500 text-white border-amber-500"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                ENTIDAD
              </button>
              <button
                type="button"
                onClick={() => elegirTipoEnvio("AGENCIA")}
                disabled={soloLectura}
                className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors disabled:opacity-40 ${
                  compartido.tipo_envio === "AGENCIA"
                    ? "bg-[#4F46E5] text-white border-[#4F46E5]"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                AGENCIA
              </button>
            </div>
          </div>

          {compartido.tipo_envio === "AGENCIA" ? (
            <div className="space-y-3">
              {renderBuscadorTransporte()}
            <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Observaciones transporte</label>
                <textarea
                  value={compartido.observaciones_transporte}
                  disabled={soloLectura}
                  placeholder="Nota específica para el transportista..."
                  onChange={(e) => actualizarCompartido("observaciones_transporte", e.target.value)}
                  rows={6}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y min-h-[140px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-slate-400">Selecciona el tipo de envío para este bloque.</p>
          )}
        </div>

        {/* 3. Observaciones */}
        <div className="rounded-xl border border-slate-200 border-l-4 border-l-violet-400 bg-slate-50/40 p-4 space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
            <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center shrink-0 text-violet-600">
              <MessageSquareText size={14} />
            </div>
            <p className="text-[13px] font-bold text-violet-700">3. Observaciones</p>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Observaciones</label>
            <textarea
              value={compartido.observaciones}
              disabled={soloLectura}
              placeholder="Cualquier detalle adicional para seguimiento..."
              onChange={(e) => actualizarCompartido("observaciones", e.target.value)}
              rows={4}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Otras observaciones</label>
            <textarea
              value={compartido.otras_observaciones}
              disabled={soloLectura}
              placeholder="Cualquier otra nota general para la OP..."
              onChange={(e) => actualizarCompartido("otras_observaciones", e.target.value)}
              rows={4}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
            />
          </div>
        </div>

        {/* 4. Resumen del bloque */}
        <div className="rounded-xl border border-slate-200 border-l-4 border-l-emerald-400 bg-slate-50/40 p-4 space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
            <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0 text-emerald-600">
              <FileText size={14} />
            </div>
            <p className="text-[13px] font-bold text-emerald-700">4. Resumen del bloque</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-white border border-slate-200 px-3 py-2.5">
              <p className="text-[10px] text-slate-400 uppercase font-semibold">Productos</p>
              <p className="text-sm font-bold text-slate-800">{items.length}</p>
            </div>
            <div className="rounded-lg bg-white border border-slate-200 px-3 py-2.5">
              <p className="text-[10px] text-slate-400 uppercase font-semibold">Total productos</p>
              <p className="text-sm font-bold text-emerald-700">S/ {totalProductos.toFixed(5)}</p>
            </div>
            {compartido.tipo_envio === "AGENCIA" && (
              <div className="rounded-lg bg-white border border-slate-200 px-3 py-2.5 col-span-2">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Total flete</p>
                <p className="text-sm font-bold text-slate-800">S/ {totalFlete.toFixed(5)}</p>
              </div>
            )}
          </div>

          {pdfConsolidadoUrl && (
            
            <a  href={pdfConsolidadoUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center justify-center gap-2 w-full bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 font-medium rounded-lg py-2 text-xs transition-colors"
            >
              <FileText size={13} /> Ver PDF consolidado
            </a>
          )}
        </div>
      </div>

      
        {/* Lista de productos del bloque — un tab por producto */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
          <p className="text-[13px] font-bold text-slate-800">
            Precio y flete por producto ({items.length})
          </p>
        </div>

        {/* Barra de tabs — uno por producto */}
        <div className="flex gap-1.5 px-3 pt-2.5 pb-2 overflow-x-auto">
          {items.map((it, idx) => {
            const activo = tabActivo === it.codigo;
            const nImg = cantidadImagenes(it.codigo);
            return (
              <button
                key={it.codigo}
                type="button"
                onClick={() => setTabActivo(it.codigo)}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                  activo
                    ? "bg-[#4F46E5] text-white border-[#4F46E5]"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${activo ? "bg-white/20" : "bg-slate-100"}`}>
                  {idx + 1}
                </span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{it.codigo}</span>
                {it.precio_producto && (
                  <span className={activo ? "text-white/90" : "text-emerald-700"}>
                    S/ {Number(it.precio_producto).toFixed(5)}
                  </span>
                )}
                {nImg > 0 && (
                  <span className={`flex items-center gap-0.5 ${activo ? "text-white/90" : "text-red-600"}`}>
                    <FileText size={10} /> {nImg}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Contenido del producto activo */}
        {items.map((it) => {
          if (tabActivo !== it.codigo) return null;
          return (
            <div key={it.codigo} className="px-4 pb-4 pt-1 space-y-3 border-t border-slate-100">
              <p className="text-[11px] text-slate-500 truncate pt-2">{it.descripcion}</p>
              <div className={`grid gap-3 ${compartido.tipo_envio === "AGENCIA" ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"}`}>
                <CampoSimple label="Precio producto" value={it.precio_producto} onChange={(v) => actualizarItem(it.codigo, "precio_producto", v)} disabled={soloLectura} placeholder="0.00" />
                <CampoSimple label="Comodato" value={it.comodato} onChange={(v) => actualizarItem(it.codigo, "comodato", v)} disabled={soloLectura} placeholder="-" />
                <CampoSimple label="Observaciones externas" value={it.observaciones_externas} onChange={(v) => actualizarItem(it.codigo, "observaciones_externas", v)} disabled={soloLectura} placeholder="-" />
                {compartido.tipo_envio === "AGENCIA" && (
                  <CampoSimple label="Precio flete" value={it.precio_flete} onChange={(v) => actualizarItem(it.codigo, "precio_flete", v)} disabled={soloLectura} placeholder="0.00" />
                )}
              </div>
              {renderSelectorImagenes(it.codigo)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TarjetaTipoEnvio({
  activo, disabled, onClick, icono, titulo, subtitulo, colorActivo,
}: {
  activo: boolean; disabled?: boolean; onClick: () => void;
  icono: React.ReactNode; titulo: string; subtitulo: string;
  colorActivo: "amber" | "indigo";
}) {
  const estilos =
    colorActivo === "amber"
      ? { borde: "border-amber-400", bg: "bg-amber-50/60", icono: "bg-amber-100 text-amber-600", dot: "border-amber-400" }
      : { borde: "border-[#4F46E5]", bg: "bg-indigo-50/60", icono: "bg-indigo-100 text-[#4F46E5]", dot: "border-[#4F46E5]" };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        activo ? `${estilos.borde} ${estilos.bg}` : "border-slate-200 bg-white hover:border-slate-300"
      }`}
    >
      <div className={`w-11 h-11 rounded-full flex items-center justify-center ${activo ? estilos.icono : "bg-slate-100 text-slate-400"}`}>
        {icono}
      </div>
      <p className="text-xs font-bold text-slate-800 tracking-wide">{titulo}</p>
      <p className="text-[10px] text-slate-500">{subtitulo}</p>
      <span className={`w-3.5 h-3.5 rounded-full border-2 ${activo ? estilos.dot : "border-slate-300"}`}>
        {activo && <span className={`block w-full h-full rounded-full scale-50 ${colorActivo === "amber" ? "bg-amber-400" : "bg-[#4F46E5]"}`} />}
      </span>
    </button>
  );
}

function CampoSimple({
  label, value, onChange, disabled, placeholder,
}: {
  label: string; value: string; onChange: (v: string) => void;
  disabled?: boolean; placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-500 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
      />
    </div>
  );
}