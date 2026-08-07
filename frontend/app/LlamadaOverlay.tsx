"use client";

import { useEffect, useRef } from "react";
import { Phone, PhoneOff, Video, Mic, MicOff, VideoOff } from "lucide-react";

export interface LlamadaEstado {
  estado: "inactiva" | "saliente" | "entrante" | "conectada";
  conId: number | null;
  conNombre: string;
  conVideo: boolean;
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
}: LlamadaOverlayProps) {
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

      {/* Overlay de info arriba */}
      <div className="relative z-10 flex flex-col items-center gap-2 mt-10">
        <div className="w-24 h-24 rounded-full bg-indigo-600 flex items-center justify-center text-3xl font-semibold">
          {llamada.conNombre?.charAt(0).toUpperCase()}
        </div>
        <p className="text-lg font-semibold mt-2">{llamada.conNombre}</p>
        <p className="text-sm text-slate-300">
          {llamada.estado === "saliente" && "Llamando..."}
          {llamada.estado === "entrante" && (llamada.conVideo ? "Videollamada entrante" : "Llamada entrante")}
          {llamada.estado === "conectada" && "En llamada"}
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