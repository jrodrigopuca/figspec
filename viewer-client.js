"use strict";
/**
 * figspec — visualizador, parte del navegador. viewer.js lo inserta en viewer.html junto con
 * spec.js (variable global figspecSpec) y los datos de la salida. Las funciones sin DOM se
 * exportan para probarlas con node --test.
 */

// spec.js: en el navegador lo inserta viewer.js como figspecSpec; en Node se importa
const spec = typeof figspecSpec !== "undefined" ? figspecSpec : require("./spec");

const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

// ---------------------------------------------------------------- datos
// Motivo por el que no se puede mostrar, o null
function checkData(data) {
	if (!data || !data.spec || !data.spec.component) return "El archivo no trae la especificación del componente.";
	const format = data.spec.meta && data.spec.meta.format;
	if (format !== 1)
		return `La especificación tiene el formato ${format === undefined ? "anterior a meta.format" : format} y este visualizador entiende el 1. Vuelve a generarlo con el extractor (node viewer.js <carpeta>).`;
	return null;
}

// ---------------------------------------------------------------- CSS
// Clase del componente dentro del visualizador: todos los componentes comparten un Shadow DOM,
// así que cada .root lleva el nombre de su componente (Card__root, NavItem__root)
function prefixClass(comp, cls) {
	return `${comp}__${cls}`;
}

// Prefija las clases de los selectores de un .module.css; no toca valores ni textos entre
// comillas ([data-size="1.5x"]). Dentro de @media/@supports sigue prefijando; otros @ (p. ej.
// @font-face, @keyframes) quedan tal cual.
function prefixCss(css, comp) {
	let out = "";
	let buf = "";
	const stack = [];
	for (let i = 0; i < css.length; ) {
		const ch = css[i];
		if (ch === "/" && css[i + 1] === "*") {
			const j = css.indexOf("*/", i + 2);
			const end = j < 0 ? css.length : j + 2;
			buf += css.slice(i, end);
			i = end;
		} else if (ch === '"' || ch === "'") {
			let j = i + 1;
			while (j < css.length && css[j] !== ch) j += css[j] === "\\" ? 2 : 1;
			buf += css.slice(i, j + 1);
			i = j + 1;
		} else if (ch === "{") {
			const inRules = !stack.length || stack[stack.length - 1] === "rules";
			const head = buf.replace(/\/\*[\s\S]*?\*\//g, "").trim();
			const kind = !inRules ? "raw" : /^@(media|supports|container|layer)\b/.test(head) ? "rules" : head.startsWith("@") ? "raw" : "decls";
			out += (kind === "decls" ? prefixSelector(buf, comp) : buf) + "{";
			buf = "";
			stack.push(kind);
			i++;
		} else if (ch === "}") {
			out += buf + "}";
			buf = "";
			stack.pop();
			i++;
		} else {
			buf += ch;
			i++;
		}
	}
	return out + buf;
}

function prefixSelector(sel, comp) {
	return sel.replace(
		/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\/\*[\s\S]*?\*\/)|\.(-?[A-Za-z_][\w-]*)/g,
		(m, keep, cls) => (keep ? keep : `.${prefixClass(comp, cls)}`),
	);
}

// tokens.css define las variables en :root; dentro del Shadow DOM van en :host
function hostTokens(css) {
	return (css || "").replace(/:root\b/g, ":host");
}

// url("asset:<ruta>") → el archivo embebido; si falta, sin imagen (la lista de faltantes avisa)
function resolveAssets(css, assets) {
	return css.replace(/url\("asset:([^"]+)"\)/g, (m, rel) => (assets[rel] ? `url("${assets[rel].url}")` : "none"));
}

// Base del Shadow DOM: sin herencia de la interfaz (como una página en blanco) y con el
// box-sizing que asume el extractor (ver meta.notes)
const SHADOW_BASE = ":host { all: initial; display: block; }\n*, *::before, *::after { box-sizing: border-box; }";

// CSS completo del Shadow DOM: base, tokens y cada componente con sus clases prefijadas
function shadowCss(data) {
	const parts = [SHADOW_BASE, hostTokens(data.tokens)];
	for (const [comp, css] of Object.entries(data.css || {})) parts.push(resolveAssets(prefixCss(css, comp), data.assets || {}));
	return parts.join("\n");
}

// ---------------------------------------------------------------- fuentes
const GENERIC_FONTS = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji", "fangsong", "inherit", "initial", "unset", "revert"]);

// Fuentes que nombra el CSS de los componentes (sin las genéricas), en orden de aparición
function fontFamilies(cssList) {
	const out = [];
	for (const css of cssList)
		for (const m of (css || "").matchAll(/font-family\s*:\s*([^;}]+)/g))
			for (const raw of m[1].split(",")) {
				const name = raw.trim().replace(/^["']|["']$/g, "").replace(/\s*!important$/, "");
				if (name && !GENERIC_FONTS.has(name.toLowerCase()) && !name.startsWith("var(") && !out.includes(name)) out.push(name);
			}
	return out;
}

// Una fuente está instalada si cambia el ancho de un texto respecto de las genéricas de respaldo.
// measure(font) devuelve el ancho del texto de prueba con ese valor de font (canvas en el navegador).
function fontInstalled(measure, name) {
	return ["monospace", "serif", "sans-serif"].some((g) => measure(`72px "${name}", ${g}`) !== measure(`72px ${g}`));
}

function missingFonts(doc, cssList) {
	const ctx = doc.createElement("canvas").getContext && doc.createElement("canvas").getContext("2d");
	if (!ctx) return [];
	const measure = (font) => {
		ctx.font = font;
		return ctx.measureText("mmmmmmmmmmlli1WQ@#ñ").width;
	};
	return fontFamilies(cssList).filter((f) => !fontInstalled(measure, f));
}

// ---------------------------------------------------------------- render
// Árbol virtual del componente con valores concretos de sus props, con la misma lógica que el
// JSX de react.js (spec.js): estructura por variante, textos y props por variante, visibilidad,
// instancias con su ubicación desde el padre, íconos e imágenes. Nodo:
//   { tag, attrs, children, svg?, comp, el }   (svg: el SVG del ícono, para insertarlo en línea)
// Los textos son strings. comp y el permiten volver a la especificación (árbol, inspector).
function renderTree(data, name, values) {
	const subs = data.spec.subcomponents || {};
	const assets = data.assets || {};
	const byName = (n) => (n === data.spec.component.name ? data.spec.component : subs[n]);

	function component(name, passed, placement) {
		const comp = byName(name);
		const v = { ...spec.propDefaults(comp) };
		// Como la desestructuración de React: una prop undefined toma el valor por defecto
		for (const [k, x] of Object.entries(passed || {})) if (x !== undefined) v[k] = x;
		const c = { comp, v, classes: spec.cssClasses(comp) };
		return element(spec.activeStructure(comp, v), c, true, placement);
	}

	const cls = (el, c) => (c.classes.has(el.className) ? prefixClass(c.comp.name, el.className) : null);
	const node = (tag, attrs, children, c, el, extra) => ({ tag, attrs, children: children || [], comp: c.comp.name, el, values: c.v, ...extra });

	function element(el, c, isRoot, placement) {
		if (!isRoot && el.bind && el.bind.visible && !c.v[el.bind.visible]) return null;
		if (el.bind && el.bind.swap) {
			const target = c.v[el.bind.swap];
			return typeof target === "string" && subs[target] ? component(target, {}) : null;
		}
		if (el.bind && el.bind.icon) {
			const file = c.v[el.bind.icon];
			return file && assets[file] && assets[file].svg ? icon(el, c, file) : null;
		}
		if (el.component) return instance(el, c);
		if (el.tag === "svg")
			return assets[el.src] && assets[el.src].svg
				? icon(el, c, el.src)
				: node("span", attrs({ class: cls(el, c), "data-figspec-missing": el.src || el.icon || "" }), [], c, el);
		if (el.tag === "img") {
			const a = assets[el.src];
			return node("img", attrs({ class: cls(el, c), src: a ? a.url : "", alt: "", "data-figspec-missing": a ? null : el.src || "" }), [], c, el);
		}
		return box(el, c, isRoot, placement);
	}

	function box(el, c, isRoot, placement) {
		const a = {};
		if (isRoot) {
			a.class = [c.classes.has("root") && prefixClass(c.comp.name, "root"), placement].filter(Boolean).join(" ");
			for (const [p, def] of Object.entries(c.comp.props || {}))
				if (def.type === "variant" && c.v[p] !== undefined && c.v[p] !== null) a[`data-${spec.kebab(p)}`] = String(c.v[p]);
			for (const { attr, prop, values } of c.comp.aria || []) {
				const val = spec.ariaValue(attr, values.some((x) => c.v[prop] === x));
				if (val !== undefined) a[attr] = String(val);
			}
		} else a.class = cls(el, c);
		const kids = [...text(el, c)];
		for (const child of el.children || []) {
			const k = element(child, c, false);
			if (k) kids.push(k);
		}
		return node(el.tag === "span" ? "span" : "div", attrs(a), kids, c, el);
	}

	// Contenido de un texto: prop enlazada, texto por variante, segmentos con estilo o literal
	function text(el, c) {
		if (el.bind && el.bind.text) {
			const x = c.v[el.bind.text];
			return typeof x === "string" || typeof x === "number" ? [String(x)] : [];
		}
		const cases = spec.textCases(c.comp, el);
		if (cases.length) return [String(spec.pickCase(cases, c.v, spec.baseText(el)))];
		if (el.segments)
			return el.segments.map((s) => (s.css ? node("span", { style: styleText(s.css) }, [s.text], c, el, { segment: true }) : s.text));
		return el.text !== undefined && el.text !== "" ? [el.text] : [];
	}

	function instance(el, c) {
		const sub = subs[el.component];
		if (!sub) return node("div", attrs({ class: cls(el, c), "data-figspec-external": el.component }), [], c, el);
		const passed = {};
		for (const [k, base] of Object.entries(el.props || {})) {
			const x = spec.pickCase(spec.propCases(c.comp, el, k), c.v, base);
			const val = propValue(x, ((sub.props || {})[k] || {}).type);
			if (val !== null) passed[k] = val;
		}
		const root = component(sub.name, passed, cls(el, c));
		root.instance = { el, parent: c.comp.name, parentValues: c.v };
		return root;
	}

	// Valor de una prop de instancia según su tipo; null si React no la pasaría
	function propValue(x, type) {
		if (x === null || x === undefined) return null;
		if (type === "boolean" || typeof x === "boolean") return x === true || x === "true";
		if (type === "icon") return typeof x === "string" && assets[x] && assets[x].svg ? x : null;
		if (type === "node" || type === "slot") return typeof x === "string" && subs[x] ? x : null;
		return String(x);
	}

	function icon(el, c, file) {
		return node("svg", attrs({ class: cls(el, c) }), [], c, el, { svg: assets[file].svg });
	}

	return component(name, values);
}

// Atributos sin los vacíos (null/undefined/false); class vacía se conserva como en React
function attrs(a) {
	const out = {};
	for (const [k, v] of Object.entries(a)) if (v !== null && v !== undefined && v !== false) out[k] = v;
	return out;
}

function styleText(css) {
	return Object.entries(css).map(([k, v]) => `${k}: ${v}`).join("; ");
}

// HTML del árbol (pruebas y comparación con React); el SVG va tal cual con la clase en la raíz
function toHtml(n) {
	if (typeof n === "string") return n.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	const a = Object.entries(n.attrs).map(([k, v]) => ` ${k}="${String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`).join("");
	if (n.svg) return svgWithAttrs(n.svg, n.attrs);
	if (n.tag === "img") return `<img${a}>`;
	return `<${n.tag}${a}>${n.children.map(toHtml).join("")}</${n.tag}>`;
}

function svgWithAttrs(svg, a) {
	const extra = Object.entries(a).map(([k, v]) => ` ${k}="${v}"`).join("");
	return svg.replace(/<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[\s\S]*?>/g, "").trim().replace(/<svg\b/, `<svg${extra}`);
}

// Árbol virtual → DOM (dentro del Shadow DOM). Cada elemento guarda su nodo virtual en
// nodes (Map elemento → nodo) para el árbol y el inspector.
function mount(doc, parent, n, nodes) {
	if (typeof n === "string") {
		parent.append(doc.createTextNode(n));
		return;
	}
	let el;
	if (n.svg) {
		const t = doc.createElement("template");
		t.innerHTML = svgWithAttrs(n.svg, n.attrs);
		el = t.content.firstElementChild;
	} else {
		el = doc.createElement(n.tag);
		for (const [k, v] of Object.entries(n.attrs)) el.setAttribute(k, v);
		for (const k of n.children) mount(doc, el, k, nodes);
	}
	if (!el) return;
	if (nodes) nodes.set(el, n);
	parent.append(el);
}

// ---------------------------------------------------------------- zoom
// Escala que hace entrar la caja en el lienzo (con margen), sin pasar de 8×
function fitZoom(box, area, margin = 32) {
	const w = Math.max(1, area.width - margin * 2);
	const h = Math.max(1, area.height - margin * 2);
	return Math.min(8, w / box.width, h / box.height);
}

function stepZoom(z, dir) {
	if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 1e-6) || ZOOM_STEPS[ZOOM_STEPS.length - 1];
	return [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) || ZOOM_STEPS[0];
}

