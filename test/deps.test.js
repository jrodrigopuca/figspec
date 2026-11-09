"use strict";
// Invariante 2 (ADR 0021): las dependencias se importan solo en bin/. src/ y plugin/ usan módulos
// de Node o archivos propios (./), y package.json declara las dos del CLI y nada más.
// Uso: node --test   (sin dependencias)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isBuiltin } = require("node:module");

const ROOT = path.join(__dirname, "..");

// Cada require( del código: se acepta un módulo de Node, un archivo propio ("./x") o
// path.join(__dirname, "x"). Cualquier otra forma se informa: si es legítima, se agrega aquí.
function foreign(code) {
	const bad = [];
	for (const m of code.matchAll(/\brequire\s*\(((?:[^()]|\([^()]*\))*)\)/g)) {
		const arg = m[1].trim();
		const lit = arg.match(/^(["'`])([^"'`]+)\1$/);
		if (lit && (isBuiltin(lit[2]) || lit[2].startsWith("./"))) continue;
		if (/^path\.join\(__dirname, "[\w.-]+"\)$/.test(arg)) continue;
		bad.push(m[0]);
	}
	// import estático al inicio de una línea o import() dinámico (los "import …" que react.js
	// escribe dentro de cadenas no empiezan la línea)
	for (const m of code.matchAll(/^[ \t]*import\s[^\n]*|\bimport\s*\([^)]*\)/gm)) bad.push(m[0].trim());
	return bad;
}

test("dependencias: el detector reconoce lo propio y señala lo ajeno", () => {
	const ok = 'const fs = require("fs");\nconst c = require("node:crypto");\nconst p = require("./paths");\nrequire(path.join(__dirname, "react.js"));\nout.push(`import x from "react";`);\n';
	assert.deepEqual(foreign(ok), []);
	assert.deepEqual(foreign('const z = require("zod");'), ['require("zod")']);
	assert.deepEqual(foreign('const r = require("@runa-cmd/core");'), ['require("@runa-cmd/core")']);
	assert.deepEqual(foreign('const a = require("../bin/x");'), ['require("../bin/x")']);
	assert.deepEqual(foreign("const m = require(nombre);"), ["require(nombre)"]);
	assert.deepEqual(foreign('import { z } from "zod";'), ['import { z } from "zod";']);
	assert.deepEqual(foreign('const m = await import("zod");'), ['import("zod")']);
});

test("dependencias: src/ y plugin/ solo usan módulos de Node y archivos propios", () => {
	const files = [
		...fs.readdirSync(path.join(ROOT, "src")).filter((f) => f.endsWith(".js")).map((f) => path.join("src", f)),
		path.join("plugin", "code.js"),
		path.join("plugin", "ui.html"),
	];
	assert.ok(files.length >= 8, "se revisan los módulos de src/ y el plugin");
	for (const f of files) assert.deepEqual(foreign(fs.readFileSync(path.join(ROOT, f), "utf8")), [], f);
});

test("dependencias: package.json declara las dos del CLI y nada más", () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
	assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["@runa-cmd/core", "zod"]);
	assert.deepEqual(Object.keys(pkg.devDependencies || {}), []);
});
