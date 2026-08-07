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
      router.push("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex overflow-hidden bg-[#F6F7FA]">
      <style jsx global>{`
        @keyframes hb-kenburns {
          0% { transform: scale(1.02); }
          100% { transform: scale(1.07); }
        }
        @keyframes hb-fade-up {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes hb-pulse-dot {
          0%, 100% { box-shadow: 0 0 0 0 rgba(52, 211, 153, 0.5); }
          70% { box-shadow: 0 0 0 6px rgba(52, 211, 153, 0); }
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
        @media (prefers-reduced-motion: reduce) {
          .hb-bg-kenburns, .hb-fade-up, .hb-fade-up-delay, .hb-live-dot {
            animation: none !important;
          }
        }
      `}</style>

      {/* ================= PANEL DE IMAGEN — fondo completo en móvil, panel lateral en desktop ================= */}
      <div className="absolute inset-0 lg:relative lg:inset-auto lg:w-[50%] xl:w-[70%] overflow-hidden bg-[#0A0F1D] shrink-0">
        <div
          className="absolute inset-0 hb-bg-kenburns bg-cover bg-no-repeat"
          style={{
            backgroundImage: "url('/images/login-rpc.png')",
            backgroundPosition: "center 22%",
          }}
        />
        {/* Overlay oscuro extra — SOLO en móvil, porque ahí el texto y la
            tarjeta flotan directo sobre la foto y necesitan contraste.
            En desktop se apaga (bg-transparent) porque el panel es angosto
            y el texto vive aparte, en el panel blanco de la derecha. */}
        <div className="absolute inset-0 bg-[#0A0F1D]/60 lg:bg-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#0A0F1D]/70 to-transparent pointer-events-none" />
        <div className="absolute inset-y-0 right-0 w-px bg-black/10 hidden lg:block" />
      </div>

        {/* ================= PANEL PRINCIPAL — tarjeta arriba, texto debajo, en columna ================= */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-6 sm:px-10 py-12">
        <div className="w-full max-w-[420px] flex flex-col items-center gap-10 bg-white/95 backdrop-blur-sm rounded-3xl p-6 shadow-2xl lg:bg-transparent lg:backdrop-blur-none lg:rounded-none lg:p-0 lg:shadow-none">
          {/* ---- Tarjeta de credenciales — primero, arriba ---- */}
          <div className="hb-fade-up w-full bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-900/5 p-8">
            <div className="mb-7">
              <p
                style={{ fontFamily: "var(--font-mono)" }}
                className="text-[10.5px] font-semibold text-[#4F46E5] tracking-[0.18em] uppercase mb-2.5"
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
                className="group w-full flex items-center justify-center gap-2 bg-[#10172A] text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#1B2438] active:scale-[0.99] transition-all"
              >
                {cargando ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    Verificando…
                  </>
                ) : (
                  <>
                    <LogIn size={15} />
                    Iniciar sesión
                    <ArrowRight size={14} className="opacity-0 -ml-1 w-0 group-hover:opacity-100 group-hover:ml-0 group-hover:w-3.5 transition-all duration-200" />
                  </>
                )}
              </button>
            </form>

            <p className="text-center text-[11px] text-slate-400 mt-6">
              ¿Problemas para ingresar? Contacta al administrador de tu equipo.
            </p>
          </div>

          {/* ---- Bloque de texto — segundo, debajo de la tarjeta, centrado ---- */}
          <div className="hb-fade-up-delay w-full text-center">
            <div className="flex items-center justify-center gap-3 mb-6 flex-wrap">
              <div className="w-9 h-9 rounded-lg bg-[#10172A] flex items-center justify-center shrink-0">
                <ShieldCheck size={17} className="text-white" strokeWidth={2} />
              </div>
              <span className="font-semibold tracking-tight text-[15px] text-slate-900">Nexus RPC</span>
              <span className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-full pl-2 pr-2.5 py-1">
                <span className="relative flex h-1.5 w-1.5 shrink-0">
                  <span className="hb-live-dot absolute inline-flex h-full w-full rounded-full bg-emerald-500" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                <span
                  style={{ fontFamily: "var(--font-mono)" }}
                  className="text-[10px] font-semibold text-emerald-700 tracking-wide uppercase"
                >
                  Sistema en línea
                </span>
              </span>
            </div>

            <p className="text-[11px] font-medium text-[#4F46E5] tracking-[0.2em] uppercase mb-3">
              Perú Compras ↔ ERP
            </p>
            <h1
              className="text-3xl leading-[1.15] font-bold text-slate-900 mb-3"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Optimiza tus seguimientos.
            </h1>
            <p className="text-sm text-slate-500 leading-6 mb-6">
              Helbot conecta la gestión de acuerdos marco con tu ERP interno, para que nada se
              quede sin registrar.
            </p>

            <div className="space-y-3 mb-6 text-left inline-block">
              {PUNTOS_CLAVE.map(({ icon: Icon, texto }, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon size={13} className="text-[#4F46E5]" strokeWidth={2} />
                  </div>
                  <p className="text-[13px] text-slate-600 leading-5 pt-1">{texto}</p>
                </div>
              ))}
            </div>

            <p className="text-[10.5px] text-slate-400 tracking-wide">
              EMPRESA GRUPO RPC · 
              Developed by WankoraEP - Ing. Melendez
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}