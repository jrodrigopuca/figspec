"use strict";
// Visualizador: viewer.html autocontenido (viewer.js) y las funciones sin DOM del navegador
// (viewer-client.js): prefijado del CSS, assets embebidos, formato y zoom.
// Uso: node --test   (sin dependencias)

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const client = require("../viewer-client");

const ROOT = path.join(__dirname, "..");
const ENV = { ...process.env, FIGMA_FROM: "", FIGMA_NAME: "", FIGMA_OUT_DIR: "", FIGMA_REACT: "", FIGMA_VIEWER: "", FIGMA_EXTRACT_REPEATED: "", FIGMA_ASSETS: "", FIGMA_CSS: "" };

let seq = 0;
const box = (w, h, x = 0, y = 0) => ({ x, y, width: w, height: h });
const T = (s) => ({ id: `${++seq}:1`, name: s, type: "TEXT", characters: s, style: { fontSize: 12 }, absoluteBoundingBox: box(50, 20) });
const imageFill = (ref) => [{ type: "IMAGE", imageRef: ref, scaleMode: "FILL" }];

// PNG mínimo: firma y encabezado IHDR (el extractor solo lee el tamaño)
function fakePng(w, h) {
	const b = Buffer.alloc(24);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
	b.writeUInt32BE(13, 8);
	b.write("IHDR", 12, "ascii");
	b.writeUInt32BE(w, 16);
	b.writeUInt32BE(h, 20);
	return b.toString("base64");
}

// Tarjeta con una imagen (<img>), un fondo de imagen (url() en el CSS), un ícono y un texto que
// intenta cerrar el <script> de los datos
function bundle() {
	const icon = { id: `${++seq}:1`, name: "icon", type: "VECTOR", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }], absoluteBoundingBox: box(16, 16) };
	const doc = {
		id: `${++seq}:1`, name: "Card", type: "FRAME", layoutMode: "VERTICAL", absoluteBoundingBox: box(200, 100),
		children: [
			{ id: `${++seq}:1`, name: "Photo", type: "RECTANGLE", fills: imageFill("aaa"), absoluteBoundingBox: box(200, 60) },
			{ id: `${++seq}:1`, name: "Banner", type: "FRAME", layoutMode: "HORIZONTAL", fills: imageFill("bbb"), absoluteBoundingBox: box(200, 40), children: [T("Hola")] },
			icon,
			T("</script><b>x</b>"),
		],
	};
	return {
		figspec: 2, name: "Card", nodeId: doc.id, exportedAt: "2026-01-01T00:00:00Z",
		icons: { [icon.id]: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M0 0h16v16H0z" fill="#000"/></svg>' },
		images: { aaa: fakePng(4, 4), bbb: fakePng(8, 8) },
		variables: {},
		preview: fakePng(200, 100),
		nodes: { [doc.id]: { document: doc } },
	};
}

function extract(args = [], input = bundle()) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figspec-viewer-"));
	const file = path.join(dir, "in.json");
	fs.writeFileSync(file, JSON.stringify(input));
	const out = path.join(dir, "out");
	const r = spawnSync("node", [path.join(ROOT, "extractor.js"), file, "--out-dir", out, ...args], { env: ENV, encoding: "utf8" });
	return { out, status: r.status, stderr: r.stderr };
}

const manifest = (out) => JSON.parse(fs.readFileSync(path.join(out, ".figspec-manifest.json"), "utf8")).files;

// Datos embebidos tal como los lee el navegador
function embedded(html) {
	const m = html.match(/<script type="application\/json" id="figspec-data">([\s\S]*?)<\/script>/);
	assert.ok(m, "no está el bloque de datos");
	return JSON.parse(m[1]);
}

// ---------------------------------------------------------------- viewer.html
test("--viewer escribe viewer.html, lo registra en el manifiesto y embebe todo", () => {
	const { out, status } = extract(["--viewer"]);
	assert.equal(status, 0);
	assert.ok(manifest(out).includes("viewer.html"));
	const html = fs.readFileSync(path.join(out, "viewer.html"), "utf8");
	const data = embedded(html);
	assert.equal(data.spec.meta.format, 1);
	assert.match(data.preview, /^data:image\/png;base64,/);
	assert.deepEqual(data.missing, []);
	const files = Object.keys(data.assets).sort();
	assert.equal(files.length, 3, files.join(", "));
	const svg = files.find((f) => f.endsWith(".svg"));
	assert.match(data.assets[svg].svg, /^<svg/, "los íconos van como texto para insertarlos en línea");
	// El fondo de imagen apunta a un archivo embebido
	const ref = data.css.Card.match(/url\("asset:([^"]+)"\)/);
	assert.ok(ref && data.assets[ref[1]], "url() del CSS sin archivo embebido");
	// El texto del diseño con </script> no corta los datos
	assert.ok(JSON.stringify(data.spec).includes("</script><b>x</b>"));
});

