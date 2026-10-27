#!/usr/bin/env node
/**
 * figspec — extractor
 * Convierte un componente exportado desde Figma con el plugin (plugin/) en:
 *   - component.json   → estructura (componente + subcomponentes) y estilos CSS por clase
 *   - *.module.css     → un CSS Module por componente, listo para React
 *   - tokens.css       → variables CSS (:root) de los tokens usados
 *   - assets/          → íconos (SVG) e imágenes, y preview.png
 *
 * Requisitos: Node 18+. No usa la red: todo viene en el paquete del plugin.
 *
 * Uso:
 *   1. En Figma, exporta el componente con el plugin "figspec export" → figspec-<nombre>.json
 *   2. node extractor.js figspec-<nombre>.json [opciones]
 *
 * Opciones (parámetro > variable de entorno > .env > valor por defecto):
 *   <archivo>         Paquete del plugin (o respuesta de /v1/files/:key/nodes).   FIGMA_FROM
 *   --name <Nombre>   Nombre del componente en código (si en Figma es "Frame 1"). FIGMA_NAME
 *   --out-dir <dir>   Carpeta de salida (por defecto: figma-<componente>/).       FIGMA_OUT_DIR
 *   --no-assets       No escribe íconos ni imágenes.                              FIGMA_ASSETS=false
 *   --no-png          No escribe preview.png.                                     FIGMA_PNG=false
 *   --shallow         No describe los subcomponentes, solo cómo se usan.          FIGMA_SHALLOW=true
 *   --no-css          Solo genera component.json.                                 FIGMA_CSS=false
 *   --react           Genera además componentes React (TypeScript), ver react.js.  FIGMA_REACT=true
 *   --extract-repeated  Extrae los ítems repetidos a un subcomponente con props y estados.
 *                                                                               FIGMA_EXTRACT_REPEATED=true
 *   --assets, --png, --no-shallow, --css   Anulan lo definido en el .env.
 *
 * Cada ejecución reemplaza la salida anterior: borra solo los archivos que generó antes
 * (registrados en .figspec-manifest.json); el resto de la carpeta no se toca.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const VECTOR_TYPES = new Set([
	"VECTOR",
	"BOOLEAN_OPERATION",
	"STAR",
	"REGULAR_POLYGON",
]);
const ABSENT = Symbol("absent");
// Espacio que el borde CSS ocupa hacia adentro en cada lado (se descuenta de padding y offsets)
const NO_INSET = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const allSides = (w) => ({ top: w, right: w, bottom: w, left: w });

// ---------------------------------------------------------------- .env
// Lee la configuración (FIGMA_FROM, FIGMA_OUT_DIR…) desde un .env en la carpeta actual o en la
// del script. Las variables ya definidas en el entorno tienen prioridad.
loadEnv([path.join(process.cwd(), ".env"), path.join(__dirname, ".env")]);

function loadEnv(files) {
	for (const file of [...new Set(files)]) {
		let text;
		try {
			text = fs.readFileSync(file, "utf8");
		} catch {
			continue;
		}
		for (const line of text.split(/\r?\n/)) {
			const m = line.match(
				/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/,
			);
			if (!m || process.env[m[1]] !== undefined) continue;
			let v = m[2];
			if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
			else v = v.replace(/\s+#.*$/, "");
			process.env[m[1]] = v;
		}
	}
}

// ---------------------------------------------------------------- CLI
// Valores por defecto desde el entorno (.env incluido); los parámetros los anulan.
const opts = {
	from: process.env.FIGMA_FROM || null,
	name: process.env.FIGMA_NAME || null,
	outDir: process.env.FIGMA_OUT_DIR || null,
	css: envFlag("FIGMA_CSS", true),
	assets: envFlag("FIGMA_ASSETS", true),
	png: envFlag("FIGMA_PNG", true),
	shallow: envFlag("FIGMA_SHALLOW", false),
	react: envFlag("FIGMA_REACT", false),
	extractRepeated: envFlag("FIGMA_EXTRACT_REPEATED", false),
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
	const a = argv[i];
	if (a === "--assets") opts.assets = true;
	else if (a === "--no-assets") opts.assets = false;
	else if (a === "--png") opts.png = true;
	else if (a === "--no-png") opts.png = false;
	else if (a === "--shallow") opts.shallow = true;
	else if (a === "--no-shallow") opts.shallow = false;
	else if (a === "--css") opts.css = true;
	else if (a === "--no-css") opts.css = false;
	else if (a === "--react") opts.react = true;
	else if (a === "--extract-repeated") opts.extractRepeated = true;
	else if (a === "--no-extract-repeated") opts.extractRepeated = false;
	else if (a === "--no-react") opts.react = false;
	else if (a === "--out-dir") opts.outDir = argv[++i];
	else if (a === "--name") opts.name = argv[++i];
	else if (a === "--from" || a === "--json") opts.from = argv[++i];
	else if (a === "-h" || a === "--help") {
		printHelp();
		process.exit(0);
	} else if (!a.startsWith("--")) opts.from = a;
	else fail(`Opción desconocida: ${a}`);
}

function envFlag(name, def) {
	const v = (process.env[name] || "").trim();
	if (!v) return def;
	if (/^(1|true|yes|si|sí|on)$/i.test(v)) return true;
	if (/^(0|false|no|off)$/i.test(v)) return false;
	fail(`${name} debe ser true o false (valor actual: "${v}").`);
}

const ctx = {
	fileKey: null,
	bundle: null, // paquete del plugin; null si la entrada es una respuesta de /nodes
	styles: {},
	components: {},
	componentSets: {},
	variables: {},
	tokens: new Map(),
	textStyles: {},
	unnamedVars: false,
	subs: new Map(),
	shallowSubs: new Map(), // id de componente → nombre en código (con --shallow)
	codeNames: new Set(), // nombres de componente ya usados (en minúsculas: archivos en macOS/Windows)
	renamed: new Map(), // clase sugerida → nombre genérico de Figma (para avisar en notes)
	namesById: new Map(), // nodeId → nombre elegido en el plugin (names.byId del paquete)
	namesUsed: new Set(), // ids de namesById que se aplicaron (para avisar de los sobrantes)
	elSignature: new WeakMap(), // elemento de structure → firma estructural de su capa
	elId: new WeakMap(), // elemento de structure → id de su capa en Figma
	statesById: new Map(), // id de un ítem repetido → nombre de estado elegido en el plugin
	icons: new Map(), // componentId | node.id → { name, id, file }
	iconFiles: new Map(), // nombre de archivo → veces usado
	instanceClasses: new WeakMap(), // componente → clases que ubican instancias
	imageRefs: new Set(),
	notes: new Set(),
	generated: new Set(), // archivos escritos en la carpeta de salida (rutas relativas)
};

// ---------------------------------------------------------------- main
function main() {
	if (!opts.from) {
		printHelp();
		fail(
			"Falta el paquete: exporta el componente con el plugin (plugin/) y pásalo como parámetro (node extractor.js figspec-<nombre>.json) o en FIGMA_FROM.",
		);
	}
	if (opts.react && !opts.css)
		fail("--react usa los CSS Modules: quita --no-css (o FIGMA_CSS=false).");
	let data;
	try {
		data = JSON.parse(fs.readFileSync(opts.from, "utf8"));
	} catch (e) {
		fail(`No se pudo leer ${opts.from}: ${e.message}`);
	}
	let nodeId = Object.keys(data.nodes || {})[0];
	if (!nodeId)
		fail(
			`${opts.from} no es un paquete del plugin ni una respuesta de /v1/files/:key/nodes.`,
		);
	ctx.fileKey = "(local)";
	// Paquete del plugin: trae además íconos, imágenes, vista previa y nombres de variables
	if (data.figspec) {
		// 1: paquete básico · 2: además, nombres elegidos en la ventana del plugin (names)
		if (!(data.figspec >= 1 && data.figspec <= 2))
			fail(
				`${opts.from} es un paquete figspec ${data.figspec}, más nuevo que este extractor: actualízalo.`,
			);
		ctx.bundle = data;
		nodeId = data.nodeId || nodeId;
		ctx.fileKey = data.fileKey || "(plugin)";
		for (const v of Object.values(data.variables || {})) ctx.variables[v.id] = v;
		const names = data.names || {};
		ctx.namesById = new Map(Object.entries(names.byId || {}).filter(([, v]) => v));
		ctx.statesById = new Map(
			Object.entries(names.states || {})
				.map(([id, v]) => [id, String(v).trim()])
				.filter(([, v]) => v),
		);
		if (!opts.name && names.root) opts.name = names.root; // --name tiene prioridad
		console.error(
			`↺ Paquete del plugin: "${data.name}", exportado el ${new Date(data.exportedAt).toLocaleString()}.`,
		);
	}

	const entry = data.nodes[nodeId];
	if (!entry || !entry.document) fail(`No se encontró el nodo ${nodeId} en ${opts.from}.`);
	ctx.styles = entry.styles || {};
	ctx.components = entry.components || {};
	ctx.componentSets = entry.componentSets || {};

	const root = entry.document;
	const component = buildRoot(root);
	// La raíz nunca se renombra sola: es el nombre público del componente
	if (!opts.name && isGeneric(component.figmaName)) {
		const msg = `El componente se llama "${component.figmaName}" en Figma: dale un nombre con --name (p. ej. --name SideMenu).`;
		console.error(`… ${msg}`);
		ctx.notes.add(msg);
	}
	const subcomponents = buildSubs();
	ctx.rootComponent = component;
	for (const comp of [component, ...Object.values(subcomponents)]) {
		const rep = findRepeated(comp);
		if (rep.length) comp.repeated = rep;
		if (opts.extractRepeated) extractRepeated(comp, subcomponents);
	}
	// Una respuesta de /nodes (API REST) no trae los archivos: las rutas quedarían sin archivo
	if (!ctx.bundle && opts.assets && (ctx.icons.size || ctx.imageRefs.size)) {
		const msg = `La entrada no es un paquete del plugin: los ${ctx.icons.size} ícono(s) y ${ctx.imageRefs.size} imagen(es) no están en la salida y sus rutas (assets/…) quedan sin archivo. Exporta con el plugin para incluirlos.`;
		console.error(`… ${msg}`);
		ctx.notes.add(msg);
	}

	const result = {
		meta: {
			source: { file: ctx.fileKey, node: nodeId },
			notes: notes(subcomponents),
		},
		component,
	};
	if (Object.keys(subcomponents).length) result.subcomponents = subcomponents;
	if (ctx.shallowSubs.size)
		result.externalComponents = [...ctx.shallowSubs.values()];
	if (ctx.icons.size)
		result.icons = iconList();
	if (ctx.tokens.size)
		result.tokens = Object.fromEntries(
			[...ctx.tokens].sort((a, b) => a[0].localeCompare(b[0])),
		);
	if (Object.keys(ctx.textStyles).length) result.textStyles = ctx.textStyles;

	const outDir =
		opts.outDir || `figma-${kebab(component.name) || "componente"}`;
	fs.mkdirSync(outDir, { recursive: true });
	cleanOutput(outDir);
	// El componente y sus partes (CSS Modules, assets, .tsx) van en una subcarpeta lista para
	// copiar al proyecto; arriba quedan la especificación, los tokens y la vista previa.
	const part = component.name;

	// Los assets solo vienen en el paquete del plugin (una respuesta de /nodes no los trae)
	let rename = { images: {}, icons: {} };
	if (opts.assets && ctx.bundle) rename = writeAssets(outDir, part);
	if (result.icons) result.icons = iconList(); // tras deduplicar por contenido
	const fix = (s) =>
		fixIconPaths(fixImagePaths(s, rename.images), rename.icons);

	const files = [];
	const write = (name, content, adapt = fix) => {
		const file = path.join(outDir, name);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, adapt(content));
		ctx.generated.add(name);
		files.push(name);
	};
	const json = compactJson(result);
	// component.json queda fuera de la subcarpeta: sus rutas de assets la incluyen
	write("component.json", json + "\n", (s) =>
		fix(s).replace(/(^|[^\w/.-])assets\/(icons|images)\//g, `$1${part}/assets/$2/`),
	);
	if (opts.css) {
		write(`${part}/${component.name}.module.css`, moduleCss(component));
		for (const sub of Object.values(subcomponents))
			write(`${part}/${sub.name}.module.css`, moduleCss(sub));
		if (ctx.tokens.size) write("tokens.css", tokensCss());
	}
	if (opts.png && ctx.bundle && writePreview(nodeId, outDir)) {
		ctx.generated.add("preview.png");
		files.push("preview.png");
	}
	// Los componentes React se generan desde la salida ya escrita (rutas finales de assets)
	if (opts.react)
		require(path.join(__dirname, "react.js")).generateReact(outDir, part, (name, content) =>
			write(`${part}/${name}`, content, (s) => s),
		);
	writeManifest(outDir);

	console.error(`✔ ${outDir}/`);
	for (const f of files) console.error(`   ${f}`);
	console.error(`  component.json ≈ ${Math.ceil(json.length / 4)} tokens`);
}

// ---------------------------------------------------------------- manifiesto de salida
// Lista de archivos que generó el extractor en la carpeta de salida. Cada ejecución borra solo
// esos antes de escribir: la carpeta puede ser parte de un proyecto (p. ej. src/components).
const MANIFEST = ".figspec-manifest.json";

function readManifest(outDir) {
	try {
		return JSON.parse(fs.readFileSync(path.join(outDir, MANIFEST), "utf8")).files || [];
	} catch {
		return [];
	}
}

function writeManifest(outDir) {
	fs.writeFileSync(
		path.join(outDir, MANIFEST),
		JSON.stringify({ generatedBy: "figspec", files: [...ctx.generated].sort() }, null, 2) +
			"\n",
	);
}

function cleanOutput(outDir) {
	const root = path.resolve(outDir);
	let removed = 0;
	const dirs = new Set();
	for (const rel of readManifest(outDir)) {
		const file = path.resolve(root, rel);
		if (!file.startsWith(root + path.sep)) continue; // nunca fuera de la carpeta de salida
		if (fs.existsSync(file)) {
			fs.rmSync(file, { force: true });
			removed++;
		}
		for (let d = path.dirname(file); d !== root && d.startsWith(root + path.sep); d = path.dirname(d))
			dirs.add(d);
	}
	// Carpetas que quedaron vacías (subcarpeta del componente, assets/…), de la más profunda a la raíz
	for (const dir of [...dirs].sort((a, b) => b.length - a.length))
		try {
			fs.rmdirSync(dir); // solo si quedó vacía
		} catch {
			/* tiene otros archivos */
		}
	fs.rmSync(path.join(root, MANIFEST), { force: true });
	if (removed)
		console.error(`↻ Salida anterior reemplazada (${removed} archivo(s) en ${outDir}/).`);
}

