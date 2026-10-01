"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video, Mic, MicOff, VideoOff, UserPlus } from "lucide-react";
import { API_BASE } from "./helbot-shared";

function formatearDuracion(segundos: number) {
  const m = Math.floor(segundos / 60).toString().padStart(2, "0");
  const s = (segundos % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export interface LlamadaEstado {
  estado: "inactiva" | "saliente" | "entrante" | "conectada";
  conId: number | null;
  conNombre: string;
  conVideo: boolean;
  conFoto: string | null;
}

export interface ParticipanteLlamada {
  id: number;
  nombre: string;
  foto: string | null;
  stream: MediaStream | null;
}

export interface ContactoInvitable {
  id: number;
  nombre: string;
  foto: string | null;
}

function AvatarLlamada({ nombre, foto, size }: { nombre: string; foto: string | null; size: number }) {
  const [error, setError] = useState(false);
  useEffect(() => setError(false), [foto]);
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="rounded-full bg-indigo-600 flex items-center justify-center font-semibold overflow-hidden shrink-0"
    >
      {foto && !error ? (
        <img
          src={`${API_BASE}/archivos/${foto}`}
          alt={nombre}
          className="w-full h-full object-cover"
          onError={() => setError(true)}
        />
      ) : (
        nombre?.charAt(0).toUpperCase()
      )}
    </div>
  );
}

// Un <audio> por participante, SIEMPRE montado: es lo que hace sonar la voz.
function RemoteAudio({ stream }: { stream: MediaStream | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream;
    if (stream) ref.current.play().catch(() => {});
  }, [stream]);
  return <audio ref={ref} autoPlay />;
}

