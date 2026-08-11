"use client";

import {
  X, Loader2, Send, ShieldCheck, RefreshCw, FileText, Package,
  Building2, Users, MessageSquareText, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { EmpresaOption } from "./erp-shared";

/* ============================================================
   Estos tipos deben ser EXACTAMENTE los mismos que ya existen en
   OpsDrawer.tsx. Si tus interfaces ProveedorOption / TransporteOption /
   FormularioProducto / ImagenProducto cambian ahí, cámbialas aquí igual.
   Lo más simple: expórtalas desde OpsDrawer.tsx (agrega "export" antes
   de cada "interface") e impórtalas acá en vez de repetirlas.
   ============================================================ */

interface ProveedorOption {
  id: number;
  razonSocial: string;
  telefono?: string | null;
  ruc?: string;
  departamento?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  direccion?: string | null;
}

interface TransporteOption {
  id: number;
  razonSocial: string;
  telefono?: string | null;
  cobertura?: string | null;
  ruc?: string;
  departamento?: string | null;
  provincia?: string | null;
  distrito?: string | null;
  direccion?: string | null;
}

interface FormularioProducto {
  proveedor_nombre: string;
  proveedor_id: string;
  proveedor_telefono: string;
  precio_producto: string;
  comodato: string;
  observaciones_externas: string;
  agencia_transporte: string;
  transporte_id: string;
  precio_flete: string;
  observaciones: string;
  observaciones_transporte: string;
  otras_observaciones: string;
  tipo_envio: string;
  empresa_id: string;
  empresa_nombre: string;
}

interface ImagenProducto {
  id: number;
  ruta_archivo: string;
  nombre_original?: string;
  url?: string;
}

/* ============================================================
   Props — todo lo que el modal necesita para pintarse y disparar
   acciones. OpsDrawer.tsx sigue siendo dueño del estado real; este
   componente solo recibe valores + callbacks.
   ============================================================ */
interface Props {
  // Identificación
  codigo: string;
  nombreProducto: string;
  descripcionProducto: string;
  cantidad?: number | string;
  unidadMedida?: string;

  // Formulario
  form: FormularioProducto;
  actualizarCampo: (codigo: string, campo: keyof FormularioProducto, valor: string) => void;
  soloLectura: boolean;

  // Catálogos
  proveedores: ProveedorOption[];
  transportes: TransporteOption[];
  cargandoProveedores: boolean;
  cargandoTransportes: boolean;
  empresas: EmpresaOption[];
  cargandoEmpresas: boolean;
  esSeguimiento: boolean;
  onCrearProveedor: () => void;
  onCrearTransporte: () => void;

  // Imágenes
  ordenCompraId: number;
  imagenes: ImagenProducto[];
  onCambiarImagenes: (nuevas: ImagenProducto[]) => void;

  // Estado de seguimiento (para textos/badges del footer)
  estado: "pendiente" | "preview" | "confirmado" | "subido";
  rellenadoPor?: string | null;
  confirmadoPor?: string | null;
  pdfConsolidadoUrl?: string | null;

  // Acciones (footer) — cada una puede venir undefined si no aplica
  guardando?: boolean;
  confirmando?: boolean;
  actualizandoErp?: boolean;
  onEnviarParaRevision?: () => void;      // ventas, estado pendiente/preview
  onGuardarCambios?: () => void;          // seguimiento, estado preview/confirmado/subido
  onConfirmar?: () => void;               // seguimiento, estado preview
  onActualizarErp?: () => void;           // seguimiento, estado confirmado/subido

  onCerrar: () => void;

  // Buscador reutilizado (se pasa como render-prop para no duplicar
  // BuscadorEntidad — ver instrucciones de integración abajo)
  renderBuscadorProveedor: () => React.ReactNode;
  renderBuscadorTransporte: () => React.ReactNode;
  renderContactoProveedor: () => React.ReactNode;
  renderSelectorImagenes: () => React.ReactNode;
}

const TEXTO_OBS_AGENCIA =
  "LLAMAR 1 HORA ANTES A JOHANA CEL: 941 567 335 (LUNES A VIERNES: DE 8:30 AM A 6:00 PM, SÁBADOS: 9:00 AM - 12:00 PM) EMITIR LA GUÍA CON LA DIRECCIÓN DE ENTREGA";
const TEXTO_OBS_ENTIDAD =
  "LLAMAR 1 HORA ANTES A JOHANA CEL: 941 567 335 (LUNES A VIERNES: DE 8:30 AM A 12:00 PM - DE 2:00 PM A 4:00 PM)- EMITIR LA GUÍA CON LA DIRECCIÓN DE ENTREGA";

function faltantesDe(form: FormularioProducto): string[] {
  const campos: { key: keyof FormularioProducto; label: string }[] = [
    { key: "proveedor_nombre", label: "Proveedor" },
    { key: "proveedor_telefono", label: "Teléfono proveedor" },
    { key: "precio_producto", label: "Precio producto" },
  ];
  if (form.tipo_envio === "AGENCIA") {
    campos.push({ key: "agencia_transporte", label: "Agencia de transporte" });
    campos.push({ key: "precio_flete", label: "Precio flete" });
  }
  return campos.filter((c) => !form[c.key]?.trim()).map((c) => c.label);
}

export default function FormularioProductoModal({
  codigo,
  nombreProducto,
  descripcionProducto,
  cantidad,
  unidadMedida,
  form,
  actualizarCampo,
  soloLectura,
  empresas,
  cargandoEmpresas,
  esSeguimiento,
  estado,
  rellenadoPor,
  confirmadoPor,
  pdfConsolidadoUrl,
  guardando,
  confirmando,
  actualizandoErp,
  onEnviarParaRevision,
  onGuardarCambios,
  onConfirmar,
  onActualizarErp,
  onCerrar,
  renderBuscadorProveedor,
  renderBuscadorTransporte,
  renderContactoProveedor,
  renderSelectorImagenes,
}: Props) {
  const faltantes = faltantesDe(form);

  const elegirTipoEnvio = (tipo: "ENTIDAD" | "AGENCIA") => {
    if (soloLectura) return;
    actualizarCampo(codigo, "tipo_envio", tipo);
    actualizarCampo(codigo, "observaciones", tipo === "AGENCIA" ? TEXTO_OBS_AGENCIA : TEXTO_OBS_ENTIDAD);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onCerrar} />
      <div className="relative w-full max-w-[1200px] max-h-[92vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
          <div className="min-w-0">
            <p className="text-base font-bold text-slate-900 truncate">{nombreProducto || codigo}</p>
            <p className="text-xs text-indigo-600/80 truncate">{descripcionProducto}</p>
          </div>
          <button onClick={onCerrar} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {cantidad != null && (
            <p className="text-[11px] text-slate-400 -mt-1">{cantidad} {unidadMedida}</p>
          )}

          {/* Grid 2x2 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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

              <div className="grid grid-cols-2 gap-3">
                <CampoSimple
                  label="Teléfono proveedor"
                  value={form.proveedor_telefono}
                  onChange={(v) => actualizarCampo(codigo, "proveedor_telefono", v)}
                  disabled={soloLectura}
                  placeholder="+51 937 119 045"
                />
                <CampoSimple
                  label="Precio producto"
                  value={form.precio_producto}
                  onChange={(v) => actualizarCampo(codigo, "precio_producto", v)}
                  disabled={soloLectura}
                  placeholder="0.00"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <CampoSimple
                  label="Comodato"
                  value={form.comodato}
                  onChange={(v) => actualizarCampo(codigo, "comodato", v)}
                  disabled={soloLectura}
                  placeholder="-"
                />
                <CampoSimple
                  label="Observaciones externas"
                  value={form.observaciones_externas}
                  onChange={(v) => actualizarCampo(codigo, "observaciones_externas", v)}
                  disabled={soloLectura}
                  placeholder="Notas adicionales sobre el proveedor..."
                />
              </div>

              {/* Empresa — solo Seguimiento la reasigna */}
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Empresa</label>
                <select
                  value={form.empresa_id}
                  disabled={!esSeguimiento || soloLectura || cargandoEmpresas}
                  onChange={(e) => {
                    const emp = empresas.find((em) => String(em.id) === e.target.value);
                    actualizarCampo(codigo, "empresa_id", e.target.value);
                    actualizarCampo(codigo, "empresa_nombre", emp?.razonSocial || "");
                  }}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
                >
                  <option value="">{cargandoEmpresas ? "Cargando empresas..." : "Selecciona empresa..."}</option>
                  {empresas.map((em) => (
                    <option key={em.id} value={em.id}>{em.razonSocial}</option>
                  ))}
                </select>
              </div>
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
                      form.tipo_envio === "ENTIDAD"
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
                      form.tipo_envio === "AGENCIA"
                        ? "bg-[#4F46E5] text-white border-[#4F46E5]"
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    AGENCIA
                  </button>
                </div>
              </div>

              {/* Campos que SOLO aparecen si es AGENCIA */}
              {form.tipo_envio === "AGENCIA" ? (
                <div className="space-y-3">
                  {renderBuscadorTransporte()}
                  <CampoSimple
                    label="Precio flete"
                    value={form.precio_flete}
                    onChange={(v) => actualizarCampo(codigo, "precio_flete", v)}
                    disabled={soloLectura}
                    placeholder="0.00"
                  />
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Observaciones transporte</label>
                    <textarea
                      value={form.observaciones_transporte}
                      disabled={soloLectura}
                      placeholder="Nota específica para el transportista..."
                      onChange={(e) => actualizarCampo(codigo, "observaciones_transporte", e.target.value)}
                      rows={6}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y min-h-[140px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400">Selecciona el tipo de envío para este producto.</p>
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
                  value={form.observaciones}
                  disabled={soloLectura}
                  placeholder="Cualquier detalle adicional para seguimiento..."
                  onChange={(e) => actualizarCampo(codigo, "observaciones", e.target.value)}
                  rows={4}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Otras observaciones</label>
                <textarea
                  value={form.otras_observaciones}
                  disabled={soloLectura}
                  placeholder="Cualquier otra nota general para la OP..."
                  onChange={(e) => actualizarCampo(codigo, "otras_observaciones", e.target.value)}
                  rows={4}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>
            </div>

            {/* 4. Fotos y documentos */}
            <div className="rounded-xl border border-slate-200 border-l-4 border-l-[#4F46E5] bg-slate-50/40 p-4 space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
                <div className="w-7 h-7 rounded-lg bg-[#4F46E5]/10 flex items-center justify-center shrink-0 text-[#4F46E5]">
                  <FileText size={14} />
                </div>
                <p className="text-[13px] font-bold text-[#4F46E5]">4. Fotos y documentos</p>
              </div>
              {renderSelectorImagenes()}
              {pdfConsolidadoUrl && !(esSeguimiento && (estado === "confirmado" || estado === "subido")) && (
                <a
                  href={pdfConsolidadoUrl}
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
        </div>

        {/* Footer fijo de acciones */}
        <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-between gap-4 flex-wrap z-20">
          <div className="flex items-center gap-2 min-w-0">
            {faltantes.length > 0 && !soloLectura ? (
              <>
                <AlertTriangle size={16} className="text-amber-500 shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-700">Acciones requeridas</p>
                  <p className="text-[11px] text-slate-400 truncate">Faltan: {faltantes.join(", ")}</p>
                </div>
              </>
            ) : estado === "confirmado" ? (
              <p className="text-[11px] text-[#4F46E5] flex items-center gap-1">
                <ShieldCheck size={13} /> Confirmado por seguimiento{confirmadoPor ? ` (${confirmadoPor})` : ""}
              </p>
            ) : estado === "subido" ? (
              <p className="text-[11px] text-emerald-700 flex items-center gap-1">
                <CheckCircle2 size={13} /> Ya subido al ERP
              </p>
            ) : estado === "preview" && rellenadoPor ? (
              <p className="text-[11px] text-amber-600">Enviado por {rellenadoPor}</p>
            ) : (
              <p className="text-[11px] text-slate-400">Completa la información obligatoria para continuar</p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Ventas: pendiente/preview -> enviar */}
            {!esSeguimiento && (estado === "pendiente" || estado === "preview") && onEnviarParaRevision && (
              <button
                onClick={onEnviarParaRevision}
                disabled={guardando}
                className="flex items-center gap-2 bg-[#10172A] text-white font-medium rounded-lg px-5 py-2.5 text-sm disabled:opacity-40 hover:bg-[#1B2438] transition-colors"
              >
                {guardando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {estado === "preview" ? "Actualizar y reenviar" : "Enviar para revisión"}
              </button>
            )}

            {/* Seguimiento: preview -> guardar + confirmar */}
            {esSeguimiento && estado === "preview" && (
              <>
                {onGuardarCambios && (
                  <button
                    onClick={onGuardarCambios}
                    disabled={guardando || confirmando}
                    className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 font-medium rounded-lg px-4 py-2.5 text-sm disabled:opacity-40 hover:bg-slate-50 transition-colors"
                  >
                    {guardando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Guardar cambios
                  </button>
                )}
                {onConfirmar && (
                  <button
                    onClick={onConfirmar}
                    disabled={confirmando}
                    className="flex items-center gap-2 bg-emerald-600 text-white font-medium rounded-lg px-5 py-2.5 text-sm disabled:opacity-40 hover:bg-emerald-700 transition-colors"
                  >
                    {confirmando ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                    Confirmado por seguimiento
                  </button>
                )}
              </>
            )}

            {/* Seguimiento: confirmado/subido -> guardar + actualizar ERP */}
            {esSeguimiento && (estado === "confirmado" || estado === "subido") && (
              <>
                {onGuardarCambios && (
                  <button
                    onClick={onGuardarCambios}
                    disabled={guardando || actualizandoErp}
                    className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 font-medium rounded-lg px-4 py-2.5 text-sm disabled:opacity-40 hover:bg-slate-50 transition-colors"
                  >
                    {guardando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                    Guardar cambios
                  </button>
                )}
                {onActualizarErp && (
                  <button
                    onClick={onActualizarErp}
                    disabled={actualizandoErp}
                    className="flex items-center gap-2 bg-indigo-600 text-white font-medium rounded-lg px-5 py-2.5 text-sm disabled:opacity-40 hover:bg-indigo-700 transition-colors"
                  >
                    {actualizandoErp ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Actualizar ERP
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}



function CampoSimple({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
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