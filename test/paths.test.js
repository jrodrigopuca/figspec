"use strict";
// Rutas y archivos: rutas con ~, copias que crea el navegador al descargar, decisiones que se
// encuentran junto al paquete o que se pasan con -d, y que nada se lee del entorno.
// Uso: node --test   (sin dependencias)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const paths = require("../src/paths");

const ROOT = path.join(__dirname, "..");

let seq = 0;
const T = (s) => ({ id: `${++seq}:1`, name: s, type: "TEXT", characters: s, style: { fontSize: 12 }, absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 } });
const card = (label) => {
	const doc = { id: `${++seq}:1`, name: "Card", type: "FRAME", layoutMode: "VERTICAL", absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 }, children: [{ id: `${++seq}:1`, name: "Frame 5", type: "FRAME", layoutMode: "HORIZONTAL", absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 20 }, children: [T(label)] }] };
	return { figspec: 2, name: "Card", nodeId: doc.id, exportedAt: "2026-01-01T00:00:00Z", icons: {}, images: {}, variables: {}, nodes: { [doc.id]: { document: doc } } };
};
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "figspec-paths-"));
const write = (file, data, ageSeconds = 0) => {
	fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data));
	const t = Date.now() / 1000 - ageSeconds;
	fs.utimesSync(file, t, t);
};
const run = (script, args, vars = {}) => spawnSync("node", [path.join(ROOT, "src", script), ...args], { env: { ...process.env, ...vars }, encoding: "utf8" });
const spec = (out) => JSON.parse(fs.readFileSync(path.join(out, "component.json"), "utf8"));
const names = (bundle, name, at) => {
	const frame = bundle.nodes[bundle.nodeId].document.children[0];
	return { figspec: "decisions", version: 2, origin: "plugin", component: { id: bundle.nodeId }, layers: [{ id: frame.id, figma: frame.name, path: [[frame.name, 0]], name, at }] };
};

// ---------------------------------------------------------------- paths.js
test("rutas con ~ y copias del navegador", () => {
	assert.equal(paths.expandHome("~/x.json"), path.join(os.homedir(), "x.json"));
	assert.equal(paths.expandHome("a/~/b"), "a/~/b");
	assert.equal(paths.withoutCopyMark("/d/figspec-x (2).json"), "/d/figspec-x.json");
	assert.equal(paths.withoutCopyMark("/d/figspec-card-2.json"), "/d/figspec-card-2.json", "un número con guion es parte del nombre");
	const dir = tmp();
	write(path.join(dir, "figspec-x.json"), "{}", 30);
	write(path.join(dir, "figspec-x (1).json"), "{}", 20);
	write(path.join(dir, "figspec-x(2).json"), "{}", 10);
	write(path.join(dir, "figspec-x-3.json"), "{}", 0);
	assert.equal(paths.newestCopy(path.join(dir, "figspec-x.json")), path.join(dir, "figspec-x(2).json"));
	assert.equal(paths.newestCopy(path.join(dir, "otro.json")), path.join(dir, "otro.json"), "sin el archivo ni copias, el mismo nombre");
});

// ---------------------------------------------------------------- sin entorno
test("nada se lee del entorno: sin -s falta el paquete aunque haya variables FIGMA_*", () => {
	const dir = tmp();
	write(path.join(dir, "figspec-card.json"), card("Hola"));
	const r = run("extractor.js", ["--out-dir", path.join(dir, "out")], { FIGMA_FROM: path.join(dir, "figspec-card.json"), FIGMA_OUT_DIR: path.join(dir, "otra") });
	assert.equal(r.status, 1);
	assert.match(r.stderr, /Falta el paquete/);
	// Con -s, la salida va donde dice -o y las opciones del entorno no se aplican
	const out = path.join(dir, "out");
	const r2 = run("extractor.js", ["-s", path.join(dir, "figspec-card.json"), "-o", out], { FIGMA_OUT_DIR: path.join(dir, "otra"), FIGMA_REACT: "true", FIGMA_VIEWER: "true" });
	assert.equal(r2.status, 0, r2.stderr);
	assert.ok(fs.existsSync(path.join(out, "component.json")));
	assert.ok(!fs.existsSync(path.join(dir, "otra")));
	assert.ok(!fs.existsSync(path.join(out, "viewer.html")) && !fs.existsSync(path.join(out, "Card", "Card.tsx")));
});

