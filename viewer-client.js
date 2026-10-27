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
			return el.segments.map((s) => (s.css ? node("span", { style: styleText(s.css) }, [s.text], c, el) : s.text));
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

// ---------------------------------------------------------------- interfaz
function boot(doc, data) {
	const app = doc.getElementById("app");
	const h = (tag, attrs, ...kids) => {
		const el = doc.createElement(tag);
		for (const [k, v] of Object.entries(attrs || {}))
			if (k === "text") el.textContent = v;
			else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
			else if (v !== false && v != null) el.setAttribute(k, v === true ? "" : v);
		for (const k of kids.flat()) if (k) el.append(k);
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
	const comps = [design.component, ...Object.values(design.subcomponents || {})];
	let box = meta.preview ? previewBox(meta.preview) : { width: 0, height: 0 };
	let zoom = 1;
	let mode = "render";

	// Escenario: la vista previa de Figma y, encima, el componente en su Shadow DOM, en la posición
	// que indica meta.preview.offset (la imagen puede incluir sombras alrededor)
	const stage = h("div", { class: "fv-stage" });
	const preview = data.preview
		? h("img", { class: "fv-preview", src: data.preview, alt: `Vista previa de ${design.component.figmaName} exportada desde Figma`, draggable: "false" })
		: null;
	if (preview) stage.append(preview);
	const host = h("div", { class: "fv-render" });
	if (meta.preview) {
		host.style.left = `${meta.preview.offset.x / meta.preview.scale}px`;
		host.style.top = `${meta.preview.offset.y / meta.preview.scale}px`;
	}
	const shadow = host.attachShadow({ mode: "open" });
	const style = doc.createElement("style");
	style.textContent = shadowCss(data);
	shadow.append(style);
	const nodes = new Map(); // elemento del render → nodo virtual (árbol e inspector)
	mount(doc, shadow, renderTree(data, design.component.name, {}), nodes);
	stage.append(host);

	// El transform no cambia el espacio que ocupa: el contenedor toma el tamaño ya escalado para
	// que el lienzo se pueda desplazar con zoom alto
	const sizer = h("div", { class: "fv-sizer" }, stage);
	const canvas = h("section", { class: "fv-canvas", "aria-label": "Lienzo" }, sizer);
	const modeButtons = {};
	const setMode = (m) => {
		mode = m;
		host.hidden = m !== "render";
		if (preview) preview.hidden = m !== "figma";
		for (const [k, b] of Object.entries(modeButtons)) b.setAttribute("aria-pressed", String(k === m));
	};
	const modeBar = h("div", { class: "fv-modes", role: "group", "aria-label": "Qué se muestra" },
		[["render", "Render", "El componente generado"], ["figma", "Figma", data.preview ? "La vista previa exportada desde Figma" : "Sin vista previa: exporta con el plugin con «Vista previa (PNG)» activado"]].map(([k, label, title]) =>
			(modeButtons[k] = h("button", { type: "button", title, disabled: k === "figma" && !data.preview, onclick: () => setMode(k) , text: label })),
		),
	);
	const zoomLabel = h("output", { class: "fv-zoom", "aria-live": "polite" });
	const setZoom = (z) => {
		zoom = z;
		stage.style.width = `${box.width}px`;
		stage.style.height = `${box.height}px`;
		stage.style.transform = `scale(${z})`;
		sizer.style.width = `${box.width * z}px`;
		sizer.style.height = `${box.height * z}px`;
		zoomLabel.textContent = `${Math.round(z * 100)} %`;
	};
	const fit = () => setZoom(fitZoom(box, canvas.getBoundingClientRect()));

	const notices = [];
	if (data.missing && data.missing.length)
		notices.push(`Faltan ${data.missing.length} archivo(s) de la salida (${data.missing.slice(0, 3).join(", ")}${data.missing.length > 3 ? "…" : ""}). Genera el visualizador desde la carpeta completa.`);

	app.replaceChildren(
		...[h("header", { class: "fv-bar" },
			h("div", { class: "fv-title" }, h("strong", { text: design.component.name }), design.component.figmaName !== design.component.name && h("span", { text: design.component.figmaName })),
			modeBar,
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
			h("aside", { class: "fv-side", "aria-label": "Componentes" },
				h("h2", { text: "Componentes" }),
				h("ul", {}, comps.map((c) => h("li", {}, h("span", { text: c.name }), c.figmaName !== c.name && h("small", { text: c.figmaName })))),
			),
			canvas,
			h("aside", { class: "fv-side", "aria-label": "Detalles" },
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
	doc.addEventListener("keydown", (e) => {
		if (!(e.metaKey || e.ctrlKey)) return;
		if (e.key === "0") fit();
		else if (e.key === "1") setZoom(1);
		else return;
		e.preventDefault();
	});
	setMode("render");
	// Sin vista previa, el escenario toma el tamaño del componente dibujado
	if (!meta.preview) box = { width: Math.max(1, host.offsetWidth), height: Math.max(1, host.offsetHeight) };
	fit();
	app.dataset.ready = "true";
}

module.exports = { checkData, prefixClass, prefixCss, hostTokens, resolveAssets, shadowCss, renderTree, toHtml, fitZoom, stepZoom, previewBox, boot };
