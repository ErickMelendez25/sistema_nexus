"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Cake, X, PartyPopper } from "lucide-react";

interface AlertaCumpleanos {
  tipo: "previo" | "dia";
  id_trabajador: number;
  nombre: string;
  dias_restantes?: number;
  mensaje: string;
}

interface TrabajadorCumple {
  id: number;
  nombre: string;
  fecha_nacimiento: string; // "YYYY-MM-DD"
  dias_aviso_previo: number;
  activo: boolean;
}

interface TrabajadorConCalculo extends TrabajadorCumple {
  diasRestantes: number;
  esHoy: boolean;
  fechaFormateada: string;
}

interface Props {
  apiBase: string;
  colapsado: boolean;
}

const MESES_CORTOS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
];

const COLORES_CONFETI = ["#f472b6", "#facc15", "#60a5fa", "#4ade80", "#c084fc", "#fb923c"];

/**
 * Calcula cuántos días faltan para la PRÓXIMA ocurrencia del cumpleaños
 * (este año o el que viene si ya pasó), y si cae exactamente hoy.
 * Usa componentes de fecha en horario LOCAL, no UTC, para evitar el
 * clásico bug de "cumpleaños un día antes/después" por zona horaria.
 */
function calcularProximaOcurrencia(fechaNacimientoISO: string): {
  diasRestantes: number;
  esHoy: boolean;
  fechaFormateada: string;
} {
  const [, mesStr, diaStr] = fechaNacimientoISO.split("-");
  const mes = parseInt(mesStr, 10) - 1; // 0-indexado
  const dia = parseInt(diaStr, 10);

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  let candidata = new Date(hoy.getFullYear(), mes, dia);
  candidata.setHours(0, 0, 0, 0);

  if (candidata.getTime() < hoy.getTime()) {
    candidata = new Date(hoy.getFullYear() + 1, mes, dia);
  }

  const msPorDia = 1000 * 60 * 60 * 24;
  const diasRestantes = Math.round((candidata.getTime() - hoy.getTime()) / msPorDia);

  return {
    diasRestantes,
    esHoy: diasRestantes === 0,
    fechaFormateada: `${dia} ${MESES_CORTOS[mes]}`,
  };
}

function ordenarYCalcular(trabajadores: TrabajadorCumple[]): TrabajadorConCalculo[] {
  return trabajadores
    .filter((t) => t.activo)
    .map((t) => ({ ...t, ...calcularProximaOcurrencia(t.fecha_nacimiento) }))
    .sort((a, b) => a.diasRestantes - b.diasRestantes);
}

function formatearDiasRestantes(diasRestantes: number): string {
  if (diasRestantes === 0) return "¡Hoy!";
  if (diasRestantes === 1) return "Mañana";
  if (diasRestantes < 7) return `En ${diasRestantes} días`;

  if (diasRestantes < 30) {
    const semanas = Math.floor(diasRestantes / 7);
    const restoDias = diasRestantes % 7;
    const txtSemanas = `${semanas} semana${semanas !== 1 ? "s" : ""}`;
    if (restoDias === 0) return `En ${txtSemanas}`;
    return `En ${txtSemanas} y ${restoDias} día${restoDias !== 1 ? "s" : ""}`;
  }

  const meses = Math.floor(diasRestantes / 30);
  const restoDias = diasRestantes % 30;
  const txtMeses = `${meses} mes${meses !== 1 ? "es" : ""}`;
  if (restoDias === 0) return `En ${txtMeses}`;
  return `En ${txtMeses} y ${restoDias} día${restoDias !== 1 ? "s" : ""}`;
}

// ─── CONFETI (canvas, sin librerías externas) ────────────────────────────
interface Particula {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotacion: number;
  velRotacion: number;
  color: string;
  ancho: number;
  alto: number;
  vida: number;
}

