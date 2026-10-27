"use strict";
// npm run react: lleva el componente al proyecto (FIGMA_REACT_DIR o --to) con la salida al día,
// reemplaza solo lo que generó antes y avisa qué cambia en la API.
// Uso: node --test   (sin dependencias)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { apiSummary, apiChanges } = require("../react");

const ROOT = path.join(__dirname, "..");
const CLEAN = { ...process.env, FIGMA_FROM: "", FIGMA_DECISIONS: "", FIGMA_INBOX: "", FIGMA_NAME: "", FIGMA_OUT_DIR: "", FIGMA_REACT: "", FIGMA_REACT_DIR: "", FIGMA_VIEWER: "", FIGMA_EXTRACT_REPEATED: "", FIGMA_ASSETS: "", FIGMA_CSS: "" };

let seq = 0;
const T = (s) => ({ id: `${++seq}:1`, name: s, type: "TEXT", characters: s, style: { fontSize: 12 }, absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 } });
function bundle(name = "Card") {
	const frame = { id: `${++seq}:1`, name: "Frame 5", type: "FRAME", layoutMode: "HORIZONTAL", absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 20 }, children: [T("Benefits")] };
	const doc = { id: `${++seq}:1`, name, type: "FRAME", layoutMode: "VERTICAL", absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 }, children: [frame] };
	return { frame, data: { figspec: 2, name, nodeId: doc.id, exportedAt: "2026-01-01T00:00:00Z", icons: {}, images: {}, variables: {}, nodes: { [doc.id]: { document: doc } } } };
}
const run = (args, vars) => spawnSync(process.execPath, [path.join(ROOT, "react.js"), ...args], { env: { ...CLEAN, ...vars }, encoding: "utf8" });
function setup() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figspec-react-"));
	const b = bundle();
	fs.writeFileSync(path.join(dir, "figspec-card.json"), JSON.stringify(b.data));
	const vars = { FIGMA_FROM: dir, FIGMA_OUT_DIR: path.join(dir, "work"), FIGMA_DECISIONS: path.join(dir, "decisions"), FIGMA_REACT_DIR: path.join(dir, "src", "components") };
	return { dir, b, vars, dest: path.join(dir, "src", "components", "Card") };
}

test("react: entrega la carpeta del componente con su manifiesto; sin destino, avisa", () => {
	const { vars, dest } = setup();
	const r = run([], vars);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /Primera entrega de Card/);
	for (const f of ["Card.tsx", "Card.module.css", "index.ts", ".figspec-manifest.json"]) assert.ok(fs.existsSync(path.join(dest, f)), f);
	const m = JSON.parse(fs.readFileSync(path.join(dest, ".figspec-manifest.json"), "utf8"));
	assert.deepEqual(Object.keys(m.api), ["Card"]);
	assert.match(run([], { ...vars, FIGMA_REACT_DIR: "" }).stderr, /Falta el destino/);
});

test("react: con decisiones nuevas regenera, avisa los cambios y borra solo lo suyo que ya no va", () => {
	const { dir, b, vars, dest } = setup();
	assert.equal(run([], vars).status, 0);
	fs.writeFileSync(path.join(dest, "MiArchivo.ts"), "// mío\n");
	// Un nombre nuevo para "Frame 5" (como lo guardaría el visualizador)
	fs.mkdirSync(path.join(dir, "decisions"), { recursive: true });
	fs.writeFileSync(path.join(dir, "decisions", "card.decisions.json"), JSON.stringify({ figspec: "decisions", version: 2, component: { id: b.data.nodeId }, layers: [{ id: b.frame.id, name: "fila", at: "2099-01-01T00:00:00.000Z" }], states: [], groups: [] }));
	const dry = run(["--dry-run"], vars);
	assert.match(dry.stderr, /clases −\.benefitsRow \+\.fila/);
	assert.match(dry.stderr, /no se escribió nada en el destino/);
	assert.doesNotMatch(fs.readFileSync(path.join(dest, "Card.module.css"), "utf8"), /\.fila/);
	assert.equal(run([], vars).status, 0);
	assert.match(fs.readFileSync(path.join(dest, "Card.module.css"), "utf8"), /\.fila/);
	assert.ok(fs.existsSync(path.join(dest, "MiArchivo.ts")), "lo que no generó figspec no se toca");
});

test("react: no escribe en una carpeta existente que no generó figspec (salvo --force)", () => {
	const { vars, dest } = setup();
	fs.mkdirSync(dest, { recursive: true });
	fs.writeFileSync(path.join(dest, "index.ts"), "export const mio = 1;\n");
	const r = run([], vars);
	assert.equal(r.status, 1);
	assert.match(r.stderr, /no la generó figspec/);
	assert.equal(fs.readFileSync(path.join(dest, "index.ts"), "utf8"), "export const mio = 1;\n");
	assert.equal(run(["--force"], vars).status, 0);
});

test("react: si el componente se entregó antes con otro nombre, avisa de la carpeta vieja", () => {
	const { dir, b, vars } = setup();
	assert.equal(run([], vars).status, 0);
	fs.mkdirSync(path.join(dir, "decisions"), { recursive: true });
	fs.writeFileSync(path.join(dir, "decisions", "card.decisions.json"), JSON.stringify({ figspec: "decisions", version: 2, component: { id: b.data.nodeId }, root: { name: "Tarjeta", at: "2099-01-01T00:00:00.000Z" }, layers: [], states: [], groups: [] }));
	const r = run([], vars);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stderr, /se entregó antes como Card/);
	assert.ok(fs.existsSync(path.join(dir, "src", "components", "Tarjeta", "Tarjeta.tsx")));
});

test("apiChanges: qué rompe y qué no", () => {
	const before = { Card: { props: { state: "variant: A | B", title: "string" }, classes: ["root", "label"] }, Badge: { props: {}, classes: ["root"] } };
	const after = { Card: { props: { state: "variant: A", size: "variant: S | L" }, classes: ["root", "title"] }, Tag: { props: {}, classes: ["root"] } };
	const c = apiChanges(before, after);
	assert.deepEqual(c.breaking, ["Se quitó el componente Badge.", "Card: la prop state cambió (variant: A | B → variant: A).", "Card: se quitó la prop title."]);
	assert.deepEqual(c.info, ["Card: prop nueva size (variant: S | L).", "Card: clases −.label +.title (solo importa si tu CSS o tu código usan esas clases).", "Componente nuevo: Tag."]);
	assert.equal(apiChanges(null, after).first, true);
	assert.deepEqual(apiSummary({ component: { name: "X", props: { on: { type: "boolean" } }, styles: { root: {}, a: {} } } }), { X: { props: { on: "boolean" }, classes: ["a", "root"] } });
});
