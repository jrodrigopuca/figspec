#!/usr/bin/env node
"use strict";
/**
 * figspec — servidor local del visualizador (npm start). Genera la salida con el extractor, sirve
 * viewer.html en http://127.0.0.1 y recibe "Guardar nombres": aplica los nombres sin descargar
 * archivos (vuelve a correr el extractor, que los combina en las decisiones del proyecto) y la
 * página se recarga ya regenerada.
 *
 * Uso: node serve.js [componente | paquete] [opciones del extractor] [--port N] [--no-open]
 *
 * Solo escucha en 127.0.0.1 y exige una clave que va en la página: otra web abierta en el
 * navegador no puede escribirle. El viewer.html suelto (doble clic) sigue descargando.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { loadDefaultEnv, openFile } = require("./env");

const EXTRACTOR = path.join(__dirname, "extractor.js");
const MAX_BODY = 5 * 1024 * 1024;

function main(argv) {
	loadDefaultEnv();
	let port = Number(process.env.FIGMA_PORT) || 4870;
	let open = true;
	const args = [];
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--port") port = Number(argv[++i]);
		else if (argv[i] === "--no-open") open = false;
		else if (argv[i] !== "--open" && argv[i] !== "--viewer") args.push(argv[i]);
	}

	// Corre el extractor (con el visualizador) y devuelve dónde quedó todo, o null si falló
	function extract(extra = []) {
		const report = path.join(os.tmpdir(), `figspec-report-${process.pid}-${Date.now()}.json`);
		const r = spawnSync(process.execPath, [EXTRACTOR, ...args, "--viewer", "--report", report, ...extra], { encoding: "utf8", env: process.env });
		process.stderr.write(r.stderr || "");
		let info = null;
		try {
			info = JSON.parse(fs.readFileSync(report, "utf8"));
			fs.rmSync(report, { force: true });
		} catch {
			// el extractor falló antes de escribir el reporte
		}
		return r.status === 0 && info ? { ...info, log: r.stderr || "" } : { error: (r.stderr || "").trim() || "El extractor falló." };
	}

	let state = extract();
	if (state.error) {
		process.exitCode = 1;
		return;
	}
	const token = crypto.randomBytes(16).toString("hex");

	// Guarda los nombres: con decisiones del proyecto (FIGMA_DECISIONS) el extractor los combina
	// ahí; si no, quedan junto al paquete, donde los buscaría de todos modos
	function save(doc) {
		const base = path.join(path.dirname(state.bundle), path.basename(state.bundle).replace(/ ?\(\d+\)(?=\.json$)/i, "").replace(/\.json$/i, ""));
		if (state.projectDecisions) {
			const tmp = path.join(os.tmpdir(), `figspec-guardar-${process.pid}-${Date.now()}.decisions.json`);
			fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
			const next = extract(["--decisions", tmp]);
			fs.rmSync(tmp, { force: true });
			return next;
		}
		fs.writeFileSync(`${base}.decisions.json`, JSON.stringify(doc, null, 2) + "\n");
		return extract();
	}

	const server = http.createServer((req, res) => {
		const url = new URL(req.url, `http://${req.headers.host}`);
		const send = (code, type, body) => {
			res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
			res.end(body);
		};
		// Solo pedidos a 127.0.0.1/localhost (evita que una web lo use cambiando el DNS)
		if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || "")) return send(403, "text/plain", "Prohibido");
		if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/viewer.html")) {
			let html;
			try {
				html = fs.readFileSync(path.join(state.outDir, "viewer.html"), "utf8");
			} catch {
				return send(500, "text/plain", "No se encontró viewer.html");
			}
			// La página sabe que hay servidor (y su clave): "Guardar nombres" guarda aquí
			const inject = `<script>window.figspecServer = ${JSON.stringify({ token })};</script>`;
			return send(200, "text/html; charset=utf-8", html.replace("<head>", `<head>\n${inject}`));
		}
		if (req.method === "POST" && url.pathname === "/api/decisions") {
			if (req.headers["x-figspec-token"] !== token) return send(403, "application/json", JSON.stringify({ error: "Clave incorrecta." }));
			let size = 0;
			const chunks = [];
			req.on("data", (c) => {
				size += c.length;
				if (size > MAX_BODY) req.destroy();
				else chunks.push(c);
			});
			req.on("end", () => {
				let doc;
				try {
					doc = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				} catch {
					return send(400, "application/json", JSON.stringify({ error: "JSON inválido." }));
				}
				if (!doc || doc.figspec !== "decisions") return send(400, "application/json", JSON.stringify({ error: "No es un archivo de decisiones." }));
				const next = save(doc);
				if (next.error) return send(500, "application/json", JSON.stringify({ error: next.error }));
				state = next;
				send(200, "application/json", JSON.stringify({ ok: true, projectDecisions: state.projectDecisions, log: next.log }));
			});
			return;
		}
		send(404, "text/plain", "No encontrado");
	});

	// Si el puerto está ocupado, el siguiente (hasta 20 intentos)
	let tries = 0;
	server.on("error", (e) => {
		if (e.code === "EADDRINUSE" && tries++ < 20 && port !== 0) server.listen(++port, "127.0.0.1");
		else {
			console.error(`✖ No se pudo abrir el servidor: ${e.message}`);
			process.exitCode = 1;
		}
	});
	server.on("listening", () => {
		const url = `http://127.0.0.1:${server.address().port}/`;
		console.error(`\n✔ Visualizador en ${url} (Ctrl+C para cerrar)`);
		console.error(`  "Guardar nombres" los aplica sin descargar${state.projectDecisions ? ` y los guarda en ${state.projectDecisions}` : ""}.`);
		if (open) openFile(url);
	});
	server.listen(port, "127.0.0.1");
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { main };