test("viewer.html no depende de archivos ni de la red", () => {
	const { out } = extract(["--viewer"]);
	const html = fs.readFileSync(path.join(out, "viewer.html"), "utf8");
	const scripts = html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, "");
	assert.doesNotMatch(scripts, /<(script|link|img)[^>]+(src|href)=/i);
	assert.doesNotMatch(scripts, /https?:\/\/(?!www\.w3\.org)/);
	// Funciona movido a otra carpeta: no hay rutas relativas a la salida
	const moved = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "figspec-moved-")), "viewer.html");
	fs.copyFileSync(path.join(out, "viewer.html"), moved);
	assert.equal(Object.keys(embedded(fs.readFileSync(moved, "utf8")).assets).length, 3);
});

test("sin --viewer no hay viewer.html; --viewer con --no-css falla", () => {
	assert.equal(fs.existsSync(path.join(extract().out, "viewer.html")), false);
	const r = extract(["--viewer", "--no-css"]);
	assert.equal(r.status, 1);
	assert.match(r.stderr, /--viewer usa los CSS Modules/);
});

test("node viewer.js <salida>: lo suma al manifiesto y la próxima extracción lo reemplaza", () => {
	const input = bundle();
	const { out } = extract([], input);
	execFileSync("node", [path.join(ROOT, "viewer.js"), out], { stdio: "pipe" });
	assert.ok(fs.existsSync(path.join(out, "viewer.html")));
	assert.ok(manifest(out).includes("viewer.html"));
	// Otra extracción sin --viewer limpia lo que generó antes, viewer.html incluido
	const file = path.join(path.dirname(out), "in.json");
	execFileSync("node", [path.join(ROOT, "extractor.js"), file, "--out-dir", out], { env: ENV, stdio: "pipe" });
	assert.equal(fs.existsSync(path.join(out, "viewer.html")), false);
});

test("node viewer.js rechaza un component.json de otro formato", () => {
	const { out } = extract();
	const file = path.join(out, "component.json");
	const spec = JSON.parse(fs.readFileSync(file, "utf8"));
	spec.meta.format = 99;
	fs.writeFileSync(file, JSON.stringify(spec));
	const r = spawnSync("node", [path.join(ROOT, "viewer.js"), out], { encoding: "utf8" });
	assert.equal(r.status, 1);
	assert.match(r.stderr, /formato 99.*Vuelve a generar/);
	assert.equal(fs.existsSync(path.join(out, "viewer.html")), false);
});

test("archivos que faltan en la salida se listan en missing", () => {
	const { out } = extract();
	const spec = JSON.parse(fs.readFileSync(path.join(out, "component.json"), "utf8"));
	const img = fs.readdirSync(path.join(out, "Card/assets/images"))[0];
	fs.rmSync(path.join(out, "Card/assets/images", img));
	const { viewerHtml } = require("../viewer");
	const data = embedded(viewerHtml(out));
	assert.deepEqual(data.missing, [`Card/assets/images/${img}`]);
	assert.equal(spec.component.name, "Card");
});

