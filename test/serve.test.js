"use strict";
// Servidor local del visualizador (serve.js, npm start): sirve viewer.html con su clave y "Guardar
// nombres" aplica los nombres (decisiones del proyecto o junto al paquete) y regenera la salida.
// Uso: node --test   (sin dependencias)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const CLEAN = { ...process.env, FIGMA_FROM: "", FIGMA_DECISIONS: "", FIGMA_INBOX: "", FIGMA_NAME: "", FIGMA_OUT_DIR: "", FIGMA_REACT: "", FIGMA_VIEWER: "", FIGMA_EXTRACT_REPEATED: "", FIGMA_ASSETS: "", FIGMA_CSS: "", FIGMA_PORT: "" };

let seq = 0;
const T = (s) => ({ id: `${++seq}:1`, name: s, type: "TEXT", characters: s, style: { fontSize: 12 }, absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 20 } });
function bundle() {
	const frame = { id: `${++seq}:1`, name: "Frame 5", type: "FRAME", layoutMode: "HORIZONTAL", absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 20 }, children: [T("Benefits")] };
	const doc = { id: `${++seq}:1`, name: "Card", type: "FRAME", layoutMode: "VERTICAL", absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 }, children: [frame] };
	return { frame, data: { figspec: 2, name: "Card", nodeId: doc.id, exportedAt: "2026-01-01T00:00:00Z", icons: {}, images: {}, variables: {}, nodes: { [doc.id]: { document: doc } } } };
}

// Arranca serve.js y espera la URL; devuelve { url, stop, log }
function start(args, vars) {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, [path.join(ROOT, "serve.js"), ...args, "--port", "0", "--no-open"], { env: { ...CLEAN, ...vars } });
		let log = "";
		const timer = setTimeout(() => reject(new Error(`serve.js no arrancó:\n${log}`)), 15000);
		child.stderr.on("data", (d) => {
			log += d;
			const m = log.match(/Visualizador en (http:\/\/127\.0\.0\.1:\d+\/)/);
			if (m) {
				clearTimeout(timer);
				resolve({ url: m[1], stop: () => child.kill(), log: () => log });
			}
		});
		child.on("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`serve.js terminó (${code}):\n${log}`));
		});
	});
}

const decisions = (b, name) => ({
	figspec: "decisions", version: 2, origin: "viewer", savedAt: "2026-10-27T12:00:00.000Z",
	component: { id: b.data.nodeId }, layers: [{ id: b.frame.id, figma: "Frame 5", path: [["Frame 5", 0]], name, at: "2026-10-27T12:00:00.000Z", origin: "viewer" }], states: [], groups: [],
});
const post = (url, body, token) => fetch(`${url}api/decisions`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "X-Figspec-Token": token } : {}) }, body: JSON.stringify(body) });
const className = (out) => JSON.parse(fs.readFileSync(path.join(out, "component.json"), "utf8")).component.structure.children[0].className;

test("servidor: sirve el visualizador con su clave y \"Guardar nombres\" actualiza las decisiones del proyecto", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figspec-serve-"));
	const b = bundle();
	fs.writeFileSync(path.join(dir, "figspec-card.json"), JSON.stringify(b.data));
	const vars = { FIGMA_FROM: dir, FIGMA_OUT_DIR: path.join(dir, "out"), FIGMA_DECISIONS: path.join(dir, "decisions") };
	const s = await start([], vars);
	try {
		const html = await (await fetch(s.url)).text();
		const token = html.match(/window\.figspecServer = \{"token":"([0-9a-f]+)"\}/)[1];
		assert.match(html, /figspec-data/);

		const denied = await post(s.url, decisions(b, "fila"), "otra");
		assert.equal(denied.status, 403, "sin la clave no escribe");
		assert.ok(!fs.existsSync(path.join(dir, "decisions", "card.decisions.json")));

		const res = await post(s.url, decisions(b, "fila"), token);
		assert.equal(res.status, 200, await res.clone().text());
		const project = JSON.parse(fs.readFileSync(path.join(dir, "decisions", "card.decisions.json"), "utf8"));
		assert.deepEqual(project.layers.map((x) => x.name), ["fila"]);
		assert.equal(className(path.join(dir, "out", "card")), "fila", "la salida se regeneró");
		assert.match(await (await fetch(s.url)).text(), /fila/, "el visualizador servido es el nuevo");
	} finally {
		s.stop();
	}
});

test("servidor: sin decisiones del proyecto, los nombres quedan junto al paquete", async () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figspec-serve-"));
	const b = bundle();
	fs.writeFileSync(path.join(dir, "figspec-card.json"), JSON.stringify(b.data));
	const out = path.join(dir, "out");
	const s = await start([path.join(dir, "figspec-card.json"), "--out-dir", out], {});
	try {
		const token = (await (await fetch(s.url)).text()).match(/"token":"([0-9a-f]+)"/)[1];
		assert.equal((await post(s.url, decisions(b, "fila"), token)).status, 200);
		assert.ok(fs.existsSync(path.join(dir, "figspec-card.decisions.json")));
		assert.equal(className(out), "fila");
		assert.equal((await post(s.url, { nada: 1 }, token)).status, 400, "un cuerpo que no es de decisiones se rechaza");
	} finally {
		s.stop();
	}
});
