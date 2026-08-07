"use client";

import { useState } from "react";
import { PieChart, Maximize2, Minimize2, RefreshCw } from "lucide-react";

// Reemplaza esta URL por el link de "Publicar en la Web" de tu reporte
// de Power BI (en Power BI Service: Archivo -> Publicar en la Web).
// Tiene esta forma: https://app.powerbi.com/view?r=XXXXXXXXXXXXXXXXXXXXXXXX
const POWERBI_EMBED_URL = "https://app.powerbi.com/view?r=eyJrIjoiOTY3ZTg4MzEtZDVmZC00NWI0LWI2MmQtMzg4Yjk2MTk5ZWNlIiwidCI6ImVkMDkxNTIxLTI5YjQtNDZhNC1iNzcwLTczOWI1MWU4MGI0MyIsImMiOjR9&pageName=ReportSection199fa4b4acc258dd2b39";

export default function EquipoVentasBigData() {
  const [pantallaCompleta, setPantallaCompleta] = useState(false);
  const [recargarKey, setRecargarKey] = useState(0);

  return (
    <div className={pantallaCompleta ? "fixed inset-0 z-[500] bg-white flex flex-col p-4" : ""}>
      <div className="flex items-center justify-between px-1 py-2 mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0">
            <PieChart size={20} />
          </div>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)" }} className="text-xl font-bold text-slate-900">
              Equipo Ventas · Big Data
            </h1>
            <p className="text-sm text-slate-500">Reporte de Power BI publicado</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRecargarKey((k) => k + 1)}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors"
          >
            <RefreshCw size={13} /> Recargar
          </button>
          <button
            type="button"
            onClick={() => setPantallaCompleta((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 transition-colors"
          >
            {pantallaCompleta ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            {pantallaCompleta ? "Salir de pantalla completa" : "Pantalla completa"}
          </button>
        </div>
      </div>

      <div className={`bg-white border border-slate-200 rounded-2xl overflow-hidden ${pantallaCompleta ? "flex-1" : ""}`}>
        <iframe
          key={recargarKey}
          title="Reporte Power BI — Equipo Ventas"
          src={POWERBI_EMBED_URL}
          className={`w-full border-0 ${pantallaCompleta ? "h-full" : "h-[calc(100vh-220px)]"}`}
          allowFullScreen
        />
      </div>
    </div>
  );
}