function ConfetiOverlay({ activo, onTerminar }: { activo: boolean; onTerminar: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    if (!activo) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const ajustarTamano = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    ajustarTamano();
    window.addEventListener("resize", ajustarTamano);

    // "Explosión" desde el centro de la pantalla, como una piñata reventando
    const originX = canvas.width / 2;
    const originY = canvas.height / 2;

    const particulas: Particula[] = Array.from({ length: 140 }, () => {
      const angulo = Math.random() * Math.PI * 2;
      const velocidad = 4 + Math.random() * 10;
      return {
        x: originX,
        y: originY,
        vx: Math.cos(angulo) * velocidad,
        vy: Math.sin(angulo) * velocidad - 3,
        rotacion: Math.random() * 360,
        velRotacion: (Math.random() - 0.5) * 20,
        color: COLORES_CONFETI[Math.floor(Math.random() * COLORES_CONFETI.length)],
        ancho: 6 + Math.random() * 6,
        alto: 10 + Math.random() * 8,
        vida: 1,
      };
    });

    const gravedad = 0.25;
    let cuadro = 0;
    const duracionCuadros = 150; // ~2.5s a 60fps

    function dibujar() {
      if (!ctx || !canvas) return;
      cuadro++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let algunaVisible = false;
      for (const p of particulas) {
        p.vy += gravedad;
        p.x += p.vx;
        p.y += p.vy;
        p.rotacion += p.velRotacion;
        p.vida = Math.max(0, 1 - cuadro / duracionCuadros);

        if (p.vida <= 0) continue;
        algunaVisible = true;

        ctx.save();
        ctx.globalAlpha = p.vida;
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotacion * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.ancho / 2, -p.alto / 2, p.ancho, p.alto);
        ctx.restore();
      }

      if (algunaVisible && cuadro < duracionCuadros) {
        animRef.current = requestAnimationFrame(dibujar);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        onTerminar();
      }
    }

    animRef.current = requestAnimationFrame(dibujar);

    return () => {
      window.removeEventListener("resize", ajustarTamano);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [activo, onTerminar]);




  if (!activo) return null;




  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-[80] pointer-events-none"
    />
  );
}



