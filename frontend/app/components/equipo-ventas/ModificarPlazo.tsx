"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Loader2,
  CheckCircle2,
  AlertTriangle,
  PlayCircle,
  ListChecks,
  MapPin,
  Globe2,
} from "lucide-react";
import { fetchConToken } from "../../helbot-shared";

interface EstadoPlazo {
  corriendo: boolean;
  combinacion_actual: string | null;
  combinaciones_completadas: number;
  total_combinaciones: number;
  fichas_modificadas: number;
  combos_con_error: number;
  iniciado_en: string | null;
  terminado_en: string | null;
  error: string | null;
}

interface FilaPlazo {
  categoria: string;
  departamento: string;
  provincia: string;
  fichas_modificadas: number;
  ok: boolean;
  mensaje: string;
}

interface CategoriaOpcion {
  familia: number;
  categoria: number;
  nombre: string;
}

interface AcuerdoOpcion {
  acuerdo: string;
  categorias: CategoriaOpcion[];
}

interface Departamento {
  codigo: string;
  nombre: string;
}

interface Provincia {
  codigo: string;
  nombre: string;
}

const inputCls =
  "w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-400";

export default function ModificarPlazo({ apiBase, uid }: { apiBase: string; uid: string }) {
  // ---------------- Acuerdo + categorías ----------------
  const [opciones, setOpciones] = useState<AcuerdoOpcion[]>([]);
  const [acuerdoActivo, setAcuerdoActivo] = useState("");
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());

  // ---------------- Ejecución ----------------
  const [estado, setEstado] = useState<EstadoPlazo | null>(null);
  const [filas, setFilas] = useState<FilaPlazo[]>([]);
  const [lanzando, setLanzando] = useState(false);
  const [soloConCambios, setSoloConCambios] = useState(false);
  const intervalo = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---------------- Ámbito geográfico ----------------
  const [modoAmbito, setModoAmbito] = useState<"todos" | "especifico">("todos");
  const [departamentos, setDepartamentos] = useState<Departamento[]>([]);
  const [cargandoDeps, setCargandoDeps] = useState(false);
  const [depSeleccionado, setDepSeleccionado] = useState("");
  const [provincias, setProvincias] = useState<Provincia[]>([]);
  const [cargandoProvs, setCargandoProvs] = useState(false);
  const [provSeleccionada, setProvSeleccionada] = useState("");

  // ---------------- Confirmación previa ----------------
  const [confirmando, setConfirmando] = useState(false);

  const claveCategoria = (acuerdo: string, familia: number, categoria: number) => `${acuerdo}::${familia}::${categoria}`;

  useEffect(() => {
    (async () => {
      try {
        const r = await fetchConToken(`${apiBase}/perucompras/plazo/opciones`);
        const data = await r.json();
        const lista: AcuerdoOpcion[] = data.opciones || [];
        setOpciones(lista);
        if (lista.length > 0) setAcuerdoActivo(lista[0].acuerdo);
        // Por defecto, todo seleccionado — igual que "Seleccionar todo" del bot viejo.
        const todas = new Set<string>();
        lista.forEach((a) => a.categorias.forEach((c) => todas.add(claveCategoria(a.acuerdo, c.familia, c.categoria))));
        setSeleccionadas(todas);
      } catch {}
    })();
  }, [apiBase]);

  const consultarEstado = async () => {
    try {
      const r = await fetchConToken(`${apiBase}/perucompras/plazo/estado`);
      const data: EstadoPlazo = await r.json();
      setEstado(data);
      if (!data.corriendo) {
        cargarResultados();
        if (intervalo.current) {
          clearInterval(intervalo.current);
          intervalo.current = null;
        }
      }
    } catch {}
  };

  const cargarResultados = async () => {
    try {
      const r = await fetchConToken(`${apiBase}/perucompras/plazo/resultados`);
      const data = await r.json();
      setFilas(Array.isArray(data.filas) ? data.filas : []);
    } catch {}
  };

  useEffect(() => {
    consultarEstado();
    return () => {
      if (intervalo.current) clearInterval(intervalo.current);
    };
  }, []);

  const toggleCategoria = (acuerdo: string, cat: CategoriaOpcion) => {
    const clave = claveCategoria(acuerdo, cat.familia, cat.categoria);
    setSeleccionadas((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(clave)) nuevo.delete(clave);
      else nuevo.add(clave);
      return nuevo;
    });
  };

  const seleccionarTodoDelAcuerdo = (acuerdo: AcuerdoOpcion) => {
    setSeleccionadas((prev) => {
      const nuevo = new Set(prev);
      acuerdo.categorias.forEach((c) => nuevo.add(claveCategoria(acuerdo.acuerdo, c.familia, c.categoria)));
      return nuevo;
    });
  };

  const deseleccionarTodoDelAcuerdo = (acuerdo: AcuerdoOpcion) => {
    setSeleccionadas((prev) => {
      const nuevo = new Set(prev);
      acuerdo.categorias.forEach((c) => nuevo.delete(claveCategoria(acuerdo.acuerdo, c.familia, c.categoria)));
      return nuevo;
    });
  };

  // ---------------- Categoría única (habilita el ámbito específico) ----------------
  // Los departamentos disponibles dependen de QUÉ categoría se consulta
  // (grupo_id + categoria_id), así que restringir a un Departamento o
  // Provincia concreto solo tiene sentido cuando hay exactamente 1
  // categoría marcada — igual que en el flujo de tu bot viejo en tkinter.
  const categoriaUnica = useMemo(() => {
    if (seleccionadas.size !== 1) return null;
    const clave = Array.from(seleccionadas)[0];
    const [acuerdo, familiaStr, categoriaStr] = clave.split("::");
    const opcionAcuerdo = opciones.find((a) => a.acuerdo === acuerdo);
    const cat = opcionAcuerdo?.categorias.find(
      (c) => c.familia === Number(familiaStr) && c.categoria === Number(categoriaStr)
    );
    if (!opcionAcuerdo || !cat) return null;
    return { acuerdo, cat };
  }, [seleccionadas, opciones]);

  // Si dejan de cumplirse las condiciones para el ámbito específico
  // (se marcó una 2da categoría, o se desmarcó la única), volvemos a
  // "todos" automáticamente para no dejar un filtro geográfico "fantasma".
  useEffect(() => {
    if (!categoriaUnica && modoAmbito === "especifico") {
      setModoAmbito("todos");
    }
  }, [categoriaUnica, modoAmbito]);

  // Carga de departamentos cuando se activa el ámbito específico.
  useEffect(() => {
    if (modoAmbito !== "especifico" || !categoriaUnica) {
      setDepartamentos([]);
      setDepSeleccionado("");
      setProvincias([]);
      setProvSeleccionada("");
      return;
    }
    setCargandoDeps(true);
    setDepSeleccionado("");
    setProvincias([]);
    setProvSeleccionada("");
    (async () => {
      try {
        const params = new URLSearchParams({
          uid,
          acuerdo: categoriaUnica.acuerdo,
          familia: String(categoriaUnica.cat.familia),
          categoria: String(categoriaUnica.cat.categoria),
        });
        const r = await fetchConToken(`${apiBase}/perucompras/plazo/departamentos?${params.toString()}`);
        const data = await r.json();
        setDepartamentos(data.departamentos || []);
      } catch {
        setDepartamentos([]);
      } finally {
        setCargandoDeps(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoAmbito, categoriaUnica?.acuerdo, categoriaUnica?.cat.familia, categoriaUnica?.cat.categoria, uid, apiBase]);

  // Carga de provincias cuando se elige un departamento específico.
  useEffect(() => {
    if (!depSeleccionado) {
      setProvincias([]);
      setProvSeleccionada("");
      return;
    }
    setCargandoProvs(true);
    setProvSeleccionada("");
    (async () => {
      try {
        const params = new URLSearchParams({ uid, departamento_codigo: depSeleccionado });
        const r = await fetchConToken(`${apiBase}/perucompras/plazo/provincias?${params.toString()}`);
        const data = await r.json();
        setProvincias(data.provincias || []);
      } catch {
        setProvincias([]);
      } finally {
        setCargandoProvs(false);
      }
    })();
  }, [depSeleccionado, uid, apiBase]);

  // ---------------- Resumen en lenguaje natural ----------------
  const resumenTexto = useMemo(() => {
    const acuerdosImplicados = new Set<string>();
    opciones.forEach((a) =>
      a.categorias.forEach((c) => {
        if (seleccionadas.has(claveCategoria(a.acuerdo, c.familia, c.categoria))) acuerdosImplicados.add(a.acuerdo);
      })
    );
    const nCats = seleccionadas.size;
    const nAcuerdos = acuerdosImplicados.size;

    let ambito = "en TODOS los departamentos y provincias del Perú";
    if (modoAmbito === "especifico") {
      const depNombre = departamentos.find((d) => d.codigo === depSeleccionado)?.nombre;
      const provNombre = provincias.find((p) => p.codigo === provSeleccionada)?.nombre;
      if (depNombre && provNombre) ambito = `solo en la provincia de ${provNombre} (${depNombre})`;
      else if (depNombre) ambito = `en todas las provincias de ${depNombre}`;
    }

    return `Vas a aplicar Plazo de entrega = 1 en ${nCats} categoría${nCats !== 1 ? "s" : ""} de ${nAcuerdos} acuerdo${
      nAcuerdos !== 1 ? "s" : ""
    } marco, ${ambito}.`;
  }, [opciones, seleccionadas, modoAmbito, departamentos, depSeleccionado, provincias, provSeleccionada]);

  const abrirConfirmacion = () => {
    if (seleccionadas.size === 0) return;
    setConfirmando(true);
  };

  const ejecutarConfirmado = async () => {
    setConfirmando(false);
    setLanzando(true);
    try {
      const acuerdosSet = new Set<string>();
      const categoriasSet = new Set<string>();
      const categoriasPares: number[][] = [];

      opciones.forEach((a) => {
        a.categorias.forEach((c) => {
          const clave = claveCategoria(a.acuerdo, c.familia, c.categoria);
          if (seleccionadas.has(clave)) {
            acuerdosSet.add(a.acuerdo);
            const parKey = `${c.familia}-${c.categoria}`;
            if (!categoriasSet.has(parKey)) {
              categoriasSet.add(parKey);
              categoriasPares.push([c.familia, c.categoria]);
            }
          }
        });
      });

      const body: Record<string, unknown> = {
        acuerdos: Array.from(acuerdosSet),
        categorias: categoriasPares,
      };
      if (modoAmbito === "especifico") {
        if (depSeleccionado) body.departamento_codigo = depSeleccionado;
        if (provSeleccionada) body.provincia_codigo = provSeleccionada;
      }

      const params = new URLSearchParams({ uid });
      await fetchConToken(`${apiBase}/perucompras/plazo/ejecutar?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      intervalo.current = setInterval(consultarEstado, 3000);
      await consultarEstado();
    } finally {
      setLanzando(false);
    }
  };

  const corriendo = estado?.corriendo || lanzando;
  const filasFiltradas = soloConCambios ? filas.filter((f) => f.fichas_modificadas > 0) : filas;
  const acuerdoData = opciones.find((a) => a.acuerdo === acuerdoActivo);
  const totalSeleccionadas = seleccionadas.size;

  return (
    <div>
      {/* Paso 1 — Selector de Acuerdo Marco */}
      <div className="flex items-center gap-2 mb-2">
        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
          1
        </span>
        <p className="text-sm font-semibold text-slate-800">Acuerdo Marco</p>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-5">
        {opciones.map((a) => (
          <button
            key={a.acuerdo}
            type="button"
            onClick={() => setAcuerdoActivo(a.acuerdo)}
            className={`px-3.5 py-2 text-xs font-semibold rounded-lg border transition-colors ${
              acuerdoActivo === a.acuerdo
                ? "bg-[#4F46E5] border-[#4F46E5] text-white shadow-sm"
                : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
            }`}
          >
            {a.acuerdo.length > 60 ? a.acuerdo.slice(0, 60) + "…" : a.acuerdo}
          </button>
        ))}
      </div>

      {/* Paso 2 — Categorías del acuerdo activo (checkboxes) */}
      {acuerdoData && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
              2
            </span>
            <p className="text-sm font-semibold text-slate-800">Categorías a modificar</p>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ListChecks size={15} className="text-indigo-600" />
                <p className="text-xs font-medium text-slate-500">{acuerdoData.categorias.length} categorías en este acuerdo</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => seleccionarTodoDelAcuerdo(acuerdoData)}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
                >
                  Seleccionar todo
                </button>
                <button
                  type="button"
                  onClick={() => deseleccionarTodoDelAcuerdo(acuerdoData)}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800"
                >
                  Deseleccionar todo
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {acuerdoData.categorias.map((c) => {
                const clave = claveCategoria(acuerdoData.acuerdo, c.familia, c.categoria);
                const activo = seleccionadas.has(clave);
                return (
                  <label
                    key={clave}
                    className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                      activo
                        ? "bg-indigo-50 border-indigo-300 text-indigo-800"
                        : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={activo}
                      onChange={() => toggleCategoria(acuerdoData.acuerdo, c)}
                      className="w-3.5 h-3.5 rounded border-slate-300"
                    />
                    {c.nombre}
                  </label>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Paso 3 — Ámbito geográfico */}
      <div className="flex items-center gap-2 mb-2">
        <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-bold flex items-center justify-center shrink-0">
          3
        </span>
        <p className="text-sm font-semibold text-slate-800">Ámbito geográfico</p>
      </div>
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-5">
        <div className="space-y-2.5">
          <label className="flex items-start gap-2.5 text-xs cursor-pointer">
            <input
              type="radio"
              checked={modoAmbito === "todos"}
              onChange={() => setModoAmbito("todos")}
              className="mt-0.5"
            />
            <span>
              <span className="flex items-center gap-1.5 font-medium text-slate-800">
                <Globe2 size={13} className="text-indigo-600" /> Todos los departamentos y provincias
              </span>
              <span className="block text-slate-500 mt-0.5">Aplica el cambio a nivel nacional para las categorías marcadas.</span>
            </span>
          </label>

          <label
            className={`flex items-start gap-2.5 text-xs ${
              categoriaUnica ? "cursor-pointer" : "cursor-not-allowed opacity-50"
            }`}
          >
            <input
              type="radio"
              checked={modoAmbito === "especifico"}
              onChange={() => categoriaUnica && setModoAmbito("especifico")}
              disabled={!categoriaUnica}
              className="mt-0.5"
            />
            <span>
              <span className="flex items-center gap-1.5 font-medium text-slate-800">
                <MapPin size={13} className="text-indigo-600" /> Elegir Departamento / Provincia
              </span>
              <span className="block text-slate-500 mt-0.5">
                {categoriaUnica
                  ? "Restringe el cambio a una zona concreta del país."
                  : "Disponible solo cuando marcas exactamente 1 categoría en el paso 2."}
              </span>
            </span>
          </label>
        </div>

        {modoAmbito === "especifico" && categoriaUnica && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-4 border-t border-slate-200">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Departamento</label>
              <select
                value={depSeleccionado}
                onChange={(e) => setDepSeleccionado(e.target.value)}
                disabled={cargandoDeps}
                className={inputCls}
              >
                <option value="">{cargandoDeps ? "Cargando departamentos..." : "Todos los departamentos"}</option>
                {departamentos.map((d) => (
                  <option key={d.codigo} value={d.codigo}>
                    {d.nombre}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Provincia</label>
              <select
                value={provSeleccionada}
                onChange={(e) => setProvSeleccionada(e.target.value)}
                disabled={!depSeleccionado || cargandoProvs}
                className={inputCls}
              >
                <option value="">
                  {!depSeleccionado ? "Elige un departamento primero" : cargandoProvs ? "Cargando provincias..." : "Todas las provincias"}
                </option>
                {provincias.map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Resumen persistente + botón ejecutar */}
      <div className="flex items-start sm:items-center gap-3 bg-white border border-slate-200 rounded-xl px-4 py-3 mb-5 flex-wrap">
        <button
          type="button"
          onClick={abrirConfirmacion}
          disabled={corriendo || totalSeleccionadas === 0}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-40 transition-colors shrink-0"
        >
          {corriendo ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />}
          {corriendo ? "Modificando plazo..." : `Ejecutar cambio de plazo (=1)`}
        </button>

        <p className="text-xs text-slate-500 leading-snug">{resumenTexto}</p>
      </div>

      {estado && (estado.corriendo || estado.error || estado.terminado_en) && (
        <div className="mb-5 text-xs text-slate-500 px-1">
          {estado.corriendo ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={12} className="animate-spin text-indigo-500" />
              {estado.combinacion_actual ? `${estado.combinacion_actual} · ` : "Cargando departamentos/provincias... · "}
              {estado.combinaciones_completadas}/{estado.total_combinaciones || "?"} combinaciones · {estado.fichas_modificadas} fichas
            </span>
          ) : estado.error ? (
            <span className="flex items-center gap-1 text-red-600">
              <AlertTriangle size={12} /> {estado.error}
            </span>
          ) : estado.terminado_en ? (
            <span className="flex items-center gap-1 text-emerald-700">
              <CheckCircle2 size={12} /> Última corrida: {estado.fichas_modificadas} fichas modificadas, {estado.combos_con_error} combinaciones con error
            </span>
          ) : null}
        </div>
      )}

      {/* Modal de confirmación — igual que el askyesno de tu bot viejo */}
      {confirmando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 bg-amber-50">
              <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                <AlertTriangle size={16} />
              </div>
              <p className="text-sm font-bold text-slate-900">Confirmar cambio de plazo</p>
            </div>
            <div className="px-6 py-5 space-y-3 text-sm text-slate-700">
              <p>{resumenTexto}</p>
              <p className="text-xs text-slate-500">
                Solo se modificarán fichas cuyo plazo actual sea distinto de 1. El proceso corre en segundo plano y puede
                tardar varios minutos según la cantidad de combinaciones.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50">
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                className="text-xs font-medium text-slate-500 hover:text-slate-800 px-3 py-2"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={ejecutarConfirmado}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg px-4 py-2.5 transition-colors"
              >
                Sí, aplicar cambio
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Métricas */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-3 border-l-4 border-l-emerald-400">
          <p className="text-[10px] font-medium text-emerald-600 uppercase">Fichas modificadas</p>
          <p className="text-xl font-bold text-emerald-700 mt-0.5">{estado?.fichas_modificadas ?? 0}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-3 border-l-4 border-l-indigo-400">
          <p className="text-[10px] font-medium text-indigo-600 uppercase">Combinaciones</p>
          <p className="text-xl font-bold text-indigo-700 mt-0.5">
            {estado?.combinaciones_completadas ?? 0}/{estado?.total_combinaciones ?? 0}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-3 border-l-4 border-l-red-400">
          <p className="text-[10px] font-medium text-red-600 uppercase">Con error</p>
          <p className="text-xl font-bold text-red-700 mt-0.5">{estado?.combos_con_error ?? 0}</p>
        </div>
      </div>

      <label className="flex items-center gap-2 mb-4 text-xs font-medium text-slate-600">
        <input
          type="checkbox"
          checked={soloConCambios}
          onChange={(e) => setSoloConCambios(e.target.checked)}
          className="w-3.5 h-3.5 rounded border-slate-300"
        />
        Mostrar solo combinaciones con fichas modificadas
      </label>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">Categoría</th>
                <th className="px-3 py-2 text-left">Departamento</th>
                <th className="px-3 py-2 text-left">Provincia</th>
                <th className="px-3 py-2 text-right">Fichas modificadas</th>
                <th className="px-3 py-2 text-center">Estado</th>
                <th className="px-3 py-2 text-left">Detalle</th>
              </tr>
            </thead>
            <tbody>
              {filasFiltradas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-10 text-slate-400">
                    {corriendo ? (
                      <>
                        <Loader2 size={16} className="animate-spin inline mr-2" /> Procesando...
                      </>
                    ) : (
                      "Sin resultados todavía — selecciona categorías y ejecuta."
                    )}
                  </td>
                </tr>
              ) : (
                filasFiltradas.map((f, i) => (
                  <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2 text-slate-600">{f.categoria}</td>
                    <td className="px-3 py-2">{f.departamento}</td>
                    <td className="px-3 py-2">{f.provincia}</td>
                    <td className="px-3 py-2 text-right font-semibold">{f.fichas_modificadas}</td>
                    <td className="px-3 py-2 text-center">
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                          f.ok ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"
                        }`}
                      >
                        {f.ok ? "OK" : "ERROR"}
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-[260px] truncate" title={f.mensaje}>
                      {f.mensaje}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}