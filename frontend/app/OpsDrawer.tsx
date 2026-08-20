"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react";
import {
  X, Loader2, ChevronRight, ChevronUp, ChevronDown, Truck, Package, CheckCircle2, Clock,
  AlertTriangle, Send, ArrowLeft, ImagePlus, MessageSquareText, ShieldCheck, FileText, RefreshCw, Plus,
} from "lucide-react";
import { VentaErp, OpResumen, ocamDe, codigoVentaDe, montoDe } from "./TabVentasErp";
import { EmpresaOption, listarEmpresas, contactosDeProveedor, crearContactoProveedor, ContactoProveedor, calcularMargen } from "./erp-shared";

import FormularioProductoModal, { VisorDocumentos, nombreDesdeUrl } from "./FormularioProductoModal";

import FormularioBloqueModal from "./FormularioBloqueModal";

const API_BASE = process.env.NEXT_PUBLIC_HELBOT_API || "http://localhost:4001";

interface Props {
  venta: VentaErp | null;
  onClose: () => void;
  usuarioActual: string;
  esSeguimiento: boolean;
  tick?: number;
  ultimoEventoOps?: { tipo: string; orden_compra_id?: number } | null;
}

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

// Trae proveedores y transportes del ERP una sola vez al abrir el
// drawer (se comparte entre ListaOps/DetalleOp/FormularioCrearProveedor
// vía props, para no repetir el fetch por cada producto).
function useCatalogosErp() {
  const [proveedores, setProveedores] = useState<ProveedorOption[]>([]);
  const [transportes, setTransportes] = useState<TransporteOption[]>([]);
  const [cargandoProveedores, setCargandoProveedores] = useState(false);
  const [cargandoTransportes, setCargandoTransportes] = useState(false);

  useEffect(() => {
    setCargandoProveedores(true);
    fetch(`${API_BASE}/erp/proveedores`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setProveedores(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setCargandoProveedores(false));

    setCargandoTransportes(true);
    fetch(`${API_BASE}/erp/transportes`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setTransportes(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setCargandoTransportes(false));
  }, []);

  // Inserta el proveedor/transporte recién creado al inicio de la lista,
  // sin tener que refrescar todo el catálogo desde el ERP.
  const agregarProveedor = useCallback((nuevo: ProveedorOption) => {
    setProveedores((prev) => [nuevo, ...prev]);
  }, []);

  const agregarTransporte = useCallback((nuevo: TransporteOption) => {
    setTransportes((prev) => [nuevo, ...prev]);
  }, []);

  return { proveedores, transportes, cargandoProveedores, cargandoTransportes, agregarProveedor, agregarTransporte };
}
// Input de texto + dropdown de resultados filtrados — funciona igual
// para proveedores que para transportes, según el tipo T que le pases.
function BuscadorEntidad<T extends { id: number; razonSocial: string; ruc?: string; telefono?: string | null; cobertura?: string | null; distrito?: string | null; departamento?: string | null; provincia?: string | null; direccion?: string | null }>({
  label,
  value,
  onChange,
  onSeleccionar,
  onLimpiarExtra,
  opciones,
  cargando,
  disabled,
  placeholder,
  seleccionado,
  onCrearNuevo,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onSeleccionar: (item: T) => void;
  /** Callback opcional para limpiar campos derivados (ej. teléfono
   * autocompletado) cuando el usuario quita la selección. */
  onLimpiarExtra?: () => void;
  opciones: T[];
  cargando: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** El item completo actualmente seleccionado — para mostrar sus
   * datos extra (RUC, ubicación, dirección) debajo del input y para
   * resaltarlo en la lista del dropdown. */
  seleccionado?: T | null;
  /** Si viene, muestra "+ Nuevo" junto al label para abrir el modal de
   * creación (proveedor o agencia, según quién use este componente). */
  onCrearNuevo?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const limpiar = () => {
    onChange("");
    onLimpiarExtra?.();
    setOpen(false);
  };

  // Busca coincidencia en cualquiera de estos campos, no solo en el
  // nombre — así "20601786355" o "Ayacucho" también encuentran resultados.
  const query = value.trim().toLowerCase();
  const filtradas = query
    ? opciones
        .filter((o) =>
          [o.razonSocial, o.ruc, o.telefono, o.cobertura, o.distrito, o.departamento, o.provincia, o.direccion]
            .filter(Boolean)
            .some((campo) => String(campo).toLowerCase().includes(query))
        )
        .slice(0, 30)
    : opciones.slice(0, 30);

  const ubicacionDe = (o: T) =>
    [o.departamento, o.provincia, o.distrito].filter(Boolean).join(" / ");

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center justify-between mb-1">
        <label className="block text-[11px] font-medium text-slate-500">{label}</label>
        {onCrearNuevo && !disabled && (
          <button
            type="button"
            onClick={onCrearNuevo}
            className="flex items-center gap-0.5 text-[10px] font-semibold text-[#4F46E5] hover:text-indigo-800"
          >
            <Plus size={11} /> Nuevo
          </button>
        )}
      </div>
      <div className="relative">
        <input
          type="text"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={limpiar}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-slate-200 hover:bg-rose-200 text-slate-500 hover:text-rose-700 flex items-center justify-center transition-colors"
            aria-label="Quitar selección"
            title="Quitar selección"
          >
            <X size={10} />
          </button>
        )}
      </div>

      {/* Datos extra del seleccionado: RUC + ubicación + dirección */}
      {seleccionado && !open && (
        <div className="mt-1.5 px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-100 space-y-0.5">
          <p className="text-[10px] text-slate-500 flex flex-wrap gap-x-2">
            {seleccionado.ruc && <span><b className="text-slate-600">RUC:</b> {seleccionado.ruc}</span>}
            {ubicacionDe(seleccionado) && <span><b className="text-slate-600">Ubicación:</b> {ubicacionDe(seleccionado)}</span>}
            {(seleccionado.cobertura && !ubicacionDe(seleccionado)) && <span><b className="text-slate-600">Cobertura:</b> {seleccionado.cobertura}</span>}
          </p>
          {seleccionado.direccion && (
            <p className="text-[10px] text-slate-500">
              <b className="text-slate-600">Dirección:</b> {seleccionado.direccion}
            </p>
          )}
        </div>
      )}

      {open && !disabled && (
        <div className="absolute z-30 mt-1 left-0 w-[420px] max-w-[85vw] bg-white rounded-xl border border-slate-100 shadow-xl overflow-hidden max-h-56 overflow-y-auto">
          {cargando ? (
            <p className="text-xs text-slate-400 text-center py-3 flex items-center justify-center gap-1.5">
              <Loader2 size={12} className="animate-spin" /> Cargando...
            </p>
          ) : filtradas.length === 0 ? (
            <p className="text-xs text-slate-300 text-center py-3">Sin resultados</p>
          ) : (
            filtradas.map((o) => {
              const estaSeleccionado = seleccionado?.id === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => {
                    onSeleccionar(o);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 transition-colors ${
                    estaSeleccionado ? "bg-indigo-50 border-l-2 border-l-[#4F46E5]" : "hover:bg-blue-50"
                  }`}
                >
                  <p className={`text-xs font-medium break-words flex items-center gap-1.5 ${estaSeleccionado ? "text-[#4F46E5]" : "text-slate-700"}`}>
                    {o.razonSocial}
                    {estaSeleccionado && <CheckCircle2 size={11} className="text-[#4F46E5] shrink-0" />}
                  </p>
                  <p className="text-[10px] text-slate-400 break-words">
                    {[o.ruc, ubicacionDe(o) || o.cobertura].filter(Boolean).join(" · ")}
                  </p>
                  {o.direccion && (
                    <p className="text-[10px] text-slate-400 break-words italic">{o.direccion}</p>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}


// Muestra nombre + teléfono del contacto del proveedor ya seleccionado
// — se dispara automáticamente cuando cambia proveedorId (GET
// /erp/proveedores/{id}/contactos, que a su vez pega a
// /api/contacts/provider/{id} del ERP real).
function ContactoProveedorInfo({ proveedorId }: { proveedorId: number | null }) {
  const [contactos, setContactos] = useState<ContactoProveedor[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (!proveedorId) {
      setContactos([]);
      return;
    }
    setCargando(true);
    contactosDeProveedor(proveedorId)
      .then((r) => setContactos(r.data || []))
      .catch(() => setContactos([]))
      .finally(() => setCargando(false));
  }, [proveedorId]);

  if (!proveedorId) return null;

  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2 space-y-1">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Contacto del proveedor</p>
      {cargando ? (
        <p className="text-[11px] text-slate-400 flex items-center gap-1">
          <Loader2 size={10} className="animate-spin" /> Cargando...
        </p>
      ) : contactos.length === 0 ? (
        <p className="text-[11px] text-slate-400">Sin contactos registrados para este proveedor</p>
      ) : (
        contactos.map((c) => (
          <p key={c.id} className="text-[11px] text-slate-600">
            <b className="text-slate-700">{c.nombre}</b>
            {c.cargo ? ` · ${c.cargo}` : ""} — {c.telefono || "sin teléfono"}
          </p>
        ))
      )}
    </div>
  );
}



// ============================================================
// Ubigeo (departamento/provincia/distrito) para los modales de
// creación de proveedor/agencia — cascada igual que en el ERP real.
// ============================================================
interface UbigeoOption { id: string; name: string }

function useUbigeo() {
  const [departamentos, setDepartamentos] = useState<UbigeoOption[]>([]);
  const [provincias, setProvincias] = useState<UbigeoOption[]>([]);
  const [distritos, setDistritos] = useState<UbigeoOption[]>([]);
  const [cargandoProvincias, setCargandoProvincias] = useState(false);
  const [cargandoDistritos, setCargandoDistritos] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/erp/ubigeo/departamentos`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setDepartamentos(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const cargarProvincias = useCallback((region: string) => {
    setProvincias([]);
    setDistritos([]);
    if (!region) return;
    setCargandoProvincias(true);
    fetch(`${API_BASE}/erp/ubigeo/provincias?region=${encodeURIComponent(region)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setProvincias(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setCargandoProvincias(false));
  }, []);

  const cargarDistritos = useCallback((province: string) => {
    setDistritos([]);
    if (!province) return;
    setCargandoDistritos(true);
    fetch(`${API_BASE}/erp/ubigeo/distritos?province=${encodeURIComponent(province)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setDistritos(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setCargandoDistritos(false));
  }, []);

  return { departamentos, provincias, distritos, cargandoProvincias, cargandoDistritos, cargarProvincias, cargarDistritos };
}

function SelectorUbigeo({
  departamentoId,
  provinciaId,
  distritoId,
  onCambiar,
}: {
  departamentoId: string;
  provinciaId: string;
  distritoId: string;
  onCambiar: (campo: "departamentoId" | "provinciaId" | "distritoId", valor: string) => void;
}) {
  const { departamentos, provincias, distritos, cargandoProvincias, cargandoDistritos, cargarProvincias, cargarDistritos } = useUbigeo();

  return (
    <div className="grid grid-cols-3 gap-3">
      <div>
        <label className="block text-[11px] font-medium text-slate-500 mb-1">Departamento</label>
        <select
          value={departamentoId}
          onChange={(e) => {
            onCambiar("departamentoId", e.target.value);
            onCambiar("provinciaId", "");
            onCambiar("distritoId", "");
            cargarProvincias(e.target.value);
          }}
          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
          <option value="">Selecciona...</option>
          {departamentos.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-medium text-slate-500 mb-1">Provincia</label>
        <select
          value={provinciaId}
          disabled={!departamentoId || cargandoProvincias}
          onChange={(e) => { onCambiar("provinciaId", e.target.value); onCambiar("distritoId", ""); cargarDistritos(e.target.value); }}
          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
          <option value="">{cargandoProvincias ? "Cargando..." : "Selecciona..."}</option>
          {provincias.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-medium text-slate-500 mb-1">Distrito</label>
        <select
          value={distritoId}
          disabled={!provinciaId || cargandoDistritos}
          onChange={(e) => onCambiar("distritoId", e.target.value)}
          className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-sm disabled:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
          <option value="">{cargandoDistritos ? "Cargando..." : "Selecciona..."}</option>
          {distritos.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>
    </div>
  );
}

// ============================================================
// Modal: crear proveedor nuevo (POST /erp/proveedores)
// ============================================================
function ModalCrearProveedor({
  onCerrar,
  onCreado,
}: {
  onCerrar: () => void;
  onCreado: (nuevo: ProveedorOption) => void;
}) {
  const [ubigeo, setUbigeo] = useState({ departamentoId: "", provinciaId: "", distritoId: "" });
  const [nombresUbigeo, setNombresUbigeo] = useState({ departamento: "", provincia: "", distrito: "" });
  const [form, setForm] = useState({
    ruc: "", razonSocial: "", telefono: "", email: "", direccion: "", banco: "", numeroCuenta: "",
  });
  const [crearContactoTambien, setCrearContactoTambien] = useState(false);
  const [contacto, setContacto] = useState({ nombre: "", cargo: "", telefono: "", email: "" });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const set = (campo: keyof typeof form, valor: string) => setForm((f) => ({ ...f, [campo]: valor }));

  useEffect(() => {
      function onKeyDown(e: KeyboardEvent) {
        if (e.key === "Escape") onCerrar();
      }
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [onCerrar]);

  const guardar = async () => {
    if (!form.ruc.trim() || !form.razonSocial.trim()) {
      setError("RUC y Razón social son obligatorios.");
      return;
    }
    setGuardando(true);
    setError("");
    try {
      const r = await fetch(`${API_BASE}/erp/proveedores`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruc: form.ruc.trim(),
          razonSocial: form.razonSocial.trim(),
          telefono: form.telefono || null,
          email: form.email || null,
          departamento: nombresUbigeo.departamento || null,
          provincia: nombresUbigeo.provincia || null,
          distrito: nombresUbigeo.distrito || null,
          direccion: form.direccion || null,
          cuentasBancarias: form.banco && form.numeroCuenta
            ? [{ tipoCuenta: "corriente", banco: form.banco, numeroCuenta: form.numeroCuenta }]
            : [],
        }),
      });
    if (!r.ok) throw new Error((await r.json()).detail || "Error creando el proveedor");
      const nuevoProveedor = await r.json();
      onCreado(nuevoProveedor);
      if (crearContactoTambien && contacto.nombre.trim()) {
        try {
          await crearContactoProveedor(nuevoProveedor.id, {
            nombre: contacto.nombre.trim(),
            cargo: contacto.cargo || undefined,
            telefono: contacto.telefono || undefined,
            email: contacto.email || undefined,
          });
        } catch (eContacto) {
          console.error("Proveedor creado, pero falló el contacto:", eContacto);
        }
      }
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onCerrar} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-slate-800">Nuevo proveedor</p>
          <button onClick={onCerrar} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="RUC" value={form.ruc} onChange={(v) => set("ruc", v)} tipo="entero" maxLength={11} placeholder="20458721598" />
          <Campo label="Razón social" value={form.razonSocial} onChange={(v) => set("razonSocial", v)} />
          <Campo label="Teléfono" value={form.telefono} onChange={(v) => set("telefono", v)} tipo="telefono" />
          <Campo label="Correo" value={form.email} onChange={(v) => set("email", v)} />
        </div>

        <SelectorUbigeo
          {...ubigeo}
          onCambiar={(campo, valor) => {
            setUbigeo((u) => ({ ...u, [campo]: valor }));
          }}
        />
        {/* Guarda también el nombre legible (no solo el id) — el ERP guarda texto libre en departamento/provincia/distrito */}
        <UbigeoNombresListener ubigeo={ubigeo} onNombres={setNombresUbigeo} />

        <Campo label="Dirección" value={form.direccion} onChange={(v) => set("direccion", v)} />

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Banco (opcional)" value={form.banco} onChange={(v) => set("banco", v)} />
          <Campo label="N° cuenta (opcional)" value={form.numeroCuenta} onChange={(v) => set("numeroCuenta", v)} />
        </div>

        <div className="pt-2 border-t border-slate-100">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600 mb-2">
            <input type="checkbox" checked={crearContactoTambien} onChange={(e) => setCrearContactoTambien(e.target.checked)} />
            Agregar contacto de este proveedor (opcional)
          </label>
          {crearContactoTambien && (
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Nombre contacto" value={contacto.nombre} onChange={(v) => setContacto((c) => ({ ...c, nombre: v }))} />
              <Campo label="Cargo" value={contacto.cargo} onChange={(v) => setContacto((c) => ({ ...c, cargo: v }))} />
              <Campo label="Teléfono contacto" value={contacto.telefono} onChange={(v) => setContacto((c) => ({ ...c, telefono: v }))} tipo="telefono" />
              <Campo label="Correo contacto" value={contacto.email} onChange={(v) => setContacto((c) => ({ ...c, email: v }))} />
            </div>
          )}
        </div>

        {error && <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertTriangle size={11} /> {error}</p>}

        <button
          onClick={guardar}
          disabled={guardando}
          className="w-full flex items-center justify-center gap-2 bg-[#10172A] text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-40 hover:bg-[#1B2438] transition-colors"
        >
          {guardando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Guardar proveedor
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Modal: crear agencia de transporte (POST /erp/transportes)
// ============================================================
function ModalCrearTransporte({
  onCerrar,
  onCreado,
}: {
  onCerrar: () => void;
  onCreado: (nuevo: TransporteOption) => void;
}) {
  const [ubigeo, setUbigeo] = useState({ departamentoId: "", provinciaId: "", distritoId: "" });
  const [nombresUbigeo, setNombresUbigeo] = useState({ departamento: "", provincia: "", distrito: "" });
  const [form, setForm] = useState({
    ruc: "", razonSocial: "", telefono: "", email: "", cobertura: "", direccion: "",
    numCuentaDetracciones: "", banco: "", numeroCuenta: "",
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const set = (campo: keyof typeof form, valor: string) => setForm((f) => ({ ...f, [campo]: valor }));


  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCerrar]);

  const guardar = async () => {
    if (!form.ruc.trim() || !form.razonSocial.trim()) {
      setError("RUC y Razón social son obligatorios.");
      return;
    }
    setGuardando(true);
    setError("");
    try {
      const r = await fetch(`${API_BASE}/erp/transportes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ruc: form.ruc.trim(),
          razonSocial: form.razonSocial.trim(),
          telefono: form.telefono || null,
          email: form.email || null,
          cobertura: form.cobertura || null,
          departamento: nombresUbigeo.departamento || null,
          provincia: nombresUbigeo.provincia || null,
          distrito: nombresUbigeo.distrito || null,
          direccion: form.direccion || null,
          numCuentaDetracciones: form.numCuentaDetracciones || null,
          cuentasBancarias: form.banco && form.numeroCuenta
            ? [{ tipoCuenta: "TRANSPORTE", banco: form.banco, numeroCuenta: form.numeroCuenta }]
            : [],
        }),
      });
      if (!r.ok) throw new Error((await r.json()).detail || "Error creando la agencia de transporte");
      onCreado(await r.json());
      onCerrar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onCerrar} />
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-slate-800">Nueva agencia de transporte</p>
          <button onClick={onCerrar} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Campo label="RUC" value={form.ruc} onChange={(v) => set("ruc", v)} tipo="entero" maxLength={11} placeholder="90000000000" />
          <Campo label="Razón social" value={form.razonSocial} onChange={(v) => set("razonSocial", v)} />
          <Campo label="Teléfono" value={form.telefono} onChange={(v) => set("telefono", v)} tipo="telefono" />
          <Campo label="Correo" value={form.email} onChange={(v) => set("email", v)} />
          <Campo label="Cobertura" value={form.cobertura} onChange={(v) => set("cobertura", v)} placeholder="Ej. Nacional, Lima y provincias..." />
          <Campo label="N° cuenta detracciones (opcional)" value={form.numCuentaDetracciones} onChange={(v) => set("numCuentaDetracciones", v)} />
        </div>

        <SelectorUbigeo
          {...ubigeo}
          onCambiar={(campo, valor) => setUbigeo((u) => ({ ...u, [campo]: valor }))}
        />
        <UbigeoNombresListener ubigeo={ubigeo} onNombres={setNombresUbigeo} />

        <Campo label="Dirección" value={form.direccion} onChange={(v) => set("direccion", v)} />

        <div className="grid grid-cols-2 gap-3">
          <Campo label="Banco (opcional)" value={form.banco} onChange={(v) => set("banco", v)} />
          <Campo label="N° cuenta (opcional)" value={form.numeroCuenta} onChange={(v) => set("numeroCuenta", v)} />
        </div>

        {error && <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertTriangle size={11} /> {error}</p>}

        <button
          onClick={guardar}
          disabled={guardando}
          className="w-full flex items-center justify-center gap-2 bg-[#10172A] text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-40 hover:bg-[#1B2438] transition-colors"
        >
          {guardando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          Guardar agencia
        </button>
      </div>
    </div>
  );
}

// Traduce los ids de departamento/provincia/distrito elegidos a sus
// nombres legibles (el ERP guarda texto libre, no ids) — se resuelve
// pidiendo de nuevo la lista de provincias/distritos con esos ids.
function UbigeoNombresListener({
  ubigeo,
  onNombres,
}: {
  ubigeo: { departamentoId: string; provinciaId: string; distritoId: string };
  onNombres: (n: { departamento: string; provincia: string; distrito: string }) => void;
}) {
  useEffect(() => {
    let cancelado = false;
    async function resolver() {
      let departamento = "";
      let provincia = "";
      let distrito = "";
      if (ubigeo.departamentoId) {
        const r = await fetch(`${API_BASE}/erp/ubigeo/departamentos`).then((r) => (r.ok ? r.json() : []));
        departamento = (r as UbigeoOption[]).find((d) => d.id === ubigeo.departamentoId)?.name || "";
      }
      if (ubigeo.provinciaId) {
        const r = await fetch(`${API_BASE}/erp/ubigeo/provincias?region=${ubigeo.departamentoId}`).then((r) => (r.ok ? r.json() : []));
        provincia = (r as UbigeoOption[]).find((p) => p.id === ubigeo.provinciaId)?.name || "";
      }
      if (ubigeo.distritoId) {
        const r = await fetch(`${API_BASE}/erp/ubigeo/distritos?province=${ubigeo.provinciaId}`).then((r) => (r.ok ? r.json() : []));
        distrito = (r as UbigeoOption[]).find((d) => d.id === ubigeo.distritoId)?.name || "";
      }
      if (!cancelado) onNombres({ departamento, provincia, distrito });
    }
    resolver();
    return () => { cancelado = true; };
  }, [ubigeo.departamentoId, ubigeo.provinciaId, ubigeo.distritoId]);
  return null;
}

// Estilo del badge de seguimiento (estado propio de Helbot, distinto al estadoOp del ERP)
function badgeSeguimiento(estado?: string) {
  switch (estado) {
    case "preview":
      return { texto: "Pendiente de revisión", clase: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock };
    case "confirmado":
      return { texto: "Formulario · Ya en el ERP", clase: "bg-violet-100 text-violet-700 border-violet-300", icon: ShieldCheck };
    case "subido":
      return { texto: "Llenado desde el formulario (en ERP)", clase: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 };
    default:
      return { texto: "Falta llenar datos", clase: "bg-slate-100 text-slate-500 border-slate-200", icon: Package };
  }
}


// ============================================================
// Toasts — notificaciones flotantes de éxito/error
// ============================================================
interface ToastItem {
  id: number;
  tipo: "success" | "error";
  mensaje: string;
}

function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const ultimoRef = useRef<{ mensaje: string; ts: number } | null>(null);

  const mostrarToast = useCallback((tipo: "success" | "error", mensaje: string) => {
    const ahora = Date.now();
    // Red de seguridad: si algún flujo en bloque llegara a disparar el
    // mismo mensaje dos veces casi al mismo tiempo, se ignora el
    // duplicado — el usuario debe ver UNA sola notificación por acción,
    // sin importar cuántos productos tenga el bloque.
    if (ultimoRef.current && ultimoRef.current.mensaje === mensaje && ahora - ultimoRef.current.ts < 500) {
      return;
    }
    ultimoRef.current = { mensaje, ts: ahora };
    const id = ahora + Math.random();
    setToasts((prev) => [...prev, { id, tipo, mensaje }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const cerrarToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, mostrarToast, cerrarToast };
}

function ToastContainer({ toasts, onCerrar }: { toasts: ToastItem[]; onCerrar: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[10000] flex flex-col gap-2.5 items-center pointer-events-none w-full px-4">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onCerrar={onCerrar} />
      ))}
    </div>
  );
}

// Toast individual: entra con slide + fade suave, y una barra inferior
// que se va vaciando — el usuario ve cuánto le queda antes de que se
// cierre solo. Solo íconos, sin emojis.
function ToastCard({ toast, onCerrar }: { toast: ToastItem; onCerrar: (id: number) => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  const esExito = toast.tipo === "success";

  return (
    <div
      className={`pointer-events-auto relative flex items-center gap-3 pl-4 pr-3 py-3.5 rounded-2xl shadow-2xl border bg-white/95 backdrop-blur-xl min-w-[300px] max-w-[420px] overflow-hidden transition-all duration-300 ease-out ${
        visible ? "opacity-100 translate-y-0 scale-100" : "opacity-0 -translate-y-3 scale-95"
      } ${esExito ? "border-emerald-200" : "border-red-200"}`}
    >
      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${esExito ? "bg-emerald-100" : "bg-red-100"}`}>
        {esExito ? (
          <CheckCircle2 size={18} className="text-emerald-600" />
        ) : (
          <AlertTriangle size={18} className="text-red-600" />
        )}
      </div>
      <p className="flex-1 text-[13px] font-semibold leading-snug text-slate-800">{toast.mensaje}</p>
      <button
        onClick={() => onCerrar(toast.id)}
        className="shrink-0 p-1 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors"
      >
        <X size={14} />
      </button>
      <div
        className={`absolute bottom-0 left-0 h-[3px] ${esExito ? "bg-emerald-400" : "bg-red-400"} transition-all ease-linear`}
        style={{ width: visible ? "0%" : "100%", transitionDuration: visible ? "4000ms" : "0ms" }}
      />
    </div>
  );
}

// Overlay "en progreso" — cubre toda la pantalla mientras se procesa
// una acción (individual o en bloque). Así el usuario nunca ve varios
// toasts sueltos ni puede cerrar el modal a medio guardar.
function OverlayProcesando({ mensaje }: { mensaje: string }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/70 backdrop-blur-md">
      <div className="flex flex-col items-center gap-4 px-8 py-7 rounded-2xl">
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-[3px] border-indigo-100" />
          <div className="absolute inset-0 rounded-full border-[3px] border-transparent border-t-[#4F46E5] border-r-[#4F46E5] animate-spin" />
          <div className="absolute inset-[10px] rounded-full bg-indigo-50 flex items-center justify-center">
            <ShieldCheck size={16} className="text-[#4F46E5]" />
          </div>
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-slate-800">{mensaje}</p>
          <p className="text-[11px] text-slate-400 mt-0.5">Esto tomará solo un momento…</p>
        </div>
      </div>
    </div>
  );
}


export default function OpsDrawer({ venta, onClose, usuarioActual, esSeguimiento, tick, ultimoEventoOps }: Props) {
  const [ops, setOps] = useState<OpResumen[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [opSeleccionada, setOpSeleccionada] = useState<number | null>(null);
  const { proveedores, transportes, cargandoProveedores, cargandoTransportes, agregarProveedor, agregarTransporte } = useCatalogosErp();

  const { toasts, mostrarToast, cerrarToast } = useToasts();

  const [mefData, setMefData] = useState<any>(null);
  const [mefCargando, setMefCargando] = useState(false);
  const [mefError, setMefError] = useState("");

  const consultarMef = useCallback(async () => {
    const secEjec = (venta as any)?.cliente?.codigoUnidadEjecutora;
    const expediente = (venta as any)?.siaf;
    if (!secEjec || !expediente) return;
    setMefCargando(true);
    setMefError("");
    setMefData(null);
    try {
      const r = await fetch(`${API_BASE}/mef/consultar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sec_ejec: String(secEjec), expediente: String(expediente) }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(body?.detail?.error || body?.error || "No se pudo consultar el MEF");
      setMefData(body.data);
    } catch (e) {
      setMefError(e instanceof Error ? e.message : "Error consultando el MEF");
    } finally {
      setMefCargando(false);
    }
  }, [venta]);

  const cargarOps = useCallback(async () => {
    if (!venta?.id) return;
    setCargando(true);
    setError("");
    try {
      const r = await fetch(`${API_BASE}/erp/ordenes/${venta.id}/ops`);
      if (!r.ok) throw new Error((await r.json()).detail || `Error HTTP ${r.status}`);
      setOps(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCargando(false);
    }
  }, [venta?.id]);

  const onFinalizadoFormulario = useCallback(() => {
    cargarOps();
  }, [cargarOps]);

  useEffect(() => {
    if (venta) {
      setOpSeleccionada(null);
      cargarOps();
      consultarMef();
    }
  }, [venta, cargarOps, consultarMef]);


  useEffect(() => {
    if (venta) {
      setOpSeleccionada(null);
      cargarOps();
      consultarMef();
    }
  }, [venta, cargarOps, consultarMef]);

  // Cuando OTRO usuario confirma un producto o lo sube al ERP, el
  // backend crea/actualiza la OP real en Railway — eso cambia la lista
  // `ops`, que es lo que decide si un producto se ve "Registrado en
  // ERP" (moradito). Sin este efecto, esa lista solo se refresca con
  // acciones del propio usuario o al reabrir el drawer.
  useEffect(() => {
    if (!ultimoEventoOps) return;
    if (Number(ultimoEventoOps.orden_compra_id) !== Number(venta?.id)) return;
    if (ultimoEventoOps.tipo === "op_confirmada" || ultimoEventoOps.tipo === "op_subida_erp") {
      cargarOps();
    }
  }, [ultimoEventoOps]);


  useEffect(() => {
    if (!venta) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [venta, onClose]);

  if (!venta) return null;



  console.log("VENTA COMPLETA:", venta);

  if (!venta) return null;



  console.log("VENTA COMPLETA:", venta);


  // Siempre mostramos la vista por producto (FormularioCrearProveedor),
  // exista o no una OP real en el ERP — el backend ya sabe crear la OP
  // sola en el momento de "Confirmar" si todavía no existe. Así seguimiento
  // siempre ve TODOS los productos de la venta (los ya hechos y los que
  // faltan), en vez de tener que entrar a una OP específica primero.
  const modoCrear = true;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative w-[90vw] max-w-[1250px] bg-white h-full shadow-2xl flex flex-col animate-[slideInRight_0.25s_ease-out]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2 min-w-0">
            {opSeleccionada != null && (
              <button
                onClick={() => setOpSeleccionada(null)}
                className="p-1 -ml-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors shrink-0"
              >
                <ArrowLeft size={16} />
              </button>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p style={{ fontFamily: "var(--font-mono)" }} className="text-xs text-slate-400 truncate">
                  {ocamDe(venta) || `Venta #${venta.id}`}
                </p>
                {codigoVentaDe(venta) && (
                  <span
                    style={{ fontFamily: "var(--font-mono)" }}
                    className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-[#4F46E5] border border-indigo-200 shrink-0"
                  >
                    {codigoVentaDe(venta)}
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-slate-900 truncate">
                {opSeleccionada != null ? "Detalle de la OP" : "Órdenes de proveedor"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 shrink-0">
            <X size={18} />
          </button>
        </div>

          <div className="flex-1 overflow-y-auto">

        <PanelMef
            venta={venta}
            data={mefData}
            cargando={mefCargando}
            error={mefError}
            usuarioActual={usuarioActual}
            esSeguimiento={esSeguimiento}
        />

        <FormularioCrearProveedor
            venta={venta}
            usuarioActual={usuarioActual}
            esSeguimiento={esSeguimiento}
            productoInicial={(venta as any)._productoAbrir}
            grupoInicial={(venta as any)._grupoAbrir}
            onFinalizado={onFinalizadoFormulario}
            tick={tick}
            proveedores={proveedores}
            transportes={transportes}
            cargandoProveedores={cargandoProveedores}
            cargandoTransportes={cargandoTransportes}
            agregarProveedor={agregarProveedor}
            agregarTransporte={agregarTransporte}
            ops={ops}
            ultimoEventoOps={ultimoEventoOps}
            mostrarToast={mostrarToast}   
        />
      </div>
       <ToastContainer toasts={toasts} onCerrar={cerrarToast} />   {/* <-- AGREGAR */}
      </div>
      
    </div>
  );
}


// "19/05/2026" -> "2026-05-19", formato que el endpoint espera.
function formatearFechaParaErp(fechaDdMmYyyy: string): string {
  const [dia, mes, anio] = (fechaDdMmYyyy || "").split("/");
  if (!dia || !mes || !anio) return "";
  return `${anio}-${mes.padStart(2, "0")}-${dia.padStart(2, "0")}`;
}

// "1,701.56" o "-1,701.56" -> 1701.56 / -1701.56
function parsearMonto(raw: string): number {
  return Number(String(raw || "0").replace(/,/g, "")) || 0;
}

// Mapa Fase (columna del MEF) -> etapaSiaf del ERP. Por ahora solo se
// conoce "C" -> "COM"; si aparece otra fase no mapeada, se manda tal
// cual para no perder el dato.
const MAPA_FASE_A_ETAPA_SIAF: Record<string, string> = {
  C: "COM",
};
function PanelMef({
  venta,
  data,
  cargando,
  error,
  usuarioActual,
  esSeguimiento,
}: {
  venta: VentaErp;
  data: any;
  cargando: boolean;
  error: string;
  usuarioActual: string;
  esSeguimiento: boolean;
}) {
  const siaf = (venta as any)?.siaf;
  const unidadEjecutora = (venta as any)?.cliente?.codigoUnidadEjecutora;
  const expediente = (venta as any)?.siaf; // el "expediente" del MEF es el mismo valor que "siaf" de la venta

const [completandoSiaf, setCompletandoSiaf] = useState(false);
  const [errorSiaf, setErrorSiaf] = useState("");
  const [exitoSiaf, setExitoSiaf] = useState(false);
  const [mostrarResultados, setMostrarResultados] = useState(false);

  const [ultimoCompletado, setUltimoCompletado] = useState<any>(null);

  const cargarUltimoCompletado = useCallback(async () => {
    if (!venta?.id) return;
    try {
      const r = await fetch(`${API_BASE}/erp/ventas/${venta.id}/mef-completado`);
      if (r.ok) setUltimoCompletado(await r.json());
    } catch {}
  }, [venta?.id]);

  useEffect(() => {
    cargarUltimoCompletado();
  }, [cargarUltimoCompletado]);

  if (!siaf || !unidadEjecutora) return null;

  const registros: any[] = data?.registros || [];

  // Recalcula lo que HOY dice el MEF, con la misma lógica que
  // completarEnErp, para poder comparar contra lo último guardado en
  // la BD y detectar si el MEF cambió sus valores desde entonces.
  const derivadoActual = useMemo(() => {
    if (registros.length === 0) return null;
    const primera = registros[0];
    const etapaSiaf = MAPA_FASE_A_ETAPA_SIAF[primera["Fase"]] || primera["Fase"];
    const fechaSiaf = formatearFechaParaErp(primera["Fecha"]);
    let fuentesFinanciamiento: string;
    let montoVenta: number;
    if (registros.length === 1) {
      fuentesFinanciamiento = String(primera["FF"] ?? "");
      montoVenta = parsearMonto(primera["Monto"]);
    } else {
      const ffUnicos = Array.from(new Set(registros.map((r) => String(r["FF"] ?? "")).filter(Boolean)));
      fuentesFinanciamiento = ffUnicos.join(",");
      montoVenta = registros.reduce((acc, r) => acc + parsearMonto(r["Monto"]), 0);
    }
    return { etapaSiaf, fechaSiaf, fuentesFinanciamiento, montoVenta };
  }, [registros]);

  const cambioDetectado =
    !!ultimoCompletado &&
    !!derivadoActual &&
    (Math.abs(Number(ultimoCompletado.monto_venta ?? 0) - derivadoActual.montoVenta) > 0.005 ||
      String(ultimoCompletado.fuentes_financiamiento || "") !== derivadoActual.fuentesFinanciamiento ||
      String(ultimoCompletado.etapa_siaf || "") !== derivadoActual.etapaSiaf ||
      String(ultimoCompletado.fecha_siaf || "").slice(0, 10) !== derivadoActual.fechaSiaf);

  const completarEnErp = async () => {
    if (!venta?.id || registros.length === 0) return;
    setCompletandoSiaf(true);
    setErrorSiaf("");
    setExitoSiaf(false);
    try {
      const primera = registros[0];
      const etapaSiaf = MAPA_FASE_A_ETAPA_SIAF[primera["Fase"]] || primera["Fase"];
      const fechaSiaf = formatearFechaParaErp(primera["Fecha"]);

      let fuentesFinanciamiento: string;
      let multipleFuentesFinanciamiento: boolean;
      let montoVenta: number;

      if (registros.length === 1) {
        fuentesFinanciamiento = String(primera["FF"] ?? "");
        multipleFuentesFinanciamiento = false;
        montoVenta = parsearMonto(primera["Monto"]);
      } else {
        // 2+ filas: se combinan las fuentes de financiamiento únicas
        // (en el orden en que aparecen) y se suman los montos.
        const ffUnicos = Array.from(
          new Set(registros.map((r) => String(r["FF"] ?? "")).filter(Boolean))
        );
        fuentesFinanciamiento = ffUnicos.join(",");
        multipleFuentesFinanciamiento = true;
        montoVenta = registros.reduce((acc, r) => acc + parsearMonto(r["Monto"]), 0);
      }

      const r = await fetch(`${API_BASE}/erp/ventas/${venta.id}/actualizar-siaf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          etapa_siaf: etapaSiaf,
          fecha_siaf: fechaSiaf,
          fuentes_financiamiento: fuentesFinanciamiento,
          multiple_fuentes_financiamiento: multipleFuentesFinanciamiento,
          monto_venta: montoVenta,
          siaf,
          expediente: data?.expediente,
          unidad_ejecutora: unidadEjecutora,
          registros,
          completado_por: usuarioActual,
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || `Error HTTP ${r.status}`);
      }
      setExitoSiaf(true);
      await cargarUltimoCompletado();
    } catch (e) {
      setErrorSiaf(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCompletandoSiaf(false);
    }
  };

  return (
    <div className="mx-6 mt-5 p-5 rounded-xl border border-slate-200 bg-slate-50/60">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <FileText size={13} /> Consulta MEF — SIAF {siaf} / U.E. {unidadEjecutora}
        </p>
        {cargando && (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Loader2 size={12} className="animate-spin" /> Consultando MEF...
          </span>
        )}
      </div>

      {ultimoCompletado && cambioDetectado && (
        <div className="mb-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0" />
          <div className="text-[11px] text-amber-800 leading-relaxed">
            <p className="font-semibold">Los resultados del MEF cambiaron desde la última vez que se completó en el ERP.</p>
            <p>
              Última actualización{ultimoCompletado.completado_por ? ` por ${ultimoCompletado.completado_por}` : ""}
              {ultimoCompletado.completado_en ? ` (${new Date(ultimoCompletado.completado_en).toLocaleString("es-PE")})` : ""}:
              {" "}monto S/ {Number(ultimoCompletado.monto_venta || 0).toLocaleString("es-PE", { minimumFractionDigits: 2 })}, fuente {ultimoCompletado.fuentes_financiamiento}.
            </p>
            {derivadoActual && (
              <p>
                Valor actual en el MEF: monto S/ {derivadoActual.montoVenta.toLocaleString("es-PE", { minimumFractionDigits: 2 })}, fuente {derivadoActual.fuentesFinanciamiento}.
                Vuelve a darle "Completar resultados en el ERP" para actualizarlo.
              </p>
            )}
          </div>
        </div>
      )}
      {ultimoCompletado && !cambioDetectado && (
        <p className="mb-3 text-[11px] text-emerald-700 flex items-center gap-1">
          <CheckCircle2 size={11} /> Ya actualizado en el ERP{ultimoCompletado.completado_por ? ` por ${ultimoCompletado.completado_por}` : ""} — sin cambios desde entonces.
        </p>
      )}
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
            <h3 className="text-sm font-semibold text-slate-800 mb-3">
              Datos del Expediente Administrativo
            </h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3">
              <CampoFicha label="Año" codigo={data?.anio} />
              <CampoFicha label="Expediente" codigo={data?.expediente} />
              <CampoFicha label="Entidad" codigo={data?.entidad} descripcion={data?.nombreEntidad} />
              <CampoFicha label="Tipo Operación" codigo={data?.tipoOperacion} descripcion={data?.descripcionOperacion} />
              <CampoFicha label="Modalidad Compra" codigo={data?.modalidadCompra} descripcion={data?.descripcionModalidad} />
              <CampoFicha label="Tipo Proceso" codigo={data?.tipoProceso} descripcion={data?.descripcionProceso} />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px] whitespace-nowrap">
              <thead style={{ backgroundColor: "#8DC63F" }} className="text-white">
                <tr>
                  <th className="px-2.5 py-2 text-left font-semibold">Ciclo</th>
                  <th className="px-2.5 py-2 text-left font-semibold">Fase</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Sec</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Corr</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Doc</th>
                  <th className="px-2.5 py-2 text-left font-semibold">Numero</th>
                  <th className="px-2.5 py-2 text-left font-semibold">Fecha</th>
                  <th className="px-2.5 py-2 text-center font-semibold">FF</th>
                  <th className="px-2.5 py-2 text-left font-semibold">Moneda</th>
                  <th className="px-2.5 py-2 text-right font-semibold">Monto</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Est.</th>
                  <th className="px-2.5 py-2 text-left font-semibold">Fecha Proceso</th>
                  <th className="px-2.5 py-2 text-left font-semibold">Id Trx</th>
                  <th className="px-2.5 py-2 text-center font-semibold">Enviado</th>
                </tr>
              </thead>
              <tbody>
                {registros.map((reg: any, i: number) => (
                  <tr
                    key={i}
                    className={`border-b border-slate-100 last:border-0 hover:bg-slate-50 ${
                      i % 2 === 1 ? "bg-violet-50/40" : "bg-white"
                    }`}
                  >
                    <td className="px-2.5 py-2.5 text-slate-700 font-medium">{reg["Ciclo"]}</td>
                    <td className="px-2.5 py-2.5 text-slate-700 font-medium">{reg["Fase"]}</td>
                    <td className="px-2.5 py-2.5 text-center text-slate-600">{reg["Sec"]}</td>
                    <td className="px-2.5 py-2.5 text-center text-slate-600">{reg["Corr"]}</td>
                    <td className="px-2.5 py-2.5 text-center text-slate-600">{reg["Doc"]}</td>
                    <td style={{ fontFamily: "var(--font-mono)" }} className="px-2.5 py-2.5 text-slate-800">
                      {reg["Numero"]}
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)" }} className="px-2.5 py-2.5 text-slate-600">
                      {reg["Fecha"]}
                    </td>
                    <td className="px-2.5 py-2.5 text-center text-slate-600">{reg["FF"]}</td>
                    <td className="px-2.5 py-2.5 text-slate-500">{reg["Moneda"]}</td>
                    <td
                      style={{ fontFamily: "var(--font-mono)" }}
                      className="px-2.5 py-2.5 text-right font-semibold text-slate-800"
                    >
                      {Number(String(reg["Monto"] || 0).replace(/,/g, "")).toLocaleString("es-PE", {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-2.5 py-2.5 text-center">
                      <span className="inline-flex px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold">
                        {reg["Est."]}
                      </span>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)" }} className="px-2.5 py-2.5 text-slate-600">
                      <div className="leading-tight">
                        <p>{(reg["Fecha Proceso"] || "").split(" ")[0]}</p>
                        <p className="text-slate-400">{(reg["Fecha Proceso"] || "").split(" ")[1]}</p>
                      </div>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)" }} className="px-2.5 py-2.5 font-bold text-slate-800">
                      {reg["Id Trx"]}
                    </td>
                    <td className="px-2.5 py-2.5 text-center">
                      <button className="px-3 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors">
                        Enviar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ---- Botón: completar etapaSiaf/fechaSiaf/fuentes/monto en el ERP ---- */}
        {esSeguimiento ? (
            <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/60 flex items-center justify-between gap-3 flex-wrap">
              <p className="text-[11px] text-slate-500 max-w-md">
                {registros.length === 1
                  ? `Se actualizará con 1 registro: etapa ${MAPA_FASE_A_ETAPA_SIAF[registros[0]["Fase"]] || registros[0]["Fase"]}, fuente ${registros[0]["FF"]}, monto S/ ${parsearMonto(registros[0]["Monto"]).toLocaleString("es-PE", { minimumFractionDigits: 2 })}.`
                  : `Se actualizará combinando ${registros.length} registros: fuentes múltiples y suma de montos.`}
              </p>
              <button
                onClick={completarEnErp}
                disabled={completandoSiaf}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-lg px-4 py-2 text-xs disabled:opacity-40 transition-colors shrink-0"
              >
                {completandoSiaf ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                Completar resultados en el ERP
              </button>
            </div>
          ) : (
            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50/60">
              {cambioDetectado ? (
                <p className="text-[11px] text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle size={12} className="shrink-0" />
                  Los resultados del MEF cambiaron desde la última actualización — seguimiento debe revisar y volver a completar.
                </p>
              ) : ultimoCompletado ? (
                <p className="text-[11px] text-emerald-700 flex items-center gap-1.5">
                  <CheckCircle2 size={12} className="shrink-0" />
                  Esta consulta coincide exactamente con lo ya registrado en el ERP. No hay cambios pendientes.
                </p>
              ) : (
                <p className="text-[11px] text-slate-400">
                  Aún no se registró en el ERP — solo seguimiento puede completarlo.
                </p>
              )}
            </div>
          )}
          {errorSiaf && (
            <p className="px-5 pb-3 text-[11px] text-red-600 flex items-center gap-1">
              <AlertTriangle size={11} /> {errorSiaf}
            </p>
          )}
          {exitoSiaf && (
            <p className="px-5 pb-3 text-[11px] text-emerald-700 flex items-center gap-1">
              <CheckCircle2 size={11} /> Datos SIAF actualizados correctamente en el ERP.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
// Etiqueta + código resaltado + descripción — el código (ej. "N", "CA",
// "26", "301212") va en negrita/indigo, separado con un guión largo de
// la descripción, que va en gris normal. Si no hay descripción (Año,
// Expediente), solo se muestra el código en grande.
function CampoFicha({
  label,
  codigo,
  descripcion,
}: {
  label: string;
  codigo?: string | number | null;
  descripcion?: string | null;
}) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className="text-sm text-slate-800 break-words">
        <span style={{ fontFamily: "var(--font-mono)" }} className="font-bold text-[#4F46E5]">
          {codigo || "—"}
        </span>
        {descripcion && <span className="text-slate-700"> — {descripcion}</span>}
      </p>
    </div>
  );
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
  otras_observaciones: string;   // NUEVO — va al campo "observaciones" de la OP
            // NUEVO — calculado, nunca lo edita el usuario a mano
  margen: string;
  motivo_margen: string;
  margen_orden: string;
  tipo_envio: string;
  empresa_id: string;
  empresa_nombre: string;
}

const formularioVacio: FormularioProducto = {
  proveedor_nombre: "",
  proveedor_id: "",
  proveedor_telefono: "",
  precio_producto: "",
  comodato: "",
  observaciones_externas: "",
  agencia_transporte: "",
  transporte_id: "",
  precio_flete: "",
  observaciones: "",
  observaciones_transporte: "",
  otras_observaciones: "",
  margen: "",
  motivo_margen: "",
  margen_orden: "",
  tipo_envio: "",
  empresa_id: "",
  empresa_nombre: "",
};



// Calcula el margen de UN producto y, si no se puede, arma el motivo
// EXACTO (para reemplazar el genérico "Sin monto de venta") — distingue
// entre: falta precio, falta monto de venta (orden de 1 producto), o
// falta monto de referencia (orden de varios productos).
function calcularMargenConMotivo(
  codigo: string,
  precioProducto: string,
  precioFlete: string,
  venta: VentaErp,
  seguimientos: any[]
): { margen: string; motivo: string } {
  const productoVenta = (venta.productos || []).find(
    (p: any) => String(p.codigo ?? p.id ?? "").trim() === codigo
  );
  const tieneVariosProductos = (venta.productos || []).length > 1;

  let montoVentaOrden: number | null = null;
  let motivo = "";

  if (tieneVariosProductos) {
    const seg = seguimientos.find(
      (s: any) => String(s.producto_codigo).trim() === codigo
    );
    if (seg?.monto_referencia != null && seg.monto_referencia !== "") {
      montoVentaOrden = Number(seg.monto_referencia);
    } else {
      motivo = "Monto de referencia no fue registrado en la orden";
    }
  } else {
    montoVentaOrden = montoDe(venta);
    if (montoVentaOrden == null) {
      motivo = "Monto de venta no fue registrado en la orden";
    }
  }

  if (!precioProducto?.trim()) {
    motivo = "Falta ingresar el precio del producto";
  }

  const margenCalculado = calcularMargen(
    precioProducto,
    productoVenta?.cantidad,
    precioFlete,
    montoVentaOrden
  );

  return {
    margen: margenCalculado != null ? String(margenCalculado) : "",
    motivo: margenCalculado != null ? "" : (motivo || "Sin monto de venta"),
  };
}


const TEXTO_OBS_AGENCIA =
  "LLAMAR 1 HORA ANTES A JOHANA CEL: 941 567 335 (LUNES A VIERNES: DE 8:30 AM A 6:00 PM, SÁBADOS: 9:00 AM - 12:00 PM) EMITIR LA GUÍA CON LA DIRECCIÓN DE ENTREGA";
const TEXTO_OBS_ENTIDAD =
  "LLAMAR 1 HORA ANTES A JOHANA CEL: 941 567 335 (LUNES A VIERNES: DE 8:30 AM A 12:00 PM - DE 2:00 PM A 4:00 PM)- EMITIR LA GUÍA CON LA DIRECCIÓN DE ENTREGA";

interface ImagenProducto {
  id: number;
  ruta_archivo: string;
  nombre_original?: string;
  url?: string; // viene calculada del backend — funciona igual con disco local o con S3/Azure
}

// Fallback por si algún día tienes datos viejos sin 'url' en caché —
// en operación normal siempre usa img.url que ya manda el backend.
function urlImagen(img: ImagenProducto) {
  return img.url || `${API_BASE}/archivos/${img.ruta_archivo}`;
}

// ============================================================
// Selector de imágenes estilo WhatsApp: miniaturas con "x" para
// quitar, y un botón "+" para agregar hasta completar 4.
// ============================================================
const MAX_ARCHIVOS_POR_PRODUCTO = 6;

// Detecta si el archivo es una imagen (para mostrar miniatura real) o
// un documento (PDF/Word), para mostrar un ícono en vez de un <img>
// roto — un PDF o .docx no se puede pintar con la etiqueta <img>.
function esImagen(img: ImagenProducto) {
  const nombre = (img.nombre_original || img.ruta_archivo || "").toLowerCase();
  return /\.(jpg|jpeg|png|webp|gif)$/.test(nombre);
}

function extensionDe(img: ImagenProducto) {
  const nombre = (img.nombre_original || img.ruta_archivo || "").toLowerCase();
  const m = nombre.match(/\.([a-z0-9]+)$/);
  return m ? m[1].toUpperCase() : "ARCHIVO";
}

function SelectorImagenes({
  ordenCompraId,
  codigo,
  imagenes,
  onCambio,
  disabled,
}: {
  ordenCompraId: number;
  codigo: string;
  imagenes: ImagenProducto[];
  onCambio: (nuevas: ImagenProducto[]) => void;
  disabled?: boolean;
}) {
  const [subiendo, setSubiendo] = useState(false);
  const [eliminandoId, setEliminandoId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [previewEsImagen, setPreviewEsImagen] = useState(true);
  const contenedorRef = useRef<HTMLDivElement | null>(null);
  const restantes = MAX_ARCHIVOS_POR_PRODUCTO - imagenes.length;

  const subirArchivos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const seleccionados = Array.from(files).slice(0, restantes);
    if (seleccionados.length === 0) {
      setError(`Ya alcanzaste el máximo de ${MAX_ARCHIVOS_POR_PRODUCTO} archivos.`);
      return;
    }
    setError("");
    setSubiendo(true);
    try {
      const fd = new FormData();
      seleccionados.forEach((f) => fd.append("archivos", f));
      const r = await fetch(
        `${API_BASE}/erp/ordenes/${ordenCompraId}/productos/${encodeURIComponent(codigo)}/imagenes`,
        { method: "POST", body: fd }
      );
      if (!r.ok) throw new Error((await r.json()).detail || "No se pudieron subir las imágenes");
      onCambio(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error subiendo imágenes");
    } finally {
      setSubiendo(false);
    }
  };

  const subirDesdeClipboard = async (files: File[]) => {
    if (!files.length) return;

    const disponibles = files.slice(0, restantes);

    if (!disponibles.length) {
      setError(`Ya alcanzaste el máximo de ${MAX_ARCHIVOS_POR_PRODUCTO} archivos.`);
      return;
    }
    setSubiendo(true);
    setError("");

    try {

      const fd = new FormData();

      disponibles.forEach((f) => {
        fd.append("archivos", f);
      });

      const r = await fetch(
        `${API_BASE}/erp/ordenes/${ordenCompraId}/productos/${encodeURIComponent(codigo)}/imagenes`,
        {
          method: "POST",
          body: fd,
        }
      );

      if (!r.ok) {
        throw new Error((await r.json()).detail);
      }

      onCambio(await r.json());

    } catch (e) {

      setError(
        e instanceof Error
          ? e.message
          : "Error subiendo imágenes"
      );

    } finally {

      setSubiendo(false);

    }
  };


  useEffect(() => {

    const pegar = (e: ClipboardEvent) => {

      const items = e.clipboardData?.items;

      if (!items) return;

      const archivos: File[] = [];

      for (const item of items) {

        if (item.type.startsWith("image/")) {

          const file = item.getAsFile();

          if (file) archivos.push(file);

        }

      }

      if (!archivos.length) return;

      e.preventDefault();

      subirDesdeClipboard(archivos);

    };

    window.addEventListener("paste", pegar);

    return () => {

      window.removeEventListener("paste", pegar);

    };

  }, [imagenes]);

  const quitarImagen = async (imagenId: number) => {
    setEliminandoId(imagenId);
    setError("");
    try {
      const r = await fetch(
        `${API_BASE}/erp/ordenes/${ordenCompraId}/productos/${encodeURIComponent(codigo)}/imagenes/${imagenId}`,
        { method: "DELETE" }
      );
      if (!r.ok) throw new Error((await r.json()).detail || "No se pudo quitar la imagen");
      onCambio(imagenes.filter((img) => img.id !== imagenId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error quitando imagen");
    } finally {
      setEliminandoId(null);
    }
  };

return (
  <div ref={contenedorRef} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 space-y-3">
      <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
        <div className="w-6 h-6 rounded-lg bg-[#4F46E5]/10 flex items-center justify-center shrink-0">
          <ImagePlus size={13} className="text-[#4F46E5]" />
        </div>
        <p className="text-[13px] font-bold text-slate-800 tracking-wide">
          Fotos y documentos ({imagenes.length}/{MAX_ARCHIVOS_POR_PRODUCTO})
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {imagenes.map((img) => {
          const imagen = esImagen(img);
          return (
          <div key={img.id} className="relative w-16 h-16 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
            {imagen ? (
              <img
                src={urlImagen(img)}
                alt={img.nombre_original || "imagen"}
                onClick={() => {
                  setPreview(urlImagen(img));
                  setPreviewEsImagen(true);
                }}
                className="w-full h-full object-cover cursor-pointer hover:scale-105 transition"
              />
            ) : (
              <button
                type="button"
                onClick={() => window.open(urlImagen(img), "_blank")}
                className="w-full h-full bg-slate-50 hover:bg-slate-100 flex flex-col items-center justify-center gap-0.5 transition-colors"
                title={img.nombre_original || "Abrir documento"}
              >
                <FileText size={20} className="text-slate-400" />
                <span className="text-[8px] font-bold text-slate-400">{extensionDe(img)}</span>
              </button>
            )}
            {!disabled && (
              <button
                type="button"
                onClick={() => quitarImagen(img.id)}
                disabled={eliminandoId === img.id}
                className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-slate-900/70 text-white flex items-center justify-center hover:bg-red-600 transition-colors disabled:opacity-50"
                aria-label="Quitar archivo"
              >
                {eliminandoId === img.id ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
              </button>
            )}
          </div>
          );
        })}
        {!disabled && restantes > 0 && (
          <label className="w-16 h-16 rounded-xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors text-slate-400 hover:text-[#4F46E5]">
            {subiendo ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
            <span className="text-[9px] font-medium">{subiendo ? "" : "Agregar"}</span>
            <input
              type="file"
              accept="image/*,.pdf,.doc,.docx"
              multiple
              className="hidden"
              disabled={subiendo}
              onChange={(e) => subirArchivos(e.target.files)}
            />
          </label>
        )}
    </div>

      {(subiendo || eliminandoId !== null) && (
        <p className="text-[11px] text-indigo-600 mt-1.5 flex items-center gap-1.5">
          <Loader2 size={11} className="animate-spin" />
          {subiendo
            ? "Subiendo archivo y regenerando PDF consolidado…"
            : "Eliminando archivo y regenerando PDF consolidado…"}
        </p>
      )}

      {error && (
        <p className="text-[11px] text-red-600 mt-1.5 flex items-center gap-1">
          <AlertTriangle size={11} /> {error}
        </p>
      )}

      {preview && previewEsImagen && (

      <div
          className="fixed inset-0 bg-black/80 z-[9999] flex items-center justify-center p-6"
          onClick={() => setPreview(null)}
      >

          <img
              src={preview}
              className="max-w-[95vw] max-h-[90vh] rounded-xl shadow-2xl"
          />

      </div>

      )}

    </div>
  );
}

// Campo de texto largo (observaciones) — mismo estilo visual que Campo.
function CampoObservaciones({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-500 mb-1 flex items-center gap-1">
        <MessageSquareText size={11} /> Observaciones
      </label>
      <textarea
        value={value}
        disabled={disabled}
        placeholder="Cualquier detalle adicional para seguimiento..."
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
      />
    </div>
  );
}


// Selector ENTIDAD / AGENCIA — al elegir uno, autorellena "Observaciones"
// con el texto correspondiente (el usuario puede editarlo después).
function SelectorTipoEnvio({
  value,
  onChange,
  onAutorellenar,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onAutorellenar: (texto: string) => void;
  disabled?: boolean;
}) {
  const elegir = (tipo: "ENTIDAD" | "AGENCIA") => {
    onChange(tipo);
    onAutorellenar(tipo === "AGENCIA" ? TEXTO_OBS_AGENCIA : TEXTO_OBS_ENTIDAD);
  };
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-500 mb-1">Tipo de envío</label>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => elegir("ENTIDAD")}
          disabled={disabled}
          className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors disabled:opacity-40 ${
            value === "ENTIDAD" ? "bg-[#4F46E5] text-white border-[#4F46E5]" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
          }`}
        >
          ENTIDAD
        </button>
        <button
          type="button"
          onClick={() => elegir("AGENCIA")}
          disabled={disabled}
          className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors disabled:opacity-40 ${
            value === "AGENCIA" ? "bg-[#4F46E5] text-white border-[#4F46E5]" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
          }`}
        >
          AGENCIA
        </button>
      </div>
    </div>
  );
}



const CAMPOS_CLAVE_UI: { key: keyof FormularioProducto; label: string }[] = [
  { key: "proveedor_nombre", label: "Proveedor" },
  { key: "proveedor_telefono", label: "Teléfono proveedor" },
  { key: "precio_producto", label: "Precio producto" },
  { key: "agencia_transporte", label: "Agencia de transporte" },
  { key: "precio_flete", label: "Precio flete" },
];

function CamposFaltantesAviso({ form }: { form: FormularioProducto }) {
  const esAgencia = form.tipo_envio === "AGENCIA";
  const campos = esAgencia
    ? CAMPOS_CLAVE_UI
    : CAMPOS_CLAVE_UI.filter((c) => c.key !== "agencia_transporte" && c.key !== "precio_flete");
  const faltantes = campos.filter((c) => !form[c.key]?.trim()).map((c) => c.label);
  if (faltantes.length === 0) return null;
  return (
    <p className="text-[11px] text-amber-600 flex items-start gap-1">
      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
      Faltan: {faltantes.join(", ")}
    </p>
  );
}

function DetalleOp({
  opId,
  usuarioActual,
  esSeguimiento,
  onCambio,
  tick,
  proveedores,
  transportes,
  cargandoProveedores,
  cargandoTransportes,
}: {
  opId: number;
  usuarioActual: string;
  esSeguimiento: boolean;
  onCambio: () => void;
  tick?: number;
  proveedores: ProveedorOption[];
  transportes: TransporteOption[];
  cargandoProveedores: boolean;
  cargandoTransportes: boolean;
}) {
  const [detalle, setDetalle] = useState<any>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [productoAbierto, setProductoAbierto] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, FormularioProducto>>({});
  const [guardandoCodigo, setGuardandoCodigo] = useState<string | null>(null);
  const [subiendoCodigo, setSubiendoCodigo] = useState<string | null>(null);
  const [confirmandoCodigo, setConfirmandoCodigo] = useState<string | null>(null);
  const [imagenesPorProducto, setImagenesPorProducto] = useState<Record<string, ImagenProducto[]>>({});
  

  const [modoSeleccion, setModoSeleccion] = useState(false);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [panelBloqueAbierto, setPanelBloqueAbierto] = useState(false);



  // Carga las imágenes del producto recién al abrirlo (no de una,
  // para no golpear el backend con N requests por cada OP cargada).
  useEffect(() => {
    if (!productoAbierto || !detalle?.ordenCompraId || imagenesPorProducto[productoAbierto]) return;
    const codigo = productoAbierto;
    fetch(`${API_BASE}/erp/ordenes/${detalle.ordenCompraId}/productos/${encodeURIComponent(codigo)}/imagenes`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setImagenesPorProducto((prev) => ({ ...prev, [codigo]: data })))
      .catch(() => {});
  }, [productoAbierto, detalle]);



  useEffect(() => {
    if (tick === undefined || !productoAbierto || !detalle?.ordenCompraId) return;
    const codigo = productoAbierto;
    fetch(`${API_BASE}/erp/ordenes/${detalle.ordenCompraId}/productos/${encodeURIComponent(codigo)}/imagenes`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setImagenesPorProducto((prev) => ({ ...prev, [codigo]: data })))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  
  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const r = await fetch(`${API_BASE}/erp/ops/${opId}`);
      if (!r.ok) throw new Error((await r.json()).detail || `Error HTTP ${r.status}`);
      const data = await r.json();
      setDetalle(data);

    const nuevosForms: Record<string, FormularioProducto> = {};
      for (const p of data.productos || []) {
        const codigo = String(p.codigo ?? p.id ?? "");
        const seg = p._seguimiento;
        nuevosForms[codigo] = {
          proveedor_nombre: seg?.proveedor_nombre || "",
          proveedor_id: seg?.proveedor_id != null ? String(seg.proveedor_id) : "",
          proveedor_telefono: seg?.proveedor_telefono || "",
          precio_producto: seg?.precio_producto != null ? String(seg.precio_producto) : "",
          comodato: seg?.comodato || "",
          observaciones_externas: seg?.observaciones_externas || "",
          agencia_transporte: seg?.agencia_transporte || "",
          transporte_id: seg?.transporte_id != null ? String(seg.transporte_id) : "",
          precio_flete: seg?.precio_flete != null ? String(seg.precio_flete) : "",
          observaciones: seg?.observaciones || "",
          observaciones_transporte: seg?.observaciones_transporte || "",
          otras_observaciones: seg?.otras_observaciones || "",
          margen: seg?.margen != null ? String(seg.margen) : "",
          motivo_margen: "",
          margen_orden: seg?.margen_orden != null ? String(seg.margen_orden) : "",
          tipo_envio: seg?.tipo_envio || "",
          empresa_id: seg?.empresa_id != null ? String(seg.empresa_id) : "",
          empresa_nombre: seg?.empresa_nombre || "",
        };
      }
      setForms(nuevosForms);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCargando(false);
    }
  }, [opId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Se refresca solo cuando otro usuario (ej. seguimiento confirmando)
  // dispara un evento relevante por WebSocket — sin esto, alguien con el
  // drawer abierto solo ve cambios ajenos si recarga la página.
  useEffect(() => {
    if (tick !== undefined) {
      cargar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const actualizarCampo = (codigo: string, campo: keyof FormularioProducto, valor: string) => {
    setForms((f) => ({ ...f, [codigo]: { ...(f[codigo] || formularioVacio), [campo]: valor } }));
  };

  const guardarProducto = async (codigo: string) => {
    setGuardandoCodigo(codigo);
    setError("");
    try {
    const form = forms[codigo] || formularioVacio;
      const r = await fetch(
        `${API_BASE}/erp/ops/${opId}/productos/${encodeURIComponent(codigo)}/rellenar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            proveedor_id: form.proveedor_id ? parseInt(form.proveedor_id, 10) : null,
            transporte_id: form.transporte_id ? parseInt(form.transporte_id, 10) : null,
            precio_producto: form.precio_producto ? parseFloat(form.precio_producto) : null,
            precio_flete: form.precio_flete ? parseFloat(form.precio_flete) : null,
            rellenado_por: usuarioActual,
          }),
        }
      );
      if (!r.ok) throw new Error((await r.json()).detail || "Error guardando");
      await cargar();
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setGuardandoCodigo(null);
    }
  };

  const subirProducto = async (codigo: string) => {
    setSubiendoCodigo(codigo);
    setError("");
    try {
      const r = await fetch(
        `${API_BASE}/erp/ops/${opId}/productos/${encodeURIComponent(codigo)}/subir-erp`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subido_por: usuarioActual }),
        }
      );
      if (!r.ok) throw new Error((await r.json()).detail || "Error subiendo");
      await cargar();
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSubiendoCodigo(null);
    }
  };

const confirmarProducto = async (codigo: string) => {
    setConfirmandoCodigo(codigo);
    setError("");
    try {
      // Mismo fix que en FormularioCrearProveedor: guardar SIEMPRE antes
      // de confirmar, para no confirmar con datos viejos de MySQL.
      const form = forms[codigo] || formularioVacio;
      const rGuardar = await fetch(
        `${API_BASE}/erp/ordenes/${detalle.ordenCompraId}/productos/${encodeURIComponent(codigo)}/actualizar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            proveedor_id: form.proveedor_id ? parseInt(form.proveedor_id, 10) : null,
            transporte_id: form.transporte_id ? parseInt(form.transporte_id, 10) : null,
            precio_producto: form.precio_producto ? parseFloat(form.precio_producto) : null,
            precio_flete: form.precio_flete ? parseFloat(form.precio_flete) : null,
          }),
        }
      );
      if (!rGuardar.ok) {
        throw new Error((await rGuardar.json()).detail || "Error guardando cambios antes de confirmar");
      }

      const r = await fetch(
        `${API_BASE}/erp/ordenes/${detalle.ordenCompraId}/productos/${encodeURIComponent(codigo)}/confirmar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmado_por: usuarioActual }),
        }
      );
      if (!r.ok) throw new Error((await r.json()).detail || "Error confirmando");
      await cargar();
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setConfirmandoCodigo(null);
    }
  };

  const guardarCambiosSeguimiento = async (codigo: string) => {
    setGuardandoCodigo(codigo);
    setError("");
    try {
      const form = forms[codigo] || formularioVacio;
      const r = await fetch(
        `${API_BASE}/erp/ordenes/${detalle.ordenCompraId}/productos/${encodeURIComponent(codigo)}/actualizar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...form,
            proveedor_id: form.proveedor_id ? parseInt(form.proveedor_id, 10) : null,
            transporte_id: form.transporte_id ? parseInt(form.transporte_id, 10) : null,
            precio_producto: form.precio_producto ? parseFloat(form.precio_producto) : null,
            precio_flete: form.precio_flete ? parseFloat(form.precio_flete) : null,
          }),
        }
      );
      if (!r.ok) throw new Error((await r.json()).detail || "Error guardando cambios");
      await cargar();
      onCambio();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setGuardandoCodigo(null);
    }
  };
  if (cargando) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 p-5">
        <Loader2 size={15} className="animate-spin" /> Cargando OP…
      </div>
    );
  }
  if (error && !detalle) {
    return (
      <div className="m-5 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
        <AlertTriangle size={15} /> {error}
      </div>
    );
  }

  const productos: any[] = detalle.productos || [];

  return (
    <div className="p-5 space-y-3">
      <p className="text-xs font-semibold text-slate-700 flex items-center gap-1.5 mb-1">
        <Package size={13} /> Productos ({productos.length})
      </p>

      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      {productos.map((p) => {
        const codigo = String(p.codigo ?? p.id ?? "");
        const seg = p._seguimiento || { estado: "pendiente" };
        const badge = badgeSeguimiento(seg.estado);
        const BadgeIcon = badge.icon;
        const abierto = productoAbierto === codigo;
        const form = forms[codigo] || formularioVacio;
        const soloLectura = esSeguimiento
          ? seg.estado === "pendiente" // seguimiento no edita hasta que haya algo enviado
          : seg.estado === "confirmado" || seg.estado === "subido"; // ventas edita libre en pendiente/preview

        return (
          <div key={codigo} className="border border-slate-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setProductoAbierto(abierto ? null : codigo)}
              className="w-full flex items-center justify-between gap-2 px-3.5 py-3 hover:bg-slate-50/70 transition-colors text-left"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-800 truncate">{p.codigo}</p>
                <p className="text-[11px] text-slate-500 truncate">{p.descripcion}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${badge.clase}`}>
                  <BadgeIcon size={10} />
                  {badge.texto}
                </span>
                {abierto ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
              </div>
            </button>

            {abierto && (
              <div className="px-3.5 pb-3.5 pt-1 border-t border-slate-100 space-y-3">
                <p className="text-[11px] text-slate-400">
                  {p.cantidad} {p.unidadMedida}
                </p>

                <div className="space-y-2.5">
                  <BuscadorEntidad<ProveedorOption>
                    label="Proveedor"
                    value={form.proveedor_nombre}
                    onChange={(v) => actualizarCampo(codigo, "proveedor_nombre", v)}
                    onSeleccionar={(p) => {
                      actualizarCampo(codigo, "proveedor_nombre", p.razonSocial);
                      actualizarCampo(codigo, "proveedor_id", String(p.id));
                      if (p.telefono) actualizarCampo(codigo, "proveedor_telefono", p.telefono);
                    }}
                    opciones={proveedores}
                    cargando={cargandoProveedores}
                    disabled={soloLectura}
                    placeholder="Buscar proveedor por razón social..."
                    seleccionado={proveedores.find((p) => p.razonSocial === form.proveedor_nombre) || null}
                  />

                  <SelectorTipoEnvio
                    value={form.tipo_envio}
                    onChange={(v) => actualizarCampo(codigo, "tipo_envio", v)}
                    onAutorellenar={(texto) => actualizarCampo(codigo, "observaciones", texto)}
                    disabled={soloLectura}
                  />

                  <div className={`grid gap-x-3 gap-y-2.5 ${form.tipo_envio === "AGENCIA" ? "grid-cols-4" : "grid-cols-2"}`}>
                    <Campo label="Teléfono proveedor" value={form.proveedor_telefono} onChange={(v) => actualizarCampo(codigo, "proveedor_telefono", v)} disabled={soloLectura} placeholder="+51 937 119 045" tipo="telefono" maxLength={20} />
                    <Campo label="Precio producto (incl. IGV)" value={form.precio_producto} onChange={(v) => actualizarCampo(codigo, "precio_producto", v)} disabled={soloLectura} placeholder="16.70" tipo="decimal" />
                    <Campo label="Comodato" value={form.comodato} onChange={(v) => actualizarCampo(codigo, "comodato", v)} disabled={soloLectura} placeholder="-" />
                    {form.tipo_envio === "AGENCIA" && (
                      <Campo label="Precio flete" value={form.precio_flete} onChange={(v) => actualizarCampo(codigo, "precio_flete", v)} disabled={soloLectura} placeholder="0.00" tipo="decimal" />
                    )}
                  </div>
                  <Campo label="Observaciones externas" value={form.observaciones_externas} onChange={(v) => actualizarCampo(codigo, "observaciones_externas", v)} disabled={soloLectura} placeholder="-" />

                  {form.tipo_envio === "AGENCIA" && (
                    <BuscadorEntidad<TransporteOption>
                      label="Agencia de transporte"
                      value={form.agencia_transporte}
                      onChange={(v) => actualizarCampo(codigo, "agencia_transporte", v)}
                      onSeleccionar={(t) => {
                        actualizarCampo(codigo, "agencia_transporte", t.razonSocial);
                        actualizarCampo(codigo, "transporte_id", String(t.id));
                      }}
                      opciones={transportes}
                      cargando={cargandoTransportes}
                      disabled={soloLectura}
                      placeholder="Buscar agencia de transporte..."
                      seleccionado={transportes.find((t) => t.razonSocial === form.agencia_transporte) || null}
                    />
                  )}

                  <CampoObservaciones value={form.observaciones} onChange={(v) => actualizarCampo(codigo, "observaciones", v)} disabled={soloLectura} />

                  {form.tipo_envio === "AGENCIA" && (
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">Observaciones transporte</label>
                      <textarea
                        value={form.observaciones_transporte}
                        disabled={soloLectura}
                        placeholder="Nota específica para el transportista..."
                        onChange={(e) => actualizarCampo(codigo, "observaciones_transporte", e.target.value)}
                        rows={2}
                        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Otras observaciones</label>
                    <textarea
                      value={form.otras_observaciones}
                      disabled={soloLectura}
                      placeholder="Cualquier otra nota general para la OP..."
                      onChange={(e) => actualizarCampo(codigo, "otras_observaciones", e.target.value)}
                      rows={2}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
                    />
                  </div>
                </div>

                {detalle?.ordenCompraId && (
                  <SelectorImagenes
                    ordenCompraId={detalle.ordenCompraId}
                    codigo={codigo}
                    imagenes={imagenesPorProducto[codigo] || []}
                    onCambio={(nuevas) => setImagenesPorProducto((prev) => ({ ...prev, [codigo]: nuevas }))}
                    disabled={soloLectura}
                  />
                )}

                {!esSeguimiento && (seg.estado === "pendiente" || seg.estado === "preview") && (
                  <>
                    {seg.estado === "preview" && (
                      <p className="text-[11px] text-amber-600 text-center">
                        Ya enviaste estos datos{seg.rellenado_por ? ` (${seg.rellenado_por})` : ""}. Puedes seguir
                        editando y reenviar mientras seguimiento no lo confirme.
                      </p>
                    )}
                    <CamposFaltantesAviso form={form} />
                    <button
                      onClick={() => guardarProducto(codigo)}
                      disabled={guardandoCodigo === codigo}
                      className="w-full flex items-center justify-center gap-2 bg-[#10172A] text-white font-medium rounded-lg py-2 text-xs disabled:opacity-40 hover:bg-[#1B2438] transition-colors"
                    >
                      {guardandoCodigo === codigo ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      {seg.estado === "preview" ? "Actualizar y reenviar" : "Enviar para revisión"}
                    </button>
                  </>
                )}
                {!esSeguimiento && (seg.estado === "confirmado" || seg.estado === "subido") && (
                  <p className="text-[11px] text-slate-400 text-center">
                    Seguimiento ya confirmó estos datos{seg.confirmado_por ? ` (${seg.confirmado_por})` : ""}. Ya no se pueden editar.
                  </p>
                )}

                {esSeguimiento && seg.estado === "pendiente" && (
                  <p className="text-[11px] text-slate-400 text-center">El proveedor aún no llenó estos datos.</p>
                )}

                {esSeguimiento && (seg.estado === "preview" || seg.estado === "confirmado") && (
                  <div className="space-y-2">
                    <button
                      onClick={() => guardarCambiosSeguimiento(codigo)}
                      disabled={guardandoCodigo === codigo || confirmandoCodigo === codigo}
                      className="w-full flex items-center justify-center gap-2 bg-white border border-slate-300 text-slate-700 font-medium rounded-lg py-2 text-xs disabled:opacity-40 hover:bg-slate-50 transition-colors"
                    >
                      {guardandoCodigo === codigo ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                      Guardar cambios
                    </button>

                    {seg.estado === "preview" && (
                      <button
                        onClick={() => confirmarProducto(codigo)}
                        disabled={confirmandoCodigo === codigo}
                        className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white font-medium rounded-lg py-2 text-xs disabled:opacity-40 hover:bg-emerald-700 transition-colors"
                      >
                        {confirmandoCodigo === codigo ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                        Confirmado por seguimiento
                      </button>
                    )}
                  </div>
                )}

                {seg.estado === "confirmado" && (
                  <p className="text-[11px] text-[#4F46E5] text-center flex items-center justify-center gap-1">
                    <ShieldCheck size={12} /> Confirmado por seguimiento{seg.confirmado_por ? ` (${seg.confirmado_por})` : ""}
                  </p>
                )}
                {seg.estado === "subido" && (
                  <p className="text-[11px] text-emerald-700 text-center flex items-center justify-center gap-1">
                    <CheckCircle2 size={12} /> Ya subido al ERP{seg.subido_por ? ` por ${seg.subido_por}` : ""}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}

      {productos.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-6">Esta OP no tiene productos.</p>
      )}
    </div>
  );
}


function DetalleProductoErpReal({ op, producto }: { op: any; producto: any }) {
  const transporte = (op.transportesAsignados || [])[0];
  return (
    <div className="px-3.5 pb-3.5 pt-2 border-t border-violet-100 bg-violet-50/40 space-y-2">
      <p className="text-[11px] text-violet-700 font-semibold flex items-center gap-1">
        <ShieldCheck size={12} /> Llenado directo en el ERP (nunca pasó por Helbot) — OP {op.codigoOp || op.id}
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <p><b className="text-slate-500">Proveedor:</b> {op.proveedor?.razonSocial || "—"}</p>
        <p><b className="text-slate-500">Precio unitario:</b> S/ {Number(producto?.precioUnitario || 0).toFixed(2)}</p>
        <p><b className="text-slate-500">Cantidad:</b> {producto?.cantidad ?? "—"}</p>
        <p><b className="text-slate-500">Total producto:</b> S/ {Number(producto?.total || 0).toFixed(2)}</p>
        {transporte && (
          <>
            <p><b className="text-slate-500">Transporte:</b> {transporte.transporte?.razonSocial || "—"}</p>
            <p><b className="text-slate-500">Flete:</b> S/ {Number(transporte.montoFlete || 0).toFixed(2)}</p>
          </>
        )}
      </div>
      {op.notaPedido && (
        <p className="text-[11px] text-slate-500"><b className="text-slate-600">Nota de pedido:</b> {op.notaPedido}</p>
      )}
    </div>
  );
}




// Envuelve DetalleProductoErpReal (el resumen de solo lectura de una OP
// ya creada directo en el ERP) con el mismo visor OCE/OCF de dos
// columnas que usa FormularioProductoModal — así también se ve el
// documento en productos que nunca pasaron por el flujo de Helbot.
function ModalDetalleProductoErpReal({
  p,
  opReal,
  productoErpReal,
  urlOce,
  urlOcf,
  onCerrar,
}: {
  p: any;
  opReal: any;
  productoErpReal: any;
  urlOce?: string | null;
  urlOcf?: string | null;
  onCerrar: () => void;
}) {
  const [docActivo, setDocActivo] = useState<"oce" | "ocf">("oce");
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onCerrar} />
      <div className="relative w-full max-w-[1800px] h-[92vh] overflow-hidden bg-white rounded-2xl shadow-2xl flex flex-col">
        <div className="shrink-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 truncate">{p.codigo}</p>
            <p className="text-[11px] text-slate-400 truncate">{p.descripcion}</p>
          </div>
          <button onClick={onCerrar} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 shrink-0">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col xl:flex-row gap-3 p-5 overflow-hidden">
          <div className="flex-1 min-w-0 overflow-y-auto pr-1">
            <DetalleProductoErpReal op={opReal} producto={productoErpReal} />
          </div>
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
      </div>
    </div>
  );
}


const ACENTOS_SECCION: Record<string, { icono: string; borde: string }> = {
  indigo: { icono: "bg-[#4F46E5]/10 text-[#4F46E5]", borde: "border-l-4 border-l-[#4F46E5]" },
  amber: { icono: "bg-amber-100 text-amber-600", borde: "border-l-4 border-l-amber-400" },
  violet: { icono: "bg-violet-100 text-violet-600", borde: "border-l-4 border-l-violet-400" },
  emerald: { icono: "bg-emerald-100 text-emerald-600", borde: "border-l-4 border-l-emerald-400" },
};

function SeccionForm({
  titulo,
  icono: Icono,
  children,
  color = "indigo",
}: {
  titulo: string;
  icono: any;
  children: React.ReactNode;
  color?: "indigo" | "amber" | "violet" | "emerald";
}) {
  const acento = ACENTOS_SECCION[color];
  return (
    <div className={`rounded-xl border border-slate-200 ${acento.borde} bg-slate-50/50 p-3.5 space-y-3`}>
      <div className="flex items-center gap-2 pb-2 border-b border-slate-200">
        <div className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 ${acento.icono}`}>
          <Icono size={13} />
        </div>
        <p className="text-[13px] font-bold text-slate-800 tracking-wide">
          {titulo}
        </p>
      </div>
      <div className="space-y-2.5">
        {children}
      </div>
    </div>
  );
}


interface ProductoBloqueForm {
  codigo: string;
  descripcion: string;
  precio_producto: string;
  precio_flete: string;
  comodato: string;
  observaciones_externas: string;
  montoReferencia?: string;   // NUEVO — "Monto importe" de ESE producto, para calcular SU margen individual
  margen?: string;            // NUEVO — calculado, nunca lo edita el usuario a mano
  cantidad?: number | string;
  unidadMedida?: string;
}

function PanelEnvioBloque({
  venta,
  codigosSeleccionados,
  proveedores,
  transportes,
  agregarProveedor,
  agregarTransporte,
  usuarioActual,
  onCerrar,
  onEnviado,
  mostrarToast,
  modo = "crear",
  seguimientosGrupo,
  todosSeguimientos,
  empresas,
  esSeguimiento,
  empresaSeleccionadaInicial,
  opProveedorId,
  opEmpresaId,
  productoInicial,
  montoVenta,
  onConfirmarBloque,
  onGuardarCambiosBloque,
  onActualizarErpBloque,
}: {
  venta: VentaErp;
  codigosSeleccionados: string[];
  proveedores: ProveedorOption[];
  transportes: TransporteOption[];
  agregarProveedor: (nuevo: ProveedorOption) => void;
  agregarTransporte: (nuevo: TransporteOption) => void;
  usuarioActual: string;
  onCerrar: () => void;
  onEnviado: () => void;
  mostrarToast: (tipo: "success" | "error", mensaje: string) => void;
  /** "crear" (Ventas selecciona y envía por primera vez) |
   *  "confirmar" (Seguimiento revisa/edita y confirma un bloque ya enviado) |
   *  "ver" (bloque ya confirmado/subido — solo lectura, sin botón de acción) —
   *  es el MISMO modal en los 3 casos, solo cambia si los campos son
   *  editables, el precargado, y qué botón (o ninguno) se muestra abajo. */
  modo?: "crear" | "confirmar" | "ver";
  /** Filas de op_producto_seguimiento del bloque — solo en modo "confirmar", para precargar todo. */
  seguimientosGrupo?: any[];
  /** TODOS los seguimientos de la venta (no solo los del grupo) — se usa
   * en modo "crear" para encontrar el monto_referencia que Ventas ya
   * había cargado por producto en CrearOrdenModal, antes de que exista
   * cualquier fila de grupo_envio_id. */
  todosSeguimientos?: any[];
  empresas?: EmpresaOption[];
  esSeguimiento?: boolean;
  empresaSeleccionadaInicial?: string;
  /** Proveedor/empresa REALES de la OP ya existente en el ERP para este
   * grupo (si la hay) — se usan como fuente de verdad al guardar, para
   * nunca desalinear los IDs y evitar que el backend cree una OP
   * duplicada por creer que cambió el proveedor. */
  opProveedorId?: number | null;
  opEmpresaId?: number | null;
  /** Código del producto en el que se hizo clic para abrir este
   * bloque — el modal (FormularioBloqueModal) debe nacer con ESE tab
   * activo, no siempre en el primer producto de la lista. */
  productoInicial?: string | null;
  /** montoVenta de la orden completa — YA NO se usa para calcular
   * margen en bloque (cada producto usa su propio monto_referencia).
   * Se deja el prop por compatibilidad, sin efecto en el margen. */
  montoVenta?: number | null;
  onConfirmarBloque?: (datos: { items: ProductoBloqueForm[]; compartido: any; empresaId: string }) => Promise<void>;
  /** Bloque ya confirmado: guarda cambios en Helbot (MySQL) sin tocar el ERP real. */
  onGuardarCambiosBloque?: (datos: { items: ProductoBloqueForm[]; compartido: any; empresaId: string }, opProveedorId?: number | null, opEmpresaId?: number | null) => Promise<void>;
  onActualizarErpBloque?: (datos: { items: ProductoBloqueForm[]; compartido: any; empresaId: string }, opProveedorId?: number | null, opEmpresaId?: number | null) => Promise<void>;
}) {
  // Ventas ve el bloque confirmado 100% de solo lectura. Seguimiento,
  // en cambio, puede seguir editando y reenviando al ERP un bloque ya
  // confirmado — igual que ya puede hacerlo por producto individual
  // con los botones "Guardar cambios" / "Actualizar ERP".
  const soloLectura = modo === "ver" && !esSeguimiento;
  const [guardandoBloque, setGuardandoBloque] = useState(false);
  const [actualizandoErpBloque, setActualizandoErpBloque] = useState(false);
  const [docActivo, setDocActivo] = useState<"oce" | "ocf">("oce");

  const primerSeg = modo !== "crear" ? (seguimientosGrupo || [])[0] || null : null;

  const codigosDelBloque =
    modo !== "crear"
      ? (seguimientosGrupo || []).map((s: any) => String(s.producto_codigo).trim())
      : codigosSeleccionados;

  const productosVenta = (venta.productos || []).filter((p: any) =>
    codigosDelBloque.includes(String(p.codigo ?? p.id ?? "").trim())
  );

  const [compartido, setCompartido] = useState({
    proveedor_nombre: primerSeg?.proveedor_nombre || "",
    proveedor_id: primerSeg?.proveedor_id != null ? String(primerSeg.proveedor_id) : "",
    proveedor_telefono: primerSeg?.proveedor_telefono || "",
    tipo_envio: primerSeg?.tipo_envio || "",
    agencia_transporte: primerSeg?.agencia_transporte || "",
    transporte_id: primerSeg?.transporte_id != null ? String(primerSeg.transporte_id) : "",
    observaciones: primerSeg?.observaciones || "",
    otras_observaciones: primerSeg?.otras_observaciones || "",
    observaciones_transporte: primerSeg?.observaciones_transporte || "",
  });
  const [empresaId, setEmpresaId] = useState(empresaSeleccionadaInicial || "");
  const [confirmando, setConfirmando] = useState(false);
  const [modalProveedorAbierto, setModalProveedorAbierto] = useState(false);
  const [modalTransporteAbierto, setModalTransporteAbierto] = useState(false);

  const [items, setItems] = useState<ProductoBloqueForm[]>(
    productosVenta.map((p: any) => {
      const codigo = String(p.codigo ?? p.id ?? "").trim();
      const seg = (seguimientosGrupo || []).find((s: any) => String(s.producto_codigo).trim() === codigo);
      // En modo "crear" seguimientosGrupo todavía no existe (el bloque
      // recién se está armando) — el monto_referencia por producto ya
      // fue cargado por Ventas en CrearOrdenModal y vive en el
      // seguimiento GLOBAL de la venta, no en el del grupo.
      const segGlobal = (todosSeguimientos || []).find((s: any) => String(s.producto_codigo).trim() === codigo);
      const montoRef = seg?.monto_referencia ?? segGlobal?.monto_referencia;
      return {
        codigo,
        descripcion: p.descripcion || "",
        precio_producto: seg?.precio_producto != null ? String(seg.precio_producto) : "",
        precio_flete: seg?.precio_flete != null ? String(seg.precio_flete) : "",
        comodato: seg?.comodato || "",
        observaciones_externas: seg?.observaciones_externas || "",
        montoReferencia: montoRef != null ? String(montoRef) : "",
        margen: seg?.margen != null ? String(seg.margen) : "",
        cantidad: p.cantidad,
        unidadMedida: p.unidadMedida,
      };
    })
  );


const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [imagenesPorProducto, setImagenesPorProducto] = useState<Record<string, ImagenProducto[]>>({});



  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCerrar();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCerrar]);

  // Carga las imágenes que cada producto ya tuviera (ej. si el usuario
  // ya había subido fotos antes de entrar al modo bloque).
  useEffect(() => {
    items.forEach((it) => {
      fetch(`${API_BASE}/erp/ordenes/${venta.id}/productos/${encodeURIComponent(it.codigo)}/imagenes`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setImagenesPorProducto((prev) => ({ ...prev, [it.codigo]: data })))
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const actualizarCompartido = (campo: keyof typeof compartido, valor: string) =>
    setCompartido((c) => ({ ...c, [campo]: valor }));

  const actualizarItem = (
    codigo: string,
    campo: "precio_producto" | "precio_flete" | "comodato" | "observaciones_externas" | "montoReferencia",
    valor: string
  ) =>
    setItems((prev) =>
      prev.map((it) => {
        if (it.codigo !== codigo) return it;
        const actualizado = { ...it, [campo]: valor };
        // Recalcula el margen SOLO con el monto_referencia de ESTE
        // producto (nunca con montoVenta de toda la orden) — así cada
        // tab del bloque muestra su margen individual real.
        if (campo === "precio_producto" || campo === "precio_flete" || campo === "montoReferencia") {
          const montoRefNum = actualizado.montoReferencia ? Number(actualizado.montoReferencia) : null;
          const margenCalculado = calcularMargen(
            actualizado.precio_producto,
            it.cantidad,
            actualizado.precio_flete,
            montoRefNum
          );
          actualizado.margen = margenCalculado != null ? String(margenCalculado) : "";
        }
        return actualizado;
      })
    );

  const totalFlete = items.reduce((acc, it) => acc + (parseFloat(it.precio_flete) || 0), 0);
  const totalProductos = items.reduce((acc, it) => acc + (parseFloat(it.precio_producto) || 0), 0);

  const faltantes: string[] = [];
  if (!compartido.proveedor_nombre.trim()) faltantes.push("Proveedor");
  if (!compartido.proveedor_telefono.trim()) faltantes.push("Teléfono proveedor");
  if (!compartido.tipo_envio) faltantes.push("Tipo de envío");
  if (compartido.tipo_envio === "AGENCIA" && !compartido.agencia_transporte.trim()) faltantes.push("Agencia de transporte");
  items.forEach((it) => {
    if (!it.precio_producto.trim()) faltantes.push(`Precio de ${it.codigo}`);
    if (compartido.tipo_envio === "AGENCIA" && !it.precio_flete.trim()) faltantes.push(`Flete de ${it.codigo}`);
  });

  const enviar = async () => {
    setEnviando(true);
    setError("");
    try {
      const r = await fetch(`${API_BASE}/erp/ordenes/${venta.id}/productos/enviar-bloque`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        productos: items.map((it) => ({
            codigo: it.codigo,
            descripcion: it.descripcion,
            precio_producto: it.precio_producto ? parseFloat(it.precio_producto) : null,
            precio_flete: it.precio_flete ? parseFloat(it.precio_flete) : null,
            comodato: it.comodato || null,
            observaciones_externas: it.observaciones_externas || null,
            margen: it.margen || null,
          })),
          datos_compartidos: {
            proveedor_nombre: compartido.proveedor_nombre,
            proveedor_id: compartido.proveedor_id ? parseInt(compartido.proveedor_id, 10) : null,
            proveedor_telefono: compartido.proveedor_telefono,
            tipo_envio: compartido.tipo_envio,
            agencia_transporte: compartido.agencia_transporte,
            transporte_id: compartido.transporte_id ? parseInt(compartido.transporte_id, 10) : null,
            observaciones: compartido.observaciones,
            otras_observaciones: compartido.otras_observaciones,
            observaciones_transporte: compartido.observaciones_transporte,
          },
          rellenado_por: usuarioActual,
          numero_ocam: ocamDe(venta),
          codigo_venta: codigoVentaDe(venta),
        }),
      });
    if (!r.ok) throw new Error((await r.json()).detail || "Error enviando en bloque");
      mostrarToast("success", `${items.length} productos enviados para revisión`);
      onEnviado();
      onCerrar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error desconocido";
      setError(msg);
      mostrarToast("error", msg);
    } finally {
      setEnviando(false);
    }
  };

  // Un solo loader para cualquier operación en curso — nunca se mezclan
  // spinners sueltos ni se puede cerrar el modal a medio guardar.
  const procesando = enviando || confirmando || guardandoBloque || actualizandoErpBloque;
  const mensajeProcesando = enviando
    ? "Enviando productos para revisión…"
    : confirmando
    ? "Confirmando bloque en el ERP…"
    : actualizandoErpBloque
    ? "Actualizando información en el ERP…"
    : guardandoBloque
    ? "Guardando cambios del bloque…"
    : "";

return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {procesando && <OverlayProcesando mensaje={mensajeProcesando} />}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onCerrar} />
      <div className="relative w-full max-w-[1600px] max-h-[92vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
            <div>
            <p className="text-sm font-bold text-slate-800">
              {modo === "ver"
                ? `Bloque confirmado — ${items.length} productos`
                : modo === "confirmar"
                ? `Confirmar bloque — ${items.length} productos`
                : `Enviar ${items.length} productos en bloque`}
            </p>
            <p className="text-[11px] text-slate-400">
              {modo === "ver"
                ? `Enviado por ${primerSeg?.rellenado_por || "—"}${primerSeg?.confirmado_por ? ` · Confirmado por ${primerSeg.confirmado_por}` : ""} · Solo lectura`
                : modo === "confirmar"
                ? `Enviado por ${primerSeg?.rellenado_por || "—"} · revisa, corrige si hace falta y confirma`
                : "Los datos comunes se aplican a todos; precio y flete son por producto"}
            </p>
          </div>
          <button onClick={onCerrar} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

          <div className="p-6 space-y-4">
            <FormularioBloqueModal
              items={items}
              productoInicial={productoInicial}
              montoVenta={montoVenta}
              procesando={procesando}
              actualizarItem={actualizarItem}
              compartido={{
                proveedor_id: compartido.proveedor_id,
                proveedor_nombre: compartido.proveedor_nombre,
                proveedor_telefono: compartido.proveedor_telefono,
                tipo_envio: compartido.tipo_envio,
                transporte_id: compartido.transporte_id,
                agencia_transporte: compartido.agencia_transporte,
                observaciones: compartido.observaciones,
                otras_observaciones: compartido.otras_observaciones,
                observaciones_transporte: compartido.observaciones_transporte,
              }}
              actualizarCompartido={actualizarCompartido}
              soloLectura={soloLectura}
              empresas={empresas || []}
              mostrarSelectorEmpresa={(modo === "confirmar" || modo === "ver") && !!esSeguimiento}
              empresaId={empresaId}
              onEmpresaChange={setEmpresaId}
              totalProductos={totalProductos}
              totalFlete={totalFlete}
              pdfConsolidadoUrl={
                items.some((it) => (imagenesPorProducto[it.codigo] || []).length > 0)
                  ? `${API_BASE}/erp/ordenes/${venta.id}/productos/pdf-consolidado-preview?${items
                      .map((it) => `codigos=${encodeURIComponent(it.codigo)}`)
                      .join("&")}`
                  : null
              }
              renderBuscadorProveedor={() => (
                <BuscadorEntidad<ProveedorOption>
                  label="Proveedor"
                  value={compartido.proveedor_nombre}
                  onChange={(v) => actualizarCompartido("proveedor_nombre", v)}
                  onSeleccionar={(p) => {
                    actualizarCompartido("proveedor_nombre", p.razonSocial);
                    actualizarCompartido("proveedor_id", String(p.id));
                    if (p.telefono) actualizarCompartido("proveedor_telefono", p.telefono);
                  }}
                  opciones={proveedores}
                  cargando={false}
                  disabled={soloLectura}
                  placeholder="Buscar proveedor por razón social..."
                  seleccionado={proveedores.find((p) => p.razonSocial === compartido.proveedor_nombre) || null}
                  onCrearNuevo={() => setModalProveedorAbierto(true)}
                />
              )}
              renderBuscadorTransporte={() => (
                <BuscadorEntidad<TransporteOption>
                  label="Agencia de transporte"
                  value={compartido.agencia_transporte}
                  onChange={(v) => actualizarCompartido("agencia_transporte", v)}
                  onSeleccionar={(t) => {
                    actualizarCompartido("agencia_transporte", t.razonSocial);
                    actualizarCompartido("transporte_id", String(t.id));
                  }}
                  opciones={transportes}
                  cargando={false}
                  disabled={soloLectura}
                  placeholder="Buscar agencia de transporte..."
                  seleccionado={transportes.find((t) => t.razonSocial === compartido.agencia_transporte) || null}
                  onCrearNuevo={() => setModalTransporteAbierto(true)}
                />
              )}
              renderContactoProveedor={() => (
                <ContactoProveedorInfo proveedorId={compartido.proveedor_id ? parseInt(compartido.proveedor_id, 10) : null} />
              )}
              renderSelectorImagenes={(codigo) => (
                <SelectorImagenes
                  ordenCompraId={Number(venta.id)}
                  codigo={codigo}
                  imagenes={imagenesPorProducto[codigo] || []}
                  onCambio={(nuevas) => setImagenesPorProducto((prev) => ({ ...prev, [codigo]: nuevas }))}
                  disabled={soloLectura}
                />
              )}
              cantidadImagenes={(codigo) => (imagenesPorProducto[codigo] || []).length}
              urlOce={venta.documentoOce}
              urlOcf={venta.documentoOcf}
              clienteId={(venta as any).cliente?.id}
              departamentoEntrega={(venta as any).cliente?.departamento}
              provinciaEntrega={(venta as any).cliente?.provincia}
              distritoEntrega={(venta as any).cliente?.distrito}
            />
          {faltantes.length > 0 && modo !== "ver" && (
            <p className="text-[11px] text-amber-600 flex items-start gap-1">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" /> Faltan: {faltantes.join(", ")}
            </p>
          )}
          {error && (
            <p className="text-[11px] text-red-600 flex items-center gap-1">
              <AlertTriangle size={11} /> {error}
            </p>
          )}

      <div className="sticky bottom-0 -mx-6 px-6 py-4 mt-2 bg-white border-t border-slate-200 z-20">
        {modo === "ver" && !esSeguimiento ? (
            <div className="flex items-center justify-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 font-medium rounded-lg py-2.5 text-sm">
              <CheckCircle2 size={14} />
              Este bloque ya fue confirmado{primerSeg?.confirmado_por ? ` por ${primerSeg.confirmado_por}` : ""}. Solo lectura.
            </div>
          ) : modo === "ver" && esSeguimiento ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  if (!onGuardarCambiosBloque) return;
                  setGuardandoBloque(true);
                  setError("");
                  try {
                    await onGuardarCambiosBloque({ items, compartido, empresaId }, opProveedorId, opEmpresaId);
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : "Error guardando cambios del bloque";
                    setError(msg);
                    mostrarToast("error", msg);
                  } finally {
                    setGuardandoBloque(false);
                  }
                }}
                disabled={guardandoBloque || actualizandoErpBloque}
                className="flex items-center justify-center gap-2 bg-white border border-slate-300 text-slate-700 font-medium rounded-lg py-2.5 text-sm disabled:opacity-40 hover:bg-slate-50 transition-colors"
              >
                {guardandoBloque ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Guardar cambios
              </button>
              <button
                onClick={async () => {
                  if (!onActualizarErpBloque) return;
                  setActualizandoErpBloque(true);
                  setError("");
                  try {
                    await onActualizarErpBloque({ items, compartido, empresaId }, opProveedorId, opEmpresaId);
                    mostrarToast("success", `Bloque de ${items.length} productos actualizado en el ERP`);
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : "Error actualizando el bloque en el ERP";
                    setError(msg);
                    mostrarToast("error", msg);
                  } finally {
                    setActualizandoErpBloque(false);
                  }
                }}
                disabled={guardandoBloque || actualizandoErpBloque}
                className="flex items-center justify-center gap-2 bg-indigo-600 text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-40 hover:bg-indigo-700 transition-colors"
              >
                {actualizandoErpBloque ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Actualizar en el ERP
              </button>
            </div>
          ) : (
            <button
              onClick={async () => {
                if (modo === "confirmar") {
                  if (!onConfirmarBloque) return;
                  setConfirmando(true);
                  setError("");
                  try {
                    await onConfirmarBloque({ items, compartido, empresaId });
                    // Confirmar NO cierra el modal — solo "enviar para
                    // revisión" lo hace (ver la función enviar()).
                  } catch (e) {
                    const msg = e instanceof Error ? e.message : "Error confirmando el bloque";
                    setError(msg);
                    mostrarToast("error", msg);
                  } finally {
                    setConfirmando(false);
                  }
                  return;
                }
                enviar();
              }}
              disabled={modo === "confirmar" ? confirmando : (enviando || faltantes.length > 0)}
              className="w-full flex items-center justify-center gap-2 bg-[#10172A] text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-40 hover:bg-[#1B2438] transition-colors"
            >
            {(modo === "confirmar" ? confirmando : enviando) ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              {modo === "confirmar" ? `Confirmar bloque completo (${items.length} productos)` : `Enviar ${items.length} productos para revisión`}
            </button>
          )}
        </div>
        </div>
      </div>
      {modalProveedorAbierto && (
        <ModalCrearProveedor
          onCerrar={() => setModalProveedorAbierto(false)}
          onCreado={(nuevo) => {
            agregarProveedor(nuevo);
            actualizarCompartido("proveedor_nombre", nuevo.razonSocial);
            actualizarCompartido("proveedor_id", String(nuevo.id));
            if (nuevo.telefono) actualizarCompartido("proveedor_telefono", nuevo.telefono);
          }}
        />
      )}
      {modalTransporteAbierto && (
        <ModalCrearTransporte
          onCerrar={() => setModalTransporteAbierto(false)}
          onCreado={(nuevo) => {
            agregarTransporte(nuevo);
            actualizarCompartido("agencia_transporte", nuevo.razonSocial);
            actualizarCompartido("transporte_id", String(nuevo.id));
          }}
        />
      )}
    </div>
  );
}



function PanelConfirmarBloque({
  grupoEnvioId,
  venta,
  seguimientos,
  forms,
  actualizarCampo,
  empresas,
  proveedores,
  transportes,
  agregarProveedor,
  agregarTransporte,
  cargandoProveedores,
  cargandoTransportes,
  imagenesPorProducto,
  setImagenesPorProducto,
  guardandoCodigo,
  confirmandoCodigo,
  empresaSeleccionada,
  onEmpresaChange,
  onGuardarProducto,
  onConfirmarBloque,
  onCerrar,
}: {
  grupoEnvioId: string;
  venta: VentaErp;
  seguimientos: any[];
  forms: Record<string, FormularioProducto>;
  actualizarCampo: (codigo: string, campo: keyof FormularioProducto, valor: string) => void;
  empresas: EmpresaOption[];
  proveedores: ProveedorOption[];
  transportes: TransporteOption[];
  agregarProveedor: (nuevo: ProveedorOption) => void;
  agregarTransporte: (nuevo: TransporteOption) => void;
  cargandoProveedores: boolean;
  cargandoTransportes: boolean;
  imagenesPorProducto: Record<string, ImagenProducto[]>;
  setImagenesPorProducto: React.Dispatch<React.SetStateAction<Record<string, ImagenProducto[]>>>;
  guardandoCodigo: string | null;
  confirmandoCodigo: string | null;
  empresaSeleccionada: string;
  onEmpresaChange: (v: string) => void;
  onGuardarProducto: (codigo: string) => void;
  onConfirmarBloque: () => void;
  onCerrar: () => void;
}) {
  const grupo = seguimientos.filter((s: any) => s.grupo_envio_id === grupoEnvioId);
  const [productoAbierto, setProductoAbierto] = useState<string | null>(
    grupo[0] ? String(grupo[0].producto_codigo).trim() : null
  );
  const [confirmando, setConfirmando] = useState(false);
  const [modalProveedorPara, setModalProveedorPara] = useState<string | null>(null);
  const [modalTransportePara, setModalTransportePara] = useState<string | null>(null);

  const totalProductos = grupo.reduce((acc, s: any) => acc + (Number(s.precio_producto) || 0), 0);
  const totalFlete = grupo.reduce((acc, s: any) => acc + (Number(s.precio_flete) || 0), 0);
  const esAgencia = grupo[0]?.tipo_envio === "AGENCIA";

  const confirmar = async () => {
    setConfirmando(true);
    try {
      await onConfirmarBloque();
    } finally {
      setConfirmando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={onCerrar} />
      <div className="relative w-full max-w-2xl max-h-[88vh] overflow-y-auto bg-white rounded-2xl shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <p className="text-sm font-bold text-slate-800">Confirmar bloque — {grupo.length} productos</p>
            <p className="text-[11px] text-slate-400">
              Enviado por {grupo[0]?.rellenado_por || "—"} · Total productos S/ {totalProductos.toFixed(2)}
              {esAgencia && ` · Total flete S/ ${totalFlete.toFixed(2)}`}
            </p>
          </div>
          <button onClick={onCerrar} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3.5">
            <label className="block text-[11px] font-semibold text-indigo-700 mb-1">
              Empresa para todo el bloque (opcional)
            </label>
            <select
              value={empresaSeleccionada}
              onChange={(e) => onEmpresaChange(e.target.value)}
              className="w-full bg-white border border-indigo-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="">Mantener empresa individual de cada producto</option>
              {empresas.map((em) => (
                <option key={em.id} value={em.id}>{em.razonSocial}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            {grupo.map((seg: any) => {
              const codigo = String(seg.producto_codigo).trim();
              const abierto = productoAbierto === codigo;
              const form = forms[codigo];
              const imagenes = imagenesPorProducto[codigo] || [];
              if (!form) return null;

              return (
                <div key={codigo} className="border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    onClick={() => setProductoAbierto(abierto ? null : codigo)}
                    className="w-full flex items-center justify-between gap-2 px-3.5 py-3 hover:bg-slate-50 transition-colors text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-slate-800">{codigo}</p>
                      <p className="text-[11px] text-slate-500 truncate">{form.proveedor_nombre || "Sin proveedor"}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-bold text-emerald-700">
                        S/ {Number(form.precio_producto || 0).toFixed(2)}
                      </span>
                      {imagenes.length > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
                          <FileText size={10} /> {imagenes.length}
                        </span>
                      )}
                      {abierto ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                    </div>
                  </button>

                  {abierto && (
                    <div className="px-3.5 pb-3.5 pt-1 border-t border-slate-100 space-y-3">
                      <SeccionForm titulo="Proveedor" icono={Package}>
                        <BuscadorEntidad<ProveedorOption>
                          label="Proveedor"
                          value={form.proveedor_nombre}
                          onChange={(v) => actualizarCampo(codigo, "proveedor_nombre", v)}
                          onSeleccionar={(p) => {
                            actualizarCampo(codigo, "proveedor_nombre", p.razonSocial);
                            actualizarCampo(codigo, "proveedor_id", String(p.id));
                            if (p.telefono) actualizarCampo(codigo, "proveedor_telefono", p.telefono);
                          }}
                          opciones={proveedores}
                          cargando={cargandoProveedores}
                          placeholder="Buscar proveedor..."
                          seleccionado={proveedores.find((pv) => pv.razonSocial === form.proveedor_nombre) || null}
                          onCrearNuevo={() => setModalProveedorPara(codigo)}
                        />
                        <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                          <Campo label="Teléfono proveedor" value={form.proveedor_telefono} onChange={(v) => actualizarCampo(codigo, "proveedor_telefono", v)} tipo="telefono" maxLength={20} />
                          <Campo label="Precio producto" value={form.precio_producto} onChange={(v) => actualizarCampo(codigo, "precio_producto", v)} tipo="decimal" placeholder="0.00" />
                        </div>
                        <Campo label="Comodato" value={form.comodato} onChange={(v) => actualizarCampo(codigo, "comodato", v)} placeholder="-" />
                        <Campo label="Observaciones externas" value={form.observaciones_externas} onChange={(v) => actualizarCampo(codigo, "observaciones_externas", v)} placeholder="-" />
                      </SeccionForm>

                      {form.tipo_envio === "AGENCIA" && (
                        <SeccionForm titulo="Transporte" icono={Truck}>
                          <BuscadorEntidad<TransporteOption>
                            label="Agencia transporte"
                            value={form.agencia_transporte}
                            onChange={(v) => actualizarCampo(codigo, "agencia_transporte", v)}
                            onSeleccionar={(t) => {
                              actualizarCampo(codigo, "agencia_transporte", t.razonSocial);
                              actualizarCampo(codigo, "transporte_id", String(t.id));
                            }}
                            opciones={transportes}
                            cargando={cargandoTransportes}
                            placeholder="Buscar agencia..."
                            seleccionado={transportes.find((tp) => tp.razonSocial === form.agencia_transporte) || null}
                            onCrearNuevo={() => setModalTransportePara(codigo)}
                          />
                          <Campo label="Precio flete" value={form.precio_flete} onChange={(v) => actualizarCampo(codigo, "precio_flete", v)} tipo="decimal" placeholder="0.00" />
                          <div>
                            <label className="block text-[11px] font-medium text-slate-500 mb-1">Observaciones transporte</label>
                            <textarea
                              value={form.observaciones_transporte}
                              onChange={(e) => actualizarCampo(codigo, "observaciones_transporte", e.target.value)}
                              rows={3}
                              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                            />
                          </div>
                        </SeccionForm>
                      )}

                      <SeccionForm titulo="Observaciones" icono={MessageSquareText}>
                        <CampoObservaciones value={form.observaciones} onChange={(v) => actualizarCampo(codigo, "observaciones", v)} />
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">Otras observaciones</label>
                          <textarea
                            value={form.otras_observaciones}
                            onChange={(e) => actualizarCampo(codigo, "otras_observaciones", e.target.value)}
                            rows={2}
                            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          />
                        </div>
                      </SeccionForm>

                      <SelectorImagenes
                        ordenCompraId={Number(venta.id)}
                        codigo={codigo}
                        imagenes={imagenes}
                        onCambio={(nuevas) => setImagenesPorProducto((prev) => ({ ...prev, [codigo]: nuevas }))}
                      />

                      <button
                        onClick={() => onGuardarProducto(codigo)}
                        disabled={guardandoCodigo === codigo || confirmandoCodigo === codigo}
                        className="w-full flex items-center justify-center gap-2 bg-white border border-slate-300 text-slate-700 font-medium rounded-lg py-2 text-xs disabled:opacity-40 hover:bg-slate-50 transition-colors"
                      >
                        {guardandoCodigo === codigo ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                        Guardar cambios de este producto
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

<button
            onClick={confirmar}
            disabled={confirmando}
            className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-40 hover:bg-emerald-700 transition-colors"
          >
            {confirmando ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            Confirmar bloque completo ({grupo.length} productos)
          </button>
        </div>
      </div>

      {modalProveedorPara && (
        <ModalCrearProveedor
          onCerrar={() => setModalProveedorPara(null)}
          onCreado={(nuevo) => {
            agregarProveedor(nuevo);
            actualizarCampo(modalProveedorPara, "proveedor_nombre", nuevo.razonSocial);
            actualizarCampo(modalProveedorPara, "proveedor_id", String(nuevo.id));
            if (nuevo.telefono) actualizarCampo(modalProveedorPara, "proveedor_telefono", nuevo.telefono);
          }}
        />
      )}
      {modalTransportePara && (
        <ModalCrearTransporte
          onCerrar={() => setModalTransportePara(null)}
          onCreado={(nuevo) => {
            agregarTransporte(nuevo);
            actualizarCampo(modalTransportePara, "agencia_transporte", nuevo.razonSocial);
            actualizarCampo(modalTransportePara, "transporte_id", String(nuevo.id));
          }}
        />
      )}
    </div>
  );
}



function FormularioCrearProveedor({
  venta,
  usuarioActual,
  esSeguimiento,
  productoInicial,
  grupoInicial,
  onFinalizado,
  tick,
  proveedores,
  transportes,
  cargandoProveedores,
  cargandoTransportes,
  agregarProveedor,
  agregarTransporte,
  ops,
  ultimoEventoOps,
  mostrarToast,   // <-- AGREGAR
}: {
  venta: VentaErp;
  usuarioActual: string;
  esSeguimiento: boolean;
  productoInicial?: string;
  grupoInicial?: string;
  onFinalizado: () => void;
  tick?: number;
  proveedores: ProveedorOption[];
  transportes: TransporteOption[];
  cargandoProveedores: boolean;
  cargandoTransportes: boolean;
  agregarProveedor: (nuevo: ProveedorOption) => void;
  agregarTransporte: (nuevo: TransporteOption) => void;
  ops?: OpResumen[];
  ultimoEventoOps?: { tipo: string; orden_compra_id?: number } | null;
  mostrarToast: (tipo: "success" | "error", mensaje: string) => void;  // <-- AGREGAR
}) {

  // Si el producto viene acompañado de grupoInicial, significa que
  // pertenece a un envío en BLOQUE — en ese caso NO debe abrirse la
  // tarjeta individual (eso lo maneja el efecto de grupoInicial más
  // abajo, que abre PanelEnvioBloque). Si abrimos ambos a la vez, quedan
  // en conflicto: se ve el modal de bloque encima, pero por debajo la
  // tarjeta individual también quedó "abierta", causando el formulario
  // incorrecto al cerrar o al reabrir.
  const [productoAbierto, setProductoAbierto] = useState<string | null>(
    grupoInicial ? null : (productoInicial ?? null)
  );

  // Si nos llega un producto a abrir (ej. desde Auditoría o una
  // notificación) y NO pertenece a un bloque, lo expandimos apenas se
  // monte o cambie, sin esperar a que el usuario haga clic en la
  // tarjeta. Si SÍ pertenece a un bloque (grupoInicial presente), se
  // deja que el otro efecto abra el panel de bloque en su lugar.
  useEffect(() => {
    if (productoInicial && !grupoInicial) {
      setProductoAbierto(productoInicial);
    }
  }, [productoInicial, grupoInicial]);

  const [forms, setForms] = useState<Record<string, FormularioProducto>>({});

  const [guardandoCodigo, setGuardandoCodigo] = useState<string | null>(null);

  const [confirmandoCodigo, setConfirmandoCodigo] = useState<string | null>(null);

  const [seguimientos, setSeguimientos] = useState<any[]>([]);

  const [error, setError] = useState("");

  const [imagenesPorProducto, setImagenesPorProducto] = useState<Record<string, ImagenProducto[]>>({});

  const [detalleErpPorOp, setDetalleErpPorOp] = useState<Record<number, any>>({});

  useEffect(() => {
    if (!productoAbierto) return;
    const codigo = productoAbierto;
    const opResumen: any = (ops || []).find((op: any) =>
      (op.productos || []).some((pr: any) => String(pr.codigo ?? "").trim() === codigo)
    );
    if (!opResumen || detalleErpPorOp[opResumen.id]) return;
    fetch(`${API_BASE}/erp/ops/${opResumen.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) setDetalleErpPorOp((prev) => ({ ...prev, [opResumen.id]: data }));
      })
      .catch(() => {});
  }, [productoAbierto, ops]);

  const [modoSeleccion, setModoSeleccion] = useState(false);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const [panelBloqueAbierto, setPanelBloqueAbierto] = useState(false);
  const [modalProveedorPara, setModalProveedorPara] = useState<string | null>(null);
  const [modalTransportePara, setModalTransportePara] = useState<string | null>(null);

    // Lista de empresas para el selector — mismo catálogo que ya usa 
    // CrearOrdenModal (EmpresaSelect).
    const [empresas, setEmpresas] = useState<EmpresaOption[]>([]);
    const [cargandoEmpresas, setCargandoEmpresas] = useState(true);
    useEffect(() => {
      listarEmpresas()
        .then(setEmpresas)
        .catch(() => setEmpresas([]))
        .finally(() => setCargandoEmpresas(false));
    }, []);

  // Guarda qué productos ya recibieron su carga inicial de datos desde
  // seguimientos. Permite que un producto que llega YA abierto (ej. desde
  // una notificación) se llene la primera vez, sin que la protección de
  // "no pisar lo que el usuario está tipeando" lo deje vacío para siempre.

  // Códigos de producto que el usuario ACTIVAMENTE editó en este
  // formulario (le dio clic/escribió algo) y todavía no guardó. Solo
  // estos se protegen de ser sobreescritos por datos que llegan por
  // WebSocket — tener el producto simplemente ABIERTO (sin haber
  // tocado nada) ya no cuenta como protegido.
  const [tocadosPorUsuario, setTocadosPorUsuario] = useState<Set<string>>(new Set());



  const [grupoBloqueAbierto, setGrupoBloqueAbierto] = useState<string | null>(null);
  const [productoBloqueDestacado, setProductoBloqueDestacado] = useState<string | null>(null);

  // Si la notificación que abrió este drawer viene de un envío en
  // bloque, abre directo el panel de confirmación de ese bloque —
  // antes se intentaba tratar como un solo producto (_productoAbrir)
  // y nunca encontraba coincidencia porque el bloque no tiene un
  // único código de producto.
  useEffect(() => {
    if (grupoInicial) {
      setGrupoBloqueAbierto(grupoInicial);
      setProductoBloqueDestacado(productoInicial || null);
    }
  }, [grupoInicial, productoInicial]);


  useEffect(() => {
    if (!productoAbierto || !venta?.id || imagenesPorProducto[productoAbierto]) return;
    const codigo = productoAbierto;
    fetch(`${API_BASE}/erp/ordenes/${venta.id}/productos/${encodeURIComponent(codigo)}/imagenes`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setImagenesPorProducto((prev) => ({ ...prev, [codigo]: data })))
      .catch(() => {});
  }, [productoAbierto, venta?.id]);


  // Si el producto se abre y NO tiene datos de Helbot (nadie llenó el
// formulario todavía) pero SÍ existe ya una OP real en el ERP con
// precio cargado ("Llenado directo en el ERP"), precargamos el
// formulario con esos datos reales — así el usuario ve y puede
// editar la información real, en vez de un formulario vacío o un
// resumen de solo lectura.
  useEffect(() => {
    if (!productoAbierto) return;
    const codigo = productoAbierto;
    if (tocadosPorUsuario.has(codigo)) return; // no pisar lo que el usuario ya está editando

    const formActual = forms[codigo];
    if (formActual && (formActual.proveedor_nombre || formActual.precio_producto)) return; // ya tiene datos

    const opResumen: any = (ops || []).find((op: any) =>
      (op.productos || []).some(
        (pr: any) => String(pr.codigo ?? "").trim() === codigo && Number(pr.precioUnitario) > 0
      )
    );
    if (!opResumen) return; // nada real que precargar

    const opReal: any = detalleErpPorOp[opResumen.id] || opResumen;

    const productoErpReal = ((opReal.productos || []) as any[]).find(
      (pr: any) => String(pr.codigo ?? "").trim() === codigo
    );
    const transporteErpReal = (opReal.transportesAsignados || [])[0];

  setForms((f) => ({
    ...f,
    [codigo]: {
      ...(f[codigo] || formularioVacio),
      proveedor_nombre: f[codigo]?.proveedor_nombre || opReal.proveedor?.razonSocial || "",
      proveedor_id: f[codigo]?.proveedor_id || (opReal.proveedorId != null ? String(opReal.proveedorId) : ""),
      proveedor_telefono: f[codigo]?.proveedor_telefono || opReal.proveedor?.telefono || "",
      precio_producto: f[codigo]?.precio_producto || (productoErpReal?.precioUnitario != null ? String(productoErpReal.precioUnitario) : ""),
      agencia_transporte: f[codigo]?.agencia_transporte || transporteErpReal?.transporte?.razonSocial || "",
      transporte_id: f[codigo]?.transporte_id || (transporteErpReal?.transporteId != null ? String(transporteErpReal.transporteId) : ""),
      precio_flete: f[codigo]?.precio_flete || (transporteErpReal?.montoFlete != null ? String(transporteErpReal.montoFlete) : ""),
      tipo_envio: f[codigo]?.tipo_envio || (transporteErpReal ? "AGENCIA" : "ENTIDAD"),
      observaciones: f[codigo]?.observaciones || opReal.notaPedido || "",
      empresa_id: f[codigo]?.empresa_id || (opReal.empresaId != null ? String(opReal.empresaId) : ""),
      empresa_nombre: f[codigo]?.empresa_nombre || opReal.empresa?.razonSocial || "",
    },
  }));
}, [productoAbierto, ops, detalleErpPorOp]);


useEffect(() => {
    if (!grupoBloqueAbierto || !venta?.id) return;
    const codigosDelGrupo = seguimientos
      .filter((s: any) => s.grupo_envio_id === grupoBloqueAbierto)
      .map((s: any) => String(s.producto_codigo).trim());
    // IMPORTANTE: depende también de `seguimientos`, no solo de
    // `grupoBloqueAbierto`. Cuando el drawer se abre directo desde una
    // notificación, grupoBloqueAbierto se setea ANTES de que
    // cargarSeguimientos() termine de traer los datos — con la
    // dependencia vieja (solo [grupoBloqueAbierto]) este efecto corría
    // una sola vez con codigosDelGrupo vacío y nunca se repetía, así
    // que las imágenes de cada producto del bloque nunca se pedían.
    codigosDelGrupo.forEach((codigo) => {
      if (imagenesPorProducto[codigo]) return; // ya cargado
      fetch(`${API_BASE}/erp/ordenes/${venta.id}/productos/${encodeURIComponent(codigo)}/imagenes`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setImagenesPorProducto((prev) => ({ ...prev, [codigo]: data })))
        .catch(() => {});
    });
  }, [grupoBloqueAbierto, seguimientos, venta?.id]);


  // Cuando llega un evento por WebSocket (tick sube), refresca las
  // imágenes/PDF del producto que el usuario tiene abierto en ESE
  // momento, ignorando la caché — así ve en vivo lo que otro usuario
  // subió o borró, sin recargar la página.
// Cuando llega un evento por WebSocket (tick sube), refresca las
  // imágenes/PDF del producto que el usuario tiene abierto en ESE
  // momento, ignorando la caché — así ve en vivo lo que otro usuario
  // subió o borró, sin recargar la página.
  useEffect(() => {
    if (tick === undefined || !productoAbierto || !venta?.id) return;
    const codigo = productoAbierto;
    fetch(`${API_BASE}/erp/ordenes/${venta.id}/productos/${encodeURIComponent(codigo)}/imagenes`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setImagenesPorProducto((prev) => ({ ...prev, [codigo]: data })))
      .catch(() => {});

    // El PDF consolidado se regenera con un nombre NUEVO cada vez que
    // cambian los archivos (y el backend borra el PDF anterior del
    // disco) — por eso hay que refrescar seguimientos también aquí,
    // para traer la pdf_consolidado_url actualizada. Es seguro hacerlo
    // porque cargarSeguimientos() ya protege el producto abierto y no
    // pisa lo que el usuario está escribiendo (ver el efecto de forms).
    cargarSeguimientos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

useEffect(() => {

    const inicial: Record<string, FormularioProducto> = {};

    for (const p of venta.productos || []) {

      const codigo = String(p.codigo ?? p.id ?? "").trim();

      const seg = seguimientos.find(
        (s: any) => String(s.producto_codigo).trim() === codigo
      );

    const precioProductoStr = seg?.precio_producto != null ? String(seg.precio_producto) : "";
    const precioFleteStr = seg?.precio_flete != null ? String(seg.precio_flete) : "";
    const { margen: margenCalc, motivo: motivoCalc } = calcularMargenConMotivo(
      codigo,
      precioProductoStr,
      precioFleteStr,
      venta,
      seguimientos
    );

    inicial[codigo] = {
        proveedor_nombre: seg?.proveedor_nombre ?? "",
        proveedor_id: seg?.proveedor_id != null ? String(seg.proveedor_id) : "",
        proveedor_telefono: seg?.proveedor_telefono ?? "",
        precio_producto: precioProductoStr,
        comodato: seg?.comodato ?? "",
        observaciones_externas: seg?.observaciones_externas ?? "",
        agencia_transporte: seg?.agencia_transporte ?? "",
        transporte_id: seg?.transporte_id != null ? String(seg.transporte_id) : "",
        precio_flete: precioFleteStr,
        observaciones: seg?.observaciones ?? "",
        observaciones_transporte: seg?.observaciones_transporte ?? "",
        otras_observaciones: seg?.otras_observaciones ?? "",
        margen: margenCalc,
        motivo_margen: motivoCalc,
        margen_orden: seg?.margen_orden != null ? String(seg.margen_orden) : "",
        tipo_envio: seg?.tipo_envio ?? "",
        empresa_id: seg?.empresa_id != null ? String(seg.empresa_id) : String((venta as any).empresa?.id ?? ""),
        empresa_nombre: seg?.empresa_nombre ?? (venta as any).empresa?.razonSocial ?? "",
      };
    }

    setForms(inicial);

  }, [venta]);


useEffect(() => {
  if (!seguimientos.length) return;

  setForms((prev) => {
    const nuevo: Record<string, FormularioProducto> = { ...prev };

    for (const p of venta.productos || []) {
      const codigo = String(p.codigo ?? p.id ?? "").trim();

      // Solo protegemos productos que el usuario editó ACTIVAMENTE y
      // no ha guardado todavía. Un producto simplemente abierto (para
      // verlo) sí debe sincronizarse en vivo con lo que llega de otro
      // usuario — si no, nunca se autocompleta al recibir el evento.
      if (tocadosPorUsuario.has(codigo)) continue;

      const seg = seguimientos.find(
        (s: any) => String(s.producto_codigo).trim() === codigo
      );

      if (!seg) continue;

const precioProductoStr = seg.precio_producto != null ? String(seg.precio_producto) : "";
    const precioFleteStr = seg.precio_flete != null ? String(seg.precio_flete) : "";
    const { margen: margenCalc, motivo: motivoCalc } = calcularMargenConMotivo(
      codigo,
      precioProductoStr,
      precioFleteStr,
      venta,
      seguimientos
    );

    nuevo[codigo] = {
        proveedor_nombre: seg.proveedor_nombre ?? "",
        proveedor_id: seg.proveedor_id != null ? String(seg.proveedor_id) : "",
        proveedor_telefono: seg.proveedor_telefono ?? "",
        precio_producto: precioProductoStr,
        comodato: seg.comodato ?? "",
        observaciones_externas: seg.observaciones_externas ?? "",
        agencia_transporte: seg.agencia_transporte ?? "",
        transporte_id: seg.transporte_id != null ? String(seg.transporte_id) : "",
        precio_flete: precioFleteStr,
        observaciones: seg.observaciones ?? "",
        observaciones_transporte: seg.observaciones_transporte ?? "",
        otras_observaciones: seg.otras_observaciones ?? "",
        margen: margenCalc,
        motivo_margen: motivoCalc,
        margen_orden: seg.margen_orden != null ? String(seg.margen_orden) : "",
        tipo_envio: seg.tipo_envio ?? "",
        empresa_id: seg.empresa_id != null ? String(seg.empresa_id) : String((venta as any).empresa?.id ?? ""),
        empresa_nombre: seg.empresa_nombre ?? (venta as any).empresa?.razonSocial ?? "",
      };
    }

    return nuevo;
  });
}, [seguimientos, venta]);

const cargarSeguimientos = useCallback(async () => {
  if (!venta?.id) return;
  const r = await fetch(
    `${API_BASE}/erp/ordenes/${venta.id}/productos-seguimiento`
  );

  if (r.ok) {
    const data = await r.json();
    setSeguimientos(Array.isArray(data) ? data : []);
  }
}, [venta?.id]);

useEffect(() => {
  cargarSeguimientos();
}, [cargarSeguimientos]);

// Se refresca solo cuando otro usuario dispara un evento relevante por
// WebSocket (rellenó, confirmó, subió) — así Wendy ve el cambio de
// estado de "preview" a "confirmado" sin tener que recargar la página.
// Se refresca SOLO cuando llega un evento que de verdad cambió datos de
// seguimiento (rellenó/confirmó/subió) Y corresponde a ESTA venta —
// nunca ante una subida de imagen (producto_imagenes_actualizadas), que
// no toca proveedor/precio/flete/etc. y antes causaba que el formulario
// se viera "vacío" al refrescar de más.
useEffect(() => {
  console.log("🔵 [FormularioCrearProveedor] ultimoEventoOps cambió:", ultimoEventoOps, "| venta.id:", venta?.id);
  if (!ultimoEventoOps) return;
  if (Number(ultimoEventoOps.orden_compra_id) !== Number(venta?.id)) {
    console.log("🔴 NO COINCIDE — orden_compra_id:", Number(ultimoEventoOps.orden_compra_id), "vs venta.id:", Number(venta?.id));
    return;
  }
  console.log("🟢 SÍ coincide, llamando cargarSeguimientos()");
  cargarSeguimientos();
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [ultimoEventoOps]);

// Si el drawer abre directo en un producto (viene de notificación) y ese
// producto todavía no aparece en seguimientos —posible carrera con el
// guardado recién hecho—, reintentamos hasta que llegue.
useEffect(() => {
  if (!productoInicial) return;
  const codigo = productoInicial.trim();
  const yaLlego = seguimientos.some(
    (s: any) => String(s.producto_codigo).trim() === codigo
  );
  if (yaLlego) return;
  const t = setTimeout(() => {
    cargarSeguimientos();
  }, 800);
  return () => clearTimeout(t);
}, [productoInicial, seguimientos, cargarSeguimientos]);


useEffect(() => {
  if (!grupoInicial) return;
  const yaLlego = seguimientos.some((s: any) => s.grupo_envio_id === grupoInicial);
  if (yaLlego) return;
  const t = setTimeout(() => {
    cargarSeguimientos();
  }, 800);
  return () => clearTimeout(t);
}, [grupoInicial, seguimientos, cargarSeguimientos]);


// Escape cierra lo que esté abierto encima, en orden: producto
  // individual -> bloque -> panel de selección múltiple.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (productoAbierto) {
        setProductoAbierto(null);
      } else if (grupoBloqueAbierto) {
        setGrupoBloqueAbierto(null);
      } else if (panelBloqueAbierto) {
        setPanelBloqueAbierto(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [productoAbierto, grupoBloqueAbierto, panelBloqueAbierto]);



const segMap = Object.fromEntries(
  (seguimientos || []).map((s) => [
    String(s.producto_codigo).trim(),
    {
      ...s,
      precio_producto: s.precio_producto ?? "",
      precio_flete: s.precio_flete ?? "",
      proveedor_nombre: s.proveedor_nombre ?? "",
      proveedor_telefono: s.proveedor_telefono ?? "",
      comodato: s.comodato ?? "",
      agencia_transporte: s.agencia_transporte ?? "",
    }
  ])
);




const actualizarCampo = (
    codigo: string,
    campo: keyof FormularioProducto,
    valor: string
) => {

    setForms((f) => {
      const actual = { ...(f[codigo] || formularioVacio), [campo]: valor };

      // Recalcula el margen automáticamente cada vez que cambia el
      // precio del producto o el flete — el usuario nunca lo escribe a
      // mano. Usa montoVenta de la orden como referencia (caso 1
      // producto por orden). Para órdenes con varios productos, este
      // mismo valor por ahora es el margen "individual aproximado";
      // el margen PROMEDIO de la orden se calcula aparte en
      // PanelEnvioBloque/FormularioBloqueModal con el total del bloque.
    if (campo === "precio_producto" || campo === "precio_flete") {
        const { margen, motivo } = calcularMargenConMotivo(
          codigo,
          actual.precio_producto,
          actual.precio_flete,
          venta,
          seguimientos
        );
        actual.margen = margen;
        actual.motivo_margen = motivo;
      }

      return { ...f, [codigo]: actual };
    });

    // Recién AHORA el usuario tocó este producto de verdad — a partir
    // de este momento sí hay que protegerlo de ser sobreescrito.
    setTocadosPorUsuario((prev) => {
      if (prev.has(codigo)) return prev;
      const nuevo = new Set(prev);
      nuevo.add(codigo);
      return nuevo;
    });

};
const guardarProducto = async (codigo: string) => {

    setGuardandoCodigo(codigo);
    setError("");

    try {

        const form = forms[codigo];

        const r = await fetch(
            `${API_BASE}/erp/ordenes/${venta.id}/productos/${encodeURIComponent(codigo)}/rellenar-preview`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                  body: JSON.stringify({
                    ...form,
                    proveedor_id: form.proveedor_id ? parseInt(form.proveedor_id, 10) : null,
                    transporte_id: form.transporte_id ? parseInt(form.transporte_id, 10) : null,
                    empresa_id: form.empresa_id ? parseInt(form.empresa_id, 10) : null,
                    precio_producto: form.precio_producto
                        ? parseFloat(form.precio_producto)
                        : null,
                    precio_flete: form.precio_flete
                        ? parseFloat(form.precio_flete)
                        : null,
                    rellenado_por: usuarioActual,
                    numero_ocam: ocamDe(venta),
                    codigo_venta: codigoVentaDe(venta),
                    producto_descripcion: (venta.productos || []).find(
                      (p: any) => String(p.codigo ?? p.id ?? "").trim() === codigo
                    )?.descripcion,
                }),
            }
        );

        if (!r.ok) {

            const body = await r.json();

            throw new Error(body.detail);

        }

        await cargarSeguimientos();
        setTocadosPorUsuario((prev) => { const n = new Set(prev); n.delete(codigo); return n; });
        mostrarToast("success", "Datos enviados para revisión correctamente");
        onFinalizado();
        setProductoAbierto(null); // "Enviar para revisión" siempre cierra el formulario

    } catch (e) {
        const msg = e instanceof Error ? e.message : "Error desconocido";
        mostrarToast("error", msg);
        setError(msg);

    } finally {

        setGuardandoCodigo(null);

    }

};
const confirmarProductoForm = async (
  codigo: string,
  overrides?: Partial<FormularioProducto>,
  opciones?: { silencioso?: boolean }
  ) => {
  setConfirmandoCodigo(codigo);
  setError("");
  try {
    // IMPORTANTE: seguimiento puede haber tocado el formulario (ej.
    // eligió la agencia de transporte) sin darle antes a "Guardar
    // cambios". Si no se guarda ESTO primero, el backend confirma con
    // los datos VIEJOS que ya estaban en MySQL (sin transporte_id) y
    // subir_producto_al_erp_real() falla con "falta seleccionar la
    // agencia de transporte" — aunque en pantalla sí se veía elegida.
    // Por eso "Confirmar" ahora SIEMPRE guarda primero, automáticamente.
    // `overrides` permite pasar valores (ej. empresa_id elegida para
    // todo el bloque) que AÚN no llegaron al estado `forms` por el
    // delay de setState — evita confirmar con la empresa vieja cuando
    // se confirma un bloque completo en un solo loop síncrono.
    const form = { ...(forms[codigo] || formularioVacio), ...(overrides || {}) };
    const rGuardar = await fetch(
      `${API_BASE}/erp/ordenes/${venta.id}/productos/${encodeURIComponent(codigo)}/actualizar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                    ...form,
                    proveedor_id: form.proveedor_id ? parseInt(form.proveedor_id, 10) : null,
                    transporte_id: form.transporte_id ? parseInt(form.transporte_id, 10) : null,
                    empresa_id: form.empresa_id ? parseInt(form.empresa_id, 10) : null,
                    precio_producto: form.precio_producto
                        ? parseFloat(form.precio_producto)
                        : null,
                    precio_flete: form.precio_flete
                        ? parseFloat(form.precio_flete)
                        : null,
                    rellenado_por: usuarioActual,
                    numero_ocam: ocamDe(venta),
                    codigo_venta: codigoVentaDe(venta),
                    producto_descripcion: (venta.productos || []).find(
                      (p: any) => String(p.codigo ?? p.id ?? "").trim() === codigo
                    )?.descripcion,
                }),
      }
    );
    if (!rGuardar.ok) {
      throw new Error((await rGuardar.json()).detail || "Error guardando cambios antes de confirmar");
    }

    const r = await fetch(
      `${API_BASE}/erp/ordenes/${venta.id}/productos/${encodeURIComponent(codigo)}/confirmar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmado_por: usuarioActual }),
      }
    );
    if (!r.ok) throw new Error((await r.json()).detail || "Error confirmando");
    await cargarSeguimientos();
    setTocadosPorUsuario((prev) => { const n = new Set(prev); n.delete(codigo); return n; });
    if (!opciones?.silencioso) mostrarToast("success", "Producto confirmado y enviado al ERP");
    onFinalizado();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    if (!opciones?.silencioso) mostrarToast("error", msg);
    setError(msg);
    throw e;
  } finally {
    setConfirmandoCodigo(null);
  }
};

const [empresaBloqueSeleccionada, setEmpresaBloqueSeleccionada] = useState<Record<string, string>>({});




const confirmarBloqueForm = async (grupoEnvioId: string) => {
  const codigosDelGrupo = seguimientos
    .filter((s: any) => s.grupo_envio_id === grupoEnvioId)
    .map((s: any) => String(s.producto_codigo).trim());

  const empresaElegida = empresaBloqueSeleccionada[grupoEnvioId];
  const empresaObj = empresaElegida ? empresas.find((e) => String(e.id) === empresaElegida) : null;

  setError("");
  try {
    for (const codigo of codigosDelGrupo) {
      // Si Seguimiento eligió una empresa para el bloque, se la
      // aplicamos a cada producto ANTES de confirmar — así todos
      // quedan con la misma empresa sin tener que entrar uno por uno.
      // El override se pasa DIRECTO a confirmarProductoForm (no solo
      // por actualizarCampo/setForms) porque setForms es asíncrono: en
      // este loop síncrono, forms[codigo] todavía tendría el valor
      // VIEJO cuando confirmarProductoForm lo lee, y se confirmaría
      // con la empresa anterior en vez de la recién elegida.
      const overrides = empresaElegida
        ? { empresa_id: empresaElegida, empresa_nombre: empresaObj?.razonSocial || "" }
        : undefined;
      if (overrides) {
        actualizarCampo(codigo, "empresa_id", overrides.empresa_id!);
        actualizarCampo(codigo, "empresa_nombre", overrides.empresa_nombre!);
      }
    await confirmarProductoForm(codigo, overrides, { silencioso: true });
    }
    mostrarToast("success", `Bloque de ${codigosDelGrupo.length} productos confirmado`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error confirmando el bloque";
    mostrarToast("error", msg);
    setError(msg);
  }
};



const confirmarBloqueDesdeModal = async (
  datos: { items: ProductoBloqueForm[]; compartido: any; empresaId: string }
) => {
  const empresaObj = datos.empresaId ? empresas.find((e) => String(e.id) === datos.empresaId) : null;
  for (const item of datos.items) {
    const codigo = item.codigo;
    const overrides: Partial<FormularioProducto> = {
      proveedor_nombre: datos.compartido.proveedor_nombre,
      proveedor_id: datos.compartido.proveedor_id,
      proveedor_telefono: datos.compartido.proveedor_telefono,
      tipo_envio: datos.compartido.tipo_envio,
      agencia_transporte: datos.compartido.agencia_transporte,
      transporte_id: datos.compartido.transporte_id,
      observaciones: datos.compartido.observaciones,
      otras_observaciones: datos.compartido.otras_observaciones,
      observaciones_transporte: datos.compartido.observaciones_transporte,
      precio_producto: item.precio_producto,
      precio_flete: item.precio_flete,
      comodato: item.comodato,
      observaciones_externas: item.observaciones_externas,
      margen: item.margen,
    };
    if (datos.empresaId) {
      overrides.empresa_id = datos.empresaId;
      overrides.empresa_nombre = empresaObj?.razonSocial || "";
    }
    Object.entries(overrides).forEach(([campo, valor]) => {
      if (valor !== undefined) actualizarCampo(codigo, campo as keyof FormularioProducto, valor as string);
    });
    await confirmarProductoForm(codigo, overrides, { silencioso: true });
  }
  mostrarToast("success", `Bloque de ${datos.items.length} productos confirmado`);
};


// Busca la OP real (del ERP) que contiene cualquiera de los códigos de
// este grupo — es la fuente de verdad de proveedor/empresa actuales.
// Los datos guardados en op_producto_seguimiento pueden desincronizarse
// con el tiempo (ej. si alguien tocó el ERP directo), y mandar esos
// valores viejos al actualizar hace que el backend crea que cambiaste
// de proveedor y arme una OP nueva por error.
function opRealDelGrupo(codigos: string[], ops?: OpResumen[]) {
  return (ops || []).find((op: any) =>
    (op.productos || []).some((pr: any) => codigos.includes(String(pr.codigo ?? "").trim()))
  ) as any;
}

// Arma los overrides comunes (proveedor, transporte, precios, etc.) a
// partir de lo que el usuario tipeó en el modal del bloque — mismo
// patrón que confirmarBloqueDesdeModal, reutilizado también para
// "guardar cambios" y "actualizar ERP" de un bloque ya confirmado.
function armarOverridesBloque(
  item: ProductoBloqueForm,
  compartido: any,
  empresaId: string
): Partial<FormularioProducto> {
  const empresaObj = empresaId ? empresas.find((e) => String(e.id) === empresaId) : null;
  const overrides: Partial<FormularioProducto> = {
    proveedor_nombre: compartido.proveedor_nombre,
    proveedor_id: compartido.proveedor_id,
    proveedor_telefono: compartido.proveedor_telefono,
    tipo_envio: compartido.tipo_envio,
    agencia_transporte: compartido.agencia_transporte,
    transporte_id: compartido.transporte_id,
    observaciones: compartido.observaciones,
    otras_observaciones: compartido.otras_observaciones,
    observaciones_transporte: compartido.observaciones_transporte,
    precio_producto: item.precio_producto,
    precio_flete: item.precio_flete,
    comodato: item.comodato,
    observaciones_externas: item.observaciones_externas,
    margen: item.margen,
  };
  if (empresaId) {
    overrides.empresa_id = empresaId;
    overrides.empresa_nombre = empresaObj?.razonSocial || "";
  }
  return overrides;
}

// Rellena proveedor_id/empresa_id con el valor REAL de la OP existente
// en el ERP, pero SOLO como respaldo — cuando el override que armó
// armarOverridesBloque no trae ya un valor explícito (ej. el usuario
// dejó "Mantener empresa individual de cada producto" en el selector).
// Antes esto pisaba SIEMPRE el valor con el que ya tenía la OP, así
// que si seguimiento cambiaba la empresa (o el proveedor) desde el
// modal del bloque y le daba "Actualizar en el ERP", ese cambio nunca
// se reflejaba — se sobreescribía de vuelta a la empresa vieja justo
// antes de armar el payload.
function forzarIdsRealesBloque(
  overrides: Partial<FormularioProducto>,
  opProveedorId?: number | null,
  opEmpresaId?: number | null
): Partial<FormularioProducto> {
  const forzado = { ...overrides };
  if (!forzado.proveedor_id && opProveedorId != null) {
    forzado.proveedor_id = String(opProveedorId);
  }
  if (!forzado.empresa_id && opEmpresaId != null) {
    const emp = empresas.find((e) => e.id === opEmpresaId);
    forzado.empresa_id = String(opEmpresaId);
    forzado.empresa_nombre = emp?.razonSocial || forzado.empresa_nombre;
  }
  return forzado;
}

// Bloque YA confirmado: guarda cambios en Helbot (MySQL) por cada
// producto del grupo, SIN reenviar al ERP real. Usa el mismo endpoint
// /actualizar que ya usa "Guardar cambios" en el producto individual.
const guardarCambiosBloqueDesdeModal = async (
  datos: { items: ProductoBloqueForm[]; compartido: any; empresaId: string },
  opProveedorId?: number | null,
  opEmpresaId?: number | null
) => {
  for (const item of datos.items) {
    const codigo = item.codigo;
    let overrides = armarOverridesBloque(item, datos.compartido, datos.empresaId);
    overrides = forzarIdsRealesBloque(overrides, opProveedorId, opEmpresaId);
    // actualizarCampo sigue llamándose para que la UI (si el usuario
    // reabre el producto individual después) muestre los valores
    // nuevos — pero YA NO es de lo que depende el guardado real: los
    // overrides se pasan directo a la función, que los usa de inmediato
    // sin esperar a que el estado de React se propague.
    Object.entries(overrides).forEach(([campo, valor]) => {
      if (valor !== undefined) actualizarCampo(codigo, campo as keyof FormularioProducto, valor as string);
    });
  await guardarCambiosSeguimientoForm(codigo, overrides, { silencioso: true });
  }
  mostrarToast("success", `Cambios guardados en ${datos.items.length} productos del bloque`);
};
// Bloque YA confirmado: guarda Y reenvía al ERP real cada producto del
// grupo. Usa el mismo endpoint /actualizar-erp que ya usa "Actualizar
// ERP" en el producto individual — ese endpoint YA emite la alerta
// "op_actualizada_erp" por WebSocket en main.py, así que esto queda en
// tiempo real automáticamente, sin tocar el backend.
const actualizarErpBloqueDesdeModal = async (
  datos: { items: ProductoBloqueForm[]; compartido: any; empresaId: string },
  opProveedorId?: number | null,
  opEmpresaId?: number | null
) => {
  for (const item of datos.items) {
    const codigo = item.codigo;
    let overrides = armarOverridesBloque(item, datos.compartido, datos.empresaId);
    overrides = forzarIdsRealesBloque(overrides, opProveedorId, opEmpresaId);
    Object.entries(overrides).forEach(([campo, valor]) => {
      if (valor !== undefined) actualizarCampo(codigo, campo as keyof FormularioProducto, valor as string);
    });
    await actualizarEnErpForm(codigo, overrides, { silencioso: true });
  }
};
const [actualizandoErpCodigo, setActualizandoErpCodigo] = useState<string | null>(null);

  const actualizarEnErpForm = async (
    codigo: string,
    overrides?: Partial<FormularioProducto>,
    opciones?: { silencioso?: boolean }
  ) => {
  setActualizandoErpCodigo(codigo);
  setError("");
  try {
    // Mismo patrón que confirmarProductoForm — overrides directos, sin
    // depender de que `forms` (estado de React) ya se haya actualizado.
    const form = { ...(forms[codigo] || formularioVacio), ...(overrides || {}) };
    const r = await fetch(
      `${API_BASE}/erp/ordenes/${venta.id}/productos/${encodeURIComponent(codigo)}/actualizar-erp`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
                    ...form,
                    proveedor_id: form.proveedor_id ? parseInt(form.proveedor_id, 10) : null,
                    transporte_id: form.transporte_id ? parseInt(form.transporte_id, 10) : null,
                    empresa_id: form.empresa_id ? parseInt(form.empresa_id, 10) : null,
                    precio_producto: form.precio_producto
                        ? parseFloat(form.precio_producto)
                        : null,
                    precio_flete: form.precio_flete
                        ? parseFloat(form.precio_flete)
                        : null,
                    // El backend (ActualizarYSubirErpRequest en main.py) exige
                    // exactamente "actualizado_por" — mandar "rellenado_por"
                    // causaba un 422 "Field required" antes de tocar nada.
                    actualizado_por: usuarioActual,
                    numero_ocam: ocamDe(venta),
                    codigo_venta: codigoVentaDe(venta),
                    producto_descripcion: (venta.productos || []).find(
                      (p: any) => String(p.codigo ?? p.id ?? "").trim() === codigo
                    )?.descripcion,
                }),
      }
    );
    if (!r.ok) throw new Error((await r.json()).detail || "Error actualizando en el ERP");
    const data = await r.json();
  if (data.error_erp) {
      const msgErp = `Se guardó en Helbot, pero el ERP respondió con error: ${data.error_erp}`;
      if (!opciones?.silencioso) mostrarToast("error", msgErp);
      setError(msgErp);
      // IMPORTANTE: aunque la respuesta HTTP sea 200, error_erp significa
      // que el ERP real NO se actualizó. Se relanza como error para que
      // quien llame en bloque (actualizarErpBloqueDesdeModal) sepa que
      // este producto falló y no muestre un falso "todo bien".
      throw new Error(msgErp);
    } else {
      if (!opciones?.silencioso) mostrarToast("success", "Actualizado en el ERP correctamente");
    }
    await cargarSeguimientos();
    setTocadosPorUsuario((prev) => { const n = new Set(prev); n.delete(codigo); return n; });
    onFinalizado();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    if (!opciones?.silencioso) mostrarToast("error", msg);
    setError(msg);
    // Antes el error se quedaba solo en este catch y nunca se propagaba
    // — por eso el bloque terminaba el loop y mostraba éxito aunque un
    // producto hubiera fallado. Ahora se relanza para que quien llamó
    // esta función (botón individual o loop de bloque) se entere.
    throw e;
  } finally {
    setActualizandoErpCodigo(null);
  }
};


const guardarCambiosSeguimientoForm = async (
  codigo: string,
  overrides?: Partial<FormularioProducto>,
  opciones?: { silencioso?: boolean }
) => {

  setGuardandoCodigo(codigo);
  setError("");
  try {
    // Igual que confirmarProductoForm: los overrides se reciben como
    // parámetro directo, nunca dependiendo de leer `forms[codigo]` del
    // estado de React (que puede estar desactualizado si se llama en
    // loop, como pasa al editar un bloque completo).
    const form = { ...(forms[codigo] || formularioVacio), ...(overrides || {}) };
    const r = await fetch(
      `${API_BASE}/erp/ordenes/${venta.id}/productos/${encodeURIComponent(codigo)}/actualizar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...form,
                    proveedor_id: form.proveedor_id ? parseInt(form.proveedor_id, 10) : null,
                    transporte_id: form.transporte_id ? parseInt(form.transporte_id, 10) : null,
                    empresa_id: form.empresa_id ? parseInt(form.empresa_id, 10) : null,
                    precio_producto: form.precio_producto
                        ? parseFloat(form.precio_producto)
                        : null,
                    precio_flete: form.precio_flete
                        ? parseFloat(form.precio_flete)
                        : null,
                    rellenado_por: usuarioActual,
                    numero_ocam: ocamDe(venta),
                    codigo_venta: codigoVentaDe(venta),
                    producto_descripcion: (venta.productos || []).find(
                      (p: any) => String(p.codigo ?? p.id ?? "").trim() === codigo
                    )?.descripcion,
                }),
      }
    );
    if (!r.ok) throw new Error((await r.json()).detail || "Error guardando cambios");
    await cargarSeguimientos();
    setTocadosPorUsuario((prev) => { const n = new Set(prev); n.delete(codigo); return n; });
    if (!opciones?.silencioso) mostrarToast("success", "Cambios guardados");
    onFinalizado();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    if (!opciones?.silencioso) mostrarToast("error", msg);
    setError(msg);
    throw e;
  } finally {
    setGuardandoCodigo(null);
  }
};


const productosOrdenados = useMemo(() => {
  // Antes de ordenar: colapsa líneas con el MISMO código de producto
  // en una sola tarjeta. El backend guarda el seguimiento por
  // (orden_compra_id, producto_codigo) — dos líneas con igual código
  // en venta.productos son, para Helbot, EL MISMO registro real. Sin
  // este filtro, ambas comparten el mismo string "codigo", así que
  // productoAbierto === codigo hacía que al abrir una tarjeta se
  // abrieran TODAS las que compartían ese código — y "guardar" una en
  // realidad escribía sobre la misma fila que leían las otras, porque
  // solo existe un registro real detrás de esos códigos repetidos.
  // Los productos SIN código (caso raro: p.codigo y p.id vacíos) NO se
  // colapsan entre sí — cada uno conserva su propia tarjeta usando su
  // posición en el array como respaldo, para no ocultar productos
  // legítimos que vinieran sin código.
  const vistos = new Set<string>();
  const sinDuplicados = (venta.productos || []).filter((p: any, idx: number) => {
    const codigoReal = String(p.codigo ?? p.id ?? "").trim();
    const clave = codigoReal || `__sin_codigo_${idx}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });

  const lista = [...sinDuplicados];
  const opDeCodigo = (codigo: string) =>
    (ops || []).find((op: any) =>
      (op.productos || []).some((pr: any) => String(pr.codigo ?? "").trim() === codigo)
    );
  // Un producto sin OP real todavía puede pertenecer a un envío en
  // bloque (grupo_envio_id) — se usa para que la card de un mismo
  // bloque siempre quede adyacente a las demás, en vez de dispersarse
  // según el orden en que vino venta.productos del ERP.
  const grupoDeCodigo = (codigo: string) => {
    const seg = seguimientos.find((s: any) => String(s.producto_codigo).trim() === codigo);
    return seg?.grupo_envio_id || null;
  };
  return lista.sort((a: any, b: any) => {
    const codigoA = String(a.codigo ?? a.id ?? "").trim();
    const codigoB = String(b.codigo ?? b.id ?? "").trim();
    const opA: any = opDeCodigo(codigoA);
    const opB: any = opDeCodigo(codigoB);
    if (opA || opB) {
      if (!opA && !opB) return 0;
      if (!opA) return 1;
      if (!opB) return -1;
      return String(opA.codigoOp || "").localeCompare(String(opB.codigoOp || ""), undefined, {
        numeric: true,
      });
    }
    const grupoA = grupoDeCodigo(codigoA);
    const grupoB = grupoDeCodigo(codigoB);
    if (grupoA === grupoB) return 0;
    if (!grupoA) return 1;
    if (!grupoB) return -1;
    return grupoA.localeCompare(grupoB);
  });
}, [venta.productos, ops, seguimientos]);






return (
  <div className="p-5 space-y-4">

    {grupoBloqueAbierto && (() => {
        const productosDelGrupo = seguimientos.filter((s: any) => s.grupo_envio_id === grupoBloqueAbierto);
        const grupoYaConfirmado =
          productosDelGrupo.length > 0 &&
          productosDelGrupo.every((s: any) => s.estado === "confirmado" || s.estado === "subido");
        const modoModal: "confirmar" | "ver" = esSeguimiento && !grupoYaConfirmado ? "confirmar" : "ver";

        // Si el bloque ya tiene una OP real creada en el ERP, esa OP es
        // la ÚNICA fuente de verdad de proveedor/empresa — no lo que
        // haya quedado en op_producto_seguimiento. Se usa para precargar
        // el modal y para forzar (overridear) esos campos en cada
        // producto del grupo antes de guardar/actualizar, así el
        // backend nunca detecta un "cambio de proveedor" que no existió
        // y crea una OP duplicada.
        const codigosGrupo = productosDelGrupo.map((s: any) => String(s.producto_codigo).trim());
        const opReal = opRealDelGrupo(codigosGrupo, ops);
        const empresaRealId = opReal ? String(opReal.empresaId ?? "") : "";

        // Si el bloque se abrió desde Auditoría/notificación y todavía no
        // llegaron sus seguimientos (fetch en curso), no montamos el modal
        // con datos vacíos — esperamos a que cargarSeguimientos() traiga
        // el bloque real (el useEffect de reintento cada 800ms ya se
        // encarga de eso). Evita el destello de "Bloque confirmado — 0
        // productos" que se veía antes de que llegara la data.
        if (productosDelGrupo.length === 0) {
          return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[1px]" onClick={() => { setGrupoBloqueAbierto(null); setProductoBloqueDestacado(null); }} />
              <div className="relative bg-white rounded-2xl shadow-2xl px-8 py-6 flex items-center gap-3">
                <Loader2 size={18} className="animate-spin text-[#4F46E5]" />
                <p className="text-sm text-slate-600">Cargando datos del bloque…</p>
              </div>
            </div>
          );
        }

        return (
          <PanelEnvioBloque
            // key con la cantidad de productos del grupo: mientras
            // seguimientos no haya cargado los datos reales del bloque,
            // productosDelGrupo.length es 0 y el modal nace vacío (useState
            // solo lee el valor inicial una vez). En cuanto cargarSeguimientos()
            // trae los datos reales, este key cambia (0 -> N) y React
            // DESMONTA y VUELVE A MONTAR PanelEnvioBloque desde cero, esta
            // vez con seguimientosGrupo ya lleno — así items/compartido se
            // inicializan con los datos correctos en vez de quedar
            // congelados en vacío para siempre.
            key={`${grupoBloqueAbierto}-${productosDelGrupo.length}`}
            modo={modoModal}
            venta={venta}
            codigosSeleccionados={[]}
            seguimientosGrupo={productosDelGrupo}
            todosSeguimientos={seguimientos}
            proveedores={proveedores}
            transportes={transportes}
            agregarProveedor={agregarProveedor}
            agregarTransporte={agregarTransporte}
            usuarioActual={usuarioActual}
            mostrarToast={mostrarToast}
            empresas={empresas}
            esSeguimiento={esSeguimiento}
            empresaSeleccionadaInicial={
              grupoYaConfirmado && empresaRealId
                ? empresaRealId
                : empresaBloqueSeleccionada[grupoBloqueAbierto] || ""
            }
            opProveedorId={opReal ? opReal.proveedorId : undefined}
            opEmpresaId={opReal ? opReal.empresaId : undefined}
            productoInicial={productoBloqueDestacado}
            montoVenta={Number((venta as any)?.montoVenta) || null}
            onConfirmarBloque={confirmarBloqueDesdeModal}
            onGuardarCambiosBloque={guardarCambiosBloqueDesdeModal}
            onActualizarErpBloque={actualizarErpBloqueDesdeModal}
            onCerrar={() => { setGrupoBloqueAbierto(null); setProductoBloqueDestacado(null); }}
            onEnviado={() => {
              cargarSeguimientos();
              onFinalizado();
            }}
          />
        );
      })()}
  <div className="flex items-center justify-between">
    <h3 className="text-sm font-semibold text-slate-800">
      Productos de la venta
    </h3>
    {!esSeguimiento && (
      <button
        onClick={() => {
          setModoSeleccion((m) => !m);
          setSeleccionados(new Set());
        }}
        className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
          modoSeleccion
            ? "bg-slate-800 text-white border-slate-800"
            : "bg-white text-[#4F46E5] border-indigo-200 hover:bg-indigo-50"
        }`}
      >
        {modoSeleccion ? "Cancelar selección" : "Seleccionar varios"}
      </button>
    )}
  </div>
    {venta.productos?.length === 0 && (
      <p className="text-sm text-slate-400">
        No existen productos.
      </p>
    )}

{(() => { let opAnteriorId: number | null = null; let grupoAnterior: string | null = null; return productosOrdenados.map((p: any) => {

const codigo = String(p.codigo ?? p.id ?? "").trim();

    const opReal: any = (ops || []).find((op: any) =>
      (op.productos || []).some((pr: any) => String(pr.codigo ?? "").trim() === codigo)
    );


    const detalleOpReal = opReal ? detalleErpPorOp[opReal.id] : null;
    const transporteDetalle = detalleOpReal ? (detalleOpReal.transportesAsignados || [])[0] : null;
  const evidenciaErp = detalleOpReal
  ? {
      cotizacionTransporte: transporteDetalle?.cotizacionTransporte || null,
      guiaRemision: transporteDetalle?.guiaRemision || null,
      archivoFactura: transporteDetalle?.archivoFactura || null,
      otros: detalleOpReal?.notaAdicional || null,
      pagos: (detalleOpReal.pagos || []).map((p: any) => ({
        id: p.id,
        archivoPago: p.archivoPago || null,
        descripcionPago: p.descripcionPago || null,
        montoPago: p.montoPago ?? null,

        // Campos reales que vienen del fetch
        fecha: p.fechaPago || null,
        banco: p.bancoPago || null,
        encargado: p.encargadoPago || null,
        verificado: !!p.estadoPago,

        // Opcional: conservar también los nombres originales
        fechaPago: p.fechaPago || null,
        bancoPago: p.bancoPago || null,
        encargadoPago: p.encargadoPago || null,
        estadoPago: !!p.estadoPago,

        createdAt: p.createdAt || null,
        updatedAt: p.updatedAt || null,
      })),
    }
  : null;



    const seg =
      seguimientos.find(
        (s: any) => String(s.producto_codigo).trim() === codigo
      ) || {
        estado: "pendiente",
        proveedor_nombre: "",
        proveedor_telefono: "",
        precio_producto: "",
        comodato: "",
        agencia_transporte: "",
        precio_flete: "",
        observaciones: "",
      };

    // Un producto marca "nuevo grupo visual" cuando cambia la OP real a
    // la que pertenece, O -si todavía no tiene OP- cuando cambia el
    // grupo_envio_id del envío en bloque al que pertenece. Así los
    // productos de un mismo bloque quedan siempre juntos, bajo un solo
    // encabezado clicable, en vez de repetirse card por card sin contexto.
    const grupoEnvioActual = !opReal ? (seg.grupo_envio_id || null) : null;
    const esNuevoGrupo = (opReal?.id ?? null) !== opAnteriorId || grupoEnvioActual !== grupoAnterior;
    opAnteriorId = opReal?.id ?? null;
    grupoAnterior = grupoEnvioActual;
    const productoErpReal = opReal
      ? ((opReal.productos || []) as any[]).find((pr: any) => String(pr.codigo ?? "").trim() === codigo)
      : null;

    // Empresa asignada a la OP de este grupo (busca en el catálogo de
    // empresas ya cargado por empresaId, o cae al objeto empresa si el
    // ERP ya lo trae embebido en la respuesta de la OP).
    const empresaOpNombre = opReal
      ? empresas.find((e) => e.id === opReal.empresaId)?.razonSocial || opReal.empresa?.razonSocial || ""
      : "";

    // "isCompleted" que manda el ERP no es confiable (viene en false aunque
    // el producto YA esté dentro de una OP real, como pasó con OCGRU984).
    // La fuente de verdad real es: ¿el código aparece en alguna OP ya
    // creada en el ERP? Eso ya lo calcula "opReal" arriba.

    const vinoDelFormulario = seg.estado === "confirmado" || seg.estado === "subido";

    const badge = opReal
      ? vinoDelFormulario
        ? { texto: "Formulario · Ya en el ERP", clase: "bg-violet-100 text-violet-700 border-violet-300", icon: ShieldCheck }
        : { texto: "Llenado directo en el ERP", clase: "bg-violet-100 text-violet-700 border-violet-300", icon: ShieldCheck }
      : badgeSeguimiento(seg.estado);
    const BadgeIcon = badge.icon;

    const abierto = productoAbierto === codigo;

    const form = forms[codigo] || formularioVacio;

    const seleccionable = (seg.estado === "pendiente" || seg.estado === "preview") && (!opReal || vinoDelFormulario);

    const soloLectura = esSeguimiento
          ? seg.estado === "pendiente" // seguimiento no edita hasta que haya algo enviado
          : seg.estado === "confirmado" || seg.estado === "subido"; // ventas edita libre en pendiente/preview

    // Precio y total a mostrar en la card: prioriza lo que ya está
    // confirmado en el formulario de seguimiento (seg.precio_producto);
    // si no hay nada ahí, cae al precio real que ya tiene la OP en el ERP.
    const precioMostrar =
      seg.precio_producto != null && seg.precio_producto !== ""
        ? Number(seg.precio_producto)
        : productoErpReal?.precioUnitario != null
        ? Number(productoErpReal.precioUnitario)
        : null;
    const cantidadMostrar = productoErpReal?.cantidad ?? p.cantidad;
    const totalMostrar =
      precioMostrar != null
        ? precioMostrar * (Number(cantidadMostrar) || 0)
        : productoErpReal?.total != null
        ? Number(productoErpReal.total)
        : null;

  return (
        <Fragment key={codigo}>
          {esNuevoGrupo && (
            opReal ? (
              <div className="flex items-center justify-between flex-wrap gap-x-2 gap-y-0.5 mb-1.5 mt-3 first:mt-0">
                <p className="text-[11px] font-bold text-violet-700 uppercase tracking-wide flex items-center gap-1.5">
                  <ShieldCheck size={11} />
                  OP {opReal.codigoOp || `#${opReal.id}`}
                  {opReal.proveedor?.razonSocial ? ` · ${opReal.proveedor.razonSocial}` : ""}
                </p>
                {empresaOpNombre && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-[#4F46E5] border border-indigo-200">
                    {empresaOpNombre}
                  </span>
                )}
              </div>
            ) : grupoEnvioActual ? (
              (() => {
                const grupo = seguimientos.filter((s: any) => s.grupo_envio_id === grupoEnvioActual);
                const totalGrupo = grupo.reduce((acc, s: any) => acc + (Number(s.precio_producto) || 0), 0);
                return (
                  <button
                    type="button"
                    onClick={() => { setGrupoBloqueAbierto(grupoEnvioActual); setProductoBloqueDestacado(null); }}
                    className="w-full text-left flex items-center justify-between flex-wrap gap-x-2 gap-y-0.5 mb-1.5 mt-3 first:mt-0 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors"
                  >
                    <p className="text-[11px] font-bold text-amber-700 uppercase tracking-wide flex items-center gap-1.5">
                      <Package size={11} />
                      Bloque de {grupo.length} productos · Enviado por {grupo[0]?.rellenado_por || "—"} · Total S/ {totalGrupo.toFixed(2)}
                    </p>
                    <span className="text-[10px] font-semibold text-amber-700 flex items-center gap-1">
                      Ver bloque completo <ChevronRight size={11} />
                    </span>
                  </button>
                );
              })()
            ) : (
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1.5 mt-3 first:mt-0">
                Sin orden de proveedor generada
              </p>
            )
          )}
          <div
              className={`border rounded-xl overflow-hidden ${
                (opReal || seg.estado === "confirmado" || seg.estado === "subido")
                  ? "border-violet-300 bg-violet-50/30"
                  : seg.estado === "preview"
                  ? "border-amber-300 bg-amber-50/40"
                  : "border-slate-200"
              }`}
           >

          <div className="w-full flex items-center gap-2 px-3.5 py-3 hover:bg-slate-50/70">
            {modoSeleccion && !esSeguimiento && (
              <input
                type="checkbox"
                disabled={!seleccionable}
                checked={seleccionados.has(codigo)}
                onClick={(e) => e.stopPropagation()}
                onChange={() =>
                  setSeleccionados((prev) => {
                    const nuevo = new Set(prev);
                    if (nuevo.has(codigo)) nuevo.delete(codigo);
                    else nuevo.add(codigo);
                    return nuevo;
                  })
                }
                className="w-4 h-4 rounded border-slate-300 text-[#4F46E5] focus:ring-indigo-500 shrink-0 disabled:opacity-30"
              />
            )}
          <button
              onClick={() => {
                // Un producto que pertenece a un envío en bloque SIEMPRE
                // abre el modal del bloque completo al hacer clic —sin
                // importar si ya tiene OP real en el ERP (confirmado/
                // subido) o si sigue en preview. Antes, al confirmarse
                // (lo que crea la OP real), "!opReal" se volvía false y
                // el clic caía al modal de un solo producto por error.
                if (seg.grupo_envio_id) {
                  setGrupoBloqueAbierto(seg.grupo_envio_id);
                  setProductoBloqueDestacado(codigo);
                  return;
                }
                setProductoAbierto(abierto ? null : codigo);
              }}
              className="flex-1 flex items-center justify-between gap-2 text-left min-w-0"
            >
          <div className="min-w-0 flex-1">

                    <p className="text-xs font-medium text-slate-800 truncate">
                        {p.codigo}
                    </p>

                      <p className="text-[11px] text-slate-500 whitespace-normal break-words">
                        {p.descripcion}
                    </p>
                    <div className="flex items-center flex-wrap gap-1.5 mt-1.5">
                      {p.marca && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md bg-slate-700 text-white">
                          {p.marca}
                        </span>
                      )}
                      {cantidadMostrar != null && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-200">
                          Cant: {cantidadMostrar} {p.unidadMedida || ""}
                        </span>
                      )}
                      {precioMostrar != null && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
                          S/ {precioMostrar.toFixed(2)} c/u
                        </span>
                      )}
                      {totalMostrar != null && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-extrabold px-2 py-1 rounded-md bg-emerald-600 text-white">
                          Total S/ {totalMostrar.toFixed(2)}
                        </span>
                      )}
                    </div>

                </div>

                <div className="flex flex-col items-end gap-1 shrink-0">

                    <span className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap ${badge.clase}`}>

                        <BadgeIcon size={10} />

                        {badge.texto}

                    </span>

                    {seg.grupo_envio_id && (
                      <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border border-indigo-300 bg-indigo-50 text-indigo-700 whitespace-nowrap">
                        <Package size={10} /> Parte de un bloque
                      </span>
                    )}

                    {seg.estado === "preview" && seg.rellenado_por && (
                      <span className="text-[10px] text-amber-700 font-medium whitespace-nowrap">
                        Enviado por {seg.rellenado_por}
                      </span>
                    )}
                    {(seg.estado === "confirmado" || seg.estado === "subido") && seg.confirmado_por && (
                      <span className="text-[10px] text-violet-700 font-medium whitespace-nowrap">
                        Confirmado por {seg.confirmado_por}
                      </span>
                    )}


                    {seg.grupo_envio_id && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setGrupoBloqueAbierto(seg.grupo_envio_id);
                          setProductoBloqueDestacado(codigo);
                        }}
                        className="flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline whitespace-nowrap"
                      >
                        <Package size={10} /> Ver bloque completo
                      </button>
                    )}

                    {abierto ? (
                        <ChevronUp size={14} className="text-slate-400" />
                    ) : (
                        <ChevronRight size={14} className="text-slate-400" />
                    )}

                </div>

            </button>
           
            </div>

            {abierto && (
              <FormularioProductoModal
                codigo={codigo}
                evidenciaErp={evidenciaErp}
                nombreProducto={p.codigo}
                descripcionProducto={p.descripcion}
                cantidad={cantidadMostrar}
                unidadMedida={p.unidadMedida}
                form={form}
                actualizarCampo={actualizarCampo}
                soloLectura={soloLectura}
                proveedores={proveedores}
                transportes={transportes}
                cargandoProveedores={cargandoProveedores}
                cargandoTransportes={cargandoTransportes}
                empresas={empresas}
                cargandoEmpresas={cargandoEmpresas}
                esSeguimiento={esSeguimiento}
                onCrearProveedor={() => setModalProveedorPara(codigo)}
                onCrearTransporte={() => setModalTransportePara(codigo)}
                ordenCompraId={Number(venta.id)}
                imagenes={imagenesPorProducto[codigo] || []}
                onCambiarImagenes={(nuevas) => setImagenesPorProducto((prev) => ({ ...prev, [codigo]: nuevas }))}
                urlOce={venta.documentoOce}
                urlOcf={venta.documentoOcf}
                clienteId={(venta as any).cliente?.id}
                departamentoEntrega={(venta as any).cliente?.departamento}
                provinciaEntrega={(venta as any).cliente?.provincia}
                distritoEntrega={(venta as any).cliente?.distrito}
                estado={(seg.estado as "pendiente" | "preview" | "confirmado" | "subido") || "pendiente"}
                rellenadoPor={seg.rellenado_por}
                confirmadoPor={seg.confirmado_por}
                pdfConsolidadoUrl={seg.pdf_consolidado_url}
                guardando={guardandoCodigo === codigo}
                confirmando={confirmandoCodigo === codigo}
                actualizandoErp={actualizandoErpCodigo === codigo}
                onEnviarParaRevision={() => guardarProducto(codigo)}
                onGuardarCambios={() => guardarCambiosSeguimientoForm(codigo)}
                onConfirmar={() => confirmarProductoForm(codigo)}
                onActualizarErp={() => actualizarEnErpForm(codigo)}
                onCerrar={() => setProductoAbierto(null)}
                renderBuscadorProveedor={() => (
                  <BuscadorEntidad<ProveedorOption>
                    label="Proveedor"
                    value={form.proveedor_nombre}
                    onChange={(v) => actualizarCampo(codigo, "proveedor_nombre", v)}
                    onSeleccionar={(prov) => {
                      actualizarCampo(codigo, "proveedor_nombre", prov.razonSocial);
                      actualizarCampo(codigo, "proveedor_id", String(prov.id));
                      if (prov.telefono) actualizarCampo(codigo, "proveedor_telefono", prov.telefono);
                    }}
                    opciones={proveedores}
                    cargando={cargandoProveedores}
                    disabled={soloLectura}
                    placeholder="Buscar proveedor por razón social..."
                    seleccionado={proveedores.find((pv) => pv.razonSocial === form.proveedor_nombre) || null}
                    onCrearNuevo={() => setModalProveedorPara(codigo)}
                  />
                )}
                renderBuscadorTransporte={() => (
                  <BuscadorEntidad<TransporteOption>
                    label="Agencia transporte"
                    value={form.agencia_transporte}
                    onChange={(v) => actualizarCampo(codigo, "agencia_transporte", v)}
                    onSeleccionar={(t) => {
                      actualizarCampo(codigo, "agencia_transporte", t.razonSocial);
                      actualizarCampo(codigo, "transporte_id", String(t.id));
                    }}
                    opciones={transportes}
                    cargando={cargandoTransportes}
                    disabled={soloLectura}
                    placeholder="Buscar agencia de transporte..."
                    seleccionado={transportes.find((tp) => tp.razonSocial === form.agencia_transporte) || null}
                    onCrearNuevo={() => setModalTransportePara(codigo)}
                  />
                )}
                renderContactoProveedor={() => (
                  <ContactoProveedorInfo proveedorId={form.proveedor_id ? parseInt(form.proveedor_id, 10) : null} />
                )}
                renderSelectorImagenes={() => (
                  <SelectorImagenes
                    ordenCompraId={Number(venta.id)}
                    codigo={codigo}
                    imagenes={imagenesPorProducto[codigo] || []}
                    onCambio={(nuevas) => setImagenesPorProducto((prev) => ({ ...prev, [codigo]: nuevas }))}
                    disabled={soloLectura}
                  />
                )}
              />
            )}
                  </div>
              </Fragment>
            );
        }); })()}


        {modoSeleccion && seleccionados.size > 0 && (
          <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 bg-slate-900 text-white rounded-full pl-5 pr-2 py-2 shadow-2xl">
            <span className="text-xs font-medium">
              {seleccionados.size} producto{seleccionados.size > 1 ? "s" : ""} seleccionado{seleccionados.size > 1 ? "s" : ""}
            </span>
            <button
              onClick={() => setPanelBloqueAbierto(true)}
              className="flex items-center gap-1.5 bg-[#4F46E5] hover:bg-indigo-600 text-white text-xs font-semibold rounded-full px-4 py-1.5 transition-colors"
            >
              <Send size={12} /> Rellenar y enviar
            </button>
          </div>
        )}

        {panelBloqueAbierto && (
          <PanelEnvioBloque
            venta={venta}
            codigosSeleccionados={Array.from(seleccionados)}
            todosSeguimientos={seguimientos}
            proveedores={proveedores}
            transportes={transportes}
            agregarProveedor={agregarProveedor}
            agregarTransporte={agregarTransporte}
            usuarioActual={usuarioActual}
            mostrarToast={mostrarToast}
            onCerrar={() => setPanelBloqueAbierto(false)}
            onEnviado={() => {
              cargarSeguimientos();
              onFinalizado();
              setModoSeleccion(false);
              setSeleccionados(new Set());
            }}
          />
        )}

        {modalProveedorPara && (
          <ModalCrearProveedor
            onCerrar={() => setModalProveedorPara(null)}
            onCreado={(nuevo) => {
              agregarProveedor(nuevo);
              actualizarCampo(modalProveedorPara, "proveedor_nombre", nuevo.razonSocial);
              actualizarCampo(modalProveedorPara, "proveedor_id", String(nuevo.id));
              if (nuevo.telefono) actualizarCampo(modalProveedorPara, "proveedor_telefono", nuevo.telefono);
            }}
          />
        )}

        {modalTransportePara && (
          <ModalCrearTransporte
            onCerrar={() => setModalTransportePara(null)}
            onCreado={(nuevo) => {
              agregarTransporte(nuevo);
              actualizarCampo(modalTransportePara, "agencia_transporte", nuevo.razonSocial);
              actualizarCampo(modalTransportePara, "transporte_id", String(nuevo.id));
            }}
          />
        )}

  </div>
);
}
// tipo="telefono" -> solo dígitos, espacios y "+" (para formatos como
// "+51 937 119 045"), nunca letras.
// tipo="decimal"  -> solo dígitos y UN punto decimal (para precios),
// evita los caracteres raros que el <input type="number"> del navegador
// sí permite escribir ("e", "+", "-", "--").
function limpiarValorPorTipo(raw: string, tipo?: "telefono" | "decimal" | "entero"): string {
  if (tipo === "telefono") {
    return raw.replace(/[^\d+\s]/g, "");
  }
  if (tipo === "decimal") {
    let limpio = raw.replace(/[^\d.]/g, "");
    const partes = limpio.split(".");
    if (partes.length > 2) {
      limpio = partes[0] + "." + partes.slice(1).join("");
    }
    return limpio;
  }
  if (tipo === "entero") {
    return raw.replace(/\D/g, "");
  }
  return raw;
}

function Campo({
  label,
  value,
  onChange,
  disabled,
  type = "text",
  placeholder,
  tipo,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  type?: string;
  placeholder?: string;
  /** Activa el filtrado de caracteres: "telefono" | "decimal" | "entero" */
  tipo?: "telefono" | "decimal" | "entero";
  maxLength?: number;
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-slate-500 mb-1">{label}</label>
      <input
        type={tipo ? "text" : type}
        inputMode={tipo === "telefono" ? "tel" : tipo === "decimal" ? "decimal" : tipo === "entero" ? "numeric" : undefined}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(limpiarValorPorTipo(e.target.value, tipo))}
        className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500"
      />
    </div>
  );
}