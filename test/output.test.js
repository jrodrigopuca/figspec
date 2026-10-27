"use strict";
// Detalles de la salida: saltos de línea en textos, avisos cuando faltan archivos y notas de las
// aproximaciones (sombra interior en texto, capas espejadas, hijos de un elemento rotado).
// Uso: node --test   (sin dependencias)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const EXTRACTOR = path.join(__dirname, "..", "extractor.js");

let seq = 0;
const box = (w = 50, h = 20, x = 0, y = 0) => ({ x, y, width: w, height: h });
const T = (s, style = {}, extra = {}) => ({ id: `${++seq}:1`, name: s, type: "TEXT", characters: s, style: { fontSize: 12, ...style }, absoluteBoundingBox: box(), ...extra });
const F = (name, layoutMode, children, extra = {}) => ({ id: `${++seq}:1`, name, type: "FRAME", layoutMode, absoluteBoundingBox: box(200, 100), children, ...extra });
const V = () => ({ id: `${++seq}:1`, name: "icon", type: "VECTOR", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }], absoluteBoundingBox: box(16, 16) });

function extract(input, args = []) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figspec-out-"));
	const file = path.join(dir, "in.json");
	fs.writeFileSync(file, JSON.stringify(input.nodes ? input : { nodes: { [input.id]: { document: input } } }));
	const out = path.join(dir, "out");
	execFileSync("node", [EXTRACTOR, file, "--out-dir", out, ...args], {
		stdio: "pipe",
		env: { ...process.env, FIGMA_FROM: "", FIGMA_NAME: "", FIGMA_OUT_DIR: "", FIGMA_REACT: "", FIGMA_EXTRACT_REPEATED: "", FIGMA_ASSETS: "" },
	});
	const spec = JSON.parse(fs.readFileSync(path.join(out, "component.json"), "utf8"));
	const els = [];
	(function walk(el) {
		els.push(el);
		(el.children || []).forEach(walk);
	})(spec.component.structure);
	const el = (name) => els.find((e) => e.name === name);
	const css = (name) => spec.component.styles[el(name).className] || {};
	const note = (re) => spec.meta.notes.some((n) => re.test(n));
	return { spec, out, el, css, note };
}

// ---------------------------------------------------------------- saltos de línea
test("texto con saltos de línea → white-space: pre-line", () => {
	const r = extract(F("Card", "VERTICAL", [T("Línea 1\nLínea 2")]));
	assert.equal(r.css("Línea 1\nLínea 2")["white-space"], "pre-line");
});

test("texto que no se ajusta al ancho y tiene saltos de línea → pre", () => {
	const r = extract(F("Card", "VERTICAL", [T("Uno\nDos", { textAutoResize: "WIDTH_AND_HEIGHT" })]));
	assert.equal(r.css("Uno\nDos")["white-space"], "pre");
});

test("el separador de línea de Figma (U+2028) se normaliza a \\n", () => {
	const r = extract(F("Card", "VERTICAL", [T("Uno Dos")]));
	assert.equal(r.el("Uno Dos").text, "Uno\nDos");
	assert.equal(r.css("Uno Dos")["white-space"], "pre-line");
});

test("un texto de una línea con elipsis conserva nowrap", () => {
	const r = extract(F("Card", "VERTICAL", [T("Uno\nDos", { textTruncation: "ENDING" })]));
	assert.equal(r.css("Uno\nDos")["white-space"], "nowrap");
});

test("sin saltos de línea no cambia nada", () => {
	const r = extract(F("Card", "VERTICAL", [T("Hola")]));
	assert.equal(r.css("Hola")["white-space"], undefined);
});

test("React: el texto con saltos de línea se escribe como expresión", () => {
	const r = extract(F("Card", "VERTICAL", [T("Uno\nDos")]), ["--react"]);
	const tsx = fs.readFileSync(path.join(r.out, "Card", "Card.tsx"), "utf8");
	assert.match(tsx, /\{"Uno\\nDos"\}/);
});