// ---------------------------------------------------------------- assets del paquete
// Vienen dentro del JSON del plugin: SVG como texto, binarios (imágenes, PNG) en base64.
function bundleAssets(kind, ids) {
	const b = ctx.bundle;
	const out = new Map();
	for (const id of ids) {
		const v =
			kind === "icons"
				? (b.icons || {})[id]
				: kind === "images"
					? (b.images || {})[id]
					: id === b.nodeId
						? b.preview
						: null;
		if (v) out.set(id, Buffer.from(v, kind === "icons" ? "utf8" : "base64"));
	}
	const missing = ids.length - out.size;
	const what = { icons: "ícono(s)", images: "imagen(es)", preview: "vista previa" }[kind];
	const option = kind === "preview" ? "Vista previa (PNG)" : "Íconos (SVG) e imágenes";
	if (missing)
		console.error(
			`… El paquete no incluye ${kind === "preview" ? "la" : missing} ${what}; expórtalo desde el plugin con "${option}" activado.`,
		);
	return out;
}


// ---------------------------------------------------------------- componentes y variantes
function buildRoot(root) {
	if (root.type === "COMPONENT_SET") {
		const defs = root.componentPropertyDefinitions || {};
		const variants = (root.children || [])
			.filter((c) => c.type === "COMPONENT" && c.visible !== false)
			.map((c) => ({ props: parseVariantName(c.name), node: c }));
		return assemble(
			root.name,
			propsFromDefs(defs),
			variants,
			defaultVariant(defs),
			false,
		);
	}
	let name = root.name;
	let props = {};
	if (root.type === "COMPONENT") {
		const meta = ctx.components[root.id];
		if (meta && meta.componentSetId && ctx.componentSets[meta.componentSetId]) {
			name = ctx.componentSets[meta.componentSetId].name;
			for (const [k, v] of Object.entries(parseVariantName(root.name)))
				props[k] = { type: "variant", options: [v], default: v };
			ctx.notes.add(
				"Seleccionaste una sola variante; para ver todas, copia el link del component set completo.",
			);
		}
		Object.assign(
			props,
			propsFromDefs(root.componentPropertyDefinitions || {}),
		);
	} else if (root.type === "INSTANCE") {
		name = componentName(root.componentId) || root.name;
		for (const [k, v] of Object.entries(root.componentProperties || {})) {
			props[propName(k)] = { type: propType(v.type), default: displayValue(v) };
		}
	}
	return assemble(name, props, [{ props: {}, node: root }], {}, false);
}

// code: nombre en código ya reservado (subcomponentes); la raíz reserva el suyo antes de recorrer
// el árbol, así ningún subcomponente puede quitárselo.
function assemble(name, props, variants, defaults, isSub, code) {
	if (!isSub) code = codeName(opts.name || name);
	// Compartido entre variantes: la misma ruta de capas recibe la misma clase en todas.
	const reg = { byPath: new Map(), taken: new Set(["root"]) };
	let d = variants.findIndex((v) =>
		Object.entries(defaults || {}).every(([k, val]) => v.props[k] === val),
	);
	if (d < 0) d = 0;
	// La variante por defecto se recorre primero: ella decide los nombres de clase (y sus
	// sugerencias), así no dependen del orden de las variantes en Figma. `built` conserva el orden.
	const built = new Array(variants.length);
	for (const i of [d, ...variants.keys()].filter((i, k, a) => a.indexOf(i) === k))
		built[i] = buildVariant(variants[i]);

	function buildVariant(v) {
		const state = {
			styles: {},
			classes: new Set(),
			instances: new Set(),
			props: {}, // clase → props de la instancia (o ícono) en esta variante
			texts: {}, // clase → { text } en esta variante (sin los enlazados a una prop)
			reg,
			bound: {},
		};
		const structure = walk(
			v.node,
			null,
			{ needsRelative: false, inset: NO_INSET },
			state,
			{ sub: isSub },
		);
		return {
			props: v.props,
			structure,
			styles: state.styles,
			classes: state.classes,
			instances: state.instances,
			instProps: state.props,
			texts: state.texts,
			bound: state.bound,
		};
	}

	// props referenciadas por capas pero no declaradas (p. ej. si solo tenemos una instancia)
	for (const b of built)
		for (const [k, t] of Object.entries(b.bound))
			if (!props[k]) props[k] = { type: t };

	const res = { name: code, figmaName: name, props };
	ctx.instanceClasses.set(
		res,
		new Set(built.flatMap((b) => [...b.instances])),
	);
	if (built.length > 1) res.defaultVariant = built[d].props;
	res.structure = built[d].structure;
	if (built.length === 1) {
		res.styles = built[0].styles;
		return res;
	}

	const { base, variantStyles } = diffStyles(built, d);
	res.styles = base;
	if (variantStyles.length) res.variantStyles = variantStyles;

	// Contenido que cambia por variante (structure solo trae el del default): props de instancias
	// anidadas y texto. Mismo algoritmo que los estilos: agrupa por una sola prop cuando se puede.
	const contentDiff = (key) =>
		diffStyles(
			built.map((b) => ({ props: b.props, classes: b.classes, styles: b[key] })),
			d,
			null,
		).variantStyles;
	const vp = contentDiff("instProps");
	if (vp.length)
		res.variantProps = vp.map((r) => ({ when: r.when, props: r.styles }));
	const vt = contentDiff("texts");
	if (vt.length)
		res.variantText = vt.map((r) => ({
			when: r.when,
			text: Object.fromEntries(
				Object.entries(r.styles).map(([cls, v]) => [cls, v.text]),
			),
		}));

	const sig = (s) =>
		JSON.stringify(s, (k, v) =>
			k === "text" || k === "props" || k === "name" || k === "segments"
				? undefined
				: v,
		);
	const ref = sig(built[d].structure);
	const other = built
		.filter((b, i) => i !== d && sig(b.structure) !== ref)
		.map((b) => ({ when: b.props, structure: b.structure }));
	if (other.length) res.variantStructures = other;
	return res;
}

// Separa los estilos comunes (base) de los que cambian por variante.
// Si un valor depende de una sola prop, se agrupa por esa prop; si no, por la combinación completa.
// missing: valor que se emite cuando una variante no define algo que la base sí.
function diffStyles(built, d, missing = "unset") {
	const classes = new Set();
	built.forEach((b) => b.classes.forEach((c) => classes.add(c)));
	const propNames = [...new Set(built.flatMap((b) => Object.keys(b.props)))];
	const base = {};
	const rules = new Map();
	const add = (when, cls, prop, val) => {
		const key = JSON.stringify(when);
		if (!rules.has(key)) rules.set(key, { when, styles: {} });
		const r = rules.get(key);
		(r.styles[cls] = r.styles[cls] || {})[prop] =
			val === undefined ? missing : val;
	};

	for (const cls of classes) {
		const present = built.map((b) => b.classes.has(cls));
		const ref = present[d] ? d : present.indexOf(true);
		const cssProps = new Set();
		built.forEach((b) =>
			Object.keys(b.styles[cls] || {}).forEach((p) => cssProps.add(p)),
		);
		for (const prop of cssProps) {
			const vals = built.map((b, i) =>
				present[i] ? (b.styles[cls] || {})[prop] : ABSENT,
			);
			const rv = vals[ref];
			if (rv !== undefined) (base[cls] = base[cls] || {})[prop] = rv;
			const differs = vals.map((v) => v !== ABSENT && v !== rv);
			if (!differs.some(Boolean)) continue;

			let done = false;
			for (const p of propNames) {
				const m = new Map();
				let ok = true;
				vals.forEach((v, i) => {
					if (v === ABSENT) return;
					const k = built[i].props[p];
					if (m.has(k) && m.get(k) !== v) ok = false;
					else m.set(k, v);
				});
				if (!ok) continue;
				for (const [k, v] of m) if (v !== rv) add({ [p]: k }, cls, prop, v);
				done = true;
				break;
			}
			if (!done)
				vals.forEach((v, i) => {
					if (differs[i]) add(built[i].props, cls, prop, v);
				});
		}
	}
	return { base, variantStyles: [...rules.values()] };
}

function buildSubs() {
	for (let guard = 0; guard < 50; guard++) {
		const pending = [...ctx.subs.values()].filter((s) => !s.done);
		if (!pending.length) break;
		for (const s of pending) {
			s.done = true;
			const props = {};
			for (const [k, info] of Object.entries(s.propInfo)) {
				props[k] = { type: info.type };
				if (info.type === "variant") props[k].options = [...info.observed];
			}
			s.result = assemble(
				s.figmaName,
				props,
				s.variants,
				s.variants[0].props,
				true,
				s.name,
			);
		}
	}
	const out = {};
	for (const s of ctx.subs.values()) out[s.result.name] = s.result;
	return out;
}

// Nombre en código único (PascalCase); si ya está tomado se agrega un número: Button, Button2…
function codeName(figmaName) {
	const base = pascal(figmaName) || "Componente";
	let name = base;
	for (let n = 2; ctx.codeNames.has(name.toLowerCase()); n++) name = numbered(base, n);
	ctx.codeNames.add(name.toLowerCase());
	if (name !== base)
		ctx.notes.add(
			'Hay componentes distintos de Figma con el mismo nombre en código: se agregó un número (p. ej. Button2); "figmaName" conserva el nombre original.',
		);
	return name;
}

// Un subcomponente por componente de Figma (el set entero si es una variante), no por nombre:
// dos componentes distintos pueden llamarse igual (p. ej. uno local y otro de una biblioteca).
// Devuelve el nombre en código con el que se referencia la instancia.
function registerSub(cname, node) {
	const meta = ctx.components[node.componentId];
	const id = (meta && meta.componentSetId) || node.componentId || cname;
	if (opts.shallow) {
		if (!ctx.shallowSubs.has(id)) ctx.shallowSubs.set(id, codeName(cname));
		return ctx.shallowSubs.get(id);
	}
	let s = ctx.subs.get(id);
	if (!s) {
		s = {
			name: codeName(cname),
			figmaName: cname,
			variants: [],
			keys: new Set(),
			propInfo: {},
			done: false,
		};
		ctx.subs.set(id, s);
	}
	const vprops = {};
	for (const [k, v] of Object.entries(node.componentProperties || {})) {
		const n = propName(k);
		const info =
			s.propInfo[n] ||
			(s.propInfo[n] = { type: propType(v.type), observed: new Set() });
		if (v.type === "VARIANT") {
			info.observed.add(v.value);
			vprops[n] = v.value;
		}
	}
	const key = JSON.stringify(vprops);
	if (!s.keys.has(key)) {
		s.keys.add(key);
		s.variants.push({ props: vprops, node });
		s.done = false;
	}
	return s.name;
}

