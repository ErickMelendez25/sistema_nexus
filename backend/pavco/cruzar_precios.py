"""
Cruza precios: toma el precio de primer_excel.xlsx y lo pone en segundo_excel.xlsx
cuando la DESCRIPCION (columna G) coincide en TODAS las características.
La marca / Nro. de parte NO se comparan.

Uso (PowerShell):
    python cruzar_precios.py
    python cruzar_precios.py "C:\\otra\\ruta"

Requiere: pip install openpyxl
"""
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill

# ---------------- CONFIG ----------------
CARPETA = Path(r"C:\Users\MSICROSS\Downloads\PAVCO")
ARCHIVO_1 = "primer_excel.xlsx"          # con precios
ARCHIVO_2 = "segundo_excel.xlsx"         # sin precios (precio = 0)
ARCHIVO_SALIDA = "segundo_excel_con_precios.xlsx"

FILA_ENCABEZADO = 9
FILA_INICIO = 10
COL_CODIGO = 6    # F  Código Ficha-Producto
COL_DESC = 7      # G  Descripción
COL_MARCA = 8     # H  Marca
COL_NRO_PARTE = 9  # I  Nro.Parte
COL_PRECIO = 13   # M  Precio Referencial

# Características que se comparan (después de la categoría).
# Si quieres que COLOR también cuente, agrégalo aquí.
CLAVES_COMPARAR = [
    "MATERIAL", "TIPO", "DIAMETRO NOMINAL", "ESPESOR", "LONGITUD",
    "RIGIDEZ NOMINAL", "PRESION NOMINAL", "EMPALME",
]
# Claves que se reconocen al leer la descripción (aunque no se comparen)
CLAVES_CONOCIDAS = CLAVES_COMPARAR + ["COLOR", "UNIDAD G.F."]
# ----------------------------------------