// ---------------------------------------------------------------- avisos de archivos que faltan
test("una entrada que no es paquete del plugin avisa que faltan íconos e imágenes", () => {
	const doc = F("Toolbar", "HORIZONTAL", [V(), T("Inicio")]);
	assert.ok(extract(doc).note(/no es un paquete del plugin/));
	assert.equal(extract(doc, ["--no-assets"]).note(/no es un paquete del plugin/), false, "sin assets no hace falta");
	const bundle = { figspec: 1, name: "Toolbar", nodeId: doc.id, exportedAt: "2026-01-01T00:00:00Z", icons: {}, images: {}, variables: {}, nodes: { [doc.id]: { document: doc } } };
	assert.equal(extract(bundle).note(/no es un paquete del plugin/), false);
});

test("sin íconos ni imágenes no hay aviso", () => {
	assert.equal(extract(F("Card", "VERTICAL", [T("Hola")])).note(/no es un paquete del plugin/), false);
});

// ---------------------------------------------------------------- notas de aproximaciones
test("sombra interior en un texto: se aproxima y se avisa", () => {
	const shadow = { type: "INNER_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.5 }, offset: { x: 0, y: 1 }, radius: 2 };
	const r = extract(F("Card", "VERTICAL", [T("Hola", {}, { effects: [shadow] })]));
	assert.ok(r.css("Hola")["text-shadow"]);
	assert.ok(r.note(/sombra interior/));
});

test("capa espejada: no se rota y se avisa", () => {
	const flipped = F("Flecha", "NONE", [], {
		fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
		size: { x: 40, y: 20 },
		relativeTransform: [[-1, 0, 40], [0, 1, 0]],
		absoluteBoundingBox: box(40, 20),
	});
	const r = extract(F("Card", "NONE", [flipped]));
	assert.equal(r.css("Flecha").transform, undefined, "un espejado no es una rotación de 180°");
	assert.ok(r.note(/espejadas/));
});

test("hijo con posición absoluta dentro de un elemento rotado: se avisa", () => {
	const c = Math.cos(Math.PI / 6), s = Math.sin(Math.PI / 6);
	const rotated = F("Girado", "NONE", [{ ...T("Dentro"), absoluteBoundingBox: box(20, 10, 10, 10) }], {
		size: { x: 100, y: 40 },
		relativeTransform: [[c, s, 0], [-s, c, 0]],
		absoluteBoundingBox: box(106.6, 84.64),
	});
	const r = extract(F("Card", "NONE", [rotated]));
	assert.ok(r.note(/dentro de un elemento rotado/));
});

// ---------------------------------------------------------------- cajas de texto de alto fijo
test("texto en caja de alto fijo centrado verticalmente → alto + flex centrado", () => {
	const t = { ...T("BackOffice", { textAlignVertical: "CENTER", textAlignHorizontal: "CENTER" }), absoluteBoundingBox: box(412, 146, 10, 20), layoutPositioning: "ABSOLUTE" };
	const r = extract(F("Card", "NONE", [t]));
	const css = r.css("BackOffice");
	assert.equal(css.height, "146px");
	assert.deepEqual([css.display, css["flex-direction"], css["justify-content"]], ["flex", "column", "center"]);
});

test("texto alineado abajo → justify-content: flex-end", () => {
	const r = extract(F("Card", "VERTICAL", [T("Pie", { textAlignVertical: "BOTTOM" })]));
	assert.equal(r.css("Pie")["justify-content"], "flex-end");
});

test("texto con auto alto: sin alto fijo ni flex, aunque esté centrado", () => {
	const r = extract(F("Card", "VERTICAL", [T("Auto", { textAutoResize: "HEIGHT", textAlignVertical: "CENTER" })]));
	assert.equal(r.css("Auto").height, undefined);
	assert.equal(r.css("Auto").display, undefined);
});

test("texto centrado con partes de estilo distinto: se deja arriba y se avisa", () => {
	const t = { ...T("Hola mundo", { textAlignVertical: "CENTER" }), characterStyleOverrides: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1], styleOverrideTable: { 1: { fontWeight: 700 } } };
	const r = extract(F("Card", "VERTICAL", [t]));
	assert.equal(r.css("Hola mundo").display, undefined);
	assert.ok(r.note(/alineación vertical/));
});

// ---------------------------------------------------------------- accesibilidad según el estado
function stateSet(states) {
	const variant = (s) => ({ id: `${++seq}:1`, name: `State=${s}`, type: "COMPONENT", layoutMode: "HORIZONTAL", absoluteBoundingBox: box(100, 40), children: [T("Ok")] });
	return {
		id: `${++seq}:1`, name: "Button", type: "COMPONENT_SET", absoluteBoundingBox: box(300, 100),
		componentPropertyDefinitions: { State: { type: "VARIANT", defaultValue: states[0], variantOptions: states } },
		children: states.map(variant),
	};
}

