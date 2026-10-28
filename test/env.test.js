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
const CLEAN = { ...process.env, FIGMA_FROM: "", FIGMA_DECISIONS: "", FIGMA_INBOX: "", FIGMA_NAME: "", FIGMA_OUT_DIR: "", FIGMA_REACT: "", FIGMA_VIEWER: "", FIGMA_EXTRACT_REPEATED: "", FIGMA_ASSETS: "", FIGMA_CSS: "" };

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

// ---------------------------------------------------------------- carpetas por componente (.env)
const cardNamed = (name, label) => {
	const b = card(label);
	b.name = name;
	return b;
};
const names = (bundle, name, at) => {
	const frame = bundle.nodes[bundle.nodeId].document.children[0];
	return { figspec: "decisions", version: 2, origin: "plugin", component: { id: bundle.nodeId }, layers: [{ id: frame.id, figma: frame.name, path: [[frame.name, 0]], name, at }] };
};

test("FIGMA_FROM carpeta: el último paquete, o el del componente nombrado", () => {
	const dir = tmp();
	write(path.join(dir, "figspec-card.json"), card("Card"), 20);
	write(path.join(dir, "figspec-login.json"), card("Login"), 10);
	write(path.join(dir, "figspec-login.names.json"), { figspec: "decisions", version: 2, layers: [] }, 0); // no es un paquete
	const base = path.join(dir, "out");
	const vars = { FIGMA_FROM: dir, FIGMA_OUT_DIR: base };
	const r = run("extractor.js", [], vars);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /Paquete: .*figspec-login\.json/);
	assert.ok(fs.existsSync(path.join(base, "login", "component.json")), "una subcarpeta por componente");
	const r2 = run("extractor.js", ["card"], vars);
	assert.equal(r2.status, 0, r2.stderr);
	assert.equal(spec(path.join(base, "card")).component.structure.children[0].children[0].text, "Card");
	const r3 = run("extractor.js", ["otro"], vars);
	assert.equal(r3.status, 1);
	assert.match(r3.stderr, /No está figspec-otro\.json .* Hay: login, card\./);
});

test("FIGMA_OUT_DIR que ya es una salida (con manifiesto) se sigue usando tal cual", () => {
	const dir = tmp();
	write(path.join(dir, "figspec-card.json"), card("Hola"));
	const out = path.join(dir, "out");
	assert.equal(run("extractor.js", [path.join(dir, "figspec-card.json"), "--out-dir", out], {}).status, 0);
	assert.equal(run("extractor.js", [path.join(dir, "figspec-card.json")], { FIGMA_OUT_DIR: out }).status, 0);
	assert.ok(!fs.existsSync(path.join(out, "card", "component.json")), "no crea una subcarpeta dentro de una salida");
	assert.ok(fs.existsSync(path.join(out, "component.json")));
});

test("FIGMA_DECISIONS carpeta: se crea el archivo del componente con lo entrante y se actualiza solo si cambia", () => {
	const dir = tmp();
	const exports = path.join(dir, "exports");
	const inbox = path.join(dir, "Downloads");
	const project = path.join(dir, "figspec");
	fs.mkdirSync(exports);
	fs.mkdirSync(inbox);
	const bundle = cardNamed("Card", "Benefits");
	write(path.join(exports, "figspec-card.json"), bundle);
	write(path.join(exports, "figspec-card.names.json"), names(bundle, "delPlugin", "2026-10-27T10:00:00.000Z"));
	const vars = { FIGMA_FROM: exports, FIGMA_OUT_DIR: path.join(dir, "out"), FIGMA_DECISIONS: project, FIGMA_INBOX: inbox };
	const r = run("extractor.js", [], vars);
	assert.equal(r.status, 0, r.stderr);
	const file = path.join(project, "card.decisions.json");
	assert.match(r.stderr, /Decisiones del proyecto creadas: .*card\.decisions\.json/);
	const saved = JSON.parse(fs.readFileSync(file, "utf8"));
	assert.equal(saved.version, 2);
	assert.deepEqual(saved.component, { id: bundle.nodeId, figma: "Card" });
	assert.deepEqual(saved.layers.map((x) => [x.name, x.origin]), [["delPlugin", "plugin"]]);

	// Sin cambios: no se reescribe
	const t0 = fs.statSync(file).mtimeMs;
	const r2 = run("extractor.js", [], vars);
	assert.doesNotMatch(r2.stderr, /Decisiones del proyecto/ && /✎/);
	assert.equal(fs.statSync(file).mtimeMs, t0);

	// Lo que descargó el visualizador en FIGMA_INBOX, más reciente, se incorpora
	const viewer = { ...names(bundle, "fila", "2026-10-27T11:00:00.000Z"), origin: "viewer" };
	write(path.join(inbox, "figspec-card.decisions.json"), viewer);
	const r3 = run("extractor.js", [], vars);
	assert.match(r3.stderr, /Decisiones descargadas: .*Downloads.*figspec-card\.decisions\.json/);
	assert.match(r3.stderr, /Decisiones del proyecto actualizadas/);
	assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")).layers.map((x) => x.name), ["fila"]);
	assert.equal(spec(path.join(dir, "out", "card")).component.structure.children[0].className, "fila");

	// El archivo del plugin, más viejo, ya no lo pisa
	const r4 = run("extractor.js", [], vars);
	assert.equal(spec(path.join(dir, "out", "card")).component.structure.children[0].className, "fila");
	assert.doesNotMatch(r4.stderr, /✎/);
});