// Tamaño del componente en píxeles CSS: el de la vista previa sin el sobrante (sombras) ni la escala
function previewBox(preview) {
	return { width: preview.width / preview.scale, height: preview.height / preview.scale };
}

// ---------------------------------------------------------------- árbol de capas
// Capas del render en el orden del dibujo. Cada capa: { id, node (nodo virtual), parent, children,
// depth, kind, inside (componente de la instancia que la contiene, o null) }. Una instancia es una
// sola capa (◆) con la estructura de su subcomponente adentro; los tramos de un texto con estilos
// distintos no son capas.
function treeModel(root) {
	const list = [];
	(function walk(n, parent, depth, inside) {
		// key: ruta de clases desde la raíz (con el orden entre hermanos de la misma clase); sirve
		// para conservar la selección y lo desplegado al cambiar de variante
		const cls = n.instance ? n.instance.el.className : n.el.className;
		const twin = parent ? parent.children.filter((c) => c.cls === cls).length : 0;
		const key = parent ? `${parent.key}/${cls}${twin ? `#${twin}` : ""}` : `${n.comp}`;
		const layer = { id: list.length, key, cls, node: n, parent, children: [], depth, kind: layerKind(n), inside };
		list.push(layer);
		if (parent) parent.children.push(layer);
		const within = n.instance ? n.comp : inside;
		for (const k of n.children) if (typeof k !== "string" && !k.segment) walk(k, layer, depth + 1, within);
	})(root, null, 0, null);
	return list;
}

function layerKind(n) {
	if (n.instance) return "instance";
	if (n.tag === "svg" || n.svg) return "icon";
	if (n.tag === "img") return "image";
	if (n.tag === "span") return "text";
	return "box";
}

const KIND_ICON = { box: "▢", text: "T", icon: "✦", image: "▣", instance: "◆" };

// Texto visible de una capa (los tramos con estilo incluidos)
function layerText(n) {
	return n.children.map((k) => (typeof k === "string" ? k : k.segment ? layerText(k) : "")).join("");
}

// Nombre de la capa en el árbol: con Código apagado, el de Figma (los textos, por su contenido);
// con Código, la clase (o el componente, en una instancia) y el nombre de Figma como secundario.
// tags: lo que la enlaza a una prop ({title}: texto de la prop; si {showDot}: visibilidad).
function treeLabel(layer, code) {
	const n = layer.node;
	const el = n.instance ? n.instance.el : n.el;
	const figma = el.name || "";
	const tags = [];
	if (el.bind && el.bind.text) tags.push(`{${el.bind.text}}`);
	if (el.bind && el.bind.visible) tags.push(`si {${el.bind.visible}}`);
	if (el.bind && el.bind.icon) tags.push(`{${el.bind.icon}}`);
	let main = figma;
	if (layer.kind === "text" && !(el.bind && el.bind.text)) main = layerText(n).replace(/\s+/g, " ").trim() || figma;
	let sub = n.instance ? n.comp : "";
	if (code) {
		sub = figma;
		main = n.instance ? `<${n.comp}>` : `.${el.className}`;
	}
	if (sub === main) sub = "";
	return { icon: KIND_ICON[layer.kind], main, sub, tags };
}

// Capa bajo un punto: la más profunda cuya caja lo contiene; entre iguales, la que se dibuja
// después (queda encima). items: [{ rect: { x, y, width, height }, depth }] en orden del dibujo.
function hitTest(items, point) {
	let best = -1;
	items.forEach((it, i) => {
		const r = it.rect;
		if (!r || r.width <= 0 || r.height <= 0) return;
		if (point.x < r.x || point.y < r.y || point.x > r.x + r.width || point.y > r.y + r.height) return;
		if (best < 0 || it.depth >= items[best].depth) best = i;
	});
	return best;
}

// ---------------------------------------------------------------- props
// Controles para las props de un componente: { name, type, control, options?, none? }
//   control: "select" (variantes, íconos, componentes), "check" (booleanos) o "text"
// Los íconos ofrecen los SVG de la salida; los intercambios de instancia, los subcomponentes.
function propControls(data, comp) {
	const icons = Object.keys(data.assets || {}).filter((f) => data.assets[f].svg).sort();
	const subs = Object.keys(data.spec.subcomponents || {}).filter((n) => n !== comp.name);
	const out = [];
	for (const [name, def] of Object.entries(comp.props || {})) {
		if (def.type === "variant")
			out.push(def.options && def.options.length ? { name, type: def.type, control: "select", options: def.options.map(String) } : { name, type: def.type, control: "text" });
		else if (def.type === "boolean") out.push({ name, type: def.type, control: "check" });
		else if (def.type === "string") out.push({ name, type: def.type, control: "text" });
		else if (def.type === "icon") out.push({ name, type: def.type, control: "select", options: icons, none: true });
		else if (def.type === "node" || def.type === "slot") out.push({ name, type: def.type, control: "select", options: subs, none: true });
	}
	return out;
}