test("aria: valores de variante con active/current/selected o disabled", () => {
	const r = extract(stateSet(["Default", "Active", "Inactive", "Disabled", "Legacy Disabled"]));
	assert.deepEqual(r.spec.component.aria, [
		{ attr: "aria-current", prop: "state", values: ["Active"] },
		{ attr: "aria-disabled", prop: "state", values: ["Disabled", "Legacy Disabled"] },
	]);
	assert.ok(r.note(/aria-current="page"/), "sugiere page para menús");
});

test("aria: sin estados reconocibles no se agrega nada", () => {
	const r = extract(stateSet(["Default", "Hover", "Pressed"]));
	assert.equal(r.spec.component.aria, undefined);
});

test("aria: los ítems extraídos con estados automáticos (active, disabled) lo reciben", () => {
	const item = (s, extra = {}) => F("Item", "HORIZONTAL", [T(s)], extra);
	const dark = { fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }] };
	const r = extract(F("Nav", "VERTICAL", [item("A", dark), item("B"), item("C"), item("D", { opacity: 0.4 })]), ["--extract-repeated", "--react"]);
	assert.deepEqual(r.spec.subcomponents.Item.aria.map((a) => [a.attr, a.values]), [["aria-current", ["active"]], ["aria-disabled", ["disabled"]]]);
	const tsx = fs.readFileSync(path.join(r.out, "Nav", "Item.tsx"), "utf8");
	assert.match(tsx, /aria-current=\{state === "active" \? "true" : undefined\}/);
	assert.match(tsx, /aria-disabled=\{state === "disabled" \|\| undefined\}/);
});

// ---------------------------------------------------------------- listas (items.map)
test("items.map: los ítems extraídos se renderizan desde una prop con los datos de Figma", () => {
	const item = (s) => F("Tab", "HORIZONTAL", [T(s)]);
	const r = extract(F("Tabs", "HORIZONTAL", [item("Todos"), item("Activos"), item("Archivados")]), ["--extract-repeated", "--react"]);
	const tsx = fs.readFileSync(path.join(r.out, "Tabs", "Tabs.tsx"), "utf8");
	assert.match(tsx, /import \{ Tab, type TabProps \} from "\.\/Tab";/);
	assert.match(tsx, /tabs\?: TabProps\[\];/);
	assert.match(tsx, /const defaultTabs: TabProps\[\] = \[\n {2}\{ label: "Todos" \},\n {2}\{ label: "Activos" \},\n {2}\{ label: "Archivados" \},\n\];/);
	assert.match(tsx, /function Tabs\(\{ tabs = defaultTabs, className \}/);
	assert.match(tsx, /\{tabs\.map\(\(item\) => \(\n\s+<Tab key=\{item\.label\} className=\{styles\.item\} \{\.\.\.item\} \/>/);
});

test("items.map: con labels repetidos la key es el índice", () => {
	const item = (s, extra = {}) => F("Row", "HORIZONTAL", [T(s)], extra);
	const r = extract(F("List", "VERTICAL", [item("Igual"), item("Igual", { opacity: 0.4 }), item("Otro")]), ["--extract-repeated", "--react"]);
	const tsx = fs.readFileSync(path.join(r.out, "List", "List.tsx"), "utf8");
	assert.match(tsx, /rows\.map\(\(item, i\) => \(\n\s+<Row key=\{i\}/);
});

test("items.map: ítems intercalados con otros elementos quedan como instancias explícitas", () => {
	const item = (s) => F("Tab", "HORIZONTAL", [T(s)]);
	const r = extract(F("Tabs", "HORIZONTAL", [item("A1"), F("Divider", "NONE", [T("|")]), item("B1"), item("C1")]), ["--extract-repeated", "--react"]);
	const tsx = fs.readFileSync(path.join(r.out, "Tabs", "Tabs.tsx"), "utf8");
	// Un divisor entre medio: una lista cubriría solo una parte, así que todas quedan explícitas
	for (const l of ["A1", "B1", "C1"]) assert.match(tsx, new RegExp(`<Tab className=\\{styles\\.item\\} label="${l}" \\/>`));
	assert.doesNotMatch(tsx, /\.map\(/);
});
