  "use client";

  import { useState, useEffect, useRef, useCallback, useMemo } from "react";
  import { useRouter } from "next/navigation";
  import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
  import {
    Radar, Bell, FileScan, Search, CheckCircle2, Circle, Loader2,
    Upload, Wifi, WifiOff, ShieldCheck, DollarSign, RefreshCw, ChevronRight,
    AlertTriangle, X, LogIn, Menu, LucideIcon, GitCompareArrows, ChevronDown, ChevronUp,
  LogOut, BarChart3, User, Briefcase, PieChart, MessageSquare,
  } from "lucide-react";

  import TabVentasErp, {
    VentaErp,
    CardVentaErp,
    SkeletonGrid,
    codigoVentaDe,
    ocamDe,
  } from "./TabVentasErp"; // ajusta la ruta si lo pusiste en otra carpeta
  import OpsDrawer from "./OpsDrawer";
  import Sidebar, { SidebarTab } from "./Sidebar";

  import { MessageCircle } from "lucide-react";
  import ChatPanel from "./ChatPanel";

  import DocParaPago from "./components/cobranzas/DocParaPago";
  import CartaNotaDebito from "./components/cobranzas/CartaNotaDebito";
  import EquipoVentasOperaciones from "./components/equipo-ventas/EquipoVentasOperaciones";
  import EquipoVentasBigData from "./components/equipo-ventas/EquipoVentasBigData";

  import LlamadaOverlay, { LlamadaEstado } from "./LlamadaOverlay";


  import CrearOrdenModal from "./CrearOrdenModal";
  import TabFichaOcr from "./TabFichaOcr";
  import PanelConsultaMef from "./PanelConsultaMef";


  import {
    API_BASE,
    WS_URL,
    fetchConToken,
    Publicada,
    EntregaDetalle,
  } from "./helbot-shared";


  import { Venta } from "./erp-shared";
  // ============================================================
  // Tipografía — next/font evita el @import manual, el parpadeo de
  // fuente y el hydration mismatch que daba el <style> inline anterior.
  // ============================================================
  const spaceGrotesk = Space_Grotesk({
    subsets: ["latin"],
    weight: ["500", "600", "700"],
    variable: "--font-display",
    display: "swap",
  });
  const inter = Inter({
    subsets: ["latin"],
    weight: ["400", "500", "600", "700"],
    variable: "--font-body",
    display: "swap",
  });
  const jetbrainsMono = JetBrains_Mono({
    subsets: ["latin"],
    weight: ["400", "500"],
    variable: "--font-mono",
    display: "swap",
  });





  // Un solo AudioContext reutilizado (crear uno nuevo en cada notificación
  // deja instancias muertas y, si aún no hubo gesto del usuario, queda mudo
  // para siempre). Vive a nivel de módulo, no dentro del componente.
  let audioCtxNotificacion: AudioContext | null = null;

  function obtenerAudioCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AudioContextCls = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextCls) return null;
    if (!audioCtxNotificacion) {
      audioCtxNotificacion = new AudioContextCls();
    }
    return audioCtxNotificacion;
  }

  // Beep tipo notificación (dos tonos cortos ascendentes, estilo WhatsApp),
  // generado con Web Audio API, sin archivo .mp3 que subir ni cargar.
  function reproducirSonidoNotificacion() {
    const ctx = obtenerAudioCtx();
    if (!ctx) return;

    if (ctx.state === "suspended") {
      // Aún no hubo interacción del usuario en esta pestaña — el navegador
      // no deja sonar todavía. Se intenta reanudar para la próxima vez.
      ctx.resume().catch(() => {});
      return;
    }

    const tocarTono = (frecuencia: number, inicio: number, duracion: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frecuencia;
      osc.connect(gain);
      gain.connect(ctx.destination);

      const t0 = ctx.currentTime + inicio;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.15, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duracion);

      osc.start(t0);
      osc.stop(t0 + duracion);
    };

    tocarTono(880, 0, 0.12);
    tocarTono(1175, 0.1, 0.15);
  }



  // Sonido exclusivo para mensajes de chat — timbre "triangle" (más cálido
  // y campanudo que el "sine" genérico de arriba) con dos notas cortas
  // ascendentes tipo "campanilla", buscando la sensación del tono clásico
  // de mensajería de WhatsApp sin reproducir su audio real (evita
  // problemas de derechos de autor y de tamaño de archivo).
  function reproducirSonidoMensajeChat() {
    const ctx = obtenerAudioCtx();
    if (!ctx) return;

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
      return;
    }

    const tocarTono = (frecuencia: number, inicio: number, duracion: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = frecuencia;
      osc.connect(gain);
      gain.connect(ctx.destination);

      const t0 = ctx.currentTime + inicio;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.18, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + duracion);

      osc.start(t0);
      osc.stop(t0 + duracion);
    };

    tocarTono(1046.5, 0, 0.09);    // C6
    tocarTono(1318.5, 0.09, 0.14); // E6
  }


  // ============================================================
  // Tipos
  // ============================================================
  interface UsuarioPeru {
    uid: string;
    label: string;
  }

  interface UsuarioEstado {
    label: string;
    autenticado: boolean;
    estado: string;
  }

  interface SesionEstado {
    perucompras: Record<string, UsuarioEstado>;
    perucompras_activo: string | null;
    erp: boolean;
  }


  interface UsuarioActual {
    id: number;
    username: string;
    nombre_completo: string | null;
    rol: string;
    catalogos_permitidos: number[] | null;
    foto_perfil: string | null;
  }



  interface Mensaje {
    id: number;
    emisor_id: number;
    receptor_id: number;
    contenido: string;
    leido: boolean;
    creado_en: string;
  }


  interface UsuarioChat {
    id: number;
    username: string;
    nombre_completo: string;
    foto_perfil: string | null;
    rol: string;
    online?: boolean;
  }