// ---------------------------------------------------------------- recorrido del árbol
// path: ruta de nombres desde la raíz con el índice entre hermanos homónimos (ver classFor).
function walk(node, parent, pctx, state, root, path = "") {
	const isRoot = !!root;
	// En la raíz de un subcomponente, las referencias pertenecen al componente padre
	const refs = isRoot && root.sub ? {} : node.componentPropertyReferences || {};
	if (!isRoot && node.visible === false && !refs.visible) return null; // capas ocultas sin prop: restos de diseño
	if (node.isMask)
		ctx.notes.add(
			"El componente usa máscaras de Figma; revisa esas capas (se aproximan con overflow/border-radius).",
		);

	const el = { name: node.name };
	ctx.elSignature.set(el, signature(node));
	ctx.elId.set(el, node.id);
	const iconLike = !isRoot && (VECTOR_TYPES.has(node.type) || isIconish(node));
	el.className = isRoot
		? "root"
		: classFor(
				node.name,
				path,
				state.reg,
				chosenName(node) ||
					(vagueName(node) ? () => suggestName(node, parent, iconLike) : null),
			);
	state.classes.add(el.className);
	if (node.visible === false) el.hidden = true;

	const bind = {};
	if (refs.visible) {
		bind.visible = propName(refs.visible);
		state.bound[bind.visible] = "boolean";
	}
	if (refs.characters) {
		bind.text = propName(refs.characters);
		state.bound[bind.text] = "string";
	}
	if (refs.mainComponent) {
		bind.swap = propName(refs.mainComponent);
		state.bound[bind.swap] = "node";
	}
	if (Object.keys(bind).length) el.bind = bind;

	const css = isRoot ? rootSize(node, root.sub) : placement(node, parent, pctx);
	state.styles[el.className] = css; // reserva el lugar para que las clases sigan el orden del árbol
	const put = () => {
		if (!Object.keys(css).length) delete state.styles[el.className];
	};

	// Instancia de otro componente → referencia (sus estilos van en subcomponents)
	if (!isRoot && node.type === "INSTANCE" && !isIconish(node)) {
		const cname = componentName(node.componentId) || node.name;
		el.component = registerSub(cname, node);
		state.instances.add(el.className);
		const p = {};
		for (const [k, v] of Object.entries(node.componentProperties || {}))
			p[propName(k)] = displayValue(v);
		if (Object.keys(p).length) el.props = state.props[el.className] = p;
		put();
		return el;
	}

	// Íconos y vectores → un solo <svg>
	if (!isRoot && (VECTOR_TYPES.has(node.type) || isIconish(node))) {
		const icon = iconFor(node, parent);
		el.tag = "svg";
		el.icon = icon.name;
		el.src = icon.file;
		// Un frame en HUG se ajusta a su contenido, pero aquí el contenido pasa a ser el SVG:
		// su tamaño es el de la caja exportada y hay que declararlo.
		const bb = node.absoluteBoundingBox;
		if (bb) {
			let hug = false;
			if (node.layoutSizingHorizontal === "HUG" && !css.width) {
				css.width = px(bb.width);
				hug = true;
			}
			if (node.layoutSizingVertical === "HUG" && !css.height) {
				css.height = px(bb.height);
				hug = true;
			}
			if (hug && parent && parent.layoutMode && parent.layoutMode !== "NONE")
				css["flex-shrink"] = "0";
		}
		if (node.type === "INSTANCE") {
			const p = {};
			for (const [k, v] of Object.entries(node.componentProperties || {}))
				p[propName(k)] = displayValue(v);
			if (Object.keys(p).length) el.props = state.props[el.className] = p;
		}
		// Solo los monocromos se pueden recolorear con currentColor
		const pal = vectorPalette(node);
		if (pal && pal.size === 1) {
			const c = vectorColor(node);
			if (c) css.color = c;
		} else if (!pal || pal.size > 1) el.multicolor = true; // varios colores, degradado o imagen
		put();
		return el;
	}

	let inset = NO_INSET;
	if (node.type === "TEXT") {
		el.tag = "span";
		Object.assign(css, textCss(node, el));
		// Si está enlazado a una prop, el contenido sale de la prop y no de la variante
		if (!bind.text)
			state.texts[el.className] = {
				text: el.segments ? el.segments.map((s) => s.text).join("") : el.text,
			};
	} else {
		const img = imageFill(node);
		if (img) {
			el.tag = "img";
			el.src = `assets/images/${img.imageRef}`;
			ctx.imageRefs.add(img.imageRef);
			css["object-fit"] = img.scaleMode === "FIT" ? "contain" : "cover";
		} else {
			el.tag = "div";
		}
		const stroke = strokeCss(node);
		inset = stroke.inset;
		Object.assign(css, layoutCss(node, inset));
		if (!img) Object.assign(css, fillCss(node));
		Object.assign(css, stroke.css, radiusCss(node));
	}
	Object.assign(css, effectsCss(node), miscCss(node, isRoot));

	const cctx = { needsRelative: false, inset };
	// Las capas ocultas también cuentan: en Figma las variantes suelen compartir capas y solo
	// cambiar su visibilidad, así que la posición entre homónimos es estable.
	const seen = new Map();
	const kids = (node.children || [])
		.map((c) => {
			const k = seen.get(c.name) || 0;
			seen.set(c.name, k + 1);
			return walk(c, node, cctx, state, null, `${path}\0${c.name}\0${k}`);
		})
		.filter(Boolean);
	if (kids.length) el.children = kids;
	if (cctx.needsRelative && !css.position) css.position = "relative";
	put();
	return el;
}

// ---------------------------------------------------------------- tamaño y posición
function rootSize(node, isSub) {
	const css = {};
	const bb = node.absoluteBoundingBox;
	if (!bb) return css;
	const bv = node.boundVariables || {};
	const H = node.layoutSizingHorizontal,
		V = node.layoutSizingVertical;
	const text = node.type === "TEXT";
	if (H === "FIXED" || (!H && !text)) css.width = num(bb.width, bv.width);
	else if (H === "FILL" && !isSub) css.width = "100%";
	if (!text && (V === "FIXED" || !V)) css.height = num(bb.height, bv.height);
	minMax(node, css);
	return css;
}

// Caja sin rotar, centrada donde Figma dibuja el elemento (CSS rota alrededor del centro).
// absoluteBoundingBox es la caja YA rotada; el tamaño real (size) lo agrega el plugin a los rotados.
function layoutBox(node) {
	const bb = node.absoluteBoundingBox;
	if (!bb || !rotationOf(node) || !node.size) return bb;
	const { x: w, y: h } = node.size;
	return {
		x: bb.x + bb.width / 2 - w / 2,
		y: bb.y + bb.height / 2 - h / 2,
		width: w,
		height: h,
	};
}

// Grados para CSS rotate() (horario); 0 si no está rotado o no hay geometría para saberlo.
function rotationOf(node) {
	const t = node.relativeTransform;
	if (!t || !t[0] || !t[1]) {
		// `rotation` sí viene siempre, pero la especificación no aclara su unidad
		if (Math.abs(node.rotation || 0) > 1e-3)
			ctx.notes.add(
				"Hay elementos rotados, pero la entrada no trae su geometría (size/relativeTransform): se usó la caja rotada y no se aplicó la rotación. Exporta de nuevo con la versión actual del plugin.",
			);
		return 0;
	}
	// Determinante negativo: la capa está espejada (flip). Leerla como rotación daría un ángulo
	// equivocado (p. ej. 180°), así que no se aplica nada y se avisa.
	if (t[0][0] * t[1][1] - t[0][1] * t[1][0] < 0) {
		ctx.notes.add(
			"Hay capas espejadas (flip) en Figma: no se reflejó el espejado (haría falta transform: scaleX(-1) o scaleY(-1)).",
		);
		return 0;
	}
	// Figma: [[cos, sin], [-sin, cos]] con ángulo antihorario → CSS (horario) = -ángulo
	const ang = (Math.atan2(t[1][0], t[0][0]) * 180) / Math.PI;
	return Math.abs(ang) > 0.5 ? ang : 0;
}

function placement(node, parent, pctx) {
	const css = {};
	const bb = layoutBox(node);
	if (!bb || !parent) return css;
	const bv = node.boundVariables || {};
	const W = num(bb.width, bv.width),
		Hh = num(bb.height, bv.height);
	const H = node.layoutSizingHorizontal,
		V = node.layoutSizingVertical;
	const text = node.type === "TEXT";
	const autoWidthText =
		text && (node.style || {}).textAutoResize === "WIDTH_AND_HEIGHT";
	const parentLayout =
		parent.layoutMode && parent.layoutMode !== "NONE"
			? parent.layoutMode
			: null;

	// Posición absoluta: padre sin auto layout, o hijo marcado como absoluto
	if (!parentLayout || node.layoutPositioning === "ABSOLUTE") {
		pctx.needsRelative = true;
		// Las cajas de Figma son las ya rotadas: dentro de un padre rotado, el desplazamiento se
		// calcula contra su caja rotada y no contra el padre sin rotar
		if (rotationOf(parent))
			ctx.notes.add(
				"Hay capas con posición absoluta dentro de un elemento rotado: sus posiciones se calcularon sin descontar la rotación del padre y pueden quedar desplazadas.",
			);
		// En CSS el contenedor de un hijo absoluto es la caja de padding (dentro del borde)
		const pb = parent.absoluteBoundingBox;
		const ins = pctx.inset || NO_INSET;
		const left = bb.x - pb.x - ins.left,
			top = bb.y - pb.y - ins.top;
		const right = pb.x + pb.width - (bb.x + bb.width) - ins.right;
		const bottom = pb.y + pb.height - (bb.y + bb.height) - ins.bottom;
		const iw = pb.width - ins.left - ins.right,
			ih = pb.height - ins.top - ins.bottom;
		const c = node.constraints || {};
		css.position = "absolute";
		switch (c.horizontal) {
			case "RIGHT":
				css.right = px(right);
				break;
			case "LEFT_RIGHT":
				css.left = px(left);
				css.right = px(right);
				break;
			case "CENTER":
				css.left = `calc(50% + ${rd(left + bb.width / 2 - iw / 2 - bb.width / 2)}px)`;
				break;
			case "SCALE":
				css.left = `${rd((left / iw) * 100)}%`;
				break;
			default:
				css.left = px(left);
		}
		switch (c.vertical) {
			case "BOTTOM":
				css.bottom = px(bottom);
				break;
			case "TOP_BOTTOM":
				css.top = px(top);
				css.bottom = px(bottom);
				break;
			case "CENTER":
				css.top = `calc(50% + ${rd(top + bb.height / 2 - ih / 2 - bb.height / 2)}px)`;
				break;
			case "SCALE":
				css.top = `${rd((top / ih) * 100)}%`;
				break;
			default:
				css.top = px(top);
		}
		if (c.horizontal === "SCALE")
			css.width = `${rd((bb.width / iw) * 100)}%`;
		else if (c.horizontal !== "LEFT_RIGHT" && !autoWidthText) css.width = W;
		if (c.vertical === "SCALE")
			css.height = `${rd((bb.height / ih) * 100)}%`;
		else if (c.vertical !== "TOP_BOTTOM" && !text) css.height = Hh;
		minMax(node, css);
		return css;
	}

	if (parentLayout === "GRID") {
		if (node.gridColumnSpan > 1)
			css["grid-column"] = `span ${node.gridColumnSpan}`;
		if (node.gridRowSpan > 1) css["grid-row"] = `span ${node.gridRowSpan}`;
		const al = { MIN: "start", CENTER: "center", MAX: "end" };
		if (al[node.gridChildHorizontalAlign])
			css["justify-self"] = al[node.gridChildHorizontalAlign];
		if (al[node.gridChildVerticalAlign])
			css["align-self"] = al[node.gridChildVerticalAlign];
		if (H === "FIXED" && !autoWidthText) css.width = W;
		if (V === "FIXED" && !text) css.height = Hh;
		minMax(node, css);
		return css;
	}

	// Hijo de flexbox (auto layout)
	if (rotationOf(node))
		ctx.notes.add(
			"Hay elementos rotados dentro de auto layout: Figma reserva el espacio de la caja rotada, pero en CSS la rotación no cambia el espacio que ocupa el elemento (puede requerir un contenedor con el tamaño rotado).",
		);
	const row = parentLayout === "HORIZONTAL";
	const mainS = (row ? H : V) || (node.layoutGrow === 1 ? "FILL" : "FIXED");
	const crossS =
		(row ? V : H) || (node.layoutAlign === "STRETCH" ? "FILL" : "FIXED");
	const mainDim = row ? "width" : "height",
		crossDim = row ? "height" : "width";
	const skip = (dim) =>
		(dim === "height" && text) || (dim === "width" && autoWidthText);

	if (mainS === "FILL") {
		css.flex = "1 1 0";
		css[row ? "min-width" : "min-height"] = "0";
	} else if (mainS === "FIXED" && !skip(mainDim)) {
		css[mainDim] = row ? W : Hh;
		css["flex-shrink"] = "0";
	}
	if (crossS === "FILL") css["align-self"] = "stretch";
	else if (crossS === "FIXED" && !skip(crossDim)) css[crossDim] = row ? Hh : W;
	minMax(node, css);
	return css;
}

