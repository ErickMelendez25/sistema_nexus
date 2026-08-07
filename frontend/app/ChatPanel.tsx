"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Check, CheckCheck, Smile, Phone, Video, ArrowLeft, Wrench, KeyRound, CircleHelp } from "lucide-react";



interface Usuario {
  id: number;
  username: string;
  nombre_completo: string;
  foto_perfil: string | null;
  rol: string;
  online?: boolean;
}

interface Mensaje {
  id: number;
  emisor_id: number;
  receptor_id: number;
  contenido: string;
  leido: boolean;
  creado_en: string;
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
// Avatar con caída real a la inicial del nombre — no solo cuando NO hay
// foto_perfil, sino también cuando SÍ hay una ruta guardada pero el
// archivo ya no existe en el servidor (foto borrada). El estado `error`
// se dispara con onError y fuerza el mismo círculo con inicial que se
// usa cuando nunca hubo foto — así nunca se ve el ícono roto del navegador.
function AvatarUsuario({
  fotoPerfil,
  nombre,
  apiBase,
  size = 44,
  textSize = "text-base",
}: {
  fotoPerfil: string | null;
  nombre: string;
  apiBase: string;
  size?: number;
  textSize?: string;
}) {
  const [error, setError] = useState(false);
  const inicial = nombre?.charAt(0).toUpperCase() || "?";

  if (!fotoPerfil || error) {
    return (
      <div
        style={{ width: size, height: size }}
        className={`rounded-full bg-indigo-600 text-white flex items-center justify-center font-semibold shrink-0 ${textSize}`}
      >
        {inicial}
      </div>
    );
  }

  return (
    <img
      src={`${apiBase}/archivos/${fotoPerfil}`}
      alt={nombre}
      style={{ width: size, height: size }}
      className="rounded-full object-cover shrink-0"
      onError={() => setError(true)}
    />
  );
}


interface ChatPanelProps {
  apiBase: string;
  miId: number | null;
  onlineIds: Set<number>;
  onSincronizarOnline: (ids: number[]) => void;
  onUsuariosCargados?: (usuarios: Usuario[]) => void;
  resumenChats: Record<number, ResumenChat>;
  mensajeEntrante: { mensaje: Mensaje; tick: number } | null;
  escribiendoEvento: { de: number; tick: number } | null;
  vistoEvento: { por: number; tick: number } | null;
  onEnviarEscribiendo: (paraId: number) => void;
  onConversacionAbierta?: (usuarioId: number) => void;
  onLlamar: (destinoId: number, destinoNombre: string, conVideo: boolean) => void;
  /** Avisa a page.tsx cuando se abre/cierra una conversación — así el
   * sidebar sabe cuándo ocultar su hamburguesa flotante en mobile. */
  onVistaMovilCambia?: (conversacionAbierta: boolean) => void;
  /** Se llama justo después de enviar un mensaje propio (texto o
   * sticker) para que page.tsx refleje al instante el "último mensaje"
   * en la lista de chats — sin depender de que el WebSocket haga eco
   * de vuelta hacia el propio emisor. */
    /** Reporta el id del usuario con quien está abierta la conversación
   * (null si no hay ninguna) — page.tsx lo usa para decidir si debe
   * mostrar el toast flotante de un mensaje entrante. */
  onConversacionActivaCambia?: (usuarioId: number | null) => void;
  onMensajeEnviado?: (receptorId: number, contenido: string, creadoEn: string) => void;
}
// Set amplio estilo WhatsApp, agrupado por categoría (caritas, gestos,
// corazones, animales/comida/actividades, objetos y símbolos). Cubre
// los emojis más usados en el día a día — el set completo de Unicode
// tiene miles y no cabría en un picker usable, así que se prioriza
// cobertura real de uso sobre exhaustividad absoluta.
interface CategoriaEmoji {
  id: string;
  label: string;
  icono: string;
  emojis: string[];
}

const EMOJI_CATEGORIES: CategoriaEmoji[] = [
  {
    id: "caritas",
    label: "Caritas",
    icono: "😀",
    emojis: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🤣", "😂", "🙂", "🙃",
      "😉", "😊", "😇", "🥰", "😍", "🤩", "😘", "😗", "😚", "😙",
      "😋", "😛", "😜", "🤪", "😝", "🤑", "🤗", "🤭", "🤫", "🤔",
      "🤐", "🤨", "😐", "😑", "😶", "😏", "😒", "🙄", "😬", "🤥",
      "😌", "😔", "😪", "🤤", "😴", "😷", "🤒", "🤕", "🤢", "🤮",
      "🤧", "🥵", "🥶", "🥴", "😵", "🤯", "🤠", "🥳", "😎", "🤓",
      "🧐", "😕", "😟", "🙁", "😮", "😯", "😲", "😳", "🥺", "😦",
      "😧", "😨", "😰", "😥", "😢", "😭", "😱", "😖", "😣", "😞",
      "😓", "😩", "😫", "🥱", "😤", "😡", "😠", "🤬", "😈", "👿",
    ],
  },
  {
    id: "gestos",
    label: "Gestos",
    icono: "👋",
    emojis: [
      "👋", "🤚", "🖐️", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞",
      "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️",
      "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "👐", "🤲",
      "🤝", "🙏", "✍️", "💪", "🦾",
    ],
  },
  {
    id: "corazones",
    label: "Corazones",
    icono: "❤️",
    emojis: [
      "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
      "❤️‍🔥", "❤️‍🩹", "💕", "💞", "💓", "💗", "💖", "💘", "💝",
    ],
  },
  {
    id: "animales",
    label: "Animales",
    icono: "🐶",
    emojis: [
      "🐶", "🐱", "🐭", "🐹", "🐰", "🦊", "🐻", "🐼", "🐨", "🐯",
      "🦁", "🐮", "🐷", "🐸", "🐵", "🐔", "🐧", "🐦", "🦆", "🦉",
      "🐺", "🐗", "🐴", "🦄", "🐝", "🐛", "🦋", "🐌", "🐞", "🐢",
    ],
  },
  {
    id: "comida",
    label: "Comida",
    icono: "🍕",
    emojis: [
      "🍏", "🍎", "🍐", "🍊", "🍋", "🍌", "🍉", "🍇", "🍓", "🍒",
      "🍑", "🥭", "🍍", "🥝", "🍅", "🥑", "🍕", "🍔", "🌭", "🥪",
      "🌮", "🌯", "🍿", "🧂", "🍩", "🍪", "🎂", "🍰", "🧁", "🍫",
      "🍬", "🍭", "☕", "🍵", "🥤", "🍺", "🍻", "🥂", "🍷", "🥃",
    ],
  },
  {
    id: "actividades",
    label: "Actividades",
    icono: "⚽",
    emojis: [
      "⚽", "🏀", "🏈", "⚾", "🎾", "🏐", "🎮", "🎯", "🎲", "🎳",
      "🎸", "🎧", "🎤", "🎬", "📷", "💻", "📱", "⌚", "💡", "🔋",
      "📌", "📎", "✂️", "📝", "📅", "📈", "📉", "📊", "💼", "🗂️",
      "🔒", "🔑", "🚀", "✈️", "🚗", "🏠", "🎁", "🎉", "🎊", "🏆",
    ],
  },
  {
    id: "simbolos",
    label: "Símbolos",
    icono: "✅",
    emojis: [
      "✅", "❌", "❗", "❓", "⚠️", "🔥", "💯", "⭐", "🌟", "✨",
      "💤", "💢", "💥", "💦", "🕐", "🔔", "🔕",
    ],
  },
];

