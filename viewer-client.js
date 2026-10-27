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
	const node = (tag, attrs, children, c, el, extra) => ({ tag, attrs, children: children || [], comp: c.comp.name, el, ...extra });

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
		root.instance = { el, parent: c.comp.name };
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
		const layer = { id: list.length, node: n, parent, children: [], depth, kind: layerKind(n), inside };
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
	let box = meta.preview ? previewBox(meta.preview) : { width: 0, height: 0 };
	let zoom = 1;
	let mode = null;
	let opacity = 0.5;

	// Escenario con dos paneles del mismo tamaño: la vista previa de Figma y el componente en su
	// Shadow DOM, en la posición que indica meta.preview.offset (la imagen puede incluir sombras)
	const stage = h("div", { class: "fv-stage" });
	const figmaPane = h("div", { class: "fv-pane fv-pane-figma" });
	const renderPane = h("div", { class: "fv-pane fv-pane-render" });
	if (data.preview)
		figmaPane.append(h("img", { class: "fv-preview", src: data.preview, alt: `Vista previa de ${design.component.figmaName} exportada desde Figma`, draggable: "false" }));
	stage.append(figmaPane, renderPane);
	const host = h("div", { class: "fv-render" });
	if (meta.preview) {
		host.style.left = `${meta.preview.offset.x / meta.preview.scale}px`;
		host.style.top = `${meta.preview.offset.y / meta.preview.scale}px`;
	}
	const shadow = host.attachShadow({ mode: "open" });
	const style = doc.createElement("style");
	style.textContent = shadowCss(data);
	shadow.append(style);
	const nodes = new Map(); // elemento del render → nodo virtual
	const tree = renderTree(data, design.component.name, {});
	mount(doc, shadow, tree, nodes);
	renderPane.append(host);
	const hostX = meta.preview ? meta.preview.offset.x / meta.preview.scale : 0;
	const hostY = meta.preview ? meta.preview.offset.y / meta.preview.scale : 0;

	// Capas: el árbol del panel izquierdo, con el elemento del render de cada una
	const layers = treeModel(tree);
	const elementOf = new Map();
	for (const [el, n] of nodes) elementOf.set(n, el);
	const layerOf = new Map(layers.map((l) => [l.node, l]));
	let selected = null;
	let hovered = null;
	let code = stored(CODE_KEY) === "1";
	const expanded = new Set(layers.filter((l) => l.kind !== "instance" && !l.inside).map((l) => l.id));
	expanded.add(0);

	// Caja de una capa en coordenadas del panel (sin zoom); el render está en host
	function rectOf(layer) {
		const el = elementOf.get(layer.node);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		const hr = host.getBoundingClientRect();
		return { x: (r.left - hr.left) / zoom + hostX, y: (r.top - hr.top) / zoom + hostY, width: r.width / zoom, height: r.height / zoom };
	}
	const marks = h("div", { class: "fv-marks", "aria-hidden": "true" });
	stage.append(marks);
	// El transform no cambia el espacio que ocupa: el contenedor toma el tamaño ya escalado para
	// que el lienzo se pueda desplazar con zoom alto
	const sizer = h("div", { class: "fv-sizer" }, stage);
	const canvas = h("section", { class: "fv-canvas", "aria-label": "Lienzo" }, sizer);
	const noPreview = "Sin vista previa: exporta con el plugin con «Vista previa (PNG)» activado";
	const modeButtons = {};
	const modeBar = h("div", { class: "fv-modes", role: "group", "aria-label": "Qué se muestra" },
		MODES.map((m) => {
			const off = m.id !== "render" && !data.preview;
			return (modeButtons[m.id] = h("button", { type: "button", title: off ? noPreview : m.title, disabled: off, onclick: () => setMode(m.id, true), text: m.label }));
		}),
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
		if (user) store(MODE_KEY, m);
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
		for (let p = l.parent; p; p = p.parent) if (!expanded.has(p.id)) return false;
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
				"aria-expanded": has ? String(expanded.has(layer.id)) : null,
				style: `padding-left:${8 + layer.depth * 14}px`,
				onclick: () => select(layer),
				onmouseenter: () => hover(layer),
				onmouseleave: () => hover(null),
			},
				h("span", { class: "fv-toggle", text: has ? (expanded.has(layer.id) ? "▾" : "▸") : "", onclick: (e) => { e.stopPropagation(); toggle(layer); } }),
				h("span", { class: `fv-kind fv-kind-${layer.kind}`, text: lab.icon }),
				h("span", { class: "fv-name", text: lab.main }),
				lab.sub && h("span", { class: "fv-sub", text: lab.sub }),
				lab.tags.map((t) => h("span", { class: "fv-tag", text: t })),
			);
			rowOf.set(layer, row);
			return row;
		}));
		treeBox.setAttribute("aria-activedescendant", selected ? `fv-layer-${selected.id}` : "");
	}
	function toggle(layer, open = !expanded.has(layer.id)) {
		if (open) expanded.add(layer.id);
		else expanded.delete(layer.id);
		drawTree();
	}
	function select(layer) {
		selected = layer;
		for (let p = layer && layer.parent; p; p = p.parent) expanded.add(p.id);
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
			if (selected.children.length && !expanded.has(selected.id)) return e.preventDefault(), toggle(selected, true);
			next = selected.children[0];
		} else if (e.key === "ArrowLeft" && selected) {
			if (selected.children.length && expanded.has(selected.id)) return e.preventDefault(), toggle(selected, false);
			next = selected.parent;
		} else return;
		e.preventDefault();
		if (next) select(next);
	});

	// Lienzo: el clic elige la capa más profunda bajo el puntero, en cualquier modo
	canvas.addEventListener("mousemove", (e) => hover(layerAt(e)));
	canvas.addEventListener("mouseleave", () => hover(null));
	canvas.addEventListener("click", (e) => select(layerAt(e)));

	// Panel derecho: la capa elegida (el inspector completo llega después)
	const selectionBox = h("div", { class: "fv-selection" });
	function showSelection() {
		if (!selected) {
			selectionBox.replaceChildren(h("p", { class: "fv-hint", text: "Haz clic en el lienzo o en una capa para verla. Esc sube al contenedor." }));
			return;
		}
		const n = selected.node;
		const el = n.instance ? n.instance.el : n.el;
		const crumbs = [];
		for (let p = selected; p; p = p.parent) crumbs.unshift(p);
		selectionBox.replaceChildren(
			h("nav", { class: "fv-crumbs", "aria-label": "Ruta" }, crumbs.map((c, i) => [
				i > 0 && h("span", { "aria-hidden": "true", text: " › " }),
				h("button", { type: "button", class: "fv-link", text: treeLabel(c, code).main, onclick: () => select(c) }),
			])),
			h("dl", {},
				h("dt", { text: "Capa en Figma" }), h("dd", { text: el.name || "—" }),
				h("dt", { text: "Clase" }), h("dd", { text: `.${el.className}` }),
				h("dt", { text: "Componente" }), h("dd", { text: n.instance ? `${n.comp} (instancia en ${n.instance.parent})` : n.comp }),
			),
		);
	}
	const codeSwitch = h("button", { type: "button", class: "fv-switch", "aria-pressed": String(code), title: "Muestra las clases y el código generado",
		onclick: () => {
			code = !code;
			codeSwitch.setAttribute("aria-pressed", String(code));
			store(CODE_KEY, code ? "1" : "0");
			drawTree();
			showSelection();
		}, text: "Código" });

	const notices = [];
	const fonts = missingFonts(doc, Object.values(data.css || {}));
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
			h("div", { class: "fv-center" }, toolbar, canvas),
			h("aside", { class: "fv-side", "aria-label": "Detalles" },
				h("h2", { text: "Selección" }),
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
		if (e.key === " " && mode === "overlay" && !(e.target && e.target.closest && e.target.closest("button"))) {
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
		if (e.key === "Escape" && selected) {
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
	// Sin vista previa, el escenario toma el tamaño del componente dibujado
	if (!meta.preview) box = { width: Math.max(1, host.offsetWidth), height: Math.max(1, host.offsetHeight) };
	drawTree();
	showSelection();
	setMode(initialMode(stored(MODE_KEY), !!data.preview));
	fit();
	app.dataset.ready = "true";
}

module.exports = { checkData, prefixClass, prefixCss, hostTokens, resolveAssets, shadowCss, renderTree, toHtml, treeModel, treeLabel, hitTest, fontFamilies, fontInstalled, MODES, modeLayout, initialMode, fitZoom, stepZoom, previewBox, boot };
