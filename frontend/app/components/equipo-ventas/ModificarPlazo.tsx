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
  FileSpreadsheet,
  Download,
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
  categorias?: {
    categoria: string;
    acuerdo: string;
    estado: "pendiente" | "en_curso" | "terminada" | "con_errores";
    provincias: number;
    con_error: number;
    fichas: number;
    sin_fichas?: number;
    sin_cambios?: number;
  }[];
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

interface EstadoReporte {
  corriendo: boolean;
  combinacion_actual: string | null;
  combinaciones_completadas: number;
  total_combinaciones: number;
  con_resultados: number;
  sin_resultados: number;
  combos_con_error: number;
  fichas_encontradas: number;
  categorias_total: number;
  categorias_procesadas: number;
  iniciado_en: string | null;
  terminado_en: string | null;
  error: string | null;
}

interface FilaReporte {
  acuerdo: string;
  catalogo: string;
  categoria: string;
  departamento: string;
  provincia: string;
  fichas: number;
  estado: "con_resultados" | "sin_resultados" | "error";
  mensaje: string;
}

const inputCls =
  "w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 disabled:bg-slate-50 disabled:text-slate-400";

export default function ModificarPlazo({ apiBase, uid }: { apiBase: string; uid: string }) {
  // ---------------- Acuerdo + categorías ----------------
  const [opciones, setOpciones] = useState<AcuerdoOpcion[]>([]);
  const [acuerdoActivo, setAcuerdoActivo] = useState("");
  const [seleccionadas, setSeleccionadas] = useState<Set<string>>(new Set());

  const [cargandoOpciones, setCargandoOpciones] = useState(false);
  const [errorOpciones, setErrorOpciones] = useState("");

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

  // ---------------- Reporte de resultados (solo lectura) ----------------
  const [estadoReporte, setEstadoReporte] = useState<EstadoReporte | null>(null);
  const [filasReporte, setFilasReporte] = useState<FilaReporte[]>([]);
  const [lanzandoReporte, setLanzandoReporte] = useState(false);
  const [errorReporte, setErrorReporte] = useState("");
  const intervaloReporte = useRef<ReturnType<typeof setInterval> | null>(null);
  const [filtroEstado, setFiltroEstado] = useState<"todos" | "con_resultados" | "sin_resultados" | "error">("todos");
  const [filtroRegion, setFiltroRegion] = useState("");
  const [busquedaReporte, setBusquedaReporte] = useState("");

  const claveCategoria = (acuerdo: string, familia: number, categoria: number) => `${acuerdo}::${familia}::${categoria}`;

  useEffect(() => {
    if (!uid) return;
    (async () => {
      setCargandoOpciones(true);
      setErrorOpciones("");
      setOpciones([]);
      setSeleccionadas(new Set());
      try {
        const r = await fetchConToken(`${apiBase}/perucompras/plazo/opciones?uid=${encodeURIComponent(uid)}`);
        const data = await r.json();
        if (!r.ok) throw new Error(data.detail || `Error HTTP ${r.status}`);
        const lista: AcuerdoOpcion[] = data.opciones || [];
        setOpciones(lista);
        setAcuerdoActivo(lista.length > 0 ? lista[0].acuerdo : "");
        const todas = new Set<string>();
        lista.forEach((a) => a.categorias.forEach((c) => todas.add(claveCategoria(a.acuerdo, c.familia, c.categoria))));
        setSeleccionadas(todas);
      } catch (e) {
        setErrorOpciones(e instanceof Error ? e.message : "No se pudieron leer los acuerdos");
      } finally {
        setCargandoOpciones(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, uid]);

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
    if (!depSeleccionado || !categoriaUnica) {
      setProvincias([]);
      setProvSeleccionada("");
      return;
    }
    setCargandoProvs(true);
    setProvSeleccionada("");
    (async () => {
      try {
        const params = new URLSearchParams({
          uid,
          acuerdo: categoriaUnica.acuerdo,
          familia: String(categoriaUnica.cat.familia),
          categoria: String(categoriaUnica.cat.categoria),
          departamento_codigo: depSeleccionado,
        });
        const r = await fetchConToken(`${apiBase}/perucompras/plazo/provincias?${params.toString()}`);
        const data = await r.json();
        setProvincias(data.provincias || []);
      } catch {
        setProvincias([]);
      } finally {
        setCargandoProvs(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ---------------- Reporte de resultados ----------------
  const consultarEstadoReporte = async () => {
    try {
      const r = await fetchConToken(`${apiBase}/perucompras/plazo/reporte/estado`);
      const data: EstadoReporte = await r.json();
      setEstadoReporte(data);
      if (data.corriendo && !intervaloReporte.current) {
        intervaloReporte.current = setInterval(consultarEstadoReporte, 3000);
      }
      if (!data.corriendo) {
        cargarResultadosReporte();
        if (intervaloReporte.current) {
          clearInterval(intervaloReporte.current);
          intervaloReporte.current = null;
        }
      }
    } catch {}
  };

  const cargarResultadosReporte = async () => {
    try {
      const r = await fetchConToken(`${apiBase}/perucompras/plazo/reporte/resultados`);
      const data = await r.json();
      setFilasReporte(Array.isArray(data.filas) ? data.filas : []);
    } catch {}
  };

  const ejecutarReporte = async () => {
    if (seleccionadas.size === 0) return;
    setErrorReporte("");
    setFilasReporte([]);
    setLanzandoReporte(true);
    try {
      const acuerdosSet = new Set<string>();
      const parKeys = new Set<string>();
      const categoriasPares: number[][] = [];
      opciones.forEach((a) => {
        a.categorias.forEach((c) => {
          if (seleccionadas.has(claveCategoria(a.acuerdo, c.familia, c.categoria))) {
            acuerdosSet.add(a.acuerdo);
            const k = `${c.familia}-${c.categoria}`;
            if (!parKeys.has(k)) {
              parKeys.add(k);
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
      const r = await fetchConToken(`${apiBase}/perucompras/plazo/reporte/ejecutar?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || `Error HTTP ${r.status}`);
      }
      await consultarEstadoReporte();
    } catch (e) {
      setErrorReporte(e instanceof Error ? e.message : "No se pudo iniciar el reporte");
    } finally {
      setLanzandoReporte(false);
    }
  };

  const descargarExcelReporte = async () => {
    try {
      const r = await fetchConToken(`${apiBase}/perucompras/plazo/reporte/excel`);
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.detail || `Error HTTP ${r.status}`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reporte_resultados_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErrorReporte(e instanceof Error ? e.message : "No se pudo descargar el Excel");
    }
  };

  useEffect(() => {
    consultarEstadoReporte();
    return () => {
      if (intervaloReporte.current) clearInterval(intervaloReporte.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const corriendoReporte = !!estadoReporte?.corriendo || lanzandoReporte;
  const ocupado = !!corriendo || corriendoReporte;
  const finalizoReporte = !!estadoReporte && !estadoReporte.corriendo && !!estadoReporte.terminado_en;
  const regionesReporte = Array.from(new Set(filasReporte.map((f) => f.departamento))).sort();

  const filasReporteFiltradas = filasReporte.filter((f) => {
    if (filtroEstado !== "todos" && f.estado !== filtroEstado) return false;
    if (filtroRegion && f.departamento !== filtroRegion) return false;
    const q = busquedaReporte.trim().toLowerCase();
    if (q) {
      const texto = `${f.acuerdo} ${f.catalogo} ${f.categoria} ${f.departamento} ${f.provincia}`.toLowerCase();
      if (!texto.includes(q)) return false;
    }
    return true;
  });

  const resumenRegiones = (() => {
    const m = new Map<string, { region: string; total: number; con: number; sin: number; err: number; fichas: number }>();
    filasReporte.forEach((f) => {
      const r = m.get(f.departamento) ?? { region: f.departamento, total: 0, con: 0, sin: 0, err: 0, fichas: 0 };
      r.total += 1;
      r.fichas += f.fichas || 0;
      if (f.estado === "con_resultados") r.con += 1;
      else if (f.estado === "sin_resultados") r.sin += 1;
      else r.err += 1;
      m.set(f.departamento, r);
    });
    return Array.from(m.values()).sort((a, b) => b.sin - a.sin || a.region.localeCompare(b.region));
  })();
  const filasFiltradas = soloConCambios ? filas.filter((f) => f.fichas_modificadas > 0) : filas;
  const acuerdoData = opciones.find((a) => a.acuerdo === acuerdoActivo);
  const totalSeleccionadas = seleccionadas.size;

  const cats = estado?.categorias ?? [];
  const catsTerminadas = cats.filter((c) => c.estado === "terminada").length;
  const catsConErrores = cats.filter((c) => c.estado === "con_errores").length;
  const catsSinTerminar = cats.length - catsTerminadas - catsConErrores;
  const finalizo = !!estado && !estado.corriendo && !!estado.terminado_en;

  return (
    <div>

      {cargandoOpciones && (
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
          <Loader2 size={14} className="animate-spin" /> Leyendo acuerdos y categorías de este usuario en Perú Compras (puede tardar ~1 min la primera vez)...
        </div>
      )}
      {errorOpciones && (
        <div className="flex items-center gap-1.5 text-xs text-red-600 mb-4">
          <AlertTriangle size={13} /> {errorOpciones}
        </div>
      )}

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
          disabled={ocupado || totalSeleccionadas === 0}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-40 transition-colors shrink-0"
        >
          {corriendo ? <Loader2 size={15} className="animate-spin" /> : <PlayCircle size={15} />}
          {corriendo ? "Modificando plazo..." : `Ejecutar cambio de plazo (=1)`}
        </button>

        <button
          type="button"
          onClick={ejecutarReporte}
          disabled={ocupado || totalSeleccionadas === 0}
          className="flex items-center gap-2 bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-300 text-sm font-semibold rounded-lg px-4 py-2 disabled:opacity-40 transition-colors shrink-0"
        >
          {corriendoReporte ? <Loader2 size={15} className="animate-spin" /> : <FileSpreadsheet size={15} />}
          {corriendoReporte ? "Generando reporte..." : "Generar reporte de resultados"}
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


            {cats.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
            Progreso por categoría ({catsTerminadas + catsConErrores}/{cats.length})
          </p>
          <ul className="space-y-1.5">
            {cats.map((c, i) => (
              <li key={`${c.acuerdo}-${c.categoria}-${i}`} className="flex items-center gap-2 text-xs">
                {c.estado === "terminada" ? (
                  <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                ) : c.estado === "con_errores" ? (
                  <AlertTriangle size={14} className="text-amber-600 shrink-0" />
                ) : c.estado === "en_curso" ? (
                  <Loader2 size={14} className="animate-spin text-indigo-600 shrink-0" />
                ) : (
                  <span className="w-3.5 h-3.5 rounded-full border border-slate-300 shrink-0" />
                )}
                <span className="font-medium text-slate-800">{c.categoria}</span>
                <span className="text-slate-500">
                  {c.estado === "pendiente" && "En espera"}
                  {c.estado === "en_curso" && `Procesando… ${c.provincias} provincias, ${c.fichas} fichas`}
                  {c.estado === "terminada" &&
                    `Terminó · ${c.provincias} provincias (${c.sin_fichas ?? 0} sin fichas, ${c.sin_cambios ?? 0} ya estaban en 1) · ${c.fichas} fichas modificadas`}
                  {c.estado === "con_errores" &&
                    `Terminó con errores · ${c.con_error} de ${c.provincias} provincias fallaron · ${c.sin_fichas ?? 0} sin fichas · ${c.sin_cambios ?? 0} ya estaban en 1 · ${c.fichas} fichas modificadas`}
                </span>
              </li>
            ))}
          </ul>

          {finalizo && (
            <div
              className={`mt-3 text-xs font-semibold rounded-lg px-3 py-2 border ${
                estado?.error || catsSinTerminar > 0
                  ? "bg-red-50 text-red-700 border-red-200"
                  : catsConErrores > 0
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
              }`}
            >
              {estado?.error || catsSinTerminar > 0
                ? `Se detuvo antes de terminar: ${catsTerminadas + catsConErrores} de ${cats.length} categorías procesadas.`
                : catsConErrores > 0
                ? `Terminó todo lo que enviaste (${cats.length} categorías), pero ${catsConErrores} tuvieron errores. Revisa la tabla de abajo.`
                : `Terminó todo lo que enviaste: ${cats.length} categoría${cats.length !== 1 ? "s" : ""} sin errores.`}
            </div>
          )}
        </div>
      )}

      {/* Reporte de resultados (solo lectura) */}
      {(estadoReporte?.corriendo || estadoReporte?.terminado_en || errorReporte) && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">
              Reporte de resultados (solo consulta, no modifica plazos)
            </p>

          </div>

          {errorReporte && (
            <div className="flex items-center gap-1.5 text-xs text-red-600 mb-3">
              <AlertTriangle size={13} /> {errorReporte}
            </div>
          )}

          {estadoReporte?.corriendo && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-3">
              <Loader2 size={12} className="animate-spin text-indigo-500" />
              {estadoReporte.combinacion_actual ? `${estadoReporte.combinacion_actual} · ` : "Preparando... · "}
              categoría {Math.min(estadoReporte.categorias_procesadas + 1, estadoReporte.categorias_total || 1)}/
              {estadoReporte.categorias_total || "?"} · {estadoReporte.combinaciones_completadas}/
              {estadoReporte.total_combinaciones || "?"} provincias
            </div>
          )}

          {estadoReporte?.error && (
            <div className="flex items-center gap-1.5 text-xs text-red-600 mb-3">
              <AlertTriangle size={13} /> Se detuvo antes de terminar: {estadoReporte.error} (el Excel incluirá lo
              procesado hasta ese momento)
            </div>
          )}

          {estadoReporte && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-3 border-l-4 border-l-emerald-400">
                <p className="text-[10px] font-medium text-emerald-600 uppercase">Con resultados</p>
                <p className="text-xl font-bold text-emerald-700 mt-0.5">{estadoReporte.con_resultados}</p>
                <p className="text-[10px] text-slate-400">{estadoReporte.fichas_encontradas} fichas</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-3 border-l-4 border-l-rose-400">
                <p className="text-[10px] font-medium text-rose-600 uppercase">Sin resultados</p>
                <p className="text-xl font-bold text-rose-700 mt-0.5">{estadoReporte.sin_resultados}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-3 border-l-4 border-l-amber-400">
                <p className="text-[10px] font-medium text-amber-600 uppercase">Con error</p>
                <p className="text-xl font-bold text-amber-700 mt-0.5">{estadoReporte.combos_con_error}</p>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-3 border-l-4 border-l-indigo-400">
                <p className="text-[10px] font-medium text-indigo-600 uppercase">Consultadas</p>
                <p className="text-xl font-bold text-indigo-700 mt-0.5">
                  {estadoReporte.combinaciones_completadas}/{estadoReporte.total_combinaciones}
                </p>
              </div>
            </div>
          )}

          {finalizoReporte && filasReporte.length > 0 && (
            <>
              {/* ---- Resumen por región ---- */}
              <p className="text-xs font-semibold text-slate-700 mb-2">Resumen por región</p>
              <div className="border border-slate-200 rounded-lg overflow-hidden mb-5">
                <div className="overflow-x-auto max-h-72 overflow-y-auto">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">Región</th>
                        <th className="px-3 py-2 text-right">Provincias consultadas</th>
                        <th className="px-3 py-2 text-right">Con resultados</th>
                        <th className="px-3 py-2 text-right">Sin resultados</th>
                        <th className="px-3 py-2 text-right">Con error</th>
                        <th className="px-3 py-2 text-right">Fichas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {resumenRegiones.map((r) => (
                        <tr
                          key={r.region}
                          onClick={() => {
                            setFiltroRegion(r.region);
                            setFiltroEstado("sin_resultados");
                          }}
                          className="border-t border-slate-100 hover:bg-indigo-50 cursor-pointer"
                          title="Clic para filtrar el detalle por esta región"
                        >
                          <td className="px-3 py-1.5 font-medium text-slate-800">{r.region}</td>
                          <td className="px-3 py-1.5 text-right">{r.total}</td>
                          <td className="px-3 py-1.5 text-right text-emerald-700 font-semibold">{r.con}</td>
                          <td className="px-3 py-1.5 text-right text-rose-700 font-semibold">{r.sin}</td>
                          <td className="px-3 py-1.5 text-right text-amber-700 font-semibold">{r.err}</td>
                          <td className="px-3 py-1.5 text-right">{r.fichas}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-slate-50 font-bold text-slate-700 sticky bottom-0">
                      <tr className="border-t border-slate-200">
                        <td className="px-3 py-2">TOTAL</td>
                        <td className="px-3 py-2 text-right">{filasReporte.length}</td>
                        <td className="px-3 py-2 text-right">{resumenRegiones.reduce((s, r) => s + r.con, 0)}</td>
                        <td className="px-3 py-2 text-right">{resumenRegiones.reduce((s, r) => s + r.sin, 0)}</td>
                        <td className="px-3 py-2 text-right">{resumenRegiones.reduce((s, r) => s + r.err, 0)}</td>
                        <td className="px-3 py-2 text-right">{resumenRegiones.reduce((s, r) => s + r.fichas, 0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* ---- Barra de filtros + exportar ---- */}
              <div className="flex flex-wrap items-end gap-3 mb-3">
                <div className="min-w-[150px]">
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Estado</label>
                  <select
                    value={filtroEstado}
                    onChange={(e) => setFiltroEstado(e.target.value as typeof filtroEstado)}
                    className={inputCls}
                  >
                    <option value="todos">Todos</option>
                    <option value="con_resultados">Con resultados</option>
                    <option value="sin_resultados">Sin resultados</option>
                    <option value="error">Con error</option>
                  </select>
                </div>
                <div className="min-w-[170px]">
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Región</label>
                  <select value={filtroRegion} onChange={(e) => setFiltroRegion(e.target.value)} className={inputCls}>
                    <option value="">Todas las regiones</option>
                    {regionesReporte.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Buscar</label>
                  <input
                    type="text"
                    value={busquedaReporte}
                    onChange={(e) => setBusquedaReporte(e.target.value)}
                    placeholder="Acuerdo, catálogo, categoría, provincia..."
                    className={inputCls}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFiltroEstado("todos");
                    setFiltroRegion("");
                    setBusquedaReporte("");
                  }}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800 px-2 py-2"
                >
                  Limpiar filtros
                </button>
                <button
                  type="button"
                  onClick={descargarExcelReporte}
                  className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg px-3 py-2 transition-colors"
                >
                  <Download size={13} /> Exportar Excel
                </button>
              </div>

              {/* ---- Tabla de detalle ---- */}
              <p className="text-xs text-slate-500 mb-2">
                Mostrando {Math.min(filasReporteFiltradas.length, 500)} de {filasReporteFiltradas.length} filas
                {filasReporteFiltradas.length > 500 && " (el Excel trae todas)"}
              </p>
              <div className="border border-slate-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                  <table className="w-full text-xs whitespace-nowrap">
                    <thead className="bg-slate-50 text-[10px] uppercase text-slate-500 sticky top-0">
                      <tr>
                        <th className="px-3 py-2 text-left">#</th>
                        <th className="px-3 py-2 text-left">Acuerdo marco</th>
                        <th className="px-3 py-2 text-left">Catálogo</th>
                        <th className="px-3 py-2 text-left">Categoría</th>
                        <th className="px-3 py-2 text-left">Región</th>
                        <th className="px-3 py-2 text-left">Provincia</th>
                        <th className="px-3 py-2 text-right">Fichas</th>
                        <th className="px-3 py-2 text-center">Estado</th>
                        <th className="px-3 py-2 text-left">Detalle</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filasReporteFiltradas.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="text-center py-8 text-slate-400">
                            No hay filas con esos filtros.
                          </td>
                        </tr>
                      ) : (
                        filasReporteFiltradas.slice(0, 500).map((f, i) => (
                          <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                            <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                            <td className="px-3 py-1.5 max-w-[220px] truncate" title={f.acuerdo}>{f.acuerdo}</td>
                            <td className="px-3 py-1.5 max-w-[200px] truncate" title={f.catalogo}>{f.catalogo}</td>
                            <td className="px-3 py-1.5 text-slate-600">{f.categoria}</td>
                            <td className="px-3 py-1.5">{f.departamento}</td>
                            <td className="px-3 py-1.5">{f.provincia}</td>
                            <td className="px-3 py-1.5 text-right font-semibold">{f.fichas}</td>
                            <td className="px-3 py-1.5 text-center">
                              <span
                                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                                  f.estado === "con_resultados"
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : f.estado === "sin_resultados"
                                    ? "bg-rose-50 text-rose-700 border-rose-200"
                                    : "bg-amber-50 text-amber-700 border-amber-200"
                                }`}
                              >
                                {f.estado === "con_resultados"
                                  ? "CON RESULTADOS"
                                  : f.estado === "sin_resultados"
                                  ? "SIN RESULTADOS"
                                  : "ERROR"}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 max-w-[260px] truncate" title={f.mensaje}>{f.mensaje}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
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
                          !f.ok
                            ? "bg-red-50 text-red-700 border-red-200"
                            : f.fichas_modificadas === 0 && f.mensaje.startsWith("Sin fichas")
                            ? "bg-slate-50 text-slate-500 border-slate-200"
                            : f.fichas_modificadas === 0 && f.mensaje.startsWith("Sin cambios")
                            ? "bg-sky-50 text-sky-700 border-sky-200"
                            : "bg-emerald-50 text-emerald-700 border-emerald-200"
                        }`}
                      >
                        {!f.ok
                          ? "ERROR"
                          : f.fichas_modificadas === 0 && f.mensaje.startsWith("Sin fichas")
                          ? "SIN FICHAS"
                          : f.fichas_modificadas === 0 && f.mensaje.startsWith("Sin cambios")
                          ? "YA EN 1"
                          : "OK"}
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