// "Stickers" (emoji grandes) con humor de oficina/empresa — para
// reacciones rápidas en el chat de trabajo sin sonar demasiado serio.
const STICKERS = [
  "😂", "🤣", "😅", "🙃", "🥲", "🫡", "🤦", "🤦‍♂️", "🤦‍♀️", "🤷",
  "🤷‍♂️", "🤷‍♀️", "😴", "🥱", "☕", "💼", "📈", "📉", "🚀", "🔥",
  "💯", "👏", "🙌", "🤝", "💪", "🎉", "🥳", "🎯", "🐌", "🚨",
  "📎", "🖇️", "🗂️", "⏳", "😎", "🧠", "💡", "🤯", "😵", "🫠",
];



// Opciones rápidas que aparecen al abrir un chat con un usuario que
// tiene rol ADMIN (Erick) — ahorran el paso de escribir el motivo del
// contacto, típico de soporte interno.
const OPCIONES_ADMIN: { label: string; texto: string; Icono: typeof Wrench }[] = [
  { label: "Incidencia técnica", texto: "Hola Erick, tengo una incidencia técnica con el sistema.", Icono: Wrench },
  { label: "Credenciales", texto: "Hola Erick, tengo un problema con mis credenciales de acceso.", Icono: KeyRound },
  { label: "Consulta general", texto: "Hola Erick, tengo una consulta y necesito tu ayuda.", Icono: CircleHelp },
];


