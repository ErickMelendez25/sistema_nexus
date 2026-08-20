"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  LogIn,
  Loader2,
  AlertTriangle,
  ShieldCheck,
  Eye,
  EyeOff,
  Radar,
  GitCompareArrows,
  Bell,
  User,
  Lock,
  ArrowRight,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_HELBOT_API || "http://localhost:4001";

const PUNTOS_CLAVE = [
  { icon: Radar, texto: "Monitorea publicadas de Perú Compras en tiempo real" },
  { icon: GitCompareArrows, texto: "Compara automáticamente contra tus ventas del ERP" },
  { icon: Bell, texto: "Notificaciones en vivo para todo el equipo" },
];

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);
const [cargando, setCargando] = useState(false);
const [error, setError] = useState("");
const [transicionExitosa, setTransicionExitosa] = useState(false);

const iniciarSesion = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError("");
    try {
      const r = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (r.status === 429) {
        throw new Error("Demasiados intentos. Espera 1 minuto antes de volver a intentar.");
      }
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || "Usuario o contraseña incorrectos");
      }
      const data = await r.json();
      // Guardamos el token y los datos del usuario para que page.tsx los use
      // en cada fetch (header Authorization) y para pintar catálogos permitidos.
      localStorage.setItem("helbot_token", data.token);
      localStorage.setItem("helbot_usuario", JSON.stringify(data.usuario));
      setTransicionExitosa(true);
      setTimeout(() => {
        router.push("/");
      }, 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex flex-col lg:flex-row overflow-hidden bg-[#10172A]">
      <style jsx global>{`
        @keyframes hb-kenburns {
          0% { transform: scale(1.02); }
          100% { transform: scale(1.07); }
        }

        @keyframes hb-flash {
          0% { opacity: 0; }
          40% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes hb-fade-up {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes hb-pulse-dot {
          0%, 100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.5); }
          70% { box-shadow: 0 0 0 6px rgba(52, 211, 153, 0); }
        }

        @keyframes hb-text-blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.45; }
        }
        .hb-blink-text {
          animation: hb-text-blink 1.8s ease-in-out infinite;
        }
        .hb-bg-kenburns {
          animation: hb-kenburns 26s ease-in-out infinite alternate;
        }
        .hb-fade-up {
          animation: hb-fade-up 0.5s ease-out both;
        }
        .hb-fade-up-delay {
          animation: hb-fade-up 0.5s ease-out 0.1s both;
        }
        .hb-live-dot {
          animation: hb-pulse-dot 2s ease-in-out infinite;
        }


        @keyframes hb-item-in {
          from { opacity: 0; transform: translateX(-8px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .hb-item-in {
          animation: hb-item-in 0.5s ease-out both;
        }

        @keyframes hb-logo-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(201,162,39,0); }
          50% { box-shadow: 0 0 18px 1px rgba(201,162,39,0.28); }
        }
        .hb-logo-glow {
          animation: hb-logo-glow 3.2s ease-in-out infinite;
        }

        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }


        @media (prefers-reduced-motion: reduce) {
          .hb-bg-kenburns, .hb-fade-up, .hb-fade-up-delay, .hb-live-dot {
            animation: none !important;
          }
        }
      `}</style>

      {transicionExitosa && (
        <div className="absolute inset-0 z-30 pointer-events-none bg-gradient-to-r from-transparent via-[#C9A227]/25 to-transparent animate-[hb-flash_0.85s_ease-out]" />
      )}

      {/* ================= PANEL DE IMAGEN — fondo completo en móvil, panel lateral en desktop ================= */}
      <div
        className={`relative w-full h-72 sm:h-96 lg:h-auto lg:w-[50%] xl:w-[70%] overflow-hidden bg-[#0A0F1D] shrink-0 transition-transform duration-[850ms] ease-[cubic-bezier(0.76,0,0.24,1)] ${
          transicionExitosa ? "-translate-x-full" : "translate-x-0"
        }`}
      >
        <div
          className="absolute inset-0 hb-bg-kenburns bg-cover bg-no-repeat"
          style={{
            backgroundImage: "url('/images/portada.png')",
            backgroundPosition: "center 22%",
          }}
        />
        {/* Overlay oscuro extra — SOLO en móvil, porque ahí el texto y la
            tarjeta flotan directo sobre la foto y necesitan contraste.
            En desktop se apaga (bg-transparent) porque el panel es angosto
            y el texto vive aparte, en el panel blanco de la derecha. */}
        <div className="absolute inset-0 bg-[#0A0F1D]/20 lg:bg-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0A0F1D]/70 to-transparent pointer-events-none" />
        <div className="absolute inset-y-0 right-0 w-px bg-black/10 hidden lg:block" />
      </div>

        {/* ================= PANEL PRINCIPAL — tarjeta arriba, texto debajo, en columna ================= */}
       <div
        className={`relative z-10 flex-1 flex items-center justify-center px-6 sm:px-10 py-12 transition-all duration-[850ms] ease-[cubic-bezier(0.76,0,0.24,1)] ${
          transicionExitosa ? "translate-x-full opacity-0" : "translate-x-0 opacity-100"
        }`}
      >
        <div className="w-full max-w-[420px] flex flex-col items-center gap-4 lg:gap-10">


            <div className="flex items-center justify-center gap-3 mb-6 flex-wrap">
              <div className="hb-logo-glow relative w-10 h-10 rounded-xl bg-gradient-to-br from-[#1B2A4E] to-[#0A0F1D] border border-[#C9A227]/40 flex items-center justify-center shrink-0 overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-[#C9A227]/15 to-transparent" />
                <ShieldCheck size={18} className="relative text-[#C9A227]" strokeWidth={2} />
              </div>
              <span className="font-semibold tracking-tight text-[15px] text-white">Nexus RPC</span>
              <span className="flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className="hb-live-dot absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                </span>
                <span
                  style={{ fontFamily: "var(--font-mono)" }}
                  className="hb-blink-text text-[10px] font-semibold text-emerald-400 tracking-wide uppercase"
                >
                  Sistema en línea
                </span>
              </span>
            </div>


          {/* ---- Tarjeta de credenciales — primero, arriba ---- */}
          <div className="hb-fade-up relative w-full bg-white border border-white/10 rounded-2xl shadow-[0_25px_70px_-20px_rgba(0,0,0,0.65)] p-8">
            <div className="mb-7">
              <p
                style={{ fontFamily: "var(--font-mono)" }}
                className="text-[10.5px] font-semibold text-[#1B2A4E] tracking-[0.18em] uppercase mb-2.5"
              >
                Acceso al sistema
              </p>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
                Bienvenido de nuevo
              </h2>
           
            </div>

            <form onSubmit={iniciarSesion} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="username"
                  style={{ fontFamily: "var(--font-mono)" }}
                  className="block text-[10.5px] font-semibold text-slate-500 tracking-[0.1em] uppercase mb-1.5"
                >
                  Usuario
                </label>
                <div className="relative">
                  <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoFocus
                    autoComplete="username"
                    disabled={cargando}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-400 focus:bg-white disabled:opacity-60 transition-all"
                    placeholder="tu.usuario"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="password"
                  style={{ fontFamily: "var(--font-mono)" }}
                  className="block text-[10.5px] font-semibold text-slate-500 tracking-[0.1em] uppercase mb-1.5"
                >
                  Contraseña
                </label>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    id="password"
                    type={mostrarPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    disabled={cargando}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-10 pr-10 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-400 focus:bg-white disabled:opacity-60 transition-all"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarPassword((v) => !v)}
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    aria-label={mostrarPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {mostrarPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2.5">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={cargando || !username || !password}
                className="group relative w-full flex items-center justify-center gap-2 overflow-hidden bg-[#10172A] text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#1B2438] active:scale-[0.99] transition-all shadow-[0_4px_14px_-4px_rgba(27,42,78,0.4)]"
              >
                {cargando && (
                  <span className="absolute inset-0 bg-gradient-to-r from-transparent via-[#C9A227]/25 to-transparent -translate-x-full animate-[shimmer_1.2s_ease-in-out_infinite]" />
                )}
                <span className="relative flex items-center justify-center gap-2">
                  {cargando ? (
                    <>
                      <Loader2 size={15} className="animate-spin text-[#C9A227]" />
                      Verificando…
                    </>
                  ) : (
                    <>
                      <LogIn size={15} />
                      Iniciar sesión
                      <ArrowRight size={14} className="opacity-0 -ml-1 w-0 group-hover:opacity-100 group-hover:ml-0 group-hover:w-3.5 transition-all duration-200" />
                    </>
                  )}
                </span>
              </button>
            </form>

            <p className="text-center text-[11px] text-slate-400 mt-6">
              ¿Problemas para ingresar? Contacta al equipo de soporte técnico.
            </p>
          </div>

          {/* ---- Bloque de texto — segundo, debajo de la tarjeta, centrado ---- */}
          <div className="hb-fade-up-delay w-full text-center">



            <div className="hidden lg:block">
              <h1
                className="text-3xl leading-[1.15] font-bold text-slate-900 lg:text-white mb-3"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Optimiza tus seguimientos.
              </h1>
              <p className="text-sm text-slate-500 lg:text-slate-300 leading-6 mb-6">
                Nexus conecta la gestión de acuerdos marco con tu ERP interno, para que nada se
                quede sin registrar.
              </p>

              <div className="relative space-y-5 mb-6 text-left inline-block">
                {PUNTOS_CLAVE.map(({ icon: Icon, texto }, i) => (
                  <div
                    key={i}
                    className="hb-item-in relative flex items-start gap-3.5 group"
                    style={{ animationDelay: `${0.15 + i * 0.12}s` }}
                  >
                    {i < PUNTOS_CLAVE.length - 1 && (
                      <span className="absolute left-[15px] top-8 w-px h-[22px] bg-gradient-to-b from-[#1B2A4E]/20 to-transparent lg:from-[#C9A227]/40" />
                    )}
                    <div className="relative w-8 h-8 rounded-full bg-gradient-to-br from-[#EEF1F6] to-white border border-[#1B2A4E]/10 lg:bg-gradient-to-br lg:from-white/10 lg:to-white/[0.03] lg:border-[#C9A227]/25 flex items-center justify-center shrink-0 transition-transform duration-200 ease-out group-hover:scale-110">
                      <Icon size={14} className="text-[#1B2A4E] lg:text-[#C9A227]" strokeWidth={2} />
                    </div>
                    <p className="text-[13px] text-slate-600 lg:text-slate-300 leading-5 pt-1.5">{texto}</p>
                  </div>
                ))}
              </div>

              <div className="w-10 h-px bg-gradient-to-r from-transparent via-[#C9A227]/40 to-transparent mx-auto mb-4" />

              <p className="text-[10.5px] text-slate-400 lg:text-white/50 tracking-wide">
                © {new Date().getFullYear()} Grupo RPC 
              </p>

              <p className="mt-2 flex items-center justify-center gap-2 text-[10.5px] tracking-wide">
                <span className="text-white/40">Powered by</span>

              <a
                  href="https://wankoraep.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="
                    font-bold
                    text-[#FFD84D]
                    underline-offset-4
                    drop-shadow-[0_0_7px_rgba(255,216,77,0.55)]
                    transition-all duration-300
                    hover:text-[#FFF0A3]
                    hover:drop-shadow-[0_0_14px_rgba(255,216,77,0.95)]
                  "
                >
                  wankoraEP.com
                </a>

                <span className="text-white/20">·</span>

                <span className="text-[10.5px] text-slate-400 lg:text-white/50 tracking-wide">
                  Ing. Melendez, Erick
                </span>

                <span className="text-white/20">·</span>

                <a
                  href="tel:+51971168000"
                  className="
                    text-white/50
                    transition-colors duration-300
                    hover:text-[#FFD84D]
                  "
                >
                  +51 971 168 000
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}