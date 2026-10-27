"use strict";
// El plugin (plugin/code.js) corrido con un `figma` simulado: análisis de la raíz, ubicar sin
// cambiar la selección, archivo de nombres aparte, solo lectura (el `figma` simulado falla ante
// cualquier escritura) y, sobre todo, paridad con el extractor: el plugin copia las reglas de
// nombres sugeridos y tiene que proponer lo mismo que el extractor usa.
// Uso: node --test   (sin dependencias)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const CODE = fs.readFileSync(path.join(ROOT, "plugin", "code.js"), "utf8");

// ---------------------------------------------------------------- documento de prueba (REST)
let seq = 0;
const box = () => ({ x: seq, y: 0, width: 50, height: 20 });
const T = (s) => ({ id: `${++seq}:1`, name: s, type: "TEXT", characters: s, style: { fontSize: 12 }, absoluteBoundingBox: box() });
const F = (name, layoutMode, children, extra = {}) => ({ id: `${++seq}:1`, name, type: "FRAME", layoutMode, absoluteBoundingBox: box(), children, ...extra });
const V = (name = "icon") => ({ id: `${++seq}:1`, name, type: "VECTOR", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }], absoluteBoundingBox: box() });

function sampleDoc() {
	return F("Frame 1", "VERTICAL", [
		...["Inicio", "Perfil", "Ajustes"].map((s) => F("Frame 2", "HORIZONTAL", [V("icon"), T(s)])),
		F("Frame 9", "VERTICAL", [T("Título"), T("Una descripción larga de ejemplo")]),
		F("Group 3", "NONE", [V("Vector")]),
		T("$1.200"),
		F("Header", "HORIZONTAL", [T("Bienvenido")]),
	]);
}

// ---------------------------------------------------------------- figma simulado
// Solo lectura: cualquier escritura en el documento (asignar una propiedad de un nodo, datos del
// plugin, crear o borrar nodos, cambiar la selección) lanza un error y queda en `writes`.
const WRITE_METHODS = ["setPluginData", "setSharedPluginData", "setRelaunchData", "remove", "appendChild", "insertChild", "setProperties", "resize", "rescale", "setRangeFontSize", "commitUndo", "createFrame", "createComponent", "createText", "createRectangle", "createPage", "group", "flatten", "ungroup"];
function readOnly(target, label, writes) {
	return new Proxy(target, {
		set(t, k) {
			writes.push(`${label}.${String(k)} =`);
			throw new Error(`El plugin escribió en Figma: ${label}.${String(k)}`);
		},
		get(t, k) {
			if (WRITE_METHODS.includes(k))
				return () => {
					writes.push(`${label}.${String(k)}()`);
					throw new Error(`El plugin escribió en Figma: ${label}.${String(k)}()`);
				};
			if (k === "getPluginData" || k === "getSharedPluginData")
				return () => {
					writes.push(`${label}.${String(k)}() (lectura de datos del plugin)`);
					return "";
				};
			return t[k];
		},
	});
}

function simulate(doc) {
	const entry = { document: doc, components: {}, componentSets: {}, styles: {} };
	const nodes = new Map();
	const writes = [];
	(function fake(n, parent) {
		const f = readOnly({
			id: n.id, name: n.name, parent, rotation: 0,
			exportAsync: async (s) =>
				s.format === "JSON_REST_V1" ? JSON.parse(JSON.stringify(entry)) : s.format === "SVG_STRING" ? `<svg><path d="M${n.id}"/></svg>` : new Uint8Array([1]),
		}, `nodo ${n.id}`, writes);
		nodes.set(n.id, f);
		(n.children || []).forEach((c) => fake(c, f));
	})(doc, null);
	const messages = [];
	const located = [];
	const handlers = {};
	// La selección la cambia la persona (la prueba, con select()), nunca el plugin
	const page = { selection: [nodes.get(doc.id)] };
	const figma = readOnly({
		currentPage: readOnly(page, "currentPage", writes),
		showUI() {},
		on: (ev, fn) => (handlers[ev] = fn),
		// La ventana del plugin no es el documento: ahí sí se asigna onmessage
		ui: { postMessage: (m) => messages.push(m), onmessage: null },
		viewport: { scrollAndZoomIntoView: (ns) => located.push(ns.map((x) => x.id)) },
		getNodeByIdAsync: async (id) => nodes.get(id) || null,
		getImageByHash: () => null,
		variables: { getVariableByIdAsync: async () => null },
	}, "figma", writes);
	vm.runInNewContext(CODE, { figma, __html__: "", console, Promise, Set, Map, Array, Object, String, Error, Date, JSON, Math });
	const select = (id) => (page.selection = [nodes.get(id)]);
	return { figma, messages, located, handlers, nodes, writes, select };
}
const tick = () => new Promise((r) => setTimeout(r, 10));
// Los objetos creados dentro de vm tienen otros prototipos: se comparan por contenido
const plain = (x) => JSON.parse(JSON.stringify(x));
const last = (msgs, type) => plain(msgs.filter((m) => m.type === type).at(-1));

