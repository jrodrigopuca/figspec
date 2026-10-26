"use strict";
/**
 * figspec — generador de componentes React (TypeScript) a partir de component.json.
 * Lo invoca extractor.js con --react, después de escribir la salida: lee component.json, los
 * CSS Modules y los assets ya escritos, así usa las rutas finales de íconos e imágenes.
 *
 * Genera, en la subcarpeta del componente (junto a sus CSS Modules y assets):
 *   <Componente>.tsx  → la raíz y cada subcomponente, con su CSS Module
 *   icons.tsx         → cada SVG como componente React (currentColor)
 *   index.ts          → exporta el componente raíz y sus tipos
 */

const fs = require("fs");
const path = require("path");

const RESERVED = new Set(
	"break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await"
		.split(" "),
);
const IDENT = /^[A-Za-z_$][\w$]*$/;

// part: subcarpeta del componente; las rutas de component.json la incluyen (Frame1/assets/…) y
// los .tsx, que viven dentro, las importan relativas a ella. write recibe rutas relativas a part.
function generateReact(outDir, part, write) {
	const spec = JSON.parse(
		fs.readFileSync(path.join(outDir, "component.json"), "utf8"),
	);
	const comps = [spec.component, ...Object.values(spec.subcomponents || {})];
	const env = {
		outDir,
		part,
		subs: spec.subcomponents || {},
		icons: iconComponents(outDir, spec.icons || []),
	};
	if (env.icons.size) write("icons.tsx", iconsModule(env.icons));
	for (const comp of comps) write(`${comp.name}.tsx`, componentModule(comp, env));
	write(
		"index.ts",
		`export { ${spec.component.name} } from "./${spec.component.name}";\n` +
			`export type { ${spec.component.name}Props } from "./${spec.component.name}";\n`,
	);
}

// ---------------------------------------------------------------- componente
function componentModule(comp, env) {
	const g = {
		comp,
		env,
		classes: cssClasses(comp),
		vars: {}, // prop → nombre de variable (evita palabras reservadas)
		used: new Set(), // props que el JSX usa (solo esas se desestructuran)
		components: new Set(),
		images: new Map(), // ruta → variable importada
		icons: false,
		reactNode: false,
	};
	for (const p of Object.keys(comp.props || {}))
		g.vars[p] = RESERVED.has(p) || !IDENT.test(p) ? `${camelSafe(p)}Value` : p;

	// Cada variante con estructura propia se resuelve con un return anticipado
	const branches = (comp.variantStructures || []).map(
		(v) =>
			`  if (${condition(v.when, g)}) {\n    return (\n${renderEl(v.structure, g, 6, true)}\n    );\n  }\n`,
	);
	const main = renderEl(comp.structure, g, 4, true);

	const defaults = propDefaults(comp);
	const typeLines = Object.entries(comp.props || {}).map(
		([p, def]) => `  ${IDENT.test(p) ? p : JSON.stringify(p)}?: ${tsType(def, g)};`,
	);
	typeLines.push("  className?: string;");
	const params = Object.keys(comp.props || {})
		.filter((p) => g.used.has(p))
		.map((p) => {
			const v = g.vars[p];
			const head = v === p ? p : `${JSON.stringify(p)}: ${v}`;
			return defaults[p] !== undefined ? `${head} = ${defaults[p]}` : head;
		});
	params.push("className");

	const imports = [];
	if (g.reactNode) imports.push('import type { ReactNode } from "react";');
	imports.push(`import styles from "./${comp.name}.module.css";`);
	for (const c of [...g.components].sort())
		imports.push(`import { ${c} } from "./${c}";`);
	if (g.icons) imports.push('import * as Icons from "./icons";');
	for (const [file, v] of g.images) imports.push(`import ${v} from "./${file}";`);

	return (
		`// Generado por figspec desde Figma ("${comp.figmaName}"). Los cambios manuales se pierden al regenerar.\n` +
		`${imports.join("\n")}\n\n` +
		`export type ${comp.name}Props = {\n${typeLines.join("\n")}\n};\n\n` +
		`export function ${comp.name}({ ${params.join(", ")} }: ${comp.name}Props) {\n` +
		branches.join("") +
		`  return (\n${main}\n  );\n}\n`
	);
}

