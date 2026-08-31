"use client";

import { useState, useEffect, ReactNode } from "react";
import CumpleanosWidget from "./CumpleanosWidget";
import {
  ShieldCheck, ChevronsLeft, ChevronsRight, Menu, X, LogOut,
  Bell, LogIn, Loader2, CheckCircle2, Wifi, WifiOff, FileScan,
  ChevronDown, Receipt, FileText, FileSignature,
  Briefcase, PieChart, Mail,
  LucideIcon,
} from "lucide-react";

export interface SidebarTab {
  id: string;
  label: string;
  labelCorta: string;
  icon: LucideIcon;
}

// Igual que AvatarUsuario de ChatPanel.tsx — cae a un círculo con la
// inicial del nombre si no hay foto O si la foto guardada ya no existe
// en el servidor (archivo borrado). Antes, sin el onError, una foto con
// ruta guardada pero archivo inexistente se quedaba mostrando el ícono
// de imagen rota del navegador en vez de las iniciales.
function AvatarSidebar({
  fotoPerfil,
  iniciales,
  apiBase,
}: {
  fotoPerfil: string | null;
  iniciales: string;
  apiBase: string;
}) {
  const [error, setError] = useState(false);

  if (!fotoPerfil || error) {
    return (
      <span style={{ fontFamily: "var(--font-display)" }} className="text-[11px] font-semibold text-indigo-300">
        {iniciales}
      </span>
    );
  }

  return (
    <img
      src={`${apiBase}/archivos/${fotoPerfil}`}
      alt="Perfil"
      className="w-full h-full object-cover"
      onError={() => setError(true)}
    />
  );
}

interface UsuarioPeru {
  uid: string;
  label: string;
}

interface UsuarioEstado {
  label: string;
  autenticado: boolean;
  estado: string;
}

interface SidebarProps {
  tabs: SidebarTab[];
  tabActivo: string;
  onCambiarTab: (id: string) => void;

  nombreUsuario: string;
  rol: string;
  fotoPerfil: string | null;
  apiBase: string;
  onAbrirPerfil: () => void;
  onCerrarSesion: () => void;

  noLeidas: number;
  onTogglePanelNotis: () => void;
  panelNotificaciones: ReactNode; // el dropdown completo lo arma page.tsx
  noLeidasChat?: number;

  puedeUsarPeruCompras: boolean;
  usuariosPeru: UsuarioPeru[];
  estadosPeru: Record<string, UsuarioEstado>;
  uidViendo: string;
  onCambiarUid: (uid: string) => void;
  onLoginPeru: (uid: string) => void;
  cargandoPeru: boolean;

  sesionErp: boolean;
  cargandoErp: boolean;
  onLoginErp: () => void;