interface ResumenChat {
  usuario_id: number;
  ultimo_mensaje: string | null;
  ultimo_mensaje_en: string | null;
  no_leidos: number;
  /** true si el último mensaje lo enviaste TÚ (no el otro usuario) —
   * solo entonces tiene sentido mostrar el check de enviado/visto. */
  ultimo_mensaje_propio?: boolean;
  /** true si el otro usuario YA vio tu último mensaje. */
  ultimo_mensaje_leido?: boolean;
}
  interface SeguimientoProductoResumen {
    orden_compra_id: number;
    producto_codigo: string;
    estado: "pendiente" | "preview" | "confirmado" | "subido";
    rellenado_por?: string | null;
    confirmado_por?: string | null;
    subido_por?: string | null;
    campos_faltantes?: string[];
  }

  interface Alerta {
    id: number;
    tipo?: string;
    titulo?: string;
    producto?: string;
    leida?: boolean;
    [key: string]: unknown;
  }



  interface Orden {
    id: number;
    publicada_id?: string;
    producto: string;
    cantidad: number;
    precio: number | null;
    estado_precio: "pendiente" | "completado";
    registrado_por: string;
    completado_por?: string | null;
  }

  type FiltroPublicadas = { acuerdo_marco: string; catalogo: string; categoria: string };

  type TabId = "monitor" | "ficha" | "ventas" | "ventas_erp" | "auditoria" |"chat"| "cobranzas-doc-pago"
    | "cobranzas-carta-nota" | "equipo-ventas-operaciones" | "equipo-ventas-bigdata";

  // ============================================================
  // Animaciones globales — styled-jsx (nativo de Next.js) serializa el
  // <style> de forma consistente entre servidor y cliente, a diferencia
  // de un string plano como hijo de texto de <style>.
  // ============================================================
  function HelbotGlobalStyles() {
    return (
      <style jsx global>{`
        @keyframes hb-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
        .hb-pulse { animation: hb-pulse 1.6s ease-in-out infinite; }

        @keyframes hb-slide-in {
          from { transform: translateY(-8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .hb-slide-in { animation: hb-slide-in 0.3s ease-out; }

        :focus-visible {
          outline: 2px solid #4f46e5;
          outline-offset: 2px;
        }

        @keyframes hb-pulse-glow {
          0%, 100% {
            border-color: #c7d2fe;
            box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.35);
            background-color: #ffffff;
          }
          50% {
            border-color: #4f46e5;
            box-shadow: 0 0 0 4px rgba(79, 70, 229, 0.18);
            background-color: #eef2ff;
          }
        }
        .hb-pulse-glow { animation: hb-pulse-glow 1.4s ease-in-out infinite; }
      `}</style>
    );
  }



  // Igual que AvatarUsuario de ChatPanel — cae a un círculo con la
  // inicial del nombre si no hay foto O si la foto guardada ya no existe
  // en el servidor (archivo borrado). Sin esto, el toast mostraba el
  // ícono de imagen rota del navegador en vez de algo consistente.
  function AvatarToastChat({ nombre, foto }: { nombre: string; foto: string | null }) {
    const [error, setError] = useState(false);
    const inicial = nombre?.charAt(0).toUpperCase() || "?";

    if (!foto || error) {
      return (
        <div className="w-7 h-7 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[11px] font-semibold shrink-0">
          {inicial}
        </div>
      );
    }

    return (
      <img
        src={`${API_BASE}/archivos/${foto}`}
        alt={nombre}
        className="w-7 h-7 rounded-full object-cover shrink-0"
        onError={() => setError(true)}
      />
    );
  }

  export default function HelbotPage() {
    const router = useRouter();
    const [verificandoSesion, setVerificandoSesion] = useState(true);
    const [usuario, setUsuario] = useState<UsuarioActual | null>(null);
    const [perfilAbierto, setPerfilAbierto] = useState(false);
    const [subiendoFoto, setSubiendoFoto] = useState(false);
    const [errorFoto, setErrorFoto] = useState("");

    const subirFotoPerfil = useCallback(async (archivo: File) => {
      setSubiendoFoto(true);
      setErrorFoto("");
      try {
        const fd = new FormData();
        fd.append("archivo", archivo);
        const r = await fetchConToken(`${API_BASE}/auth/perfil/foto`, {
          method: "POST",
          body: fd,
        });
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || "No se pudo subir la foto");
        }
        const data = await r.json();
        setUsuario((prev) => (prev ? { ...prev, foto_perfil: data.foto_perfil } : prev));
      } catch (e) {
        setErrorFoto(e instanceof Error ? e.message : "Error desconocido");
      } finally {
        setSubiendoFoto(false);
      }
    }, []);

    const eliminarFotoPerfil = useCallback(async () => {
      setSubiendoFoto(true);
      setErrorFoto("");
      try {
        const r = await fetchConToken(`${API_BASE}/auth/perfil/foto`, { method: "DELETE" });
        if (!r.ok) throw new Error("No se pudo quitar la foto");
        setUsuario((prev) => (prev ? { ...prev, foto_perfil: null } : prev));
      } catch (e) {
        setErrorFoto(e instanceof Error ? e.message : "Error desconocido");
      } finally {
        setSubiendoFoto(false);
      }
    }, []);

  const wsChatRef = useRef<WebSocket | null>(null);
    const [usuariosOnlineIds, setUsuariosOnlineIds] = useState<Set<number>>(new Set());
    const [resumenChats, setResumenChats] = useState<Record<number, ResumenChat>>({});
    // Mapa id -> {nombre, foto} para poder mostrar quién escribió en el
    // toast flotante. Se llena vía el callback que ChatPanel dispara al
    // cargar /chat/usuarios (ver onUsuariosCargados más abajo).
    const [usuariosChatMap, setUsuariosChatMap] = useState<Record<number, UsuarioChat>>({});
    const usuariosChatMapRef = useRef<Record<number, UsuarioChat>>({});
    useEffect(() => {
      usuariosChatMapRef.current = usuariosChatMap;
    }, [usuariosChatMap]);

    const manejarUsuariosChatCargados = useCallback((usuarios: UsuarioChat[]) => {
      const mapa: Record<number, UsuarioChat> = {};
      for (const u of usuarios) mapa[u.id] = u;
      setUsuariosChatMap(mapa);
    }, []);
    const [mensajeEntrante, setMensajeEntrante] = useState<{ mensaje: Mensaje; tick: number } | null>(null);
    const [escribiendoEvento, setEscribiendoEvento] = useState<{ de: number; tick: number } | null>(null);
    const [vistoEvento, setVistoEvento] = useState<{ por: number; tick: number } | null>(null);


    // ---------- Llamadas de voz/video (WebRTC) ----------
    const [llamada, setLlamada] = useState<LlamadaEstado>({
      estado: "inactiva",
      conId: null,
      conNombre: "",
      conVideo: false,
    });
    const [micActivo, setMicActivo] = useState(true);
    const [camaraActiva, setCamaraActiva] = useState(true);

    const pcRef = useRef<RTCPeerConnection | null>(null);
    const streamLocalRef = useRef<MediaStream | null>(null);
    const videoLocalRef = useRef<HTMLVideoElement>(null);
    const videoRemotoRef = useRef<HTMLVideoElement>(null);
    const llamadaRef = useRef(llamada);
    llamadaRef.current = llamada;

    const STUN_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

    const enviarSenalLlamada = useCallback((payload: Record<string, unknown>) => {
      const ws = wsChatRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(payload));
      }
    }, []);

    // Crea el RTCPeerConnection y le conecta el stream local + los
    // candidatos ICE que va generando (se mandan al otro por el WS).
    const crearPeerConnection = useCallback((paraId: number) => {
      const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          enviarSenalLlamada({
            tipo: "llamada_ice",
            para: paraId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      pc.ontrack = (event) => {
        if (videoRemotoRef.current) {
          videoRemotoRef.current.srcObject = event.streams[0];
        }
      };

      pcRef.current = pc;
      return pc;
    }, [enviarSenalLlamada]);

    // Pide cámara/mic al navegador y lo muestra en el video local.
  // Pide cámara/mic al navegador y lo muestra en el video local.
    const obtenerStreamLocal = useCallback(async (conVideo: boolean) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          "Este navegador no permite usar cámara/micrófono en esta conexión. Las llamadas requieren HTTPS o acceder por localhost."
        );
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: conVideo,
      });
      streamLocalRef.current = stream;
      if (videoLocalRef.current) {
        videoLocalRef.current.srcObject = stream;
      }
      return stream;
    }, []);

    const limpiarLlamada = useCallback(() => {
      pcRef.current?.close();
      pcRef.current = null;
      streamLocalRef.current?.getTracks().forEach((t) => t.stop());
      streamLocalRef.current = null;
      setMicActivo(true);
      setCamaraActiva(true);
      setLlamada({ estado: "inactiva", conId: null, conNombre: "", conVideo: false });
    }, []);

    // Botón de teléfono/video en ChatPanel llama a esto.
    const iniciarLlamada = useCallback(
      async (destinoId: number, destinoNombre: string, conVideo: boolean) => {
        setLlamada({ estado: "saliente", conId: destinoId, conNombre: destinoNombre, conVideo });
        enviarSenalLlamada({ tipo: "llamada_iniciar", para: destinoId, con_video: conVideo });

        const stream = await obtenerStreamLocal(conVideo);
        const pc = crearPeerConnection(destinoId);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const oferta = await pc.createOffer();
        await pc.setLocalDescription(oferta);
        enviarSenalLlamada({ tipo: "llamada_oferta", para: destinoId, sdp: oferta });
      },
      [enviarSenalLlamada, obtenerStreamLocal, crearPeerConnection]
    );

    const aceptarLlamada = useCallback(async () => {
      const actual = llamadaRef.current;
      if (!actual.conId) return;
      const destinoId = actual.conId;

      const stream = await obtenerStreamLocal(actual.conVideo);
      const pc = pcRef.current;
      if (!pc) return;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const respuesta = await pc.createAnswer();
      await pc.setLocalDescription(respuesta);
      enviarSenalLlamada({ tipo: "llamada_respuesta", para: destinoId, sdp: respuesta });

      setLlamada((prev) => ({ ...prev, estado: "conectada" }));
    }, [enviarSenalLlamada, obtenerStreamLocal]);

    const rechazarLlamada = useCallback(() => {
      const actual = llamadaRef.current;
      if (actual.conId) {
        enviarSenalLlamada({ tipo: "llamada_rechazar", para: actual.conId });
      }
      limpiarLlamada();
    }, [enviarSenalLlamada, limpiarLlamada]);

    const colgarLlamada = useCallback(() => {
      const actual = llamadaRef.current;
      if (actual.conId) {
        enviarSenalLlamada({ tipo: "llamada_colgar", para: actual.conId });
      }
      limpiarLlamada();
    }, [enviarSenalLlamada, limpiarLlamada]);

    const toggleMic = useCallback(() => {
      const activo = !micActivo;
      streamLocalRef.current?.getAudioTracks().forEach((t) => (t.enabled = activo));
      setMicActivo(activo);
    }, [micActivo]);

    const toggleCamara = useCallback(() => {
      const activa = !camaraActiva;
      streamLocalRef.current?.getVideoTracks().forEach((t) => (t.enabled = activa));
      setCamaraActiva(activa);
    }, [camaraActiva]);


    const crearPeerConnectionRef = useRef(crearPeerConnection);
    const limpiarLlamadaRef = useRef(limpiarLlamada);
    useEffect(() => {
      crearPeerConnectionRef.current = crearPeerConnection;
      limpiarLlamadaRef.current = limpiarLlamada;
    }, [crearPeerConnection, limpiarLlamada]);

    // Manda el "escribiendo..." por el ÚNICO socket de chat (el de este
    // componente) — ChatPanel ya no abre su propio WebSocket.
    const enviarEscribiendo = useCallback((paraId: number) => {
      const ws = wsChatRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ tipo: "escribiendo", para: paraId }));
      }
    }, []);

    // Limpia el badge de no-leídos al instante cuando el usuario abre esa
    // conversación en ChatPanel (antes de esperar la respuesta del REST).
    const marcarConversacionLeidaLocal = useCallback((usuarioId: number) => {
      setResumenChats((prev) => {
        const actual = prev[usuarioId];
        if (!actual || actual.no_leidos === 0) return prev;
        return { ...prev, [usuarioId]: { ...actual, no_leidos: 0 } };
      });
    }, []);


    // Actualiza al instante el "último mensaje" de la lista de chats
    // cuando YO envío un mensaje — sin depender de que el backend haga
    // eco del WebSocket de vuelta hacia mi propia conexión.
    const actualizarResumenPorMensajePropio = useCallback(
      (receptorId: number, contenido: string, creadoEn: string) => {
        setResumenChats((prev) => ({
          ...prev,
          [receptorId]: {
            usuario_id: receptorId,
            ultimo_mensaje: contenido,
            ultimo_mensaje_en: creadoEn,
            no_leidos: prev[receptorId]?.no_leidos || 0,
            ultimo_mensaje_propio: true,
            ultimo_mensaje_leido: false,
          },
        }));
      },
      []
    );

    const cargarResumenChats = useCallback(async () => {
      try {
        const r = await fetchConToken(`${API_BASE}/chat/resumen`);
        if (!r.ok) return;
        const data: ResumenChat[] = await r.json();
        setResumenChats((prev) => {
          const next: Record<number, ResumenChat> = { ...prev };
          for (const f of data) next[f.usuario_id] = f;
          return next;
        });
      } catch {
        /* noop */
      }
    }, []);

    const cerrarSesion = useCallback(() => {
      wsChatRef.current?.close();
      localStorage.removeItem("helbot_token");
      router.push("/login");
    }, [router]);

    // Consulta /auth/me con el token guardado y guarda el usuario real
    // (rol, catalogos_permitidos). Si el backend responde 401 (token
    // vencido o inválido) mandamos al usuario de vuelta al login.
    const verificarToken = useCallback(async () => {
      const token = localStorage.getItem("helbot_token");
      if (!token) {
        cerrarSesion();
        return;
      }
      try {
        const r = await fetch(`${API_BASE}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) {
          cerrarSesion();
          return;
        }
        const data: UsuarioActual = await r.json();
        setUsuario(data);
      } catch {
        // Si el backend está caído momentáneamente no cerramos sesión,
        // solo se reintenta en el siguiente ciclo.
      }
    }, [cerrarSesion]);

    useEffect(() => {
      const token = localStorage.getItem("helbot_token");
      if (!token) {
        router.push("/login");
        return;
      }
      verificarToken().finally(() => setVerificandoSesion(false));

      // Revisa cada 5 minutos si el token sigue siendo válido. Tu JWT en
      // auth.py expira a las JWT_EXP_HORAS = 12 horas — esto es lo que
      // hace que, pasado ese tiempo, se redirija solo al login.
  const intervaloSesion = setInterval(verificarToken, 5 * 60 * 1000);
      return () => clearInterval(intervaloSesion);
    }, [router, verificarToken]);

    // Conecta el WebSocket de presencia del chat apenas el usuario está
    // logueado en Helbot (usuario ya viene de /auth/me) — no depende de
    // en qué tab esté parado. Se cierra solo si usuario se vuelve null
    // o si el componente se desmonta (ej. cerrarSesion -> router.push).
  useEffect(() => {
      if (!usuario) return;
      cargarResumenChats();

      const token = localStorage.getItem("helbot_token");
      if (!token) return;

      const wsUrl = API_BASE.replace(/^http/, "ws") + `/chat/ws?token=${token}`;
      const ws = new WebSocket(wsUrl);
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.tipo === "ping") return;

        if (data.tipo === "estado_usuario") {
          setUsuariosOnlineIds((prev) => {
            const next = new Set(prev);
            if (data.online) next.add(data.usuario_id);
            else next.delete(data.usuario_id);
            return next;
          });
          return;
        }

        if (data.tipo === "mensaje_nuevo") {
          const m: Mensaje = data.mensaje;
          const otro = m.emisor_id === usuario.id ? m.receptor_id : m.emisor_id;
          const soyReceptor = m.receptor_id === usuario.id;
          setResumenChats((prev) => {
            const actual = prev[otro];
            return {
              ...prev,
              [otro]: {
                usuario_id: otro,
                ultimo_mensaje: m.contenido,
                ultimo_mensaje_en: m.creado_en,
                no_leidos: soyReceptor ? (actual?.no_leidos || 0) + 1 : actual?.no_leidos || 0,
                ultimo_mensaje_propio: !soyReceptor,
                ultimo_mensaje_leido: false,
              },
            };
          });
        setMensajeEntrante({ mensaje: m, tick: Date.now() });

      // Toast flotante de mensaje nuevo — solo si YO soy el receptor
          // y NO es justo la conversación que ya tengo abierta. Antes se
          // bloqueaba con solo estar en el tab "Chat", así que en mobile
          // (donde es fácil estar en ese tab) un mensaje de OTRA persona
          // distinta a la que estás viendo se perdía sin avisar nada.
          if (soyReceptor && m.emisor_id !== conversacionActivaIdRef.current) {
            const emisor = usuariosChatMapRef.current[m.emisor_id];
            reproducirSonidoMensajeChat();
            agregarAlertaFlotante({
              id: Date.now() + Math.random(),
              tipo: "chat_mensaje",
              leida: true,
              creado_en: m.creado_en,
              emisor_id: m.emisor_id,
              emisor_nombre: emisor?.nombre_completo || "Alguien",
              emisor_foto: emisor?.foto_perfil || null,
              contenido: m.contenido,
            } as Alerta);
          }
          return;
        }

        if (data.tipo === "escribiendo") {
          setEscribiendoEvento({ de: data.de, tick: Date.now() });
          return;
        }

        if (data.tipo === "mensajes_vistos") {
          setVistoEvento({ por: data.por, tick: Date.now() });
          // "data.por" es quien acaba de leer MIS mensajes — si el último
          // mensaje que le mandé a esa persona era mío, ahora se marca
          // como leído (double check azul en la lista).
          setResumenChats((prev) => {
            const actual = prev[data.por];
            if (!actual || !actual.ultimo_mensaje_propio) return prev;
            return { ...prev, [data.por]: { ...actual, ultimo_mensaje_leido: true } };
          });
          return;
        }

        // ---------- Señalización de llamadas ----------


        if (data.tipo === "llamada_oferta") {
          (async () => {
            const pc = crearPeerConnectionRef.current(data.de);
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
          })();
          return;
        }

        if (data.tipo === "llamada_respuesta") {
          (async () => {
            const pc = pcRef.current;
            if (pc) {
              await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
              setLlamada((prev) => ({ ...prev, estado: "conectada" }));
            }
          })();
          return;
        }

        if (data.tipo === "llamada_ice") {
          pcRef.current?.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
          return;
        }

        if (data.tipo === "llamada_rechazada" || data.tipo === "llamada_colgada") {
          limpiarLlamadaRef.current();
          return;
        }
      };
      wsChatRef.current = ws;

      return () => {
        ws.close();
        wsChatRef.current = null;
      };
    }, [usuario?.id, cargarResumenChats]);

    // Desbloquea el AudioContext con el primer clic/tecla del usuario en la
    // página (login, cambiar de tab, lo que sea) — así, cuando llegue la
    // primera notificación real, el navegador ya permite reproducir sonido.
    useEffect(() => {
      const desbloquear = () => {
        obtenerAudioCtx()?.resume().catch(() => {});
      };
      document.addEventListener("click", desbloquear, { once: true });
      document.addEventListener("keydown", desbloquear, { once: true });
      return () => {
        document.removeEventListener("click", desbloquear);
        document.removeEventListener("keydown", desbloquear);
      };
    }, []);

  const [tab, setTab] = useState<TabId>("monitor");
    const tabRef = useRef<TabId>(tab);
    useEffect(() => {
      tabRef.current = tab;
    }, [tab]);
    // true cuando ChatPanel tiene una conversación individual abierta en
    // mobile — se usa para ocultar la hamburguesa del sidebar y quitar
    // el espacio reservado arriba (pt-16), dejando el chat a pantalla
    // completa, con solo el botón "atrás" propio del chat.
    const [chatConversacionAbierta, setChatConversacionAbierta] = useState(false);
    // Id del usuario con quien tengo la conversación abierta AHORA MISMO
    // (null si estoy en la lista o en otro tab). Se usa para decidir si
    // el toast flotante debe aparecer: solo se suprime si el mensaje
    // viene justo de la persona con la que ya estoy chateando — un
    // mensaje de alguien MÁS sí debe mostrar el toast, aunque esté
    // parado en el tab "Chat".
    const [conversacionActivaId, setConversacionActivaId] = useState<number | null>(null);
    const conversacionActivaIdRef = useRef<number | null>(null);
    useEffect(() => {
      conversacionActivaIdRef.current = conversacionActivaId;
    }, [conversacionActivaId]);
    const [menuAbierto, setMenuAbierto] = useState(false);
    const [sesion, setSesion] = useState<SesionEstado>({ perucompras: {}, perucompras_activo: null, erp: false });
    const [usuariosPeru, setUsuariosPeru] = useState<UsuarioPeru[]>([]);
    const [uidViendo, setUidViendo] = useState<string>("");
    const [wsConectado, setWsConectado] = useState(false);
    const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [notificaciones, setNotificaciones] = useState<Alerta[]>([]);
    // Publicada que se debe resaltar y hacia la que hay que hacer scroll.
    // Se guarda como {id, tick} en vez de solo el id: si el usuario
    // clickea DOS VECES la MISMA notificación (leída o no, visible o no),
    // el tick SIEMPRE cambia (Date.now()), así el efecto de la card se
    // vuelve a disparar sin importar que el id sea igual al anterior —
    // con solo el id, React no volvía a correr el efecto porque el valor
    // no había cambiado, y por eso a veces "no hacía nada".
    const [publicadaResaltada, setPublicadaResaltada] = useState<{ id: number; tick: number } | null>(null);
    const limpiarPublicadaResaltada = useCallback(() => setPublicadaResaltada(null), []);
    // Trae el historial real desde MySQL (tabla notificaciones_helbot en
    // el backend) en vez de depender de localStorage — así sobrevive a un
    // F5 y es el mismo historial para cualquiera que entre a Helbot.
    const cargarNotificaciones = useCallback(async () => {
      try {
        const r = await fetchConToken(`${API_BASE}/notificaciones`);
        if (!r.ok) return;
        const data: Alerta[] = await r.json();
      const limpias = data.filter(
        (n) => n.tipo !== "nueva_publicada" || Boolean(n.C_OrdenCompra && n.C_Entidad)
      );
        setNotificaciones(limpias);
      } catch {
        /* noop */
      }
    }, []);

    // Empuja una alerta flotante y la auto-oculta a los 2s. Auto-ocultarse
    // NO significa "leída" — eso solo pasa si el usuario le da clic (ver
    // abrirDesdeNotificacion más abajo).
    const agregarAlertaFlotante = useCallback((noti: Alerta) => {
      setAlertas((prev) => [noti, ...prev].slice(0, 8));
      setTimeout(() => {
        setAlertas((prev) => prev.filter((x) => x.id !== noti.id));
      }, 2000);
    }, []);

    const [panelNotisAbierto, setPanelNotisAbierto] = useState(false);
    const [publicadas, setPublicadas] = useState<Publicada[]>([]);
    const [cargandoLogin, setCargandoLogin] = useState<"perucompras" | "erp" | null>(null);

    // Ventas ERP — vive acá (no dentro de TabVentasErp) para que tanto el
    // tab "Ventas ERP (todas)" como el panel dividido del tab "Monitor"
    // (y su comparador) usen EXACTAMENTE los mismos datos, sin duplicar el
    // fetch. Se actualiza por polling manual (botón Refrescar) y también
    // solo, en vivo, cuando llega 'ventas_erp_actualizadas' por WebSocket.
    const [ventasErp, setVentasErp] = useState<VentaErp[]>([]);
    const [cargandoVentasErp, setCargandoVentasErp] = useState(true);
    const [errorVentasErp, setErrorVentasErp] = useState("");
    const [sinSesionErp, setSinSesionErp] = useState(false);
    const [metaVentasErp, setMetaVentasErp] = useState<{ paginas: number; actualizado: string } | null>(null);

    const [seguimientosProductos, setSeguimientosProductos] = useState<SeguimientoProductoResumen[]>([]);


  const seguimientosPorOrden = useMemo(() => {
      const mapa: Record<number, Record<string, string>> = {};
      for (const s of seguimientosProductos) {
        const oc = Number(s.orden_compra_id);
        if (!mapa[oc]) mapa[oc] = {};
        mapa[oc][String(s.producto_codigo).trim()] = s.estado;
      }
      return mapa;
  }, [seguimientosProductos]);

    // Igual que seguimientosPorOrden, pero con el objeto completo (quién
    // rellenó, quién confirmó) — para mostrar "Rellenado por: X" en las
    // cards sin tener que abrir el drawer.
  const detallesPorOrden = useMemo(() => {
      const mapa: Record<number, Record<string, SeguimientoProductoResumen>> = {};
      for (const s of seguimientosProductos) {
        const oc = Number(s.orden_compra_id);
        if (!mapa[oc]) mapa[oc] = {};
        mapa[oc][String(s.producto_codigo).trim()] = s;
      }
      return mapa;
  }, [seguimientosProductos]);


  const wsRef = useRef<WebSocket | null>(null);
    const cacheEntregas = useRef<Map<number, EntregaDetalle | null>>(new Map());
    const cacheUbigeoOcr = useRef<Map<number, { departamento: string; provincia: string; distrito: string } | null>>(new Map());
    const [ventaOpsAbierta, setVentaOpsAbierta] = useState<VentaErp | null>(null);

    // Modal único de CrearOrdenModal para toda la página, en 3 modos:
    //  - "ocr": card de Perú Compras sin venta en el ERP (flujo OCR)
    //  - "existente": card de una venta YA creada en el ERP (ver/editar)
    //  - "blank": botón "Crear orden" (formulario vacío)
    const [ordenModal, setOrdenModal] = useState
      <  | { modo: "ocr"; publicada: Publicada }
        | { modo: "existente"; venta: VentaErp; nOrdenCompra?: number }
        | { modo: "blank" }
        | null
      >(null);

    const abrirRegistrarOrden = useCallback((p: Publicada) => {
      setOrdenModal({ modo: "ocr", publicada: p });
    }, []);

  const abrirVerOrdenExistente = useCallback((v: VentaErp, nOrdenCompra?: number) => {
      setOrdenModal({ modo: "existente", venta: v, nOrdenCompra });
    }, []);

    const abrirNuevaOrdenEnBlanco = useCallback(() => {
      setOrdenModal({ modo: "blank" });
    }, []);

    const cerrarOrdenModal = useCallback(() => setOrdenModal(null), []);


    const [tickAuditoria, setTickAuditoria] = useState(0);


      // Evento específico (no un contador ciego) para que OpsDrawer sepa
    // CUÁNDO de verdad cambiaron datos de un producto (rellenado/
    // confirmado/subido) y para QUÉ orden de compra — así una subida de
    // imagen (que no cambia proveedor/precio/etc.) nunca dispara un
    // refetch que pise el formulario que el usuario está llenando.
    const [ultimoEventoOps, setUltimoEventoOps] = useState<{
      tipo: string;
      orden_compra_id?: number;
    } | null>(null);

    // Rol real del usuario logueado (viene de /auth/me, JWT de auth.py).
  // Rol real del usuario logueado (viene de /auth/me, JWT de auth.py).
    const usuarioActual = usuario?.nombre_completo || usuario?.username || "";
    const usuarioActualRef = useRef(usuarioActual);
    usuarioActualRef.current = usuarioActual;
    const rol = usuario?.rol || "";
    const esSeguimiento = rol === "seguimiento";
    const esCobranzas = rol === "cobranzas";
    const esVentas = rol === "ventas";
    const esAdmin = rol === "admin";
    const esGerencia = rol === "gerencia" || rol === "admin";
    const esPracticante = rol === "practicante";
  // Logística y Ventas solo trabajan con el ERP, nunca con Peru Compras.
    const puedeUsarPeruCompras = esSeguimiento || esAdmin;

    // Ventas (ej. victor@gmail.com) solo ve órdenes de los catálogos listados
    // en su columna catalogos_permitidos (tabla usuarios_helbot), comparando
    // contra el catalogoEmpresaId que ya viene en cada venta del ERP.
  const ventasErpVisibles = useMemo(() => {
      if (esVentas) {
        const permitidos = usuario?.catalogos_permitidos || [];
        if (permitidos.length === 0) return ventasErp; // sin restricción = ve todo, igual que admin
        return ventasErp.filter((v) =>
          permitidos.includes(
            (v as unknown as { catalogoEmpresaId?: number }).catalogoEmpresaId ?? -1
          )
        );
      }
      return ventasErp;
    }, [ventasErp, esVentas, usuario]);

    // Al hacer clic en una notificación de "op_rellenada", busca la venta
    // correspondiente (orden_compra_id === venta.id) y abre su drawer
    // directamente, para que seguimiento (o cualquiera) vea qué se llenó.
  // Al hacer clic en una notificación de "op_rellenada", busca la venta
    // correspondiente (orden_compra_id === venta.id) y abre su drawer en el
    // MISMO modo que usa el botón "Iniciar OP" (_modoCrear: true), que es
    // la vista con la lista de productos + formulario. Además le pasamos
    // el código del producto que se llenó para que se abra expandido.
  const abrirDesdeNotificacion = useCallback(
      (n: Alerta) => {
        setPanelNotisAbierto(false);

        // Marca SOLO esta notificación como leída (ni las otras 4, ni
        // ninguna más) — tanto si vino del panel como si vino de la
        // flotante, ambas usan esta misma función.
        setNotificaciones((prev) =>
          prev.map((x) => (x.id === n.id ? { ...x, leida: true } : x))
        );
        fetchConToken(`${API_BASE}/notificaciones/marcar-leidas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [n.id] }),
        }).catch(() => {});

        // "Nueva publicada" NO tiene orden_compra_id (eso es de una venta
        // del ERP) — trae N_OrdenCompra, el id real de Perú Compras. Acá
        // no se abre ningún drawer: se cambia al tab Monitor y se resalta
        // la card correspondiente entre las Publicadas.
      // "Nueva publicada" NO tiene orden_compra_id (eso es de una venta
        // del ERP) — trae N_OrdenCompra, el id real de Perú Compras. Acá
        // no se abre ningún drawer: se cambia al tab Monitor y se resalta
        // la card correspondiente entre las Publicadas.
        if (n.tipo === "nueva_publicada") {
          let nOrdenCompra = Number(n.N_OrdenCompra);
          // Las notificaciones que vienen del historial (MySQL, vía
          // /notificaciones) a veces no traen N_OrdenCompra guardado como
          // tal — de respaldo, se busca la publicada por su código de OC
          // (C_OrdenCompra), que sí viaja siempre.
          if (!nOrdenCompra && n.C_OrdenCompra) {
            const match = publicadas.find((p) => p.C_OrdenCompra === n.C_OrdenCompra);
            if (match) nOrdenCompra = match.N_OrdenCompra;
          }
          if (nOrdenCompra) {
            setTab("monitor");
            // tick=Date.now() SIEMPRE es distinto, incluso si es la misma
            // publicada que la última vez — así el resaltado/scroll se
            // vuelve a disparar aunque la notificación ya esté leída o la
            // card ya esté visible en pantalla.
            setPublicadaResaltada({ id: nOrdenCompra, tick: Date.now() });
          } else {
            // El WebSocket empujó esta "nueva_publicada" con el dict de
            // orden incompleto (sin C_OrdenCompra/N_OrdenCompra) — bug de
            // origen en monitor_publicadas.py. En vez de quedarse en
            // silencio como si el clic no hiciera nada, se avisa.
            agregarAlertaFlotante({
              id: Date.now() + Math.random(),
              tipo: "info_sin_datos",
              leida: true,
              creado_en: new Date().toISOString(),
              titulo: "No se pudo abrir esta publicada",
              mensaje: "Llegó sin datos suficientes para ubicarla (bug de origen).",
            } as Alerta);
          }
          return;
        }

      const ordenId = Number(n.orden_compra_id);
        if (!ordenId) return;
        const venta = ventasErp.find((v) => Number(v.id) === ordenId);
        if (venta) {
          setTab("ventas_erp");
          setVentaOpsAbierta({
            ...venta,
            _modoCrear: true,
            _productoAbrir:
              n.tipo === "op_rellenada_bloque"
                ? undefined
                : n.producto_codigo
                ? String(n.producto_codigo)
                : undefined,
            _grupoAbrir:
              n.tipo === "op_rellenada_bloque" && n.grupo_envio_id
                ? String(n.grupo_envio_id)
                : undefined,
          } as any);
        }
      },
      [ventasErp]
    );

    const noLeidas = notificaciones.filter((n) => !n.leida).length;

    // Suma de no leídos de TODAS las conversaciones — se usa para el
    // badge del tab "Chat" en el sidebar. Se recalcula solo cuando
    // resumenChats cambia (llega un mensaje nuevo por WS o se abre una
    // conversación y se resetea su contador puntual).
    const noLeidasChat = useMemo(
      () => Object.values(resumenChats).reduce((acc, r) => acc + (r.no_leidos || 0), 0),
      [resumenChats]
    );

    const abrirPanelNotis = () => {
      setPanelNotisAbierto((v) => !v);
    };
    const cargarEstadoSesion = useCallback(async () => {
      try {
        const r = await fetchConToken(`${API_BASE}/sesion/estado`);
        setSesion(await r.json());
      } catch {
        /* backend caído aún */
      }
    }, []);

  const cargarUsuariosPeru = useCallback(async () => {
      if (!puedeUsarPeruCompras) return;
      try {
        const r = await fetch(`${API_BASE}/sesion/perucompras/usuarios`);
        const data: UsuarioPeru[] = await r.json();
        setUsuariosPeru(data);
        setUidViendo((prev) => prev || data[0]?.uid || "");
      } catch {
        /* noop */
      }
    }, [puedeUsarPeruCompras]);


  // Vuelve a pedir los usuarios de Perú Compras apenas /auth/me responde
    // y el rol resulta ser "seguimiento" — el useEffect de conexión WS solo
    // llama a cargarUsuariosPeru() UNA vez al montar, cuando `usuario` aún
    // es null, así que sin este efecto el selector se queda vacío para
    // siempre aunque el rol sea el correcto.
    useEffect(() => {
      if (puedeUsarPeruCompras) {
        cargarUsuariosPeru();
      }
    }, [puedeUsarPeruCompras, cargarUsuariosPeru]);
    const esperarPeruComprasActivo = async (uid: string, timeoutMs = 90000, intervaloMs = 2500) => {
      const inicio = Date.now();
      while (Date.now() - inicio < timeoutMs) {
        const r = await fetch(`${API_BASE}/sesion/estado`);
        const estado: SesionEstado = await r.json();
        setSesion(estado);

        const estadoUid = estado.perucompras[uid]?.estado;

        if (estado.perucompras[uid]?.autenticado) return true;

        // El backend ya dejó de intentar (login falló, timeout del
        // watchdog, credenciales incorrectas, etc.) — no tiene sentido
        // seguir esperando los 90s completos si ya sabemos que terminó
        // sin éxito. Cortamos de inmediato para apagar el spinner.
        if (estadoUid && estadoUid !== "cargando") return false;

        await new Promise((res) => setTimeout(res, intervaloMs));
      }
      return false;
    };

    const esperarErpActivo = async (timeoutMs = 90000, intervaloMs = 2500) => {
      const inicio = Date.now();
      while (Date.now() - inicio < timeoutMs) {
        const r = await fetch(`${API_BASE}/sesion/estado`);
        const estado: SesionEstado = await r.json();
        setSesion(estado);
        if (estado.erp) return true;
        await new Promise((res) => setTimeout(res, intervaloMs));
      }
      return false;
    };

  const loginPeruCompras = async (uid: string) => {
      setCargandoLogin("perucompras");
      try {
        await fetch(`${API_BASE}/sesion/perucompras/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uid }),
        });
        setUidViendo(uid);
        const exito = await esperarPeruComprasActivo(uid);
        if (exito) {
          await cargarPublicadas();
        }
      } finally {
        setCargandoLogin(null);
      }
    };


  const loginErp = async () => {
      setCargandoLogin("erp");
      try {
        await fetch(`${API_BASE}/sesion/erp/login`, { method: "POST" });
        const exito = await esperarErpActivo();
        if (exito) {
          await cargarVentasErp(true);
        }
      } finally {
        setCargandoLogin(null);
      }
    };

  const cargarPublicadas = useCallback(async () => {
      if (!puedeUsarPeruCompras || !uidViendo) return;
      try {
        const r = await fetch(`${API_BASE}/publicadas?uid=${uidViendo}`);
        setPublicadas(await r.json());
      } catch {
        /* noop */
      }
    }, [puedeUsarPeruCompras, uidViendo]);


    // Cada vez que cambia el usuario que se está viendo (uidViendo) —
    // ya sea porque el selector cambió o porque loginPeruCompras lo
    // acaba de setear tras un login exitoso — se vuelve a pedir el
    // snapshot de publicadas de ESE usuario. Sin esto había que darle
    // "Refrescar" a mano cada vez.
    useEffect(() => {
      cargarPublicadas();
    }, [uidViendo, cargarPublicadas]);

    const cargarVentasErp = useCallback(async (forzar = false) => {
      setCargandoVentasErp(true);
      setErrorVentasErp("");
      setSinSesionErp(false);
      try {
        const r = await fetchConToken(`${API_BASE}/erp/ventas${forzar ? "?forzar=true" : ""}`);
        if (r.status === 401) {
          setSinSesionErp(true);
          setVentasErp([]);
          return;
        }
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.detail || `Error HTTP ${r.status}`);
        }
        const data = await r.json();
        setVentasErp(data.ventas || []);
        setMetaVentasErp({ paginas: data.paginas, actualizado: data.actualizado });
      } catch (e) {
        setErrorVentasErp(e instanceof Error ? e.message : "Error desconocido");
      } finally {
        setCargandoVentasErp(false);
      }
    }, []);



    const cargarSeguimientosProductos = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/erp/ventas/seguimientos-productos`);
      if (!r.ok) return;
      setSeguimientosProductos(await r.json());
    } catch {
      /* noop */
    }
  }, []);


    const [generandoOpVentaId, setGenerandoOpVentaId] = useState<string | number | null>(null);
    const [errorGenerarOp, setErrorGenerarOp] = useState("");

  const iniciarOps = useCallback(async (venta: VentaErp) => {
    if (!venta.id) return;

    setGenerandoOpVentaId(venta.id);
    setErrorGenerarOp("");

    try {

      // 1. Crear la OP en ERP
      let r = await fetch(
        `${API_BASE}/erp/ordenes/${venta.id}/iniciar`,
        {
          method: "POST",
        }
      );

      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || `Error HTTP ${r.status}`);
      }



      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.detail || `Error HTTP ${r.status}`);
      }

    

      setVentaOpsAbierta({
        ...venta,
        _modoCrear: true,
      } as any);

    } catch (e) {

      setErrorGenerarOp(
        e instanceof Error ? e.message : "Error desconocido"
      );

    } finally {

      setGenerandoOpVentaId(null);

    }

  }, [cargarVentasErp]);

  // Refs a las últimas versiones de estas funciones, para que el WebSocket
  // las use sin que el efecto de abajo tenga que reiniciarse (y así nunca
  // abra un segundo socket mientras el primero sigue vivo).
  const cargarEstadoSesionRef = useRef(cargarEstadoSesion);
  const cargarUsuariosPeruRef = useRef(cargarUsuariosPeru);
  const cargarPublicadasRef = useRef(cargarPublicadas);
  const cargarVentasErpRef = useRef(cargarVentasErp);
  const cargarSeguimientosProductosRef = useRef(cargarSeguimientosProductos);
  const cargarNotificacionesRef = useRef(cargarNotificaciones);

  useEffect(() => {
    cargarEstadoSesionRef.current = cargarEstadoSesion;
    cargarUsuariosPeruRef.current = cargarUsuariosPeru;
    cargarPublicadasRef.current = cargarPublicadas;
    cargarVentasErpRef.current = cargarVentasErp;
    cargarSeguimientosProductosRef.current = cargarSeguimientosProductos;
    cargarNotificacionesRef.current = cargarNotificaciones;
  }, [cargarEstadoSesion, cargarUsuariosPeru, cargarPublicadas, cargarVentasErp, cargarSeguimientosProductos, cargarNotificaciones]);

  useEffect(() => {
    let cancelado = false;
    let reconectarTimeout: ReturnType<typeof setTimeout> | null = null;

    cargarEstadoSesionRef.current();
    cargarUsuariosPeruRef.current();
    cargarPublicadasRef.current();
    cargarVentasErpRef.current();
    cargarSeguimientosProductosRef.current();
    cargarNotificacionesRef.current();
    const interval = setInterval(() => cargarEstadoSesionRef.current(), 15000);

    function conectar() {
      if (cancelado) return;
      const ws = new WebSocket(WS_URL);
      ws.onopen = () => setWsConectado(true);
      ws.onclose = () => {
        setWsConectado(false);
        if (!cancelado) {
          reconectarTimeout = setTimeout(conectar, 4000);
        }
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (ev: MessageEvent) => {
        const msg = JSON.parse(ev.data);
        if (msg.tipo === "nueva_publicada") {
          // No basta con N_OrdenCompra (id numérico interno de Perú Compras) —
          // la tarjeta se pinta con C_OrdenCompra (código OCAM-...) y C_Entidad.
          // Si cualquiera de los dos falta, el fallback termina mostrando n.id
          // (un número sin sentido tipo "120"), así que exigimos AMBOS.
          const tieneDatosUtiles = Boolean(msg.data?.C_OrdenCompra && msg.data?.C_Entidad);
          if (!tieneDatosUtiles) {
            // El backend mandó esta "nueva_publicada" sin N_OrdenCompra/C_OrdenCompra.
            // No sirve para navegar a ningún lado, así que NO la alertamos (ni sonido
            // ni toast) para no ensuciarte la campanita. Se deja este log para que
            // puedas confirmar en consola qué está mandando el backend incompleto.
            console.warn("nueva_publicada sin datos suficientes, ignorada:", msg.data);
            cargarPublicadasRef.current();
            return;
          }
          const noti: Alerta = { id: Date.now() + Math.random(), tipo: "nueva_publicada", leida: false, creado_en: new Date().toISOString(), ...msg.data };
          agregarAlertaFlotante(noti);
          setNotificaciones((prev) => [noti, ...prev].slice(0, 50));
          reproducirSonidoNotificacion();
          cargarPublicadasRef.current();
        }


        if (msg.tipo === "perucompras_sesion_perdida") {
          const noti: Alerta = {
            id: Date.now() + Math.random(),
            tipo: "perucompras_sesion_perdida",
            leida: false,
            creado_en: new Date().toISOString(),
            ...msg.data,
          };
          agregarAlertaFlotante(noti);
          setNotificaciones((prev) => [noti, ...prev].slice(0, 50));
          reproducirSonidoNotificacion();
          // La sesión murió de verdad — refresca el badge/selector YA,
          // sin esperar a que el polling de 15s lo note por su cuenta.
          cargarEstadoSesionRef.current();
        }

        if (msg.tipo === "perucompras_sesion_recuperada") {
          const noti: Alerta = {
            id: Date.now() + Math.random(),
            tipo: "perucompras_sesion_recuperada",
            leida: false,
            creado_en: new Date().toISOString(),
            ...msg.data,
          };
          agregarAlertaFlotante(noti);
          setNotificaciones((prev) => [noti, ...prev].slice(0, 50));
          cargarEstadoSesionRef.current();
        }

        if (msg.tipo === "perucompras_sesion_fallida") {
          // El backend intentó reconectar automáticamente (keep-alive)
          // y se rindió — la sesión pasó de "perdida" a "desconectado".
          // Sin este bloque, el sidebar se quedaba mostrando el spinner
          // anaranjado ("reconectando") para siempre, porque nadie le
          // avisaba que el backend ya dejó de intentar. Se refresca YA
          // el estado (sesion.perucompras, que alimenta directamente al
          // Sidebar vía la prop estadosPeru) para que el badge pase a
          // gris/"Entrar", igual que ya hace Operaciones al caer a la
          // pantalla de login.
          const noti: Alerta = {
            id: Date.now() + Math.random(),
            tipo: "perucompras_sesion_fallida",
            leida: false,
            creado_en: new Date().toISOString(),
            ...msg.data,
          };
          agregarAlertaFlotante(noti);
          setNotificaciones((prev) => [noti, ...prev].slice(0, 50));
          reproducirSonidoNotificacion();
          cargarEstadoSesionRef.current();
        }

        if (msg.tipo === "perucompras_login_ok") {
          // El backend (main.py -> _hacer_callback_login_ok) emite este
          // evento apenas termina el login de Perú Compras, pero antes
          // NADIE lo escuchaba en el frontend — por eso el badge/sidebar
          // solo se ponía verde para la persona que hizo login (porque su
          // propio loginPeruCompras() estaba pollentando /sesion/estado
          // manualmente), y para el resto de usuarios conectados recién
          // se enteraban hasta el siguiente ciclo de 15s. Con esto, TODOS
          // los que tengan Helbot abierto ven el cambio a verde al instante.
          cargarEstadoSesionRef.current();
        }

        if (msg.tipo === "perucompras_logout") {
          // Alguien cerró sesión manualmente (desde el sidebar O desde
          // "Equipo Ventas · Operaciones") — se refresca YA, sin esperar
          // el poll de 15s, para que el badge se ponga plomo al instante
          // en todas las pantallas abiertas.
          cargarEstadoSesionRef.current();
        }

        if (msg.tipo === "precio_completado") {
          const esMiPropiaAccion = msg.data?.completado_por === usuarioActualRef.current;
          if (!esMiPropiaAccion) {
            const noti: Alerta = { id: Date.now() + Math.random(), tipo: "precio", leida: false, creado_en: new Date().toISOString(), ...msg.data };
            agregarAlertaFlotante(noti);
            setNotificaciones((prev) => [noti, ...prev].slice(0, 50));
            reproducirSonidoNotificacion();
          }
        }
      if (msg.tipo === "op_rellenada") {
          const esMiPropiaAccion = msg.data?.rellenado_por === usuarioActualRef.current;
          if (!esMiPropiaAccion) {
            const noti: Alerta = {
              id: Date.now() + Math.random(),
              tipo: "op_rellenada",
              leida: false,
              creado_en: new Date().toISOString(),
              ...msg.data,
            };
            agregarAlertaFlotante(noti);
            setNotificaciones((prev) => [noti, ...prev].slice(0, 50));
            reproducirSonidoNotificacion();
          }
          cargarSeguimientosProductosRef.current();
          setTickAuditoria((t) => t + 1);
          setUltimoEventoOps({ tipo: "op_rellenada", orden_compra_id: Number(msg.data?.orden_compra_id) });
        }


        if (msg.tipo === "op_rellenada_bloque") {
          const esMiPropiaAccion = msg.data?.rellenado_por === usuarioActualRef.current;
          if (!esMiPropiaAccion) {
            const noti: Alerta = {
              id: Date.now() + Math.random(),
              tipo: "op_rellenada_bloque",
              leida: false,
              creado_en: new Date().toISOString(),
              ...msg.data,
            };
            agregarAlertaFlotante(noti);
            setNotificaciones((prev) => [noti, ...prev].slice(0, 50));
            reproducirSonidoNotificacion();
          }
          cargarSeguimientosProductosRef.current();
          setTickAuditoria((t) => t + 1);
          setUltimoEventoOps({ tipo: "op_rellenada_bloque", orden_compra_id: Number(msg.data?.orden_compra_id) });
        }

        if (msg.tipo === "op_subida_erp") {
          const esMiPropiaAccion = msg.data?.subido_por === usuarioActualRef.current;
          if (!esMiPropiaAccion) {
            const noti: Alerta = {
              id: Date.now() + Math.random(),
              tipo: "op_subida_erp",
              leida: false,
              creado_en: new Date().toISOString(),
              ...msg.data,
            };
            agregarAlertaFlotante(noti);
            setNotificaciones((prev) => [noti, ...prev].slice(0, 50));
            reproducirSonidoNotificacion();
          }
          cargarSeguimientosProductosRef.current();
          setTickAuditoria((t) => t + 1);
          setUltimoEventoOps({ tipo: "op_subida_erp", orden_compra_id: Number(msg.data?.orden_compra_id) });
        }
        if (msg.tipo === "op_confirmada") {
          const esMiPropiaAccion = msg.data?.confirmado_por === usuarioActualRef.current;
          if (!esMiPropiaAccion) {
            const noti: Alerta = {
              id: Date.now() + Math.random(),
              tipo: "op_confirmada",
              leida: false,
              creado_en: new Date().toISOString(),
              ...msg.data,
            };
            agregarAlertaFlotante(noti);
            setNotificaciones((prev) => [noti, ...prev].slice(0, 50));
            reproducirSonidoNotificacion();
          }
          cargarSeguimientosProductosRef.current();
          setTickAuditoria((t) => t + 1);
          setUltimoEventoOps({ tipo: "op_confirmada", orden_compra_id: Number(msg.data?.orden_compra_id) });
        }


      if (msg.tipo === "op_actualizada_erp") {
          const esMiPropiaAccion = msg.data?.actualizado_por === usuarioActualRef.current;
          if (!esMiPropiaAccion) {
            const noti: Alerta = {
              id: Date.now() + Math.random(),
              tipo: "op_actualizada_erp",
              leida: false,
              creado_en: new Date().toISOString(),
              ...msg.data,
            };
            agregarAlertaFlotante(noti);
            setNotificaciones((prev) => [noti, ...prev].slice(0, 50));
            reproducirSonidoNotificacion();
          }
          cargarSeguimientosProductosRef.current();
          setTickAuditoria((t) => t + 1);
          setUltimoEventoOps({ tipo: "op_actualizada_erp", orden_compra_id: Number(msg.data?.orden_compra_id) });
        }

        if (msg.tipo === "mef_completado") {
          const esMiPropiaAccion = msg.data?.completado_por === usuarioActualRef.current;
          if (!esMiPropiaAccion) {
            const noti: Alerta = {
              id: Date.now() + Math.random(),
              tipo: "mef_completado",
              leida: false,
              creado_en: new Date().toISOString(),
              ...msg.data,
            };
            agregarAlertaFlotante(noti);
            setNotificaciones((prev) => [noti, ...prev].slice(0, 50));
            reproducirSonidoNotificacion();
          }
        }



        if (msg.tipo === "producto_imagenes_actualizadas") {
          // No es una notificación para campanita/alerta flotante — solo
          // debe hacer que el drawer abierto (OpsDrawer, que recibe
          // tickAuditoria como `tick`) refresque las imágenes/PDF del
          // producto que el otro usuario tocó, sin recargar la página.
          setTickAuditoria((t) => t + 1);
        }
        if (msg.tipo === "ventas_erp_actualizadas") {
          setVentasErp(msg.data.ventas || []);
          setMetaVentasErp({ paginas: msg.data.paginas, actualizado: msg.data.actualizado });
          setSinSesionErp(false);
          setErrorVentasErp("");
        }
      };
      wsRef.current = ws;
    }
    conectar();

    return () => {
      cancelado = true;
      clearInterval(interval);
      if (reconectarTimeout) clearTimeout(reconectarTimeout);
      wsRef.current?.close();
    };
  }, []); // <- se conecta UNA sola vez, no se reinicia cuando cambian las funciones

  const todosLosTabs: SidebarTab[] = [
      { id: "monitor", label: "Monitor de publicadas", labelCorta: "Monitor", icon: Radar },
      { id: "ficha", label: "Ficha OCR + MEF", labelCorta: "Ficha OCR", icon: FileScan },
      { id: "ventas", label: "Ventas · precios", labelCorta: "Ventas", icon: DollarSign },
      { id: "ventas_erp", label: "Ventas ERP (todas)", labelCorta: "ERP Ventas", icon: DollarSign },
      { id: "auditoria", label: "Auditoría · seguimiento", labelCorta: "Auditoría", icon: BarChart3 },
      // "Equipo Ventas · Operaciones" y "Equipo Ventas · Big Data" YA NO
      // viven aquí — igual que "Cobranzas", ahora son un grupo fijo,
      // hardcodeado en Sidebar.tsx, visible para CUALQUIER rol sin
      // depender de este filtro.
      { id: "chat", label: "Chat", labelCorta: "Chat", icon: MessageCircle },
    ];

    // Seguimiento ve las 4 pestañas originales. Logística y Ventas solo ven
    // "Ventas ERP". Gerencia ve SOLO el reporte de auditoría (no necesita
    // operar nada, solo supervisar).
const tabs = esAdmin
    ? todosLosTabs
    : esGerencia
    ? todosLosTabs.filter((t) => t.id === "auditoria" || t.id === "chat")
    : esSeguimiento
    ? todosLosTabs
    : esPracticante
    ? todosLosTabs.filter((t) => t.id === "chat")
    : esVentas
    ? todosLosTabs.filter((t) => t.id === "ventas_erp" || t.id === "chat" || t.id === "ficha")
    : esCobranzas
    ? todosLosTabs.filter((t) => t.id === "ventas_erp" || t.id === "chat" || t.id === "ficha")
    : todosLosTabs.filter((t) => t.id === "ventas_erp" || t.id === "chat");
    // Si el rol solo tiene una pestaña disponible, forzamos esa pestaña
    // (evita que se quede en "monitor" por el estado inicial de useState).
    const esTabCobranzas = tab === "cobranzas-doc-pago" || tab === "cobranzas-carta-nota";
    const esTabEquipoVentas = tab === "equipo-ventas-operaciones" || tab === "equipo-ventas-bigdata";

  useEffect(() => {
      if (!usuario) return;

      // Las pestañas de Cobranzas y Equipo Ventas nunca se fuerzan
      // Cobranzas solo puede permanecer en sus módulos
      if (esCobranzas && esTabCobranzas) return;

    // Practicante puede quedarse en "Operaciones" o en "Chat", nunca en "Big Data" ni el resto
      if (esPracticante) {
        if (tab === "equipo-ventas-operaciones" || tab === "chat") return;
      } else if (!esCobranzas && esTabEquipoVentas) {
        // Los demás usuarios (menos Cobranzas) pueden permanecer en Equipo Ventas
        return;
      }

          // Admin puede permanecer también en Cobranzas
      if (esAdmin && esTabCobranzas) return;

      if (esAdmin) {
        // Admin puede navegar libremente entre todos los módulos, no se fuerza ningún tab
      } else if (esGerencia) {
        if (tab !== "auditoria" && tab !== "chat") {
          setTab("auditoria");
        }
      } else if (esSeguimiento) {
        // Seguimiento puede quedarse donde está
      } else if (esCobranzas) {
        // Cobranzas puede usar:
        // ventas_erp
        // chat
        // ficha (Ficha OCR + MEF)
        // cobranzas-doc-pago
        // cobranzas-carta-nota
        if (
          tab !== "ventas_erp" &&
          tab !== "chat" &&
          tab !== "ficha" &&
          !esTabCobranzas
        ) {
          setTab("ventas_erp");
        }
        } else if (esPracticante) {
            if (tab !== "equipo-ventas-operaciones" && tab !== "chat") {
              setTab("equipo-ventas-operaciones");
            }
          } else if (esVentas) {
            if (tab !== "ventas_erp" && tab !== "chat" && tab !== "ficha") {
              setTab("ventas_erp");
            }
          } else {
            if (tab !== "ventas_erp" && tab !== "chat") {
              setTab("ventas_erp");
            }
          }
    }, [
      usuario,
      esSeguimiento,
      esGerencia,
      esAdmin,
      esCobranzas,
      esPracticante,
      tab,
      esTabCobranzas,
      esTabEquipoVentas,
    ]);


    if (verificandoSesion) {
      return null; // o un spinner simple si prefieres mostrar algo mientras verifica
    }

    return (
      <div
        className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable} min-h-screen w-full bg-[#F6F7FA] text-slate-800`}
        style={{ fontFamily: "var(--font-body)" }}
      >
        <HelbotGlobalStyles />

  {/* ================= SIDEBAR ================= */}
        <div className="flex">
          <Sidebar
            tabs={tabs}
            tabActivo={tab}
            onCambiarTab={(id) => {
              console.log("Cambiando a tab:", id);
              setTab(id as TabId);
            }}
            nombreUsuario={usuarioActual}
            rol={rol}
            fotoPerfil={usuario?.foto_perfil ?? null}
            apiBase={API_BASE}
            onAbrirPerfil={() => setPerfilAbierto(true)}
            onCerrarSesion={cerrarSesion}
            noLeidas={noLeidas}
            onTogglePanelNotis={abrirPanelNotis}
            panelNotificaciones={
              panelNotisAbierto && (
                <div className="absolute left-full top-0 ml-2 w-[420px] max-w-[85vw] bg-white border border-slate-200 rounded-xl shadow-lg shadow-slate-900/10 z-50 hb-slide-in max-h-[28rem] overflow-y-auto text-slate-800">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white">
                    <span className="text-sm font-semibold text-slate-800">Notificaciones</span>
                    <button onClick={() => setPanelNotisAbierto(false)} className="text-slate-400 hover:text-slate-700">
                      <X size={14} />
                    </button>
                  </div>
                  {notificaciones.length === 0 ? (
                    <p className="text-xs text-slate-400 px-4 py-6 text-center">Sin notificaciones todavía</p>
                  ) : (
                    notificaciones.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => abrirDesdeNotificacion(n)}
                        className={`flex items-start gap-2.5 px-4 py-2.5 border-b border-slate-50 last:border-0 cursor-pointer transition-colors ${
                          n.leida ? "bg-white hover:bg-slate-50" : "bg-indigo-50/40 hover:bg-indigo-50"
                        }`}
                      >
                        <span
                          className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${
                            n.leida ? "bg-transparent" : "bg-[#4F46E5]"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className={`text-xs truncate ${n.leida ? "font-medium text-slate-500" : "font-semibold text-slate-800"}`}>
                              {n.tipo === "precio"
                                ? "Precio completado"
                                : n.tipo === "op_rellenada_bloque"
                                ? `${String(n.rellenado_por || "Alguien")} envió ${n.cantidad ?? ""} productos en bloque`
                                : n.tipo === "op_rellenada"
                                ? `${String(n.rellenado_por || "Alguien")} llenó un formulario`
                                : n.tipo === "op_confirmada"
                                ? `${String(n.confirmado_por || "Seguimiento")} confirmó un producto`
                                : n.tipo === "op_subida_erp"
                                ? `${String(n.subido_por || "Alguien")} subió datos al ERP`
                                : n.tipo === "op_actualizada_erp"
                                ? `${String(n.actualizado_por || "Seguimiento")} actualizó datos en el ERP`
                                : n.tipo === "mef_completado"
                                ? `${String(n.completado_por || "Seguimiento")} completó los resultados del MEF en el ERP`
                                : n.tipo === "perucompras_sesion_fallida"
                                ? `No se pudo reconectar Perú Compras (${String(n.usuario || "")})`
                                : n.tipo === "nueva_publicada"
                                ? `Nueva publicada · ${String(n.C_OrdenCompra || "")}`
                                : "Nueva publicada"}
                            </p>
                            {n.creado_en != null && (
                              <span
                                style={{ fontFamily: "var(--font-mono)" }}
                                className={`text-[10px] font-semibold shrink-0 px-1.5 py-0.5 rounded ${
                                  n.leida ? "text-slate-400 bg-slate-50" : "text-[#4F46E5] bg-indigo-50"
                                }`}
                              >
                                {formatearFechaHora(String(n.creado_en))}
                              </span>
                            )}
                          </div>
                          <p style={{ fontFamily: "var(--font-mono)" }} className={`text-[11px] truncate ${n.leida ? "text-slate-400" : "text-slate-500"}`}>
                            {n.tipo === "op_rellenada" || n.tipo === "op_confirmada" || n.tipo === "op_actualizada_erp"
                              ? `Producto ${String(n.producto_codigo || n.numero_ocam || n.orden_compra_id || "")}`
                              : n.tipo === "mef_completado"
                              ? `Expediente ${String(n.expediente || "—")} / U.E. ${String(n.unidad_ejecutora || "—")}`
                              : String(n.C_Entidad || n.producto || n.C_OrdenCompra || n.id)}
                          </p>
                          {(n.tipo === "op_rellenada" || n.tipo === "op_confirmada" || n.tipo === "op_actualizada_erp") && n.producto_descripcion != null && (
                            <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">{String(n.producto_descripcion)}</p>
                          )}
                          {n.tipo === "op_rellenada" && Array.isArray(n.campos_faltantes) && n.campos_faltantes.length > 0 && (
                            <p className="text-[10px] text-amber-600 mt-0.5">Faltan: {(n.campos_faltantes as string[]).join(", ")}</p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )
            }
            puedeUsarPeruCompras={puedeUsarPeruCompras}
            usuariosPeru={usuariosPeru}
            estadosPeru={sesion.perucompras}
            uidViendo={uidViendo}
            onCambiarUid={setUidViendo}
            onLoginPeru={loginPeruCompras}
            cargandoPeru={cargandoLogin === "perucompras"}
            sesionErp={sesion.erp}
            cargandoErp={cargandoLogin === "erp"}
            onLoginErp={loginErp}
            wsConectado={wsConectado}
            onCrearOrden={abrirNuevaOrdenEnBlanco}
            noLeidasChat={noLeidasChat}
            ocultarHamburguesaMovil={tab === "chat" && chatConversacionAbierta}
          />

          <div className="flex-1 min-w-0">

        {/* ================= ALERTAS FLOTANTES ================= */}
        <div className="fixed top-20 right-3 left-3 sm:left-auto sm:right-6 z-40 flex flex-col gap-2 sm:w-80">
          {alertas.slice(0, 3).map((a) => (
            <div
              key={a.id}
              onClick={() => (a.tipo === "chat_mensaje" ? setTab("chat") : abrirDesdeNotificacion(a))}
              className="hb-slide-in bg-white border border-slate-200 rounded-xl p-3 shadow-lg shadow-slate-900/5 cursor-pointer hover:border-indigo-300 transition-colors"
            >
              <div className="flex items-start gap-2.5">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 overflow-hidden ${
                  a.tipo === "chat_mensaje" ? "" : "bg-indigo-50"
                }`}>
                  {a.tipo === "chat_mensaje" ? (
                    <AvatarToastChat
                      nombre={String(a.emisor_nombre || "")}
                      foto={(a.emisor_foto as string | null) ?? null}
                    />
                  ) : (
                    <Bell size={13} className="text-[#4F46E5] hb-pulse" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-800">
                      {a.tipo === "chat_mensaje"
                      ? String(a.emisor_nombre || "Nuevo mensaje")
                      : a.tipo === "perucompras_sesion_perdida"
                      ? `⚠️ Sesión de Perú Compras perdida (${String(a.usuario || "")})`
                      : a.tipo === "perucompras_sesion_recuperada"
                      ? `Sesión de Perú Compras recuperada (${String(a.usuario || "")})`
                      : a.tipo === "perucompras_sesion_fallida"
                      ? `⚠️ No se pudo reconectar Perú Compras (${String(a.usuario || "")})`
                      : a.tipo === "precio"
                      ? "Precio completado por ventas"
                      : a.tipo === "op_rellenada"
                      ? `${String(a.rellenado_por || "Alguien")} llenó un formulario`
                      : a.tipo === "op_confirmada"
                      ? `${String(a.confirmado_por || "Seguimiento")} confirmó un producto`
                      : a.tipo === "op_subida_erp"
                      ? `${String(a.subido_por || "Alguien")} subió datos al ERP`
                      : a.tipo === "op_actualizada_erp"
                      ? `${String(a.actualizado_por || "Seguimiento")} actualizó datos en el ERP`
                      : a.tipo === "mef_completado"
                      ? `${String(a.completado_por || "Seguimiento")} completó el MEF en el ERP`
                      : a.tipo === "nueva_publicada"
                      ? `Nueva publicada · ${String(a.C_OrdenCompra || "")}`
                      : "Nueva publicada detectada"}
                  </p>
                  <p style={{ fontFamily: "var(--font-mono)" }} className="text-[11px] text-slate-500 truncate">
                    {a.tipo === "chat_mensaje"
                      ? String(a.contenido || "")
                      : a.tipo === "perucompras_sesion_perdida" || a.tipo === "perucompras_sesion_recuperada" || a.tipo === "perucompras_sesion_fallida"
                      ? String(a.mensaje || "")
                      : a.tipo === "op_rellenada" || a.tipo === "op_confirmada" || a.tipo === "op_actualizada_erp"
                      ? `Producto ${String(a.producto_codigo || a.numero_ocam || a.orden_compra_id || "")}`
                      : a.tipo === "mef_completado"
                      ? `Expediente ${String(a.expediente || "—")} / U.E. ${String(a.unidad_ejecutora || "—")}`
                      : a.tipo === "nueva_publicada"
                      ? String(a.C_Entidad || a.titulo || a.producto || a.id)
                      : String(a.titulo || a.producto || a.id)}
                  </p>
                  {(a.tipo === "op_rellenada" || a.tipo === "op_confirmada" || a.tipo === "op_actualizada_erp") && a.producto_descripcion != null && (
                    <p className="text-[11px] text-slate-600 mt-0.5 leading-snug line-clamp-2">
                      {String(a.producto_descripcion)}
                    </p>
                  )}
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setAlertas((p) => p.filter((x) => x.id !== a.id));
                  }}
                  className="text-slate-400 hover:text-slate-700 transition-colors"
                  aria-label="Descartar alerta"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* ================= CONTENIDO ================= */}
        <main
          className={
            tab === "chat"
              ? chatConversacionAbierta
                ? "h-screen" // conversación abierta en mobile: sin espacio reservado, la hamburguesa ya está oculta
                : "h-screen pt-16 md:pt-0"
              : "max-w-[1920px] mx-auto px-4 sm:px-8 py-6 sm:py-8 pt-16 md:pt-6"
          }
        >
        {tab === "monitor" && (
          <TabMonitor
            publicadas={publicadas}
            onRefrescar={cargarPublicadas}
            cacheEntregas={cacheEntregas.current}
            cacheUbigeoOcr={cacheUbigeoOcr.current}
            etiquetaUsuario={usuariosPeru.find((u) => u.uid === uidViendo)?.label || ""}
            uidViendo={uidViendo}
            ventasErp={ventasErpVisibles}
            cargandoVentasErp={cargandoVentasErp}
            sinSesionErp={sinSesionErp}
            onRefrescarVentasErp={cargarVentasErp}
            onAbrirTabVentasErp={() => setTab("ventas_erp")}
            onAbrirOps={setVentaOpsAbierta}
            onIniciarOps={iniciarOps}
            onRegistrarOrden={abrirRegistrarOrden}
            onVerOrdenExistente={abrirVerOrdenExistente}
            seguimientosPorOrden={seguimientosPorOrden}
            detallesPorOrden={detallesPorOrden}
            resaltarPublicada={publicadaResaltada}
            onResaltadoAplicado={limpiarPublicadaResaltada}
          />
        )}
          {tab === "ficha" && <TabFichaOcr publicadas={publicadas} />}
          {tab === "ventas" && <TabVentas />}
          {tab === "ventas_erp" && (
            <TabVentasErp
              ventas={ventasErpVisibles}
              meta={metaVentasErp}
              cargando={cargandoVentasErp}
              error={errorVentasErp}
              sinSesion={sinSesionErp}
              onRefrescar={cargarVentasErp}
              onAbrirOps={setVentaOpsAbierta}
              onIniciarOps={iniciarOps}
              onVerOrdenExistente={abrirVerOrdenExistente}
              seguimientosPorOrden={seguimientosPorOrden}
              detallesPorOrden={detallesPorOrden}
              usuarioActual={usuarioActual}
            />
          )}
          {tab === "auditoria" && <TabAuditoria tick={tickAuditoria} />}

            {/* 👇 AGREGAR ESTO */}
            {tab === "chat" && (
            <ChatPanel
              apiBase={API_BASE}
              miId={usuario?.id ?? null}
              onlineIds={usuariosOnlineIds}
              onSincronizarOnline={(ids) => setUsuariosOnlineIds(new Set(ids))}
              resumenChats={resumenChats}
              mensajeEntrante={mensajeEntrante}
              escribiendoEvento={escribiendoEvento}
              vistoEvento={vistoEvento}
              onEnviarEscribiendo={enviarEscribiendo}
              onConversacionAbierta={marcarConversacionLeidaLocal}
              onLlamar={iniciarLlamada}
              onUsuariosCargados={manejarUsuariosChatCargados}
              onVistaMovilCambia={setChatConversacionAbierta}
              onConversacionActivaCambia={setConversacionActivaId}
              onMensajeEnviado={actualizarResumenPorMensajePropio}
            />
          )}


          {tab === "cobranzas-doc-pago" && (
                <DocParaPago apiBase={API_BASE} />
            )}

            {tab === "cobranzas-carta-nota" && (
                <CartaNotaDebito apiBase={API_BASE} />
            )}

            {tab === "equipo-ventas-operaciones" && (
                <EquipoVentasOperaciones apiBase={API_BASE} />
            )}

            {tab === "equipo-ventas-bigdata" && (
                <EquipoVentasBigData />
            )}
        </main>

      <OpsDrawer
          venta={ventaOpsAbierta}
          onClose={() => setVentaOpsAbierta(null)}
          usuarioActual={usuarioActual}
          esSeguimiento={esSeguimiento}
          tick={tickAuditoria}
          ultimoEventoOps={ultimoEventoOps}
        />

      {ordenModal && (
          <div className="fixed inset-0 z-[400] overflow-y-auto">
              <CrearOrdenModal
                publicada={ordenModal.modo === "ocr" ? ordenModal.publicada : undefined}
                ventaExistente={
                  ordenModal.modo === "existente"
                    ? (ordenModal.venta as unknown as Venta)
                    : undefined
                }
                nOrdenCompra={ordenModal.modo === "existente" ? ordenModal.nOrdenCompra : undefined}
                onClose={cerrarOrdenModal}
                onGuardado={(venta) => {
                  // Actualiza el listado local al instante con los datos
                  // recién guardados (evita que, al reabrir la card antes
                  // de que termine el refetch, el modal crea de nuevo que
                  // falta el OCF y muestre el banner sin necesidad).
                  setVentasErp((prev) =>
                    prev.map((v) =>
                      v.id === venta.id
                        ? ({ ...v, ...(venta as unknown as VentaErp) })
                        : v
                    )
                  );
                  cargarVentasErp(true);
                }}
                esSeguimiento={esSeguimiento}
                esAdmin={esAdmin}
              />
          </div>
        )}
        {perfilAbierto && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-950/50" onClick={() => setPerfilAbierto(false)} />
            <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 style={{ fontFamily: "var(--font-display)" }} className="text-base font-semibold text-slate-900">
                  Foto de perfil
                </h3>
                <button onClick={() => setPerfilAbierto(false)} className="text-slate-400 hover:text-slate-700">
                  <X size={16} />
                </button>
              </div>

              <div className="flex flex-col items-center gap-4">
                <div className="w-24 h-24 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center overflow-hidden">
                  {usuario?.foto_perfil ? (
                    <img
                      src={`${API_BASE}/archivos/${usuario.foto_perfil}`}
                      alt="Foto de perfil"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span style={{ fontFamily: "var(--font-display)" }} className="text-2xl font-semibold text-[#4F46E5]">
                      {usuarioActual
                        .split(" ")
                        .filter(Boolean)
                        .slice(0, 2)
                        .map((w) => w[0]?.toUpperCase())
                        .join("") || "?"}
                    </span>
                  )}
                </div>

                <label className="flex items-center justify-center gap-2 w-full border-2 border-dashed border-slate-300 rounded-lg py-3 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
                  {subiendoFoto ? <Loader2 size={15} className="animate-spin text-slate-400" /> : <Upload size={15} className="text-slate-400" />}
                  <span className="text-xs text-slate-500">{subiendoFoto ? "Subiendo..." : "Subir nueva foto"}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={subiendoFoto}
                    onChange={(e) => {
                      const archivo = e.target.files?.[0];
                      if (archivo) subirFotoPerfil(archivo);
                      e.target.value = "";
                    }}
                  />
                </label>

                {usuario?.foto_perfil && (
                  <button
                    onClick={eliminarFotoPerfil}
                    disabled={subiendoFoto}
                    className="text-xs text-red-600 hover:text-red-700 disabled:opacity-50"
                  >
                    Quitar foto actual
                  </button>
                )}

                {errorFoto && (
                  <p className="text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle size={12} /> {errorFoto}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
        </div>

        <LlamadaOverlay
          llamada={llamada}
          micActivo={micActivo}
          camaraActiva={camaraActiva}
          onAceptar={aceptarLlamada}
          onRechazar={rechazarLlamada}
          onColgar={colgarLlamada}
          onToggleMic={toggleMic}
          onToggleCamara={toggleCamara}
          videoLocalRef={videoLocalRef}
          videoRemotoRef={videoRemotoRef}
        />
      </div>
    );
  }
  // ============================================================
  interface SesionBadgeProps {
    label: string;
    activo: boolean;
    cargando: boolean;
    onClick: () => void;
    ancho?: boolean;
  }

  function SesionBadge({ label, activo, cargando, onClick, ancho }: SesionBadgeProps) {
    if (activo) {
      return (
        <div
          className={`flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full text-xs font-medium bg-emerald-50 border border-emerald-200 text-emerald-700 ${
            ancho ? "w-full justify-center" : ""
          }`}
        >
          <CheckCircle2 size={13} />
          {label} conectado
        </div>
      );
    }
    return (
      <button
        onClick={onClick}
        disabled={cargando}
        className={`flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full text-xs font-medium bg-[#10172A] text-white hover:bg-[#1B2438] transition-colors disabled:opacity-50 ${
          ancho ? "w-full justify-center" : ""
        }`}
      >
        {cargando ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
        Iniciar sesión · {label}
      </button>
    );
  }



  interface PeruComprasSelectorProps {
    usuarios: UsuarioPeru[];
    estados: Record<string, UsuarioEstado>;
    uidViendo: string;
    onCambiarUid: (uid: string) => void;
    onLogin: (uid: string) => void;
    cargando: boolean;
    ancho?: boolean;
  }

  function PeruComprasSelector({ usuarios, estados, uidViendo, onCambiarUid, onLogin, cargando, ancho }: PeruComprasSelectorProps) {
    const estadoActual = estados[uidViendo];
    const activo = estadoActual?.autenticado ?? false;

    return (
      <div className={`flex items-center gap-1.5 ${ancho ? "w-full" : ""}`}>
        <select
          value={uidViendo}
          onChange={(e) => onCambiarUid(e.target.value)}
          style={{ fontFamily: "var(--font-mono)" }}
          className={`text-xs border border-slate-200 rounded-full pl-2.5 pr-1.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 ${ancho ? "flex-1" : ""}`}
        >
          {usuarios.map((u) => (
            <option key={u.uid} value={u.uid}>
              {estados[u.uid]?.autenticado ? "● " : "○ "}
              {u.label}
            </option>
          ))}
        </select>
        {!activo && (
          <button
            onClick={() => onLogin(uidViendo)}
            disabled={cargando || !uidViendo}
            className="flex items-center gap-1.5 pl-2.5 pr-3 py-1.5 rounded-full text-xs font-medium bg-[#10172A] text-white hover:bg-[#1B2438] transition-colors disabled:opacity-50"
          >
            {cargando ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
            Iniciar sesión
          </button>
        )}
        {activo && (
          <span className="flex items-center gap-1 text-xs text-emerald-700">
            <CheckCircle2 size={13} /> conectado
          </span>
        )}
      </div>
    );
  }


  // ============================================================
  // TAB 1 — Monitor de Publicadas
  // ============================================================
  // Normaliza códigos de orden para comparar Publicadas (Peru Compras) vs
  // Ventas ERP sin que espacios/mayúsculas rompan el match — ej. "OCGRU944"
  // debe calzar sin importar cómo venga formateado en cada sistema.
  const normalizarCodigo = (s?: string) => (s || "").trim().toUpperCase();

  function TabMonitor({
    publicadas,
    onRefrescar,
    cacheEntregas,
    cacheUbigeoOcr,
    etiquetaUsuario,
    uidViendo,
    ventasErp,
    cargandoVentasErp,
    sinSesionErp,
    onRefrescarVentasErp,
    onAbrirTabVentasErp,
    onAbrirOps,
    onIniciarOps,
    onRegistrarOrden,
    onVerOrdenExistente,
    seguimientosPorOrden,
    detallesPorOrden,
    resaltarPublicada,
    onResaltadoAplicado,
  }: {
    publicadas: Publicada[];
    onRefrescar: () => void;
    cacheEntregas: Map<number, EntregaDetalle | null>;
    cacheUbigeoOcr: Map<number, { departamento: string; provincia: string; distrito: string } | null>;
    etiquetaUsuario: string;
    uidViendo: string;
    ventasErp: VentaErp[];
    cargandoVentasErp: boolean;
    sinSesionErp: boolean;
  onRefrescarVentasErp: (forzar?: boolean) => void;
    onAbrirTabVentasErp: () => void;
    onAbrirOps: (v: VentaErp) => void;
    onIniciarOps: (v: VentaErp) => void;
    onRegistrarOrden: (p: Publicada) => void;
    onVerOrdenExistente: (v: VentaErp, nOrdenCompra?: number) => void;
    seguimientosPorOrden: Record<number, Record<string, string>>;
    detallesPorOrden?: Record<number, Record<string, SeguimientoProductoResumen>>;
    /** Publicada a la que hay que hacer scroll + resaltar (id + tick único). */
    resaltarPublicada?: { id: number; tick: number } | null;
    /** Se llama cuando la card ya hizo su scroll+parpadeo, para limpiar el estado. */
    onResaltadoAplicado?: () => void;
  }) {

    const [filtroAcuerdo, setFiltroAcuerdo] = useState("");
    const [filtroCatalogo, setFiltroCatalogo] = useState("");
    const [filtroTexto, setFiltroTexto] = useState("");
    const [filtroErpTexto, setFiltroErpTexto] = useState("");
    const [comparadorAbierto, setComparadorAbierto] = useState(true);

    const acuerdosDisponibles = useMemo(() => {
      const mapa = new Map<number, string>();
      for (const p of publicadas) {
        if (p._n_acuerdo) {
          const codigo = p._acuerdo_codigo || `AM ${p._n_acuerdo}`;
          const nombre = p._acuerdo_nombre || "";
          // Combina código + nombre — antes solo mostraba el código
          // porque el "||" nunca llegaba a usar el nombre.
          mapa.set(p._n_acuerdo, nombre ? `${codigo} — ${nombre}` : codigo);
        }
      }
      return Array.from(mapa.entries())
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.id - b.id);
    }, [publicadas]);

    const catalogosDisponibles = useMemo(() => {
      const mapa = new Map<number, string>();
      for (const p of publicadas) {
        if (!p._n_catalogo) continue;
        if (filtroAcuerdo && String(p._n_acuerdo) !== filtroAcuerdo) continue;
        mapa.set(p._n_catalogo, p._catalogo_nombre || `Catálogo ${p._n_catalogo}`);
      }
      return Array.from(mapa.entries())
        .map(([id, label]) => ({ id, label }))
        .sort((a, b) => a.id - b.id);
    }, [publicadas, filtroAcuerdo]);

    const filtradas = publicadas.filter((p) => {
      const okAcuerdo = !filtroAcuerdo || String(p._n_acuerdo) === filtroAcuerdo;
      const okCatalogo = !filtroCatalogo || String(p._n_catalogo) === filtroCatalogo;
      const okTexto =
        !filtroTexto ||
        p.C_Entidad?.toLowerCase().includes(filtroTexto.toLowerCase()) ||
        p.C_OrdenCompra?.toLowerCase().includes(filtroTexto.toLowerCase());
      return okAcuerdo && okCatalogo && okTexto;
    });

    const erpFiltradas = useMemo(
      () =>
        ventasErp.filter(
          (v) => !filtroErpTexto || JSON.stringify(v).toLowerCase().includes(filtroErpTexto.toLowerCase())
        ),
      [ventasErp, filtroErpTexto]
    );
    const ERP_LIMITE_PANEL = 30; // el panel es un vistazo rápido — el tab "Ventas ERP" tiene la lista completa paginada
    const erpParaMostrar = erpFiltradas.slice(0, ERP_LIMITE_PANEL);

    // ---- Comparador: qué código está de un lado y no del otro ----
  // ---- Comparador: qué código está de un lado y no del otro ----
    // Se compara SIEMPRE por numeroOcam (ocamDe), porque es el único campo
    // del ERP que usa el mismo formato "OCAM-2026-..." que C_OrdenCompra de
    // Peru Compras. Ventas sin numeroOcam (ocamDe(v) === "") se excluyen de
    // la comparación — no hay forma de saber a qué publicada corresponden.
    const codigosErp = useMemo(
      () => new Set(ventasErp.map((v) => normalizarCodigo(ocamDe(v))).filter(Boolean)),
      [ventasErp]
    );


    // Mapa código OCAM normalizado -> venta completa del ERP. Se usa para
    // que, al hacer clic en una card de "Publicadas" que SÍ tiene su venta
    // ya registrada (sin el badge "Sin ERP"), se pueda abrir esa venta
    // directo en el modal, sin tener que ir a buscarla a mano en el tab
    // "Ventas ERP".
    const ventaErpPorCodigo = useMemo(() => {
      const mapa = new Map<string, VentaErp>();
      for (const v of ventasErp) {
        const codigo = normalizarCodigo(ocamDe(v));
        if (codigo) mapa.set(codigo, v);
      }
      return mapa;
    }, [ventasErp]);


    const codigosPublicadas = useMemo(
      () => new Set(publicadas.map((p) => normalizarCodigo(p.C_OrdenCompra))),
      [publicadas]
    );
    const publicadasSinErp = useMemo(
      () => publicadas.filter((p) => !codigosErp.has(normalizarCodigo(p.C_OrdenCompra))),
      [publicadas, codigosErp]
    );
    const erpSinPublicada = useMemo(
      () =>
        ventasErp.filter((v) => {
          const ocam = normalizarCodigo(ocamDe(v));
          return ocam && !codigosPublicadas.has(ocam);
        }),
      [ventasErp, codigosPublicadas]
    );
    const codigosErpSinPublicada = useMemo(
      () => new Set(erpSinPublicada.map((v) => normalizarCodigo(ocamDe(v)))),
      [erpSinPublicada]
    );




    return (
      <div>
        {/* ================= COMPARADOR ================= */}
        <div className="mb-6 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <button
            onClick={() => setComparadorAbierto((x) => !x)}
            className="w-full flex items-center justify-between px-4 sm:px-5 py-3.5 hover:bg-slate-50/70 transition-colors"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center shrink-0">
                <GitCompareArrows size={15} className="text-[#4F46E5]" />
              </div>
              <div className="text-left">
                <p style={{ fontFamily: "var(--font-display)" }} className="text-sm font-semibold text-slate-900">
                  Comparador Publicadas ↔ Ventas ERP
                </p>
                <p className="text-xs text-slate-500">
                  {publicadasSinErp.length === 0
                    ? "Todo cuadra — cada publicada tiene su venta registrada en el ERP"
                    : `${publicadasSinErp.length} publicada(s) nueva(s) sin venta registrada en el ERP`}
                </p>
              </div>
            </div>
            {comparadorAbierto ? (
              <ChevronUp size={16} className="text-slate-400 shrink-0" />
            ) : (
              <ChevronDown size={16} className="text-slate-400 shrink-0" />
            )}
          </button>

          {comparadorAbierto && (
            <div className="border-t border-slate-100 px-4 sm:px-5 py-4">
              <ListaComparador
                titulo="Publicadas sin venta registrada en el ERP"
                detalle="Están en Peru Compras pero ningún código de venta del ERP calza con ellas — probablemente falta registrarlas."
                codigos={publicadasSinErp.map((p) => p.C_OrdenCompra)}
                tono="amber"
              />
            </div>
          )}
        </div>

        {/* ================= PANTALLA DIVIDIDA ================= */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* -------- IZQUIERDA: Publicadas (Peru Compras) -------- */}
          <section>
            <div className="flex items-start sm:items-end justify-between mb-4 flex-wrap gap-3">
              <div>
                <h2 style={{ fontFamily: "var(--font-display)" }} className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">
                  Publicadas detectadas
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {filtradas.length} de {publicadas.length}
                  {etiquetaUsuario && (
                    <span className="text-slate-400">
                      {" "}
                      · <span className="font-medium text-slate-600">{etiquetaUsuario}</span>
                    </span>
                  )}
                </p>
              </div>
              <button
                onClick={onRefrescar}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:border-slate-300 hover:text-slate-900 transition-colors"
              >
                <RefreshCw size={12} /> Refrescar
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
              <input
                placeholder="Buscar por entidad o código de OC"
                value={filtroTexto}
                onChange={(e) => setFiltroTexto(e.target.value)}
                className="sm:col-span-2 bg-white border border-slate-200 rounded-lg px-3.5 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
              />
            <select
                value={filtroAcuerdo}
                onChange={(e) => {
                  setFiltroAcuerdo(e.target.value);
                  setFiltroCatalogo("");
                }}
                style={{ fontFamily: "var(--font-mono)" }}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Todos los acuerdos marco</option>
                {acuerdosDisponibles.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <select
                value={filtroCatalogo}
                onChange={(e) => setFiltroCatalogo(e.target.value)}
                style={{ fontFamily: "var(--font-mono)" }}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="">Todos los catálogos</option>
                {catalogosDisponibles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            {filtradas.length === 0 ? (
              <EmptyState
                icon={Radar}
                titulo="Sin publicadas por ahora"
                detalle="En cuanto Helbot detecte una publicación nueva en estado Publicada, aparecerá aquí y recibirás una alerta en vivo."
                compacto
              />
            ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 max-h-[720px] overflow-y-auto pr-1">
                {filtradas.map((p) => (
                  <CardPublicada
                    key={p.N_OrdenCompra}
                    p={p}
                    cache={cacheEntregas}
                    cacheUbigeo={cacheUbigeoOcr}
                    uidViendo={uidViendo}
                    sinCoincidenciaErp={!codigosErp.has(normalizarCodigo(p.C_OrdenCompra))}
                    onRegistrarOrden={onRegistrarOrden}
                    ventaErpCoincidente={ventaErpPorCodigo.get(normalizarCodigo(p.C_OrdenCompra))}
                    onVerOrdenExistente={onVerOrdenExistente}
                    resaltarTick={p.N_OrdenCompra === resaltarPublicada?.id ? resaltarPublicada?.tick : undefined}
                    onResaltadoAplicado={onResaltadoAplicado}
                  />
                ))}
              </div>
            )}
          </section>

          {/* -------- DERECHA: Ventas ERP -------- */}
          <section>
            <div className="flex items-start sm:items-end justify-between mb-4 flex-wrap gap-3">
              <div>
                <h2 style={{ fontFamily: "var(--font-display)" }} className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">
                  Ventas ERP
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  {erpFiltradas.length > ERP_LIMITE_PANEL
                    ? `Mostrando ${ERP_LIMITE_PANEL} de ${erpFiltradas.length}`
                    : `${erpFiltradas.length} de ${ventasErp.length}`}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={onAbrirTabVentasErp}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-[#4F46E5] hover:bg-indigo-50 transition-colors"
                >
                  Ver todas <ChevronRight size={12} />
                </button>
                <button
                  onClick={() => onRefrescarVentasErp(true)}
                  disabled={cargandoVentasErp}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs font-medium text-slate-700 hover:border-slate-300 hover:text-slate-900 transition-colors disabled:opacity-50"
                >
                  {cargandoVentasErp ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Refrescar
                </button>
              </div>
            </div>

            {sinSesionErp && (
              <div className="mb-4 flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3.5 py-2.5">
                <AlertTriangle size={13} />
                No hay sesión activa en el ERP. Inicia sesión con el botón &quot;ERP&quot; de arriba.
              </div>
            )}

            <div className="relative mb-4">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                placeholder="Buscar en ventas ERP (código, cliente...)"
                value={filtroErpTexto}
                onChange={(e) => setFiltroErpTexto(e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
              />
            </div>

            {cargandoVentasErp && ventasErp.length === 0 ? (
              <SkeletonGrid />
            ) : erpParaMostrar.length === 0 && !sinSesionErp ? (
              <EmptyState
                icon={DollarSign}
                titulo="Sin ventas ERP"
                detalle="No se encontraron ventas con la búsqueda actual, o aún no se cargó nada del ERP."
                compacto
              />
            ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 max-h-[720px] overflow-y-auto pr-1">
                {erpParaMostrar.map((v, i) => (
                  <CardVentaErp
                    key={String(v.id ?? ocamDe(v) ?? i)}
                    v={v}
                    sinCoincidenciaPublicada={codigosErpSinPublicada.has(normalizarCodigo(ocamDe(v)))}
                    onAbrirOps={onAbrirOps}
                    onIniciarOps={onIniciarOps}
                    onVerOrdenExistente={onVerOrdenExistente}
                    seguimientosPorOrden={seguimientosPorOrden}
                    detallesPorOrden={detallesPorOrden}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    );
  }

  function ListaComparador({
    titulo,
    detalle,
    codigos,
    tono,
  }: {
    titulo: string;
    detalle: string;
    codigos: string[];
    tono: "amber" | "red";
  }) {
    const [expandido, setExpandido] = useState(false);
    const visibles = expandido ? codigos : codigos.slice(0, 8);
    const colores =
      tono === "amber"
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-red-50 text-red-700 border-red-200";

    return (
      <div>
        <p className="text-xs font-semibold text-slate-800">{titulo}</p>
        <p className="text-[11px] text-slate-500 mb-2">{detalle}</p>
        {codigos.length === 0 ? (
          <p className="text-xs text-emerald-700 flex items-center gap-1">
            <CheckCircle2 size={12} /> Ninguno — todo cuadra
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {visibles.map((c) => (
                <span
                  key={c}
                  style={{ fontFamily: "var(--font-mono)" }}
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${colores}`}
                >
                  {c}
                </span>
              ))}
            </div>
            {codigos.length > 8 && (
              <button
                onClick={() => setExpandido((x) => !x)}
                className="mt-2 text-[11px] text-slate-400 hover:text-slate-700 transition-colors"
              >
                {expandido ? "Ver menos" : `+${codigos.length - 8} más`}
              </button>
            )}
          </>
        )}
      </div>
    );
  }


  // Extrae provincia/departamento de un texto de dirección tipo
  // "AV. LA PERUANIDAD S/N - HUANCAYO - JUNIN" o con "/" como separador.
  // Si no encuentra un patrón reconocible, devuelve el texto completo tal
  // cual (mejor mostrar algo que dejar vacío).
  function extraerProvinciaDepartamento(direccion?: string | null): string {
    if (!direccion) return "";
    const separador = direccion.includes("/") ? "/" : direccion.includes(" - ") ? " - " : null;
    if (!separador) return direccion;
    const partes = direccion
      .split(separador)
      .map((p) => p.trim())
      .filter(Boolean);
    if (partes.length < 2) return direccion;
    // Toma los últimos 2 segmentos como [provincia, departamento]
    return partes.slice(-2).join(" / ");
  }


  interface UbigeoOcr {
    departamento: string;
    provincia: string;
    distrito: string;
  }

  function CardPublicada({
    p,
    cache,
    cacheUbigeo,
    uidViendo,
    sinCoincidenciaErp,
    onRegistrarOrden,
    ventaErpCoincidente,
    onVerOrdenExistente,
    resaltarTick,
    onResaltadoAplicado,
  }: {
    p: Publicada;
    cache: Map<number, EntregaDetalle | null>;
    cacheUbigeo: Map<number, UbigeoOcr | null>;
    uidViendo: string;
    sinCoincidenciaErp?: boolean;
    onRegistrarOrden: (p: Publicada) => void;
    /** La venta del ERP que calza con esta publicada (por numeroOcam), si existe. */
    ventaErpCoincidente?: VentaErp;
    /** Abre esa venta en el modal de "ver/editar orden existente". */
    onVerOrdenExistente?: (v: VentaErp, nOrdenCompra?: number) => void;
    /** Distinto cada vez que ESTA card debe volver a hacer scroll +
     * parpadear — incluso si es la misma card que la vez anterior. */
    resaltarTick?: number;
    /** Se llama apenas termina el parpadeo, para limpiar el estado arriba. */
    onResaltadoAplicado?: () => void;
  }) {
    const [cargandoEntrega, setCargandoEntrega] = useState(true);
    const [entrega, setEntrega] = useState<EntregaDetalle | null>(null);
    const [errorEntrega, setErrorEntrega] = useState("");

    const [pdfAbierto, setPdfAbierto] = useState<string | null>(null);
    const [cargandoPdf, setCargandoPdf] = useState(false);
    const [linkCopiado, setLinkCopiado] = useState(false);

    const [pdfFisicaAbierto, setPdfFisicaAbierto] = useState<string | null>(null);
    const [cargandoPdfFisica, setCargandoPdfFisica] = useState(false);
    const [linkFisicaCopiado, setLinkFisicaCopiado] = useState(false);

    const [registrarAbierto, setRegistrarAbierto] = useState(false);
    const [cargandoOcr, setCargandoOcr] = useState(false);
    const [datosOcr, setDatosOcr] = useState<any>(null);
    const [errorOcr, setErrorOcr] = useState("");


  const copiarLinkPdf = async () => {
      const token = localStorage.getItem("helbot_token") || "";
      const link = `${API_BASE}/publicadas/${p.N_OrdenCompra}/pdf?token=${encodeURIComponent(token)}`;

      // navigator.clipboard solo funciona en https o localhost — en HTTP
      // normal (como http://192.168.x.x) el navegador lo bloquea en
      // silencio, así que usamos el método viejo de textarea+execCommand
      // como respaldo, que sí funciona en cualquier contexto.
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(link);
        } else {
          throw new Error("Contexto no seguro, usar fallback");
        }
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = link;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
          document.execCommand("copy");
        } catch {
          /* si tampoco esto funciona, no hay más que hacer */
        }
        document.body.removeChild(textarea);
      }

      setLinkCopiado(true);
      setTimeout(() => setLinkCopiado(false), 2000);
    };

    const copiarLinkPdfFisica = async () => {
      const token = localStorage.getItem("helbot_token") || "";
      const link = `${API_BASE}/publicadas/${p.N_OrdenCompra}/pdf-fisica?token=${encodeURIComponent(token)}`;
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(link);
        } else {
          throw new Error("Contexto no seguro, usar fallback");
        }
      } catch {
        const textarea = document.createElement("textarea");
        textarea.value = link;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
          document.execCommand("copy");
        } catch {
          /* si tampoco esto funciona, no hay más que hacer */
        }
        document.body.removeChild(textarea);
      }
      setLinkFisicaCopiado(true);
      setTimeout(() => setLinkFisicaCopiado(false), 2000);
    };

    const [errorPdfFisica, setErrorPdfFisica] = useState("");

    const abrirPdfFisica = async (nOrdenCompra: number) => {
      setCargandoPdfFisica(true);
      setErrorPdfFisica("");

      const INTENTOS = 6;
      const ESPERA_MS = 4000; // Perú Compras puede tardar en subir el PDF físico a Azure recién publicada la orden

      for (let intento = 1; intento <= INTENTOS; intento++) {
        try {
          const r = await fetchConToken(`${API_BASE}/publicadas/${nOrdenCompra}/pdf-fisica`);
          if (r.ok) {
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            setPdfFisicaAbierto(url);
            setCargandoPdfFisica(false);
            return;
          }
          // 404 con pLista vacío suele ser transitorio — se reintenta
          if (r.status !== 404 || intento === INTENTOS) {
            throw new Error(
              r.status === 404
                ? "Perú Compras aún no tiene la orden física disponible para esta OC."
                : "No se pudo cargar el PDF"
            );
          }
        } catch (e) {
          if (intento === INTENTOS) {
            setErrorPdfFisica(e instanceof Error ? e.message : "Error desconocido");
            break;
          }
        }
        await new Promise((res) => setTimeout(res, ESPERA_MS));
      }
      setCargandoPdfFisica(false);
    };

    const cerrarPdfFisica = () => {
      if (pdfFisicaAbierto) URL.revokeObjectURL(pdfFisicaAbierto);
      setPdfFisicaAbierto(null);
    };

    const abrirRegistrarOrden = async () => {
      setRegistrarAbierto(true);
      setCargandoOcr(true);
      setErrorOcr("");
      setDatosOcr(null);
      try {
        // 1. Descarga el PDF OCAM que ya sirve el backend (mismo endpoint
        //    que usa el botón "Ver PDF OCAM"), como blob.
        const rPdf = await fetchConToken(`${API_BASE}/publicadas/${p.N_OrdenCompra}/pdf`);
        if (!rPdf.ok) throw new Error("No se pudo descargar el PDF de la orden");
        const blobPdf = await rPdf.blob();

        // 2. Arma el mismo FormData que espera /ficha/ocr, usando ese
        //    blob como si fuera un archivo subido a mano.
        const fd = new FormData();
        fd.append("archivo", blobPdf, `${p.C_OrdenCompra}.pdf`);
        fd.append("publicada_id", p.C_OrdenCompra);

        // 3. Manda directo al OCR, sin que el usuario tenga que
        //    descargar/subir nada.
        const rOcr = await fetchConToken(`${API_BASE}/ficha/ocr`, {
          method: "POST",
          body: fd,
        });
        if (!rOcr.ok) {
          const body = await rOcr.json().catch(() => ({}));
          throw new Error(body.detail || "No se pudo aplicar el OCR");
        }
        const data = await rOcr.json();
        setDatosOcr(data.datos);
      } catch (e) {
        setErrorOcr(e instanceof Error ? e.message : "Error desconocido");
      } finally {
        setCargandoOcr(false);
      }
    };

    const cerrarRegistrarOrden = () => {
      setRegistrarAbierto(false);
      setDatosOcr(null);
      setErrorOcr("");
    };

    const abrirPdf = async (nOrdenCompra: number) => {
      setCargandoPdf(true);
      try {
        const r = await fetchConToken(`${API_BASE}/publicadas/${nOrdenCompra}/pdf`);
        if (!r.ok) throw new Error("No se pudo cargar el PDF");
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        setPdfAbierto(url);
      } catch {
        // opcional: toast de error
      } finally {
        setCargandoPdf(false);
      }
    };

    const cerrarPdf = () => {
      if (pdfAbierto) URL.revokeObjectURL(pdfAbierto);
      setPdfAbierto(null);
    };

    const monto = p.N_Total?.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });



    // TEMPORAL — solo para ver qué trae C_RutaPdfOC, borrar después
    console.log("C_RutaPdfOC de", p.N_OrdenCompra, "=", p.C_RutaPdfOC);

  useEffect(() => {
      // Solo usamos la caché si YA teníamos datos reales guardados.
      // Si el resultado cacheado es null (sin datos de entrega), volvemos
      // a consultar siempre, porque la orden puede actualizarse con el
      // tiempo en Perú Compras (ej. recién publicada -> con lugar/fechas).
      if (cache.has(p.N_OrdenCompra) && cache.get(p.N_OrdenCompra) != null) {
        setEntrega(cache.get(p.N_OrdenCompra) ?? null);
        setCargandoEntrega(false);
        return;
      }
      let cancelado = false;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s máx

      const cargarEntrega = async () => {
        setCargandoEntrega(true);
        setErrorEntrega("");
        try {
          const r = await fetch(`${API_BASE}/publicadas/${p.N_OrdenCompra}/entregas?uid=${uidViendo}`, {
            signal: controller.signal,
          });
          if (!r.ok) {
            const body = await r.json().catch(() => ({}));
            throw new Error(body.detail || `Error HTTP ${r.status}`);
          }
          const data: EntregaDetalle[] = await r.json();
          const resultado = data[0] || null;
          cache.set(p.N_OrdenCompra, resultado);
          if (!cancelado) setEntrega(resultado);
        } catch (e) {
          if (cancelado) return;
          if (e instanceof DOMException && e.name === "AbortError") {
            setErrorEntrega("Timeout: el backend tardó más de 20s en responder");
          } else {
            setErrorEntrega(e instanceof Error ? e.message : "Error desconocido");
          }
        } finally {
          clearTimeout(timeoutId);
          if (!cancelado) setCargandoEntrega(false);
        }
      };
      cargarEntrega();
      return () => {
        cancelado = true;
        controller.abort();
        clearTimeout(timeoutId);
      };
  }, [p.N_OrdenCompra, cache, uidViendo]);

    // ---------------------------------------------------------------
    // Ubigeo (departamento/provincia/distrito) real, extraído por OCR
    // del PDF OCAM — más confiable que C_LugarEntrega (texto libre).
    //
    // LAZY-LOAD: NO se dispara al montar la card. Se espera a que la
    // card entre realmente en el viewport (IntersectionObserver) antes
    // de descargar el PDF + correr OCR. Así, con 20-30 cards en pantalla,
    // solo se procesan las que el usuario efectivamente está viendo, no
    // todas de golpe — evita saturar CPU/backend/sesión de Perú Compras.
    // ---------------------------------------------------------------
  const cardRef = useRef<HTMLDivElement>(null);
    const [esVisible, setEsVisible] = useState(false);
    const [ubigeoOcr, setUbigeoOcr] = useState<UbigeoOcr | null>(null);
    const [cargandoUbigeo, setCargandoUbigeo] = useState(false);

  // Cuando se hace clic en una notificación "nueva_publicada" (panel o
    // alerta flotante), esta card recibe un resaltarTick nuevo — hace
    // scroll hasta ella y queda parpadeando ~2.6s. El estado visual
    // (resaltarActivo) vive DENTRO de la card, no depende de que el
    // padre siga con el mismo valor — así funciona igual esté la card
    // visible o no, y aunque se clickee la misma notificación otra vez.
    const [resaltarActivo, setResaltarActivo] = useState(false);
    useEffect(() => {
      if (resaltarTick == null) return;
      setResaltarActivo(true);
      cardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      const t = setTimeout(() => {
        setResaltarActivo(false);
        onResaltadoAplicado?.();
      }, 2600);
      return () => clearTimeout(t);
      // resaltarTick cambia SIEMPRE con cada click (Date.now()), incluso
      // para la misma card — por eso el efecto se debe volver a disparar
      // solo cuando cambia, sin depender de onResaltadoAplicado.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resaltarTick]);

    useEffect(() => {
      // Si ya está en caché, ni siquiera necesitamos el observer.
      if (cacheUbigeo.has(p.N_OrdenCompra)) {
        setUbigeoOcr(cacheUbigeo.get(p.N_OrdenCompra) ?? null);
        return;
      }
      const el = cardRef.current;
      if (!el) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting) {
            setEsVisible(true);
            observer.disconnect(); // una sola vez, no seguir observando
          }
        },
        { rootMargin: "200px" } // empieza a cargar un poco antes de que se vea
      );
      observer.observe(el);
      return () => observer.disconnect();
    }, [p.N_OrdenCompra, cacheUbigeo]);

    useEffect(() => {
      if (!esVisible) return;
      if (cacheUbigeo.has(p.N_OrdenCompra)) return; // ya se resolvió arriba

      let cancelado = false;

      const cargarUbigeo = async () => {
        setCargandoUbigeo(true);
        try {
          const rPdf = await fetchConToken(`${API_BASE}/publicadas/${p.N_OrdenCompra}/pdf`);
          if (!rPdf.ok) throw new Error("No se pudo descargar el PDF");
          const blobPdf = await rPdf.blob();

          const fd = new FormData();
          fd.append("archivo", blobPdf, `${p.C_OrdenCompra}.pdf`);

          const rOcr = await fetchConToken(`${API_BASE}/ficha/ocr`, { method: "POST", body: fd });
          if (!rOcr.ok) throw new Error("OCR falló");
          const data = await rOcr.json();
          const otros = data?.datos?.otros || {};

          const resultado: UbigeoOcr | null =
            otros.departamento_entrega || otros.provincia_entrega || otros.distrito_entrega
              ? {
                  departamento: otros.departamento_entrega || "",
                  provincia: otros.provincia_entrega || "",
                  distrito: otros.distrito_entrega || "",
                }
              : null;

          cacheUbigeo.set(p.N_OrdenCompra, resultado);
          if (!cancelado) setUbigeoOcr(resultado);
        } catch {
          cacheUbigeo.set(p.N_OrdenCompra, null);
          if (!cancelado) setUbigeoOcr(null);
        } finally {
          if (!cancelado) setCargandoUbigeo(false);
        }
      };

      cargarUbigeo();
      return () => {
        cancelado = true;
      };
    }, [esVisible, p.N_OrdenCompra, p.C_OrdenCompra, cacheUbigeo]);

    const fmt = (n: number | null | undefined) =>
      n != null ? n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

  const puedeVerEnErp = !!ventaErpCoincidente && !!onVerOrdenExistente;

    // Si el usuario está seleccionando texto (arrastrando el mouse para
    // copiar), el mouseup dispara igual el onClick del div — sin este
    // chequeo, cualquier selección de texto terminaría abriendo el modal
    // en vez de dejarlo copiar tranquilo.
    const manejarClickCard = () => {
      const seleccion = window.getSelection();
      if (seleccion && seleccion.toString().length > 0) return;
      // p.N_OrdenCompra es el id REAL de Perú Compras — acá SÍ lo tenemos
      // disponible (venimos de la card de Publicadas), a diferencia de
      // dentro del modal donde solo se tenía el id de la venta del ERP.
      if (puedeVerEnErp) onVerOrdenExistente!(ventaErpCoincidente!, p.N_OrdenCompra);
    };

  return (
      <div
        ref={cardRef}
        onClick={manejarClickCard}
        title={puedeVerEnErp ? "Ver esta orden en el ERP" : undefined}
        className={`bg-white border border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-sm transition-all ${
          puedeVerEnErp ? "cursor-pointer" : ""
        } ${resaltarActivo ? "hb-pulse-glow" : ""}`}
      >
      <div className="flex items-start justify-between mb-1 gap-2">
          <span
            style={{ fontFamily: "var(--font-mono)" }}
            className="text-sm font-bold text-slate-900 tracking-tight"
          >
            {p.C_OrdenCompra}
          </span>
          {sinCoincidenciaErp && (
            <span
              title="No se encontró una venta con este código en el ERP"
              className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 shrink-0"
            >
              <AlertTriangle size={10} />
              Sin ERP
            </span>
          )}
        </div>
        <h3 className="text-sm font-semibold text-slate-800 leading-snug mb-2">{p.C_Entidad}</h3>
        <div className="flex flex-wrap gap-1.5 text-[11px] text-slate-500 mb-2">
          <span className="bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5">{p.C_Procedimiento}</span>
          <span className="bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5">{p.C_TipoContratacion}</span>
          {p._n_acuerdo && (
            <span
              title={p._acuerdo_nombre || ""}
              className="bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5"
            >
              {p._acuerdo_codigo || `AM ${p._n_acuerdo}`}
              {p._catalogo_nombre ? ` · ${p._catalogo_nombre}` : ` · Cat ${p._n_catalogo}`}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between pt-2 border-t border-slate-100">
          <span style={{ fontFamily: "var(--font-mono)" }} className="text-xs text-slate-400">
            {p.C_FechaEstado}
          </span>
        </div>

        
        
      <div className="mt-2 flex items-center justify-center gap-3">
        <button
            onClick={(e) => { e.stopPropagation(); abrirPdf(p.N_OrdenCompra); }}
            disabled={cargandoPdf}
            className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-[#4F46E5] hover:underline disabled:opacity-40"
          >
            {cargandoPdf ? "Cargando..." : "Ver PDF OCAM"}
          </button>
          <span className="text-slate-300">|</span>
          <button
            onClick={(e) => { e.stopPropagation(); copiarLinkPdf(); }}
            className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-[#4F46E5] hover:underline"
          >
            {linkCopiado ? "¡Copiado!" : "Copiar link"}
          </button>
        </div>
        <div className="mt-1.5 flex items-center justify-center gap-3">
        <button
            onClick={(e) => { e.stopPropagation(); abrirPdfFisica(p.N_OrdenCompra); }}
            disabled={cargandoPdfFisica}
            className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-[#4F46E5] hover:underline disabled:opacity-40"
          >
            {cargandoPdfFisica ? "Cargando..." : "Ver Orden Física"}
          </button>

          {errorPdfFisica && (
          <p className="text-[10px] text-amber-600 text-center mt-1">
            {errorPdfFisica}
          </p>
        )}
          <span className="text-slate-300">|</span>
          <button
            onClick={(e) => { e.stopPropagation(); copiarLinkPdfFisica(); }}
            className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-slate-500 hover:text-[#4F46E5] hover:underline"
          >
            {linkFisicaCopiado ? "¡Copiado!" : "Copiar link"}
          </button>
        </div>
        <div className="mt-2 flex justify-center">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full bg-indigo-600 text-white shadow-sm shadow-indigo-600/20">
            <Circle size={9} className="hb-pulse fill-white" />
            {p.C_EstadoOrden}
          </span>
        </div>
        {sinCoincidenciaErp ? (
          <button
            onClick={(e) => { e.stopPropagation(); onRegistrarOrden(p); }}
            className="mt-2 w-full flex items-center justify-center gap-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg py-2 hover:bg-emerald-700 transition-colors"
          >
            <FileScan size={13} />
            Registrar Orden
          </button>
        ) : (
          <div className="mt-2 w-full flex items-center justify-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold rounded-lg py-2">
            <CheckCircle2 size={13} />
            Ya registrada en el ERP
          </div>
        )}
  

        <div className="mt-3 pt-3 border-t border-dashed border-slate-200 text-[11px] space-y-1.5">
          {cargandoEntrega && (
            <div className="flex items-center gap-1.5 text-slate-400 py-1">
              <Loader2 size={12} className="animate-spin" /> Consultando entrega…
            </div>
          )}
          {errorEntrega && (
            <p className="text-red-600 flex items-center gap-1 py-1">
              <AlertTriangle size={11} /> {errorEntrega}
            </p>
          )}
          {!cargandoEntrega && !errorEntrega && !entrega && (
            <p className="text-slate-400 py-1">Sin datos de entrega disponibles aún.</p>
          )}
          {entrega && (
            <>
              <div className="flex justify-between">
                <span className="text-slate-500">Lugar de entrega</span>
                <span className="text-slate-700 text-right max-w-[60%]">
                  {cargandoUbigeo ? (
                    <span className="text-slate-400 italic">Verificando ubicación…</span>
                  ) : ubigeoOcr ? (
                    [ubigeoOcr.distrito, ubigeoOcr.provincia, ubigeoOcr.departamento]
                      .filter(Boolean)
                      .join(" / ")
                  ) : (
                    extraerProvinciaDepartamento(entrega.C_LugarEntrega) || "—"
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Fecha del estado</span>
                <span style={{ fontFamily: "var(--font-mono)" }} className="text-slate-700">
                  {entrega.C_FechaEstado || "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Inicio entrega</span>
                <span style={{ fontFamily: "var(--font-mono)" }} className="text-slate-700">
                  {entrega.C_InicioEntrega || "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Fin entrega</span>
                <span style={{ fontFamily: "var(--font-mono)" }} className="text-slate-700">
                  {entrega.C_FinEntrega || "—"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Expediente SIAF</span>
                <span style={{ fontFamily: "var(--font-mono)" }} className="text-slate-700">
                  {entrega.C_ExpedienteSIAF || "—"}
                </span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-100">
                <span className="text-slate-500">Subtotal</span>
                <span style={{ fontFamily: "var(--font-mono)" }} className="text-slate-700">
                  S/ {fmt(entrega.N_SubTotal)}
                </span>
              </div>
            <div className="flex justify-between">
                <span className="text-slate-500">IGV</span>
                <span style={{ fontFamily: "var(--font-mono)" }} className="text-slate-700">
                  S/ {fmt(entrega.N_Igv)}
                </span>
              </div>
            </>
          )}

          <div className="flex items-center justify-between pt-2 mt-2 border-t border-slate-200">
            <span className="text-slate-500 font-medium">Total</span>
            <span style={{ fontFamily: "var(--font-mono)" }} className="text-base font-bold text-slate-900">
              S/ {monto}
            </span>
          </div>
      </div>

        {pdfAbierto && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            <div className="absolute inset-0 bg-slate-950/60" onClick={cerrarPdf} />
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
                <span className="text-sm font-semibold text-slate-800">Vista previa · PDF OCAM</span>
                <button onClick={cerrarPdf} className="text-slate-400 hover:text-slate-700">
                  <X size={16} />
                </button>
              </div>
              <iframe src={pdfAbierto} className="flex-1 w-full" title="PDF OCAM" />
            </div>
          </div>
        )}

        {pdfFisicaAbierto && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            <div className="absolute inset-0 bg-slate-950/60" onClick={cerrarPdfFisica} />
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200">
                <span className="text-sm font-semibold text-slate-800">Vista previa · Orden Física</span>
                <button onClick={cerrarPdfFisica} className="text-slate-400 hover:text-slate-700">
                  <X size={16} />
                </button>
              </div>
              <iframe src={pdfFisicaAbierto} className="flex-1 w-full" title="PDF Física" />
            </div>
          </div>
        )}

      {registrarAbierto && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
            <div className="absolute inset-0 bg-slate-950/60" onClick={cerrarRegistrarOrden} />
            <div className="absolute inset-0 bg-slate-950/60" onClick={cerrarRegistrarOrden} />
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
                <div>
                  <span className="text-sm font-semibold text-slate-800">Registrar Orden</span>
                  <p style={{ fontFamily: "var(--font-mono)" }} className="text-[11px] text-slate-400">
                    {p.C_OrdenCompra}
                  </p>
                </div>
                <button onClick={cerrarRegistrarOrden} className="text-slate-400 hover:text-slate-700">
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5">
                {cargandoOcr && (
                  <div className="flex items-center gap-2 text-sm text-slate-500 py-10 justify-center">
                    <Loader2 size={16} className="animate-spin" />
                    Descargando PDF y aplicando OCR…
                  </div>
                )}

                {errorOcr && (
                  <p className="text-xs text-red-600 flex items-center gap-1 py-2">
                    <AlertTriangle size={12} /> {errorOcr}
                  </p>
                )}

                {!cargandoOcr && !errorOcr && datosOcr && (
                  <div className="space-y-3">
                    {Object.entries(datosOcr)
                      .filter(([k]) => k !== "otros")
                      .map(([campo, valor]) => (
                        <div key={campo}>
                          <label
                            style={{ fontFamily: "var(--font-mono)" }}
                            className="text-[11px] text-slate-500 uppercase tracking-wide font-medium"
                          >
                            {campo.replace(/_/g, " ")}
                          </label>
                          <p className="text-sm text-slate-800 mt-0.5">{String(valor ?? "—")}</p>
                        </div>
                      ))}

                    {datosOcr.otros && (
                      <div className="pt-3 border-t border-slate-200">
                        <p
                          style={{ fontFamily: "var(--font-mono)" }}
                          className="text-[11px] text-slate-500 uppercase tracking-wide mb-2 font-medium"
                        >
                          Otros datos
                        </p>
                        <div className="space-y-2">
                          {Object.entries(datosOcr.otros as Record<string, unknown>).map(([campo, valor]) => (
                            <div key={campo} className="flex justify-between gap-3 text-xs">
                              <span className="text-slate-500">{campo.replace(/_/g, " ")}</span>
                              <span className="text-slate-800 text-right">{String(valor ?? "—")}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }


  // ============================================================
  // TAB 3 — Ventas: completar precios
  // ============================================================
  function TabVentas() {
    const [ordenes, setOrdenes] = useState<Orden[]>([]);
    const [cargando, setCargando] = useState(true);
    const [precios, setPrecios] = useState<Record<number, string>>({});
    const [enviando, setEnviando] = useState<number | null>(null);

    const cargar = useCallback(async () => {
      setCargando(true);
      try {
        const r = await fetch(`${API_BASE}/ordenes/pendientes-precio`);
        setOrdenes(await r.json());
      } catch {
        /* noop */
      }
      setCargando(false);
    }, []);

    useEffect(() => {
      cargar();
    }, [cargar]);

    const completar = async (orden: Orden) => {
      const precio = parseFloat(precios[orden.id]);
      if (!precio || precio <= 0) return;
      setEnviando(orden.id);
      try {
        await fetch(`${API_BASE}/ordenes/${orden.id}/completar-precio`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ precio, completado_por: "ventas" }),
        });
        setOrdenes((prev) => prev.filter((o) => o.id !== orden.id));
      } finally {
        setEnviando(null);
      }
    };

    return (
      <div>
        <div className="flex items-start sm:items-end justify-between mb-6 flex-wrap gap-3">
          <div>
            <h2 style={{ fontFamily: "var(--font-display)" }} className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight">
              Órdenes pendientes de precio
            </h2>
            <p className="text-sm text-slate-500 mt-1">Registradas por compras · completa el precio y se actualiza el ERP al instante</p>
          </div>
          <button
            onClick={cargar}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm font-medium text-slate-700 hover:border-slate-300 hover:text-slate-900 transition-colors"
          >
            <RefreshCw size={14} /> Refrescar
          </button>
        </div>

        {cargando ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 size={15} className="animate-spin" /> Cargando órdenes…
          </div>
        ) : ordenes.length === 0 ? (
          <EmptyState icon={DollarSign} titulo="No hay órdenes pendientes" detalle="Todas las órdenes registradas ya tienen precio completado." />
        ) : (
          <>
            {/* Tabla en desktop */}
            <div className="hidden sm:block bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    style={{ fontFamily: "var(--font-mono)" }}
                    className="border-b border-slate-200 bg-slate-50 text-left text-[11px] text-slate-500 uppercase tracking-wide"
                  >
                    <th className="px-4 py-3 font-medium">Producto</th>
                    <th className="px-4 py-3 font-medium">Cantidad</th>
                    <th className="px-4 py-3 font-medium">Registrado por</th>
                    <th className="px-4 py-3 font-medium">Precio unitario (S/)</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {ordenes.map((o) => (
                    <tr key={o.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                      <td className="px-4 py-3 text-slate-800">{o.producto}</td>
                      <td style={{ fontFamily: "var(--font-mono)" }} className="px-4 py-3 text-slate-500">
                        {o.cantidad}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{o.registrado_por}</td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={precios[o.id] || ""}
                          onChange={(e) => setPrecios({ ...precios, [o.id]: e.target.value })}
                          style={{ fontFamily: "var(--font-mono)" }}
                          className="w-28 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => completar(o)}
                          disabled={!precios[o.id] || enviando === o.id}
                          className="flex items-center gap-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg px-3 py-1.5 disabled:opacity-40 hover:bg-emerald-700 transition-colors"
                        >
                          {enviando === o.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                          Completar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cards en móvil */}
            <div className="sm:hidden space-y-3">
              {ordenes.map((o) => (
                <div key={o.id} className="bg-white border border-slate-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-slate-800 mb-1">{o.producto}</p>
                  <div className="flex justify-between text-xs text-slate-500 mb-3">
                    <span>Cantidad: {o.cantidad}</span>
                    <span>{o.registrado_por}</span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Precio S/"
                      value={precios[o.id] || ""}
                      onChange={(e) => setPrecios({ ...precios, [o.id]: e.target.value })}
                      style={{ fontFamily: "var(--font-mono)" }}
                      className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                    />
                    <button
                      onClick={() => completar(o)}
                      disabled={!precios[o.id] || enviando === o.id}
                      className="flex items-center gap-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg px-4 disabled:opacity-40 hover:bg-emerald-700 transition-colors"
                    >
                      {enviando === o.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                      Completar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  // ============================================================
  interface EmptyStateProps {
    icon: LucideIcon;
    titulo: string;
    detalle: string;
    compacto?: boolean;
  }

  function EmptyState({ icon: Icon, titulo, detalle, compacto }: EmptyStateProps) {
    return (
      <div className={`flex flex-col items-center justify-center text-center border-2 border-dashed border-slate-200 rounded-xl bg-white/50 ${compacto ? "py-10" : "py-16"}`}>
        <div className="w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center mb-3">
          <Icon size={compacto ? 20 : 24} className="text-[#4F46E5]" />
        </div>
        <p className="text-sm font-semibold text-slate-700">{titulo}</p>
        <p className="text-xs text-slate-500 mt-1 max-w-xs">{detalle}</p>
      </div>
    );
  }

  // ============================================================
  // TAB 5 — Auditoría: quién envió a revisión y quién confirmó
  // ============================================================
  interface FilaAuditoria {
    orden_compra_id: number;
    numero_ocam: string | null;
    codigo_venta: string | null;
    producto_codigo: string;
    producto_descripcion: string | null;
    estado: "preview" | "confirmado" | "subido";
    rellenado_por: string | null;
    rellenado_en: string | null;
    confirmado_por: string | null;
    confirmado_en: string | null;
    subido_por: string | null;
    subido_en: string | null;
  }

  interface ResumenUsuario {
    usuario: string;
    enviados: number;
    confirmados: number;
  }

  function badgeEstadoAuditoria(estado: string) {
    switch (estado) {
      case "preview":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "confirmado":
        return "bg-indigo-50 text-[#4F46E5] border-indigo-200";
      case "subido":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      default:
        return "bg-slate-100 text-slate-500 border-slate-200";
    }
  }

  function formatearFechaHora(raw?: string | null) {
    if (!raw) return "—";
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function TabAuditoria({ tick }: { tick?: number }) {
    const [detalle, setDetalle] = useState<FilaAuditoria[]>([]);
    const [resumen, setResumen] = useState<ResumenUsuario[]>([]);
    const [cargando, setCargando] = useState(true);
    const [error, setError] = useState("");
    const [filtroUsuario, setFiltroUsuario] = useState("");
    const [filtroEstado, setFiltroEstado] = useState("");
    const [filtroTexto, setFiltroTexto] = useState("");

    const cargar = useCallback(async () => {
      setCargando(true);
      setError("");
      try {
        const r = await fetch(`${API_BASE}/erp/estadisticas/seguimiento`);
        if (!r.ok) throw new Error((await r.json()).detail || `Error HTTP ${r.status}`);
        const data = await r.json();
        setDetalle(data.detalle || []);
        setResumen(data.resumen || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error desconocido");
      } finally {
        setCargando(false);
      }
    }, []);

  useEffect(() => {
      cargar();
    }, [cargar]);

    // Se refresca solo cuando llega una notificación relevante por WebSocket
    // (op_rellenada / op_confirmada / op_subida_erp) — así la tabla de
    // auditoría queda en vivo sin que el usuario tenga que tocar "Refrescar".
    useEffect(() => {
      if (tick !== undefined) {
        cargar();
      }
    }, [tick, cargar]);
    const usuariosDisponibles = useMemo(
      () => Array.from(new Set(resumen.map((r) => r.usuario))).sort(),
      [resumen]
    );

    const filasFiltradas = useMemo(() => {
      return detalle.filter((f) => {
        const okUsuario =
          !filtroUsuario ||
          f.rellenado_por === filtroUsuario ||
          f.confirmado_por === filtroUsuario;
        const okEstado = !filtroEstado || f.estado === filtroEstado;
        const okTexto =
          !filtroTexto ||
          JSON.stringify(f).toLowerCase().includes(filtroTexto.toLowerCase());
        return okUsuario && okEstado && okTexto;
      });
    }, [detalle, filtroUsuario, filtroEstado, filtroTexto]);

    return (
      <div>
        <div className="flex items-start sm:items-end justify-between mb-6 flex-wrap gap-3">
          <div>
            <h2
              style={{ fontFamily: "var(--font-display)" }}
              className="text-xl sm:text-2xl font-semibold text-slate-900 tracking-tight"
            >
              Auditoría de seguimiento
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Quién de ventas envió cada producto a revisión y quién de seguimiento lo confirmó.
            </p>
          </div>
          <button
            onClick={cargar}
            disabled={cargando}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-slate-200 text-sm font-medium text-slate-700 hover:border-slate-300 hover:text-slate-900 transition-colors disabled:opacity-50"
          >
            {cargando ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refrescar
          </button>
        </div>

        {error && (
          <div className="mb-6 flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            <AlertTriangle size={15} />
            {error}
          </div>
        )}

        {/* Resumen por usuario */}
        {resumen.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {resumen.map((r) => (
              <button
                key={r.usuario}
                onClick={() => setFiltroUsuario((prev) => (prev === r.usuario ? "" : r.usuario))}
                className={`text-left bg-white border rounded-xl p-4 transition-colors ${
                  filtroUsuario === r.usuario
                    ? "border-indigo-300 ring-2 ring-indigo-500/10"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
                    <User size={13} className="text-[#4F46E5]" />
                  </div>
                  <span className="text-sm font-semibold text-slate-800 truncate">{r.usuario}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-amber-700">{r.enviados} enviado{r.enviados !== 1 ? "s" : ""}</span>
                  <span className="text-[#4F46E5]">{r.confirmados} confirmado{r.confirmados !== 1 ? "s" : ""}</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Filtros */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
          <input
            placeholder="Buscar (código, orden, producto...)"
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3.5 py-2 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400"
          />
          <select
            value={filtroUsuario}
            onChange={(e) => setFiltroUsuario(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="">Todos los usuarios</option>
            {usuariosDisponibles.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <select
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="">Todos los estados</option>
            <option value="preview">En preview</option>
            <option value="confirmado">Confirmado</option>
            <option value="subido">Subido al ERP</option>
          </select>
        </div>

        {cargando && detalle.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 py-10 justify-center">
            <Loader2 size={15} className="animate-spin" /> Cargando auditoría…
          </div>
        ) : filasFiltradas.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            titulo="Sin movimientos"
            detalle="Todavía no hay productos enviados a revisión ni confirmados con los filtros actuales."
          />
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr
                  style={{ fontFamily: "var(--font-mono)" }}
                  className="border-b border-slate-200 bg-slate-50 text-left text-[11px] text-slate-500 uppercase tracking-wide"
                >
                  <th className="px-4 py-3 font-medium">Orden / OCAM</th>
                  <th className="px-4 py-3 font-medium">Producto</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 font-medium">Enviado por</th>
                  <th className="px-4 py-3 font-medium">Fecha envío</th>
                  <th className="px-4 py-3 font-medium">Confirmado por</th>
                  <th className="px-4 py-3 font-medium">Fecha confirmación</th>
                </tr>
              </thead>
              <tbody>
                {filasFiltradas.map((f, i) => (
                  <tr key={`${f.orden_compra_id}-${f.producto_codigo}-${i}`} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <p style={{ fontFamily: "var(--font-mono)" }} className="text-xs font-semibold text-slate-800">
                        {f.codigo_venta || f.numero_ocam || `#${f.orden_compra_id}`}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium text-slate-800">{f.producto_codigo}</p>
                      {f.producto_descripcion && (
                        <p className="text-[11px] text-slate-400 truncate max-w-[220px]">{f.producto_descripcion}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${badgeEstadoAuditoria(f.estado)}`}>
                        {f.estado}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">{f.rellenado_por || "—"}</td>
                    <td style={{ fontFamily: "var(--font-mono)" }} className="px-4 py-3 text-[11px] text-slate-500">
                      {formatearFechaHora(f.rellenado_en)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">{f.confirmado_por || "—"}</td>
                    <td style={{ fontFamily: "var(--font-mono)" }} className="px-4 py-3 text-[11px] text-slate-500">
                      {formatearFechaHora(f.confirmado_en)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }