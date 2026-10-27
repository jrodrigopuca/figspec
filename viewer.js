#!/usr/bin/env node
"use strict";
/**
 * figspec — visualizador: genera viewer.html a partir de una salida del extractor, para comparar
 * el componente con la vista previa de Figma y ver qué se generó. Un solo archivo autocontenido
 * (especificación, CSS, íconos, imágenes y vista previa embebidos): se abre con doble clic y se
 * puede pasar a otra persona sin la carpeta.
 *
 * Uso:
 *   node viewer.js <carpeta de salida>        → <carpeta>/viewer.html
 *   node extractor.js figspec-x.json --viewer → lo mismo, al terminar la extracción
 *
 * El navegador reproduce el componente con los mismos .module.css (clases con el nombre del
 * componente como prefijo, para que no choquen los .root) y la misma interpretación de
 * component.json que react.js (spec.js). No ejecuta React.
 */

const fs = require("fs");
const path = require("path");

// Versión de component.json que entiende el visualizador (meta.format)
const FORMAT = 1;
const MANIFEST = ".figspec-manifest.json";
const MIME = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

// write(nombre, contenido) escribe relativo a outDir (el extractor lo registra en su manifiesto)
function generateViewer(outDir, write) {
	write("viewer.html", viewerHtml(outDir));
}

function viewerHtml(outDir) {
	const file = path.join(outDir, "component.json");
	let spec;
	try {
		spec = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch (e) {
		throw new Error(`No se pudo leer ${file}: ${e.message}`);
	}
	const format = spec.meta && spec.meta.format;
	if (format !== FORMAT)
		throw new Error(
			`${file} tiene el formato ${format === undefined ? "anterior a meta.format" : format}; el visualizador entiende el ${FORMAT}. Vuelve a generar la salida con el extractor.`,
		);

	const part = spec.component.name;
	const comps = [spec.component, ...Object.values(spec.subcomponents || {})];
	const refs = new Set();
	const css = {};
	for (const comp of comps) {
		const rel = `${part}/${comp.name}.module.css`;
		const text = readText(outDir, rel);
		if (text !== null) css[comp.name] = rewriteUrls(text, part, refs);
	}
	collectAssetPaths(spec, part, refs);

	const assets = {};
	const missing = [];
	for (const rel of [...refs].sort()) {
		const a = readAsset(outDir, rel);
		if (a) assets[rel] = a;
		else missing.push(rel);
	}
	const preview = spec.meta.preview ? readAsset(outDir, spec.meta.preview.file) : null;
	const data = {
		spec,
		css,
		tokens: readText(outDir, "tokens.css"),
		assets,
		missing,
		preview: preview && preview.url,
	};

	const title = `${spec.component.name} · figspec`;
	return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${fs.readFileSync(path.join(__dirname, "viewer.css"), "utf8")}</style>
</head>
<body>
<div id="app" aria-busy="true"><noscript>El visualizador necesita JavaScript.</noscript></div>
<script type="application/json" id="figspec-data">${safeJson(data)}</script>
<script>
${inlineModule("figspecSpec", "spec.js")}
${inlineModule("figspecViewer", "viewer-client.js")}
figspecViewer.boot(document, JSON.parse(document.getElementById("figspec-data").textContent));
</script>
</body>
</html>
`;
}

// ---------------------------------------------------------------- assets
// Referencias a assets dentro de component.json (íconos, imágenes): cualquier texto con la
// ruta de la subcarpeta del componente. Así no depende de qué campos las traen.
function collectAssetPaths(spec, part, refs) {
	const prefix = `${part}/assets/`;
	(function walk(v) {
		if (typeof v === "string") {
			if (v.startsWith(prefix)) refs.add(v);
		} else if (Array.isArray(v)) v.forEach(walk);
		else if (v && typeof v === "object") Object.values(v).forEach(walk);
	})(spec);
}

// url(...) del CSS (fondos de imagen) → url("asset:<ruta desde la salida>"); el navegador la
// reemplaza por el archivo embebido. Las rutas del .module.css son relativas a la subcarpeta.
function rewriteUrls(css, part, refs) {
	return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, q, url) => {
		if (/^(data:|https?:|#)/.test(url)) return m;
		const rel = path.posix.normalize(path.posix.join(part, url));
		refs.add(rel);
		return `url("asset:${rel}")`;
	});
}

function readText(outDir, rel) {
	try {
		return fs.readFileSync(path.join(outDir, rel), "utf8");
	} catch {
		return null;
	}
}

// Los SVG van como texto (se insertan en línea para que funcione currentColor); el resto, en base64
function readAsset(outDir, rel) {
	let buf;
	try {
		buf = fs.readFileSync(path.join(outDir, rel));
	} catch {
		return null;
	}
	const ext = path.extname(rel).toLowerCase();
	if (ext === ".svg") return { svg: buf.toString("utf8"), url: `data:image/svg+xml;base64,${buf.toString("base64")}` };
	return { url: `data:${MIME[ext] || "application/octet-stream"};base64,${buf.toString("base64")}` };
}

// ---------------------------------------------------------------- HTML
// JSON dentro de <script>: sin "<" literal no puede cerrar la etiqueta
function safeJson(v) {
	return JSON.stringify(v).replace(/[<\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

// Un archivo CommonJS como variable global del navegador (module.exports → window[name])
function inlineModule(name, file) {
	const src = fs.readFileSync(path.join(__dirname, file), "utf8").replace(/<\/script/gi, "<\\/script");
	return `var ${name} = (function (module) {\n${src}\nreturn module.exports;\n})({ exports: {} });`;
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// ---------------------------------------------------------------- CLI
// Sin el extractor: escribe viewer.html y lo suma al manifiesto, si existe, para que la próxima
// extracción lo reemplace o lo borre como al resto de la salida.
function cli(argv) {
	const outDir = argv.find((a) => !a.startsWith("--"));
	if (!outDir || argv.includes("--help")) {
		console.log("Uso: node viewer.js <carpeta de salida del extractor>\nEscribe <carpeta>/viewer.html (autocontenido).");
		return outDir ? 0 : 1;
	}
	try {
		generateViewer(outDir, (name, content) => fs.writeFileSync(path.join(outDir, name), content));
	} catch (e) {
		console.error("✖ " + e.message);
		return 1;
	}
	const manifest = path.join(outDir, MANIFEST);
	try {
		const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
		if (!m.files.includes("viewer.html")) {
			m.files = [...m.files, "viewer.html"].sort();
			fs.writeFileSync(manifest, JSON.stringify(m, null, 2) + "\n");
		}
	} catch {
		// sin manifiesto: la carpeta no la generó el extractor (o es anterior), no se toca
	}
	const kb = Math.round(fs.statSync(path.join(outDir, "viewer.html")).size / 1024);
	console.error(`✔ ${path.join(outDir, "viewer.html")} (${kb} KB)`);
	return 0;
}

if (require.main === module) process.exitCode = cli(process.argv.slice(2));

module.exports = { generateViewer, viewerHtml, rewriteUrls, FORMAT };
