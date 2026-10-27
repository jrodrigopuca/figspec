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
 *
 * Como comando (npm run react [-- componente]) lleva el componente a tu proyecto: vuelve a
 * generar la salida (paquete + decisiones, siempre al día) y copia la carpeta del componente a
 * FIGMA_REACT_DIR/<Componente>/ (o --to <carpeta>), con un manifiesto para reemplazar solo lo que
 * generó antes. Avisa qué cambia en la API (componentes, props, clases) respecto de la entrega
 * anterior; --dry-run solo lo muestra.
 */

const fs = require("fs");
const path = require("path");
const {
	RESERVED,
	IDENT,
	textCases,
	propCases,
	baseText,
	cssClasses,
	propDefaults,
	extractedRun,
	pascal,
	camelSafe,
	kebab,
} = require("./spec");

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
		iconType: false,
		lists: new Map(), // ítems extraídos renderizados con .map: prop → { sub, items }
	};
	for (const [p, def] of Object.entries(comp.props || {}))
		// Una prop de ícono es un componente: en JSX su variable va en mayúscula (<Icon />)
		g.vars[p] =
			def.type === "icon"
				? pascal(p) || "IconProp"
				: RESERVED.has(p) || !IDENT.test(p)
					? `${camelSafe(p)}Value`
					: p;

	// Cada variante con estructura propia se resuelve con un return anticipado
	const branches = (comp.variantStructures || []).map(
		(v) =>
			`  if (${condition(v.when, g)}) {\n    return (\n${renderEl(v.structure, g, 6, true)}\n    );\n  }\n`,
	);
	const main = renderEl(comp.structure, g, 4, true);

	const defaults = Object.fromEntries(
		Object.entries(propDefaults(comp)).map(([p, v]) => [p, JSON.stringify(v)]),
	);
	const typeLines = Object.entries(comp.props || {}).map(
		([p, def]) => `  ${IDENT.test(p) ? p : JSON.stringify(p)}?: ${tsType(def, g)};`,
	);
	// Listas de ítems: una prop con los datos de Figma como valor por defecto
	const consts = [];
	for (const [prop, { sub, items, constName }] of g.lists) {
		typeLines.push(`  ${prop}?: ${sub}Props[];`);
		consts.push(
			`const ${constName}: ${sub}Props[] = [\n${items.map((o) => `  ${o},`).join("\n")}\n];\n`,
		);
	}
	typeLines.push("  className?: string;");
	const params = Object.keys(comp.props || {})
		.filter((p) => g.used.has(p))
		.map((p) => {
			const v = g.vars[p];
			const head = v === p ? p : `${IDENT.test(p) ? p : JSON.stringify(p)}: ${v}`;
			return defaults[p] !== undefined ? `${head} = ${defaults[p]}` : head;
		});
	for (const [prop, { constName }] of g.lists) params.push(`${prop} = ${constName}`);
	params.push("className");

	const imports = [];
	const types = [g.reactNode && "ReactNode", g.iconType && "ComponentType", g.iconType && "SVGProps"];
	if (types.some(Boolean))
		imports.push(`import type { ${types.filter(Boolean).join(", ")} } from "react";`);
	imports.push(`import styles from "./${comp.name}.module.css";`);
	const listTypes = new Set([...g.lists.values()].map((l) => l.sub));
	for (const c of [...g.components].sort())
		imports.push(
			`import { ${c}${listTypes.has(c) ? `, type ${c}Props` : ""} } from "./${c}";`,
		);
	if (g.icons) imports.push('import * as Icons from "./icons";');
	for (const [file, v] of g.images) imports.push(`import ${v} from "./${file}";`);

	return (
		`// Generado por figspec desde Figma ("${comp.figmaName}"). Los cambios manuales se pierden al regenerar.\n` +
		`${imports.join("\n")}\n\n` +
		`export type ${comp.name}Props = {\n${typeLines.join("\n")}\n};\n\n` +
		(consts.length ? `// Datos de los ítems tal como están en Figma; reemplázalos con la prop\n${consts.join("\n")}\n` : "") +
		`export function ${comp.name}({ ${params.join(", ")} }: ${comp.name}Props) {\n` +
		branches.join("") +
		`  return (\n${main}\n  );\n}\n`
	);
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
	if (def.type === "icon") {
		g.iconType = true;
		return "ComponentType<SVGProps<SVGSVGElement>>";
	}
	return "unknown";
}