test("un parámetro sin valor falla con un mensaje", () => {
	const r = run("extractor.js", ["-s"]);
	assert.equal(r.status, 1);
	assert.match(r.stderr, /Falta el valor de -s/);
});

// ---------------------------------------------------------------- decisiones junto al paquete
test("decisiones junto al paquete: se aplican solas (la copia más reciente); --ignore-decisions no", () => {
	const dir = tmp();
	const bundle = card("Benefits");
	const frameId = bundle.nodes[bundle.nodeId].document.children[0].id;
	write(path.join(dir, "figspec-card.json"), bundle);
	const dec = (name) => ({ figspec: "decisions", version: 1, component: bundle.nodeId, names: { byId: { [frameId]: name } } });
	write(path.join(dir, "figspec-card.decisions.json"), dec("viejo"), 20);
	write(path.join(dir, "figspec-card.decisions (1).json"), dec("fila"), 0);
	const out = path.join(dir, "out");
	const r = run("extractor.js", [path.join(dir, "figspec-card.json"), "--out-dir", out]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /Decisiones junto al paquete: .*decisions \(1\)\.json/);
	assert.equal(spec(out).component.structure.children[0].className, "fila");
	run("extractor.js", [path.join(dir, "figspec-card.json"), "--out-dir", out, "--ignore-decisions"]);
	assert.equal(spec(out).component.structure.children[0].className, "benefitsRow");
});

test("las decisiones de una copia del paquete se buscan por el nombre original", () => {
	const dir = tmp();
	const bundle = card("Benefits");
	write(path.join(dir, "figspec-card (3).json"), bundle);
	write(path.join(dir, "figspec-card.decisions.json"), { figspec: "decisions", version: 1, component: bundle.nodeId, names: { root: "Tarjeta" } });
	const out = path.join(dir, "out");
	const r = run("extractor.js", [path.join(dir, "figspec-card (3).json"), "--out-dir", out]);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(spec(out).component.name, "Tarjeta");
});

// ---------------------------------------------------------------- viewer.js
test("viewer.js <carpeta de salida> escribe viewer.html; sin carpeta, muestra el uso", () => {
	const dir = tmp();
	write(path.join(dir, "figspec-card.json"), card("Hola"));
	const out = path.join(dir, "out");
	assert.equal(run("extractor.js", [path.join(dir, "figspec-card.json"), "--out-dir", out]).status, 0);
	const r = run("viewer.js", [out]);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(fs.existsSync(path.join(out, "viewer.html")));
	assert.equal(run("viewer.js", [], { FIGMA_OUT_DIR: out }).status, 1, "sin carpeta, muestra el uso");
});

// ---------------------------------------------------------------- -d: decisiones del proyecto
test("-d archivo: se crea con lo entrante, con cualquier nombre, y se actualiza solo si cambia", () => {
	const dir = tmp();
	const bundle = card("Benefits");
	write(path.join(dir, "paquete.json"), bundle);
	write(path.join(dir, "paquete.names.json"), names(bundle, "delPlugin", "2026-10-27T10:00:00.000Z"));
	const file = path.join(dir, "proyecto", "fignames.json");
	const out = path.join(dir, "out");
	const args = ["-s", path.join(dir, "paquete.json"), "-d", file, "-o", out];
	const r = run("extractor.js", args);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /Decisiones del proyecto creadas: .*fignames\.json/);
	const saved = JSON.parse(fs.readFileSync(file, "utf8"));
	assert.equal(saved.version, 2);
	assert.deepEqual(saved.component, { id: bundle.nodeId, figma: "Card" });
	assert.deepEqual(saved.layers.map((x) => [x.name, x.origin]), [["delPlugin", "plugin"]]);

	// Sin cambios: no se reescribe
	const t0 = fs.statSync(file).mtimeMs;
	const r2 = run("extractor.js", args);
	assert.doesNotMatch(r2.stderr, /✎/);
	assert.equal(fs.statSync(file).mtimeMs, t0);

	// Lo que descargó el visualizador junto al paquete, más reciente, se incorpora
	write(path.join(dir, "paquete.decisions.json"), { ...names(bundle, "fila", "2026-10-27T11:00:00.000Z"), origin: "viewer" });
	const r3 = run("extractor.js", args);
	assert.match(r3.stderr, /Decisiones descargadas: .*paquete\.decisions\.json/);
	assert.match(r3.stderr, /Decisiones del proyecto actualizadas/);
	assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).layers.map((x) => x.name), ["fila"]);
	assert.equal(spec(out).component.structure.children[0].className, "fila");

	// El archivo del plugin, más viejo, ya no lo pisa
	const r4 = run("extractor.js", args);
	assert.equal(spec(out).component.structure.children[0].className, "fila");
	assert.doesNotMatch(r4.stderr, /✎/);
});