test("FIGMA_DECISIONS carpeta: el archivo se encuentra por el id del componente aunque se llame distinto", () => {
	const dir = tmp();
	const bundle = cardNamed("Card", "Benefits");
	write(path.join(dir, "figspec-card.json"), bundle);
	const project = path.join(dir, "figspec");
	fs.mkdirSync(project);
	write(path.join(project, "tarjeta-vieja.decisions.json"), { ...names(bundle, "renombrada", "2026-10-27T10:00:00.000Z"), origin: "project" });
	const r = run("extractor.js", [path.join(dir, "figspec-card.json"), "--out-dir", path.join(dir, "out")], { FIGMA_DECISIONS: project });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /Decisiones del proyecto: .*tarjeta-vieja\.decisions\.json/);
	assert.equal(spec(path.join(dir, "out")).component.structure.children[0].className, "renombrada");
	assert.ok(!fs.existsSync(path.join(project, "card.decisions.json")));
});

test("--decisions en el comando solo se lee: no se modifica", () => {
	const dir = tmp();
	const bundle = cardNamed("Card", "Benefits");
	write(path.join(dir, "figspec-card.json"), bundle);
	write(path.join(dir, "figspec-card.names.json"), names(bundle, "delPlugin", "2026-10-27T12:00:00.000Z"));
	const dec = path.join(dir, "otra", "x.decisions.json");
	fs.mkdirSync(path.dirname(dec));
	write(dec, names(bundle, "viejo", "2026-10-27T09:00:00.000Z"));
	const before = fs.readFileSync(dec, "utf8");
	assert.equal(run("extractor.js", [path.join(dir, "figspec-card.json"), "--out-dir", path.join(dir, "out"), "--decisions", dec], {}).status, 0);
	assert.equal(fs.readFileSync(dec, "utf8"), before);
});

test("a igual fecha, las decisiones del proyecto ganan a un .names.json suelto (plugin)", () => {
	const dir = tmp();
	const bundle = cardNamed("Card", "Benefits");
	const at = "2026-10-27T10:00:00.000Z";
	write(path.join(dir, "figspec-card.json"), bundle);
	write(path.join(dir, "figspec-card.names.json"), names(bundle, "delPlugin", at));
	const project = path.join(dir, "decisions");
	fs.mkdirSync(project);
	write(path.join(project, "card.decisions.json"), { ...names(bundle, "delProyecto", at), origin: "viewer" });
	const r = run("extractor.js", [path.join(dir, "figspec-card.json"), "--out-dir", path.join(dir, "out")], { FIGMA_DECISIONS: project });
	assert.equal(r.status, 0, r.stderr);
	assert.equal(spec(path.join(dir, "out")).component.structure.children[0].className, "delProyecto");
});

test("viewer.js con FIGMA_OUT_DIR: el componente nombrado o la salida más reciente", () => {
	const dir = tmp();
	write(path.join(dir, "figspec-card.json"), card("A"), 20);
	write(path.join(dir, "figspec-login.json"), card("B"), 10);
	const base = path.join(dir, "out");
	run("extractor.js", ["card"], { FIGMA_FROM: dir, FIGMA_OUT_DIR: base });
	run("extractor.js", ["login"], { FIGMA_FROM: dir, FIGMA_OUT_DIR: base });
	assert.equal(run("viewer.js", ["card"], { FIGMA_OUT_DIR: base }).status, 0);
	assert.ok(fs.existsSync(path.join(base, "card", "viewer.html")));
	assert.ok(!fs.existsSync(path.join(base, "login", "viewer.html")));
	assert.equal(run("viewer.js", [], { FIGMA_OUT_DIR: base }).status, 0);
	assert.ok(fs.existsSync(path.join(base, "login", "viewer.html")), "sin nombre, la más reciente (login)");
});

test("los nombres de la sección decisions del paquete pasan al archivo del proyecto", () => {
	const dir = tmp();
	const bundle = cardNamed("Card", "Benefits");
	bundle.decisions = { ...names(bundle, "delPlugin", "2026-10-27T10:00:00.000Z"), savedAt: "2026-10-27T10:00:00.000Z" };
	write(path.join(dir, "figspec-card.json"), bundle);
	const project = path.join(dir, "decisions");
	const r = run("extractor.js", [], { FIGMA_FROM: dir, FIGMA_OUT_DIR: path.join(dir, "out"), FIGMA_DECISIONS: project });
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /nombres elegidos en el plugin/);
	assert.equal(spec(path.join(dir, "out", "card")).component.structure.children[0].className, "delPlugin");
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, "card.decisions.json"), "utf8")).layers.map((x) => [x.name, x.origin]), [["delPlugin", "plugin"]]);
});
