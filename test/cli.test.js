"use strict";
/**
 * bin/figspec.mjs: el comando público. Los módulos se prueban en sus propios archivos; aquí, que
 * cada comando traduzca bien sus parámetros (-s, -d, -t, -o) y que los errores de uso corten.
 * Correr con: node --test test/
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const BIN = path.join(__dirname, "..", "bin", "figspec.mjs");
const run = (args, cwd) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8" });

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
	// --dry-run no escribe en el destino
	fs.rmSync(path.join(dir, "comps"), { recursive: true });
	const dry = run(["react", "-s", "paquete.json", "-t", "comps", "--dry-run"], dir);
	assert.equal(dry.status, 0, dry.stderr);
	assert.ok(!fs.existsSync(path.join(dir, "comps")));
});

test("figspec build -s -o: genera solo lo pedido en la carpeta indicada", () => {
	const dir = setup();
	const ok = run(["build", "-s", "paquete.json", "-o", "salida", "--react"], dir);
	assert.equal(ok.status, 0, ok.stderr);
	assert.ok(fs.existsSync(path.join(dir, "salida", "component.json")));
	assert.ok(fs.existsSync(path.join(dir, "salida", "Card", "Card.tsx")));
	assert.ok(!fs.existsSync(path.join(dir, "salida", "viewer.html")));
	const bare = run(["build", "-s", "paquete.json", "-o", "solo", "--no-css"], dir);
	assert.equal(bare.status, 0, bare.stderr);
	assert.ok(!fs.existsSync(path.join(dir, "solo", "Card", "Card.module.css")));
});

test("figspec: errores de uso (falta -s, opción o comando desconocidos) y de generación cortan con mensaje", () => {
	const dir = setup();
	const noSpec = run(["build"], dir);
	assert.equal(noSpec.status, 2);
	assert.match(noSpec.stderr, /--spec/);
	const noTo = run(["react", "-s", "paquete.json"], dir);
	assert.equal(noTo.status, 2);
	assert.match(noTo.stderr, /--to/);
	const badFlag = run(["build", "-s", "paquete.json", "--raro"], dir);
	assert.equal(badFlag.status, 2);
	assert.match(badFlag.stderr, /--raro/);
	assert.equal(run(["nada"], dir).status, 127);
	const missing = run(["build", "-s", "no-existe.json"], dir);
	assert.equal(missing.status, 1);
	assert.match(missing.stderr, /No se pudo leer no-existe\.json/);
	assert.equal(run(["--help"], dir).status, 0);
});

test("figspec view: sirve el visualizador y Ctrl+C lo cierra", async () => {
	const dir = setup();
	const child = spawn(process.execPath, [BIN, "view", "-s", "paquete.json", "-d", "nombres.json", "--port", "0", "--no-open"], { cwd: dir });
	let log = "";
	const url = await new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`figspec view no arrancó:\n${log}`)), 15000);
		child.stderr.on("data", (d) => {
			log += d;
			const m = log.match(/Visualizador en (http:\/\/127\.0\.0\.1:\d+\/)/);
			if (m) (clearTimeout(timer), resolve(m[1]));
		});
		child.on("exit", (code) => (clearTimeout(timer), reject(new Error(`figspec view terminó (${code}):\n${log}`))));
	});
	const closed = new Promise((resolve) => child.on("close", (code, signal) => resolve(signal || code)));
	try {
		assert.match(await (await fetch(url)).text(), /fila/);
	} finally {
		child.kill("SIGINT");
	}
	assert.equal(await closed, "SIGINT");
});
