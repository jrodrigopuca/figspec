// figspec export — exporta la selección en el formato de la API REST de Figma (JSON_REST_V1)
// junto con íconos (SVG), imágenes, vista previa y nombres de variables, en un solo archivo
// que el extractor lee con `node extractor.js --from <archivo>`.
// Corre dentro de Figma: no usa la API REST ni consume su cuota.

// Misma regla que extractor.js para decidir qué se exporta como ícono
const VECTOR_TYPES = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "REGULAR_POLYGON"];

figma.showUI(__html__, { width: 320, height: 250, themeColors: true });
sendSelection();
figma.on("selectionchange", sendSelection);

figma.ui.onmessage = async (msg) => {
	if (msg.type !== "export") return;
	try {
		const bundle = await exportSelection(msg.options || {});
		figma.ui.postMessage({ type: "bundle", bundle });
	} catch (e) {
		figma.ui.postMessage({ type: "error", message: String((e && e.message) || e) });
	}
};

function sendSelection() {
	const sel = figma.currentPage.selection;
	figma.ui.postMessage({
		type: "selection",
		count: sel.length,
		name: sel.length === 1 ? sel[0].name : null,
	});
}

function progress(text) {
	figma.ui.postMessage({ type: "progress", text });
}

async function exportSelection(options) {
	const sel = figma.currentPage.selection;
	if (sel.length !== 1)
		throw new Error("Selecciona un solo elemento (frame, componente o instancia).");
	const node = sel[0];

	progress("Exportando estructura…");
	// Mismo formato que una entrada de GET /v1/files/:key/nodes
	const entry = await node.exportAsync({ format: "JSON_REST_V1" });
	await addRotationGeometry(entry.document);
	const bundle = {
		figspec: 1,
		name: node.name,
		nodeId: node.id,
		fileKey: figma.fileKey || null, // solo disponible en plugins privados
		exportedAt: new Date().toISOString(),
		nodes: { [node.id]: entry },
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
