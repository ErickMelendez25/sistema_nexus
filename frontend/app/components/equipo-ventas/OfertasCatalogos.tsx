"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { DollarSign, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

import { fetchConToken } from "../../helbot-shared";

interface EstadoOfertas {
  corriendo: boolean;
  producto_actual: string | null;
  productos_completados: number;
  total_productos: number;
  iniciado_en: string | null;
  terminado_en: string | null;
  error: string | null;
  run_id: number | null;
}

interface Opcion {
  value: string;
  text: string;
}

export default function OfertasCatalogos({
  apiBase,
  uid,
  onEstadoChange,
}: {
  apiBase: string;
  uid: string;
  onEstadoChange?: (corriendo: boolean) => void;
}) {
  const [estado, setEstado] = useState<EstadoOfertas | null>(null);
  const [lanzando, setLanzando] = useState(false);
  const intervalo = useRef<ReturnType<typeof setInterval> | null>(null);

  const [acuerdos, setAcuerdos] = useState<Opcion[]>([]);
  const [catalogos, setCatalogos] = useState<Opcion[]>([]);
  const [categorias, setCategorias] = useState<Opcion[]>([]);
  const [acuerdoSel, setAcuerdoSel] = useState("");
  const [catalogoSel, setCatalogoSel] = useState("");
  const [categoriaSel, setCategoriaSel] = useState("");
  const [cargandoOpciones, setCargandoOpciones] = useState(false);
  const [saltarExistentes, setSaltarExistentes] = useState(true);


  const [totalVivo, setTotalVivo] = useState<number | null>(null);
    const [cargandoTotal, setCargandoTotal] = useState(false);

    useEffect(() => {
    if (!uid) return;
    setCargandoTotal(true);
    const params = new URLSearchParams({ uid });
    if (acuerdoSel) params.set("n_acuerdo", acuerdoSel);
    if (catalogoSel) params.set("n_catalogo", catalogoSel);
    if (categoriaSel) params.set("n_categoria", categoriaSel);
    fetchConToken(`${apiBase}/perucompras/ofertas/vivo?${params.toString()}`)
        .then((r) => r.json())
        .then((data) => setTotalVivo(data.total ?? null))
        .catch(() => setTotalVivo(null))
        .finally(() => setCargandoTotal(false));
    }, [apiBase, uid, acuerdoSel, catalogoSel, categoriaSel]);

  const consultarEstado = async () => {
    try {
      const r = await fetchConToken(`${apiBase}/perucompras/ofertas/estado`);
      const data: EstadoOfertas = await r.json();
      setEstado(data);
      onEstadoChange?.(data.corriendo);
      if (!data.corriendo && intervalo.current) {
        clearInterval(intervalo.current);
        intervalo.current = null;
      }
    } catch {}
  };

  useEffect(() => {
    consultarEstado();
    return () => {
      if (intervalo.current) clearInterval(intervalo.current);
    };
  }, []);

  // Carga inicial de acuerdos marco (en vivo desde Perú Compras)
  useEffect(() => {
    if (!uid) return;
    (async () => {
      setCargandoOpciones(true);
      try {
        const r = await fetchConToken(`${apiBase}/perucompras/ofertas/acuerdos?uid=${encodeURIComponent(uid)}`);
        const data = await r.json();
        setAcuerdos(Array.isArray(data.acuerdos) ? data.acuerdos : []);
      } catch {
        setAcuerdos([]);
      } finally {
        setCargandoOpciones(false);
      }
    })();
  }, [apiBase, uid]);

  // Cuando cambia el acuerdo, recarga catálogos y limpia lo que dependía de él
  const cambiarAcuerdo = useCallback(
    async (valor: string) => {
      setAcuerdoSel(valor);
      setCatalogoSel("");
      setCategoriaSel("");
      setCatalogos([]);
      setCategorias([]);
      if (!valor) return;
      setCargandoOpciones(true);
      try {
        const params = new URLSearchParams({ uid, n_acuerdo: valor });
        const r = await fetchConToken(`${apiBase}/perucompras/ofertas/catalogos?${params.toString()}`);
        const data = await r.json();
        setCatalogos(Array.isArray(data.catalogos) ? data.catalogos : []);
      } catch {
        setCatalogos([]);
      } finally {
        setCargandoOpciones(false);
      }
    },
    [apiBase, uid]
  );

  // Cuando cambia el catálogo, recarga categorías
  const cambiarCatalogo = useCallback(
    async (valor: string) => {
      setCatalogoSel(valor);
      setCategoriaSel("");
      setCategorias([]);
      if (!valor) return;
      setCargandoOpciones(true);
      try {
        const params = new URLSearchParams({ uid, n_catalogo: valor });
        const r = await fetchConToken(`${apiBase}/perucompras/ofertas/categorias?${params.toString()}`);
        const data = await r.json();
        setCategorias(Array.isArray(data.categorias) ? data.categorias : []);
      } catch {
        setCategorias([]);
      } finally {
        setCargandoOpciones(false);
      }
    },
    [apiBase, uid]
  );

  const iniciarBusqueda = async () => {
    setLanzando(true);
    onEstadoChange?.(true);
    try {
      const params = new URLSearchParams({ uid, saltar_existentes: String(saltarExistentes) });
      if (acuerdoSel) params.set("n_acuerdo", acuerdoSel);
      if (catalogoSel) params.set("n_catalogo", catalogoSel);
      if (categoriaSel) params.set("n_categoria", categoriaSel);
      await fetchConToken(`${apiBase}/perucompras/ofertas/ejecutar?${params.toString()}`, { method: "POST" });
      intervalo.current = setInterval(consultarEstado, 3000);
      await consultarEstado();
    } finally {
      setLanzando(false);
    }
  };

  const corriendo = estado?.corriendo || lanzando;

  return (
    <div className="flex flex-col gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={acuerdoSel}
          onChange={(e) => cambiarAcuerdo(e.target.value)}
          disabled={corriendo || cargandoOpciones}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600 disabled:opacity-50 max-w-[220px]"
        >
          <option value="">Todos los acuerdos marco</option>
          {acuerdos.map((a) => (
            <option key={a.value} value={a.value}>
              {a.text}
            </option>
          ))}
        </select>

        <select
          value={catalogoSel}
          onChange={(e) => cambiarCatalogo(e.target.value)}
          disabled={corriendo || cargandoOpciones || !acuerdoSel}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600 disabled:opacity-50 max-w-[220px]"
        >
          <option value="">Todos los catálogos</option>
          {catalogos.map((c) => (
            <option key={c.value} value={c.value}>
              {c.text}
            </option>
          ))}
        </select>

        <select
          value={categoriaSel}
          onChange={(e) => setCategoriaSel(e.target.value)}
          disabled={corriendo || cargandoOpciones || !catalogoSel}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600 disabled:opacity-50 max-w-[220px]"
        >
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c.value} value={c.value}>
              {c.text}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1.5 text-xs text-slate-500 select-none">
          <input
            type="checkbox"
            checked={saltarExistentes}
            onChange={(e) => setSaltarExistentes(e.target.checked)}
            disabled={corriendo}
          />
          Saltar productos ya calculados
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={iniciarBusqueda}
          disabled={corriendo}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors"
        >
          {corriendo ? <Loader2 size={15} className="animate-spin" /> : <DollarSign size={15} />}
          {corriendo ? "Buscando precios máximos..." : "Buscar precios máximos"}
        </button>

        {totalVivo !== null && (
            <span className="text-xs text-slate-500">
                {cargandoTotal ? "Contando..." : `${totalVivo} producto(s) encontrados con este filtro`}
            </span>
            )}

        {estado && (
          <div className="text-xs text-slate-500">
            {estado.corriendo ? (
              <span>
                {estado.producto_actual ? `Producto: ${estado.producto_actual} · ` : ""}
                {estado.productos_completados}/{estado.total_productos} producto(s)
              </span>
            ) : estado.error ? (
              <span className="flex items-center gap-1 text-red-600">
                <AlertTriangle size={12} /> {estado.error}
              </span>
            ) : estado.terminado_en ? (
              <span className="flex items-center gap-1 text-emerald-700">
                <CheckCircle2 size={12} /> Última corrida: {estado.productos_completados} producto(s) procesado(s)
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}