// ---------------------------------------------------------------- CSS en el Shadow DOM
test("prefixCss prefija las clases de los selectores y nada más", () => {
	const css = [
		"/* .comentario { } */",
		".root { opacity: 0.5; background: url(\"asset:Card/assets/images/a.png\") center / cover; }",
		'.root:where([data-size="1.5x.big"]) .label { color: red; }',
		".root .inst, .root > .icon2 { width: 10.5px; }",
		"@media (min-width: 10px) { .label { margin: 0; } }",
		'@font-face { font-family: "X.Y"; src: url(x.woff); }',
	].join("\n");
	const out = client.prefixCss(css, "Card");
	assert.match(out, /^\/\* \.comentario \{ \} \*\//);
	assert.match(out, /\.Card__root \{ opacity: 0\.5; background: url\("asset:Card\/assets\/images\/a\.png"\)/);
	assert.match(out, /\.Card__root:where\(\[data-size="1\.5x\.big"\]\) \.Card__label \{/);
	assert.match(out, /\.Card__root \.Card__inst, \.Card__root > \.Card__icon2 \{ width: 10\.5px; \}/);
	assert.match(out, /@media \(min-width: 10px\) \{ \.Card__label \{ margin: 0; \} \}/);
	assert.match(out, /@font-face \{ font-family: "X\.Y"; src: url\(x\.woff\); \}/);
});

test("tokens en :host; assets embebidos o none si faltan", () => {
	assert.equal(client.hostTokens(":root {\n  --a: 1px;\n}"), ":host {\n  --a: 1px;\n}");
	assert.equal(client.hostTokens(null), "");
	const css = 'a { background: url("asset:x.png"); } b { background: url("asset:y.png"); }';
	assert.equal(client.resolveAssets(css, { "x.png": { url: "data:image/png;base64,AA" } }), 'a { background: url("data:image/png;base64,AA"); } b { background: none; }');
});

test("shadowCss junta tokens y el CSS de cada componente con su prefijo", () => {
	const css = client.shadowCss({ tokens: ":root { --c: red; }", css: { Card: ".root { color: var(--c); }", Badge: ".root { margin: 0; }" }, assets: {} });
	assert.match(css, /:host \{ --c: red; \}/);
	assert.match(css, /\.Card__root \{ color: var\(--c\); \}/);
	assert.match(css, /\.Badge__root \{ margin: 0; \}/);
});

// ---------------------------------------------------------------- datos y zoom
test("checkData: formato desconocido o sin componente → motivo; formato 1 → null", () => {
	assert.equal(client.checkData({ spec: { meta: { format: 1 }, component: {} } }), null);
	assert.match(client.checkData({ spec: { meta: {}, component: {} } }), /anterior a meta\.format/);
	assert.match(client.checkData({ spec: { meta: { format: 2 }, component: {} } }), /formato 2/);
	assert.match(client.checkData({}), /no trae la especificación/);
});

test("zoom: ajustar al lienzo y pasos fijos", () => {
	assert.equal(client.fitZoom({ width: 344, height: 924 }, { width: 800, height: 524 }), 460 / 924);
	assert.equal(client.fitZoom({ width: 20, height: 10 }, { width: 2000, height: 2000 }), 8, "tope de 8×");
	assert.equal(client.stepZoom(1, 1), 1.5);
	assert.equal(client.stepZoom(0.64, 1), 0.67);
	assert.equal(client.stepZoom(0.64, -1), 0.5);
	assert.equal(client.stepZoom(8, 1), 8);
	assert.deepEqual(client.previewBox({ width: 520, height: 160, scale: 2 }), { width: 260, height: 80 });
});

// ---------------------------------------------------------------- render (misma lógica que el JSX)
// Set State × Size: texto y prop de instancia por variante, una capa extra en Size=L, booleano y
// texto como props; Disabled y Active dan aria
function cardSet() {
	const solid = (r, g, b) => [{ type: "SOLID", color: { r, g, b, a: 1 } }];
	const text = (name, chars, extra = {}) => ({ ...T(chars), name, ...extra });
	const tag = (tone) => ({ id: `${++seq}:1`, name: "Tag", type: "INSTANCE", componentId: `tag-${tone}`, layoutMode: "HORIZONTAL", absoluteBoundingBox: box(40, 20), fills: solid(0.8, 0.9, 1), children: [text("Text", tone)], componentProperties: { Tone: { type: "VARIANT", value: tone } } });
	const variant = (state, size) => ({
		id: `${++seq}:1`, name: `State=${state}, Size=${size}`, type: "COMPONENT", layoutMode: "VERTICAL", fills: solid(state === "Hover" ? 0.9 : 1, 1, 1), absoluteBoundingBox: box(180, 120),
		children: [
			text("Title", "Tarjeta", { componentPropertyReferences: { characters: "Title#1:0" } }),
			text("Label", state === "Disabled" ? "No disponible" : "Enviar"),
			{ id: `${++seq}:1`, name: "Dot", type: "ELLIPSE", fills: solid(1, 0, 0), absoluteBoundingBox: box(8, 8), componentPropertyReferences: { visible: "Show dot#2:0" } },
			{ id: `${++seq}:1`, name: "icon", type: "VECTOR", fills: solid(0, 0, 0), absoluteBoundingBox: box(16, 16) },
			tag(state === "Hover" ? "Warn" : "Info"),
			...(size === "L" ? [text("Extra", "Solo en L")] : []),
		],
	});
	const states = ["Default", "Hover", "Disabled", "Active"];
	const set = {
		id: `${++seq}:1`, name: "Card", type: "COMPONENT_SET", absoluteBoundingBox: box(600, 600),
		componentPropertyDefinitions: {
			State: { type: "VARIANT", defaultValue: "Default", variantOptions: states },
			Size: { type: "VARIANT", defaultValue: "S", variantOptions: ["S", "L"] },
			"Title#1:0": { type: "TEXT", defaultValue: "Tarjeta" },
			"Show dot#2:0": { type: "BOOLEAN", defaultValue: true },
		},
		children: states.flatMap((s) => ["S", "L"].map((z) => variant(s, z))),
	};
	const icons = {};
	(function walk(n) {
		if (n.type === "VECTOR") icons[n.id] = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path d="M0 0h16v16H0z" fill="currentColor"/></svg>';
		(n.children || []).forEach(walk);
	})(set);
	const components = { "tag-Info": { name: "Tone=Info", componentSetId: "tags" }, "tag-Warn": { name: "Tone=Warn", componentSetId: "tags" } };
	return { figspec: 2, name: "Card", nodeId: set.id, exportedAt: "2026-01-01T00:00:00Z", icons, images: {}, variables: {}, nodes: { [set.id]: { document: set, components, componentSets: { tags: { name: "Tag" } } } } };
}

let cardData;
function card(values) {
	if (!cardData) {
		const { out, status, stderr } = extract(["--viewer"], cardSet());
		assert.equal(status, 0, stderr);
		cardData = embedded(fs.readFileSync(path.join(out, "viewer.html"), "utf8"));
	}
	return client.toHtml(client.renderTree(cardData, "Card", values));
}

test("render: valores por defecto de Figma (variante, texto, booleano) y clases con prefijo", () => {
	const html = card({});
	assert.match(html, /^<div class="Card__root" data-state="Default" data-size="S">/);
	assert.match(html, /<span class="Card__title">Tarjeta<\/span><span class="Card__label">Enviar<\/span><div class="Card__dot"><\/div>/);
	assert.doesNotMatch(html, /Solo en L/);
});

test("render: texto, prop de instancia y estructura según la variante", () => {
	assert.match(card({ state: "Disabled" }), /<span class="Card__label">No disponible<\/span>/);
	assert.match(card({ state: "Hover" }), /<div class="Tag__root Card__tag" data-tone="Warn">/, "la instancia recibe su ubicación desde el padre");
	assert.match(card({ state: "Default" }), /data-tone="Info"/);
	assert.match(card({ size: "L" }), /Solo en L/);
	assert.match(card({ state: "Hover", size: "L" }), /data-tone="Warn".*Solo en L/);
});

test("render: props de texto y booleanas; una prop undefined toma el valor por defecto", () => {
	const html = card({ title: "Otra <b>", showDot: false });
	assert.match(html, /<span class="Card__title">Otra &lt;b&gt;<\/span>/);
	assert.doesNotMatch(html, /Card__dot/);
	assert.match(card({ title: undefined }), /Tarjeta/);
});

test("render: aria según el estado", () => {
	assert.match(card({ state: "Disabled" }), /^<div [^>]*aria-disabled="true"/);
	assert.match(card({ state: "Active" }), /^<div [^>]*aria-current="true"/);
	assert.doesNotMatch(card({ state: "Default" }), /aria-/);
});

test("render: íconos en línea con su clase; sin el archivo, un marcador", () => {
	assert.match(card({}), /<svg class="Card__\w*[iI]con" xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*><path[^>]*currentColor/);
	assert.doesNotMatch(card({}), /<\?xml/);
	const data = JSON.parse(JSON.stringify(cardData));
	data.assets = {};
	assert.match(client.toHtml(client.renderTree(data, "Card", {})), /<span class="Card__\w*[iI]con" data-figspec-missing="Card\/assets\/icons\/[^"]+\.svg"><\/span>/);
});

test("render: cada nodo sabe de qué componente y capa viene", () => {
	cardData || card({});
	const tree = client.renderTree(cardData, "Card", { state: "Hover" });
	assert.equal(tree.comp, "Card");
	assert.equal(tree.el.className, "root");
	const tagRoot = tree.children.find((n) => typeof n !== "string" && n.comp === "Tag");
	assert.equal(tagRoot.instance.el.className, "tag");
	assert.equal(tagRoot.instance.parent, "Card");
});

// ---------------------------------------------------------------- comparación
test("modos: lado a lado duplica el ancho y corre el render; los demás comparten el origen", () => {
	const box = { width: 344, height: 924 };
	assert.deepEqual(client.modeLayout("side", box), { width: 344 * 2 + 24, height: 924, renderX: 344 + 24, figma: true, render: true });
	for (const m of ["overlay", "diff"]) assert.deepEqual(client.modeLayout(m, box), { width: 344, height: 924, renderX: 0, figma: true, render: true });
	assert.equal(client.modeLayout("render", box).figma, false);
	assert.equal(client.modeLayout("figma", box).render, false);
});

test("modo inicial: el guardado si existe; si no, lado a lado; sin vista previa, solo el render", () => {
	assert.equal(client.initialMode(null, true), "side");
	assert.equal(client.initialMode("diff", true), "diff");
	assert.equal(client.initialMode("otro", true), "side");
	assert.equal(client.initialMode("diff", false), "render");
	assert.deepEqual(client.MODES.map((m) => m.id), ["side", "overlay", "diff", "render", "figma"]);
});

// ---------------------------------------------------------------- árbol de capas y selección
test("árbol: una capa por elemento, la instancia es una capa con su estructura adentro", () => {
	card({});
	const layers = client.treeModel(client.renderTree(cardData, "Card", {}));
	assert.deepEqual(layers.map((l) => [l.depth, l.kind, l.inside]), [
		[0, "box", null], [1, "text", null], [1, "text", null], [1, "box", null], [1, "icon", null], [1, "instance", null], [2, "text", "Tag"],
	]);
	assert.equal(layers[5].parent, layers[0]);
	assert.deepEqual(layers[0].children.map((l) => l.id), [1, 2, 3, 4, 5]);
	// Sin el punto (showDot = false) la capa no está: el árbol es el del render
	assert.equal(client.treeModel(client.renderTree(cardData, "Card", { showDot: false })).length, 6);
});

test("árbol: nombres de Figma (textos por contenido) o, con Código, clases y componentes", () => {
	const layers = client.treeModel(client.renderTree(cardData, "Card", { state: "Disabled" }));
	const label = (i, code) => client.treeLabel(layers[i], code);
	assert.deepEqual(label(2, false), { icon: "T", main: "No disponible", sub: "", tags: [] });
	assert.deepEqual(label(2, true), { icon: "T", main: ".label", sub: "Label", tags: [] });
	assert.deepEqual(label(1, false).tags, ["{title}"], "texto enlazado: se muestra la prop");
	assert.equal(label(1, false).main, "Title");
	assert.deepEqual(label(3, false).tags, ["si {showDot}"]);
	assert.deepEqual(label(5, false), { icon: "◆", main: "Tag", sub: "", tags: [] });
	assert.equal(label(5, true).main, "<Tag>");
});

test("árbol: los tramos de un texto con estilos distintos no son capas", () => {
	const r = { tag: "span", attrs: {}, comp: "C", el: { name: "T", className: "t" }, children: ["Hola ", { tag: "span", attrs: {}, children: ["mundo"], comp: "C", el: {}, segment: true }] };
	const layers = client.treeModel({ tag: "div", attrs: {}, comp: "C", el: { name: "C", className: "root" }, children: [r] });
	assert.equal(layers.length, 2);
	assert.equal(client.treeLabel(layers[1], false).main, "Hola mundo");
});

test("hitTest: la capa más profunda bajo el punto; entre iguales, la de encima", () => {
	const items = [
		{ rect: { x: 0, y: 0, width: 100, height: 100 }, depth: 0 },
		{ rect: { x: 10, y: 10, width: 50, height: 20 }, depth: 1 },
		{ rect: { x: 12, y: 12, width: 10, height: 10 }, depth: 2 },
		{ rect: { x: 10, y: 10, width: 50, height: 20 }, depth: 1 },
		{ rect: { x: 0, y: 0, width: 0, height: 0 }, depth: 5 },
	];
	assert.equal(client.hitTest(items, { x: 15, y: 15 }), 2);
	assert.equal(client.hitTest(items, { x: 40, y: 15 }), 3, "dos hermanos iguales: el que se dibuja después");
	assert.equal(client.hitTest(items, { x: 90, y: 90 }), 0);
	assert.equal(client.hitTest(items, { x: 200, y: 0 }), -1);
	assert.equal(client.hitTest(items, { x: 0, y: 0 }), 0, "las cajas vacías no cuentan");
});

// ---------------------------------------------------------------- fuentes
test("fuentes: las que nombra el CSS, sin genéricas ni variables ni repetidas", () => {
	const css = ['.a { font-family: "Geist"; } .b { font-family: "Roboto", sans-serif; }', ".c { font-family: 'Geist', var(--f), monospace !important; } .d{font-family:Pacifico}"];
	assert.deepEqual(client.fontFamilies(css), ["Geist", "Roboto", "Pacifico"]);
	assert.deepEqual(client.fontFamilies([null, ""]), []);
});

test("fuentes: instalada si el ancho cambia respecto de alguna genérica", () => {
	const widths = { "72px monospace": 600, "72px serif": 500, "72px sans-serif": 520 };
	const measure = (installed) => (font) => {
		const m = font.match(/^72px "(.+)", (.+)$/);
		return m ? (installed.includes(m[1]) ? 480 : widths[`72px ${m[2]}`]) : widths[font];
	};
	assert.equal(client.fontInstalled(measure(["Inter"]), "Inter"), true);
	assert.equal(client.fontInstalled(measure([]), "Geist"), false);
});

// ---------------------------------------------------------------- inspector
test("inspector: CSS por origen con los selectores reales del .module.css", () => {
	card({});
	const tree = client.renderTree(cardData, "Card", { state: "Hover" });
	const groups = client.cssGroups(cardData, tree);
	assert.deepEqual(groups.map((g) => [g.origin, g.title]), [["base", "Base"], ["variant", "Si state = Hover"]]);
	for (const g of groups) assert.ok(cardData.css.Card.includes(`${g.selector} {`), `${g.selector} no está en Card.module.css`);
	assert.equal(groups[1].selector, '.root:where([data-state="Hover"])');
	assert.deepEqual(groups[1].decls.map(([k]) => k), ["background-color"]);
	// Disabled no cambia estilos del root: solo la base
	assert.equal(client.cssGroups(cardData, client.renderTree(cardData, "Card", { state: "Disabled" })).length, 1);
});

test("inspector: una instancia muestra su CSS y su ubicación desde el padre", () => {
	const tree = client.renderTree(cardData, "Card", { state: "Hover" });
	const tag = tree.children.find((n) => typeof n !== "string" && n.instance);
	const groups = client.cssGroups(cardData, tag);
	assert.deepEqual(groups.map((g) => [g.origin, g.file, g.selector]), [
		["base", "Tag.module.css", ".root"],
		["placement", "Card.module.css", ".root .tag"],
	]);
	for (const g of groups) assert.ok(cardData.css[g.file.replace(".module.css", "")].includes(`${g.selector} {`), g.selector);
	assert.match(client.cssText(groups), /^\/\* Tag\.module\.css · Base \*\/\n\.root \{\n  width: 40px;/);
});

test("inspector: tokens dentro de un valor", () => {
	assert.deepEqual(client.valueParts("1px solid var(--line, #E4E4E7)"), ["1px solid ", { token: "--line", fallback: "#E4E4E7" }]);
	assert.deepEqual(client.valueParts("var(--a) var(--b, rgba(0, 0, 0, 0.5))"), [{ token: "--a", fallback: null }, " ", { token: "--b", fallback: "rgba(0, 0, 0, 0.5)" }]);
	assert.deepEqual(client.valueParts("12px"), ["12px"]);
});

// ---------------------------------------------------------------- variantes y props
test("controles: uno por prop según su tipo", () => {
	card({});
	const controls = client.propControls(cardData, cardData.spec.component);
	assert.deepEqual(controls.map((c) => [c.name, c.control, c.options]), [
		["state", "select", ["Default", "Hover", "Disabled", "Active"]],
		["size", "select", ["S", "L"]],
		["title", "text", undefined],
		["showDot", "check", undefined],
	]);
	const icon = client.propControls({ ...cardData, assets: { "a/x.svg": { svg: "<svg/>" }, "a/y.png": { url: "" } } }, { name: "X", props: { icon: { type: "icon" }, slot: { type: "node" } } });
	assert.deepEqual(icon.map((c) => [c.name, c.options, c.none]), [["icon", ["a/x.svg"], true], ["slot", ["Tag"], true]]);
});

test("vista previa de un set: cada variante en su lugar, recortada con margen", () => {
	const data = JSON.parse(JSON.stringify(cardData));
	data.spec.meta.preview = {
		file: "preview.png", width: 560, height: 640, scale: 1, offset: { x: 20, y: 20 },
		variants: [
			{ when: { state: "Default", size: "S" }, offset: { x: 20, y: 20 }, width: 180, height: 120 },
			{ when: { state: "Hover", size: "L" }, offset: { x: 300, y: 170 }, width: 240, height: 120 },
		],
	};
	assert.deepEqual(client.previewFor(data, "Card", {}), { offset: { x: 20, y: 20 }, crop: { x: 4, y: 4, width: 212, height: 152 }, exact: true, reason: null });
	assert.deepEqual(client.previewFor(data, "Card", { state: "Hover", size: "L" }).offset, { x: 300, y: 170 });
	assert.equal(client.previewFor(data, "Card", { state: "Hover", size: "L" }).crop.width, 240 + 32);
	assert.equal(client.previewFor(data, "Card", { state: "Active" }).reason, "variant", "la imagen no tiene esa combinación");
	assert.deepEqual(client.previewFor(data, "Card", { title: "Otro" }), { offset: { x: 20, y: 20 }, crop: { x: 4, y: 4, width: 212, height: 152 }, exact: false, reason: "props" });
	assert.equal(client.previewFor(data, "Tag", {}).reason, "component");
});

test("vista previa sin variantes: solo coincide con los valores por defecto", () => {
	const data = JSON.parse(JSON.stringify(cardData));
	data.spec.meta.preview = { file: "preview.png", width: 200, height: 120, scale: 1, offset: { x: 0, y: 0 } };
	assert.equal(client.previewFor(data, "Card", {}).exact, true);
	assert.equal(client.previewFor(data, "Card", {}).crop, null);
	assert.equal(client.previewFor(data, "Card", { state: "Hover" }).reason, "variant");
	assert.equal(client.previewFor(data, "Card", { showDot: false }).reason, "props");
	delete data.spec.meta.preview;
	assert.equal(client.previewFor(data, "Card", {}).reason, "none");
});

test("capas: la clave se conserva entre variantes (selección y desplegado)", () => {
	const a = client.treeModel(client.renderTree(cardData, "Card", {}));
	const b = client.treeModel(client.renderTree(cardData, "Card", { state: "Hover", size: "L" }));
	assert.equal(a.find((l) => l.cls === "tag").key, "Card/tag");
	assert.equal(b.find((l) => l.cls === "tag").key, "Card/tag");
	assert.deepEqual(a.map((l) => l.key).filter((k) => !b.some((x) => x.key === k)), [], "todas las capas de S siguen en L");
	const twins = client.treeModel({ tag: "div", attrs: {}, comp: "C", el: { className: "root" }, children: [1, 2].map(() => ({ tag: "div", attrs: {}, comp: "C", el: { className: "item" }, children: [] })) });
	assert.deepEqual(twins.map((l) => l.key), ["C", "C/item", "C/item#1"]);
});

// ---------------------------------------------------------------- renombrar y archivo de decisiones
test("renombrar: la clase y el componente que dará el extractor", () => {
	assert.equal(client.codeClass("Ítem de menú"), "itemDeMenu");
	assert.equal(client.codeClass("Registro"), "registro");
	assert.equal(client.codeClass("2 columnas"), "el2Columnas");
	assert.equal(client.codeClass("root"), "rootEl");
	assert.equal(client.codeClass("$$$"), "el");
	assert.equal(client.codeComponent("menú lateral"), "MenuLateral");
	assert.equal(client.codeComponent("---"), "Componente");
});

test("archivo de decisiones: lo aplicado antes más los cambios nuevos; null quita", () => {
	const meta = { source: { node: "33:566" }, decisions: { names: { root: "Menú", byId: { "1:1": "uno", "2:2": "dos" }, states: { "9:9": "off" } } } };
	assert.deepEqual(client.decisionsDoc(meta, { byId: { "2:2": null, "3:3": "tres" } }), {
		figspec: "decisions", version: 1, component: "33:566",
		names: { root: "Menú", byId: { "1:1": "uno", "3:3": "tres" }, states: { "9:9": "off" } },
	});
	assert.deepEqual(client.decisionsDoc(meta, { root: null, byId: {} }).names.root, undefined);
	assert.deepEqual(client.decisionsDoc({ source: { node: "1:0" } }, { root: "Nuevo", byId: {} }).names, { root: "Nuevo", byId: {}, states: {} });
});

test("archivo de decisiones: el extractor lo acepta tal como lo arma el visualizador", () => {
	const set = cardSet();
	const id = set.nodes[set.nodeId].document.children[0].children[1].id; // "Label" en la variante por defecto
	const doc = client.decisionsDoc({ source: { node: set.nodeId } }, { root: "Tarjeta", byId: { [id]: "Leyenda" } });
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figspec-dec-"));
	fs.writeFileSync(path.join(dir, "d.json"), JSON.stringify(doc));
	const { out, status, stderr } = extract(["--viewer", "--decisions", path.join(dir, "d.json")], set);
	assert.equal(status, 0, stderr);
	const spec = JSON.parse(fs.readFileSync(path.join(out, "component.json"), "utf8"));
	assert.equal(spec.component.name, "Tarjeta");
	assert.ok(spec.component.structure.children.some((e) => e.id === id && e.className === "leyenda"));
	assert.deepEqual(spec.meta.decisions.names.byId, { [id]: "Leyenda" });
	assert.equal(spec.meta.source.bundle, "in.json");
});

// ---------------------------------------------------------------- desvíos de posición
test("desvíos: cajas de la variante que se ve; solo del componente principal", () => {
	const data = { spec: cardData.spec, geometry: { variants: [
		{ when: { state: "Default", size: "S" }, boxes: { a: [0, 0, 10, 10] } },
		{ when: { state: "Hover", size: "L" }, boxes: { a: [0, 5, 10, 10] } },
	] } };
	assert.deepEqual(client.geometryFor(data, "Card", {}), { a: [0, 0, 10, 10] });
	assert.deepEqual(client.geometryFor(data, "Card", { state: "Hover", size: "L" }), { a: [0, 5, 10, 10] });
	assert.equal(client.geometryFor(data, "Card", { state: "Active" }), null);
	assert.equal(client.geometryFor(data, "Tag", {}), null);
	assert.equal(client.geometryFor({ spec: cardData.spec }, "Card", {}), null);
});

test("desvíos: solo las capas que se corren más de 2 px, de mayor a menor", () => {
	const r = (x, y, width, height) => ({ x, y, width, height });
	const list = client.deviations([
		{ layer: "igual", render: r(10, 10, 50, 20), figma: [10, 10, 50, 20] },
		{ layer: "casi", render: r(12, 10, 50, 20), figma: [10, 10, 50, 20] },
		{ layer: "corrida", render: r(10, 13, 50, 20), figma: [10, 10, 50, 20] },
		{ layer: "angosta", render: r(10, 10, 40, 20), figma: [10, 10, 50, 20] },
		{ layer: "sin figma", render: r(0, 0, 1, 1), figma: null },
	]);
	assert.deepEqual(list.map((d) => d.layer), ["angosta", "corrida"]);
	assert.equal(client.deviationText(list[0]), "ancho −10");
	assert.equal(client.deviationText(list[1]), "y +3");
});

test("viewer.html embebe figma-geometry.json", () => {
	const { out } = extract(["--viewer"], cardSet());
	const data = embedded(fs.readFileSync(path.join(out, "viewer.html"), "utf8"));
	assert.equal(data.geometry.format, 1);
	assert.equal(data.geometry.variants.length, 8);
});
