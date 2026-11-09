"use strict";
/**
 * bin/figspec.js: la entrada única. Los subcomandos se prueban en sus propios archivos; aquí, que
 * el despacho y los parámetros cortos (-s, -d, -t, -o) lleguen bien.
 * Correr con: node --test test/
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const BIN = path.join(__dirname, "..", "bin", "figspec.js");
// Sin variables del .env del proyecto: todo llega por parámetros
const CLEAN = { ...process.env, FIGMA_FROM: "", FIGMA_DECISIONS: "", FIGMA_INBOX: "", FIGMA_NAME: "", FIGMA_OUT_DIR: "", FIGMA_REACT: "", FIGMA_REACT_DIR: "", FIGMA_VIEWER: "", FIGMA_EXTRACT_REPEATED: "", FIGMA_ASSETS: "", FIGMA_CSS: "" };
const run = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { env: CLEAN, cwd, encoding: "utf8" });

function setup() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figspec-cli-"));
	const text = { id: "1:1", name: "Benefits", type: "TEXT", characters: "Benefits", style: { fontSize: 12 }, absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 } };
	const frame = { id: "2:1", name: "Frame 5", type: "FRAME", layoutMode: "HORIZONTAL", absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 20 }, children: [text] };
	const doc = { id: "3:1", name: "Card", type: "FRAME", layoutMode: "VERTICAL", absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 }, children: [frame] };
	// Nombres que no siguen ninguna convención: el CLI no adivina nada por el nombre del archivo
	fs.writeFileSync(path.join(dir, "paquete.json"), JSON.stringify({ figspec: 2, name: "Card", nodeId: doc.id, exportedAt: "2026-01-01T00:00:00Z", icons: {}, images: {}, variables: {}, nodes: { [doc.id]: { document: doc } } }));
	fs.writeFileSync(path.join(dir, "nombres.json"), JSON.stringify({ figspec: "decisions", version: 2, component: { id: doc.id }, layers: [{ id: frame.id, name: "fila", at: "2099-01-01T00:00:00.000Z" }], states: [], groups: [] }));
	return dir;
}

test("figspec react -s -d -t: entrega con los nombres del archivo de decisiones y no deja nada en la carpeta actual", () => {
	const dir = setup();
	const r = run(["react", "-s", "paquete.json", "-d", "nombres.json", "-t", "comps"], dir);
	assert.equal(r.status, 0, r.stderr);
	assert.match(fs.readFileSync(path.join(dir, "comps", "Card", "Card.module.css"), "utf8"), /\.fila/);
	assert.deepEqual(fs.readdirSync(dir).sort(), ["comps", "nombres.json", "paquete.json"]);
});

test("figspec build -s -o: genera la salida en la carpeta indicada", () => {
	const dir = setup();
	const r = run(["build", "-s", "paquete.json", "-o", "salida"], dir);
	assert.equal(r.status, 0, r.stderr);
	assert.ok(fs.existsSync(path.join(dir, "salida", "component.json")));
});

test("figspec: un parámetro sin valor, una opción o un comando desconocidos fallan con un mensaje", () => {
	const dir = setup();
	const noValue = run(["build", "-s"], dir);
	assert.equal(noValue.status, 1);
	assert.match(noValue.stderr, /Falta el valor de -s/);
	const badFlag = run(["build", "-s", "paquete.json", "-x"], dir);
	assert.equal(badFlag.status, 1);
	assert.match(badFlag.stderr, /Opción desconocida: -x/);
	const badCmd = run(["nada"], dir);
	assert.equal(badCmd.status, 1);
	assert.match(badCmd.stderr, /Comando desconocido: nada/);
	assert.equal(run(["--help"], dir).status, 0);
});