def sin_tildes(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def norm_valor(v: str) -> str:
    """Normaliza un valor: mayúsculas, sin tildes, números canónicos, espacios."""
    v = sin_tildes(v).upper().strip()
    v = re.sub(r"(?<=\d),(?=\d)", ".", v)               # 3,2 -> 3.2
    v = re.sub(r"(\d)([A-Z])", r"\1 \2", v)             # 6m -> 6 m
    v = re.sub(r"\d+(?:\.\d+)?",
               lambda m: format(float(m.group()), "g"), v)  # 6.0 -> 6
    v = re.sub(r"\s+", " ", v)
    return v.strip(" ,;.")


_claves_ordenadas = sorted(CLAVES_CONOCIDAS, key=len, reverse=True)
_RE_CLAVES = re.compile(
    r"(?<![A-Z0-9])(" + "|".join(re.escape(k) for k in _claves_ordenadas) + r")\s*:"
)


def parsear(desc) -> dict:
    """'CATEGORIA : MATERIAL: PVC-U TIPO: ...' -> {'CATEGORIA':..., 'MATERIAL':..., ...}"""
    if not desc:
        return {}
    t = sin_tildes(str(desc)).upper()
    t = re.sub(r"\s+", " ", t)
    marcas = list(_RE_CLAVES.finditer(t))
    if not marcas:
        return {}
    res = {"CATEGORIA": norm_valor(t[: marcas[0].start()].replace(":", ""))}
    for i, m in enumerate(marcas):
        fin = marcas[i + 1].start() if i + 1 < len(marcas) else len(t)
        res[m.group(1)] = norm_valor(t[m.end():fin])
    return res


def firma(attrs: dict) -> tuple:
    return tuple([attrs.get("CATEGORIA", "")] + [attrs.get(k, "") for k in CLAVES_COMPARAR])


def diferencias(a: dict, b: dict) -> list:
    out = []
    for k in ["CATEGORIA"] + CLAVES_COMPARAR:
        if a.get(k, "") != b.get(k, ""):
            out.append(f"{k}: '{a.get(k, '')}' vs '{b.get(k, '')}'")
    return out


def a_float(x):
    try:
        return float(str(x).replace(",", ".").strip())
    except (ValueError, TypeError):
        return 0.0


def main():
    carpeta = Path(sys.argv[1]) if len(sys.argv) > 1 else CARPETA
    ruta1, ruta2, ruta_out = carpeta / ARCHIVO_1, carpeta / ARCHIVO_2, carpeta / ARCHIVO_SALIDA

    print(f"Leyendo {ruta1} ...")
    ws1 = load_workbook(ruta1, data_only=True).active
    print(f"Leyendo {ruta2} ...")
    wb2 = load_workbook(ruta2)
    ws2 = wb2.active

    # ---- 1) Indexar el primer excel por firma de características ----
    indice = defaultdict(list)   # firma -> [ {codigo, desc, marca, parte, precio, attrs} ]
    sin_parsear_1 = 0
    for r in range(FILA_INICIO, ws1.max_row + 1):
        desc = ws1.cell(r, COL_DESC).value
        precio = a_float(ws1.cell(r, COL_PRECIO).value)
        if not desc or precio <= 0:
            continue
        attrs = parsear(desc)
        if len(attrs) < 3:
            sin_parsear_1 += 1
            continue
        indice[firma(attrs)].append({
            "codigo": ws1.cell(r, COL_CODIGO).value,
            "desc": desc,
            "marca": ws1.cell(r, COL_MARCA).value,
            "parte": ws1.cell(r, COL_NRO_PARTE).value,
            "precio": precio,
            "attrs": attrs,
        })
    total_1 = sum(len(v) for v in indice.values())
    print(f"Primer excel: {total_1} productos con precio ({sin_parsear_1} no se pudieron leer)")

    # Índice auxiliar para sugerencias (misma categoría + mismo diámetro)
    por_diametro = defaultdict(list)
    for lst in indice.values():
        for p in lst:
            por_diametro[(p["attrs"].get("CATEGORIA", ""), p["attrs"].get("DIAMETRO NOMINAL", ""))].append(p)

    # ---- 2) Columnas nuevas al costado ----
    c0 = ws2.max_column + 1
    nuevas = ["Código origen (precio)", "Marca origen", "Nro.Parte origen",
              "Descripción origen", "Estado cruce", "Observación"]
    for i, h in enumerate(nuevas):
        c = ws2.cell(FILA_ENCABEZADO, c0 + i, h)
        c.font = Font(bold=True)
    verde = PatternFill("solid", fgColor="C6EFCE")
    amarillo = PatternFill("solid", fgColor="FFEB9C")
    rojo = PatternFill("solid", fgColor="FFC7CE")

    # ---- 3) Recorrer el segundo excel ----
    ok = multi = sin = ya_tenia = 0
    for r in range(FILA_INICIO, ws2.max_row + 1):
        desc = ws2.cell(r, COL_DESC).value
        if not desc:
            continue
        if a_float(ws2.cell(r, COL_PRECIO).value) > 0:
            ya_tenia += 1
            ws2.cell(r, c0 + 4, "YA TENÍA PRECIO")
            continue

        attrs = parsear(desc)
        cands = indice.get(firma(attrs), []) if len(attrs) >= 3 else []

        if cands:
            marca2 = sin_tildes(str(ws2.cell(r, COL_MARCA).value or "")).upper().strip()
            misma_marca = [p for p in cands if sin_tildes(str(p["marca"] or "")).upper().strip() == marca2]
            elegido = min(misma_marca or cands, key=lambda p: p["precio"])
            ws2.cell(r, COL_PRECIO).value = elegido["precio"]
            ws2.cell(r, c0, elegido["codigo"])
            ws2.cell(r, c0 + 1, elegido["marca"])
            ws2.cell(r, c0 + 2, elegido["parte"])
            ws2.cell(r, c0 + 3, elegido["desc"])
            precios = sorted({p["precio"] for p in cands})
            if len(precios) > 1 and not misma_marca:
                multi += 1
                ws2.cell(r, c0 + 4, "COINCIDE (VARIAS OPCIONES)").fill = amarillo
                ws2.cell(r, c0 + 5,
                         "Hay %d productos con las mismas características y precios distintos %s; "
                         "se puso el MÁS BAJO. Códigos: %s" %
                         (len(cands), precios, ", ".join(str(p["codigo"]) for p in cands)))
            else:
                ok += 1
                ws2.cell(r, c0 + 4, "COINCIDE").fill = verde
                if misma_marca:
                    ws2.cell(r, c0 + 5, "Misma marca")
        else:
            sin += 1
            ws2.cell(r, c0 + 4, "SIN COINCIDENCIA").fill = rojo
            # sugerir el más parecido (misma categoría y diámetro)
            pool = por_diametro.get((attrs.get("CATEGORIA", ""), attrs.get("DIAMETRO NOMINAL", "")), [])
            mejor, mejor_dif = None, None
            for p in pool:
                d = diferencias(attrs, p["attrs"])
                if mejor_dif is None or len(d) < len(mejor_dif):
                    mejor, mejor_dif = p, d
            if mejor:
                ws2.cell(r, c0 + 5,
                         f"Más parecido: código {mejor['codigo']} (S/ {mejor['precio']}) | "
                         f"Difiere en: " + " ; ".join(mejor_dif))
            else:
                ws2.cell(r, c0 + 5, "No hay productos con ese diámetro en el primer excel")

    for i, w in enumerate([22, 20, 22, 70, 28, 90]):
        ws2.column_dimensions[ws2.cell(1, c0 + i).column_letter].width = w

    wb2.save(ruta_out)
    print("\n===== RESULTADO =====")
    print(f"COINCIDE exacto           : {ok}")
    print(f"COINCIDE (varias opciones): {multi}")
    print(f"SIN COINCIDENCIA          : {sin}")
    print(f"Ya tenían precio          : {ya_tenia}")
    print(f"\nArchivo generado: {ruta_out}")


if __name__ == "__main__":
    main()