// Clases que existen en el CSS Module (base o en alguna regla de variante)
function cssClasses(comp) {
	const out = new Set(Object.keys(comp.styles || {}));
	for (const r of comp.variantStyles || [])
		for (const c of Object.keys(r.styles || {})) out.add(c);
	return out;
}

function tsType(def, g) {
	if (def.type === "variant")
		return def.options && def.options.length
			? def.options.map((o) => JSON.stringify(String(o))).join(" | ")
			: "string";
	if (def.type === "boolean") return "boolean";
	if (def.type === "string") return "string";
	if (def.type === "node" || def.type === "slot") {
		g.reactNode = true;
		return "ReactNode";
	}
	return "unknown";
}

// Valores por defecto: los de Figma; si no vienen (subcomponentes), los del propio diseño.
function propDefaults(comp) {
	const out = {};
	const found = {};
	(function scan(el) {
		if (el.bind && el.bind.visible && !(el.bind.visible in found))
			found[el.bind.visible] = !el.hidden;
		if (el.bind && el.bind.text && !(el.bind.text in found))
			found[el.bind.text] = el.text !== undefined
				? el.text
				: (el.segments || []).map((s) => s.text).join("");
		(el.children || []).forEach(scan);
	})(comp.structure);
	for (const [p, def] of Object.entries(comp.props || {})) {
		let v;
		if (def.type === "variant")
			v =
				(comp.defaultVariant && comp.defaultVariant[p]) ??
				def.default ??
				(def.options || [])[0];
		else if (def.type === "boolean" || def.type === "string")
			v = def.default !== undefined ? def.default : found[p];
		if (v !== undefined) out[p] = JSON.stringify(v);
	}
	return out;
}

// ---------------------------------------------------------------- JSX
function renderEl(el, g, n, isRoot) {
	let jsx;
	if (el.bind && el.bind.swap) jsx = pad(n) + `{${useVar(el.bind.swap, g)}}`;
	else if (el.component) jsx = renderInstance(el, g, n);
	else if (el.tag === "svg") jsx = renderIcon(el, g, n);
	else if (el.tag === "img") jsx = renderImage(el, g, n);
	else jsx = renderBox(el, g, n, isRoot);
	if (!isRoot && el.bind && el.bind.visible)
		jsx = `${pad(n)}{${useVar(el.bind.visible, g)} && (\n${indent(jsx, 2)}\n${pad(n)})}`;
	return jsx;
}

function renderBox(el, g, n, isRoot) {
	const tag = el.tag === "span" ? "span" : "div";
	const attrs = [classAttr(el, g, isRoot)];
	if (isRoot)
		for (const [p, def] of Object.entries(g.comp.props || {}))
			if (def.type === "variant") attrs.push(`data-${kebab(p)}={${useVar(p, g)}}`);
	const open = `<${tag}${attrs.filter(Boolean).map((a) => " " + a).join("")}`;

	const kids = [];
	const text = textContent(el, g);
	// Un texto solo y corto va en la misma línea: <span …>Dashboard</span>
	if (text && text.length === 1 && !(el.children || []).length) {
		const line = `${pad(n)}${open}>${text[0]}</${tag}>`;
		if (line.length <= 100) return line;
	}
	if (text) kids.push(...text.map((t) => pad(n + 2) + t));
	for (const c of el.children || []) kids.push(renderEl(c, g, n + 2, false));
	if (!kids.length) return `${pad(n)}${open} />`;
	return `${pad(n)}${open}>\n${kids.join("\n")}\n${pad(n)}</${tag}>`;
}

// Contenido de un texto: prop enlazada, texto que cambia por variante, segmentos o literal
function textContent(el, g) {
	if (el.bind && el.bind.text) return [`{${useVar(el.bind.text, g)}}`];
	const cases = variantCases(g.comp.variantText, el.className, (r) => r.text);
	if (cases.length) {
		const base = el.text !== undefined ? el.text : (el.segments || []).map((s) => s.text).join("");
		return [`{${ternary(cases, JSON.stringify(base), g, (v) => JSON.stringify(v))}}`];
	}
	if (el.segments)
		return el.segments.map((s) =>
			s.css ? `<span style={${styleObject(s.css)}}>${literal(s.text)}</span>` : literal(s.text),
		);
	if (el.text !== undefined && el.text !== "") return [literal(el.text)];
	return null;
}