  wsConectado: boolean;
  onCrearOrden: () => void;
/** Oculta el botón hamburguesa flotante en mobile — se usa cuando
   * hay una conversación de chat abierta y su propio botón "atrás"
   * ya cumple esa función, para no tener dos botones compitiendo por
   * el mismo espacio. */
  ocultarHamburguesaMovil?: boolean;
  /** Notifica al padre cada vez que cambia el estado colapsado/expandido
   * del sidebar (72px vs 256px) — page.tsx lo necesita para calcular la
   * posición del panel de notificaciones, que vive fuera de este archivo. */
  onColapsadoChange?: (colapsado: boolean) => void;
}
export default function Sidebar({
  tabs,
  tabActivo,
  onCambiarTab,
  nombreUsuario,
  rol,
  fotoPerfil,
  apiBase,
  onAbrirPerfil,
  onCerrarSesion,
  noLeidas,
  onTogglePanelNotis,
  panelNotificaciones,
  noLeidasChat = 0,
  puedeUsarPeruCompras,
  usuariosPeru,
  estadosPeru,
  uidViendo,
  onCambiarUid,
  onLoginPeru,
  cargandoPeru,
  sesionErp,
  cargandoErp,
  onLoginErp,
  wsConectado,
  onCrearOrden,
  ocultarHamburguesaMovil = false,
  onColapsadoChange,
}: SidebarProps) {
  const [colapsado, setColapsado] = useState(false);
  const [abiertoMovil, setAbiertoMovil] = useState(false);

  // page.tsx no tiene forma de saber si el sidebar está colapsado (ese
  // estado vive solo acá) — este efecto le avisa cada vez que cambia,
  // para que el panel de notificaciones pueda pegarse al borde correcto.
  useEffect(() => {
    onColapsadoChange?.(colapsado);
  }, [colapsado, onColapsadoChange]);


  const [modalCerrarSesion, setModalCerrarSesion] = useState(false);
  const [cerrandoSesion, setCerrandoSesion] = useState(false);

  // NUEVO: control del grupo desplegable "Cobranzas"
// NUEVO: control del grupo desplegable "Cobranzas"
  const [cobranzasAbierto, setCobranzasAbierto] = useState(
    tabActivo === "cobranzas-doc-pago" || tabActivo === "cobranzas-carta-nota"
  );

  // NUEVO: control del grupo desplegable "Equipo Ventas"
  const [equipoVentasAbierto, setEquipoVentasAbierto] = useState(
    tabActivo === "equipo-ventas-operaciones" || tabActivo === "equipo-ventas-bigdata"
  );

const esCobranzas = rol === "cobranzas";
const esAdmin = rol === "admin";
const esPracticante = rol === "practicante";
const esSeguimiento = rol === "seguimiento";
const esContabilidad = rol === "contabilidad";

  const iniciales =
    nombreUsuario
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "?";

  const peruActivo = estadosPeru[uidViendo]?.autenticado ?? false;
  const estadoPeruViendo = estadosPeru[uidViendo]?.estado;
  // Solo "cargando" es un reintento automático EN CURSO por el backend.
  // "perdida" significa que el backend YA agotó sus reintentos, cerró
  // Chrome y limpió el perfil (mismo concepto que "fallo" en
  // esperarAutenticado de EquipoVentasOperaciones.tsx) — desde ahí hace
  // falta que el usuario vuelva a loguearse manualmente, así que ya NO
  // debe quedarse en el loader infinito.
  const reconectandoPeru = estadoPeruViendo === "cargando";
  const sesionPerdida = estadoPeruViendo === "perdida";




  const manejarConfirmarCierre = async () => {
    setCerrandoSesion(true);
    // Delay mínimo para que el loader se sienta intencional y no un parpadeo,
    // aunque onCerrarSesion resuelva casi instantáneo.
    await Promise.all([
      Promise.resolve(onCerrarSesion()),
      new Promise((r) => setTimeout(r, 700)),
    ]);
    setCerrandoSesion(false);
    setModalCerrarSesion(false);
  };

  const contenidoSidebar = (
    <div
      className={`flex flex-col h-full bg-[#10172A] text-slate-200 transition-all duration-200 ${
        colapsado ? "w-[72px]" : "w-64"
      }`}
    >
      {/* Marca + colapsar */}
      <div className="flex items-center justify-between h-16 px-4 border-b border-white/10 shrink-0 bg-white">
        <div className={`flex items-center overflow-hidden ${colapsado ? "justify-center w-full" : "gap-2"}`}>
          <img
            src="/logo-rpc.png"
            alt="Grupo RPC"
            width={colapsado ? 32 : 120}
            height={32}
            style={{ objectFit: "contain", display: "block" }}
            className="shrink-0"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
        <button
          onClick={() => setColapsado((v) => !v)}
          className="hidden md:flex p-1.5 rounded-md hover:bg-slate-100 text-slate-500 hover:text-[#1B2A4E] transition-colors shrink-0"
          aria-label="Colapsar menú"
        >
          {colapsado ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
        </button>
        <button
          onClick={() => setAbiertoMovil(false)}
          className="md:hidden p-1.5 rounded-md hover:bg-white/10 text-slate-300"
          aria-label="Cerrar menú"
        >
          <X size={18} />
        </button>
      </div>

      {/* Estado de sesiones — SIEMPRE visible, arriba de todo */}
      <div className="px-3 py-3 border-b border-white/10 space-y-2 shrink-0">
        {puedeUsarPeruCompras && (
          <div>
            {!colapsado && (
              <p style={{ fontFamily: "var(--font-mono)" }} className="text-[10px] text-slate-500 uppercase tracking-wide px-1 mb-1">
                Perú Compras
              </p>
            )}
            <div className="flex items-center gap-1.5">
              {!colapsado && (
                <select
                  value={uidViendo}
                  onChange={(e) => onCambiarUid(e.target.value)}
                  style={{ fontFamily: "var(--font-mono)" }}
                  className={`flex-1 min-w-0 text-[11px] font-semibold border rounded-md pl-2 pr-1 py-1.5 bg-white/5 focus:outline-none focus:ring-1 focus:ring-indigo-400 transition-colors ${
                    peruActivo
                      ? "border-emerald-400/30 text-emerald-400"
                      : reconectandoPeru
                      ? "border-amber-400/30 text-amber-400"
                      : "border-white/10 text-slate-200"
                  }`}
                >
                  {usuariosPeru.map((u) => {
                    const est = estadosPeru[u.uid];
                    // Dentro de <option> solo un punto con color inline
                    // funciona de forma confiable entre navegadores.
                    const color = est?.autenticado
                      ? "#34d399"
                      : est?.estado === "perdida" || est?.estado === "cargando"
                      ? "#fbbf24"
                      : "#64748b";
                    return (
                      <option
                        key={u.uid}
                        value={u.uid}
                        style={{ color }}
                        className="bg-white text-slate-900"
                      >
                        ● {u.label}
                      </option>
                    );
                  })}
                </select>
              )}

              {peruActivo ? (
                <span
                  className={`flex items-center justify-center rounded-md shrink-0 ${
                    colapsado ? "w-full h-8" : "w-7 h-7"
                  }`}
                  title="Perú Compras conectado"
                >
                  <CheckCircle2 size={14} className="text-emerald-400" />
                </span>
              ) : reconectandoPeru ? (
                <span
                  className={`flex items-center justify-center rounded-md shrink-0 ${
                    colapsado ? "w-full h-8" : "w-7 h-7"
                  }`}
                  title="Reconectando con Perú Compras..."
                >
                  <Loader2 size={14} className="animate-spin text-amber-400" />
                </span>
              ) : (
                <button
                  onClick={() => onLoginPeru(uidViendo)}
                  disabled={cargandoPeru || !uidViendo}
                  title={sesionPerdida ? "Sesión perdida — clic para iniciar sesión de nuevo" : "Iniciar sesión Perú Compras"}
                  className={`flex items-center justify-center gap-1.5 rounded-md text-[11px] font-medium transition-colors disabled:opacity-50 shrink-0 ${
                    sesionPerdida
                      ? "bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-400/20"
                      : "bg-white/10 hover:bg-white/20 text-white"
                  } ${colapsado ? "w-full h-8" : "px-2.5 py-1.5"}`}
                >
                  {cargandoPeru ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
                  {!colapsado && "Entrar"}
                </button>
              )}
            </div>
          </div>
        )}

        <div>
          {sesionErp ? (
            <div className={`flex items-center gap-1.5 text-emerald-400 text-[11px] font-medium ${colapsado ? "justify-center" : "px-1"}`}>
              <CheckCircle2 size={14} />
              {!colapsado && "ERP conectado"}
            </div>
          ) : (
            <button
              onClick={onLoginErp}
              disabled={cargandoErp}
              title="Iniciar sesión ERP"
              className={`flex items-center justify-center gap-1.5 rounded-md text-[11px] font-medium bg-white/10 hover:bg-white/20 text-white transition-colors disabled:opacity-50 w-full ${
                colapsado ? "h-8" : "px-2.5 py-1.5"
              }`}
            >
              {cargandoErp ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
              {!colapsado && "Iniciar sesión · ERP"}
            </button>
          )}
        </div>

        <div style={{ fontFamily: "var(--font-mono)" }} className={`flex items-center gap-1.5 text-[10px] text-slate-500 ${colapsado ? "justify-center" : "px-1"}`}>
          {wsConectado ? <Wifi size={12} className="text-emerald-400" /> : <WifiOff size={12} />}
          {!colapsado && (wsConectado ? "en línea" : "reconectando")}
        </div>
      </div>

      {/* Crear orden */}
      {!esContabilidad && (
        <div className="px-3 py-3 border-b border-white/10 shrink-0">
          <button
            onClick={onCrearOrden}
            title="Crear orden"
            className={`flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold bg-[#3B5BFF] text-white hover:bg-[#2f49d6] transition-colors w-full ${
              colapsado ? "h-9" : "py-2"
            }`}
          >
            <FileScan size={14} />
            {!colapsado && "Crear orden"}
          </button>
        </div>
      )}

            {/* Notificaciones */}
      <div className="px-2 py-2 border-t border-white/10 relative shrink-0">
        <button
          onClick={onTogglePanelNotis}
          title="Notificaciones"
          className={`flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-[13px] font-medium text-slate-300 hover:bg-white/10 hover:text-white transition-colors relative ${
            colapsado ? "justify-center" : ""
          }`}
        >
          <span className="relative shrink-0">
            <Bell size={17} />
            {noLeidas > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-1 flex items-center justify-center rounded-full bg-[#4F46E5] text-white text-[8px] font-semibold">
                {noLeidas > 9 ? "9+" : noLeidas}
              </span>
            )}
          </span>
          {!colapsado && "Notificaciones"}
        </button>
        {/* El dropdown real (contenido) lo pasa page.tsx por prop */}
        {panelNotificaciones}
      </div>

      {/* Cumpleaños — módulo con alerta por WebSocket */}
      <CumpleanosWidget apiBase={apiBase} colapsado={colapsado} />

      {/* Navegación (tabs) */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => { onCambiarTab(t.id); setAbiertoMovil(false); }}
            title={t.label}
            className={`flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors relative ${
              tabActivo === t.id
                ? "bg-gradient-to-r from-[#C9A227]/25 to-[#C9A227]/10 text-white border-l-[3px] border-l-[#C9A227] border-y border-y-white/5 border-r-0 shadow-[0_0_12px_-2px_rgba(201,162,39,0.35)]"
                : "text-slate-300 hover:bg-white/10 hover:text-white"
            } ${colapsado ? "justify-center" : ""}`}
          >
            <span className="relative shrink-0">
              <t.icon size={17} strokeWidth={2} className={tabActivo === t.id ? "text-[#C9A227]" : ""} />
              {/* El badge de no leídos del chat se oculta mientras el
                  usuario YA está parado en el tab de chat — el total
                  "desaparece" al entrar, pero los no leídos por
                  conversación individual (dentro de ChatPanel) se
                  mantienen hasta que se abre esa conversación puntual. */}
              {t.id === "chat" && noLeidasChat > 0 && tabActivo !== "chat" && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 px-1 flex items-center justify-center rounded-full bg-emerald-500 text-white text-[8px] font-semibold">
                  {noLeidasChat > 9 ? "9+" : noLeidasChat}
                </span>
              )}
            </span>
            {!colapsado && <span className="truncate">{t.label}</span>}
          </button>
        ))}

        {/* Grupo: Cobranzas (DOC PARA PAGO / CARTA NOTA DÉBITO) */}
              {(esCobranzas || esAdmin) && (
      <div className="pt-1">
          <button
            onClick={() => setCobranzasAbierto((v) => !v)}
            title="Cobranzas"
            className={`flex items-center w-full rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors text-slate-300 hover:bg-white/10 hover:text-white ${
              colapsado ? "justify-center" : "justify-between"
            }`}
          >
            <span className="flex items-center gap-3">
              <Receipt size={17} strokeWidth={2} className="shrink-0" />
              {!colapsado && <span className="truncate">Cobranzas</span>}
            </span>
            {!colapsado && (
              <ChevronDown
                size={14}
                className={`shrink-0 transition-transform duration-200 ${cobranzasAbierto ? "rotate-180" : ""}`}
              />
            )}
          </button>

          {(cobranzasAbierto || colapsado) && (
            <div className={`mt-1 space-y-1 ${colapsado ? "" : "ml-4 border-l border-white/10 pl-2"}`}>
              <button
                onClick={() => { onCambiarTab("cobranzas-doc-pago"); setAbiertoMovil(false); }}
                title="Doc para pago"
                className={`flex items-center gap-3 w-full rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors ${
                  tabActivo === "cobranzas-doc-pago"
                    ? "bg-gradient-to-r from-[#C9A227]/25 to-[#C9A227]/10 text-white border-l-[3px] border-l-[#C9A227] border-y border-y-white/5 border-r-0 shadow-[0_0_12px_-2px_rgba(201,162,39,0.35)]"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                } ${colapsado ? "justify-center" : ""}`}
              >
                <FileText size={15} strokeWidth={2} className={`shrink-0 ${tabActivo === "cobranzas-doc-pago" ? "text-[#C9A227]" : ""}`} />
                {!colapsado && <span className="truncate">Doc para pago</span>}
              </button>

                <button
                onClick={() => { onCambiarTab("cobranzas-carta-nota"); setAbiertoMovil(false); }}
                title="Carta nota débito"
                className={`flex items-center gap-3 w-full rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors ${
                  tabActivo === "cobranzas-carta-nota"
                    ? "bg-gradient-to-r from-[#C9A227]/25 to-[#C9A227]/10 text-white border-l-[3px] border-l-[#C9A227] border-y border-y-white/5 border-r-0 shadow-[0_0_12px_-2px_rgba(201,162,39,0.35)]"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                } ${colapsado ? "justify-center" : ""}`}
              >
                <FileSignature size={15} strokeWidth={2} className={`shrink-0 ${tabActivo === "cobranzas-carta-nota" ? "text-[#C9A227]" : ""}`} />
                {!colapsado && <span className="truncate">Carta nota débito</span>}
              </button>
            </div>
          )}
        </div>

        )}

        {/* Grupo: Equipo Ventas (Operaciones / Big Data) — fijo, visible
            para cualquier rol, igual que el grupo Cobranzas de arriba. */}
      {!esCobranzas && !esSeguimiento && !esContabilidad && ( 
      <div className="pt-1">
          <button
            onClick={() => setEquipoVentasAbierto((v) => !v)}
            title="Equipo Ventas"
   
            className={`flex items-center w-full rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors text-slate-300 hover:bg-white/10 hover:text-white ${
              colapsado ? "justify-center" : "justify-between"
            }`}
          >
            <span className="flex items-center gap-3">
              <Briefcase size={17} strokeWidth={2} className="shrink-0" />
              {!colapsado && <span className="truncate">Equipo Ventas</span>}
            </span>
            {!colapsado && (
              <ChevronDown
                size={14}
                className={`shrink-0 transition-transform duration-200 ${equipoVentasAbierto ? "rotate-180" : ""}`}
              />
            )}
          </button>

          {(equipoVentasAbierto || colapsado) && (
            <div className={`mt-1 space-y-1 ${colapsado ? "" : "ml-4 border-l border-white/10 pl-2"}`}>
              <button
                onClick={() => { onCambiarTab("equipo-ventas-operaciones"); setAbiertoMovil(false); }}
                title="Operaciones"
                className={`flex items-center gap-3 w-full rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors ${
                  tabActivo === "equipo-ventas-operaciones"
                    ? "bg-gradient-to-r from-[#C9A227]/25 to-[#C9A227]/10 text-white border-l-[3px] border-l-[#C9A227] border-y border-y-white/5 border-r-0 shadow-[0_0_12px_-2px_rgba(201,162,39,0.35)]"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                } ${colapsado ? "justify-center" : ""}`}
              >
                <Briefcase size={15} strokeWidth={2} className={`shrink-0 ${tabActivo === "equipo-ventas-operaciones" ? "text-[#C9A227]" : ""}`} />
                {!colapsado && <span className="truncate">Operaciones</span>}
              </button>

              {!esPracticante && (
                <button
                  onClick={() => { onCambiarTab("equipo-ventas-bigdata"); setAbiertoMovil(false); }}
                  title="Big Data"
                  className={`flex items-center gap-3 w-full rounded-lg px-3 py-2 text-[12.5px] font-medium transition-colors ${
                    tabActivo === "equipo-ventas-bigdata"
                      ? "bg-gradient-to-r from-[#C9A227]/25 to-[#C9A227]/10 text-white border-l-[3px] border-l-[#C9A227] border-y border-y-white/5 border-r-0 shadow-[0_0_12px_-2px_rgba(201,162,39,0.35)]"
                      : "text-slate-300 hover:bg-white/10 hover:text-white"
                  } ${colapsado ? "justify-center" : ""}`}
                >
                  <PieChart size={15} strokeWidth={2} className={`shrink-0 ${tabActivo === "equipo-ventas-bigdata" ? "text-[#C9A227]" : ""}`} />
                  {!colapsado && <span className="truncate">Big Data</span>}
                </button>
              )}
            </div>
          )}
        </div>
        )}
      </nav>



      {/* Perfil + salir */}
      <div className="border-t border-white/10 p-3 shrink-0">
        <button
          onClick={onAbrirPerfil}
          className={`flex items-center gap-2.5 w-full rounded-lg px-2 py-2 hover:bg-white/5 transition-colors ${
            colapsado ? "justify-center" : ""
          }`}
        >
        <div className="w-8 h-8 rounded-full bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center shrink-0 overflow-hidden">
          <AvatarSidebar fotoPerfil={fotoPerfil} iniciales={iniciales} apiBase={apiBase} />
        </div>
          {!colapsado && (
            <div className="leading-tight text-left min-w-0">
              <p className="text-xs font-semibold text-white truncate">{nombreUsuario}</p>
              <p className="text-[10px] text-slate-400 capitalize">{rol}</p>
            </div>
          )}
        </button>
          <button
          onClick={() => setModalCerrarSesion(true)}
          title="Cerrar sesión"
          className={`flex items-center gap-2 w-full mt-1 rounded-lg px-2 py-2 text-[11px] font-medium text-slate-300 hover:text-red-400 hover:bg-red-500/10 transition-colors ${
            colapsado ? "justify-center" : ""
          }`}
        >
          <LogOut size={14} />
          {!colapsado && "Cerrar sesión"}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Botón hamburguesa flotante — solo móvil. Se oculta cuando hay
          una conversación de chat abierta (su botón "atrás" ya cubre
          esa función y evita el choque visual de dos botones juntos). */}
      {!ocultarHamburguesaMovil && (
        <button
          onClick={() => setAbiertoMovil(true)}
          className="md:hidden fixed top-3 left-3 z-40 p-2.5 rounded-lg bg-[#10172A] text-white shadow-lg"
          aria-label="Abrir menú"
        >
          <Menu size={18} />
        </button>
      )}

      {/* Sidebar desktop — fija */}
      <aside className="hidden md:block fixed top-0 left-0 h-screen z-30">
        {contenidoSidebar}
      </aside>

      {/* Spacer para que el contenido no quede debajo de la sidebar fija */}
      <div className={`hidden md:block shrink-0 transition-all duration-200 ${colapsado ? "w-[72px]" : "w-64"}`} />

      {/* Sidebar móvil — overlay */}
      {abiertoMovil && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setAbiertoMovil(false)} />
          <div className="absolute top-0 left-0 h-full">{contenidoSidebar}</div>
        </div>
      )}



      
 {/* Modal confirmación cerrar sesión */}
      {modalCerrarSesion && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm"
            onClick={() => !cerrandoSesion && setModalCerrarSesion(false)}
          />
          <div className="relative w-full max-w-sm bg-[#10172A] border border-white/10 rounded-2xl shadow-2xl p-6 animate-[fadeIn_0.15s_ease-out]">
            <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
              <LogOut size={20} className="text-red-400" />
            </div>
            <h3 style={{ fontFamily: "var(--font-display)" }} className="text-base font-semibold text-white mb-1.5">
              ¿Cerrar sesión?
            </h3>
            <p className="text-[13px] text-slate-400 leading-relaxed mb-6">
              Vas a salir de tu cuenta en Nexus RPC. Tendrás que iniciar sesión de nuevo para continuar.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setModalCerrarSesion(false)}
                disabled={cerrandoSesion}
                className="flex-1 py-2.5 rounded-lg text-[13px] font-medium text-slate-300 bg-white/5 hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={manejarConfirmarCierre}
                disabled={cerrandoSesion}
                className="flex-1 py-2.5 rounded-lg text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-70 flex items-center justify-center gap-2"
              >
                {cerrandoSesion ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Cerrando...
                  </>
                ) : (
                  "Sí, cerrar sesión"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}