function minMax(node, css) {
	const bv = node.boundVariables || {};
	for (const [k, p] of [
		["minWidth", "min-width"],
		["maxWidth", "max-width"],
		["minHeight", "min-height"],
		["maxHeight", "max-height"],
	]) {
		if (node[k] != null) css[p] = num(node[k], bv[k]);
	}
}

// ---------------------------------------------------------------- auto layout → flex / grid
function layoutCss(node, inset) {
	const css = {};
	const bv = node.boundVariables || {};
	const mode = node.layoutMode;
	if (mode === "HORIZONTAL" || mode === "VERTICAL") {
		const row = mode === "HORIZONTAL";
		css.display = "flex";
		css["flex-direction"] = row ? "row" : "column";
		const wrap = node.layoutWrap === "WRAP";
		if (wrap) css["flex-wrap"] = "wrap";
		if (node.primaryAxisAlignItems === "SPACE_BETWEEN")
			css["justify-content"] = "space-between";
		else {
			const j = { CENTER: "center", MAX: "flex-end" }[
				node.primaryAxisAlignItems
			];
			if (j) css["justify-content"] = j;
			if (node.itemSpacing > 0) css.gap = num(node.itemSpacing, bv.itemSpacing);
			else if (node.itemSpacing < 0)
				ctx.notes.add(
					"Hay auto layouts con espaciado negativo (elementos superpuestos); CSS no admite gap negativo: usa margin negativo.",
				);
		}
		if (wrap && node.counterAxisSpacing)
			css[row ? "row-gap" : "column-gap"] = num(
				node.counterAxisSpacing,
				bv.counterAxisSpacing,
			);
		if (wrap && node.counterAxisAlignContent === "SPACE_BETWEEN")
			css["align-content"] = "space-between";
		// En CSS el valor por defecto es stretch; en Figma es "start", por eso se declara siempre.
		css["align-items"] =
			{
				MIN: "flex-start",
				CENTER: "center",
				MAX: "flex-end",
				BASELINE: "baseline",
			}[node.counterAxisAlignItems || "MIN"] || "flex-start";
		const pad = paddingCss(node, bv, inset);
		if (pad) css.padding = pad;
	} else if (mode === "GRID") {
		css.display = "grid";
		css["grid-template-columns"] =
			node.gridColumnsSizing || `repeat(${node.gridColumnCount || 1}, 1fr)`;
		if (node.gridRowsSizing || node.gridRowCount > 1)
			css["grid-template-rows"] =
				node.gridRowsSizing || `repeat(${node.gridRowCount}, auto)`;
		if (node.gridColumnGap)
			css["column-gap"] = num(node.gridColumnGap, bv.gridColumnGap);
		if (node.gridRowGap) css["row-gap"] = num(node.gridRowGap, bv.gridRowGap);
		const pad = paddingCss(node, bv, inset);
		if (pad) css.padding = pad;
	}
	return css;
}

// En Figma el borde interior no ocupa espacio (salvo strokesIncludedInLayout);
// en CSS (border-box) sí, así que se descuenta del padding para conservar las medidas.
function paddingCss(node, bv, inset) {
	const ins = node.strokesIncludedInLayout ? NO_INSET : inset;
	const v = ["Top", "Right", "Bottom", "Left"].map((s) => {
		const raw = node["padding" + s] || 0;
		const sub = ins[s.toLowerCase()];
		const name = varRef(bv["padding" + s]);
		if (name) {
			const t = tokenize(name, px(raw));
			return sub ? `calc(${t} - ${rd(sub)}px)` : t;
		}
		return px(Math.max(0, raw - sub));
	});
	if (v.every((x) => x === "0")) return "";
	if (v.every((x) => x === v[0])) return v[0];
	if (v[0] === v[2] && v[1] === v[3]) return `${v[0]} ${v[1]}`;
	if (v[1] === v[3]) return `${v[0]} ${v[1]} ${v[2]}`;
	return v.join(" ");
}

// ---------------------------------------------------------------- relleno, borde, radio, efectos
function visiblePaints(list) {
	return (list || []).filter((p) => p.visible !== false);
}

function fillCss(node) {
	const vis = visiblePaints(node.fills);
	if (!vis.length) return {};
	const bb = node.absoluteBoundingBox || { width: 1, height: 1 };
	const layers = vis.slice().reverse(); // Figma: abajo→arriba; CSS: arriba→abajo
	const styleVar = styleToken(sty(node, "fill"));

	if (layers.length === 1 && layers[0].type === "SOLID")
		return { "background-color": styledColor(node, "fill", layers[0]) };
	const parts = layers
		.map((p, i) => {
			const last = i === layers.length - 1;
			if (p.type === "SOLID") {
				const c = solidCss(p);
				return last ? c : `linear-gradient(${c}, ${c})`;
			}
			if (p.type.startsWith("GRADIENT_"))
				return gradientCss(p, bb.width, bb.height);
			if (p.type === "IMAGE") {
				ctx.imageRefs.add(p.imageRef);
				const size = { FIT: "contain", TILE: "auto" }[p.scaleMode] || "cover";
				return `url("assets/images/${p.imageRef}") center / ${size} ${p.scaleMode === "TILE" ? "repeat" : "no-repeat"}`;
			}
			return null;
		})
		.filter(Boolean);
	if (!parts.length) return {};
	let value = parts.join(", ");
	if (styleVar && layers.length === 1) value = tokenize(styleVar, value);
	return { background: value };
}

function imageFill(node) {
	if (!["RECTANGLE", "ELLIPSE", "FRAME"].includes(node.type)) return null;
	if (node.children && node.children.length) return null;
	const vis = visiblePaints(node.fills);
	return vis.length === 1 && vis[0].type === "IMAGE" ? vis[0] : null;
}

function solidCss(p) {
	const c = color(p.color, p.opacity == null ? 1 : p.opacity);
	const n = varRef(p.boundVariables && p.boundVariables.color);
	return n ? tokenize(n, c) : c;
}

function isBound(p) {
	return !!(
		p.boundVariables &&
		p.boundVariables.color &&
		varRef(p.boundVariables.color)
	);
}

function gradientCss(p, w, h) {
	const op = p.opacity == null ? 1 : p.opacity;
	const stops = (p.gradientStops || [])
		.map((s) => {
			let c = color(s.color, op);
			const n = varRef(s.boundVariables && s.boundVariables.color);
			if (n) c = tokenize(n, c);
			return `${c} ${rd(s.position * 100)}%`;
		})
		.join(", ");
	if (p.type === "GRADIENT_LINEAR") {
		const [a, b] = p.gradientHandlePositions || [];
		let ang = 180;
		if (a && b)
			ang =
				((Math.atan2((b.x - a.x) * w, -(b.y - a.y) * h) * 180) / Math.PI +
					360) %
				360;
		return `linear-gradient(${rd(ang)}deg, ${stops})`;
	}
	if (p.type === "GRADIENT_ANGULAR") return `conic-gradient(${stops})`;
	return `radial-gradient(${stops})`;
}

function strokeCss(node) {
	const vis = visiblePaints(node.strokes);
	if (!vis.length) return { css: {}, inset: NO_INSET };
	const p = vis[vis.length - 1];
	const c =
		p.type === "SOLID"
			? styledColor(node, "stroke", p)
			: color(((p.gradientStops || [])[0] || {}).color);
	if (p.type !== "SOLID")
		ctx.notes.add(
			"Hay bordes con degradado; se aproximaron con el primer color.",
		);
	const style = (node.strokeDashes || []).length ? "dashed" : "solid";
	const bv = node.boundVariables || {};
	const w = node.strokeWeight == null ? 1 : node.strokeWeight;

	if (node.type === "LINE")
		return {
			css: { "border-top": `${num(w, bv.strokeWeight)} ${style} ${c}` },
			inset: NO_INSET,
		};

	const iw = node.individualStrokeWeights;
	if (
		iw &&
		!(iw.top === iw.right && iw.right === iw.bottom && iw.bottom === iw.left)
	) {
		const css = {};
		const inset = {};
		for (const side of ["top", "right", "bottom", "left"]) {
			inset[side] = iw[side] || 0;
			if (iw[side]) css[`border-${side}`] = `${px(iw[side])} ${style} ${c}`;
		}
		if (node.strokeAlign && node.strokeAlign !== "INSIDE")
			ctx.notes.add(
				"Hay bordes con grosor distinto por lado y alineación center/outside; se aproximaron como bordes interiores.",
			);
		return { css, inset };
	}
	if (node.strokeAlign === "OUTSIDE")
		return {
			css: { outline: `${num(w, bv.strokeWeight)} ${style} ${c}` },
			inset: NO_INSET,
		};
	// Centrado: mitad adentro (border) y mitad afuera (outline), como en Figma.
	// Con trazo punteado las dos líneas no coincidirían: se aproxima como interior.
	if (node.strokeAlign === "CENTER" && style === "solid") {
		const half = halfOf(w, bv.strokeWeight);
		return {
			css: { border: `${half} solid ${c}`, outline: `${half} solid ${c}` },
			inset: allSides(w / 2),
		};
	}
	if (node.strokeAlign === "CENTER")
		ctx.notes.add(
			"Hay bordes punteados centrados; se aproximaron como bordes interiores.",
		);
	return {
		css: { border: `${num(w, bv.strokeWeight)} ${style} ${c}` },
		inset: allSides(w),
	};
}

function halfOf(v, alias) {
	const n = varRef(alias);
	return n ? `calc(${tokenize(n, px(v))} / 2)` : px(v / 2);
}

function radiusCss(node) {
	if (node.type === "ELLIPSE") return { "border-radius": "50%" };
	const bv = node.boundVariables || {};
	const rc = node.rectangleCornerRadii;
	if (rc && !rc.every((x) => x === rc[0])) {
		const keys = [
			"topLeftRadius",
			"topRightRadius",
			"bottomRightRadius",
			"bottomLeftRadius",
		];
		return { "border-radius": rc.map((r, i) => num(r, bv[keys[i]])).join(" ") };
	}
	const r = node.cornerRadius || (rc && rc[0]);
	return r ? { "border-radius": num(r, bv.topLeftRadius) } : {};
}

