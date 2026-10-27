// figspec export — exporta un componente en el formato de la API REST de Figma (JSON_REST_V1)
// junto con íconos (SVG), imágenes, vista previa, nombres de variables y los nombres que el
// usuario elige para las capas con nombre vago ("Frame 5"), en un solo archivo que el extractor
// lee con `node extractor.js <archivo>`.
// Corre dentro de Figma: no usa la API REST ni consume su cuota.

// Misma regla que extractor.js para decidir qué se exporta como ícono
const VECTOR_TYPES = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "REGULAR_POLYGON"];
// Nombres elegidos en la ventana, guardados en el archivo (datos del plugin, invisibles)
const NAME_KEY = "figspec.name";

let rootId = null; // raíz fijada: hacer clic en una fila o ubicar una capa no la cambia

figma.showUI(__html__, { width: 360, height: 500, themeColors: true });
start();
figma.on("selectionchange", onSelection);

async function start() {
	const sel = figma.currentPage.selection;
	if (sel.length === 1) await analyze(sel[0]);
	else onSelection();
}

// Con la raíz fijada, otra selección solo se avisa ("Usar esta selección")
function onSelection() {
	const sel = figma.currentPage.selection;
	if (!rootId) {
		if (sel.length === 1) return analyze(sel[0]).catch(fail);
		figma.ui.postMessage({ type: "empty", count: sel.length });
		return;
	}
	// También para capas internas: elegir otra capa es deliberado (ubicar no cambia la selección)
	// y permite exportar solo una parte, p. ej. un ítem
	const other = sel.length === 1 && sel[0].id !== rootId;
	figma.ui.postMessage({ type: "selection", other: other ? sel[0].name : null });
}

figma.ui.onmessage = async (msg) => {
	try {
		if (msg.type === "use-selection") {
			const sel = figma.currentPage.selection;
			if (sel.length === 1) await analyze(sel[0]);
		} else if (msg.type === "locate") {
			// Centra la capa sin seleccionarla: la selección es la raíz y no debe cambiar
			const n = await figma.getNodeByIdAsync(msg.id);
			if (n) figma.viewport.scrollAndZoomIntoView([n]);
		} else if (msg.type === "export") {
			const bundle = await exportRoot(msg.options || {}, msg.names || {});
			figma.ui.postMessage({ type: "bundle", bundle });
		}
	} catch (e) {
		fail(e);
	}
};

function fail(e) {
	figma.ui.postMessage({ type: "error", message: String((e && e.message) || e) });
}

function progress(text) {
	figma.ui.postMessage({ type: "progress", text });
}

// ---------------------------------------------------------------- análisis de la raíz
// Lista las capas con nombre vago, con la sugerencia del extractor y el nombre guardado antes.
async function analyze(node) {
	rootId = node.id;
	figma.ui.postMessage({ type: "progress", text: "Analizando…" });
	const entry = await node.exportAsync({ format: "JSON_REST_V1" });
	const rows = vagueRows(entry);
	for (const row of rows) {
		const n = await figma.getNodeByIdAsync(row.id);
		row.value = (n && readName(n)) || "";
	}
	figma.ui.postMessage({
		type: "analysis",
		root: {
			id: node.id,
			name: node.name,
			generic: isGeneric(node.name),
			value: readName(node) || "",
		},
		rows,
	});
}

function readName(n) {
	try {
		return n.getPluginData(NAME_KEY);
	} catch (e) {
		return "";
	}
}

function writeName(n, value) {
	try {
		n.setPluginData(NAME_KEY, value || "");
	} catch (e) {
		/* capas donde no se puede guardar (p. ej. dentro de algunas instancias): no se recuerda */
	}
}

// Recorre como el extractor: no entra en íconos, ni en capas ocultas que se descartan, y de cada
// componente repetido lista solo la primera instancia (el extractor usa esa para el subcomponente).
function vagueRows(entry) {
	const components = entry.components || {};
	let doc = entry.document;
	if (doc.type === "COMPONENT_SET") doc = defaultVariant(doc);
	const rows = [];
	const seenComponents = new Set();
	(function visit(n, parent, isRoot) {
		const refs = n.componentPropertyReferences || {};
		if (!isRoot && n.visible === false && !refs.visible) return;
		const iconLike = !isRoot && (VECTOR_TYPES.includes(n.type) || isIconish(n));
		if (!isRoot && vagueName(n))
			rows.push({
				id: n.id,
				name: n.name,
				kind: n.type === "TEXT" ? "text" : iconLike ? "icon" : n.type === "INSTANCE" ? "instance" : "frame",
				context: n.type === "TEXT" ? n.characters : iconLike ? textNear(n, parent) : ownChildText(n),
				parent: parent ? parent.name : "",
				suggestion: camel(suggestName(n, parent, iconLike) || n.name),
			});
		if (iconLike) return;
		if (!isRoot && n.type === "INSTANCE" && n.componentId) {
			const meta = components[n.componentId] || {};
			const key = meta.componentSetId || n.componentId;
			if (seenComponents.has(key)) return;
			seenComponents.add(key);
		}
		for (const c of n.children || []) visit(c, n, false);
	})(doc, null, true);
	return rows;
}