async function exportWith(sim, names) {
	await sim.figma.ui.onmessage({ type: "export", options: { assets: true, png: false }, names });
	await tick();
	const errors = sim.messages.filter((m) => m.type === "error").map((m) => m.message);
	assert.deepEqual(plain(errors), [], "el plugin no debe fallar al exportar");
	const m = last(sim.messages, "bundle");
	sim.lastNames = m.names;
	return m.bundle;
}

// Como en el flujo real: el paquete y, si hay, el archivo de nombres en la misma carpeta
function extract(bundle, args = [], names = null) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figspec-plugin-"));
	fs.writeFileSync(path.join(dir, "in.json"), JSON.stringify(bundle));
	if (names) fs.writeFileSync(path.join(dir, "in.names.json"), JSON.stringify(names));
	execFileSync("node", [path.join(ROOT, "extractor.js"), path.join(dir, "in.json"), "--out-dir", path.join(dir, "out"), ...args], {
		stdio: "pipe",
		env: { ...process.env, FIGMA_FROM: "", FIGMA_DECISIONS: "", FIGMA_VIEWER: "", FIGMA_NAME: "", FIGMA_OUT_DIR: "", FIGMA_REACT: "", FIGMA_EXTRACT_REPEATED: "" },
	});
	const spec = JSON.parse(fs.readFileSync(path.join(dir, "out", "component.json"), "utf8"));
	const byName = [];
	(function walk(el) {
		byName.push(el);
		(el.children || []).forEach(walk);
	})(spec.component.structure);
	return { spec, byName };
}

// ---------------------------------------------------------------- pruebas
test("análisis: lista solo capas con nombre vago, con la raíz fijada", async () => {
	const doc = sampleDoc();
	const sim = simulate(doc);
	await tick();
	const a = last(sim.messages, "analysis");
	assert.equal(a.root.name, "Frame 1");
	assert.equal(a.root.generic, true);
	const names = a.rows.map((r) => r.name);
	assert.ok(!names.includes("Header"), "un nombre del diseñador no se lista");
	assert.ok(names.includes("Frame 9") && names.includes("Group 3") && names.includes("$1.200"));
});

test("paridad: la sugerencia del plugin es la clase que genera el extractor", async () => {
	const doc = sampleDoc();
	const sim = simulate(doc);
	await tick();
	const rows = last(sim.messages, "analysis").rows;
	const bundle = await exportWith(sim, { root: "", byId: {} });
	const { byName } = extract(bundle);
	// El extractor numera las clases repetidas (icon2…); la sugerencia es el nombre base
	const base = (cls) => cls.replace(/_?\d+$/, "");
	const mismatches = [];
	const seen = new Set();
	for (const r of rows) {
		const el = byName.find((e) => e.name === r.name && !seen.has(e));
		seen.add(el);
		if (!el || base(el.className) !== base(r.suggestion)) mismatches.push(`${r.name}: plugin ${r.suggestion} · extractor ${el && el.className}`);
	}
	assert.deepEqual(mismatches, []);
});

