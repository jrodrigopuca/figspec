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

// ---------------------------------------------------------------- inconsistencias del diseño
const report = (r) => {
	const f = path.join(r.out, "inconsistencies.md");
	return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
};

test("inconsistencias: ítems repetidos que difieren solo en tipografía", () => {
	const item = (s, style) => F("Item", "HORIZONTAL", [T(s, { fontFamily: "Inter", fontWeight: 700, ...style })]);
	const r = extract(F("Menu", "VERTICAL", [item("Uno"), item("Dos"), item("Tres", { fontFamily: "Roboto", fontWeight: 500 })]));
	assert.match(report(r), /«Tres» usa Roboto · 500 en vez de Inter · 700, a diferencia de «Uno», «Dos»/);
});

test("inconsistencias: color escrito a mano que coincide con un estilo", () => {
	const red = [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }];
	const doc = F("Card", "VERTICAL", [F("Con estilo", "NONE", [], { fills: red, styles: { fill: "S:1" } }), F("Sin estilo", "NONE", [], { fills: red })]);
	const r = extract({ nodes: { [doc.id]: { document: doc, styles: { "S:1": { name: "Brand/Red", styleType: "FILL" } } } } });
	assert.match(report(r), /#FF0000 está escrito a mano en «Sin estilo» \(Card\); coincide con «brand-red»/);
});

test("inconsistencias: texto con los valores de un estilo de texto sin aplicarlo", () => {
	const font = { fontFamily: "Inter", fontWeight: 400, fontSize: 14 };
	const doc = F("Card", "VERTICAL", [{ ...T("Título", font), styles: { text: "S:2" } }, T("Suelto", font)]);
	const r = extract({ nodes: { [doc.id]: { document: doc, styles: { "S:2": { name: "Body", styleType: "TEXT" } } } } });
	assert.match(report(r), /«Suelto» \(capa «Suelto», Card\) tiene los valores de «Body» sin aplicar el estilo/);
	assert.doesNotMatch(report(r), /«Título»/, "el que tiene el estilo aplicado no se reporta");
});

test("inconsistencias: sin ninguna no se escribe el archivo", () => {
	assert.equal(report(extract(F("Card", "VERTICAL", [T("Hola")]))), null);
});

// ---------------------------------------------------------------- meta.format y meta.preview
// PNG mínimo: solo la firma y el encabezado IHDR con el tamaño (lo único que se lee)
function fakePng(w, h) {
	const b = Buffer.alloc(24);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
	b.writeUInt32BE(13, 8);
	b.write("IHDR", 12, "ascii");
	b.writeUInt32BE(w, 16);
	b.writeUInt32BE(h, 20);
	return b.toString("base64");
}
const pluginBundle = (doc, preview) => ({
	figspec: 2, name: doc.name, nodeId: doc.id, exportedAt: "2026-01-01T00:00:00Z",
	icons: {}, images: {}, variables: {}, preview, nodes: { [doc.id]: { document: doc } },
});

test("meta.format siempre; meta.preview no sin vista previa", () => {
	const r = extract(F("Card", "VERTICAL", [T("Hola")]));
	assert.equal(r.spec.meta.format, 1);
	assert.equal(r.spec.meta.preview, undefined);
});

test("meta.preview: la sombra agranda la imagen y desplaza el componente", () => {
	const doc = F("Menu", "VERTICAL", [T("Hola")], {
		absoluteBoundingBox: { x: 100, y: 50, width: 320, height: 900 },
		absoluteRenderBounds: { x: 84, y: 38, width: 344, height: 924 },
	});
	const r = extract(pluginBundle(doc, fakePng(344, 924)));
	assert.deepEqual(r.spec.meta.preview, { file: "preview.png", width: 344, height: 924, scale: 1, offset: { x: 16, y: 12 } });
	assert.ok(fs.existsSync(path.join(r.out, "preview.png")));
});

test("meta.preview: en un set, la posición de la variante por defecto dentro de la imagen del set", () => {
	const variant = (name, x) => ({ id: `${++seq}:1`, name, type: "COMPONENT", layoutMode: "HORIZONTAL", absoluteBoundingBox: { x, y: 20, width: 100, height: 40 }, children: [T("Ok")] });
	const set = {
		id: `${++seq}:1`, name: "Button", type: "COMPONENT_SET",
		absoluteBoundingBox: { x: 0, y: 0, width: 260, height: 80 }, absoluteRenderBounds: { x: 0, y: 0, width: 260, height: 80 },
		componentPropertyDefinitions: { State: { type: "VARIANT", defaultValue: "Hover", variantOptions: ["Default", "Hover"] } },
		children: [variant("State=Default", 20), variant("State=Hover", 140)],
	};
	const r = extract(pluginBundle(set, fakePng(520, 160)));
	const { variants, ...preview } = r.spec.meta.preview;
	assert.deepEqual(preview, { file: "preview.png", width: 520, height: 160, scale: 2, offset: { x: 280, y: 40 } }, "variante Hover en x=140 y=20, imagen @2x");
	assert.deepEqual(variants, [
		{ when: { state: "Default" }, offset: { x: 40, y: 40 }, width: 200, height: 80 },
		{ when: { state: "Hover" }, offset: { x: 280, y: 40 }, width: 200, height: 80 },
	], "cada variante con su posición y tamaño en la imagen");
});

test("meta.preview: con --no-png no se incluye", () => {
	const doc = F("Card", "VERTICAL", [T("Hola")]);
	assert.equal(extract(pluginBundle(doc, fakePng(200, 100)), ["--no-png"]).spec.meta.preview, undefined);
});

// ---------------------------------------------------------------- figma-geometry.json
test("geometría: la caja de Figma de cada capa, relativa a la raíz de su variante", () => {
	const at = (n, x, y) => ({ ...n, absoluteBoundingBox: { ...n.absoluteBoundingBox, x, y } });
	const variant = (state, x, y, extra) => ({
		id: `${++seq}:1`, name: `State=${state}`, type: "COMPONENT", layoutMode: "VERTICAL", absoluteBoundingBox: { x, y, width: 100, height: 60 },
		children: [at(T("Título"), x + 8, y + 4), at(T("Texto"), x + 8, y + (state === "Open" ? 30 : 24)), ...(extra || [])],
	});
	const set = {
		id: `${++seq}:1`, name: "Panel", type: "COMPONENT_SET", absoluteBoundingBox: box(400, 200),
		componentPropertyDefinitions: { State: { type: "VARIANT", defaultValue: "Closed", variantOptions: ["Closed", "Open"] } },
		children: [variant("Closed", 0, 0), variant("Open", 200, 100)],
	};
	const r = extract(pluginBundle(set));
	const g = JSON.parse(fs.readFileSync(path.join(r.out, "figma-geometry.json"), "utf8"));
	const [closed, open] = g.variants;
	const [title, text] = r.spec.component.structure.children;
	assert.deepEqual(closed.when, { state: "Closed" });
	assert.deepEqual(closed.boxes[title.id], [8, 4, 50, 20]);
	assert.deepEqual(closed.boxes[text.id], [8, 24, 50, 20]);
	// En Open, la misma capa (por clase) con su posición en esa variante
	assert.deepEqual(open.boxes[text.id], [8, 30, 50, 20]);
	assert.deepEqual(open.boxes[r.spec.component.structure.id], [0, 0, 100, 60]);
	const files = JSON.parse(fs.readFileSync(path.join(r.out, ".figspec-manifest.json"), "utf8")).files;
	assert.ok(files.includes("figma-geometry.json"), "registrado en el manifiesto");
});
