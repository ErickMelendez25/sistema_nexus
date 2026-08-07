"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FileSpreadsheet, ShieldAlert, Tag, History, Settings2, Loader2, Boxes, Truck } from "lucide-react";
import { fetchConToken } from "../../helbot-shared";

import ExtraccionCatalogos from "./ExtraccionCatalogos";
import ExtraccionTabla from "./ExtraccionTabla";
import RestringidosTabla from "./RestringidosTabla";
import MarcasObjetivoTabla from "./MarcasObjetivoTabla";
import MarcasConfig from "./MarcasConfig";
import AuditoriaExtraccion from "./AuditoriaExtraccion";
import ModificarStock from "./ModificarStock";
import ModificarPlazo from "./ModificarPlazo";

type TabPrincipal = "extraidas" | "restringir" | "marcas" | "stock" | "plazo" | "auditoria";

const TABS_PRINCIPALES: { valor: TabPrincipal; label: string; icon: any }[] = [
  { valor: "extraidas", label: "Proformas extraídas", icon: FileSpreadsheet },
  { valor: "restringir", label: "Proformas para restringir", icon: ShieldAlert },
  { valor: "marcas", label: "Proformas marcas", icon: Tag },
  { valor: "stock", label: "Modificar Stock", icon: Boxes },
  { valor: "plazo", label: "Modificar Plazo", icon: Truck },
  { valor: "auditoria", label: "Auditoría", icon: History },
];

    export default function PerucomprasPanel({
    apiBase,
    uid,
    onExtraccionEstadoChange,
    }: {
    apiBase: string;
    uid: string;
    onExtraccionEstadoChange?: (corriendo: boolean) => void;
    }) {
  const [tabPrincipal, setTabPrincipal] = useState<TabPrincipal>("extraidas");
  const [subTabRestringir, setSubTabRestringir] = useState<"proformas" | "configurar">("proformas");
  const [subTabMarcas, setSubTabMarcas] = useState<"proformas" | "configurar">("proformas");

  const [catalogos, setCatalogos] = useState<string[]>([]);
  const [cargandoCatalogos, setCargandoCatalogos] = useState(true);
  const [extraccionCorriendo, setExtraccionCorriendo] = useState(false);
  // Espejo de extraccionCorriendo en un ref: handleEstadoExtraccion puede
  // ser invocada desde un closure "congelado" (el setInterval de
  // ExtraccionCatalogos guarda la versión de esta función que existía
  // en el momento del click, y nunca se actualiza en los renders
  // siguientes — stale closure clásico de React). Leer un useState
  // desde ahí siempre trae el valor viejo. Un ref no tiene ese problema:
  // es el MISMO objeto en memoria en todos los renders, así que
  // `.current` siempre da el valor más reciente sin importar qué tan
  // vieja sea la función que lo está leyendo.
  const extraccionCorriendoRef = useRef(false);
  // Cambia cada vez que una extracción termina — se pasa como prop `tick`
  // a las 4 pestañas para que se refresquen solas, sin que el usuario
  // tenga que darle "Refrescar" a mano en cada una.
  const [tickExtraccion, setTickExtraccion] = useState(0);

const cargarCatalogos = useCallback(async () => {
    setCargandoCatalogos(true);
    try {
     const r = await fetchConToken(`${apiBase}/perucompras/extraccion/catalogos?uid=${encodeURIComponent(uid)}`);
      if (!r.ok) throw new Error();
      const data = await r.json();
      setCatalogos(Array.isArray(data) ? data : []);
    } catch {
      setCatalogos([]);
    } finally {
      setCargandoCatalogos(false);
    }
  }, [apiBase, uid]);

  useEffect(() => {
    cargarCatalogos();
  }, [cargarCatalogos]);

  // Si acaba de terminar una extracción, refresca la lista de catálogos
  // (por si apareció uno nuevo) sin que el usuario tenga que recargar.
// Si acaba de terminar una extracción, refresca la lista de catálogos
  // (por si apareció uno nuevo) y SOLO DESPUÉS avisa a las pestañas via
  // tick. El orden importa: si el tick se dispara antes de que
  // cargarCatalogos() haya terminado (es async), ExtraccionTabla puede
  // recibir el tick con catalogoActivo todavía en "" (primera vez que
  // hay catálogos) y su cargarDatos() se sale sin hacer nada por la
  // guardia `if (!catalogoActivo) return`. Awaiteando acá, garantizamos
  // que el catálogo ya esté seleccionado en el hijo antes de que el
  // tick le pida refrescar.
  const handleEstadoExtraccion = async (corriendo: boolean) => {
    const estabaCorriendo = extraccionCorriendoRef.current;
    extraccionCorriendoRef.current = corriendo;
    setExtraccionCorriendo(corriendo);
    onExtraccionEstadoChange?.(corriendo);
    if (estabaCorriendo && !corriendo) {
      await cargarCatalogos();
      setTickExtraccion((t) => t + 1);
    }
  };

    return (
    <div className="space-y-3">
      <ExtraccionCatalogos apiBase={apiBase} uid={uid} onEstadoChange={handleEstadoExtraccion} />

      {/* Tabs principales */}
      <div className="bg-white border border-slate-200 rounded-xl p-1 flex flex-wrap gap-1">
        {TABS_PRINCIPALES.map((t) => {
          const Icon = t.icon;
          const activo = tabPrincipal === t.valor;
          return (
            <button
              key={t.valor}
              type="button"
              onClick={() => setTabPrincipal(t.valor)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                activo ? "bg-[#4F46E5] text-white shadow-sm" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Icon size={15} />
              {t.label}
            </button>
          );
        })}
      </div>

      {cargandoCatalogos ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-10 justify-center">
          <Loader2 size={16} className="animate-spin" /> Cargando catálogos...
        </div>
      ) : (
        <div className="bg-slate-50/60 border border-slate-200 rounded-xl p-3">
          {tabPrincipal === "extraidas" && (
           <ExtraccionTabla apiBase={apiBase} catalogos={catalogos} uid={uid} tick={tickExtraccion} />
          )}

          {tabPrincipal === "restringir" && (
            <div>
              <div className="flex items-center gap-1 mb-3 border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => setSubTabRestringir("proformas")}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                    subTabRestringir === "proformas" ? "border-red-500 text-red-700" : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <ShieldAlert size={14} /> Proformas
                </button>
                <button
                  type="button"
                  onClick={() => setSubTabRestringir("configurar")}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                    subTabRestringir === "configurar" ? "border-red-500 text-red-700" : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <Settings2 size={14} /> Configurar marcas restringidas
                </button>
              </div>

                {subTabRestringir === "proformas" ? (
                <RestringidosTabla apiBase={apiBase} catalogos={catalogos} uid={uid} tick={tickExtraccion} />
              ) : (
                <MarcasConfig apiBase={apiBase} uid={uid} listas={["restringida_semaforo", "prohibida_500_1000", "excepcion_menor_500"]} />
              )}
            </div>
          )}

          {tabPrincipal === "marcas" && (
            <div>
              <div className="flex items-center gap-1 mb-3 border-b border-slate-200">
                <button
                  type="button"
                  onClick={() => setSubTabMarcas("proformas")}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                    subTabMarcas === "proformas" ? "border-[#4F46E5] text-[#4F46E5]" : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <Tag size={14} /> Proformas
                </button>
                <button
                  type="button"
                  onClick={() => setSubTabMarcas("configurar")}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                    subTabMarcas === "configurar" ? "border-[#4F46E5] text-[#4F46E5]" : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <Settings2 size={14} /> Configurar marca objetivo
                </button>
              </div>

              {subTabMarcas === "proformas" ? (
                <MarcasObjetivoTabla apiBase={apiBase} catalogos={catalogos} uid={uid} tick={tickExtraccion} />
              ) : (
               <MarcasConfig apiBase={apiBase} uid={uid} listas={["objetivo"]} />
              )}
            </div>
          )}

          {tabPrincipal === "stock" && <ModificarStock apiBase={apiBase} uid={uid} />}

          {tabPrincipal === "plazo" && <ModificarPlazo apiBase={apiBase} uid={uid} />}

          {tabPrincipal === "auditoria" && <AuditoriaExtraccion apiBase={apiBase} uid={uid} tick={tickExtraccion} />}
        </div>
      )}
    </div>
  );
}