export default function CumpleanosWidget({ apiBase, colapsado }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [proximos, setProximos] = useState<TrabajadorConCalculo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alertasActivas, setAlertasActivas] = useState<AlertaCumpleanos[]>([]);
  const [toast, setToast] = useState<AlertaCumpleanos | null>(null);
  const [confetiActivo, setConfetiActivo] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const confetiYaLanzado = useRef<Set<string>>(new Set());

  const lanzarConfeti = useCallback((clave: string) => {
    // Evita relanzar el mismo confeti muchas veces (una vez por sesión / por persona / por día)
    if (confetiYaLanzado.current.has(clave)) return;
    confetiYaLanzado.current.add(clave);
    setConfetiActivo(true);
  }, []);

    useEffect(() => {
    if (!abierto) return;
    const manejarEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAbierto(false);
    };
    document.addEventListener("keydown", manejarEscape);
    return () => document.removeEventListener("keydown", manejarEscape);
  }, [abierto]);

  useEffect(() => {
    setCargando(true);
    setError(null);
    fetch(`${apiBase}/api/cumpleanos`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: TrabajadorCumple[]) => {
        const calculados = ordenarYCalcular(data);
        setProximos(calculados);
        const deHoy = calculados.filter((t) => t.esHoy);
        if (deHoy.length > 0) {
          lanzarConfeti(`carga-inicial-${deHoy.map((t) => t.id).join("-")}-${new Date().toDateString()}`);
        }
      })
      .catch((e) => setError(e.message || "No se pudo cargar"))
      .finally(() => setCargando(false));
  }, [apiBase, lanzarConfeti]);

  useEffect(() => {
    let cerradoManual = false;

    function conectar() {
      const wsUrl = apiBase.replace(/^http/, "ws") + "/api/cumpleanos/ws";
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const data: AlertaCumpleanos = JSON.parse(ev.data);
          setToast(data);
          setTimeout(() => setToast((actual) => (actual === data ? null : actual)), 8000);

          setAlertasActivas((prev) => {
            const sinDuplicado = prev.filter(
              (a) => !(a.id_trabajador === data.id_trabajador && a.tipo === data.tipo)
            );
            return [data, ...sinDuplicado].slice(0, 20);
          });

          if (data.tipo === "dia") {
            lanzarConfeti(`ws-${data.id_trabajador}-${new Date().toDateString()}`);
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!cerradoManual) setTimeout(conectar, 4000);
      };
    }

    conectar();
    return () => {
      cerradoManual = true;
      wsRef.current?.close();
    };
  }, [apiBase, lanzarConfeti]);

  const totalAlertas = alertasActivas.length;
  const hayHoy = proximos.some((t) => t.esHoy);

  return (
    <div className="px-2 py-2 border-t border-white/10 relative shrink-0">
      <ConfetiOverlay activo={confetiActivo} onTerminar={() => setConfetiActivo(false)} />

      <button
        onClick={() => setAbierto((v) => !v)}
        title="Cumpleaños"
        className={`flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-[13px] font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors relative ${
          colapsado ? "justify-center" : ""
        }`}
      >
        <span className="relative shrink-0">
          <Cake size={17} className={hayHoy ? "text-pink-400" : ""} />
          {(totalAlertas > 0 || hayHoy) && (
            <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-1 flex items-center justify-center rounded-full bg-pink-500 text-white text-[8px] font-semibold">
              {totalAlertas > 9 ? "9+" : totalAlertas > 0 ? totalAlertas : "!"}
            </span>
          )}
        </span>
        {!colapsado && "Cumpleaños"}
      </button>

      {abierto && (
        <div
          className="fixed inset-0 z-[85] flex items-center justify-center p-4"
          onClick={() => setAbierto(false)}
        >
          <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-sm bg-[#10172A] border border-white/10 rounded-2xl shadow-2xl max-h-[80vh] flex flex-col overflow-hidden animate-[fadeIn_0.15s_ease-out]"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
              <p className="text-sm font-semibold text-white flex items-center gap-2">
                <Cake size={16} className="text-pink-400" /> Cumpleaños
              </p>
              <button onClick={() => setAbierto(false)} className="text-slate-400 hover:text-white">
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto">
              {alertasActivas.length > 0 && (
                <div className="px-3 py-2 space-y-1.5 border-b border-white/10">
                  <p className="text-[10px] text-pink-300 uppercase tracking-wide font-semibold px-1">Alertas</p>
                  {alertasActivas.map((a, i) => (
                    <div key={i} className="text-[11.5px] text-slate-200 bg-pink-500/10 border border-pink-400/20 rounded-lg px-2.5 py-1.5">
                      {a.mensaje}
                    </div>
                  ))}
                </div>
              )}

              <div className="px-3 py-2 space-y-1">
                <p className="text-[10px] text-slate-500 uppercase tracking-wide font-semibold px-1">Próximos</p>

                {cargando && (
                  <p className="text-[11px] text-slate-500 px-1 py-2">Cargando...</p>
                )}

                {!cargando && error && (
                  <p className="text-[11px] text-red-400 px-1 py-2">Error: {error}</p>
                )}

                {!cargando && !error && proximos.length === 0 && (
                  <p className="text-[11px] text-slate-500 px-1 py-2">Sin cumpleaños registrados.</p>
                )}

                {!cargando && !error && proximos.map((t) => {
                  const esProximo = !t.esHoy && t.diasRestantes <= 2;
                  return (
                    <div
                      key={t.id}
                      className={`flex items-center justify-between gap-2 text-[11.5px] px-2 py-1.5 rounded-lg ${
                        t.esHoy
                          ? "bg-pink-500/15 border border-pink-400/30 text-white"
                          : esProximo
                          ? "bg-amber-500/15 border border-amber-400/40 text-amber-100 font-semibold"
                          : "text-slate-300"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 min-w-0 truncate">
                        {t.esHoy && <PartyPopper size={12} className="text-pink-400 shrink-0" />}
                        {esProximo && <Cake size={12} className="text-amber-400 shrink-0" />}
                        <span className="truncate">{t.nombre}</span>
                      </span>
                      <span
                        className={`font-mono text-[10px] shrink-0 whitespace-nowrap ${
                          t.esHoy
                            ? "text-pink-300 font-semibold"
                            : esProximo
                            ? "text-amber-300 font-semibold"
                            : "text-slate-500"
                        }`}
                      >
                        {t.esHoy ? "¡Hoy!" : `${t.fechaFormateada} · ${formatearDiasRestantes(t.diasRestantes)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 left-4 z-[70] bg-[#10172A] border border-pink-400/30 rounded-xl shadow-2xl px-4 py-3 flex items-center gap-2.5 animate-[fadeIn_0.2s_ease-out] max-w-xs">
          <Cake size={18} className="text-pink-400 shrink-0" />
          <p className="text-[12.5px] text-white leading-snug">{toast.mensaje}</p>
        </div>
      )}
    </div>
  );
}