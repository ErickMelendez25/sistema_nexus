"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API_BASE = process.env.NEXT_PUBLIC_HELBOT_API || "http://localhost:4001";

const inputCls =
  "w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/25 focus:border-indigo-400 focus:bg-white disabled:opacity-60";
const labelCls = "block text-xs font-semibold text-slate-500 uppercase mb-1.5";

export default function Activar2FAPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invitacion, setInvitacion] = useState("");
  const [enrolToken, setEnrolToken] = useState<string | null>(null);
  const [qr, setQr] = useState("");

  const [codigo, setCodigo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");

  const llamar = async (ruta: string, cuerpo: object) => {
    const r = await fetch(`${API_BASE}${ruta}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    if (r.status === 429) throw new Error("Demasiados intentos. Espera 1 minuto.");
    if (!r.ok) {
      const b = await r.json().catch(() => ({}));
      throw new Error(b.detail || "Error al procesar la solicitud");
    }
    return r.json();
  };

  const paso1 = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError("");
    try {
      const data = await llamar("/auth/2fa/iniciar", {
        username,
        password,
        codigo_invitacion: invitacion,
      });
      setEnrolToken(data.enrol_token);
      setQr(data.qr);

    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setCargando(false);
    }
  };

  const paso2 = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    setError("");
    try {
      const data = await llamar("/auth/2fa/confirmar", { enrol_token: enrolToken, codigo });
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
    <div className="min-h-screen flex items-center justify-center bg-[#10172A] px-6 py-12">
      <div className="w-full max-w-[420px] bg-white rounded-2xl p-8 shadow-2xl">
        <h1 className="text-xl font-bold text-slate-900 mb-1">Activar verificación en dos pasos</h1>

        {!enrolToken ? (
          <form onSubmit={paso1} className="space-y-4 mt-5">
            <p className="text-sm text-slate-500">
              Necesitas el código de invitación que te entregó el administrador.
            </p>
            <div>
              <label className={labelCls}>Usuario</label>
              <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" disabled={cargando} />
            </div>
            <div>
              <label className={labelCls}>Contraseña</label>
              <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" disabled={cargando} />
            </div>
            <div>
              <label className={labelCls}>Código de invitación</label>
              <input className={inputCls} value={invitacion} onChange={(e) => setInvitacion(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" disabled={cargando} />
            </div>
            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <button type="submit" disabled={cargando || !username || !password || !invitacion} className="w-full bg-[#10172A] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40">
              {cargando ? "Verificando…" : "Continuar"}
            </button>
          </form>
        ) : (
          <form onSubmit={paso2} className="space-y-4 mt-5">
            <ol className="text-sm text-slate-600 list-decimal pl-5 space-y-1">
              <li>Instala <b>Google Authenticator</b> o <b>Microsoft Authenticator</b> en tu celular.</li>
              <li>Toca <b>+</b> → <b>Escanear código QR</b> y apunta a esta pantalla.</li>
              <li>Escribe aquí el código de 6 dígitos que te muestra la app.</li>
            </ol>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR de verificación" className="mx-auto w-48 h-48" />

            <input
              className={inputCls + " text-center text-lg tracking-[0.5em]"}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              disabled={cargando}
            />
            {error && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
            <button type="submit" disabled={cargando || codigo.length < 6} className="w-full bg-[#10172A] text-white rounded-lg py-2.5 text-sm font-medium disabled:opacity-40">
              {cargando ? "Verificando…" : "Activar y entrar"}
            </button>
          </form>
        )}

        <a href="/login" className="block text-center text-xs text-slate-400 mt-5 hover:underline">
          Volver al inicio de sesión
        </a>
      </div>
    </div>
  );
}