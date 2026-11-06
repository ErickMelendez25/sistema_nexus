"use client";

import { useEffect } from "react";

const API_BASE = process.env.NEXT_PUBLIC_HELBOT_API || "http://localhost:4001";
const WS_BASE = API_BASE.replace(/^http/, "ws");

export default function SesionGuard() {
  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let terminado = false;

    const cerrarSesion = (mensaje: string) => {
      terminado = true;
      localStorage.removeItem("helbot_token");
      localStorage.removeItem("helbot_usuario");
      localStorage.setItem("helbot_aviso", mensaje);
      window.location.href = "/login";
    };

    const conectar = () => {
      if (terminado) return;
      const token = localStorage.getItem("helbot_token");
      if (!token) {
        timer = setTimeout(conectar, 2000); // aún no hay sesión (estás en /login)
        return;
      }

      ws = new WebSocket(`${WS_BASE}/auth/ws?token=${encodeURIComponent(token)}`);

      ws.onmessage = (ev) => {
        let data: { tipo?: string; mensaje?: string };
        try {
          data = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (data.tipo !== "sesion_desplazada" && data.tipo !== "sesion_invalida") return;

        // Si otra pestaña de ESTE navegador ya guardó un token nuevo, no cierres sesión:
        // solo reconecta con el token nuevo.
        if (localStorage.getItem("helbot_token") !== token) {
          ws?.close();
          return;
        }
        cerrarSesion(data.mensaje || "Tu sesión se cerró. Vuelve a iniciar sesión.");
      };

      ws.onclose = () => {
        if (!terminado) timer = setTimeout(conectar, 3000); // reconecta si se cayó la red
      };
    };

    conectar();

    return () => {
      terminado = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, []);

  return null;
}