// Margen alrededor de una variante al recortar la imagen de un set (px de Figma): deja ver sombras
const PREVIEW_MARGIN = 16;

// Qué parte de la vista previa corresponde a lo que se dibuja:
//   offset → dónde ubicar el render (píxeles de la imagen); null si la imagen no lo muestra
//   crop   → en un set, la parte de la imagen con esa variante (más un margen para sombras);
//            null = la imagen entera
//   exact  → la imagen muestra exactamente estos valores (si no, la comparación es aproximada)
//   reason → por qué no es exacta: "none" (sin vista previa), "component" (un subcomponente: no
//            tiene vista previa propia), "variant" (la imagen no tiene esta variante) o "props"
//            (textos u opciones distintos de los de Figma)
function previewFor(data, compName, values) {
	const p = data.spec.meta.preview;
	const root = data.spec.component;
	if (!p) return { offset: null, crop: null, exact: false, reason: "none" };
	if (compName !== root.name) return { offset: null, crop: null, exact: false, reason: "component" };
	const defaults = spec.propDefaults(root);
	const v = { ...defaults };
	for (const [k, x] of Object.entries(values || {})) if (x !== undefined) v[k] = x;
	const variantProps = Object.keys(root.props || {}).filter((k) => root.props[k].type === "variant");
	let offset = p.offset;
	let crop = null;
	if (p.variants) {
		const match = p.variants.find((x) => variantProps.every((k) => x.when[k] === undefined || String(x.when[k]) === String(v[k])));
		if (!match) return { offset: null, crop: null, exact: false, reason: "variant" };
		offset = match.offset;
		const m = PREVIEW_MARGIN * p.scale;
		const x = Math.max(0, match.offset.x - m);
		const y = Math.max(0, match.offset.y - m);
		crop = { x, y, width: Math.min(p.width, match.offset.x + match.width + m) - x, height: Math.min(p.height, match.offset.y + match.height + m) - y };
	} else if (variantProps.some((k) => String(v[k]) !== String(defaults[k]))) return { offset: null, crop: null, exact: false, reason: "variant" };
	const changed = Object.keys(root.props || {}).some((k) => root.props[k].type !== "variant" && v[k] !== defaults[k]);
	return { offset, crop, exact: !changed, reason: changed ? "props" : null };
}

// ---------------------------------------------------------------- desvíos de posición
// Diferencia en px a partir de la cual una capa se marca como corrida respecto de Figma
const DEVIATION_PX = 2;

// Cajas de Figma de lo que se dibuja: las de la variante con esos valores (solo el componente
// principal); null si no hay datos o no corresponden
function geometryFor(data, compName, values) {
	const g = data.geometry;
	const root = data.spec.component;
	if (!g || !g.variants || compName !== root.name) return null;
	const v = { ...spec.propDefaults(root) };
	for (const [k, x] of Object.entries(values || {})) if (x !== undefined) v[k] = x;
	const variantProps = Object.keys(root.props || {}).filter((k) => root.props[k].type === "variant");
	const match = g.variants.find((x) => variantProps.every((k) => x.when[k] === undefined || String(x.when[k]) === String(v[k])));
	return match ? match.boxes : null;
}

// Capas corridas: compara la caja medida en el render con la de Figma (ambas relativas a la
// esquina del componente). items: [{ layer, render: {x,y,width,height}, figma: [x,y,w,h] }].
// Devuelve las que superan el umbral, de mayor a menor diferencia, con { dx, dy, dw, dh, max }.
function deviations(items, threshold = DEVIATION_PX) {
	const out = [];
	for (const it of items) {
		if (!it.render || !it.figma) continue;
		const [x, y, w, hgt] = it.figma;
		const d = { dx: it.render.x - x, dy: it.render.y - y, dw: it.render.width - w, dh: it.render.height - hgt };
		const max = Math.max(...Object.values(d).map(Math.abs));
		if (max > threshold) out.push({ ...it, ...d, max });
	}
	return out.sort((a, b) => b.max - a.max);
}

// Texto corto de una diferencia: "x +3 · alto −12" (solo lo que supera el umbral)
function deviationText(d, threshold = DEVIATION_PX) {
	const fmt = (n) => `${n > 0 ? "+" : "−"}${Math.round(Math.abs(n) * 10) / 10}`;
	return [["x", d.dx], ["y", d.dy], ["ancho", d.dw], ["alto", d.dh]].filter(([, n]) => Math.abs(n) > threshold).map(([k, n]) => `${k} ${fmt(n)}`).join(" · ");
}

// ---------------------------------------------------------------- decisiones (renombrar)
// Clase que dará el extractor a un nombre (como classFor: camelCase, sin empezar con número, sin
// "root"); si ya está tomada, el extractor le agrega un número
function codeClass(name) {
	let c = spec.words(name).map((w, i) => (i ? w[0].toUpperCase() : w[0].toLowerCase()) + w.slice(1)).join("");
	if (!c) c = "el";
	if (/^[0-9]/.test(c)) c = "el" + c;
	return c === "root" ? "rootEl" : c;
}

// Nombre del componente en código (como codeName del extractor)
function codeComponent(name) {
	return spec.pascal(name) || "Componente";
}

// Lo ya aplicado (meta.decisions), en la forma v2: { root, layers: [...], states: [...] }. Las
// salidas anteriores lo guardaban como v1 ({ names: { root, byId, states } }).
function appliedDecisions(meta) {
	const d = meta.decisions;
	if (!d) return { root: null, layers: [], states: [] };
	if (d.version >= 2) return { root: d.root || null, layers: d.layers || [], states: d.states || [] };
	const n = d.names || {};
	const list = (o) => Object.entries(o || {}).map(([id, name]) => ({ id, name }));
	return { root: n.root ? { name: n.root } : null, layers: list(n.byId), states: list(n.states) };
}

// Nombre aplicado a una capa (o a la raíz, con id "root"); undefined si no hay
function appliedName(meta, id) {
	const a = appliedDecisions(meta);
	if (id === "root") return a.root && a.root.name ? a.root.name : undefined;
	const e = a.layers.find((x) => x.id === id && !x.orphan);
	return e && e.name ? e.name : undefined;
}

// Archivo de decisiones (v2) para el extractor: lo ya aplicado más los cambios nuevos. pending:
// { root?: nombre | null, byId: { id: nombre | null } }; null quita el nombre (queda registrado con
// su fecha, así un archivo viejo no lo repone). info(id) → { figma, path } de la capa, para que el
// extractor la reconozca aunque cambie el id. Se conserva lo que no encontró capa.
function decisionsDoc(meta, pending, info = () => ({}), now = new Date().toISOString()) {
	const a = appliedDecisions(meta);
	const strip = ({ orphan, ...x }) => x;
	const layers = new Map(a.layers.map((x) => [x.id, strip(x)]));
	for (const [id, v] of Object.entries(pending.byId || {})) {
		const i = info(id) || {};
		layers.set(id, { id, ...(i.figma ? { figma: i.figma } : {}), ...(i.path ? { path: i.path } : {}), name: v, at: now, origin: "viewer" });
	}
	let root = a.root ? strip(a.root) : null;
	if ("root" in pending) root = { name: pending.root, at: now, origin: "viewer" };
	return {
		figspec: "decisions",
		version: 2,
		origin: "viewer",
		savedAt: now,
		component: { id: (meta.source && meta.source.node) || null, ...(meta.decisions && meta.decisions.component && meta.decisions.component.figma ? { figma: meta.decisions.component.figma } : {}) },
		...(root ? { root } : {}),
		layers: [...layers.values()],
		states: a.states.map(strip),
		groups: [],
	};
}

// ---------------------------------------------------------------- inspector
// CSS de una capa tal como está en los .module.css, agrupado por origen:
//   base       → la regla de la clase (en un set, la de la variante por defecto)
//   variant    → cada regla de variantStyles que aplica con los valores actuales
//   placement  → en una instancia, su ubicación desde el padre (tamaño, flex, posición)
// Cada grupo: { origin, title, file, selector, decls: [[propiedad, valor]] }
function cssGroups(data, node) {
	const subs = data.spec.subcomponents || {};
	const byName = (n) => (n === data.spec.component.name ? data.spec.component : subs[n]);
	const out = [];
	const add = (comp, cls, values, origin, prefix) => {
		const inst = instanceClasses(comp);
		const base = (comp.styles || {})[cls];
		const sel = (attrs) => (cls === "root" ? `.root${attrs}` : attrs || inst.has(cls) ? `.root${attrs} .${cls}` : `.${cls}`);
		if (base && Object.keys(base).length)
			out.push({ origin, title: prefix || "Base", file: `${comp.name}.module.css`, selector: sel(""), decls: Object.entries(base) });
		for (const r of comp.variantStyles || []) {
			if (!r.styles[cls] || !spec.matches(r.when, values)) continue;
			const when = Object.entries(r.when).map(([k, v]) => `${k} = ${v}`).join(", ");
			const attrs = `:where(${Object.entries(r.when).map(([k, v]) => `[data-${spec.kebab(k)}="${String(v).replace(/"/g, '\\"')}"]`).join("")})`;
			out.push({ origin: origin === "base" ? "variant" : origin, title: `${prefix ? prefix + " · " : ""}Si ${when}`, file: `${comp.name}.module.css`, selector: sel(attrs), decls: Object.entries(r.styles[cls]) });
		}
	};
	add(byName(node.comp), node.el.className, node.values || {}, "base");
	if (node.instance) {
		const parent = byName(node.instance.parent);
		add(parent, node.instance.el.className, node.instance.parentValues || {}, "placement", `Ubicación desde ${parent.name}`);
	}
	return out;
}