test("-d carpeta: el archivo se encuentra por el id del componente aunque se llame distinto", () => {
	const dir = tmp();
	const bundle = card("Benefits");
	write(path.join(dir, "figspec-card.json"), bundle);
	const project = path.join(dir, "figspec");
	fs.mkdirSync(project);
	write(path.join(project, "tarjeta-vieja.decisions.json"), { ...names(bundle, "renombrada", "2026-10-27T10:00:00.000Z"), origin: "project" });
	const r = run("extractor.js", [path.join(dir, "figspec-card.json"), "--out-dir", path.join(dir, "out"), "-d", project]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /Decisiones del proyecto: .*tarjeta-vieja\.decisions\.json/);
	assert.equal(spec(path.join(dir, "out")).component.structure.children[0].className, "renombrada");
	assert.ok(!fs.existsSync(path.join(project, "card.decisions.json")));
});

test("--decisions (interno) solo se lee: no se modifica", () => {
	const dir = tmp();
	const bundle = card("Benefits");
	write(path.join(dir, "figspec-card.json"), bundle);
	write(path.join(dir, "figspec-card.names.json"), names(bundle, "delPlugin", "2026-10-27T12:00:00.000Z"));
	const dec = path.join(dir, "otra", "x.decisions.json");
	fs.mkdirSync(path.dirname(dec));
	write(dec, names(bundle, "viejo", "2026-10-27T09:00:00.000Z"));
	const before = fs.readFileSync(dec, "utf8");
	assert.equal(run("extractor.js", [path.join(dir, "figspec-card.json"), "--out-dir", path.join(dir, "out"), "--decisions", dec]).status, 0);
	assert.equal(fs.readFileSync(dec, "utf8"), before);
});

test("a igual fecha, las decisiones del proyecto ganan a un .names.json suelto (plugin)", () => {
	const dir = tmp();
	const bundle = card("Benefits");
	const at = "2026-10-27T10:00:00.000Z";
	write(path.join(dir, "figspec-card.json"), bundle);
	write(path.join(dir, "figspec-card.names.json"), names(bundle, "delPlugin", at));
	const file = path.join(dir, "card.decisions.json");
	write(file, { ...names(bundle, "delProyecto", at), origin: "viewer" });
	const r = run("extractor.js", [path.join(dir, "figspec-card.json"), "--out-dir", path.join(dir, "out"), "-d", file]);
	assert.equal(r.status, 0, r.stderr);
	assert.equal(spec(path.join(dir, "out")).component.structure.children[0].className, "delProyecto");
});

test("los nombres de la sección decisions del paquete pasan al archivo de -d", () => {
	const dir = tmp();
	const bundle = card("Benefits");
	bundle.decisions = { ...names(bundle, "delPlugin", "2026-10-27T10:00:00.000Z"), savedAt: "2026-10-27T10:00:00.000Z" };
	write(path.join(dir, "figspec-card.json"), bundle);
	const file = path.join(dir, "nombres.json");
	const out = path.join(dir, "out");
	const r = run("extractor.js", ["-s", path.join(dir, "figspec-card.json"), "-o", out, "-d", file]);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /nombres elegidos en el plugin/);
	assert.equal(spec(out).component.structure.children[0].className, "delPlugin");
	assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).layers.map((x) => [x.name, x.origin]), [["delPlugin", "plugin"]]);
});
