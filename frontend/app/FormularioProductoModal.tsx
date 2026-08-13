"use client";

import { useState } from "react";
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

  // Documentos (OCE/OCF) — para el visor lateral
  urlOce?: string | null;
  urlOcf?: string | null;

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
  urlOce,
  urlOcf,
}: Props) {
  const faltantes = faltantesDe(form);
  const [docActivo, setDocActivo] = useState<"oce" | "ocf">("oce");

  // Click en el tipo ya seleccionado = deseleccionar (vuelve a "sin elegir")
  const elegirTipoEnvio = (tipo: "ENTIDAD" | "AGENCIA") => {
    if (soloLectura) return;
    if (form.tipo_envio === tipo) {
      actualizarCampo(codigo, "tipo_envio", "");
      return;
    }
    actualizarCampo(codigo, "tipo_envio", tipo);
    actualizarCampo(codigo, "observaciones", tipo === "AGENCIA" ? TEXTO_OBS_AGENCIA : TEXTO_OBS_ENTIDAD);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onCerrar} />
      <div className="relative w-full max-w-[1800px] h-[92vh] overflow-hidden bg-white rounded-2xl shadow-2xl flex flex-col">
        {/* Header */}
          <div className="shrink-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between gap-3 z-10">
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-slate-900 truncate">{nombreProducto || codigo}</p>
            <p className="text-xs font-semibold text-slate-800 leading-snug">{descripcionProducto}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {cantidad != null && (
              <div className="flex items-center gap-1.5 bg-[#4F46E5] text-white rounded-full pl-3 pr-3.5 py-1.5 shadow-sm shadow-indigo-200">
                <Package size={14} className="shrink-0" />
                <span className="text-sm font-bold whitespace-nowrap leading-none">
                  {cantidad} {unidadMedida}
                </span>
              </div>
            )}
            <button onClick={onCerrar} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 shrink-0">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex flex-col xl:flex-row gap-3 p-5 overflow-hidden">
          {/* Columna izquierda: el formulario, con SU PROPIO scroll
              interno — así el visor de al lado puede estirarse a todo
              el alto del modal sin verse afectado por el largo del
              formulario. */}
          <div className="flex-1 min-w-0 overflow-y-auto pr-1">
            {/* ===== Formulario: mismas 2 columnas de siempre ===== */}
            <div className="flex flex-col lg:flex-row gap-3 items-stretch">
              {/* ===== Columna izquierda: 1. Proveedor + 3. Observaciones ===== */}
              <div className="flex flex-col gap-3 w-full lg:w-1/2">
                {/* 1. Información del proveedor */}
                <div className="rounded-xl border border-slate-200 border-l-4 border-l-[#4F46E5] bg-slate-50/40 p-3.5 space-y-2.5">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
                    <div className="w-6 h-6 rounded-lg bg-[#4F46E5]/10 flex items-center justify-center shrink-0 text-[#4F46E5]">
                      <Package size={13} />
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
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
                    >
                      <option value="">{cargandoEmpresas ? "Cargando empresas..." : "Selecciona empresa..."}</option>
                      {empresas.map((em) => (
                        <option key={em.id} value={em.id}>{em.razonSocial}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 3. Observaciones */}
                <div className="flex-1 flex flex-col rounded-xl border border-slate-200 border-l-4 border-l-violet-400 bg-slate-50/40 p-3.5 space-y-2.5">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
                    <div className="w-6 h-6 rounded-lg bg-violet-100 flex items-center justify-center shrink-0 text-violet-600">
                      <MessageSquareText size={13} />
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
                      rows={3}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                    <div className="flex-1 flex flex-col">
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Otras observaciones</label>
                    <textarea
                      value={form.otras_observaciones}
                      disabled={soloLectura}
                      placeholder="Cualquier otra nota general para la OP..."
                      onChange={(e) => actualizarCampo(codigo, "otras_observaciones", e.target.value)}
                      className="flex-1 w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500 min-h-[70px]"
                    />
                  </div>
                </div>
              </div>

              {/* ===== Columna derecha: 2. Tipo de envío + 4. Fotos ===== */}
              <div className="flex flex-col gap-3 w-full lg:w-1/2">
                {/* 2. Tipo de envío */}
                <div className="rounded-xl border border-slate-200 border-l-4 border-l-amber-400 bg-slate-50/40 p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-amber-100 flex items-center justify-center shrink-0 text-amber-600">
                        <Building2 size={13} />
                      </div>
                      <p className="text-[13px] font-bold text-amber-700">2. Tipo de envío</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => elegirTipoEnvio("ENTIDAD")}
                        disabled={soloLectura}
                        title={form.tipo_envio === "ENTIDAD" ? "Click para deseleccionar" : undefined}
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
                        title={form.tipo_envio === "AGENCIA" ? "Click para deseleccionar" : undefined}
                        className={`px-3 py-1 rounded-full text-[11px] font-bold border transition-colors disabled:opacity-40 ${
                          form.tipo_envio === "AGENCIA"
                            ? "bg-[#4F46E5] text-white border-[#4F46E5]"
                            : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        AGENCIA
                      </button>
                      {form.tipo_envio && !soloLectura && (
                        <button
                          type="button"
                          onClick={() => actualizarCampo(codigo, "tipo_envio", "")}
                          title="Limpiar selección"
                          className="w-6 h-6 flex items-center justify-center rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  </div>

                  {form.tipo_envio === "AGENCIA" ? (
                    <div className="space-y-2.5">
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
                          rows={3}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-y min-h-[80px] focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
                        />
                      </div>
                    </div>
                  ) : form.tipo_envio === "ENTIDAD" ? (
                    <div className="flex items-center gap-2 rounded-lg bg-amber-50/60 border border-dashed border-amber-200 px-3 py-2.5">
                      <CheckCircle2 size={14} className="text-amber-500 shrink-0" />
                      <p className="text-[11px] text-amber-700">
                        Envío directo a la entidad. No requiere agencia de transporte.
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg bg-slate-100/60 border border-dashed border-slate-200 px-3 py-2.5">
                      <AlertTriangle size={14} className="text-slate-400 shrink-0" />
                      <p className="text-[11px] text-slate-400">
                        Selecciona ENTIDAD o AGENCIA para continuar.
                      </p>
                    </div>
                  )}
                </div>

                {/* 4. Fotos y documentos */}
                <div className="flex-1 flex flex-col rounded-xl border border-slate-200 border-l-4 border-l-[#4F46E5] bg-slate-50/40 p-3.5 space-y-2.5">
                  <div className="flex items-center gap-2 pb-1.5 border-b border-slate-200">
                    <div className="w-6 h-6 rounded-lg bg-[#4F46E5]/10 flex items-center justify-center shrink-0 text-[#4F46E5]">
                      <FileText size={13} />
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
          </div>

          {/* ===== Visor de documentos OCE (OCAM) / OCF (Física) =====
              Ocupa TODO el alto disponible del modal (h-full, dentro de
              un padre con altura fija) y es más ancho para leer mejor.
              Solo se muestra si el padre (OpsDrawer.tsx) envía al menos
              una de las dos URLs. */}
          {(urlOce || urlOcf) && (
            <div className="w-full xl:w-[600px] shrink-0 h-full">
              <VisorDocumentos
                docActivo={docActivo}
                onCambiarDoc={setDocActivo}
                urlOce={urlOce ?? null}
                urlOcf={urlOcf ?? null}
                nombreOce={urlOce ? nombreDesdeUrl(urlOce) : null}
                nombreOcf={urlOcf ? nombreDesdeUrl(urlOcf) : null}
              />
            </div>
          )}
        </div>

        {/* Footer fijo de acciones */}
        <div className="shrink-0 bg-white border-t border-slate-200 px-6 py-4 flex items-center justify-between gap-4 flex-wrap z-20">
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

/* ============================================================
   Visor de documentos — pestañas OCE / OCF con iframe de PDF.
   Copiado del mismo componente que ya usas en CrearOrdenModal.tsx,
   con el alto ajustado para vivir dentro de este modal centrado
   (max-h-[92vh]) en vez de a pantalla completa.
   ============================================================ */
export function nombreDesdeUrl(url: string): string {
  try {
    const limpio = url.split("?")[0].split("#")[0];
    const partes = limpio.split("/");
    return decodeURIComponent(partes[partes.length - 1] || url);
  } catch {
    return url;
  }
}

export function VisorDocumentos({
  docActivo,
  onCambiarDoc,
  urlOce,
  urlOcf,
  nombreOce,
  nombreOcf,
}: {
  docActivo: "oce" | "ocf";
  onCambiarDoc: (d: "oce" | "ocf") => void;
  urlOce: string | null;
  urlOcf: string | null;
  nombreOce: string | null;
  nombreOcf: string | null;
}) {
  const urlActiva = docActivo === "oce" ? urlOce : urlOcf;
  const nombreActivo = docActivo === "oce" ? nombreOce : nombreOcf;

  return (
    <div className="h-full bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col">
      <div className="flex items-center border-b border-slate-200 shrink-0">
        <button
          type="button"
          onClick={() => onCambiarDoc("oce")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition-colors ${
            docActivo === "oce"
              ? "text-[#4F46E5] border-b-2 border-[#4F46E5] bg-indigo-50/40"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <FileText size={13} /> OCE (OCAM)
        </button>
        <button
          type="button"
          onClick={() => onCambiarDoc("ocf")}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-semibold transition-colors ${
            docActivo === "ocf"
              ? "text-[#4F46E5] border-b-2 border-[#4F46E5] bg-indigo-50/40"
              : "text-slate-400 hover:text-slate-600"
          }`}
        >
          <FileText size={13} /> OCF (Física)
        </button>
      </div>

      {nombreActivo && (
        <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-[11px] text-slate-500 truncate shrink-0">
          {nombreActivo}
        </div>
      )}

      <div className="flex-1 min-h-0 bg-slate-100">
        {urlActiva ? (
          <iframe
            src={`${urlActiva}#navpanes=0&toolbar=0&statusbar=0`}
            className="w-full h-full"
            title={docActivo === "oce" ? "Vista OCE" : "Vista OCF"}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-2 text-slate-400">
            <FileText size={22} />
            <p className="text-xs">
              Aún no hay {docActivo === "oce" ? "OCE" : "OCF"} cargado.
              <br />
              Sube un archivo o espera la carga automática.
            </p>
          </div>
        )}
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
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
      />
    </div>
  );
}