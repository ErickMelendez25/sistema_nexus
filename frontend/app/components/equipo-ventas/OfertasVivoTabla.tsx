"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, AlertTriangle, CheckCircle2, Save, ChevronLeft, ChevronRight } from "lucide-react";

import { fetchConToken } from "../../helbot-shared";

interface Opcion {
  value: string;
  text: string;
}

interface ProductoVivo {
  id_catalogo_producto: number;
  descripcion: string;
  moneda: string;
  acuerdo: string;
  catalogo: string;
  categoria: string;
  estado_actual: string;
  precio_actual: number | string | null;
  precio_manual_bd: number | null;
  precio_manual_aceptado: boolean | null;
  precio_manual_actualizado_en: string | null;
  precio_manual_actualizado_por: string | null;
  enviado_en: string | null;
  enviado_por: string | null;
  envio_error: string | null;
}

const POR_PAGINA = 30;

export default function OfertasVivoTabla({ apiBase, uid, tick }: { apiBase: string; uid: string; tick?: number }) {
  const [acuerdos, setAcuerdos] = useState<Opcion[]>([]);
  const [catalogos, setCatalogos] = useState<Opcion[]>([]);
  const [categorias, setCategorias] = useState<Opcion[]>([]);
  const [acuerdoSel, setAcuerdoSel] = useState("");
  const [catalogoSel, setCatalogoSel] = useState("");
  const [categoriaSel, setCategoriaSel] = useState("");

  const [productos, setProductos] = useState<ProductoVivo[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [pagina, setPagina] = useState(1);

  // valores que el usuario está tipeando, por id
  const [borrador, setBorrador] = useState<Record<number, string>>({});
  const [guardando, setGuardando] = useState<Record<number, boolean>>({});
  const [resultadoFila, setResultadoFila] = useState<Record<number, { ok: boolean; detalle: string }>>({});

  const [seleccionados, setSeleccionados] = useState<Set<number>>(new Set());
  const [mostrarModal, setMostrarModal] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const [precioMin, setPrecioMin] = useState("");
  const [precioMax, setPrecioMax] = useState("");

  const [valorLote, setValorLote] = useState("");
  const [guardandoLote, setGuardandoLote] = useState(false);

  const soloEnElTecho = () => {
    setPrecioMin("500");
    setPrecioMax("500");
  };

  const limpiarFiltroPrecio = () => {
    setPrecioMin("");
    setPrecioMax("");
  };

  useEffect(() => {
    if (!uid) return;
    fetchConToken(`${apiBase}/perucompras/ofertas/acuerdos?uid=${encodeURIComponent(uid)}`)
      .then((r) => r.json())
      .then((data) => setAcuerdos(Array.isArray(data.acuerdos) ? data.acuerdos : []))
      .catch(() => setAcuerdos([]));
  }, [apiBase, uid]);

  const cambiarAcuerdo = useCallback(
    async (valor: string) => {
      setAcuerdoSel(valor);
      setCatalogoSel("");
      setCategoriaSel("");
      setCatalogos([]);
      setCategorias([]);
      setPagina(1);
      if (!valor) return;
      const params = new URLSearchParams({ uid, n_acuerdo: valor });
      const r = await fetchConToken(`${apiBase}/perucompras/ofertas/catalogos?${params.toString()}`);
      const data = await r.json();
      setCatalogos(Array.isArray(data.catalogos) ? data.catalogos : []);
    },
    [apiBase, uid]
  );

  const cambiarCatalogo = useCallback(
    async (valor: string) => {
      setCatalogoSel(valor);
      setCategoriaSel("");
      setCategorias([]);
      setPagina(1);
      if (!valor) return;
      const params = new URLSearchParams({ uid, n_catalogo: valor });
      const r = await fetchConToken(`${apiBase}/perucompras/ofertas/categorias?${params.toString()}`);
      const data = await r.json();
      setCategorias(Array.isArray(data.categorias) ? data.categorias : []);
    },
    [apiBase, uid]
  );

  const cambiarCategoria = (valor: string) => {
    setCategoriaSel(valor);
    setPagina(1);
  };

  const cargarVivo = useCallback(async () => {
    if (!uid) return;
    setCargando(true);
    setError("");

    const params = new URLSearchParams({ uid });
    if (acuerdoSel) params.set("n_acuerdo", acuerdoSel);
    if (catalogoSel) params.set("n_catalogo", catalogoSel);
    if (categoriaSel) params.set("n_categoria", categoriaSel);
    const url = `${apiBase}/perucompras/ofertas/vivo?${params.toString()}`;

    // Reintenta automáticamente: si hay una búsqueda de precios máximos
    // corriendo, /vivo puede tardar y devolver 504 (ver backend) o
    // fallar por un corte de red transitorio. En vez de mostrar el error
    // crudo al primer intento, probamos hasta 3 veces con espera
    // creciente antes de rendirnos de verdad.
    const MAX_INTENTOS = 3;
    let ultimoError = "";
    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
      try {
        const r = await fetchConToken(url);
        if (!r.ok) {
          if (r.status === 504 && intento < MAX_INTENTOS) {
            ultimoError = "Perú Compras está ocupado (hay una búsqueda corriendo) — reintentando...";
            setError(ultimoError);
            await new Promise((res) => setTimeout(res, 2000 * intento));
            continue;
          }
          throw new Error(`Error HTTP ${r.status}`);
        }
        const data = await r.json();
        const filas: ProductoVivo[] = Array.isArray(data.productos) ? data.productos : [];
        setProductos(filas);
        setPagina(1);
        setSeleccionados(new Set());
        const inicial: Record<number, string> = {};
        filas.forEach((f) => {
          inicial[f.id_catalogo_producto] = f.precio_manual_bd !== null ? String(f.precio_manual_bd) : "";
        });
        setBorrador(inicial);
        setError("");
        setCargando(false);
        return;
      } catch (e) {
        ultimoError = e instanceof Error ? e.message : "Error cargando datos en vivo";
        if (intento < MAX_INTENTOS) {
          setError(`${ultimoError} — reintentando...`);
          await new Promise((res) => setTimeout(res, 2000 * intento));
        }
      }
    }
    setError(ultimoError);
    setProductos([]);
    setCargando(false);
  }, [apiBase, uid, acuerdoSel, catalogoSel, categoriaSel]);

  useEffect(() => {
    cargarVivo();
  }, [cargarVivo, tick]);

  const guardarPrecio = async (fila: ProductoVivo) => {
    const texto = (borrador[fila.id_catalogo_producto] || "").replace(",", ".");
    const precio = parseFloat(texto);
    if (!texto || Number.isNaN(precio) || precio <= 0) {
      setResultadoFila((prev) => ({ ...prev, [fila.id_catalogo_producto]: { ok: false, detalle: "Precio inválido" } }));
      return;
    }
    setGuardando((prev) => ({ ...prev, [fila.id_catalogo_producto]: true }));
    try {
      const params = new URLSearchParams({
        uid,
        id_catalogo_producto: String(fila.id_catalogo_producto),
        moneda: fila.moneda,
        precio: String(precio),
      });
      const r = await fetchConToken(`${apiBase}/perucompras/ofertas/precio-manual?${params.toString()}`, { method: "POST" });
      const data = await r.json();
      setResultadoFila((prev) => ({ ...prev, [fila.id_catalogo_producto]: { ok: !!data.ok, detalle: data.detalle || "" } }));
      setProductos((prev) =>
        prev.map((p) =>
          p.id_catalogo_producto === fila.id_catalogo_producto
            ? {
                ...p,
                precio_actual: precio,
                precio_manual_bd: precio,
                precio_manual_aceptado: !!data.ok,
                // guardar un precio nuevo invalida cualquier envío previo (ver backend)
                enviado_en: null,
                enviado_por: null,
                envio_error: null,
              }
            : p
        )
      );
    } catch (e) {
      setResultadoFila((prev) => ({
        ...prev,
        [fila.id_catalogo_producto]: { ok: false, detalle: e instanceof Error ? e.message : "Error de red" },
      }));
    } finally {
      setGuardando((prev) => ({ ...prev, [fila.id_catalogo_producto]: false }));
    }
  };

  const puedeEnviar = (f: ProductoVivo) => f.precio_manual_aceptado === true && f.precio_manual_bd !== null;

  const productosFiltrados = productos.filter((p) => {
    const valor = p.precio_actual !== null && p.precio_actual !== "" ? Number(p.precio_actual) : null;
    if (precioMin !== "" && (valor === null || valor < Number(precioMin))) return false;
    if (precioMax !== "" && (valor === null || valor > Number(precioMax))) return false;
    return true;
  });

  const filasPagina = productosFiltrados.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  const totalPaginas = Math.max(1, Math.ceil(productosFiltrados.length / POR_PAGINA));

  const alternarSeleccion = (id: number) => {
    setSeleccionados((prev) => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const alternarTodosPagina = () => {
    const idsPagina = filasPagina.map((f) => f.id_catalogo_producto);
    const todosMarcados = idsPagina.length > 0 && idsPagina.every((id) => seleccionados.has(id));
    setSeleccionados((prev) => {
      const s = new Set(prev);
      idsPagina.forEach((id) => (todosMarcados ? s.delete(id) : s.add(id)));
      return s;
    });
  };

  const enviarOfertas = async (ids: number[]) => {
    setEnviando(true);
    try {
      const params = new URLSearchParams({ uid });
      ids.forEach((id) => params.append("ids", String(id)));
      const r = await fetchConToken(`${apiBase}/perucompras/ofertas/enviar-vivo?${params.toString()}`, { method: "POST" });
      const data = await r.json();
      const resultados: { id_catalogo_producto: number; ok: boolean; error: string }[] = data.resultados || [];
      const porId = new Map(resultados.map((r) => [r.id_catalogo_producto, r]));
      setProductos((prev) =>
        prev.map((p) => {
          const res = porId.get(p.id_catalogo_producto);
          if (!res) return p;
          return res.ok
            ? { ...p, enviado_en: new Date().toISOString(), envio_error: null }
            : { ...p, envio_error: res.error };
        })
      );
      setSeleccionados(new Set());
    } finally {
      setEnviando(false);
      setMostrarModal(false);
    }
  };

  const guardarPrecioLote = async () => {
    const texto = valorLote.replace(",", ".");
    const precio = parseFloat(texto);
    if (!texto || Number.isNaN(precio) || precio <= 0 || seleccionados.size === 0) return;

    const ids = Array.from(seleccionados);
    const moneda = productos.find((p) => p.id_catalogo_producto === ids[0])?.moneda || "PEN";

    setGuardandoLote(true);
    try {
      const params = new URLSearchParams({ uid, precio: String(precio), moneda });
      ids.forEach((id) => params.append("ids", String(id)));
      const r = await fetchConToken(`${apiBase}/perucompras/ofertas/precio-manual-lote?${params.toString()}`, { method: "POST" });
      const data = await r.json();
      const resultados: { id_catalogo_producto: number; ok: boolean }[] = data.resultados || [];
      const porId = new Map(resultados.map((x) => [x.id_catalogo_producto, x.ok]));

      setProductos((prev) =>
        prev.map((p) => {
          if (!porId.has(p.id_catalogo_producto)) return p;
          return {
            ...p,
            precio_actual: precio,
            precio_manual_bd: precio,
            precio_manual_aceptado: porId.get(p.id_catalogo_producto)!,
            enviado_en: null,
            enviado_por: null,
            envio_error: null,
          };
        })
      );
      setBorrador((prev) => {
        const nuevo = { ...prev };
        ids.forEach((id) => (nuevo[id] = String(precio)));
        return nuevo;
      });
      setValorLote("");
    } finally {
      setGuardandoLote(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select
          value={acuerdoSel}
          onChange={(e) => cambiarAcuerdo(e.target.value)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600 max-w-[220px]"
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
          disabled={!acuerdoSel}
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
          onChange={(e) => cambiarCategoria(e.target.value)}
          disabled={!catalogoSel}
          className="text-xs border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-600 disabled:opacity-50 max-w-[220px]"
        >
          <option value="">Todas las categorías</option>
          {categorias.map((c) => (
            <option key={c.value} value={c.value}>
              {c.text}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <input
            type="number"
            step="0.01"
            placeholder="Precio min"
            value={precioMin}
            onChange={(e) => setPrecioMin(e.target.value)}
            className="w-24 text-xs border border-slate-200 rounded-md px-2 py-1.5"
          />
          <span className="text-xs text-slate-400">–</span>
          <input
            type="number"
            step="0.01"
            placeholder="Precio max"
            value={precioMax}
            onChange={(e) => setPrecioMax(e.target.value)}
            className="w-24 text-xs border border-slate-200 rounded-md px-2 py-1.5"
          />
        </div>

        <button
          type="button"
          onClick={soloEnElTecho}
          className="text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 rounded-md px-2 py-1.5 hover:bg-amber-100"
          title="Muestra solo los productos que están en el techo de seguridad (500) ahora mismo en Perú Compras"
        >
          Solo en el techo (500)
        </button>

        {(precioMin !== "" || precioMax !== "") && (
          <button
            type="button"
            onClick={limpiarFiltroPrecio}
            className="text-xs text-slate-400 hover:text-slate-600 underline"
          >
            Quitar filtro
          </button>
        )}

        <span className="text-xs text-slate-500 ml-auto">
          {cargando ? "Consultando Perú Compras..." : `${productosFiltrados.length} producto(s) encontrados`}
        </span>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          <AlertTriangle size={15} /> {error}
        </div>
      )}

      {seleccionados.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
          <span className="text-xs text-amber-800 font-medium">{seleccionados.size} seleccionado(s)</span>

          <div className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              placeholder="Precio a aplicar"
              value={valorLote}
              onChange={(e) => setValorLote(e.target.value)}
              className="w-28 text-xs border border-slate-200 rounded-md px-2 py-1"
            />
            <button
              type="button"
              onClick={guardarPrecioLote}
              disabled={guardandoLote || !valorLote}
              className="text-xs font-semibold bg-sky-600 hover:bg-sky-700 text-white rounded-md px-3 py-1.5 disabled:opacity-50"
              title="Manda este precio a Perú Compras para cada seleccionado y lo guarda en la BD"
            >
              {guardandoLote ? "Guardando..." : "Aplicar precio a seleccionados"}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setMostrarModal(true)}
            disabled={enviando}
            className="text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white rounded-md px-3 py-1.5 disabled:opacity-50"
          >
            Enviar oferta(s) seleccionada(s)
          </button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-center">
                  <input
                    type="checkbox"
                    checked={filasPagina.length > 0 && filasPagina.every((f) => seleccionados.has(f.id_catalogo_producto))}
                    onChange={alternarTodosPagina}
                  />
                </th>
                <th className="px-3 py-2 text-left">Producto</th>
                <th className="px-3 py-2 text-left">Acuerdo / Catálogo / Categoría</th>
                <th className="px-3 py-2 text-left">Estado actual</th>
                <th className="px-3 py-2 text-right">Precio en Perú Compras (ahora)</th>
                <th className="px-3 py-2 text-right">Precio guardado en BD</th>
                <th className="px-3 py-2 text-left">Moneda</th>
                <th className="px-3 py-2 text-right">Precio unitario a digitar</th>
                <th className="px-3 py-2 text-center">Guardar</th>
                <th className="px-3 py-2 text-center">Resultado</th>
                <th className="px-3 py-2 text-center">Enviado</th>
                <th className="px-3 py-2 text-center">Acción</th>
              </tr>
            </thead>
            <tbody>
              {cargando ? (
                <tr>
                  <td colSpan={12} className="text-center py-10 text-slate-400">
                    <Loader2 size={16} className="animate-spin inline mr-2" /> Consultando Perú Compras...
                  </td>
                </tr>
              ) : filasPagina.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-10 text-slate-400">
                    {productos.length === 0
                      ? "Elegí un filtro (o dejalo en \"todos\") para traer productos en vivo."
                      : "No hay filas en esta página."}
                  </td>
                </tr>
              ) : (
                filasPagina.map((f) => {
                  const res = resultadoFila[f.id_catalogo_producto];
                  return (
                    <tr key={f.id_catalogo_producto} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={seleccionados.has(f.id_catalogo_producto)}
                          onChange={() => alternarSeleccion(f.id_catalogo_producto)}
                        />
                      </td>
                      <td className="px-3 py-2 max-w-[280px] truncate font-medium text-slate-800" title={f.descripcion}>
                        {f.descripcion}
                      </td>
                      <td
                        className="px-3 py-2 max-w-[220px] truncate text-slate-500"
                        title={`${f.acuerdo} / ${f.catalogo} / ${f.categoria}`}
                      >
                        {f.catalogo} / {f.categoria}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{f.estado_actual || "—"}</td>
                      <td className="px-3 py-2 text-right text-slate-500">
                        {f.precio_actual !== null && f.precio_actual !== "" ? Number(f.precio_actual).toFixed(2) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">
                        {f.precio_manual_bd !== null ? (
                          <span
                            className={f.precio_manual_aceptado ? "text-emerald-700" : "text-red-600"}
                            title={
                              f.precio_manual_aceptado === false
                                ? "Guardado en BD pero Perú Compras lo rechazó"
                                : `Guardado por: ${f.precio_manual_actualizado_por || "—"}${
                                    f.precio_manual_actualizado_en ? " · " + new Date(f.precio_manual_actualizado_en).toLocaleString() : ""
                                  }`
                            }
                          >
                            {Number(f.precio_manual_bd).toFixed(2)}
                            {f.precio_manual_actualizado_por?.includes("búsqueda automática") && (
                              <span className="ml-1 text-[9px] font-normal text-sky-600 align-middle">(auto)</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-slate-300">Sin guardar</span>
                        )}
                      </td>
                      <td className="px-3 py-2">{f.moneda}</td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={borrador[f.id_catalogo_producto] ?? ""}
                          onChange={(e) =>
                            setBorrador((prev) => ({ ...prev, [f.id_catalogo_producto]: e.target.value }))
                          }
                          placeholder="0.00"
                          className="w-24 text-right text-xs border border-slate-200 rounded-md px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => guardarPrecio(f)}
                          disabled={!!guardando[f.id_catalogo_producto]}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 disabled:opacity-40"
                        >
                          {guardando[f.id_catalogo_producto] ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Save size={13} />
                          )}
                          Guardar
                        </button>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {res ? (
                          res.ok ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 text-[10px] font-semibold" title={res.detalle}>
                              <CheckCircle2 size={12} /> OK
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-600 text-[10px] font-semibold" title={res.detalle}>
                              <AlertTriangle size={12} /> Rechazado
                            </span>
                          )
                        ) : (
                          <span className="text-[10px] text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {f.enviado_en ? (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                            Enviado
                          </span>
                        ) : f.envio_error ? (
                          <span
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full border bg-red-50 text-red-700 border-red-200"
                            title={f.envio_error}
                          >
                            Error
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          type="button"
                          disabled={!puedeEnviar(f) || !!f.enviado_en || enviando}
                          onClick={() => {
                            setSeleccionados(new Set([f.id_catalogo_producto]));
                            setMostrarModal(true);
                          }}
                          className="text-[10px] font-semibold text-emerald-700 hover:text-emerald-900 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          Enviar
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {productos.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50/60">
            <p className="text-xs text-slate-500">
              {(pagina - 1) * POR_PAGINA + 1}–{Math.min(pagina * POR_PAGINA, productos.length)} de {productos.length}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPagina((p) => Math.max(1, p - 1))}
                disabled={pagina === 1}
                className="w-7 h-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 disabled:opacity-30"
              >
                <ChevronLeft size={13} />
              </button>
              <span className="text-xs text-slate-600 px-2">
                {pagina} / {totalPaginas}
              </span>
              <button
                type="button"
                onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
                disabled={pagina === totalPaginas}
                className="w-7 h-7 flex items-center justify-center rounded-md border border-slate-200 text-slate-500 disabled:opacity-30"
              >
                <ChevronRight size={13} />
              </button>
            </div>
          </div>
        )}
      </div>

      {mostrarModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-5">
            <div className="flex items-center gap-2 text-amber-700 mb-2">
              <AlertTriangle size={18} />
              <h3 className="font-semibold text-sm">Confirmar envío de oferta</h3>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              Estás por registrar <strong>{seleccionados.size}</strong> oferta(s) en Perú Compras con el
              precio guardado en tu base de datos. Esta acción <strong>impacta directamente en el portal</strong> y
              no se puede deshacer desde acá. ¿Confirmás?
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setMostrarModal(false)}
                disabled={enviando}
                className="text-xs font-medium text-slate-500 px-3 py-1.5 rounded-md hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => enviarOfertas(Array.from(seleccionados))}
                disabled={enviando}
                className="text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-md px-3 py-1.5 disabled:opacity-50"
              >
                {enviando ? "Enviando..." : "Sí, enviar oferta(s)"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