// Clases de un componente que son instancias de otro: su regla es ".root .clase" (ver moduleCss)
function instanceClasses(comp) {
	const out = new Set();
	const walk = (el) => {
		if (el.component) out.add(el.className);
		(el.children || []).forEach(walk);
	};
	walk(comp.structure);
	for (const v of comp.variantStructures || []) walk(v.structure);
	return out;
}

// Un valor con tokens en partes: texto y { token, fallback } por cada var(--x, respaldo)
function valueParts(value) {
	const parts = [];
	const re = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g;
	let last = 0;
	for (const m of String(value).matchAll(re)) {
		if (m.index > last) parts.push(String(value).slice(last, m.index));
		parts.push({ token: m[1], fallback: m[2] !== undefined ? m[2].trim() : null });
		last = m.index + m[0].length;
	}
	if (last < String(value).length) parts.push(String(value).slice(last));
	return parts;
}

// Los grupos como CSS para copiar (con el archivo y el origen como comentario)
function cssText(groups) {
	return groups.map((g) => `/* ${g.file} · ${g.title} */\n${g.selector} {\n${g.decls.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}`).join("\n\n");
}

const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i;

// ---------------------------------------------------------------- comparación
// Modos del lienzo. Todos usan la misma escala y el mismo origen: el componente cae sobre la
// vista previa (meta.preview.offset); en "Lado a lado" el render va a la derecha.
const MODES = [
	{ id: "side", label: "Lado a lado", title: "Figma a la izquierda y el render a la derecha" },
	{ id: "overlay", label: "Superponer", title: "El render encima de Figma, con opacidad; mantén Espacio para alternar" },
	{ id: "diff", label: "Diferencia", title: "Lo que coincide se ve negro; lo distinto, en color" },
	{ id: "render", label: "Render", title: "Solo el componente generado" },
	{ id: "figma", label: "Figma", title: "Solo la vista previa exportada desde Figma" },
];
const SIDE_GAP = 24;
const MODE_KEY = "figspec.viewer.mode";
const CODE_KEY = "figspec.viewer.code";

// localStorage puede no existir o fallar (archivo local, modo privado): solo es una comodidad
function stored(key) {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}
function store(key, value) {
	try {
		localStorage.setItem(key, value);
	} catch {
		// no se recuerda
	}
}

// Qué se ve y dónde: tamaño del escenario y posición del panel del render
function modeLayout(mode, box) {
	const side = mode === "side";
	return {
		width: side ? box.width * 2 + SIDE_GAP : box.width,
		height: box.height,
		renderX: side ? box.width + SIDE_GAP : 0,
		figma: mode !== "render",
		render: mode !== "figma",
	};
}

// Modo inicial: el último usado si se puede; si no, lado a lado (o solo el render sin vista previa)
function initialMode(saved, hasPreview) {
	if (!hasPreview) return "render";
	return MODES.some((m) => m.id === saved) ? saved : "side";
}