function defaultVariant(set) {
	const defs = set.componentPropertyDefinitions || {};
	const want = Object.entries(defs)
		.filter(([, d]) => d.type === "VARIANT")
		.map(([k, d]) => `${k.replace(/#.*$/, "")}=${d.defaultValue}`);
	const kids = (set.children || []).filter((c) => c.type === "COMPONENT");
	return (
		kids.find((c) => want.every((w) => c.name.split(",").map((s) => s.trim()).includes(w))) ||
		kids[0] ||
		set
	);
}

// ---------------------------------------------------------------- exportar
async function exportRoot(options, names) {
	const node = rootId && (await figma.getNodeByIdAsync(rootId));
	if (!node) throw new Error("Selecciona un frame, componente o instancia para exportar.");

	// Los nombres elegidos se guardan en el archivo para la próxima exportación
	writeName(node, names.root);
	for (const [id, value] of Object.entries(names.byId || {})) {
		const n = await figma.getNodeByIdAsync(id);
		if (n) writeName(n, value);
	}

	progress("Exportando estructura…");
	// Mismo formato que una entrada de GET /v1/files/:key/nodes
	const entry = await node.exportAsync({ format: "JSON_REST_V1" });
	await addRotationGeometry(entry.document);
	const byId = {};
	for (const [id, value] of Object.entries(names.byId || {})) if (value) byId[id] = value;
	const bundle = {
		figspec: 2,
		name: node.name,
		nodeId: node.id,
		fileKey: figma.fileKey || null, // solo disponible en plugins privados
		exportedAt: new Date().toISOString(),
		nodes: { [node.id]: entry },
		names: { root: names.root || null, byId },
		variables: await variables(entry.document),
		icons: {},
		images: {},
		preview: null,
	};

	if (options.assets) {
		const ids = iconCandidates(entry.document);
		for (let i = 0; i < ids.length; i++) {
			progress(`Íconos ${i + 1}/${ids.length}…`);
			const n = await figma.getNodeByIdAsync(ids[i]);
			if (!n || !("exportAsync" in n)) continue;
			try {
				bundle.icons[ids[i]] = await n.exportAsync({ format: "SVG_STRING" });
			} catch (e) {
				/* capa que no se puede exportar (p. ej. vacía): se omite */
			}
		}
		const hashes = imageHashes(entry.document);
		for (let i = 0; i < hashes.length; i++) {
			progress(`Imágenes ${i + 1}/${hashes.length}…`);
			const img = figma.getImageByHash(hashes[i]);
			if (img) bundle.images[hashes[i]] = await img.getBytesAsync();
		}
	}
	if (options.png) {
		progress("Vista previa…");
		bundle.preview = await node.exportAsync({
			format: "PNG",
			constraint: { type: "SCALE", value: 1 },
		});
	}
	return bundle;
}

// JSON_REST_V1 no trae size ni relativeTransform (la API REST sí, con geometry=paths): se toman
// del nodo, solo en los elementos rotados, que son los únicos que el extractor los necesita.
async function addRotationGeometry(root) {
	const stack = [root];
	while (stack.length) {
		const n = stack.pop();
		for (const c of n.children || []) stack.push(c);
		const node = await figma.getNodeByIdAsync(n.id);
		if (!node || typeof node.rotation !== "number" || Math.abs(node.rotation) < 0.01) continue;
		n.size = { x: node.width, y: node.height };
		n.relativeTransform = node.relativeTransform.map((row) => row.slice());
	}
}

// Nombres y codeSyntax de las variables enlazadas (la API REST solo los da en Enterprise)
async function variables(doc) {
	const ids = new Set();
	(function collect(v) {
		if (Array.isArray(v)) return v.forEach(collect);
		if (!v || typeof v !== "object") return;
		if (v.type === "VARIABLE_ALIAS" && v.id) ids.add(v.id);
		for (const k in v) collect(v[k]);
	})(doc);
	const out = {};
	for (const id of ids) {
		const v = await figma.variables.getVariableByIdAsync(id);
		if (v)
			out[id] = {
				id: v.id,
				name: v.name,
				codeSyntax: v.codeSyntax,
				resolvedType: v.resolvedType,
			};
	}
	return out;
}

