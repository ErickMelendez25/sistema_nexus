"use client";

import {
  ChangeEvent,
  FormEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Building2,
  CalendarDays,
  CheckCircle2,
  Download,
  FilePlus2,
  FileSignature,
  FileText,
  Loader2,
  Paperclip,
  Receipt,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

interface CartaNotaDebitoProps {
  apiBase: string;
}

type Plantilla = "eco" | "multi";

interface FormularioCarta {
  plantilla: Plantilla;
  fecha: string;
  fec: string;
  num: string;
  area: string;
  entidad: string;
  ciudad: string;
  factura: string;
  fechafac: string;
  monto: string;
  montopenalidad: string;
  oc: string;
  ocam: string;
  sf: string;
  archivo: string;
}

interface RespuestaGeneracion {
  ok: boolean;
  archivo: string;
  // El backend (carta-nota.py) devuelve "url_descarga" (con guion bajo)
  // — antes el frontend esperaba "urldescarga" y nunca calzaba.
  url_descarga: string;
}

const FORMULARIOINICIAL: FormularioCarta = {
  plantilla: "eco",
  fecha: "",
  fec: "",
  num: "",
  area: "",
  entidad: "",
  ciudad: "",
  factura: "",
  fechafac: "",
  monto: "",
  montopenalidad: "",
  oc: "",
  ocam: "",
  sf: "",
  archivo: "",
};

function extraerMensajeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Ocurrió un error inesperado.";
}