// ---------------------------------------------------------------- JSX
function renderEl(el, g, n, isRoot) {
	let jsx;
	if (el.bind && el.bind.swap) jsx = pad(n) + `{${useVar(el.bind.swap, g)}}`;
	else if (el.bind && el.bind.icon) {
		// Ícono recibido como prop (componente): se dibuja con las clases de esta posición
		const Icon = useVar(el.bind.icon, g);
		const cls = classAttr(el, g, false);
		jsx = `${pad(n)}{${Icon} && <${Icon}${cls ? " " + cls : ""} />}`;
	}
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
	if (isRoot) {
		for (const [p, def] of Object.entries(g.comp.props || {}))
			if (def.type === "variant") attrs.push(`data-${kebab(p)}={${useVar(p, g)}}`);
		// Accesibilidad según el estado (comp.aria, deducido por el extractor)
		for (const { attr, prop, values } of g.comp.aria || []) {
			const v = useVar(prop, g);
			const cond = values.map((x) => `${v} === ${JSON.stringify(x)}`).join(" || ");
			attrs.push(
				attr === "aria-current"
					? `${attr}={${cond} ? "true" : undefined}`
					: `${attr}={${values.length > 1 ? `(${cond})` : cond} || undefined}`,
			);
		}
	}
	const open = `<${tag}${attrs.filter(Boolean).map((a) => " " + a).join("")}`;

	const kids = [];
	const text = textContent(el, g);
	// Un texto solo y corto va en la misma línea: <span …>Dashboard</span>
	if (text && text.length === 1 && !(el.children || []).length) {
		const line = `${pad(n)}${open}>${text[0]}</${tag}>`;
		if (line.length <= 100) return line;
	}
	if (text) kids.push(...text.map((t) => pad(n + 2) + t));
	const children = el.children || [];
	for (let i = 0; i < children.length; i++) {
		const run = extractedRun(children, i, g.env.subs);
		if (run) {
			kids.push(renderList(run, g, n + 2));
			i += run.length - 1;
		} else kids.push(renderEl(children[i], g, n + 2, false));
	}
	if (!kids.length) return `${pad(n)}${open} />`;
	return `${pad(n)}${open}>\n${kids.join("\n")}\n${pad(n)}</${tag}>`;
}

// Contenido de un texto: prop enlazada, texto que cambia por variante, segmentos o literal
function textContent(el, g) {
	if (el.bind && el.bind.text) return [`{${useVar(el.bind.text, g)}}`];
	const cases = textCases(g.comp, el);
	if (cases.length)
		return [`{${ternary(cases, JSON.stringify(baseText(el)), g, (v) => JSON.stringify(v))}}`];
	if (el.segments)
		return el.segments.map((s) =>
			s.css ? `<span style={${styleObject(s.css)}}>${literal(s.text)}</span>` : literal(s.text),
		);
	if (el.text !== undefined && el.text !== "") return [literal(el.text)];
	return null;
}

// ---------------------------------------------------------------- listas de ítems extraídos
// Los grupos los detecta extractedRun (spec.js); aquí se escriben como .map sobre un array
function renderList(run, g, n) {
	const first = run[0];
	g.components.add(first.component);
	const defs = (g.env.subs[first.component] || {}).props || {};
	// Una prop por lista, con el nombre del subcomponente: NavItem → navItems
	const base = `${camelSafe(first.component)}s`;
	let prop = base;
	for (let k = 2; g.lists.has(prop) || (g.comp.props || {})[prop]; k++) prop = `${base}${k}`;
	const items = run.map((el) => {
		const fields = [];
		for (const [k, v] of Object.entries(el.props || {})) {
			const val = propValue(v, (defs[k] || {}).type, g);
			if (val !== null) fields.push(`${IDENT.test(k) ? k : JSON.stringify(k)}: ${val}`);
		}
		return `{ ${fields.join(", ")} }`;
	});
	g.lists.set(prop, { sub: first.component, items, constName: `default${prop[0].toUpperCase()}${prop.slice(1)}` });
	// key: el label si todos lo tienen y es único; si no, el índice
	const labels = run.map((el) => (el.props || {}).label);
	const byLabel = labels.every((l) => typeof l === "string") && new Set(labels).size === labels.length;
	const cls = classAttr(first, g, false);
	return (
		`${pad(n)}{${prop}.map((item${byLabel ? "" : ", i"}) => (\n` +
		`${pad(n + 2)}<${first.component} key={${byLabel ? "item.label" : "i"}}${cls ? " " + cls : ""} {...item} />\n` +
		`${pad(n)}))}`
	);
}