// ---------------------------------------------------------------- íconos (como extractor.js)
function visiblePaints(list) {
	return (list || []).filter((p) => p.visible !== false);
}
function isVectorish(n) {
	if (n.visible === false) return true;
	if (VECTOR_TYPES.includes(n.type) || n.type === "LINE") return true;
	if (n.type === "TEXT") return false;
	if ((n.type === "ELLIPSE" || n.type === "RECTANGLE") && !(n.children || []).length)
		return !visiblePaints(n.fills).some((p) => p.type === "IMAGE");
	const kids = n.children || [];
	return kids.length > 0 && kids.every(isVectorish);
}
function hasTrueVector(n) {
	return VECTOR_TYPES.includes(n.type) || (n.children || []).some(hasTrueVector);
}
function isIconish(n) {
	if (n.type === "TEXT" || !(n.children || []).length) return false;
	const own = visiblePaints(n.fills).length + visiblePaints(n.strokes).length > 0;
	return !own && n.children.every(isVectorish) && hasTrueVector(n);
}

// Nodos que el extractor tratará como ícono; no se entra en ellos
function iconCandidates(root) {
	const ids = [];
	(function visit(n) {
		for (const c of n.children || []) {
			if (VECTOR_TYPES.includes(c.type) || isIconish(c)) ids.push(c.id);
			else visit(c);
		}
	})(root);
	return ids;
}

function imageHashes(root) {
	const out = new Set();
	(function visit(n) {
		for (const p of n.fills || []) if (p.type === "IMAGE" && p.imageRef) out.add(p.imageRef);
		(n.children || []).forEach(visit);
	})(root);
	return [...out];
}

// ---------------------------------------------------------------- nombres (como extractor.js)
// Copia de las reglas de "nombres sugeridos" de extractor.js, solo para mostrar en la ventana qué
// capas tienen nombre vago y qué nombre se usará si no se escribe otro. El extractor es quien
// decide: si estas reglas se desincronizan, solo cambia el texto de ayuda.
const GENERIC =
	/^(frame|group|rectangle|vector|ellipse|line|polygon|star|union|subtract|intersect|exclude|image|component|instance|auto layout|icon|ic|svg|shape)(\s*\d+)?$/i;
const REPEAT_MIN = 3;

function isGeneric(name) {
	return GENERIC.test(String(name).trim());
}
function vagueName(node) {
	if (isGeneric(node.name)) return true;
	const chars = node.type === "TEXT" ? String(node.characters || "").trim() : null;
	return chars !== null && String(node.name).trim() === chars && !usableText(chars);
}
function suggestName(node, parent, iconLike) {
	if (node.type === "TEXT") return "text";
	if (iconLike) {
		const near = textNear(node, parent);
		return near ? `${near} Icon` : "icon";
	}
	const text = ownChildText(node);
	if (!text) return null;
	const role = repeated(node, parent)
		? "Item"
		: { HORIZONTAL: "Row", VERTICAL: "Column" }[node.layoutMode] || "Box";
	return `${text} ${role}`;
}
function usableText(s) {
	const t = String(s || "").replace(/\s+/g, " ").trim();
	if (!t || /lorem ipsum|@|:\/\//i.test(t) || !/\p{L}/u.test(t)) return null;
	return t.split(" ").length > 3 ? null : t;
}
function ownText(n) {
	return (
		n.type === "TEXT" &&
		n.visible !== false &&
		!(n.componentPropertyReferences || {}).characters &&
		usableText(n.characters)
	);
}
function ownChildText(node) {
	const texts = (node.children || []).filter((c) => c.type === "TEXT" && c.visible !== false);
	return texts.length === 1 ? ownText(texts[0]) || null : null;
}
function textNear(node, parent) {
	const sibs = (parent && parent.children) || [];
	const i = sibs.indexOf(node);
	for (let d = 1; d < sibs.length; d++)
		for (const j of [i + d, i - d]) {
			const t = sibs[j] && ownText(sibs[j]);
			if (t) return t;
		}
	return null;
}
function signature(n) {
	if (n.type === "TEXT") return "T";
	if (VECTOR_TYPES.includes(n.type) || isIconish(n)) return "I";
	return `${n.type}:${n.layoutMode || ""}(${(n.children || [])
		.filter((c) => c.visible !== false)
		.map(signature)
		.join(",")})`;
}
function repeated(node, parent) {
	const sibs = ((parent && parent.children) || []).filter((c) => c.visible !== false);
	const sig = signature(node);
	return sibs.filter((c) => signature(c) === sig).length >= REPEAT_MIN;
}
function camel(s) {
	const words = String(s)
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean);
	return words
		.map((w, i) => (i ? w[0].toUpperCase() : w[0].toLowerCase()) + w.slice(1))
		.join("");
}
