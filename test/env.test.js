"use strict";
// Flujo con .env y npm: rutas con ~, copias que crea el navegador al descargar, decisiones que se
// encuentran junto al paquete y viewer.js sin argumentos.
// Uso: node --test   (sin dependencias)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const env = require("../env");

const ROOT = path.join(__dirname, "..");
// Sin variables del .env del proyecto: cada prueba define las suyas
const CLEAN = { ...process.env, FIGMA_FROM: "", FIGMA_DECISIONS: "", FIGMA_NAME: "", FIGMA_OUT_DIR: "", FIGMA_REACT: "", FIGMA_VIEWER: "", FIGMA_EXTRACT_REPEATED: "", FIGMA_ASSETS: "", FIGMA_CSS: "" };

let seq = 0;
const T = (s) => ({ id: `${++seq}:1`, name: s, type: "TEXT", characters: s, style: { fontSize: 12 }, absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 } });
const card = (label) => {
	const doc = { id: `${++seq}:1`, name: "Card", type: "FRAME", layoutMode: "VERTICAL", absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 }, children: [{ id: `${++seq}:1`, name: "Frame 5", type: "FRAME", layoutMode: "HORIZONTAL", absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 20 }, children: [T(label)] }] };
	return { figspec: 2, name: "Card", nodeId: doc.id, exportedAt: "2026-01-01T00:00:00Z", icons: {}, images: {}, variables: {}, nodes: { [doc.id]: { document: doc } } };
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "figspec-env-"));
const write = (file, data, ageSeconds = 0) => {
	fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
	const t = Date.now() / 1000 - ageSeconds;
	fs.utimesSync(file, t, t);
};
const run = (script, args, vars) => spawnSync("node", [path.join(ROOT, script), ...args], { env: { ...CLEAN, ...vars }, encoding: "utf8" });
const spec = (out) => JSON.parse(fs.readFileSync(path.join(out, "component.json"), "utf8"));

// ---------------------------------------------------------------- env.js
test("rutas con ~ y copias del navegador", () => {
	assert.equal(env.expandHome("~/x.json"), path.join(os.homedir(), "x.json"));
	assert.equal(env.expandHome("a/~/b"), "a/~/b");
	assert.equal(env.withoutCopyMark("/d/figspec-x (2).json"), "/d/figspec-x.json");
	assert.equal(env.withoutCopyMark("/d/figspec-card-2.json"), "/d/figspec-card-2.json", "un número con guion es parte del nombre");
	const dir = tmp();
	write(path.join(dir, "figspec-x.json"), "{}", 30);
	write(path.join(dir, "figspec-x (1).json"), "{}", 20);
	write(path.join(dir, "figspec-x(2).json"), "{}", 10);
	write(path.join(dir, "figspec-x-3.json"), "{}", 0);
	assert.equal(env.newestCopy(path.join(dir, "figspec-x.json")), path.join(dir, "figspec-x(2).json"));
	assert.equal(env.newestCopy(path.join(dir, "otro.json")), path.join(dir, "otro.json"), "sin el archivo ni copias, el mismo nombre");
});

// ---------------------------------------------------------------- extractor
test("FIGMA_FROM del .env: se usa la copia más reciente del paquete", () => {
	const dir = tmp();
	write(path.join(dir, "figspec-card.json"), card("Viejo"), 30);
	write(path.join(dir, "figspec-card (1).json"), card("Nuevo"), 0);
	const out = path.join(dir, "out");
	const r = run("extractor.js", ["--out-dir", out], { FIGMA_FROM: path.join(dir, "figspec-card.json") });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /copia más reciente: .*figspec-card \(1\)\.json/);
	assert.equal(spec(out).component.structure.children[0].children[0].text, "Nuevo");
	// Pasado como parámetro, se usa ese archivo tal cual
	const r2 = run("extractor.js", [path.join(dir, "figspec-card.json"), "--out-dir", out], {});
	assert.equal(r2.status, 0, r2.stderr);
	assert.equal(spec(out).component.structure.children[0].children[0].text, "Viejo");
});

test("decisiones junto al paquete: se aplican solas (la copia más reciente); --no-decisions no", () => {
	const dir = tmp();
	const bundle = card("Benefits");
	const frameId = bundle.nodes[bundle.nodeId].document.children[0].id;
	write(path.join(dir, "figspec-card.json"), bundle);
	const dec = (name) => ({ figspec: "decisions", version: 1, component: bundle.nodeId, names: { byId: { [frameId]: name } } });
	write(path.join(dir, "figspec-card.decisions.json"), dec("viejo"), 20);
	write(path.join(dir, "figspec-card.decisions (1).json"), dec("fila"), 0);
	const out = path.join(dir, "out");
	const r = run("extractor.js", [path.join(dir, "figspec-card.json"), "--out-dir", out], {});
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /Decisiones junto al paquete: .*decisions \(1\)\.json/);
	assert.equal(spec(out).component.structure.children[0].className, "fila");
	run("extractor.js", [path.join(dir, "figspec-card.json"), "--out-dir", out, "--no-decisions"], {});
	assert.equal(spec(out).component.structure.children[0].className, "benefitsRow");
});

test("las decisiones de una copia del paquete se buscan por el nombre original", () => {
	const dir = tmp();
	const bundle = card("Benefits");
	write(path.join(dir, "figspec-card (3).json"), bundle);
	write(path.join(dir, "figspec-card.decisions.json"), { figspec: "decisions", version: 1, component: bundle.nodeId, names: { root: "Tarjeta" } });
	const out = path.join(dir, "out");
	const r = run("extractor.js", [path.join(dir, "figspec-card (3).json"), "--out-dir", out], {});
	assert.equal(r.status, 0, r.stderr);
	assert.equal(spec(out).component.name, "Tarjeta");
});

// ---------------------------------------------------------------- viewer.js
test("viewer.js sin argumentos usa FIGMA_OUT_DIR", () => {
	const dir = tmp();
	write(path.join(dir, "figspec-card.json"), card("Hola"));
	const out = path.join(dir, "out");
	assert.equal(run("extractor.js", [path.join(dir, "figspec-card.json"), "--out-dir", out], {}).status, 0);
	const r = run("viewer.js", [], { FIGMA_OUT_DIR: out });
	assert.equal(r.status, 0, r.stderr);
	assert.ok(fs.existsSync(path.join(out, "viewer.html")));
	assert.equal(run("viewer.js", [], {}).status, 1, "sin carpeta ni FIGMA_OUT_DIR, muestra el uso");
});