// ---------------------------------------------------------------- interfaz
function boot(doc, data) {
	const app = doc.getElementById("app");
	const h = (tag, attrs, ...kids) => {
		const el = doc.createElement(tag);
		for (const [k, v] of Object.entries(attrs || {}))
			if (k === "text") el.textContent = v;
			else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
			else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
		for (const k of kids.flat(Infinity)) if (k) el.append(k);
		return el;
	};
	app.removeAttribute("aria-busy");
	const problem = checkData(data);
	if (problem) {
		app.replaceChildren(h("div", { class: "fv-error", role: "alert" }, h("h1", { text: "No se puede mostrar" }), h("p", { text: problem })));
		return;
	}

	const design = data.spec;
	const meta = design.meta;
	const rootName = design.component.name;
	const subs = design.subcomponents || {};
	const byName = (n) => (n === rootName ? design.component : subs[n]);
	let box = { width: 1, height: 1 };
	let zoom = 1;
	let mode = null;
	let preferred = null; // modo que eligió la persona (se vuelve a él cuando se puede comparar)
	let opacity = 0.5;
	// Qué se dibuja: un componente (la raíz o un subcomponente) con los valores elegidos
	const view = { comp: rootName, values: {} };
	let pv = previewFor(data, rootName, {});
	let figmaBoxes = null; // cajas de Figma de la variante que se ve (figma-geometry.json)
	let devs = []; // capas corridas respecto de Figma
	const devOf = new Map();

	// Escenario con dos paneles del mismo tamaño: la vista previa de Figma y el componente en su
	// Shadow DOM, en la posición que indica meta.preview.offset (la imagen puede incluir sombras)
	const stage = h("div", { class: "fv-stage" });
	const figmaPane = h("div", { class: "fv-pane fv-pane-figma" });
	const renderPane = h("div", { class: "fv-pane fv-pane-render" });
	const previewImg = data.preview
		? h("img", { class: "fv-preview", src: data.preview, alt: `Vista previa de ${design.component.figmaName} exportada desde Figma`, draggable: "false" })
		: null;
	if (previewImg) figmaPane.append(previewImg);
	stage.append(figmaPane, renderPane);
	const host = h("div", { class: "fv-render" });
	const shadow = host.attachShadow({ mode: "open" });
	const style = doc.createElement("style");
	style.textContent = shadowCss(data);
	shadow.append(style);
	renderPane.append(host);
	const nodes = new Map(); // elemento del render → nodo virtual
	let tree = null;
	let hostX = 0;
	let hostY = 0;

	// Capas: el árbol del panel izquierdo, con el elemento del render de cada una
	let layers = [];
	let elementOf = new Map();
	let selected = null;
	let hovered = null;
	let code = stored(CODE_KEY) === "1";
	// Desplegadas o plegadas por clave (sobrevive a los cambios de variante); por defecto se
	// despliega todo menos las instancias
	const openState = new Map();
	const isOpen = (l) => (openState.has(l.key) ? openState.get(l.key) : l.kind !== "instance" && !l.inside);
	// Un subcomponente suelto se dibuja como su primera instancia en la raíz: con su tamaño y con
	// los valores que recibe ahí (un ítem extraído no tiene texto por defecto)
	const instanceSize = {};
	const instanceValues = {};
	const baseValues = () => ({ ...(view.comp === rootName ? {} : instanceValues[view.comp] || {}) });

	// Caja de una capa en coordenadas del panel (sin zoom); el render está en host
	function rectOf(layer) {
		const el = elementOf.get(layer.node);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		const hr = host.getBoundingClientRect();
		return { x: (r.left - hr.left) / zoom + hostX, y: (r.top - hr.top) / zoom + hostY, width: r.width / zoom, height: r.height / zoom };
	}
	// Caja de Figma de una capa (relativa a la esquina del componente); solo las del componente
	// principal, no las internas de una instancia
	function figmaBoxOf(layer) {
		if (!figmaBoxes || !layer || layer.inside) return null;
		const el = layer.node.instance ? layer.node.instance.el : layer.node.el;
		return (el.id && figmaBoxes[el.id]) || null;
	}
	const marks = h("div", { class: "fv-marks", "aria-hidden": "true" });
	stage.append(marks);
	// El transform no cambia el espacio que ocupa: el contenedor toma el tamaño ya escalado para
	// que el lienzo se pueda desplazar con zoom alto
	const sizer = h("div", { class: "fv-sizer" }, stage);
	const canvas = h("section", { class: "fv-canvas", "aria-label": "Lienzo" }, sizer);
	const NO_COMPARE = {
		none: "Sin vista previa: exporta con el plugin con «Vista previa (PNG)» activado",
		component: "Este componente no tiene vista previa propia: usa «Ver en contexto»",
		variant: "La vista previa de Figma no incluye esta variante",
	};
	const modeButtons = {};
	const modeBar = h("div", { class: "fv-modes", role: "group", "aria-label": "Qué se muestra" },
		MODES.map((m) => (modeButtons[m.id] = h("button", { type: "button", title: m.title, onclick: () => setMode(m.id, true), text: m.label }))),
	);

	// Controles de cada modo, en una franja sobre el lienzo (no se escalan con el zoom)
	const slider = h("input", { type: "range", min: "0", max: "100", value: String(opacity * 100), "aria-label": "Opacidad del render",
		oninput: (e) => { opacity = e.target.valueAsNumber / 100; renderPane.style.opacity = String(opacity); sliderLabel.textContent = `${Math.round(opacity * 100)} %`; } });
	const sliderLabel = h("output", { text: `${Math.round(opacity * 100)} %` });
	const boost = h("input", { type: "checkbox", onchange: (e) => stage.classList.toggle("fv-boost", e.target.checked) });
	const modeTools = {
		side: [h("span", { text: "Izquierda: Figma · Derecha: render" })],
		overlay: [h("label", {}, "Render ", slider, " ", sliderLabel), h("span", { class: "fv-hint", text: "Mantén Espacio para alternar entre los dos" })],
		diff: [h("span", { text: "Negro: igual · Color: distinto" }), h("label", {}, boost, " Realzar diferencias sutiles")],
		render: [],
		figma: [],
	};
	const toolbar = h("div", { class: "fv-modebar", role: "toolbar", "aria-label": "Opciones del modo" });

	function setMode(m, user) {
		const before = mode && modeLayout(mode, box);
		mode = m;
		const l = modeLayout(m, box);
		stage.dataset.mode = m;
		figmaPane.hidden = !l.figma;
		renderPane.style.left = `${l.renderX}px`;
		renderPane.style.opacity = m === "overlay" ? String(opacity) : "";
		toolbar.replaceChildren(...modeTools[m]);
		toolbar.hidden = !modeTools[m].length;
		for (const [k, b] of Object.entries(modeButtons)) b.setAttribute("aria-pressed", String(k === m));
		if (user) {
			preferred = m;
			store(MODE_KEY, m);
		}
		// Lado a lado ocupa el doble: se vuelve a ajustar al cambiar de tamaño
		if (before && before.width !== l.width) fit();
		else if (before) setZoom(zoom);
	}
	const zoomLabel = h("output", { class: "fv-zoom", "aria-live": "polite" });
	const layoutBox = () => {
		const l = modeLayout(mode || "render", box);
		return { width: l.width, height: l.height };
	};
	const setZoom = (z) => {
		zoom = z;
		const b = layoutBox();
		for (const pane of [figmaPane, renderPane]) {
			pane.style.width = `${box.width}px`;
			pane.style.height = `${box.height}px`;
		}
		stage.style.width = `${b.width}px`;
		stage.style.height = `${b.height}px`;
		stage.style.transform = `scale(${z})`;
		sizer.style.width = `${b.width * z}px`;
		sizer.style.height = `${b.height * z}px`;
		stage.style.setProperty("--fv-z", String(z));
		zoomLabel.textContent = `${Math.round(z * 100)} %`;
		drawMarks();
	};
	const fit = () => setZoom(fitZoom(layoutBox(), canvas.getBoundingClientRect()));

	// Cajas de la capa señalada y la elegida, en los dos paneles (en lado a lado, en ambos)
	function drawMarks() {
		if (!mode) return;
		const l = modeLayout(mode, box);
		const offsets = mode === "side" ? [0, l.renderX] : [0];
		const boxes = [];
		// Dónde está la capa elegida en Figma (en otro color), para ver el corrimiento
		const fb = figmaBoxOf(selected);
		if (fb)
			for (const dx of offsets)
				boxes.push(h("div", { class: "fv-mark fv-mark-figma", style: `left:${hostX + fb[0] + dx}px;top:${hostY + fb[1]}px;width:${fb[2]}px;height:${fb[3]}px` }));
		for (const [layer, cls] of [[hovered, "fv-mark-hover"], [selected, "fv-mark-sel"]]) {
			if (!layer || (layer === hovered && hovered === selected && cls === "fv-mark-hover")) continue;
			const r = rectOf(layer);
			if (!r) continue;
			for (const dx of offsets)
				boxes.push(h("div", { class: `fv-mark ${cls}`, style: `left:${r.x + dx}px;top:${r.y}px;width:${r.width}px;height:${r.height}px` }));
		}
		marks.replaceChildren(...boxes);
	}

	// Punto del lienzo → coordenadas del render; en lado a lado vale cualquiera de los dos paneles
	function pointAt(e) {
		const sr = stage.getBoundingClientRect();
		let x = (e.clientX - sr.left) / zoom;
		const y = (e.clientY - sr.top) / zoom;
		const l = modeLayout(mode, box);
		if (mode === "side") {
			if (x >= l.renderX) x -= l.renderX;
			else if (x > box.width) return null;
		}
		return { x, y };
	}
	function layerAt(e) {
		const p = pointAt(e);
		if (!p) return null;
		const i = hitTest(layers.map((l) => ({ rect: rectOf(l), depth: l.depth })), p);
		return i < 0 ? null : layers[i];
	}

	// ---------------------------------------------------------------- árbol
	const treeBox = h("div", { class: "fv-tree", role: "tree", tabindex: "0", "aria-label": "Capas" });
	const rowOf = new Map();
	const visibleLayers = () => layers.filter((l) => {
		for (let p = l.parent; p; p = p.parent) if (!isOpen(p)) return false;
		return true;
	});
	function drawTree() {
		rowOf.clear();
		treeBox.replaceChildren(...visibleLayers().map((layer) => {
			const lab = treeLabel(layer, code);
			const has = layer.children.length > 0;
			const row = h("div", {
				class: `fv-row${layer.inside ? " fv-inside" : ""}${layer === selected ? " fv-sel" : ""}${layer === hovered ? " fv-hover" : ""}`,
				role: "treeitem", id: `fv-layer-${layer.id}`, "aria-level": String(layer.depth + 1), "aria-selected": String(layer === selected),
				"aria-expanded": has ? String(isOpen(layer)) : null,
				style: `padding-left:${8 + layer.depth * 14}px`,
				onclick: () => select(layer),
				onmouseenter: () => hover(layer),
				onmouseleave: () => hover(null),
			},
				h("span", { class: "fv-toggle", text: has ? (isOpen(layer) ? "▾" : "▸") : "", onclick: (e) => { e.stopPropagation(); toggle(layer); } }),
				h("span", { class: `fv-kind fv-kind-${layer.kind}`, text: lab.icon }),
				renamedName(layer, lab),
				devOf.has(layer) && h("span", { class: "fv-dev", title: `Corrida respecto de Figma: ${deviationText(devOf.get(layer))}`, text: "↔" }),
				lab.sub && h("span", { class: "fv-sub", text: lab.sub }),
				lab.tags.map((t) => h("span", { class: "fv-tag", text: t })),
			);
			rowOf.set(layer, row);
			return row;
		}));
		treeBox.setAttribute("aria-activedescendant", selected ? `fv-layer-${selected.id}` : "");
	}
	// Nombre de la capa en el árbol; si se renombró, con Código se ve el nombre nuevo y una marca
	function renamedName(layer, lab) {
		const t = renameTarget(layer);
		const p = pendingFor(t);
		if (p === undefined) return h("span", { class: "fv-name", text: lab.main });
		// Al quitar una decisión, el nombre lo vuelve a elegir el extractor (el de Figma o, si es
		// vago, su sugerencia): no se puede anticipar
		const to = p === null ? null : t.kind === "root" ? codeComponent(p) : `.${codeClass(p)}`;
		return h("span", { class: "fv-name fv-renamed", title: `Se renombra: ${t.kind === "root" ? t.current : `.${t.current}`} → ${to || "el nombre que elija el extractor"}` }, code && to ? to : lab.main, " ✎");
	}
	function toggle(layer, open = !isOpen(layer)) {
		openState.set(layer.key, open);
		drawTree();
	}
	function select(layer) {
		selected = layer;
		for (let p = layer && layer.parent; p; p = p.parent) openState.set(p.key, true);
		drawTree();
		drawMarks();
		showSelection();
		const row = layer && rowOf.get(layer);
		if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
	}
	function hover(layer) {
		if (hovered === layer) return;
		const old = hovered && rowOf.get(hovered);
		if (old) old.classList.remove("fv-hover");
		hovered = layer;
		const row = layer && rowOf.get(layer);
		if (row) row.classList.add("fv-hover");
		drawMarks();
	}
	treeBox.addEventListener("keydown", (e) => {
		const vis = visibleLayers();
		const i = selected ? vis.indexOf(selected) : -1;
		let next = null;
		if (e.key === "ArrowDown") next = vis[Math.min(vis.length - 1, i + 1)];
		else if (e.key === "ArrowUp") next = vis[Math.max(0, i - 1)];
		else if (e.key === "Home") next = vis[0];
		else if (e.key === "End") next = vis[vis.length - 1];
		else if (e.key === "ArrowRight" && selected) {
			if (selected.children.length && !isOpen(selected)) return e.preventDefault(), toggle(selected, true);
			next = selected.children[0];
		} else if (e.key === "ArrowLeft" && selected) {
			if (selected.children.length && isOpen(selected)) return e.preventDefault(), toggle(selected, false);
			next = selected.parent;
		} else return;
		e.preventDefault();
		if (next) select(next);
	});

	// Lienzo: el clic elige la capa más profunda bajo el puntero, en cualquier modo
	canvas.addEventListener("mousemove", (e) => hover(layerAt(e)));
	canvas.addEventListener("mouseleave", () => hover(null));
	canvas.addEventListener("click", (e) => select(layerAt(e)));

	// ---------------------------------------------------------------- renombrar
	// Los nombres nuevos se juntan en pending y se descargan como archivo de decisiones para el
	// extractor (--decisions). Se guardan en el navegador para no perderlos al recargar.
	const fontsMissing = missingFonts(doc, Object.values(data.css || {}));
	const DEC_KEY = `figspec.viewer.decisions.${(meta.source && meta.source.node) || rootName}`;
	let pending = { byId: {} };
	try {
		const saved = JSON.parse(stored(DEC_KEY) || "null");
		if (saved && saved.byId) pending = saved;
	} catch {
		// guardado ilegible: se empieza de cero
	}
	const wasApplied = (t) => appliedName(meta, t.kind === "root" ? "root" : t.id);
	const savePending = () => store(DEC_KEY, JSON.stringify(pending));
	const pendingCount = () => Object.keys(pending.byId).length + ("root" in pending ? 1 : 0);
	// Qué se renombra al elegir una capa: el componente (la raíz) o la clase de la capa, por su id
	function renameTarget(layer) {
		if (!layer) return null;
		if (!layer.parent && view.comp === rootName) return { kind: "root", current: design.component.name, figma: design.component.figmaName };
		const n = layer.node;
		const el = n.instance ? n.instance.el : n.el;
		if (!el.id || el.className === "root") return null;
		return { kind: "layer", id: el.id, current: el.className, figma: el.name };
	}
	function pendingFor(t) {
		if (!t) return undefined;
		return t.kind === "root" ? ("root" in pending ? pending.root : undefined) : pending.byId[t.id];
	}
	function setPending(t, value) {
		const v = value.trim();
		const was = wasApplied(t);
		const same = !v || v === t.current || (t.kind === "layer" && codeClass(v) === t.current && !was);
		if (t.kind === "root") {
			if (same) delete pending.root;
			else pending.root = v;
		} else if (same) delete pending.byId[t.id];
		else pending.byId[t.id] = v;
		savePending();
		drawTree();
		showDecisions();
	}
	function forget(t) {
		// Vuelve al nombre de Figma: si había una decisión aplicada, se quita (null)
		const was = wasApplied(t);
		if (t.kind === "root") {
			if (was) pending.root = null;
			else delete pending.root;
		} else if (was) pending.byId[t.id] = null;
		else delete pending.byId[t.id];
		savePending();
		drawTree();
		showDecisions();
		showSelection();
	}
	const decisionsBox = h("div", { class: "fv-decisions", role: "region", "aria-label": "Nombres cambiados" });
	// Mismo nombre base que el paquete del plugin (figspec-menu-mobile.json → .decisions.json)
	const bundleFile = (meta.source && meta.source.bundle) || `figspec-${spec.kebab(design.component.figmaName) || "componente"}.json`;
	// Sin la marca de copia del navegador ("figspec-x (1).json"): el extractor lo busca por el original
	const fileName = bundleFile.replace(/ ?\(\d+\)(?=\.json$)/i, "").replace(/\.json$/i, "") + ".decisions.json";
	function download() {
		// Ruta y nombre en Figma de cada capa, para reconocerla aunque cambie el id (copias)
		const paths = (data.geometry && data.geometry.paths) || {};
		const figmaName = (id) => {
			const l = layers.find((x) => { const t = renameTarget(x); return t && t.id === id; });
			return l ? renameTarget(l).figma : undefined;
		};
		const doc = decisionsDoc(meta, pending, (id) => ({ figma: figmaName(id), path: paths[id] }));
		const blob = new Blob([JSON.stringify(doc, null, 2) + "\n"], { type: "application/json" });
		const a = doc.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = fileName;
		doc.body.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}
	function showDecisions() {
		const n = pendingCount();
		decisionsBox.hidden = !n;
		if (!n) return decisionsBox.replaceChildren();
		const rows = [];
		if ("root" in pending) rows.push({ from: design.component.name, to: pending.root === null ? "(el que elija el extractor)" : codeComponent(pending.root), layer: () => (view.comp === rootName ? layers[0] : null) });
		for (const [id, v] of Object.entries(pending.byId)) {
			const find = () => layers.find((l) => { const t = renameTarget(l); return t && t.id === id; });
			const l = find();
			const t = l && renameTarget(l);
			rows.push({ from: t ? `.${t.current}` : id, to: v === null ? "(el que elija el extractor)" : `.${codeClass(v)}`, layer: find });
		}
		const cmd = `node extractor.js ${bundleFile} --viewer`;
		const copyBtn = h("button", { type: "button", class: "fv-link", text: "Copiar comando", onclick: () => copy(cmd, copyBtn) });
		decisionsBox.replaceChildren(
			h("h3", { text: `${n} nombre${n === 1 ? "" : "s"} cambiado${n === 1 ? "" : "s"}` }),
			h("ul", {}, rows.map((r) => h("li", {}, h("button", { type: "button", class: "fv-link", text: r.from, onclick: () => { const l = r.layer(); if (l) select(l); } }), " → ", h("code", { text: r.to })))),
			h("div", { class: "fv-insp-tools" },
				h("button", { type: "button", text: "Descargar decisiones", onclick: download }),
				h("button", { type: "button", text: "Descartar", onclick: () => { pending = { byId: {} }; savePending(); drawTree(); showDecisions(); showSelection(); } })),
			h("p", { class: "fv-hint" }, `Guarda ${fileName} en tu carpeta de descargas (FIGMA_INBOX) o junto al paquete y vuelve a generar (npm start, o `, h("code", { text: cmd }), "): el extractor lo incorpora a las decisiones del proyecto. ", copyBtn),
		);
	}

	// ---------------------------------------------------------------- inspector
	// Panel derecho: la capa elegida. Para todos: ruta, caja medida, texto o instancia; con Código,
	// además el CSS de los .module.css por origen, con los tokens como chips.
	const TOKENS_KEY = "figspec.viewer.tokens";
	let showTokens = stored(TOKENS_KEY) !== "value";
	const tokens = design.tokens || {};
	const selectionBox = h("div", { class: "fv-selection" });
	const round = (n) => String(Math.round(n * 100) / 100);
	function measured(layer) {
		const el = elementOf.get(layer.node);
		const rootEl = elementOf.get(tree);
		if (!el || !rootEl) return null;
		const r = el.getBoundingClientRect();
		const rr = rootEl.getBoundingClientRect();
		return { x: (r.left - rr.left) / zoom, y: (r.top - rr.top) / zoom, width: r.width / zoom, height: r.height / zoom };
	}
	const swatch = (color) => h("span", { class: "fv-swatch", style: `background:${color}`, "aria-hidden": "true" });
	function valueView(v) {
		return valueParts(v).map((p) => {
			if (typeof p === "string") {
				const t = p.trim();
				return COLOR_RE.test(t) ? [swatch(t), p] : p;
			}
			const actual = tokens[p.token] || p.fallback;
			return h("span", { class: "fv-token", title: showTokens ? `Valor: ${actual || "—"}` : `Token: ${p.token}` },
				actual && COLOR_RE.test(actual) && swatch(actual),
				showTokens ? p.token : actual || p.token);
		});
	}
	const section = (title, ...kids) => h("section", { class: "fv-insp" }, h("h3", { text: title }), ...kids);
	const pairs = (list) => h("dl", {}, list.filter(Boolean).map(([k, v]) => [h("dt", { text: k }), h("dd", {}, v)]));
	async function copy(text, button) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const t = doc.createElement("textarea");
			t.value = text;
			doc.body.append(t);
			t.select();
			doc.execCommand("copy");
			t.remove();
		}
		const old = button.textContent;
		button.textContent = "Copiado";
		setTimeout(() => (button.textContent = old), 1200);
	}
	// Caja medida en el render y, si se sabe, la de Figma con la diferencia
	function boxSection(m, fb) {
		if (!fb)
			return section("Caja", pairs([["X", `${round(m.x)} px`], ["Y", `${round(m.y)} px`], ["Ancho", `${round(m.width)} px`], ["Alto", `${round(m.height)} px`]]),
				h("p", { class: "fv-hint", text: "Medida en el render, desde la esquina del componente." }));
		const rows = [["X", m.x, fb[0]], ["Y", m.y, fb[1]], ["Ancho", m.width, fb[2]], ["Alto", m.height, fb[3]]];
		const delta = (a, b) => {
			const d = Math.round((a - b) * 100) / 100;
			return h("td", { class: Math.abs(d) > DEVIATION_PX ? "fv-delta fv-off" : "fv-delta", text: d ? `${d > 0 ? "+" : "−"}${Math.abs(d)}` : "=" });
		};
		const textNote = selected.kind === "text" && fontsMissing.length > 0;
		return section("Caja",
			h("table", { class: "fv-boxtable" },
				h("thead", {}, h("tr", {}, h("th", {}), h("th", { text: "Render" }), h("th", { text: "Figma" }), h("th", { text: "Δ" }))),
				h("tbody", {}, rows.map(([k, a, b]) => h("tr", {}, h("th", { text: k }), h("td", { text: round(a) }), h("td", { text: round(b) }), delta(a, b))))),
			h("p", { class: "fv-hint", text: `En px, desde la esquina del componente. La caja de Figma se dibuja en naranja.${textNote ? " En los textos, la diferencia puede venir de las fuentes no instaladas." : ""}` }));
	}

	// Lista de capas corridas más de DEVIATION_PX respecto de Figma (se recalcula en cada render)
	const devBox = h("details", { class: "fv-devs", open: true });
	function computeDeviations() {
		devOf.clear();
		devs = figmaBoxes
			? deviations(layers.filter((l) => !l.inside).map((l) => ({ layer: l, render: measured(l), figma: figmaBoxOf(l) })))
			: [];
		for (const d of devs) devOf.set(d.layer, d);
		devBox.hidden = !figmaBoxes;
		if (!figmaBoxes) return;
		devBox.replaceChildren(
			h("summary", { text: devs.length ? `Desvíos de Figma (${devs.length})` : "Desvíos de Figma" }),
			devs.length
				? h("ul", {}, devs.map((d) => h("li", {},
					h("button", { type: "button", class: "fv-link", text: treeLabel(d.layer, code).main, onclick: () => select(d.layer) }),
					h("span", { class: "fv-dev-text", text: ` ${deviationText(d)}` }))))
				: h("p", { class: "fv-hint", text: `Ninguna capa se corre más de ${DEVIATION_PX} px de Figma.` }),
			devs.length > 0 && fontsMissing.length > 0 && devs.some((d) => d.layer.kind === "text") &&
				h("p", { class: "fv-hint", text: "Las diferencias en textos pueden venir de las fuentes no instaladas." }),
		);
	}

	function showSelection() {
		if (!selected) {
			selectionBox.replaceChildren(h("p", { class: "fv-hint", text: "Haz clic en el lienzo o en una capa para verla. Esc sube al contenedor." }));
			return;
		}
		const n = selected.node;
		const el = n.instance ? n.instance.el : n.el;
		const lab = treeLabel(selected, code);
		const crumbs = [];
		for (let p = selected; p; p = p.parent) crumbs.unshift(p);
		const m = measured(selected);
		const parts = [
			h("nav", { class: "fv-crumbs", "aria-label": "Ruta" }, crumbs.map((c, i) => [
				i > 0 && h("span", { "aria-hidden": "true", text: " › " }),
				h("button", { type: "button", class: "fv-link", "aria-current": c === selected ? "true" : null, text: treeLabel(c, code).main, onclick: () => select(c) }),
			])),
			h("p", { class: "fv-insp-title" }, h("span", { class: `fv-kind fv-kind-${selected.kind}`, text: lab.icon }), " ", h("strong", { text: lab.main }), lab.sub && h("span", { class: "fv-sub", text: ` ${lab.sub}` })),
			m && boxSection(m, figmaBoxOf(selected)),
		];
		if (selected.kind === "text") {
			const bound = el.bind && el.bind.text;
			parts.push(section("Texto", h("p", { class: "fv-text", text: layerText(n) || "(vacío)" }), bound && h("p", { class: "fv-hint", text: `Viene de la prop ${bound}.` })));
		}
		if (n.instance) {
			const sub = (design.subcomponents || {})[n.comp] || {};
			const props = Object.keys(sub.props || {}).filter((k) => n.values[k] !== undefined);
			parts.push(section("Instancia",
				pairs([["Componente", n.comp], ["En", n.instance.parent]]),
				props.length > 0 && h("h4", { text: "Props" }),
				props.length > 0 && pairs(props.map((k) => [k, typeof n.values[k] === "string" && n.values[k].endsWith(".svg") ? n.values[k].split("/").pop() : String(n.values[k])])),
			));
		}
		const target = code && renameTarget(selected);
		if (target) {
			const p = pendingFor(target);
			const shown = p === undefined || p === null ? target.current : p;
			const result = h("p", { class: "fv-hint" });
			const showResult = (v) => {
				const t = v.trim();
				result.textContent = !t || t === target.current ? "" : target.kind === "root" ? `Componente: ${codeComponent(t)}` : `Clase: .${codeClass(t)} (si ya existe, el extractor le agrega un número)`;
			};
			const input = h("input", { type: "text", value: shown, "aria-label": target.kind === "root" ? "Nombre del componente" : "Nombre en código",
				oninput: (e) => { showResult(e.target.value); setPending(target, e.target.value); } });
			showResult(shown);
			const was = wasApplied(target);
			parts.push(section(target.kind === "root" ? "Nombre del componente" : "Nombre en código",
				h("div", { class: "fv-rename" }, input,
					(p !== undefined || was) && h("button", { type: "button", text: "Quitar", title: was ? "Quita la decisión: el extractor vuelve a elegir el nombre (el de Figma o su sugerencia)" : "Descarta este cambio", onclick: () => forget(target) })),
				result,
				was && p === undefined && h("p", { class: "fv-hint", text: "Este nombre ya viene de un archivo de decisiones." }),
			));
		} else if (code && !selected.node.el.id && !selected.node.instance)
			parts.push(section("Nombre en código", h("p", { class: "fv-hint", text: "Vuelve a generar la salida para poder renombrar (faltan los id de Figma)." })));
		if (code) {
			const groups = cssGroups(data, n);
			const copyBtn = h("button", { type: "button", text: "Copiar CSS", onclick: () => copy(cssText(groups), copyBtn) });
			const tokBtn = h("button", { type: "button", title: "Alterna entre el nombre del token y su valor", text: showTokens ? "Ver valores" : "Ver tokens",
				onclick: () => { showTokens = !showTokens; store(TOKENS_KEY, showTokens ? "token" : "value"); showSelection(); } });
			parts.push(section("CSS",
				h("div", { class: "fv-insp-tools" }, tokBtn, copyBtn),
				groups.length ? groups.map((g) => h("div", { class: `fv-css fv-css-${g.origin}` },
					h("div", { class: "fv-css-head" }, h("span", { text: g.title }), h("code", { text: `${g.file} · ${g.selector}` })),
					h("ul", {}, g.decls.map(([k, v]) => h("li", {}, h("span", { class: "fv-prop", text: `${k}: ` }), v === "unset" ? h("span", { class: "fv-hint", text: "(se quita en esta variante)" }) : valueView(v)))),
				)) : h("p", { class: "fv-hint", text: "Esta capa no tiene estilos propios." }),
			));
		} else parts.push(h("p", { class: "fv-hint", text: "Prende Código para ver el CSS de esta capa." }));
		selectionBox.replaceChildren(...parts);
	}
	const codeSwitch = h("button", { type: "button", class: "fv-switch", "aria-pressed": String(code), title: "Muestra las clases y el código generado",
		onclick: () => {
			code = !code;
			codeSwitch.setAttribute("aria-pressed", String(code));
			store(CODE_KEY, code ? "1" : "0");
			computeDeviations();
			drawTree();
			showSelection();
		}, text: "Código" });

	// ---------------------------------------------------------------- variantes y props
	// Franja sobre el lienzo: qué componente se dibuja y con qué valores. Los valores cambiados
	// se guardan en view.values (lo demás toma el valor por defecto, como en React).
	const propsBar = h("div", { class: "fv-props", role: "group", "aria-label": "Variantes y props" });
	const previewNote = h("div", { class: "fv-props-note", role: "status" });
	const compSelect = h("select", { "aria-label": "Componente", onchange: (e) => showComponent(e.target.value) },
		[rootName, ...Object.keys(subs)].map((n) => h("option", { value: n, text: n === rootName ? n : `${n} (subcomponente)` })));
	const fieldsBox = h("div", { class: "fv-fields" });
	const resetBtn = h("button", { type: "button", class: "fv-reset", text: "Restablecer", title: "Volver a los valores de Figma", hidden: true,
		onclick: () => { view.values = baseValues(); buildFields(); renderNow(); } });
	propsBar.append(h("label", { class: "fv-field" }, h("span", { text: "Componente" }), compSelect), fieldsBox, previewNote);
	const effective = () => {
		const v = { ...spec.propDefaults(byName(view.comp)) };
		for (const [k, x] of Object.entries(view.values)) if (x !== undefined) v[k] = x;
		return v;
	};
	const setValue = (name, value) => {
		view.values[name] = value;
		renderNow();
	};
	function buildFields() {
		const comp = byName(view.comp);
		const v = effective();
		const controls = propControls(data, comp);
		const fields = controls.map((c) => {
			const id = `fv-prop-${c.name}`;
			let input;
			if (c.control === "check") input = h("input", { type: "checkbox", id, checked: v[c.name] === true, onchange: (e) => setValue(c.name, e.target.checked) });
			else if (c.control === "text") input = h("input", { type: "text", id, value: v[c.name] == null ? "" : String(v[c.name]), oninput: (e) => setValue(c.name, e.target.value) });
			else {
				const label = (o) => (c.type === "icon" ? o.split("/").pop().replace(/\.svg$/, "") : o);
				input = h("select", { id, onchange: (e) => setValue(c.name, e.target.value === "" && c.none ? null : e.target.value) },
					c.none && h("option", { value: "", text: "(ninguno)" }),
					c.options.map((o) => h("option", { value: o, text: label(o) })));
				input.value = v[c.name] == null ? "" : String(v[c.name]);
			}
			return h("label", { class: "fv-field", for: id }, h("span", { text: c.name }), input);
		});
		fieldsBox.replaceChildren(...(fields.length ? fields : [h("span", { class: "fv-hint", text: "Sin props" })]), resetBtn);
		// Sin props ni subcomponentes no hay nada que elegir: la franja no aparece
		propsBar.hidden = !fields.length && !Object.keys(subs).length;
	}
	function showPreviewNote() {
		const msg = {
			props: "Cambiaste textos u opciones: la vista previa de Figma sigue mostrando los originales.",
			variant: NO_COMPARE.variant + ": solo se puede ver el render.",
			component: `Este componente no tiene vista previa propia; se muestra con los valores de su primera instancia en ${rootName}.`,
		}[pv.reason];
		previewNote.replaceChildren(...(msg ? [h("span", { text: msg }),
			pv.reason === "component" && data.preview && h("button", { type: "button", text: "Ver en contexto", title: `Vuelve a ${rootName} y elige la primera instancia de ${view.comp}`, onclick: () => showComponent(rootName, view.comp) })] : []).filter(Boolean));
		previewNote.hidden = !msg;
	}
	// Cambia el componente que se dibuja; con focus, elige su primera instancia (Ver en contexto)
	function showComponent(name, focus) {
		view.comp = name;
		view.values = baseValues();
		compSelect.value = name;
		selected = null;
		buildFields();
		renderNow({ refit: true });
		if (focus) {
			const layer = layers.find((l) => l.node.instance && l.node.comp === focus);
			if (layer) select(layer);
		}
	}

	// Dibuja el componente con los valores actuales y actualiza todo lo que depende del render
	function renderNow({ refit = false } = {}) {
		const keep = selected && selected.key;
		pv = previewFor(data, view.comp, view.values);
		figmaBoxes = geometryFor(data, view.comp, view.values);
		const compare = !!(data.preview && pv.offset);
		const scale = meta.preview ? meta.preview.scale : 1;
		// La parte de la imagen que se muestra (en un set, la variante elegida) y el render encima
		const crop = compare ? pv.crop || { x: 0, y: 0, width: meta.preview.width, height: meta.preview.height } : null;
		hostX = compare ? (pv.offset.x - crop.x) / scale : 0;
		hostY = compare ? (pv.offset.y - crop.y) / scale : 0;
		host.style.left = `${hostX}px`;
		host.style.top = `${hostY}px`;
		if (previewImg && crop) {
			const full = previewBox(meta.preview);
			Object.assign(previewImg.style, { left: `${-crop.x / scale}px`, top: `${-crop.y / scale}px`, width: `${full.width}px`, height: `${full.height}px` });
		}
		// Un subcomponente suelto toma el tamaño de su instancia en la raíz (su CSS puede ser
		// width: 100%); la raíz, el de la parte visible de la vista previa
		const hint = compare ? { width: crop.width / scale, height: crop.height / scale } : instanceSize[view.comp] || { width: 320, height: 1 };
		// El ancho lo da el padre (p. ej. align-self: stretch): suelto, se fija el de la instancia
		host.style.width = !compare && instanceSize[view.comp] ? `${instanceSize[view.comp].width}px` : "";
		renderPane.style.width = `${hint.width}px`;
		renderPane.style.height = `${hint.height}px`;
		tree = renderTree(data, view.comp, view.values);
		nodes.clear();
		shadow.replaceChildren(style);
		mount(doc, shadow, tree, nodes);
		elementOf = new Map();
		for (const [el, n] of nodes) elementOf.set(n, el);
		layers = treeModel(tree);
		const old = box;
		box = { width: Math.max(1, hint.width, hostX + host.offsetWidth), height: Math.max(1, hint.height, hostY + host.offsetHeight) };
		figmaPane.hidden = !compare;
		for (const m of MODES) {
			const off = m.id !== "render" && !compare;
			modeButtons[m.id].disabled = off;
			modeButtons[m.id].title = off ? NO_COMPARE[pv.reason] || NO_COMPARE.none : m.title;
		}
		selected = keep ? layers.find((l) => l.key === keep) || null : null;
		hovered = null;
		setMode(compare ? preferred : "render");
		if (refit || old.width !== box.width || old.height !== box.height) fit();
		else setZoom(zoom);
		resetBtn.hidden = JSON.stringify(view.values) === JSON.stringify(baseValues());
		computeDeviations();
		drawTree();
		showSelection();
		showPreviewNote();
	}

	const notices = [];
	const fonts = fontsMissing;
	if (fonts.length)
		notices.push(`${fonts.length === 1 ? "La fuente" : "Las fuentes"} ${fonts.join(", ")} no ${fonts.length === 1 ? "está instalada" : "están instaladas"} en este equipo: esos textos se ven con otra tipografía y en la comparación con Figma van a aparecer distintos. ${fonts.length === 1 ? "Instálala" : "Instálalas"} para comparar.`);
	if (data.missing && data.missing.length)
		notices.push(`Faltan ${data.missing.length} archivo(s) de la salida (${data.missing.slice(0, 3).join(", ")}${data.missing.length > 3 ? "…" : ""}). Genera el visualizador desde la carpeta completa.`);

	app.replaceChildren(
		...[h("header", { class: "fv-bar" },
			h("div", { class: "fv-title" }, h("strong", { text: design.component.name }), design.component.figmaName !== design.component.name && h("span", { text: design.component.figmaName })),
			modeBar,
			codeSwitch,
			h("div", { class: "fv-zoombar", role: "group", "aria-label": "Zoom" },
				h("button", { type: "button", "aria-label": "Alejar", text: "−", onclick: () => setZoom(stepZoom(zoom, -1)) }),
				zoomLabel,
				h("button", { type: "button", "aria-label": "Acercar", text: "+", onclick: () => setZoom(stepZoom(zoom, 1)) }),
				h("button", { type: "button", text: "Ajustar", onclick: fit }),
				h("button", { type: "button", text: "100 %", onclick: () => setZoom(1) }),
			),
		),
		notices.length > 0 && h("div", { class: "fv-notices", role: "status" }, notices.map((n) => h("p", { text: n }))),
		h("main", { class: "fv-main" },
			h("aside", { class: "fv-side fv-layers", "aria-label": "Capas" },
				h("h2", { text: "Capas" }),
				treeBox,
			),
			h("div", { class: "fv-center" }, toolbar, propsBar, canvas),
			h("aside", { class: "fv-side", "aria-label": "Detalles" },
				decisionsBox,
				devBox,
				h("h2", { text: "Inspector" }),
				selectionBox,
				h("h2", { text: "Detalles" }),
				h("dl", {},
					h("dt", { text: "Vista previa" }),
					h("dd", { text: meta.preview ? `${meta.preview.width}×${meta.preview.height} @${meta.preview.scale}x` : "no incluida" }),
					h("dt", { text: "Archivos embebidos" }),
					h("dd", { text: String(Object.keys(data.assets || {}).length) }),
				),
				(meta.notes || []).length > 0 && h("details", {}, h("summary", { text: `Notas (${meta.notes.length})` }), h("ul", {}, meta.notes.map((n) => h("li", { text: n })))),
			),
		)].filter(Boolean),
	);
	// Superponer: con Espacio presionado se alterna entre Figma y el render (delata corrimientos)
	let blink = null;
	const stopBlink = () => {
		if (!blink) return;
		clearInterval(blink);
		blink = null;
		renderPane.style.opacity = mode === "overlay" ? String(opacity) : "";
	};
	doc.addEventListener("keyup", (e) => {
		if (e.key === " ") stopBlink();
	});
	doc.defaultView && doc.defaultView.addEventListener("blur", stopBlink);
	doc.addEventListener("keydown", (e) => {
		const typing = e.target && e.target.closest && e.target.closest("input, select, textarea, button");
		if (e.key === " " && mode === "overlay" && !typing) {
			e.preventDefault();
			if (e.repeat || blink) return;
			let on = false;
			renderPane.style.opacity = "0";
			blink = setInterval(() => {
				on = !on;
				renderPane.style.opacity = on ? "1" : "0";
			}, 400);
			return;
		}
		// Esc sube al contenedor de la capa elegida
		if (e.key === "Escape" && selected && !(typing && typing.matches("input[type=text], select"))) {
			e.preventDefault();
			select(selected.parent);
			return;
		}
		if (!(e.metaKey || e.ctrlKey)) return;
		if (e.key === "0") fit();
		else if (e.key === "1") setZoom(1);
		else return;
		e.preventDefault();
	});
	preferred = initialMode(stored(MODE_KEY), !!data.preview);
	showDecisions();
	buildFields();
	renderNow({ refit: true });
	// Tamaño de cada subcomponente en contexto (su primera instancia en la raíz), para dibujarlo suelto
	for (const l of layers) {
		const n = l.node;
		if (!n.instance || instanceSize[n.comp]) continue;
		const r = rectOf(l);
		if (r && r.width > 0) instanceSize[n.comp] = { width: r.width, height: r.height };
		instanceValues[n.comp] = {};
		for (const k of Object.keys((subs[n.comp] || {}).props || {})) if (n.values[k] !== undefined) instanceValues[n.comp][k] = n.values[k];
	}
	app.dataset.ready = "true";
}

module.exports = { checkData, prefixClass, prefixCss, hostTokens, resolveAssets, shadowCss, renderTree, toHtml, treeModel, treeLabel, hitTest, appliedDecisions, appliedName, geometryFor, deviations, deviationText, codeClass, codeComponent, decisionsDoc, propControls, previewFor, cssGroups, valueParts, cssText, fontFamilies, fontInstalled, MODES, modeLayout, initialMode, fitZoom, stepZoom, previewBox, boot };
