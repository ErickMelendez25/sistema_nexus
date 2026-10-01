"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { DollarSign, Loader2, CheckCircle2, AlertTriangle, X } from "lucide-react";

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
  cancelado?: boolean;
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
  const [omitirPropuesta, setOmitirPropuesta] = useState(true);
  const [precioMinTxt, setPrecioMinTxt] = useState("");
  const [precioMaxTxt, setPrecioMaxTxt] = useState("");
  const [errorInicio, setErrorInicio] = useState("");
  const [cancelando, setCancelando] = useState(false);


  const [totalVivo, setTotalVivo] = useState<number | null>(null);
  const [cargandoTotal, setCargandoTotal] = useState(false);
  const [conteoOcupado, setConteoOcupado] = useState(false);

  useEffect(() => {
    if (!uid || !acuerdoSel || !catalogoSel || !categoriaSel) {
      setTotalVivo(null);
      setConteoOcupado(false);
      return;
    }
    const controlador = new AbortController();
    const temporizador = setTimeout(async () => {
      setCargandoTotal(true);
      try {
        const params = new URLSearchParams({ uid, n_acuerdo: acuerdoSel, n_catalogo: catalogoSel });
        if (categoriaSel) params.set("n_categoria", categoriaSel);
        const r = await fetchConToken(
          `${apiBase}/perucompras/ofertas/contar?${params.toString()}`,
          { signal: controlador.signal }
        );
        const data = await r.json();
        setTotalVivo(data.total ?? null);
        setConteoOcupado(!!data.ocupado);
      } catch {
        if (!controlador.signal.aborted) setTotalVivo(null);
      } finally {
        if (!controlador.signal.aborted) setCargandoTotal(false);
      }
    }, 600);
    return () => {
      clearTimeout(temporizador);
      controlador.abort();
    };
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
    setErrorInicio("");
    const min = precioMinTxt.trim() === "" ? null : parseFloat(precioMinTxt.replace(",", "."));
    const max = precioMaxTxt.trim() === "" ? null : parseFloat(precioMaxTxt.replace(",", "."));
    if ((min !== null && (Number.isNaN(min) || min <= 0)) || (max !== null && (Number.isNaN(max) || max <= 0))) {
      setErrorInicio("El precio mínimo y el máximo deben ser números mayores que 0 (o déjalos vacíos).");
      return;
    }
    if (min !== null && max !== null && min >= max) {
      setErrorInicio("El precio mínimo debe ser menor que el precio máximo.");
      return;
    }

    setLanzando(true);
    onEstadoChange?.(true);
    try {
      const params = new URLSearchParams({
        uid,
        saltar_existentes: String(saltarExistentes),
        omitir_propuesta: String(omitirPropuesta),
      });
      if (acuerdoSel) params.set("n_acuerdo", acuerdoSel);
      if (catalogoSel) params.set("n_catalogo", catalogoSel);
      if (categoriaSel) params.set("n_categoria", categoriaSel);
      if (min !== null) params.set("precio_min", String(min));
      if (max !== null) params.set("precio_max", String(max));

      const r = await fetchConToken(`${apiBase}/perucompras/ofertas/ejecutar?${params.toString()}`, { method: "POST" });
      if (!r.ok) {
        let detalle = `Error HTTP ${r.status}`;
        try {
          const d = await r.json();
          if (d?.detail) detalle = String(d.detail);
        } catch {}
        setErrorInicio(detalle);
        onEstadoChange?.(false);
        return;
      }
      if (!intervalo.current) intervalo.current = setInterval(consultarEstado, 3000);
      await consultarEstado();
    } finally {
      setLanzando(false);
    }
  };

  const cancelarBusqueda = async () => {
    setCancelando(true);
    try {
      await fetchConToken(`${apiBase}/perucompras/ofertas/cancelar`, { method: "POST" });
      if (!intervalo.current) intervalo.current = setInterval(consultarEstado, 3000);
      await consultarEstado();
    } catch {
      setCancelando(false);
    }
  };

  // El botón vuelve a la normalidad cuando el backend confirma que ya paró
  useEffect(() => {
    if (estado && !estado.corriendo) setCancelando(false);
  }, [estado]);

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

        <label className="flex items-center gap-1.5 text-xs text-slate-500 select-none">
          <input
            type="checkbox"
            checked={omitirPropuesta}
            onChange={(e) => setOmitirPropuesta(e.target.checked)}
            disabled={corriendo}
          />
          Omitir productos en PROPUESTA
        </label>

        <div className="flex items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            placeholder="Precio mín."
            value={precioMinTxt}
            onChange={(e) => setPrecioMinTxt(e.target.value)}
            disabled={corriendo}
            title="Opcional. La búsqueda NO probará precios por debajo de este valor. Vacío = empieza desde 0.10"
            className="w-24 text-xs border border-slate-200 rounded-md px-2 py-1.5 disabled:opacity-50"
          />
          <span className="text-xs text-slate-400">–</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="Techo máx."
            value={precioMaxTxt}
            onChange={(e) => setPrecioMaxTxt(e.target.value)}
            disabled={corriendo}
            title="Opcional. La búsqueda NO probará ni reportará precios por encima de este valor. Vacío = techo de 500"
            className="w-24 text-xs border border-slate-200 rounded-md px-2 py-1.5 disabled:opacity-50"
          />
        </div>
      </div>

      <p className="text-[11px] leading-snug text-slate-400">
        {omitirPropuesta ? (
          <>
            <strong className="text-amber-600">Marcado:</strong> los productos con estado{" "}
            <strong>PROPUESTA</strong> (nuevos, nadie ha presentado ofertas) NO se tocan: no se les busca
            precio máximo ni se les cambia nada en Perú Compras. Solo se procesan los demás.
          </>
        ) : (
          <>
            <strong className="text-slate-500">Sin marcar:</strong> se procesan TODOS los productos, incluidos
            los que están en PROPUESTA (se les busca el precio máximo y se les pone ese precio).
          </>
        )}
      </p>

      <p className="text-[11px] leading-snug text-slate-400">
        <strong className="text-slate-500">Rango de precios (opcional):</strong> la búsqueda solo prueba valores
        entre el mínimo y el techo máximo. Mínimo vacío = parte desde 0.10. Máximo vacío = techo de 500. Puedes
        llenar solo uno de los dos. Ej.: mín 300 y máx 1500 para productos de ~1000. Si en ese rango Perú Compras
        no acepta nada, el producto queda como <strong>sin_rango_encontrado</strong>.
      </p>

      {errorInicio && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">
          <AlertTriangle size={13} /> {errorInicio}
        </div>
      )}

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

        {corriendo && (
          <button
            type="button"
            onClick={cancelarBusqueda}
            disabled={cancelando || !estado?.corriendo}
            className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-40 transition-colors"
          >
            <X size={14} />
            {cancelando ? "Cancelando..." : "Cancelar búsqueda"}
          </button>
        )}

        {cargandoTotal ? (
          <span className="text-xs text-slate-500">Contando...</span>
        ) : conteoOcupado ? (
          <span className="text-xs text-amber-600">Conteo no disponible ahora (Perú Compras ocupado)</span>
        ) : totalVivo !== null ? (
          <span className="text-xs text-slate-500">{totalVivo} producto(s) encontrados con este filtro</span>
        ) : null}

        {estado && (
          <div className="text-xs text-slate-500">
            {estado.corriendo ? (
              <span>
                {estado.producto_actual ? `Producto: ${estado.producto_actual} · ` : ""}
                {estado.productos_completados}/{estado.total_productos} producto(s)
              </span>
            ) : estado.cancelado ? (
              <span className="flex items-center gap-1 text-amber-600">
                <AlertTriangle size={12} /> Búsqueda cancelada: {estado.productos_completados} producto(s)
                procesado(s) antes de cancelar
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