test("ubicar centra la capa sin cambiar la selección; otra selección solo se avisa", async () => {
	const doc = sampleDoc();
	const sim = simulate(doc);
	await tick();
	const row = last(sim.messages, "analysis").rows[0];
	await sim.figma.ui.onmessage({ type: "locate", id: row.id });
	assert.deepEqual(plain(sim.located), [[row.id]]);
	assert.equal(sim.figma.currentPage.selection[0].id, doc.id);

	sim.select(doc.children[0].id);
	sim.handlers.selectionchange();
	assert.deepEqual(last(sim.messages, "selection"), { type: "selection", other: "Frame 2" });
	assert.equal(sim.messages.filter((m) => m.type === "analysis").length, 1, "la raíz sigue fijada");

	const bundle = await exportWith(sim, { root: "Nav", byId: {} });
	assert.equal(bundle.nodeId, doc.id, "exporta la raíz fijada, no la selección actual");
});

test("los nombres elegidos van en un archivo aparte; el paquete es la foto de Figma", async () => {
	const doc = sampleDoc();
	const sim = simulate(doc);
	await tick();
	const rows = last(sim.messages, "analysis").rows;
	const frame9 = rows.find((r) => r.name === "Frame 9");
	const bundle = await exportWith(sim, { root: "Nav", byId: { [frame9.id]: "intro card", [rows[0].id]: "" } });
	const names = plain(sim.lastNames);
	assert.equal(bundle.figspec, 2);
	assert.equal(bundle.names, undefined, "el paquete no lleva nombres elegidos");
	assert.equal(names.figspec, "decisions");
	assert.equal(names.version, 2);
	assert.equal(names.origin, "plugin");
	assert.deepEqual(names.component, { id: doc.id, figma: "Frame 1" });
	assert.equal(names.root.name, "Nav");
	assert.deepEqual(names.layers.map((l) => [l.id, l.figma, l.name]), [[frame9.id, "Frame 9", "intro card"]], "solo los que tienen nombre");
	assert.deepEqual(names.layers[0].path, [["Frame 9", 0]]);
	assert.equal(names.layers[0].at, bundle.exportedAt);

	// Sin nombres elegidos no hay archivo
	await exportWith(sim, { root: "", byId: {}, states: {} });
	assert.equal(sim.lastNames, null);

	// Al reabrir, la ventana empieza vacía: los nombres viven en el archivo, no en Figma
	const again = simulate(doc);
	await tick();
	const a = last(again.messages, "analysis");
	assert.equal(a.root.value, "");
	assert.ok(a.rows.every((r) => r.value === ""));

	// El extractor encuentra el archivo de nombres junto al paquete y lo aplica
	const { spec, byName } = extract(bundle, [], names);
	assert.equal(spec.component.name, "Nav");
	assert.equal(byName.find((e) => e.name === "Frame 9").className, "introCard");
	assert.deepEqual(spec.meta.decisions.layers.map((x) => [x.id, x.name, x.origin]), [[frame9.id, "intro card", "plugin"]], "queda en meta.decisions para el visualizador");
});

test("ruta de una capa: posición entre homónimos (contando las ocultas)", async () => {
	const doc = F("Card", "VERTICAL", [F("Frame 2", "HORIZONTAL", [T("a")], { visible: false }), F("Frame 2", "HORIZONTAL", [T("b"), F("Group 1", "NONE", [V()])])]);
	const sim = simulate(doc);
	await tick();
	const group = doc.children[1].children[1];
	await exportWith(sim, { root: "", byId: { [group.id]: "badge" } });
	assert.deepEqual(plain(sim.lastNames).layers[0].path, [["Frame 2", 1], ["Group 1", 0]]);
});

test("solo lectura: exportar, analizar y ubicar no escriben ni leen datos en Figma", async () => {
	const doc = statesDoc();
	const sim = simulate(doc);
	await tick();
	const a = last(sim.messages, "analysis");
	await sim.figma.ui.onmessage({ type: "locate", id: a.rows[0] ? a.rows[0].id : doc.children[0].id });
	sim.select(doc.children[1].id);
	sim.handlers.selectionchange();
	await sim.figma.ui.onmessage({ type: "use-selection" });
	await tick();
	const states = Object.fromEntries(a.repeats[0].groups.flatMap((g) => g.ids.map((id) => [id, "x"])));
	await exportWith(sim, { root: "Nav", byId: {}, states });
	assert.deepEqual(plain(sim.writes), []);
});

