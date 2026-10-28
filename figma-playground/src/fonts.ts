// Fuentes de Figma que no están en este equipo. figspec respeta la fuente del diseño (no agrega una
// genérica de respaldo): si falta, el navegador usa la suya y el componente se ve distinto, así que
// solo se avisa. Misma comprobación que el visualizador (viewer-client.js: fontFamilies, fontInstalled).

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong", "inherit", "initial", "unset", "revert"]);

// Fuentes que nombra el CSS (sin las genéricas), en orden de aparición
export function fontFamilies(cssList: string[]): string[] {
  const out: string[] = [];
  for (const css of cssList)
    for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/g))
      for (const raw of m[1].split(",")) {
        const name = raw.trim().replace(/^["']|["']$/g, "").replace(/\s*!important$/, "");
        if (name && !GENERIC.has(name.toLowerCase()) && !name.startsWith("var(") && !out.includes(name)) out.push(name);
      }
  return out;
}

// Una fuente está instalada (o cargada con @font-face) si cambia el ancho de un texto respecto de
// las genéricas
export async function missingFonts(cssList: string[]): Promise<string[]> {
  await document.fonts.ready;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return [];
  const measure = (font: string) => {
    ctx.font = font;
    return ctx.measureText("mmmmmmmmmmlli1WQ@#ñ").width;
  };
  return fontFamilies(cssList).filter(
    (f) => !["monospace", "serif", "sans-serif"].some((g) => measure(`72px "${f}", ${g}`) !== measure(`72px ${g}`)),
  );
}