function renderInstance(el, g, n) {
	g.components.add(el.component);
	const sub = g.env.subs[el.component];
	const defs = (sub && sub.props) || {};
	const attrs = [classAttr(el, g, false)];
	for (const [k, v] of Object.entries(el.props || {})) {
		const type = (defs[k] || {}).type;
		const cases = propCases(g.comp, el, k);
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
	if (type === "icon") {
		// La prop recibe el componente del ícono que corresponde a ese archivo
		const icon = typeof v === "string" && g.env.icons.get(v);
		if (!icon) return null;
		g.icons = true;
		return `Icons.${icon.name}`;
	}
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
// Cadena de ternarios: gana el primer caso que se cumple (como pickCase en spec.js)
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

// ---------------------------------------------------------------- npm run react
const MANIFEST = ".figspec-manifest.json";

// API pública de lo generado: por componente, sus props (tipo y opciones) y sus clases
function apiSummary(spec) {
	const out = {};
	for (const comp of [spec.component, ...Object.values(spec.subcomponents || {})]) {
		const props = {};
		for (const [k, def] of Object.entries(comp.props || {}))
			props[k] = def.type === "variant" && def.options ? `${def.type}: ${def.options.join(" | ")}` : def.type;
		out[comp.name] = { props, classes: [...cssClasses(comp)].sort() };
	}
	return out;
}

// Qué cambia de una entrega a otra. breaking: lo que puede romper código que ya usa el componente
// (componentes o props que se quitan, tipos u opciones que cambian); info: lo que se agrega o
// cambia por dentro (clases de los CSS Modules)
function apiChanges(before, after) {
	const breaking = [];
	const info = [];
	if (!before) return { breaking, info, first: true };
	for (const name of Object.keys(before))
		if (!after[name]) breaking.push(`Se quitó el componente ${name}.`);
	for (const [name, next] of Object.entries(after)) {
		const prev = before[name];
		if (!prev) {
			info.push(`Componente nuevo: ${name}.`);
			continue;
		}
		for (const [k, t] of Object.entries(prev.props))
			if (!(k in next.props)) breaking.push(`${name}: se quitó la prop ${k}.`);
			else if (next.props[k] !== t) breaking.push(`${name}: la prop ${k} cambió (${t} → ${next.props[k]}).`);
		for (const k of Object.keys(next.props)) if (!(k in prev.props)) info.push(`${name}: prop nueva ${k} (${next.props[k]}).`);
		const gone = prev.classes.filter((c) => !next.classes.includes(c));
		const added = next.classes.filter((c) => !prev.classes.includes(c));
		if (gone.length || added.length)
			info.push(`${name}: clases ${[...gone.map((c) => `−.${c}`), ...added.map((c) => `+.${c}`)].join(" ")} (solo importa si tu CSS o tu código usan esas clases).`);
	}
	return { breaking, info, first: false };
}

function cli(argv) {
	const os = require("os");
	const { spawnSync } = require("child_process");
	const { loadDefaultEnv, expandHome } = require("./env");
	loadDefaultEnv();
	let to = null;
	let dry = false;
	let force = false;
	const pass = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--to") to = argv[++i];
		else if (argv[i] === "--dry-run") dry = true;
		else if (argv[i] === "--force") force = true;
		else if (argv[i] !== "--react") pass.push(argv[i]);
	}
	const base = expandHome(to || process.env.FIGMA_REACT_DIR);
	if (!base) {
		console.error("✖ Falta el destino: define FIGMA_REACT_DIR en el .env (p. ej. FIGMA_REACT_DIR=src/components) o usa --to <carpeta>.");
		return 1;
	}

	// 1. La salida al día: el extractor con el paquete y las decisiones actuales
	const report = path.join(os.tmpdir(), `figspec-react-${process.pid}-${Date.now()}.json`);
	const r = spawnSync(process.execPath, [path.join(__dirname, "extractor.js"), ...pass, "--react", "--report", report], { encoding: "utf8", env: process.env });
	process.stderr.write(r.stderr || "");
	if (r.status !== 0) return r.status || 1;
	const info = JSON.parse(fs.readFileSync(report, "utf8"));
	fs.rmSync(report, { force: true });
	const spec = JSON.parse(fs.readFileSync(path.join(info.outDir, "component.json"), "utf8"));
	const part = spec.component.name;
	const outFiles = JSON.parse(fs.readFileSync(path.join(info.outDir, MANIFEST), "utf8")).files;
	// La carpeta del componente y, junto a ella, los tokens (cada var() trae su valor de respaldo)
	const files = outFiles.filter((f) => f.startsWith(`${part}/`)).map((f) => [path.join(info.outDir, f), f.slice(part.length + 1)]);
	if (fs.existsSync(path.join(info.outDir, "tokens.css"))) files.push([path.join(info.outDir, "tokens.css"), "tokens.css"]);

	// 2. El destino: solo se reemplaza lo que generó figspec antes
	const dest = path.join(base, part);
	let prev = null;
	try {
		prev = JSON.parse(fs.readFileSync(path.join(dest, MANIFEST), "utf8"));
	} catch {
		// primera entrega en esa carpeta
	}
	if (!prev && fs.existsSync(dest) && fs.readdirSync(dest).length && !force) {
		console.error(`✖ ${dest} ya existe y no la generó figspec: no se escribe nada para no pisar tus archivos. Usa otra carpeta (--to) o --force.`);
		return 1;
	}
	// Si antes se entregó con otro nombre, la carpeta vieja queda: se avisa
	const nodeId = spec.meta && spec.meta.source && spec.meta.source.node;
	const elsewhere = [];
	for (const name of fs.existsSync(base) ? fs.readdirSync(base) : []) {
		if (name === part) continue;
		try {
			const m = JSON.parse(fs.readFileSync(path.join(base, name, MANIFEST), "utf8"));
			if (m.component === nodeId) elsewhere.push(name);
		} catch {
			// no es una entrega de figspec
		}
	}

	// 3. Qué cambia en la API
	const api = apiSummary(spec);
	const changes = apiChanges(prev && prev.api, api);
	if (changes.first) console.error(`↺ Primera entrega de ${part} en ${dest}.`);
	else if (!changes.breaking.length && !changes.info.length) console.error(`↺ Sin cambios en la API de ${part}.`);
	if (changes.breaking.length) {
		console.error(`⚠ Cambios que pueden romper el código que ya usa ${part}:`);
		for (const c of changes.breaking) console.error(`   ${c}`);
	}
	if (changes.info.length) {
		console.error("… Otros cambios:");
		for (const c of changes.info) console.error(`   ${c}`);
	}
	for (const name of elsewhere) console.error(`⚠ Este componente se entregó antes como ${name} (${path.join(base, name)}): bórrala si ya no se usa.`);
	if (dry) {
		console.error(`… --dry-run: no se escribió nada en el destino (${files.length} archivos irían a ${dest}).`);
		return 0;
	}

	const root = path.resolve(dest);
	const next = new Set(files.map(([, rel]) => rel));
	for (const rel of (prev && prev.files) || []) {
		const file = path.resolve(root, rel);
		if (!next.has(rel) && file.startsWith(root + path.sep)) fs.rmSync(file, { force: true });
	}
	for (const [src, rel] of files) {
		const file = path.join(dest, rel);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.copyFileSync(src, file);
	}
	fs.writeFileSync(path.join(dest, MANIFEST), JSON.stringify({ generatedBy: "figspec", component: nodeId, files: [...next].sort(), api }, null, 2) + "\n");
	console.error(`✔ ${dest}/ (${files.length} archivos): import { ${part} } from "<ruta a ${path.basename(base)}>/${part}";`);
	return 0;
}

if (require.main === module) process.exitCode = cli(process.argv.slice(2));

module.exports = { generateReact, apiSummary, apiChanges };