export default function ChatPanel({
    apiBase,
    miId,
    onlineIds,
    onSincronizarOnline,
    onUsuariosCargados,
    resumenChats,
    mensajeEntrante,
    escribiendoEvento,
    vistoEvento,
    onEnviarEscribiendo,
    onConversacionAbierta,
    onLlamar,
    onVistaMovilCambia,
    onConversacionActivaCambia,
    onMensajeEnviado,
  }: ChatPanelProps) {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargandoUsuarios, setCargandoUsuarios] = useState(true);
  const [busqueda, setBusqueda] = useState("");

  const [usuarioActivo, setUsuarioActivo] = useState<Usuario | null>(null);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [cargandoMensajes, setCargandoMensajes] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [emojiAbierto, setEmojiAbierto] = useState(false);
  const [categoriaEmojiActiva, setCategoriaEmojiActiva] = useState("caritas");
  const [stickersAbierto, setStickersAbierto] = useState(false);
  const [escribiendoDe, setEscribiendoDe] = useState<number | null>(null);

  const [busquedaChat, setBusquedaChat] = useState("");


  const [reenviarMensaje, setReenviarMensaje] = useState<Mensaje | null>(null);
  const [reenviarBusqueda, setReenviarBusqueda] = useState("");


  const finMensajesRef = useRef<HTMLDivElement | null>(null);
  const usuarioActivoRef = useRef<Usuario | null>(null);
  usuarioActivoRef.current = usuarioActivo;
  const timeoutEscribiendoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref de TODA la barra inferior (botones + popups de emoji/sticker) —
  // un clic fuera de esta zona cierra cualquiera de los dos paneles
  // abiertos. Como los popups están dentro de este mismo contenedor,
  // clickear dentro de ellos nunca cuenta como "afuera".
  const footerRef = useRef<HTMLDivElement | null>(null);
  // ---------- Cargar lista de usuarios ----------