function obtenerNombreSeguro(nombre: string): string {
  return nombre
    .trim()
    .replace(/\.pdf$/i, "")
    .replace(/[<>:"/\\|?\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ");
}

function formatearTamanio(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function unirUrl(base: string, ruta: string): string {
  if (/^https?:\/\//i.test(ruta)) {
    return ruta;
  }

  return `${base.replace(/\/+$/, "")}/${ruta.replace(/^\/+/, "")}`;
}

const CLASEINPUT =
  "mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm";

const CLASE_INPUT = CLASEINPUT; // solo para evitar algún error de referencia

function obtenerFechaActual(): string {
  const fecha = new Date();
  const zonaLocal = new Date(
    fecha.getTime() - fecha.getTimezoneOffset() * 60000,
  );

  return zonaLocal.toISOString().slice(0, 10);
}

export default function CartaNotaDebito({
  apiBase,
}: CartaNotaDebitoProps) {
  const [formulario, setFormulario] =
    useState<FormularioCarta>(FORMULARIOINICIAL);
  const [pdfsExtra, setPdfsExtra] = useState<File[]>([]);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] =
    useState<RespuestaGeneracion | null>(null);

  const inputArchivosRef = useRef<HTMLInputElement>(null);

  const nombreArchivoFinal = useMemo(() => {
    const nombre = obtenerNombreSeguro(formulario.archivo);
    return nombre ? `${nombre}.pdf` : "Sin nombre";
  }, [formulario.archivo]);

  const actualizarCampo = (
    campo: keyof FormularioCarta,
    valor: string,
  ) => {
    setFormulario((actual) => ({
      ...actual,
      [campo]: valor,
    }));

    if (error) {
      setError("");
    }

    if (resultado) {
      setResultado(null);
    }
  };

  const seleccionarPdfs = (evento: ChangeEvent<HTMLInputElement>) => {
    const seleccionados = Array.from(evento.target.files ?? []);
    const invalidos = seleccionados.filter(
      (archivo) =>
        archivo.type !== "application/pdf" &&
        !archivo.name.toLowerCase().endsWith(".pdf"),
    );

    if (invalidos.length > 0) {
      setError("Solo se permiten archivos PDF como anexos.");
      evento.target.value = "";
      return;
    }

    setPdfsExtra((actuales) => {
      const combinados = [...actuales];

      for (const archivo of seleccionados) {
        const yaExiste = combinados.some(
          (existente) =>
            existente.name === archivo.name &&
            existente.size === archivo.size &&
            existente.lastModified === archivo.lastModified,
        );

        if (!yaExiste) {
          combinados.push(archivo);
        }
      }

      return combinados;
    });

    setError("");
    setResultado(null);
    evento.target.value = "";
  };

  const eliminarPdf = (indice: number) => {
    setPdfsExtra((actuales) =>
      actuales.filter((_archivo, posicion) => posicion !== indice),
    );
    setResultado(null);
  };

  // ---- Reordenar anexos con flechas ↑ ↓ — mismo patrón que
  // DocParaPago.tsx (moverPdf), en vez del drag-and-drop nativo. ----
  const moverPdf = (indice: number, direccion: -1 | 1) => {
    setPdfsExtra((actuales) => {
      const copia = [...actuales];
      const destino = indice + direccion;
      if (destino < 0 || destino >= copia.length) return copia;
      [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
      return copia;
    });
    setResultado(null);
  };

  const limpiarFormulario = () => {
    setFormulario(FORMULARIOINICIAL);
    setPdfsExtra([]);
    setError("");
    setResultado(null);

    if (inputArchivosRef.current) {
      inputArchivosRef.current.value = "";
    }
  };

  const colocarFechaActual = () => {
    const hoy = obtenerFechaActual();

    setFormulario((actual) => ({
      ...actual,
      fecha: hoy,
      fec: hoy,
    }));

    setResultado(null);
    setError("");
  };

  const generarCarta = async (evento: FormEvent<HTMLFormElement>) => {
    evento.preventDefault();

    const nombreArchivo = obtenerNombreSeguro(formulario.archivo);

    if (!nombreArchivo) {
      setError("Ingresa un nombre válido para el archivo.");
      return;
    }

    if (!/^\d+$/.test(formulario.num.trim())) {
      setError("El número de carta debe contener únicamente números.");
      return;
    }

    setGenerando(true);
    setError("");
    setResultado(null);

    try {
      const datos = new FormData();

      datos.append("plantilla", formulario.plantilla);
      datos.append("fecha", formulario.fecha.trim());
      datos.append("fec", formulario.fec.trim());
      datos.append("num", formulario.num.trim());
      datos.append("area", formulario.area.trim());
      datos.append("entidad", formulario.entidad.trim());
      datos.append("ciudad", formulario.ciudad.trim());
      datos.append("factura", formulario.factura.trim());

      // El backend espera FECHAFAC tal como llega (dd/mm/aaaa), sin
      // formatear. El input date devuelve yyyy-mm-dd, así que aquí se
      // convierte explícitamente antes de enviarlo.
      const [anioFactura, mesFactura, diaFactura] =
        formulario.fechafac.split("-");

      const fechaFactura =
        anioFactura && mesFactura && diaFactura
          ? `${diaFactura}/${mesFactura}/${anioFactura}`
          : formulario.fechafac.trim();

      datos.append("fechafac", fechaFactura);
      datos.append("monto", formulario.monto.trim());
      datos.append(
        "montopenalidad",
        formulario.montopenalidad.trim(),
      );
      datos.append("oc", formulario.oc.trim());
      datos.append("ocam", formulario.ocam.trim());
      datos.append("sf", formulario.sf.trim());
      datos.append("archivo", nombreArchivo);

      // OJO: el backend (carta-nota.py) declara el Form/File como
      // "pdfs_extra" (con guion bajo) — antes se mandaba "pdfsextra" y
      // FastAPI nunca lo habría emparejado, así que los anexos jamás
      // llegaban al backend.
      for (const pdf of pdfsExtra) {
        datos.append("pdfs_extra", pdf);
      }

      const respuesta = await fetch(
        unirUrl(apiBase, "/cobranzas/carta-nota/generar"),
        {
          method: "POST",
          body: datos,
          credentials: "include",
        },
      );

      let cuerpo: unknown;

      try {
        cuerpo = await respuesta.json();
      } catch {
        cuerpo = null;
      }

      if (!respuesta.ok) {
        let mensaje = "No se pudo generar la carta nota débito.";

        if (
          cuerpo &&
          typeof cuerpo === "object" &&
          "detail" in cuerpo
        ) {
          const detalle = (
            cuerpo as {
              detail?: string | Array<{ msg?: string }>;
            }
          ).detail;

          if (typeof detalle === "string") {
            mensaje = detalle;
          } else if (Array.isArray(detalle)) {
            mensaje = detalle
              .map((item) => item.msg)
              .filter(Boolean)
              .join(". ");
          }
        }

        throw new Error(mensaje);
      }

      // OJO: el backend devuelve "url_descarga" (con guion bajo), no
      // "urldescarga" — antes esta comprobación nunca era verdadera.
      if (
        !cuerpo ||
        typeof cuerpo !== "object" ||
        !("url_descarga" in cuerpo)
      ) {
        throw new Error(
          "El servidor respondió, pero no devolvió la URL de descarga.",
        );
      }

      setResultado(cuerpo as RespuestaGeneracion);
    } catch (err) {
      setError(extraerMensajeError(err));
    } finally {
      setGenerando(false);
    }
  };

  const descargarResultado = () => {
    if (!resultado) {
      return;
    }

    const url = unirUrl(apiBase, resultado.url_descarga);
    const enlace = document.createElement("a");

    enlace.href = url;
    enlace.download = resultado.archivo;
    enlace.target = "_blank";
    enlace.rel = "noopener noreferrer";

    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
  };

  return (
    <main className="h-screen flex flex-col overflow-hidden bg-slate-50">
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col overflow-hidden px-4 py-3 sm:px-6 lg:px-8">
        {/* ================= Header compacto ================= */}
        <header className="mb-3 flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-indigo-600">
              <Receipt size={13} />
              Cobranzas
            </div>

            <h1
              className="flex items-center gap-2 text-lg font-bold text-slate-900"
              style={{ fontFamily: "var(--font-display)" }}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm">
                <FileSignature size={16} />
              </span>
              Carta nota débito
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={colocarFechaActual}
              disabled={generando}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CalendarDays size={14} />
              Fecha actual
            </button>

            <button
              type="button"
              onClick={limpiarFormulario}
              disabled={generando}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw size={14} />
              Limpiar
            </button>
          </div>
        </header>

        {/* Error/éxito: solo ocupan espacio cuando existen, así no
            empujan el layout en el caso normal. */}
        {error && (
          <div
            role="alert"
            className="mb-2 flex shrink-0 items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800"
          >
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-red-500" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">No se pudo completar la operación</p>
              <p className="mt-0.5 whitespace-pre-line">{error}</p>
            </div>
            <button
              type="button"
              onClick={() => setError("")}
              className="rounded-md p-1 text-red-500 transition-colors hover:bg-red-100"
              aria-label="Cerrar mensaje"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {resultado && (
          <div className="mb-2 flex shrink-0 flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-emerald-600" />
              <div>
                <p className="text-sm font-semibold text-emerald-900">Carta generada correctamente</p>
                <p className="text-xs text-emerald-700">{resultado.archivo}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={descargarResultado}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
            >
              <Download size={14} />
              Descargar PDF
            </button>
          </div>
        )}

        {/* ================= Formulario — todo en una pantalla ================= */}
        <form onSubmit={generarCarta} className="min-h-0 flex-1">
          <div className="grid h-full min-h-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
            {/* ---- Columna izquierda: datos, en una sola tarjeta densa ---- */}
            <div className="min-h-0 overflow-y-auto pr-1">
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-4 py-2.5">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Building2 size={15} className="text-indigo-600" />
                    Datos de la carta
                  </h2>
                </div>

                <div className="space-y-4 p-4">
                  {/* Empresa — toggle compacto en vez de tarjetas grandes */}
                  <div>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-700">Empresa</span>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          { id: "eco", label: "Grupo EcoLimp", plantilla: "cobra2.docx" },
                          { id: "multi", label: "Ecolimp", plantilla: "cobra1.docx" },
                        ] as { id: Plantilla; label: string; plantilla: string }[]
                      ).map((opt) => (
                        <label
                          key={opt.id}
                          className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all ${
                            formulario.plantilla === opt.id
                              ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <input
                            type="radio"
                            name="plantilla"
                            value={opt.id}
                            checked={formulario.plantilla === opt.id}
                            onChange={() => actualizarCampo("plantilla", opt.id)}
                            className="sr-only"
                          />
                          <span
                            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
                              formulario.plantilla === opt.id ? "border-indigo-600" : "border-slate-300"
                            }`}
                          >
                            {formulario.plantilla === opt.id && (
                              <span className="h-1.5 w-1.5 rounded-full bg-indigo-600" />
                            )}
                          </span>
                          <span className="font-semibold text-slate-800">{opt.label}</span>
                          <span className="ml-auto text-[10px] text-slate-400">{opt.plantilla}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Todos los campos en una sola grilla densa */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    <Campo id="fecha" label="Fecha de carta" required>
                      <input
                        id="fecha"
                        type="date"
                        required
                        value={formulario.fecha}
                        onChange={(e) => actualizarCampo("fecha", e.target.value)}
                        className={CLASEINPUT}
                      />
                    </Campo>

                    <Campo id="fec" label="Fecha secundaria" required>
                      <input
                        id="fec"
                        type="date"
                        required
                        value={formulario.fec}
                        onChange={(e) => actualizarCampo("fec", e.target.value)}
                        className={CLASEINPUT}
                      />
                    </Campo>

                    <Campo id="num" label="Número de carta" required>
                      <input
                        id="num"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]+"
                        required
                        placeholder="Ej. 125"
                        value={formulario.num}
                        onChange={(e) => actualizarCampo("num", e.target.value.replace(/\D/g, ""))}
                        className={CLASEINPUT}
                      />
                    </Campo>

                    <Campo id="area" label="Área" required>
                      <input
                        id="area"
                        type="text"
                        required
                        placeholder="Ej. Tesorería"
                        value={formulario.area}
                        onChange={(e) => actualizarCampo("area", e.target.value)}
                        className={CLASEINPUT}
                      />
                    </Campo>

                    <Campo id="entidad" label="Entidad" required>
                      <input
                        id="entidad"
                        type="text"
                        required
                        placeholder="Nombre de la entidad"
                        value={formulario.entidad}
                        onChange={(e) => actualizarCampo("entidad", e.target.value)}
                        className={CLASEINPUT}
                      />
                    </Campo>

                    <Campo id="ciudad" label="Ciudad" required>
                      <input
                        id="ciudad"
                        type="text"
                        required
                        placeholder="Ej. Lima"
                        value={formulario.ciudad}
                        onChange={(e) => actualizarCampo("ciudad", e.target.value)}
                        className={CLASEINPUT}
                      />
                    </Campo>

                    <Campo id="factura" label="Factura" required>
                      <input
                        id="factura"
                        type="text"
                        required
                        placeholder="Ej. F001-000125"
                        value={formulario.factura}
                        onChange={(e) => actualizarCampo("factura", e.target.value)}
                        className={CLASEINPUT}
                      />
                    </Campo>

                    <Campo id="fechafac" label="Fecha de factura" required>
                      <input
                        id="fechafac"
                        type="date"
                        required
                        value={formulario.fechafac}
                        onChange={(e) => actualizarCampo("fechafac", e.target.value)}
                        className={CLASEINPUT}
                      />
                    </Campo>

                    <Campo id="monto" label="Monto" required>
                      <input
                        id="monto"
                        type="text"
                        inputMode="decimal"
                        required
                        placeholder="Ej. S/ 10,500.00"
                        value={formulario.monto}
                        onChange={(e) => actualizarCampo("monto", e.target.value)}
                        className={CLASEINPUT}
                      />
                    </Campo>

                    <Campo id="montopenalidad" label="Monto de penalidad" required>
                      <input
                        id="montopenalidad"
                        type="text"
                        inputMode="decimal"
                        required
                        placeholder="Ej. S/ 525.00"
                        value={formulario.montopenalidad}
                        onChange={(e) => actualizarCampo("montopenalidad", e.target.value)}
                        className={CLASEINPUT}
                      />
                    </Campo>

                    <Campo id="oc" label="Orden de compra" required>
                      <input
                        id="oc"
                        type="text"
                        required
                        placeholder="Número de orden"
                        value={formulario.oc}
                        onChange={(e) => actualizarCampo("oc", e.target.value)}
                        className={CLASEINPUT}
                      />
                    </Campo>

                    <Campo id="ocam" label="Orden de compra AM" ayuda="Opcional">
                      <input
                        id="ocam"
                        type="text"
                        placeholder="Número de orden AM"
                        value={formulario.ocam}
                        onChange={(e) => actualizarCampo("ocam", e.target.value)}
                        className={CLASEINPUT}
                      />
                    </Campo>

                    <Campo id="sf" label="S/F" required>
                      <input
                        id="sf"
                        type="text"
                        required
                        placeholder="Referencia S/F"
                        value={formulario.sf}
                        onChange={(e) => actualizarCampo("sf", e.target.value)}
                        className={CLASEINPUT}
                      />
                    </Campo>

                    <div className="col-span-2 sm:col-span-3 lg:col-span-4">
                      <Campo id="archivo" label="Nombre del archivo" ayuda="Sin extensión .pdf" required>
                        <input
                          id="archivo"
                          type="text"
                          required
                          placeholder="Ej. Cartanotadebito125"
                          value={formulario.archivo}
                          onChange={(e) => actualizarCampo("archivo", e.target.value)}
                          className={CLASE_INPUT}
                        />
                      </Campo>
                    </div>
                  </div>
                </div>
              </section>
            </div>

            {/* ---- Columna derecha: anexos + resumen + submit ---- */}
            <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pl-1">
              <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="shrink-0 border-b border-slate-100 px-4 py-2.5">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Paperclip size={15} className="text-indigo-600" />
                    Anexos PDF
                  </h2>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Se unen después de la carta principal, en el orden mostrado.
                  </p>
                </div>

                <div className="flex min-h-0 flex-1 flex-col p-3">
                  <input
                    ref={inputArchivosRef}
                    type="file"
                    accept=".pdf,application/pdf"
                    multiple
                    onChange={seleccionarPdfs}
                    className="hidden"
                  />

                  <button
                    type="button"
                    onClick={() => inputArchivosRef.current?.click()}
                    disabled={generando}
                    className="group flex w-full shrink-0 flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-center transition-colors hover:border-indigo-400 hover:bg-indigo-50/50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="mb-1.5 flex h-8 w-8 items-center justify-center rounded-full bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200 group-hover:ring-indigo-200">
                      <UploadCloud size={16} />
                    </span>
                    <span className="text-xs font-semibold text-slate-800">Seleccionar PDF</span>
                  </button>

                  {pdfsExtra.length > 0 && (
                    <div className="mt-3 flex min-h-0 flex-1 flex-col">
                      <div className="mb-1.5 flex shrink-0 items-center justify-between">
                        <p className="text-xs font-semibold text-slate-700">
                          {pdfsExtra.length} {pdfsExtra.length === 1 ? "archivo" : "archivos"}
                        </p>
                        <button
                          type="button"
                          onClick={() => setPdfsExtra([])}
                          disabled={generando}
                          className="text-[11px] font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          Eliminar todos
                        </button>
                      </div>

                      {/* Único punto con scroll interno propio — así, aunque
                          haya muchos anexos, no obliga a hacer scroll en toda
                          la página, solo dentro de esta lista. */}
                      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
                        {pdfsExtra.map((archivo, indice) => (
                          <div
                            key={`${archivo.name}-${archivo.size}-${archivo.lastModified}`}
                            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2"
                          >
                            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">
                              {indice + 1}
                            </span>
                            <FilePlus2 size={16} className="shrink-0 text-red-600" />
                            <div className="flex min-w-0 flex-grow flex-col overflow-hidden">
                              <p className="truncate text-xs font-medium text-slate-900">{archivo.name}</p>
                              <p className="text-[10px] text-slate-500">{formatearTamanio(archivo.size)}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => moverPdf(indice, -1)}
                                disabled={generando || indice === 0}
                                title="Subir"
                                className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                              >
                                <ArrowUp size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => moverPdf(indice, 1)}
                                disabled={generando || indice === pdfsExtra.length - 1}
                                title="Bajar"
                                className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                              >
                                <ArrowDown size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => eliminarPdf(indice)}
                                disabled={generando}
                                className="flex h-6 w-6 items-center justify-center rounded text-red-500 transition-colors hover:bg-red-100 disabled:opacity-50"
                                aria-label={`Eliminar archivo ${archivo.name}`}
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Resumen — compacto, no crece */}
              <section className="shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="space-y-1.5 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">Empresa</span>
                    <span className="font-medium text-slate-800">
                      {formulario.plantilla === "eco" ? "Grupo EcoLimp" : "Ecolimp"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">Archivo final</span>
                    <span className="truncate font-medium text-slate-800" title={nombreArchivoFinal}>
                      {nombreArchivoFinal}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">Anexos PDF</span>
                    <span className="font-medium text-slate-800">{pdfsExtra.length}</span>
                  </div>
                </div>
              </section>

              <button
                type="submit"
                disabled={generando}
                className="flex w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {generando ? <Loader2 size={17} className="animate-spin" /> : <FileSignature size={17} />}
                {generando ? "Generando carta..." : "Generar carta"}
              </button>
            </aside>
          </div>
        </form>
      </div>
    </main>
  );
}

function Campo({
  id,
  label,
  ayuda,
  required = false,
  children,
}: {
  id: string;
  label: string;
  ayuda?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-slate-700">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {ayuda && <p className="text-[10px] text-slate-400">{ayuda}</p>}
      {children}
    </div>
  );
}