function renderInstance(el, g, n) {
	g.components.add(el.component);
	const sub = g.env.subs[el.component];
	const defs = (sub && sub.props) || {};
	const attrs = [classAttr(el, g, false)];
	for (const [k, v] of Object.entries(el.props || {})) {
		const type = (defs[k] || {}).type;
		const cases = variantCases(g.comp.variantProps, el.className, (r) => r.props, k);
		const val = (x) => propValue(x, type, g);
		const base = val(v);
		if (cases.length) {
			const expr = ternary(cases, base === null ? "undefined" : base, g, (x) => {
				const r = val(x);
				return r === null ? "undefined" : r;
			});
			attrs.push(`${k}={${expr}}`);
		} else if (base !== null)
			// Un texto simple va entre comillas (label="Nuevo"); lo demás como expresión
			attrs.push(
				/^"[^"\\{}\n]*"$/.test(base) ? `${k}=${base}` : `${k}={${base}}`,
			);
	}
	return `${pad(n)}<${el.component}${attrs.filter(Boolean).map((a) => " " + a).join("")} />`;
}

// Valor JS de una prop de instancia según su tipo; null si no se puede expresar
function propValue(v, type, g) {
	if (v === null || v === undefined) return null;
	if (type === "boolean" || typeof v === "boolean") return String(v === true || v === "true");
	if (type === "node" || type === "slot") {
		// Un swap apunta a otro componente: solo se puede pasar si también se generó
		if (typeof v === "string" && g.env.subs[v]) {
			g.components.add(v);
			return `<${v} />`;
		}
		return null;
	}
	return JSON.stringify(String(v));
}

function renderIcon(el, g, n) {
	const name = g.env.icons.get(el.src) && g.env.icons.get(el.src).name;
	const cls = classAttr(el, g, false);
	if (!name)
		return `${pad(n)}<span${cls ? " " + cls : ""} data-figspec-missing=${JSON.stringify(el.src || el.icon || "")} />`;
	g.icons = true;
	return `${pad(n)}<Icons.${name}${cls ? " " + cls : ""} />`;
}

function renderImage(el, g, n) {
	const cls = classAttr(el, g, false);
	const rel = el.src ? path.posix.relative(g.env.part, el.src) : "";
	let src = JSON.stringify(rel);
	if (el.src && fs.existsSync(path.join(g.env.outDir, el.src))) {
		if (!g.images.has(rel)) g.images.set(rel, `img${g.images.size + 1}`);
		src = `{${g.images.get(rel)}}`;
	}
	return `${pad(n)}<img${cls ? " " + cls : ""} src=${src} alt="" />`;
}

function classAttr(el, g, isRoot) {
	if (isRoot) return "className={[styles.root, className].filter(Boolean).join(\" \")}";
	if (!g.classes.has(el.className)) return null;
	return `className={${member(el.className)}}`;
}

function member(cls) {
	return IDENT.test(cls) ? `styles.${cls}` : `styles[${JSON.stringify(cls)}]`;
}

// ---------------------------------------------------------------- condiciones por variante
// Casos { when, value } de variantText / variantProps para una clase (y una prop, si aplica)
function variantCases(rules, cls, pick, key) {
	const out = [];
	for (const r of rules || []) {
		const m = pick(r) || {};
		if (!(cls in m)) continue;
		if (key === undefined) out.push({ when: r.when, value: m[cls] });
		else if (m[cls] && key in m[cls]) out.push({ when: r.when, value: m[cls][key] });
	}
	return out;
}

function ternary(cases, base, g, fmt) {
	return cases.reduceRight(
		(acc, c) => `${condition(c.when, g)} ? ${fmt(c.value)} : ${acc}`,
		base,
	);
}

function condition(when, g) {
	const parts = Object.entries(when).map(
		([p, v]) => `${useVar(p, g)} === ${JSON.stringify(String(v))}`,
	);
	return parts.length > 1 ? `(${parts.join(" && ")})` : parts[0] || "true";
}