function Tile({ p, conVideo }: { p: ParticipanteLlamada; conVideo: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const tieneVideo = conVideo && !!p.stream && p.stream.getVideoTracks().length > 0;
  useEffect(() => {
    if (ref.current && p.stream) {
      ref.current.srcObject = p.stream;
      ref.current.play().catch(() => {});
    }
  }, [p.stream, tieneVideo]);

  return (
    <div className="relative bg-slate-900 rounded-xl overflow-hidden flex items-center justify-center min-h-0">
      {tieneVideo ? (
        <video ref={ref} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
      ) : (
        <div className="flex flex-col items-center gap-2">
          <AvatarLlamada nombre={p.nombre} foto={p.foto} size={88} />
          {!p.stream && <span className="text-xs text-slate-400">Conectando…</span>}
        </div>
      )}
      <span className="absolute bottom-2 left-2 text-xs bg-black/50 px-2 py-0.5 rounded">{p.nombre}</span>
    </div>
  );
}

interface LlamadaOverlayProps {
  llamada: LlamadaEstado;
  participantes: ParticipanteLlamada[];
  contactos: ContactoInvitable[];
  micActivo: boolean;
  camaraActiva: boolean;
  onAceptar: () => void;
  onRechazar: () => void;
  onColgar: () => void;
  onToggleMic: () => void;
  onToggleCamara: () => void;
  onInvitar: (id: number) => void;
  videoLocalRef: React.RefObject<HTMLVideoElement>;
}

export default function LlamadaOverlay({
  llamada,
  participantes,
  contactos,
  micActivo,
  camaraActiva,
  onAceptar,
  onRechazar,
  onColgar,
  onToggleMic,
  onToggleCamara,
  onInvitar,
  videoLocalRef,
}: LlamadaOverlayProps) {
  const [duracion, setDuracion] = useState(0);
  useEffect(() => {
    if (llamada.estado !== "conectada") {
      setDuracion(0);
      return;
    }
    const intervalo = setInterval(() => setDuracion((d) => d + 1), 1000);
    return () => clearInterval(intervalo);
  }, [llamada.estado]);

  const [panelAgregar, setPanelAgregar] = useState(false);
  useEffect(() => {
    if (llamada.estado !== "conectada") setPanelAgregar(false);
  }, [llamada.estado]);

  if (llamada.estado === "inactiva") return null;

  const n = participantes.length;
  const cols = n <= 1 ? "grid-cols-1" : n === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2";

  return (
    <div className="fixed inset-0 z-[500] bg-slate-950/95 flex flex-col items-center text-white">
      {participantes.map((p) => (
        <RemoteAudio key={p.id} stream={p.stream} />
      ))}

      {llamada.estado === "conectada" ? (
        <>
          <div className="relative z-10 mt-4 text-center">
            <p className="text-sm font-semibold">
              {n > 1 ? `Llamada grupal · ${n + 1} personas` : llamada.conNombre}
            </p>
            <p style={{ fontFamily: "monospace" }} className="text-xs text-slate-300">
              {formatearDuracion(duracion)}
            </p>
          </div>
          <div className={`flex-1 w-full min-h-0 grid auto-rows-fr gap-2 p-2 ${cols}`}>
            {participantes.map((p) => (
              <Tile key={p.id} p={p} conVideo={llamada.conVideo} />
            ))}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2">
          <AvatarLlamada nombre={llamada.conNombre} foto={llamada.conFoto} size={96} />
          <p className="text-lg font-semibold mt-2">{llamada.conNombre}</p>
          <p style={{ fontFamily: "monospace" }} className="text-sm text-slate-300">
            {llamada.estado === "saliente" && "Llamando..."}
            {llamada.estado === "entrante" && (llamada.conVideo ? "Videollamada entrante" : "Llamada entrante")}
          </p>
        </div>
      )}

      {llamada.conVideo && (
        <video
          ref={videoLocalRef}
          autoPlay
          playsInline
          muted
          className="absolute bottom-28 right-6 w-32 h-44 rounded-xl object-cover border-2 border-white/20 z-10"
        />
      )}

      <div className="relative z-10 flex items-center gap-5 mt-auto mb-10 pt-3">
        {llamada.estado === "entrante" ? (
          <>
            <button
              onClick={onRechazar}
              className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-colors"
              title="Rechazar"
            >
              <PhoneOff size={22} />
            </button>
            <button
              onClick={onAceptar}
              className="w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-700 flex items-center justify-center transition-colors"
              title="Aceptar"
            >
              <Phone size={22} />
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onToggleMic}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                micActivo ? "bg-white/10 hover:bg-white/20" : "bg-white text-slate-900"
              }`}
              title={micActivo ? "Silenciar" : "Activar micrófono"}
            >
              {micActivo ? <Mic size={18} /> : <MicOff size={18} />}
            </button>

            {llamada.conVideo && (
              <button
                onClick={onToggleCamara}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                  camaraActiva ? "bg-white/10 hover:bg-white/20" : "bg-white text-slate-900"
                }`}
                title={camaraActiva ? "Apagar cámara" : "Encender cámara"}
              >
                {camaraActiva ? <Video size={18} /> : <VideoOff size={18} />}
              </button>
            )}

            {llamada.estado === "conectada" && (
              <button
                onClick={() => setPanelAgregar((v) => !v)}
                className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
                title="Agregar persona"
              >
                <UserPlus size={18} />
              </button>
            )}

            <button
              onClick={onColgar}
              className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-colors"
              title="Colgar"
            >
              <PhoneOff size={22} />
            </button>
          </>
        )}

        {panelAgregar && (
          <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-72 max-h-64 overflow-y-auto bg-slate-900 border border-white/10 rounded-xl p-2 shadow-2xl">
            <p className="text-[11px] text-slate-400 px-2 py-1">Agregar a la llamada</p>
            {contactos.length === 0 ? (
              <p className="text-xs text-slate-400 px-2 py-3">No hay nadie más en línea.</p>
            ) : (
              contactos.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    onInvitar(c.id);
                    setPanelAgregar(false);
                  }}
                  className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/10 text-left"
                >
                  <AvatarLlamada nombre={c.nombre} foto={c.foto} size={32} />
                  <span className="text-sm truncate">{c.nombre}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}