useEffect(() => {
    async function cargarUsuarios() {
      try {
        const token = localStorage.getItem("helbot_token");
        const res = await fetch(`${apiBase}/chat/usuarios`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error("No se pudieron obtener los usuarios");
        const data: Usuario[] = await res.json();
        setUsuarios(data);
        onSincronizarOnline(data.filter((u) => u.online).map((u) => u.id));
        // Sube la lista completa (con nombre_completo y foto_perfil) a
        // page.tsx — antes solo se sincronizaban los IDs online, y el
        // toast flotante de "nuevo mensaje" no tenía forma de mostrar
        // quién escribió porque el WebSocket de mensajes solo trae
        // emisor_id (un número), no el nombre ni la foto.
        onUsuariosCargados?.(data);
      } catch (error) {
        console.error(error);
      } finally {
        setCargandoUsuarios(false);
      }
    }
    cargarUsuarios();
  }, [apiBase]);
  // ---------- WS propio de este panel: solo escucha mensajes/typing/vistos ----------
  // (la presencia online/offline ya se maneja en page.tsx — este socket
  // es aparte y sirve solo para el contenido del chat en sí)
// ---------- Ya no abre su propio WebSocket — reacciona a los eventos
  // que llegan por el socket ÚNICO de page.tsx. Dos sockets abiertos al
  // mismo /chat/ws para el mismo usuario eran la causa de que el estado
  // online/offline se pisara entre sí. ----------
  useEffect(() => {
    if (!mensajeEntrante) return;
    const m = mensajeEntrante.mensaje;
    const activo = usuarioActivoRef.current;
    if (activo && (m.emisor_id === activo.id || m.receptor_id === activo.id)) {
      setMensajes((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (m.emisor_id === activo.id) {
        marcarComoLeido(activo.id);
        onConversacionAbierta?.(activo.id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mensajeEntrante]);

  useEffect(() => {
    if (!escribiendoEvento) return;
    const activo = usuarioActivoRef.current;
    if (activo && escribiendoEvento.de === activo.id) {
      setEscribiendoDe(escribiendoEvento.de);
      setTimeout(() => setEscribiendoDe((prev) => (prev === escribiendoEvento.de ? null : prev)), 3000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escribiendoEvento]);

  useEffect(() => {
    if (!vistoEvento) return;
    setMensajes((prev) =>
      prev.map((m) => (m.receptor_id === vistoEvento.por ? { ...m, leido: true } : m))
    );
  }, [vistoEvento]);



  // ---------- Abrir conversación con un usuario ----------
const abrirConversacion = async (u: Usuario) => {
    setUsuarioActivo(u);
    setMensajes([]);
    setCargandoMensajes(true);
    onConversacionAbierta?.(u.id); // limpia el badge de no-leídos al instante
    try {
      const token = localStorage.getItem("helbot_token");
      const res = await fetch(`${apiBase}/chat/mensajes/${u.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setMensajes(await res.json());
      }
      marcarComoLeido(u.id);
    } catch {
      /* noop */
    } finally {
      setCargandoMensajes(false);
    }
  };

  const marcarComoLeido = async (emisorId: number) => {
    try {
      const token = localStorage.getItem("helbot_token");
      await fetch(`${apiBase}/chat/mensajes/marcar-leidos`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ emisor_id: emisorId }),
      });
    } catch {
      /* noop */
    }
  };

  // ---------- Enviar mensaje ----------
  const enviarMensaje = async (contenidoRapido?: string) => {
    const contenido = (contenidoRapido ?? texto).trim();
    if (!contenido || !usuarioActivo || enviando) return;
    setEnviando(true);
    if (!contenidoRapido) setTexto("");
    setEmojiAbierto(false);
    try {
      const token = localStorage.getItem("helbot_token");
      const res = await fetch(`${apiBase}/chat/mensajes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ receptor_id: usuarioActivo.id, contenido }),
      });
      if (res.ok) {
        const nuevo: Mensaje = await res.json();
        setMensajes((prev) => [...prev, nuevo]);
        onMensajeEnviado?.(usuarioActivo.id, nuevo.contenido, nuevo.creado_en);
      }
    } finally {
      setEnviando(false);
    }
  };


  const enviarSticker = async (emoji: string) => {
  if (!usuarioActivo || enviando) return;
  setEnviando(true);
  setStickersAbierto(false);
  try {
    const token = localStorage.getItem("helbot_token");
    const res = await fetch(`${apiBase}/chat/mensajes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ receptor_id: usuarioActivo.id, contenido: `[STICKER]${emoji}` }),
    });
    if (res.ok) {
      const nuevo: Mensaje = await res.json();
      setMensajes((prev) => [...prev, nuevo]);
      onMensajeEnviado?.(usuarioActivo.id, nuevo.contenido, nuevo.creado_en);
    }
  } finally {
    setEnviando(false);
  }
};


  const reenviar = async (destinoId: number) => {
  if (!reenviarMensaje) return;
  try {
    const token = localStorage.getItem("helbot_token");
    await fetch(`${apiBase}/chat/mensajes/reenviar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ mensaje_id: reenviarMensaje.id, receptor_id: destinoId }),
    });
    if (usuarioActivo?.id === destinoId) {
      // si le reenvío al mismo chat abierto, no hace falta recargar,
      // el mensaje llega por WS como cualquier otro
    }
  } finally {
    setReenviarMensaje(null);
    setReenviarBusqueda("");
  }
};

  // ---------- Avisar "escribiendo..." al otro (con throttle) ----------
  const manejarCambioTexto = (valor: string) => {
    setTexto(valor);
    if (!usuarioActivo) return;
    if (timeoutEscribiendoRef.current) return; // ya se avisó hace <2s, no repetir
    onEnviarEscribiendo(usuarioActivo.id);
    timeoutEscribiendoRef.current = setTimeout(() => {
      timeoutEscribiendoRef.current = null;
    }, 2000);
  };

// ---------- Auto-scroll al último mensaje ----------
  useEffect(() => {
    finMensajesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensajes, escribiendoDe]);

  // ---------- Cerrar emoji/sticker picker al hacer clic fuera ----------
  useEffect(() => {
    const manejarClickFuera = (e: MouseEvent) => {
      if (footerRef.current && !footerRef.current.contains(e.target as Node)) {
        setEmojiAbierto(false);
        setStickersAbierto(false);
      }
    };
    document.addEventListener("mousedown", manejarClickFuera);
    return () => document.removeEventListener("mousedown", manejarClickFuera);
  }, []);


  // Avisa a page.tsx cada vez que se abre o cierra una conversación
  // (usuarioActivo pasa de null a un usuario, o viceversa). En mobile,
  // page.tsx usa esto para ocultar la hamburguesa flotante del sidebar
  // y quitar el espacio reservado arriba, para que el chat se vea a
  // pantalla completa igual que WhatsApp.
useEffect(() => {
    onVistaMovilCambia?.(!!usuarioActivo);
  }, [usuarioActivo, onVistaMovilCambia]);

  // Si el componente se desmonta (el usuario cambió de tab) con una
  // conversación todavía abierta, avisa que ya no hay ninguna abierta
  // — sin esto, el sidebar se quedaría con la hamburguesa oculta para
  // siempre tras salir del tab de Chat.
  useEffect(() => {
    return () => {
      onVistaMovilCambia?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reporta a page.tsx quién es la conversación activa (o null) — se
  // usa para que el toast de mensaje nuevo solo se suprima si el
  // mensaje viene justo de esa persona, no de cualquiera mientras
  // estés en el tab Chat.
  useEffect(() => {
    onConversacionActivaCambia?.(usuarioActivo?.id ?? null);
  }, [usuarioActivo, onConversacionActivaCambia]);

  useEffect(() => {
    return () => {
      onConversacionActivaCambia?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);




  const usuariosFiltrados = usuarios
    .filter((u) => u.nombre_completo?.toLowerCase().includes(busqueda.toLowerCase()))
    .slice()
    .sort((a, b) => {
      // Estilo WhatsApp: la conversación con el mensaje más reciente va
      // primero. Sin mensajes todavía, se queda al final, alfabético.
      const fechaA = resumenChats[a.id]?.ultimo_mensaje_en;
      const fechaB = resumenChats[b.id]?.ultimo_mensaje_en;
      if (fechaA && fechaB) return new Date(fechaB).getTime() - new Date(fechaA).getTime();
      if (fechaA) return -1;
      if (fechaB) return 1;
      return (a.nombre_completo || "").localeCompare(b.nombre_completo || "");
    });

  const formatearHora = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
  };



  const formatearFechaSeparador = (iso: string) => {
    const fecha = new Date(iso);
    const hoy = new Date();
    const ayer = new Date();
    ayer.setDate(hoy.getDate() - 1);
    const esMismoDia = (a: Date, b: Date) =>
      a.getDate() === b.getDate() &&
      a.getMonth() === b.getMonth() &&
      a.getFullYear() === b.getFullYear();
    if (esMismoDia(fecha, hoy)) return "Hoy";
    if (esMismoDia(fecha, ayer)) return "Ayer";
    return fecha.toLocaleDateString("es-PE", { day: "2-digit", month: "long", year: "numeric" });
  };

  // Estilo WhatsApp para la LISTA de chats (no para dentro de la
  // conversación, esa usa formatearFechaSeparador de arriba): hoy
  // muestra la hora, ayer dice "Ayer", dentro de la semana muestra el
  // nombre del día, entre 1-4 semanas dice "Hace X semana(s)", y más
  // atrás muestra la fecha completa en español (ej. "5 de agosto de 2026").
  const formatearFechaLista = (iso: string) => {
    const fecha = new Date(iso);
    const ahora = new Date();
    const inicioDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const dias = Math.floor(
      (inicioDia(ahora).getTime() - inicioDia(fecha).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (dias <= 0) {
      return fecha.toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
    }
    if (dias === 1) return "Ayer";
    if (dias < 7) {
      const nombre = fecha.toLocaleDateString("es-PE", { weekday: "long" });
      return nombre.charAt(0).toUpperCase() + nombre.slice(1);
    }
    if (dias < 14) return "Hace 1 semana";
    if (dias < 30) return `Hace ${Math.floor(dias / 7)} semanas`;
    return fecha.toLocaleDateString("es-PE", { day: "numeric", month: "long", year: "numeric" });
  };
return (
    <div className="h-full bg-white flex overflow-hidden">
      {/* Lista de usuarios — en mobile ocupa toda la pantalla y se
          oculta apenas hay una conversación abierta (usuarioActivo).
          En desktop (md+) siempre queda visible al costado, igual
          que antes. */}
      <div
        className={`${
          usuarioActivo ? "hidden md:flex" : "flex"
        } w-full md:w-80 border-r border-slate-200 flex-col shrink-0`}
      >
        <div className="p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Chats</h2>
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar usuario..."
            className="mt-3 w-full px-3 py-2 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {cargandoUsuarios && (
            <div className="p-4 text-sm text-slate-500">Cargando usuarios...</div>
          )}

{!cargandoUsuarios &&
            usuariosFiltrados
              .filter((u) => u.id !== miId)
              .map((u) => {
                const resumen = resumenChats[u.id];
                const noLeidos = resumen?.no_leidos || 0;
                return (
                  <button
                    key={u.id}
                    onClick={() => abrirConversacion(u)}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 border-b border-slate-100 text-left ${
                      usuarioActivo?.id === u.id ? "bg-indigo-50" : ""
                    }`}
                  >
                    <div className="relative shrink-0">
                      <AvatarUsuario
                        fotoPerfil={u.foto_perfil}
                        nombre={u.nombre_completo}
                        apiBase={apiBase}
                        size={44}
                      />
                      {onlineIds.has(u.id) && (
                        <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className={`truncate ${noLeidos > 0 ? "font-semibold text-slate-900" : "font-medium text-slate-900"}`}>
                          {u.nombre_completo}
                        </p>
                        {resumen?.ultimo_mensaje_en && (
                          <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap">
                            {formatearFechaLista(resumen.ultimo_mensaje_en)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p
                          title={resumen?.ultimo_mensaje ?? undefined}
                          className={`text-xs truncate flex items-center gap-1 ${
                            noLeidos > 0
                              ? "text-slate-700 font-medium"
                              : !resumen?.ultimo_mensaje && onlineIds.has(u.id)
                              ? "text-emerald-600 font-medium"
                              : "text-slate-500"
                          }`}
                        >
                          {resumen?.ultimo_mensaje && resumen.ultimo_mensaje_propio && (
                            resumen.ultimo_mensaje_leido ? (
                              <CheckCheck size={13} className="text-sky-500 shrink-0" />
                            ) : (
                              <Check size={13} className="text-slate-400 shrink-0" />
                            )
                          )}
                          <span className="truncate">
                            {resumen?.ultimo_mensaje ?? (onlineIds.has(u.id) ? "En línea" : "Desconectado")}
                          </span>
                        </p>
                        {noLeidos > 0 && (
                          <span className="shrink-0 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-emerald-500 text-white text-[10px] font-semibold">
                            {noLeidos > 99 ? "99+" : noLeidos}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
             
        </div>
      </div>

    {/* Conversación — en mobile solo se muestra cuando hay un
          usuarioActivo (pantalla completa, como WhatsApp); en desktop
          siempre está visible al lado de la lista. */}
      <div
        className={`${
          usuarioActivo ? "flex" : "hidden md:flex"
        } flex-1 flex-col min-w-0`}
      >
        {!usuarioActivo ? (
          <div className="hidden md:flex flex-1 items-center justify-center text-slate-400 text-sm">
            Selecciona un usuario para empezar a chatear
          </div>
        ) : (
          <>
            <div className="h-16 border-b border-slate-200 flex items-center px-4 bg-white shrink-0">
              <button
                onClick={() => setUsuarioActivo(null)}
                className="md:hidden mr-1 p-2 -ml-2 rounded-full text-slate-500 hover:bg-slate-100 transition-colors shrink-0"
                aria-label="Volver a la lista de chats"
              >
                <ArrowLeft size={20} />
              </button>
              <div className="relative">
                <AvatarUsuario
                  fotoPerfil={usuarioActivo.foto_perfil}
                  nombre={usuarioActivo.nombre_completo}
                  apiBase={apiBase}
                  size={40}
                />
                {onlineIds.has(usuarioActivo.id) && (
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-white" />
                )}
              </div>
                <div className="ml-3">
                <p className="font-semibold text-slate-900">{usuarioActivo.nombre_completo}</p>
                  <p
                    className={`text-xs ${
                      escribiendoDe === usuarioActivo.id
                        ? "text-indigo-500 font-medium"
                        : onlineIds.has(usuarioActivo.id)
                        ? "text-emerald-600 font-medium"
                        : "text-slate-500"
                    }`}
                  >
                    {escribiendoDe === usuarioActivo.id
                      ? "escribiendo..."
                      : onlineIds.has(usuarioActivo.id)
                      ? "En línea"
                      : "Desconectado"}
                  </p>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <input
                  type="text"
                  value={busquedaChat}
                  onChange={(e) => setBusquedaChat(e.target.value)}
                  placeholder="Buscar en el chat..."
                  className="w-40 px-3 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={() => onLlamar(usuarioActivo.id, usuarioActivo.nombre_completo, false)}
                  title="Llamar"
                  className="p-2 rounded-full text-slate-400 hover:bg-slate-100 hover:text-indigo-600 transition-colors"
                >
                  <Phone size={18} />
                </button>
                <button
                  onClick={() => onLlamar(usuarioActivo.id, usuarioActivo.nombre_completo, true)}
                  title="Videollamada"
                  className="p-2 rounded-full text-slate-400 hover:bg-slate-100 hover:text-indigo-600 transition-colors"
                >
                  <Video size={18} />
                </button>
              </div>

            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-slate-50 space-y-3">
              {cargandoMensajes && (
                <p className="text-center text-xs text-slate-400">Cargando conversación...</p>
              )}



              {!cargandoMensajes &&
                mensajes
                  .filter((m) =>
                    busquedaChat.trim()
                      ? m.contenido.toLowerCase().includes(busquedaChat.toLowerCase())
                      : true
                  )
                  .map((m, idx, arr) => {
                  const propio = m.emisor_id === miId;
                  const anterior = arr[idx - 1];
                  const mostrarSeparador =
                    !anterior ||
                    new Date(anterior.creado_en).toDateString() !== new Date(m.creado_en).toDateString();
                  return (
                    <div key={m.id}>
                      {mostrarSeparador && (
                        <div className="flex justify-center my-3">
                          <span className="text-[11px] font-medium text-slate-500 bg-slate-200/70 px-3 py-1 rounded-full">
                            {formatearFechaSeparador(m.creado_en)}
                          </span>
                        </div>
                      )}
                    <div key={m.id} className={`flex items-center gap-1 group ${propio ? "justify-end" : "justify-start"}`}>
                      {propio && (
                        <button
                          onClick={() => setReenviarMensaje(m)}
                          title="Reenviar"
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-indigo-600 text-xs shrink-0"
                        >
                          ↪
                        </button>
                      )}
                        <div
                          className={
                            m.contenido.startsWith("[STICKER]")
                              ? "max-w-[70%] px-1 py-1"
                              : `max-w-[70%] px-4 py-2 rounded-2xl text-sm shadow-sm ${
                                  propio ? "bg-indigo-600 text-white rounded-br-md" : "bg-white text-slate-900 rounded-bl-md"
                                }`
                          }
                        >
                        {m.contenido.startsWith("[STICKER]") ? (
                          <span className="text-6xl block -mx-2 -my-1">{m.contenido.replace("[STICKER]", "")}</span>
                        ) : (
                          <p className="whitespace-pre-wrap break-words">{m.contenido}</p>
                        )}
                        <div
                          className={`flex items-center gap-1 mt-1 ${
                            propio ? "justify-end text-indigo-100" : "justify-end text-slate-400"
                          }`}
                        >
                        <span className="text-[10px]">{formatearHora(m.creado_en)}</span>
                        {propio &&
                          (m.leido ? (
                            <CheckCheck size={17} className="text-sky-300" />
                          ) : onlineIds.has(usuarioActivo.id) ? (
                            <CheckCheck size={17} />
                          ) : (
                            <Check size={17} />
                          ))}
                        </div>
                        </div>
                        </div>

                        {reenviarMensaje && (
                          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
                            <div className="bg-white rounded-xl shadow-xl w-80 max-h-[70vh] flex flex-col">
                              <div className="p-4 border-b border-slate-200">
                                <p className="font-semibold text-slate-900 text-sm">Reenviar mensaje</p>
                                <p className="text-xs text-slate-500 truncate mt-1">"{reenviarMensaje.contenido}"</p>
                                <input
                                  autoFocus
                                  type="text"
                                  value={reenviarBusqueda}
                                  onChange={(e) => setReenviarBusqueda(e.target.value)}
                                  placeholder="Buscar usuario..."
                                  className="mt-2 w-full px-3 py-1.5 rounded-lg border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                              </div>
                              <div className="flex-1 overflow-y-auto">
                                {usuarios
                                  .filter((u) => u.id !== miId)
                                  .filter((u) => u.nombre_completo?.toLowerCase().includes(reenviarBusqueda.toLowerCase()))
                                  .map((u) => (
                                    <button
                                      key={u.id}
                                      onClick={() => reenviar(u.id)}
                                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 text-left"
                                    >
                                      <div className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center text-xs font-semibold shrink-0">
                                        {u.nombre_completo?.charAt(0).toUpperCase()}
                                      </div>
                                      <span className="text-sm text-slate-800 truncate">{u.nombre_completo}</span>
                                    </button>
                                  ))}
                              </div>
                              <div className="p-3 border-t border-slate-200">
                                <button
                                  onClick={() => setReenviarMensaje(null)}
                                  className="w-full py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}

              {escribiendoDe === usuarioActivo.id && (
                <div className="flex justify-start">
                  <div className="bg-white text-slate-400 rounded-2xl rounded-bl-md px-4 py-2.5 shadow-sm flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
                  </div>
                </div>
              )}

              <div ref={finMensajesRef} />
            </div>

            <div ref={footerRef} className="border-t border-slate-200 p-4 bg-white relative shrink-0">

                {usuarioActivo.rol?.toLowerCase() === "admin" && (
                <div className="mb-3">
                  {mensajes.length === 0 && (
                    <p className="text-[11px] text-slate-500 mb-1.5 px-1">
                      Elige una opción para iniciar la conversación más rápido, o escribe tu mensaje directamente abajo.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {OPCIONES_ADMIN.map(({ label, texto, Icono }) => (
                      <button
                        key={label}
                        onClick={() => enviarMensaje(texto)}
                        disabled={enviando}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 text-xs font-medium hover:bg-indigo-100 transition-colors disabled:opacity-40 shrink-0"
                      >
                        <Icono size={14} />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {stickersAbierto && (
                <div className="absolute bottom-full left-16 mb-2 bg-white border border-slate-200 rounded-xl shadow-lg p-3 grid grid-cols-4 gap-2 z-10">
                  {STICKERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => enviarSticker(s)}
                      className="text-4xl hover:bg-slate-100 rounded-lg p-2 transition-transform hover:scale-110"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {emojiAbierto && (
                <div className="absolute bottom-full left-4 mb-2 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-10 flex flex-col overflow-hidden">
                  {/* Tabs de categorías */}
                  <div className="flex border-b border-slate-100 px-1 pt-1">
                    {EMOJI_CATEGORIES.map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setCategoriaEmojiActiva(cat.id)}
                        title={cat.label}
                        className={`flex-1 py-2 text-base rounded-t-lg transition-colors ${
                          categoriaEmojiActiva === cat.id
                            ? "bg-indigo-50 border-b-2 border-indigo-600"
                            : "hover:bg-slate-50 opacity-60"
                        }`}
                      >
                        {cat.icono}
                      </button>
                    ))}
                  </div>

                  {/* Grid de la categoría activa */}
                  <div className="grid grid-cols-8 gap-1 p-3 max-h-64 overflow-y-auto">
                    {EMOJI_CATEGORIES.find((c) => c.id === categoriaEmojiActiva)?.emojis.map((e) => (
                      <button
                        key={e}
                        onClick={() => {
                          setTexto((prev) => prev + e);
                          setEmojiAbierto(false);
                        }}
                        className="text-xl hover:bg-slate-100 rounded p-1"
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setEmojiAbierto((v) => !v)}
                  className="p-2.5 rounded-full text-slate-400 hover:bg-slate-100 hover:text-indigo-600 transition-colors shrink-0"
                >
                  <Smile size={20} />
                </button>


                <button
                onClick={() => setStickersAbierto((v) => !v)}
                title="Stickers"
                className="p-2.5 rounded-full text-slate-400 hover:bg-slate-100 hover:text-indigo-600 transition-colors shrink-0 text-lg leading-none"
              >
                🎨
              </button>

                <input
                  type="text"
                  value={texto}
                  onChange={(e) => manejarCambioTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      enviarMensaje();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setUsuarioActivo(null);
                      setMensajes([]);
                      setTexto("");
                      setEmojiAbierto(false);
                    }
                  }}
                  placeholder="Escribe un mensaje..."
                  className="flex-1 px-4 py-3 rounded-full border border-slate-300 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />

                  <button
                  onClick={() => enviarMensaje()}
                  disabled={!texto.trim() || enviando}
                  className="p-3 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-40 shrink-0"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}