"use client";

import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Video, Mic, MicOff, VideoOff } from "lucide-react";
import { API_BASE } from "./helbot-shared";

// mm:ss — igual que el contador de duración de WhatsApp.
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

interface LlamadaOverlayProps {
  llamada: LlamadaEstado;
  micActivo: boolean;
  camaraActiva: boolean;
  onAceptar: () => void;
  onRechazar: () => void;
  onColgar: () => void;
  onToggleMic: () => void;
  onToggleCamara: () => void;
  videoLocalRef: React.RefObject<HTMLVideoElement>;
  videoRemotoRef: React.RefObject<HTMLVideoElement>;
  audioRemotoRef: React.RefObject<HTMLAudioElement>;
}

export default function LlamadaOverlay({
  llamada,
  micActivo,
  camaraActiva,
  onAceptar,
  onRechazar,
  onColgar,
  onToggleMic,
  onToggleCamara,
  videoLocalRef,
  videoRemotoRef,
  audioRemotoRef,
}: LlamadaOverlayProps) {
  // Arranca en 0 apenas el estado pasa a "conectada" (en AMBOS usuarios,
  // porque cada uno recibe ese cambio de estado por su lado) y se
  // resetea apenas deja de estar conectada — así nunca arrastra un
  // valor viejo a la siguiente llamada.
  const [duracion, setDuracion] = useState(0);
  useEffect(() => {
    if (llamada.estado !== "conectada") {
      setDuracion(0);
      return;
    }
    const intervalo = setInterval(() => setDuracion((d) => d + 1), 1000);
    return () => clearInterval(intervalo);
  }, [llamada.estado]);

  // Si la foto guardada ya no existe en el servidor, cae a la inicial
  // — mismo patrón que AvatarToastChat en la página principal.
  const [fotoError, setFotoError] = useState(false);
  useEffect(() => setFotoError(false), [llamada.conFoto]);

  if (llamada.estado === "inactiva") return null;

  return (
    <div className="fixed inset-0 z-[500] bg-slate-950/95 flex flex-col items-center justify-center text-white">
      {/* Video remoto de fondo, si es videollamada y ya conectó */}
      {llamada.conVideo && llamada.estado === "conectada" && (
        <video
          ref={videoRemotoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}

      
      {/* Audio remoto — SIEMPRE montado, tenga o no video. Es lo que
          faltaba: en llamada de solo voz nunca se monta el <video> de
          arriba, así que sin esto el stream remoto nunca se reproduce. */}
      <audio ref={audioRemotoRef} autoPlay />

      {/* Overlay de info arriba */}
      <div className="relative z-10 flex flex-col items-center gap-2 mt-10">
        <div className="w-24 h-24 rounded-full bg-indigo-600 flex items-center justify-center text-3xl font-semibold overflow-hidden">
          {llamada.conFoto && !fotoError ? (
            <img
              src={`${API_BASE}/archivos/${llamada.conFoto}`}
              alt={llamada.conNombre}
              className="w-full h-full object-cover"
              onError={() => setFotoError(true)}
            />
          ) : (
            llamada.conNombre?.charAt(0).toUpperCase()
          )}
        </div>
        <p className="text-lg font-semibold mt-2">{llamada.conNombre}</p>
        <p style={{ fontFamily: "monospace" }} className="text-sm text-slate-300">
          {llamada.estado === "saliente" && "Llamando..."}
          {llamada.estado === "entrante" && (llamada.conVideo ? "Videollamada entrante" : "Llamada entrante")}
          {llamada.estado === "conectada" && formatearDuracion(duracion)}
        </p>
      </div>

      {/* Video local, pequeño, esquina — solo si hay video */}
      {llamada.conVideo && (
        <video
          ref={videoLocalRef}
          autoPlay
          playsInline
          muted
          className="absolute bottom-28 right-6 w-32 h-44 rounded-xl object-cover border-2 border-white/20 z-10"
        />
      )}

      {/* Controles */}
      <div className="relative z-10 flex items-center gap-5 mt-auto mb-16">
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

            <button
              onClick={onColgar}
              className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-colors"
              title="Colgar"
            >
              <PhoneOff size={22} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}