test("solo lectura: el código del plugin no usa funciones de Figma que escriban", () => {
	const writes = CODE.match(/\b(set(Shared)?PluginData|setRelaunchData|getPluginData|getSharedPluginData|figma\.create\w+|\.remove\(|appendChild|insertChild|commitUndo|currentPage\.selection\s*=|\.name\s*=(?!=))/g);
	assert.equal(writes, null, `el plugin usa: ${writes}`);
});

// ---------------------------------------------------------------- estados de los repetidos
// Ítems iguales salvo el estilo: uno con fondo oscuro, uno con opacidad, uno con otra tipografía,
// uno con otro color de texto. El plugin agrupa por las propiedades de Figma y el extractor por el
// CSS que genera: tienen que dar los mismos grupos y los mismos nombres automáticos.
function statesDoc() {
	const solid = (r, g, b) => [{ type: "SOLID", color: { r, g, b, a: 1 } }];
	const label = (s, style = {}, fills = solid(0.3, 0.3, 0.3)) => ({ ...T(s), fills, style: { fontFamily: "Inter", fontWeight: 700, fontSize: 12, ...style } });
	const item = (s, extra = {}, text = {}) => F("Frame 2", "HORIZONTAL", [V("icon"), label(s, text.style, text.fills)], extra);
	return F("Nav", "VERTICAL", [
		item("Inicio", { fills: solid(0, 0, 0) }, { fills: solid(1, 1, 1) }),
		item("Perfil"),
		item("Ajustes"),
		item("Ayuda", { opacity: 0.4 }),
		item("Historial", {}, { style: { fontFamily: "Roboto", fontWeight: 500, fontSize: 14 } }),
		item("Salir", {}, { fills: solid(0.8, 0, 0) }),
	]);
}

test("estados: el plugin agrupa y nombra igual que el extractor", async () => {
	const doc = statesDoc();
	const sim = simulate(doc);
	await tick();
	const [rep] = last(sim.messages, "analysis").repeats;
	const pluginState = {};
	for (const g of rep.groups) for (const label of g.labels) pluginState[label] = g.auto;

	const bundle = await exportWith(sim, { root: "", byId: {}, states: {} });
	const { spec } = extract(bundle, ["--extract-repeated"]);
	const extractorState = Object.fromEntries(spec.component.structure.children.map((u) => [u.props.label, u.props.state]));
	assert.deepEqual(pluginState, extractorState);
	assert.deepEqual(Object.values(extractorState), ["active", "default", "default", "disabled", "default2", "default3"]);
});

test("estados: los nombres elegidos viajan por ítem en el archivo de nombres y el extractor los usa", async () => {
	const doc = statesDoc();
	const sim = simulate(doc);
	await tick();
	const [rep] = last(sim.messages, "analysis").repeats;
	const want = { active: "current", default: "normal", disabled: "" };
	const states = {};
	for (const g of rep.groups) for (const id of g.ids) states[id] = want[g.auto] || "";
	const bundle = await exportWith(sim, { root: "", byId: {}, states });
	const names = plain(sim.lastNames);
	assert.equal(names.states.length, 3, "solo los ítems con nombre (Inicio, Perfil, Ajustes)");

	const again = simulate(doc);
	await tick();
	assert.deepEqual(last(again.messages, "analysis").repeats[0].groups.map((g) => g.value), ["", "", "", "", ""], "la ventana no recuerda: no se guarda en Figma");

	const { spec } = extract(bundle, ["--extract-repeated"], names);
	const sub = Object.values(spec.subcomponents)[0];
	assert.equal(sub.props.state.default, "normal", "el estado por defecto también se puede renombrar");
	assert.deepEqual(sub.props.state.options, ["normal", "current", "disabled", "normal2", "normal3"], "los parecidos al de por defecto se numeran desde su nombre");
});