function useVar(p, g) {
	g.used.add(p);
	return g.vars[p] || camelSafe(p);
}

// ---------------------------------------------------------------- íconos
// Archivo SVG → componente React; los íconos repetidos ya vienen unificados por el extractor
function iconComponents(outDir, list) {
	const out = new Map();
	const taken = new Set();
	for (const { file } of list) {
		if (out.has(file)) continue;
		let svg;
		try {
			svg = fs.readFileSync(path.join(outDir, file), "utf8");
		} catch {
			continue; // sin --assets o no exportado: se dibuja un marcador
		}
		let name = pascal(path.basename(file, ".svg")) || "Icon";
		if (!/^[A-Z]/.test(name)) name = "Icon" + name;
		let unique = name;
		for (let i = 2; taken.has(unique); i++) unique = name + i;
		taken.add(unique);
		out.set(file, { name: unique, jsx: svgToJsx(svg) });
	}
	return out;
}

function iconsModule(icons) {
	const parts = [...icons.values()].map(
		({ name, jsx }) =>
			`export function ${name}(props: SVGProps<SVGSVGElement>) {\n  return (\n${indent(jsx, 4)}\n  );\n}\n`,
	);
	return (
		"// Generado por figspec: íconos exportados desde Figma (los monocromos usan currentColor).\n" +
		'import type { SVGProps } from "react";\n\n' +
		parts.join("\n")
	);
}

// SVG de Figma → JSX: atributos en camelCase, style como objeto y {...props} en la raíz
function svgToJsx(svg) {
	let first = true;
	return svg
		.replace(/<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[\s\S]*?>/g, "")
		.trim()
		.replace(/<([A-Za-z][\w:.-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g, (m, tag, attrs, self) => {
			const out = [];
			attrs.replace(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g, (a, name, dq, sq) => {
				const value = dq !== undefined ? dq : sq !== undefined ? sq : "";
				if (name === "style") out.push(`style={${styleObject(cssText(value))}}`);
				else out.push(`${jsxAttr(name)}=${JSON.stringify(value)}`);
				return "";
			});
			if (tag === "svg" && first) {
				out.push("{...props}");
				first = false;
			}
			return `<${tag}${out.map((a) => " " + a).join("")}${self ? " /" : ""}>`;
		})
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l, i, all) => (i === 0 || i === all.length - 1 ? l : "  " + l)) // hijos del <svg>
		.join("\n");
}

function jsxAttr(name) {
	if (name === "class") return "className";
	if (name.startsWith("data-") || name.startsWith("aria-")) return name;
	return name.replace(/[:-]([a-z])/g, (m, c) => c.toUpperCase());
}

function cssText(s) {
	const out = {};
	for (const decl of s.split(";")) {
		const i = decl.indexOf(":");
		if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
	}
	return out;
}

// { "font-weight": "700" } → {{ fontWeight: "700" }} (los -webkit-… pasan a Webkit…)
function styleObject(css) {
	const entries = Object.entries(css).map(([k, v]) => {
		const key = k.replace(/^-(webkit|moz|ms)-/, (m, p) => p[0].toUpperCase() + p.slice(1) + "-")
			.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
		return `${IDENT.test(key) ? key : JSON.stringify(key)}: ${JSON.stringify(v)}`;
	});
	return `{ ${entries.join(", ")} }`;
}

// ---------------------------------------------------------------- utilidades
// Texto literal en JSX: tal cual si es seguro; si no, como expresión
function literal(s) {
	return /^[^{}<>&\n]*$/.test(s) && s.trim() === s && s ? s : `{${JSON.stringify(s)}}`;
}

function pad(n) {
	return " ".repeat(n);
}

function indent(s, n) {
	return s
		.split("\n")
		.map((l) => pad(n) + l)
		.join("\n");
}

function words(s) {
	return String(s)
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean);
}
function pascal(s) {
	return words(s)
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join("");
}
function camelSafe(s) {
	const p = pascal(s);
	return p ? p[0].toLowerCase() + p.slice(1) : "prop";
}
function kebab(s) {
	return words(s).join("-").toLowerCase();
}

module.exports = { generateReact };
