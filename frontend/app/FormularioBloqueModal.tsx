"use client";

import {
  X, Package, Building2, Users, MessageSquareText, FileText, Truck,
} from "lucide-react";
import { useState } from "react";
import { EmpresaOption, calcularMargen } from "./erp-shared";
import { VisorDocumentos, nombreDesdeUrl } from "./FormularioProductoModal";

import { HistorialPrecioProveedor, HistorialPrecioFlete } from "./HistorialComercialCard";

interface ProductoBloqueForm {
  codigo: string;
  descripcion: string;
  precio_producto: string;
  precio_flete: string;
  comodato: string;
  observaciones_externas: string;
  montoReferencia?: string;
  margen?: string;
  cantidad?: number | string;
  unidadMedida?: string;
}

interface CompartidoBloque {
  proveedor_id: string;
  proveedor_nombre: string;
  proveedor_telefono: string;
  tipo_envio: string;
  transporte_id: string;
  agencia_transporte: string;
  observaciones: string;
  otras_observaciones: string;
  observaciones_transporte: string;
}

interface Props {
    items: ProductoBloqueForm[];
    productoInicial?: string | null;
    montoVenta?: number | null;
    /** true mientras se envía/confirma/guarda/actualiza — atenúa el
     * formulario mientras el overlay de carga (definido en OpsDrawer.tsx)
     * cubre todo el modal. */
    procesando?: boolean;
    actualizarItem: (
    codigo: string,
    campo: "precio_producto" | "precio_flete" | "comodato" | "observaciones_externas" | "montoReferencia",
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

  // Documentos OCE (OCAM) / OCF (Física) — opcionales, si no vienen
  // simplemente no se muestra el visor y el formulario ocupa todo el ancho.
  urlOce?: string | null;
  urlOcf?: string | null;

  clienteId?: number | string | null;
  departamentoEntrega?: string | null;
  provinciaEntrega?: string | null;
  distritoEntrega?: string | null;

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
  productoInicial,
  procesando,
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
  urlOce,
  urlOcf,
  clienteId,
  departamentoEntrega,
  provinciaEntrega,
  distritoEntrega,
  renderBuscadorProveedor,
  renderBuscadorTransporte,
  renderContactoProveedor,
  renderSelectorImagenes,
  cantidadImagenes,
}: Props) {
  const [tabActivo, setTabActivo] = useState<string | null>(
    productoInicial ?? (items[0]?.codigo ?? null)
  );
    const [docActivo, setDocActivo] = useState<string>("oce");

  const elegirTipoEnvio = (tipo: "ENTIDAD" | "AGENCIA") => {
    if (soloLectura) return;
    actualizarCompartido("tipo_envio", tipo);
    actualizarCompartido("observaciones", tipo === "AGENCIA" ? TEXTO_OBS_AGENCIA : TEXTO_OBS_ENTIDAD);
  };

  // Tabs adicionales del visor lateral — historial de precios, al costado
  // de OCE/OCF. El de flete solo aparece si el envío del bloque es AGENCIA.
  const codigoActivo = tabActivo || items[0]?.codigo;
  const tabsExtra = [
    {
      id: "precio",
      label: "Hist. precio",
      icon: <Package size={13} />,
      contenido: (
        <HistorialPrecioProveedor
          codigo={codigoActivo}
          clienteId={clienteId}
          departamento={departamentoEntrega}
          provincia={provinciaEntrega}
          distrito={distritoEntrega}
        />
      ),
    },
    ...(compartido.tipo_envio === "AGENCIA"
      ? [
          {
            id: "flete",
            label: "Hist. flete",
            icon: <Truck size={13} />,
            contenido: (
              <HistorialPrecioFlete
                transporteId={compartido.transporte_id}
                transporteNombre={compartido.agencia_transporte}
                clienteId={clienteId}
                departamento={departamentoEntrega}
                provincia={provinciaEntrega}
                distrito={distritoEntrega}
              />
            ),
          },
        ]
      : []),
  ];

  const hayVisor = !!(urlOce || urlOcf) || tabsExtra.length > 0;

  return (
      <div
        className={`flex flex-col ${hayVisor ? "xl:flex-row" : ""} gap-3 items-start transition-opacity duration-200 ${
          procesando ? "opacity-50 pointer-events-none select-none" : "opacity-100"
        }`}
      >
      {/* ===== Columna izquierda: todo el formulario del bloque ===== */}
      <div className="flex-1 min-w-0 w-full space-y-2.5">
        {/* Grid 2x2 — datos comunes a TODO el bloque */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 items-start">
          {/* 1. Información del proveedor */}
          <div className="rounded-xl border border-slate-200 border-l-4 border-l-[#4F46E5] bg-slate-50/40 p-3 space-y-2">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
              <div className="w-6 h-6 rounded-lg bg-[#4F46E5]/10 flex items-center justify-center shrink-0 text-[#4F46E5]">
                <Package size={13} />
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
                  className="w-full bg-white border border-indigo-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-50 disabled:text-slate-500"
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
          <div className="rounded-xl border border-slate-200 border-l-4 border-l-amber-400 bg-slate-50/40 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 text-amber-600">
                  <Building2 size={13} />
                </div>
                <p className="text-[13px] font-bold text-amber-700">2. Tipo de envío</p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => elegirTipoEnvio("ENTIDAD")}
                  disabled={soloLectura}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors disabled:opacity-40 ${
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
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors disabled:opacity-40 ${
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
              <div className="space-y-2">
                {renderBuscadorTransporte()}
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Observaciones transporte</label>
                  <textarea
                    value={compartido.observaciones_transporte}
                    disabled={soloLectura}
                    placeholder="Nota específica para el transportista..."
                    onChange={(e) => actualizarCompartido("observaciones_transporte", e.target.value)}
                    rows={3}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y min-h-[64px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
                  />
                </div>
              </div>
            ) : compartido.tipo_envio === "ENTIDAD" ? (
              <div className="flex items-center gap-2 rounded-lg bg-amber-50/60 border border-dashed border-amber-200 px-3 py-2">
                <Building2 size={13} className="text-amber-500 shrink-0" />
                <p className="text-[11px] text-amber-700">
                  Envío directo a la entidad. No requiere agencia de transporte.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">Selecciona el tipo de envío para este bloque.</p>
            )}
          </div>

          {/* 3. Observaciones */}
          <div className="rounded-xl border border-slate-200 border-l-4 border-l-violet-400 bg-slate-50/40 p-3 space-y-2">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
              <div className="w-6 h-6 rounded-lg bg-violet-100 flex items-center justify-center shrink-0 text-violet-600">
                <MessageSquareText size={13} />
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
                rows={2}
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
                rows={2}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
              />
            </div>
          </div>

          {/* 4. Resumen del bloque */}
          <div className="rounded-xl border border-slate-200 border-l-4 border-l-emerald-400 bg-slate-50/40 p-3 space-y-2">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
              <div className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center shrink-0 text-emerald-600">
                <FileText size={13} />
              </div>
              <p className="text-[13px] font-bold text-emerald-700">4. Resumen del bloque</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Productos</p>
                <p className="text-sm font-bold text-slate-800">{items.length}</p>
              </div>
              <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                <p className="text-[10px] text-slate-400 uppercase font-semibold">Total productos</p>
                <p className="text-sm font-bold text-emerald-700">S/ {totalProductos.toFixed(3)}</p>
              </div>
              {compartido.tipo_envio === "AGENCIA" && (
                <div className="rounded-lg bg-white border border-slate-200 px-3 py-2 col-span-2">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold">Total flete</p>
                  <p className="text-sm font-bold text-slate-800">S/ {totalFlete.toFixed(3)}</p>
                </div>
              )}
            </div>

            {pdfConsolidadoUrl && (
              
              <a href={pdfConsolidadoUrl}
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
          <div className="px-3.5 py-1.5 bg-slate-50 border-b border-slate-200">
            <p className="text-[13px] font-bold text-slate-800">
              Precio y flete por producto ({items.length})
            </p>
          </div>

          {/* Barra de tabs — uno por producto, con cantidad visible */}
          <div className="flex gap-1.5 px-3 pt-2 pb-2 overflow-x-auto">
            {items.map((it, idx) => {
              const activo = tabActivo === it.codigo;
              const nImg = cantidadImagenes(it.codigo);
              return (
                <button
                  key={it.codigo}
                  type="button"
                  onClick={() => setTabActivo(it.codigo)}
                  className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                    activo
                      ? "bg-[#4F46E5] text-white border-[#4F46E5]"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] ${activo ? "bg-white/20" : "bg-slate-100"}`}>
                    {idx + 1}
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{it.codigo}</span>
                  {it.cantidad != null && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${activo ? "bg-white/20 text-white" : "bg-blue-50 text-blue-700 border border-blue-200"}`}>
                      Cant: {it.cantidad}{it.unidadMedida ? ` ${it.unidadMedida}` : ""}
                    </span>
                  )}
                  {it.precio_producto && (
                    <span className={activo ? "text-white/90" : "text-emerald-700"}>
                      S/ {Number(it.precio_producto).toFixed(2)}
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
              <div key={it.codigo} className="px-3.5 pb-3.5 pt-1 space-y-2.5 border-t border-slate-100">
                <div className="flex items-center gap-2 flex-wrap pt-1.5">
                  <p className="text-[11px] text-slate-500 flex-1 min-w-[160px] truncate">{it.descripcion}</p>
                  {it.cantidad != null && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                      Cant: {it.cantidad} {it.unidadMedida || ""}
                    </span>
                  )}
                </div>

                {/* Monto referencia + margen — el margen de ESTE producto
                    se calcula SOLO con su propio monto de referencia, no
                    con montoVenta de toda la orden. */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <CampoSimple
                    label="Monto referencia (para margen)"
                    value={it.montoReferencia || ""}
                    onChange={(v) => actualizarItem(it.codigo, "montoReferencia", v)}
                    disabled={soloLectura}
                    placeholder="0.00"
                  />
                  <CajaMargenMini margen={it.margen || ""} />
                </div>

                <div className={`grid gap-2.5 ${compartido.tipo_envio === "AGENCIA" ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3"}`}>
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

      {/* ===== Columna derecha: visor OCE (OCAM) / OCF (Física) ===== */}
      {hayVisor && (
        <div className="w-full xl:w-[440px] shrink-0 xl:sticky xl:top-2">
          <div className="h-[420px] xl:h-[calc(92vh-160px)]">
            <VisorDocumentos
              docActivo={docActivo}
              onCambiarDoc={setDocActivo}
              urlOce={urlOce ?? null}
              urlOcf={urlOcf ?? null}
              nombreOce={urlOce ? nombreDesdeUrl(urlOce) : null}
              nombreOcf={urlOcf ? nombreDesdeUrl(urlOcf) : null}
              tabsExtra={tabsExtra}
            />
          </div>
        </div>
      )}
    </div>
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
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
      />
    </div>
  );
}

// Cajita de margen por producto, dentro de cada tab del bloque — mismo
// esquema de colores que CajaMargen del formulario individual: <8% rojo,
// 8-10% amarillo, >=10% verde. Nunca se manda al ERP.
function CajaMargenMini({ margen }: { margen: string }) {
  const valor = margen.trim() === "" ? null : parseFloat(margen);
  if (valor == null || Number.isNaN(valor)) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 flex flex-col justify-center">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Margen</p>
        <p className="text-[11px] text-slate-400">Ingresa precio, flete y monto ref.</p>
      </div>
    );
  }
  const color =
    valor < 8
      ? "bg-red-50 border-red-300 text-red-700"
      : valor < 10
      ? "bg-amber-50 border-amber-300 text-amber-700"
      : "bg-emerald-50 border-emerald-300 text-emerald-700";
  return (
    <div className={`rounded-lg border px-3 py-2 flex flex-col justify-center ${color}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">Margen</p>
      <p className="text-sm font-bold">{valor.toFixed(2)}%</p>
    </div>
  );
}