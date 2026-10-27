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