function effectsCss(node) {
	const vis = (node.effects || []).filter((e) => e.visible !== false);
	const css = {};
	const text = node.type === "TEXT";
	if (text && vis.some((e) => e.type === "INNER_SHADOW"))
		ctx.notes.add(
			"Hay textos con sombra interior: CSS no la tiene para texto, se aproximó como sombra exterior (text-shadow).",
		);
	const shadows = vis
		.filter((e) => e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW")
		.map((e) => {
			const o = e.offset || {};
			const xy = `${px(o.x || 0)} ${px(o.y || 0)} ${px(e.radius || 0)}`;
			return text
				? `${xy} ${color(e.color)}`
				: `${e.type === "INNER_SHADOW" ? "inset " : ""}${xy} ${px(e.spread || 0)} ${color(e.color)}`;
		});
	if (shadows.length) {
		let v = shadows.join(", ");
		const st = styleToken(sty(node, "effect"));
		if (st) v = tokenize(st, v);
		css[text ? "text-shadow" : "box-shadow"] = v;
	}
	// El radio de blur de Figma equivale aproximadamente al doble del de CSS
	for (const e of vis) {
		if (e.type === "LAYER_BLUR") css.filter = `blur(${px(e.radius / 2)})`;
		if (e.type === "BACKGROUND_BLUR")
			css["backdrop-filter"] = `blur(${px(e.radius / 2)})`;
	}
	return css;
}

function miscCss(node, isRoot) {
	const css = {};
	if (node.opacity != null && node.opacity < 1)
		css.opacity = String(rd(node.opacity));
	const blends = {
		MULTIPLY: "multiply",
		SCREEN: "screen",
		OVERLAY: "overlay",
		DARKEN: "darken",
		LIGHTEN: "lighten",
		COLOR_DODGE: "color-dodge",
		COLOR_BURN: "color-burn",
		HARD_LIGHT: "hard-light",
		SOFT_LIGHT: "soft-light",
		DIFFERENCE: "difference",
		EXCLUSION: "exclusion",
		HUE: "hue",
		SATURATION: "saturation",
		COLOR: "color",
		LUMINOSITY: "luminosity",
	};
	if (blends[node.blendMode]) css["mix-blend-mode"] = blends[node.blendMode];
	const ang = isRoot ? 0 : rotationOf(node);
	if (ang) css.transform = `rotate(${rd(ang)}deg)`;
	if (node.clipsContent && node.children && node.children.length)
		css.overflow = "hidden";
	return css;
}

// ---------------------------------------------------------------- texto
function textCss(node, el) {
	const s = node.style || {};
	const css = fontCss(s, node.fills);
	if (s.textAlignHorizontal && s.textAlignHorizontal !== "LEFT") {
		css["text-align"] = {
			RIGHT: "right",
			CENTER: "center",
			JUSTIFIED: "justify",
		}[s.textAlignHorizontal];
	}
	if (s.textAutoResize === "WIDTH_AND_HEIGHT") css["white-space"] = "nowrap";
	if (s.textTruncation === "ENDING" || s.textAutoResize === "TRUNCATE") {
		if (s.maxLines > 1)
			Object.assign(css, {
				display: "-webkit-box",
				"-webkit-line-clamp": String(s.maxLines),
				"-webkit-box-orient": "vertical",
				overflow: "hidden",
			});
		else
			Object.assign(css, {
				"white-space": "nowrap",
				overflow: "hidden",
				"text-overflow": "ellipsis",
			});
	}

	const st = sty(node, "text");
	if (st && ctx.styles[st]) {
		el.textStyle = ctx.styles[st].name;
		if (!ctx.textStyles[el.textStyle]) {
			const { color: _c, background: _b, ...font } = fontCss(s, []);
			ctx.textStyles[el.textStyle] = font;
		}
	}

	// Figma separa líneas con \n o con U+2028; en CSS hacen falta pre-line (o pre si el texto no se
	// ajusta al ancho) para que se vean. Se normaliza a \n.
	const chars = String(node.characters || "").replace(/\u2028/g, "\n");
	if (chars.includes("\n") && !(s.textTruncation === "ENDING" && !(s.maxLines > 1)))
		css["white-space"] = css["white-space"] === "nowrap" ? "pre" : "pre-line";
	const ov = node.characterStyleOverrides || [];
	const table = node.styleOverrideTable || {};
	if (ov.some(Boolean)) {
		const segs = [];
		let start = 0;
		for (let i = 1; i <= chars.length; i++) {
			if (i < chars.length && (ov[i] || 0) === (ov[start] || 0)) continue;
			const id = ov[start] || 0;
			const seg = { text: chars.slice(start, i) };
			if (id && table[id]) {
				const t = table[id];
				const diff = {};
				const c2 = fontCss({ ...s, ...t }, t.fills || node.fills);
				for (const [k, v] of Object.entries(c2)) if (css[k] !== v) diff[k] = v;
				if (Object.keys(diff).length) seg.css = diff;
			}
			segs.push(seg);
			start = i;
		}
		el.segments = segs;
	} else {
		el.text = chars.length > 300 ? chars.slice(0, 297) + "…" : chars;
	}
	// Recién ahora: los segmentos se comparan contra el color sin token
	const solid = visiblePaints(node.fills).find((p) => p.type === "SOLID");
	if (solid && css.color) css.color = styledColor(node, "fill", solid);
	return css;
}

// Color de una pintura sólida con el estilo de color de la capa (fill/stroke) como token,
// salvo que esté enlazada a una variable (la variable tiene prioridad).
function styledColor(node, key, paint) {
	const c = solidCss(paint);
	const st = styleToken(sty(node, key));
	return st && !isBound(paint) ? tokenize(st, c) : c;
}

function fontCss(s, fills) {
	const bv = s.boundVariables || {};
	const css = {};
	if (s.fontFamily) {
		const fam = `"${s.fontFamily}"`;
		const n = varRef(bv.fontFamily);
		css["font-family"] = n ? tokenize(n, fam) : fam;
	}
	if (s.fontWeight) css["font-weight"] = num(s.fontWeight, bv.fontWeight, "");
	if (s.fontSize) css["font-size"] = num(s.fontSize, bv.fontSize);
	if (s.lineHeightUnit === "PIXELS" && s.lineHeightPx)
		css["line-height"] = num(s.lineHeightPx, bv.lineHeight);
	else if (s.lineHeightUnit === "FONT_SIZE_%" && s.lineHeightPercentFontSize)
		css["line-height"] = String(rd(s.lineHeightPercentFontSize / 100));
	else css["line-height"] = "normal";
	if (s.letterSpacing)
		css["letter-spacing"] = num(s.letterSpacing, bv.letterSpacing);
	if (s.italic) css["font-style"] = "italic";
	const tc = {
		UPPER: ["text-transform", "uppercase"],
		LOWER: ["text-transform", "lowercase"],
		TITLE: ["text-transform", "capitalize"],
		SMALL_CAPS: ["font-variant", "small-caps"],
		SMALL_CAPS_FORCED: ["font-variant", "all-small-caps"],
	}[s.textCase];
	if (tc) css[tc[0]] = tc[1];
	const td = { UNDERLINE: "underline", STRIKETHROUGH: "line-through" }[
		s.textDecoration
	];
	if (td) css["text-decoration"] = td;

	const vis = visiblePaints(fills);
	const solid = vis.find((p) => p.type === "SOLID");
	const grad = vis.find((p) => p.type.startsWith("GRADIENT_"));
	if (solid) css.color = solidCss(solid);
	else if (grad)
		Object.assign(css, {
			background: gradientCss(grad, 1, 1),
			"-webkit-background-clip": "text",
			"background-clip": "text",
			color: "transparent",
		});
	return css;
}

// ---------------------------------------------------------------- íconos
// Un archivo por componente de ícono (incluida su variante) o por vector suelto.
// La clave no puede ser el nombre: variantes de un set y capas "Vector" lo comparten.
// Las instancias toman el nombre de su componente ("Icon/Dashboard"). Los vectores sueltos con
// nombre genérico ("icon") toman el texto vecino: dashboard.svg.
function iconFor(node, parent) {
	let key = node.id,
		name = node.name,
		suggested = false;
	// Nombre neutro: el de la capa, o "icon" si es genérico ("Group 1", "Vector")
	const layer = isGeneric(node.name) ? "icon" : node.name;
	const chosen = ctx.namesById.get(node.id); // elegido en el plugin
	if (node.type !== "INSTANCE" && chosen) name = chosen;
	else if (node.type !== "INSTANCE" && isGeneric(node.name)) {
		const near = textNear(node, parent);
		[name, suggested] = near ? [near, true] : [layer, false];
	}
	if (node.type === "INSTANCE" && node.componentId) {
		key = node.componentId;
		const c = ctx.components[node.componentId];
		name = componentName(node.componentId) || node.name;
		if (c && c.componentSetId && ctx.componentSets[c.componentSetId])
			name += ` ${c.name}`; // "Icon Type=Arrow" → icon-type-arrow.svg
	}
	let icon = ctx.icons.get(key);
	if (!icon) {
		let file = kebab(name) || "icon";
		const n = (ctx.iconFiles.get(file) || 0) + 1;
		ctx.iconFiles.set(file, n);
		if (n > 1) file += `-${n}`;
		const pal = vectorPalette(node);
		icon = { name, id: node.id, file: `assets/icons/${file}.svg`, suggested, layer };
		if (pal && pal.size === 1) icon.hex = [...pal][0]; // color exportado, a reemplazar por currentColor
		ctx.icons.set(key, icon);
	}
	return icon;
}

// Un registro por archivo: tras deduplicar, varios íconos pueden compartir el mismo.
function iconList() {
	const seen = new Set();
	return [...ctx.icons.values()]
		.filter((i) => !seen.has(i.file) && seen.add(i.file))
		.map((i) => ({ name: i.name, file: i.file }));
}

// Colores (hex, sin alfa) de las pinturas visibles del ícono; null si hay degradados o imágenes.
function vectorPalette(n, out = new Set()) {
	if (n.visible === false) return out;
	for (const p of [...visiblePaints(n.fills), ...visiblePaints(n.strokes)]) {
		if (p.type !== "SOLID") return null;
		out.add(color({ ...p.color, a: 1 }));
	}
	for (const c of n.children || []) if (!vectorPalette(c, out)) return null;
	return out;
}

// Reemplaza el color del ícono en fill/stroke (atributo o style) por currentColor.
// Figma exporta #FFFFFF y #000000 como "white" y "black".
function toCurrentColor(svg, hex) {
	const names = { "#FFFFFF": "white", "#000000": "black" };
	const alt = [hex, names[hex]].filter(Boolean).join("|");
	const re = new RegExp(
		`((?:fill|stroke)\\s*(?:=\\s*["']|:\\s*))(?:${alt})(?![\\w-])`,
		"gi",
	);
	return svg.replace(re, "$1currentColor");
}

function isVectorish(n) {
	if (n.visible === false) return true;
	if (VECTOR_TYPES.has(n.type) || n.type === "LINE") return true;
	if (n.type === "TEXT") return false;
	if (
		(n.type === "ELLIPSE" || n.type === "RECTANGLE") &&
		!(n.children || []).length
	)
		return !visiblePaints(n.fills).some((p) => p.type === "IMAGE");
	const kids = n.children || [];
	return kids.length > 0 && kids.every(isVectorish);
}
function hasTrueVector(n) {
	return VECTOR_TYPES.has(n.type) || (n.children || []).some(hasTrueVector);
}
function isIconish(n) {
	if (n.type === "TEXT" || !(n.children || []).length) return false;
	const own =
		[...visiblePaints(n.fills), ...visiblePaints(n.strokes)].length > 0;
	return !own && n.children.every(isVectorish) && hasTrueVector(n);
}
function vectorColor(n) {
	for (const [list, key] of [
		[n.fills, "fill"],
		[n.strokes, "stroke"],
	])
		for (const p of visiblePaints(list))
			if (p.type === "SOLID") return styledColor(n, key, p);
	for (const c of n.children || []) {
		if (c.visible === false) continue;
		const x = vectorColor(c);
		if (x) return x;
	}
	return null;
}

// ---------------------------------------------------------------- props
function propName(key) {
	return camel(String(key).replace(/#[^#]*$/, "")) || "prop";
}
function propType(t) {
	return (
		{
			VARIANT: "variant",
			BOOLEAN: "boolean",
			TEXT: "string",
			INSTANCE_SWAP: "node",
			SLOT: "slot",
		}[t] || String(t).toLowerCase()
	);
}

function propsFromDefs(defs) {
	const out = {};
	for (const [k, d] of Object.entries(defs)) {
		const p = { type: propType(d.type) };
		if (d.type === "VARIANT") p.options = d.variantOptions || [];
		if (d.type === "INSTANCE_SWAP")
			p.default = pascal(componentName(d.defaultValue) || "") || d.defaultValue;
		else if (d.defaultValue !== undefined && d.type !== "SLOT")
			p.default = d.defaultValue;
		out[propName(k)] = p;
	}
	return out;
}

function defaultVariant(defs) {
	const out = {};
	for (const [k, d] of Object.entries(defs))
		if (d.type === "VARIANT") out[propName(k)] = d.defaultValue;
	return out;
}

function parseVariantName(name) {
	const out = {};
	for (const part of String(name).split(",")) {
		const i = part.indexOf("=");
		if (i > 0)
			out[propName(part.slice(0, i).trim())] = part.slice(i + 1).trim();
	}
	return out;
}

function displayValue(v) {
	if (v.type === "INSTANCE_SWAP")
		return pascal(componentName(v.value) || "") || v.value;
	return v.value;
}

function componentName(id) {
	const c = id && ctx.components[id];
	if (!c) return null;
	if (c.componentSetId && ctx.componentSets[c.componentSetId])
		return ctx.componentSets[c.componentSetId].name;
	return c.name;
}

// ---------------------------------------------------------------- tokens
function sty(n, key) {
	const s = n.styles || {};
	return s[key] || s[key + "s"] || null;
}

function styleToken(id) {
	const s = id && ctx.styles[id];
	return s ? "--" + kebab(s.name) : null;
}

function varRef(alias) {
	if (Array.isArray(alias)) alias = alias[0];
	if (!alias || !alias.id) return null;
	const v = ctx.variables[alias.id];
	if (!v) {
		ctx.unnamedVars = true;
		return null;
	}
	const web = v.codeSyntax && v.codeSyntax.WEB;
	const m = web && web.match(/--[A-Za-z0-9_-]+/);
	return m ? m[0] : "--" + kebab(v.name);
}

function tokenize(name, fallback) {
	ctx.tokens.set(name, fallback);
	return `var(${name}, ${fallback})`;
}

function num(v, alias, unit = "px") {
	const raw = v === 0 ? "0" : `${rd(v)}${unit}`;
	const n = varRef(alias);
	return n ? tokenize(n, raw) : raw;
}

// ---------------------------------------------------------------- salida
function notes(subs) {
	const n = [
		"Unidades en px. Se asume `*, *::before, *::after { box-sizing: border-box; }`.",
		'styles: clase CSS → declaraciones (CSS Modules). "root" es el elemento raíz de cada componente.',
		"structure: árbol de elementos. tag es una sugerencia; className apunta a styles.",
		"bind: visible → render condicional; text → contenido desde la prop; swap → prop de tipo ReactNode.",
		'Elementos con "component": instancias de otro componente. En este módulo solo llevan estilos de ubicación (tamaño, flex), que se pasan vía className; sus estilos propios están en subcomponents. En el .module.css esa ubicación se emite como `.root .clase` para ganar sobre el `.root` del subcomponente.',
		"var(--token, valor): el valor de Figma queda como fallback; tokens.css define todos.",
	];
	if (Object.keys(subs).length)
		n.push(
			"subcomponents: solo incluye las variantes que aparecen usadas dentro de este componente.",
		);
	if (
		[ctx.rootComponent, ...Object.values(subs)].some(
			(s) => s && s.variantStyles,
		)
	)
		n.push(
			'variantStyles: estilos que cambian por variante; se aplican con data-atributos en root, p. ej. <div className={styles.root} data-size="Large">.',
		);
	if (
		[ctx.rootComponent, ...Object.values(subs)].some(
			(s) => s && s.variantProps,
		)
	)
		n.push(
			'variantProps: props de instancias anidadas que cambian por variante, por className (structure trae las de la variante por defecto); p. ej. <Badge tone={state === "Hover" ? "Success" : "Info"} />. null = la prop no existe en esa variante.',
		);
	if (
		[ctx.rootComponent, ...Object.values(subs)].some(
			(s) => s && s.variantText,
		)
	)
		n.push(
			'variantText: texto que cambia por variante, por className (structure trae el de la variante por defecto); p. ej. {state === "Loading" ? "Cargando…" : "Enviar"}. Si el texto tiene segmentos con estilos, aquí va solo el contenido.',
		);
	if (ctx.icons.size)
		n.push(
			'Íconos: los monocromos usan currentColor en el SVG y su color se define con `color` en CSS; solo funciona si el SVG va inline (p. ej. SVGR), no con <img>. Los marcados "multicolor" conservan sus colores.',
		);
	if ([ctx.rootComponent, ...Object.values(subs)].some((s) => s && s.repeated))
		n.push(
			'repeated: grupos de 3 o más hermanos con la misma estructura (ítems de un menú, filas, tarjetas). "varies" dice qué cambia entre ellos, por clase del primero: propiedades CSS, "text", "src" (ícono) o "hidden"; "styleGroups" agrupa los que tienen estilos idénticos (posibles estados: activo, deshabilitado…). Son candidatos a un subcomponente renderizado con items.map(...).',
		);
	if (Object.values(subs).some((s) => s.extractedFrom))
		n.push(
			'--extract-repeated: los grupos repetidos se extrajeron a subcomponentes ("extractedFrom"): lo que cambia entre ítems es una prop (label = texto, icon = componente de ícono, show… = visibilidad) y cada grupo de estilos, un estado (state). Estados deducidos: default = el grupo más numeroso; disabled = menor opacidad; active = único ítem con otro fondo; con número si se repiten (disabled2). Renómbralos si el diseño tiene nombres mejores.',
		);
	if (ctx.renamed.size) {
		const list = [...ctx.renamed].map(([cls, from]) => `${from} → ${cls}`);
		n.push(
			`Capas renombradas (con el nombre elegido en el plugin o según su texto o su tipo): ${list.slice(0, 12).join(", ")}${list.length > 12 ? `… (${list.length})` : ""}. Para otro nombre, usa la ventana del plugin o renómbralas en Figma.`,
		);
	}
	// Los nombres de estado solo se usan al extraer repetidos: sin --extract-repeated no sobran
	const unused = [
		...ctx.namesById.keys(),
		...(opts.extractRepeated ? ctx.statesById.keys() : []),
	].filter((id) => !ctx.namesUsed.has(id));
	if (unused.length)
		n.push(
			`${unused.length} nombre(s) elegidos en el plugin no corresponden a ninguna capa exportada (¿cambió el diseño?): ${unused.slice(0, 5).map((id) => `${id} → ${ctx.namesById.get(id) || ctx.statesById.get(id)}`).join(", ")}.`,
		);
	if (ctx.unnamedVars)
		n.push(
			"Hay valores enlazados a variables cuyo nombre no se pudo leer (la API de variables requiere plan Enterprise); se usan los valores directos.",
		);
	return n.concat([...ctx.notes]);
}

// JSON legible pero compacto: los objetos cortos van en una sola línea
function compactJson(v, indent = "") {
	const flat = JSON.stringify(v);
	if (flat === undefined) return "null";
	if (typeof v !== "object" || v === null || flat.length + indent.length <= 110)
		return flat;
	const next = indent + "  ";
	if (Array.isArray(v))
		return `[\n${v.map((x) => next + compactJson(x, next)).join(",\n")}\n${indent}]`;
	const items = Object.entries(v)
		.filter(([, x]) => x !== undefined)
		.map(([k, x]) => `${next}${JSON.stringify(k)}: ${compactJson(x, next)}`);
	return `{\n${items.join(",\n")}\n${indent}}`;
}

function rule(sel, decl) {
	return `${sel} {\n${Object.entries(decl)
		.map(([k, v]) => `  ${k}: ${v};`)
		.join("\n")}\n}\n`;
}

// Especificidad: todo lo que aplica a .root queda en (0,1,0) gracias a :where(), así la ubicación
// de una instancia en el módulo padre (.root .clase, 0,2,0) siempre gana sobre el .root del hijo,
// sin depender del orden en que se cargan los CSS.
function moduleCss(comp) {
	const out = [`/* ${comp.figmaName} — generado desde Figma */\n`];
	const inst = ctx.instanceClasses.get(comp) || new Set();
	for (const [cls, decl] of Object.entries(comp.styles || {}))
		out.push(rule(inst.has(cls) ? `.root .${cls}` : `.${cls}`, decl));
	for (const r of comp.variantStyles || []) {
		const attrs = `:where(${Object.entries(r.when)
			.map(([k, v]) => `[data-${kebab(k)}="${String(v).replace(/"/g, '\\"')}"]`)
			.join("")})`;
		out.push(
			`/* ${Object.entries(r.when)
				.map(([k, v]) => `${k}=${v}`)
				.join(", ")} */\n`,
		);
		for (const [cls, decl] of Object.entries(r.styles)) {
			out.push(
				rule(cls === "root" ? `.root${attrs}` : `.root${attrs} .${cls}`, decl),
			);
		}
	}
	return out.join("\n");
}

function tokensCss() {
	const lines = [...ctx.tokens]
		.sort((a, b) => a[0].localeCompare(b[0]))
		.map(([k, v]) => `  ${k}: ${v};`);
	return `/* Tokens usados por el componente (valores tomados de Figma) */\n:root {\n${lines.join("\n")}\n}\n`;
}

function fixImagePaths(s, rename) {
	return s.replace(
		/assets\/images\/([A-Za-z0-9]+)(?![.\w])/g,
		(m, ref) => rename[ref] || `${m}.png`,
	);
}

function fixIconPaths(s, rename) {
	const files = Object.keys(rename);
	if (!files.length) return s;
	const esc = files.map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
	return s.replace(new RegExp(esc.join("|"), "g"), (m) => rename[m]);
}

// ---------------------------------------------------------------- escritura de assets
// Las rutas (icon.file, rename) son relativas a la subcarpeta del componente (part), que es
// desde donde las usan los CSS Modules y los .tsx.
function writeAssets(outDir, part) {
	const dir = path.join(outDir, part);
	const rename = {}; // imageRef → ruta con extensión
	const iconRename = {}; // archivo duplicado → archivo con el mismo contenido
	if (ctx.icons.size) {
		const ids = [...new Set([...ctx.icons.values()].map((i) => i.id))];
		const raw = bundleAssets("icons", ids);
		fs.mkdirSync(path.join(dir, "assets/icons"), { recursive: true });
		// Capas sueltas con el mismo dibujo tienen ids distintos: se unifican por contenido
		// (ya con currentColor, así que el color tampoco las separa). Los números se comparan
		// redondeados a 0.01: una copia desplazada una fracción de píxel cambia la 5.ª decimal.
		const groups = new Map(); // forma → íconos con ese dibujo
		const shape = (svg) => svg.replace(/-?\d*\.\d+/g, (n) => String(rd(+n)));
		for (const icon of ctx.icons.values()) {
			const buf = raw.get(icon.id);
			if (!buf) continue;
			icon.svg = buf.toString("utf8");
			if (icon.hex) icon.svg = toCurrentColor(icon.svg, icon.hex);
			const k = shape(icon.svg);
			if (!groups.has(k)) groups.set(k, []);
			groups.get(k).push(icon);
		}
		const taken = new Set([...ctx.icons.values()].map((i) => i.file));
		for (const group of groups.values()) {
			let file = group[0].file;
			// El mismo dibujo junto a textos distintos (Benefits, Logs…): un nombre sugerido sería
			// engañoso para los demás, así que el archivo vuelve al nombre de la capa ("icon").
			if (new Set(group.map((i) => i.file)).size > 1 && group.some((i) => i.suggested)) {
				for (const i of group) taken.delete(i.file);
				const base = kebab(group[0].layer) || "icon";
				file = `assets/icons/${base}.svg`;
				for (let n = 2; taken.has(file); n++) file = `assets/icons/${base}-${n}.svg`;
				taken.add(file);
				for (const i of group) i.name = group[0].layer;
			}
			for (const icon of group) {
				if (icon.file !== file) iconRename[icon.file] = file;
				icon.file = file;
			}
			fs.writeFileSync(path.join(dir, file), group[0].svg);
			ctx.generated.add(`${part}/${file}`);
		}
	}
	if (ctx.imageRefs.size) {
		const bufs = bundleAssets("images", [...ctx.imageRefs]);
		fs.mkdirSync(path.join(dir, "assets/images"), { recursive: true });
		for (const [ref, buf] of bufs) {
			const ext = imageExt(buf);
			fs.writeFileSync(path.join(dir, "assets/images", ref + ext), buf);
			rename[ref] = `assets/images/${ref}${ext}`;
			ctx.generated.add(`${part}/${rename[ref]}`);
		}
	}
	return { images: rename, icons: iconRename };
}

function writePreview(nodeId, outDir) {
	const buf = bundleAssets("preview", [nodeId]).get(nodeId);
	if (!buf) return false;
	fs.writeFileSync(path.join(outDir, "preview.png"), buf);
	return true;
}

// Extensión según el contenido (en el paquete las imágenes vienen sin tipo)
function imageExt(buf) {
	if (buf[0] === 0xff && buf[1] === 0xd8) return ".jpg";
	if (buf.toString("ascii", 0, 3) === "GIF") return ".gif";
	if (buf.toString("ascii", 8, 12) === "WEBP") return ".webp";
	return ".png";
}

// ---------------------------------------------------------------- utilidades
// Una clase por ruta de capas (no por orden de recorrido): una capa extra en una variante
// no corre la numeración del resto.
// suggest: nombre alternativo (función perezosa) para capas con nombre vago (ver vagueName);
// se calcula solo la primera vez que aparece la ruta, que es en la variante por defecto.
function classFor(name, path, reg, suggest) {
	let cls = reg.byPath.get(path);
	if (cls) return cls;
	const better = suggest ? suggest() : null;
	let base = camel(better || name) || "el";
	if (/^[0-9]/.test(base)) base = "el" + base;
	if (base === "root") base = "rootEl";
	cls = base;
	for (let n = 2; reg.taken.has(cls); n++) cls = numbered(base, n);
	reg.taken.add(cls);
	reg.byPath.set(path, cls);
	if (better && camel(better) !== camel(name)) ctx.renamed.set(cls, name); // "Icon" → icon no es renombre
	return cls;
}

// Nombre elegido para la capa en la ventana del plugin (tiene prioridad sobre la sugerencia).
// Se busca por id; como la clase se registra por ruta, vale para todas las variantes.
function chosenName(node) {
	const name = ctx.namesById.get(node.id);
	if (!name) return null;
	ctx.namesUsed.add(node.id);
	return () => name;
}

// Agrega un número si el nombre ya está tomado (icon → icon2). Si el nombre termina en dígito
// se separa (frame1 → frame1_2), para no confundirlo con una capa "Frame 12".
function numbered(base, n) {
	return /\d$/.test(base) ? `${base}_${n}` : `${base}${n}`;
}

// ---------------------------------------------------------------- nombres sugeridos
// Nombres que Figma pone por defecto (o equivalentes) y no dicen qué es la capa
const GENERIC =
	/^(frame|group|rectangle|vector|ellipse|line|polygon|star|union|subtract|intersect|exclude|image|component|instance|auto layout|icon|ic|svg|shape)(\s*\d+)?$/i;

function isGeneric(name) {
	return GENERIC.test(String(name).trim());
}

// Nombre que no sirve para el código: genérico de Figma ("Frame 5"), o un texto que Figma nombró
// con su contenido cuando ese contenido no sirve de nombre ("$1.200", "••••", un párrafo, un email).
function vagueName(node) {
	if (isGeneric(node.name)) return true;
	const chars = node.type === "TEXT" ? String(node.characters || "").trim() : null;
	return chars !== null && String(node.name).trim() === chars && !usableText(chars);
}

// Nombre para una capa con nombre vago, a partir del texto que tiene cerca:
//   texto → "text" (su contenido no sirve de nombre)
//   ícono → texto hermano + "Icon" (dashboardIcon), o "icon" si no hay texto
//   contenedor → su único texto propio + rol: Item si se repite entre sus hermanos, si no
//                Row/Column/Box. Con dos o más textos propios es contenido (título y descripción,
//                nombre y email): nombrarlo por el primero sería engañoso.
// null → se queda el nombre de Figma.
function suggestName(node, parent, iconLike) {
	if (node.type === "TEXT") return "text";
	if (iconLike) {
		const near = textNear(node, parent);
		return near ? `${near} Icon` : "icon";
	}
	const text = ownChildText(node);
	if (!text) return null;
	const role = repeated(node, parent)
		? "Item"
		: { HORIZONTAL: "Row", VERTICAL: "Column" }[node.layoutMode] || "Box";
	return `${text} ${role}`;
}

// Texto apto para un nombre: hasta 3 palabras y con letras. Descarta números, precios y fechas,
// emails y URLs, relleno ("Lorem ipsum") y frases largas, que suelen ser datos de ejemplo.
// No se recorta: "Título de la tarjeta" daría "títuloDeLa".
function usableText(s) {
	const t = String(s || "").replace(/\s+/g, " ").trim();
	if (!t || /lorem ipsum|@|:\/\//i.test(t) || !/\p{L}/u.test(t)) return null;
	return t.split(" ").length > 3 ? null : t;
}

// Un texto visible cuyo contenido es del diseño (no el valor por defecto de una prop)
function ownText(n) {
	return (
		n.type === "TEXT" &&
		n.visible !== false &&
		!(n.componentPropertyReferences || {}).characters &&
		usableText(n.characters)
	);
}

// Solo hijos directos: un texto más profundo pertenece a un contenedor interior, que ya lo usará
// (si no, un frame y el que lleva adentro terminarían llamándose igual: userRow, userRow2).
// Cuentan todos los textos visibles, sirvan o no de nombre: "Juan Pérez" + "juan@mail.com" sigue
// siendo contenido aunque el email no sirva.
function ownChildText(node) {
	const texts = (node.children || []).filter(
		(c) => c.type === "TEXT" && c.visible !== false,
	);
	return texts.length === 1 ? ownText(texts[0]) || null : null;
}

// El texto hermano más cercano (primero el siguiente, después el anterior)
function textNear(node, parent) {
	const sibs = (parent && parent.children) || [];
	const i = sibs.indexOf(node);
	for (let d = 1; d < sibs.length; d++)
		for (const j of [i + d, i - d]) {
			const t = sibs[j] && ownText(sibs[j]);
			if (t) return t;
		}
	return null;
}

// Firma estructural: tipos, auto layout y forma del árbol, sin textos, colores ni el dibujo de
// los íconos. Hermanos con la misma firma son el mismo patrón (p. ej. los ítems de un menú).
const signatures = new WeakMap();
function signature(n) {
	if (signatures.has(n)) return signatures.get(n);
	let s;
	if (n.type === "TEXT") s = "T";
	else if (VECTOR_TYPES.has(n.type) || isIconish(n)) s = "I";
	else
		s = `${n.type}:${n.layoutMode || ""}(${(n.children || [])
			.filter((c) => c.visible !== false)
			.map(signature)
			.join(",")})`;
	signatures.set(n, s);
	return s;
}

// ---------------------------------------------------------------- estructuras repetidas
// Hermanos con la misma firma (≥ REPEAT_MIN) son el mismo patrón repetido: los ítems de un menú,
// las filas de una lista, las tarjetas de una grilla. Se reportan en component.json (`repeated`)
// con lo que varía entre ellos, como base para extraerlos a un subcomponente.
function findRepeated(comp) {
	const out = [];
	(function visit(el) {
		const groups = new Map();
		for (const k of el.children || []) {
			// Solo contenedores con contenido: las instancias ya son un componente, y varios
			// textos o íconos sueltos seguidos no forman un patrón
			if (!(k.children || []).length) continue;
			const s = ctx.elSignature.get(k);
			if (!groups.has(s)) groups.set(s, []);
			groups.get(s).push(k);
		}
		for (const items of groups.values())
			if (items.length >= REPEAT_MIN) out.push(describeRepeated(el, items, comp));
		(el.children || []).forEach(visit);
	})(comp.structure);
	return out;
}

// Qué cambia entre las repeticiones, recorriéndolas en paralelo (misma firma = misma forma):
//   varies: clase (del primer ítem) → propiedades CSS que cambian, más "text", "src" (ícono)
//           y "hidden" si cambian el contenido, el ícono o la visibilidad
//   styleGroups: ítems con estilos idénticos; si hay más de uno, son candidatos a estados
//                (p. ej. activo / normal / deshabilitado)
function describeRepeated(parent, items, comp) {
	const styleOf = (el) => (comp.styles || {})[el.className] || {};
	const content = (el) =>
		el.text !== undefined ? el.text : (el.segments || []).map((s) => s.text).join("");
	const varies = {};
	(function compare(els) {
		const first = els[0];
		const props = new Set(els.flatMap((e) => Object.keys(styleOf(e))));
		const changed = [...props].filter(
			(p) => new Set(els.map((e) => styleOf(e)[p])).size > 1,
		);
		if (first.tag === "span" && new Set(els.map(content)).size > 1) changed.push("text");
		if (first.tag === "svg" && new Set(els.map((e) => e.src)).size > 1) changed.push("src");
		if (new Set(els.map((e) => !!e.hidden)).size > 1) changed.push("hidden");
		if (changed.length) varies[first.className] = changed;
		const n = Math.min(...els.map((e) => (e.children || []).length));
		for (let i = 0; i < n; i++) compare(els.map((e) => e.children[i]));
	})(items);

	// El tamaño de un ícono depende de su dibujo, no del estado: no cuenta para agrupar
	const styleKey = (el) => {
		const all = [];
		(function collect(e) {
			const { width, height, ...rest } = styleOf(e);
			all.push(e.tag === "svg" ? rest : styleOf(e));
			(e.children || []).forEach(collect);
		})(el);
		return JSON.stringify(all);
	};
	const groups = new Map();
	for (const it of items) {
		const k = styleKey(it);
		if (!groups.has(k)) groups.set(k, []);
		groups.get(k).push(it.className);
	}
	const rep = { parent: parent.className, items: items.map((e) => e.className) };
	if (Object.keys(varies).length) rep.varies = varies;
	if (groups.size > 1) rep.styleGroups = [...groups.values()];
	return rep;
}

// ---------------------------------------------------------------- extraer repetidos (--extract-repeated)
// Cada grupo repetido pasa a ser un subcomponente: lo que cambia entre los ítems se vuelve props
// (texto → label, ícono → icon, visibilidad → booleano) y cada grupo de estilos, un estado. El
// padre lo usa como a cualquier instancia: su clase lleva la ubicación (tamaño, flex).
const PLACEMENT = new Set([
	"position", "top", "right", "bottom", "left", "width", "height", "min-width", "max-width",
	"min-height", "max-height", "flex", "flex-grow", "flex-shrink", "flex-basis", "align-self",
	"justify-self", "grid-column", "grid-row", "order", "margin",
]);

function extractRepeated(comp, subs) {
	if (!comp.repeated) return;
	if (comp.variantStyles || comp.variantStructures || comp.variantText || comp.variantProps) {
		ctx.notes.add(
			`--extract-repeated: ${comp.name} tiene variantes; sus estructuras repetidas solo se reportan (repeated).`,
		);
		return;
	}
	for (const rep of comp.repeated) {
		const parent = findEl(comp.structure, rep.parent);
		const items = parent && rep.items.map((c) => (parent.children || []).find((k) => k.className === c));
		if (!items || items.some((i) => !i)) continue; // estaba dentro de un grupo ya extraído
		const sub = repeatedSub(comp, parent, items, rep);
		if (!sub) continue;
		subs[sub.name] = sub;
		rep.extractedAs = sub.name;
	}
}

function findEl(el, cls) {
	if (el.className === cls) return el;
	for (const c of el.children || []) {
		const f = findEl(c, cls);
		if (f) return f;
	}
	return null;
}

function repeatedSub(comp, parent, items, rep) {
	const styleOf = (el) => comp.styles[el.className] || {};
	const content = (el) =>
		el.text !== undefined ? el.text : (el.segments || []).map((s) => s.text).join("");
	const at = (item, p) => p.reduce((e, i) => e.children[i], item);
	const distinct = (vals) => new Set(vals.map((v) => JSON.stringify(v))).size;

	// Grupos de estilo → estados. El más numeroso es el estado por defecto ("default", salvo que en
	// el plugin se le haya dado otro nombre) y define la estructura base.
	const groups = rep.styleGroups || [items.map((i) => i.className)];
	const reps = groups.map((g) => items.find((i) => i.className === g[0]));
	const def = groups.reduce((best, g, i) => (g.length > groups[best].length ? i : best), 0);
	const states = stateNames(groups, reps, def, styleOf, items);
	const defName = states[def];
	const stateOf = new Map();
	groups.forEach((g, i) => g.forEach((c) => stateOf.set(c, states[i])));
	const tplItem = reps[def];

	// Recorrido en paralelo: cada posición del árbol con su elemento en cada ítem
	const props = {};
	if (groups.length > 1)
		props.state = {
			type: "variant",
			options: [defName, ...new Set(states.filter((s) => s !== defName))],
			default: defName,
		};
	const sources = []; // { prop, path, kind } → valor de la prop en cada ítem
	const taken = new Set(["root"]);
	const unique = (base) => {
		let n = base;
		for (let k = 2; taken.has(n); k++) n = numbered(base, k);
		taken.add(n);
		return n;
	};
	const varyingTexts = [];
	(function scan(els, p) {
		if (els[0].tag === "span" && distinct(els.map(content)) > 1) varyingTexts.push(p.join("."));
		(els[0].children || []).forEach((_, i) => scan(els.map((e) => e.children[i]), [...p, i]));
	})(items, []);

	const styles = {};
	const perState = new Map(states.map((s) => [s, {}]));
	const instClasses = new Set();
	let ok = true;
	function build(p, isRoot) {
		const els = items.map((it) => at(it, p));
		const tpl = at(tplItem, p);
		if (els.some((e) => (e.children || []).length !== (tpl.children || []).length)) ok = false;
		const sameName = els.every((e) => e.name === tpl.name) && !isGeneric(tpl.name);
		const el = { name: tpl.name };
		if (tpl.tag) el.tag = tpl.tag;
		let cls;
		if (isRoot) cls = "root";
		else if (tpl.tag === "span" && varyingTexts.includes(p.join("."))) {
			const prop =
				sameName && tpl.name !== content(tpl)
					? camel(tpl.name)
					: varyingTexts.length === 1
						? "label"
						: `label${varyingTexts.indexOf(p.join(".")) + 1}`.replace(/1$/, "");
			cls = unique(prop);
			el.bind = { text: prop };
			props[prop] = { type: "string" };
			sources.push({ prop, path: p, kind: "text" });
		} else if (tpl.tag === "svg") {
			cls = unique("icon");
			if (distinct(els.map((e) => e.src)) > 1) {
				const prop = Object.keys(props).includes("icon") ? `icon${cls.replace(/^icon/, "")}` : "icon";
				el.bind = { icon: prop };
				props[prop] = { type: "icon" };
				sources.push({ prop, path: p, kind: "icon" });
			} else {
				el.src = tpl.src;
				el.icon = tpl.icon;
			}
			if (tpl.multicolor) el.multicolor = true;
		} else {
			cls = unique(sameName ? camel(tpl.name) : tpl.tag === "span" ? "text" : "box");
			if (tpl.tag === "span") {
				if (tpl.text !== undefined) el.text = tpl.text;
				if (tpl.segments) el.segments = tpl.segments;
			}
		}
		el.className = cls;
		if (tpl.textStyle) el.textStyle = tpl.textStyle;
		if (tpl.component) {
			// Instancia dentro del ítem: sus props tienen que ser iguales en todos
			if (distinct(els.map((e) => e.props || {})) > 1) ok = false;
			el.component = tpl.component;
			if (tpl.props) el.props = tpl.props;
			instClasses.add(cls);
		}
		if (distinct(els.map((e) => !!e.hidden)) > 1) {
			const prop = `show${pascal(cls)}`;
			el.bind = { ...(el.bind || {}), visible: prop };
			props[prop] = { type: "boolean" };
			sources.push({ prop, path: p, kind: "visible" });
		} else if (tpl.hidden) el.hidden = true;

		// Estilos por estado (cada estado toma los de un ítem representativo)
		// El tamaño de un ícono depende del dibujo: si cambia dentro de un mismo estado no se puede
		// expresar por estado y se usa el del SVG (que Figma exporta redondeado a enteros)
		const size = (e) => [styleOf(e).width, styleOf(e).height];
		const svgSize =
			tpl.tag === "svg" &&
			groups.some((g) => distinct(g.map((c) => size(at(items.find((i) => i.className === c), p)))) > 1);
		groups.forEach((g, gi) => {
			const s = { ...styleOf(at(reps[gi], p)) };
			for (const k of Object.keys(s))
				// La raíz deja la ubicación al padre; un ícono cuyo tamaño cambia según el
				// dibujo usa el del propio SVG
				if ((isRoot && PLACEMENT.has(k)) || (svgSize && (k === "width" || k === "height")))
					delete s[k];
			perState.get(states[gi])[cls] = s;
		});
		if (tpl.children) el.children = tpl.children.map((_, i) => build([...p, i], false));
		return el;
	}
	const structure = build([], true);
	if (!ok) {
		ctx.notes.add(
			`--extract-repeated: los ítems de ${comp.name} (${items[0].className}…) no se extrajeron: difieren en algo que no se puede expresar como prop.`,
		);
		return null;
	}

	// Estilos base (estado por defecto) y diferencias por estado
	const base = perState.get(defName);
	Object.assign(styles, base);
	const variantStyles = [];
	for (const s of new Set(states)) {
		if (s === defName) continue;
		const diff = {};
		for (const [cls, decl] of Object.entries(perState.get(s))) {
			const b = base[cls] || {};
			for (const k of new Set([...Object.keys(b), ...Object.keys(decl)]))
				if (b[k] !== decl[k]) (diff[cls] = diff[cls] || {})[k] = decl[k] === undefined ? "unset" : decl[k];
		}
		if (Object.keys(diff).length) variantStyles.push({ when: { state: s }, styles: diff });
	}
	for (const cls of Object.keys(styles)) if (!Object.keys(styles[cls]).length) delete styles[cls];

	// Nombre: el que el diseñador les dio a los ítems; si no, el de su contenedor + Item (nav →
	// NavItem), o el del componente si el contenedor también tiene un nombre genérico
	const common = items.every((i) => i.name === items[0].name) && !isGeneric(items[0].name);
	const owner =
		parent !== comp.structure && !isGeneric(parent.className) ? pascal(parent.className) : comp.name;
	const figmaName = common ? items[0].name : `${owner} item`;
	const sub = {
		name: codeName(common ? items[0].name : `${owner} Item`),
		figmaName,
		props,
	};
	if (props.state) sub.defaultVariant = { state: defName };
	sub.structure = structure;
	sub.styles = styles;
	if (variantStyles.length) sub.variantStyles = variantStyles;
	sub.extractedFrom = comp.name;
	ctx.instanceClasses.set(sub, instClasses);

	// El padre: una instancia por ítem; la ubicación va en una clase compartida si es igual en todos
	const placement = (it) =>
		Object.fromEntries(Object.entries(styleOf(it)).filter(([k]) => PLACEMENT.has(k)));
	const shared = distinct(items.map(placement)) === 1;
	const parentTaken = new Set(Object.keys(comp.styles));
	const removed = new Set();
	for (const it of items)
		(function drop(e) {
			removed.add(e.className);
			ctx.renamed.delete(e.className); // esa clase ya no existe en el padre
			(e.children || []).forEach(drop);
		})(it);
	let placeCls = null;
	if (shared) {
		for (const c of removed) parentTaken.delete(c);
		placeCls = "item";
		for (let k = 2; parentTaken.has(placeCls); k++) placeCls = numbered("item", k);
	}
	const newStyles = {};
	for (const [cls, decl] of Object.entries(comp.styles)) {
		if (cls === items[0].className && shared) newStyles[placeCls] = placement(items[0]);
		if (!removed.has(cls)) newStyles[cls] = decl;
		else if (!shared && items.some((i) => i.className === cls)) newStyles[cls] = placement(findEl(parent, cls));
	}
	comp.styles = newStyles;
	const instances = ctx.instanceClasses.get(comp);
	parent.children = parent.children.map((k) => {
		if (!items.includes(k)) return k;
		const inst = { name: k.name, className: shared ? placeCls : k.className, component: sub.name };
		const p = {};
		if (props.state) p.state = stateOf.get(k.className);
		for (const s of sources) {
			const e = at(k, s.path);
			p[s.prop] = s.kind === "text" ? content(e) : s.kind === "icon" ? e.src : !e.hidden;
		}
		if (Object.keys(p).length) inst.props = p;
		instances.add(inst.className);
		return inst;
	});
	return sub;
}

// Nombres de estado. Si en el plugin se nombró algún ítem del grupo, ese nombre; si no, según
// cómo se ve el grupo frente al más numeroso (default): menos opacidad → disabled; un único ítem
// con otro fondo → active; si no, default. Si un nombre se repite se numera (disabled2,
// default2): son estados distintos en el diseño.
function stateNames(groups, reps, def, styleOf, items) {
	const op = (el) => parseFloat(styleOf(el).opacity || "1");
	const bg = (el) => styleOf(el)["background-color"] || styleOf(el).background || "";
	const auto = groups.map((g, i) =>
		i === def
			? "default"
			: op(reps[i]) < op(reps[def])
				? "disabled"
				: g.length === 1 && bg(reps[i]) !== bg(reps[def])
					? "active"
					: "default",
	);
	const chosen = groups.map((g) => {
		const picked = [];
		for (const cls of g) {
			const id = ctx.elId.get(items.find((i) => i.className === cls));
			const name = ctx.statesById.get(id);
			if (name) {
				ctx.namesUsed.add(id);
				picked.push(name);
			}
		}
		if (new Set(picked).size > 1)
			ctx.notes.add(
				`Ítems con el mismo estilo recibieron nombres de estado distintos en el plugin (${[...new Set(picked)].join(", ")}): se usó "${picked[0]}".`,
			);
		return picked[0] || null;
	});
	// El estado por defecto se nombra primero, así conserva su nombre si otro grupo lo repite. Los
	// grupos que solo se parecen al de por defecto se numeran a partir de su nombre: si se eligió
	// "normal", son normal2, normal3 (no "default", que ya no es el estado por defecto).
	const names = [];
	const taken = new Set();
	for (const i of [def, ...groups.keys()].filter((i, k, a) => a.indexOf(i) === k)) {
		const base = chosen[i] || (i !== def && auto[i] === "default" ? names[def] : auto[i]);
		let name = base;
		for (let n = 2; taken.has(name); n++) name = `${base}${n}`;
		taken.add(name);
		names[i] = name;
	}
	return names;
}

// Al menos 3 hermanos (contándose) con la misma firma
const REPEAT_MIN = 3;
function repeated(node, parent) {
	const sibs = ((parent && parent.children) || []).filter((c) => c.visible !== false);
	return sibs.filter((c) => signature(c) === signature(node)).length >= REPEAT_MIN;
}

function words(s) {
	return String(s)
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean);
}
function camel(s) {
	return words(s)
		.map((w, i) => (i ? w[0].toUpperCase() : w[0].toLowerCase()) + w.slice(1))
		.join("");
}
function pascal(s) {
	const c = camel(s);
	return c ? c[0].toUpperCase() + c.slice(1) : "";
}
function kebab(s) {
	return words(s).join("-").toLowerCase();
}

function color(c, opacity = 1) {
	if (!c) return "currentColor";
	const a = (c.a == null ? 1 : c.a) * opacity;
	const [r, g, b] = [c.r, c.g, c.b].map((v) => Math.round(v * 255));
	if (a >= 0.999)
		return (
			"#" +
			[r, g, b]
				.map((v) => v.toString(16).padStart(2, "0"))
				.join("")
				.toUpperCase()
		);
	return `rgba(${r}, ${g}, ${b}, ${rd(a)})`;
}

function rd(n) {
	return Math.round(n * 100) / 100;
}
function px(n) {
	return n === 0 ? "0" : `${rd(n)}px`;
}

function printHelp() {
	console.log(`Uso: node extractor.js figspec-<nombre>.json [--name Nombre] [--react] [--out-dir dir] [--no-assets] [--no-png] [--shallow] [--no-css]

El archivo se genera en Figma con el plugin "figspec export" (carpeta plugin/).
También acepta una respuesta guardada de /v1/files/:key/nodes (sin íconos ni imágenes).

Variables (.env o entorno): FIGMA_FROM (archivo de entrada), FIGMA_NAME, FIGMA_OUT_DIR,
  FIGMA_ASSETS, FIGMA_PNG, FIGMA_SHALLOW, FIGMA_CSS, FIGMA_REACT, FIGMA_EXTRACT_REPEATED (true/false).
--react genera además componentes React en TypeScript (.tsx), uno por componente.
--extract-repeated convierte los grupos repetidos (3+ hermanos iguales) en un subcomponente con props y estados.
Los parámetros anulan al .env; --assets, --png, --no-shallow y --css activan/desactivan lo definido allí.
Cada ejecución reemplaza la salida anterior (solo los archivos que generó el extractor).`);
}

function fail(msg) {
	console.error("✖ " + msg);
	process.exit(1);
}

try {
	main();
} catch (e) {
	fail(e.message);
}
