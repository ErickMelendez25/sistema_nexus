"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, X, Loader2, Tag, AlertTriangle } from "lucide-react";
import { fetchConToken } from "../../helbot-shared";

interface MarcaConfig {
  id: number;
  lista: string;
  marca: string;
  creado_por: string | null;
  creado_en: string | null;
}

const LISTAS: { valor: string; label: string }[] = [
  { valor: "restringida_semaforo", label: "Restringidas (semáforo rojo)" },
  { valor: "prohibida_500_1000", label: "Prohibidas S/500-1000" },
  { valor: "excepcion_menor_500", label: "Excepción menor a S/500" },
  { valor: "objetivo", label: "Marcas objetivo (reporte de marcas)" },
];

export default function MarcasConfig({ apiBase, uid, listas }: { apiBase: string; uid: string; listas?: string[] }) {
  const listasAMostrar = listas && listas.length > 0 ? LISTAS.filter((l) => listas.includes(l.valor)) : LISTAS;
  const [marcas, setMarcas] = useState<MarcaConfig[]>([]);
  const [listaActiva, setListaActiva] = useState(listasAMostrar[0]?.valor || LISTAS[0].valor);
  const [nuevaMarca, setNuevaMarca] = useState("");
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

    const cargarMarcas = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fetchConToken(`${apiBase}/perucompras/marcas?uid=${encodeURIComponent(uid)}`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setMarcas(Array.isArray(data) ? data : []);
    } catch {
      setMarcas([]);
    } finally {
      setCargando(false);
    }
  }, [apiBase, uid]);

  useEffect(() => {
    cargarMarcas();
  }, [cargarMarcas]);

const agregarMarca = async () => {
    const marca = nuevaMarca.trim();
    if (!marca) return;
    setGuardando(true);
    setError("");
    try {
        const r = await fetchConToken(`${apiBase}/perucompras/marcas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lista: listaActiva, marca, uid }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || "Error agregando la marca");
      }
      setNuevaMarca("");
      await cargarMarcas();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setGuardando(false);
    }
  };

    const eliminarMarca = async (id: number) => {
    try {
      await fetchConToken(`${apiBase}/perucompras/marcas/${id}?uid=${encodeURIComponent(uid)}`, { method: "DELETE" });
      setMarcas((prev) => prev.filter((m) => m.id !== id));
    } catch {
      setError("No se pudo eliminar la marca");
    }
  };

  const marcasDeListaActiva = marcas.filter((m) => m.lista === listaActiva);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-4">
        <Tag size={16} className="text-[#4F46E5]" />
        <p className="text-sm font-semibold text-slate-800">Configuración de marcas restringidas</p>
      </div>

        <div className="flex flex-wrap gap-1 border-b border-slate-200 mb-4">
        {listasAMostrar.map((l) => (
          <button
            key={l.valor}
            type="button"
            onClick={() => setListaActiva(l.valor)}
            className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
              listaActiva === l.valor ? "border-[#4F46E5] text-[#4F46E5]" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <input
          value={nuevaMarca}
          onChange={(e) => setNuevaMarca(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && agregarMarca()}
          placeholder="Nombre de la marca (ej. ECOLIMPIA)"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        />
        <button
          type="button"
          onClick={agregarMarca}
          disabled={guardando || !nuevaMarca.trim()}
          className="flex items-center gap-1.5 bg-[#4F46E5] hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg px-4 py-2 disabled:opacity-40 transition-colors"
        >
          {guardando ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
          Agregar
        </button>
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-red-600 mb-3">
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      {cargando ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
          <Loader2 size={14} className="animate-spin" /> Cargando...
        </div>
      ) : marcasDeListaActiva.length === 0 ? (
        <p className="text-xs text-slate-400 py-2">Sin marcas en esta lista todavía.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {marcasDeListaActiva.map((m) => (
            <span
              key={m.id}
              className="flex items-center gap-1.5 text-xs font-medium bg-slate-50 border border-slate-200 rounded-full pl-3 pr-1.5 py-1"
              title={m.creado_por ? `Agregado por ${m.creado_por}` : undefined}
            >
              {m.marca}
              <button
                type="button"
                onClick={() => eliminarMarca(m.id)}
                className="w-4 h-4 rounded-full bg-slate-200 hover:bg-red-200 text-slate-500 hover:text-red-700 flex items-center justify-center transition-colors"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}