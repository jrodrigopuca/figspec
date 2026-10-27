// figspec export — exporta un componente en el formato de la API REST de Figma (JSON_REST_V1)
// junto con íconos (SVG), imágenes, vista previa y nombres de variables: la foto de Figma, que el
// extractor lee con `node extractor.js <archivo>`. Los nombres que el usuario elige para las capas
// con nombre vago ("Frame 5") van en otro archivo (formato de decisiones), solo si hay alguno.
// Corre dentro de Figma: no usa la API REST ni consume su cuota.
// Solo lectura: no escribe nada en el archivo de Figma (ni datos del plugin), así no aparece en el
// historial de versiones ni genera ruido a quienes diseñan. Ubicar una capa solo mueve la vista.

// Misma regla que extractor.js para decidir qué se exporta como ícono
const VECTOR_TYPES = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "REGULAR_POLYGON"];

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
			const { bundle, names } = await exportRoot(msg.options || {}, msg.names || {});
			figma.ui.postMessage({ type: "bundle", bundle, names });
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
// Lista las capas con nombre vago, con la sugerencia del extractor. Los campos empiezan vacíos:
// los nombres ya decididos viven en el archivo de decisiones del proyecto, no en Figma.
async function analyze(node) {
	rootId = node.id;
	figma.ui.postMessage({ type: "progress", text: "Analizando…" });
	const entry = await node.exportAsync({ format: "JSON_REST_V1" });
	const rows = vagueRows(entry);
	for (const row of rows) row.value = "";
	const repeats = repeatGroups(entry);
	for (const rep of repeats) for (const g of rep.groups) g.value = "";
	figma.ui.postMessage({
		type: "analysis",
		root: { id: node.id, name: node.name, generic: isGeneric(node.name) || noLetters(node.name), value: "" },
		rows,
		repeats,
	});
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

// Estructuras repetidas (≥3 hermanos con la misma firma) y sus grupos de estilo, con el nombre de
// estado que les daría el extractor (--extract-repeated). El extractor agrupa por el CSS generado;
// aquí se comparan las propiedades visuales de Figma, que dan los mismos grupos en los casos
// comunes. Los nombres elegidos viajan por ítem, así que un grupo distinto no rompe nada.
function repeatGroups(entry) {
	const components = entry.components || {};
	let doc = entry.document;
	if (doc.type === "COMPONENT_SET") doc = defaultVariant(doc);
	const out = [];
	const seenComponents = new Set();
	const shown = (c) => c.visible !== false || (c.componentPropertyReferences || {}).visible;
	(function visit(n, isRoot) {
		if (!isRoot && (VECTOR_TYPES.includes(n.type) || isIconish(n))) return;
		if (!isRoot && n.type === "INSTANCE" && n.componentId) {
			const meta = components[n.componentId] || {};
			const key = meta.componentSetId || n.componentId;
			if (seenComponents.has(key)) return;
			seenComponents.add(key);
		}
		const kids = (n.children || []).filter(shown);
		const bySig = new Map();
		for (const k of kids) {
			// Como el extractor: contenedores con contenido; las instancias ya son un componente
			if (k.type === "INSTANCE" || !(k.children || []).length) continue;
			if (VECTOR_TYPES.includes(k.type) || isIconish(k)) continue;
			const s = signature(k);
			if (!bySig.has(s)) bySig.set(s, []);
			bySig.get(s).push(k);
		}
		for (const items of bySig.values())
			if (items.length >= REPEAT_MIN) out.push({ parent: n.name, groups: styleGroups(items) });
		kids.forEach((k) => visit(k, false));
	})(doc, true);
	return out;
}

function styleGroups(items) {
	const byKey = new Map();
	for (const it of items) {
		const k = visualKey(it);
		if (!byKey.has(k)) byKey.set(k, []);
		byKey.get(k).push(it);
	}
	const groups = [...byKey.values()];
	const def = groups.reduce((best, g, i) => (g.length > groups[best].length ? i : best), 0);
	const op = (n) => (n.opacity == null ? 1 : n.opacity);
	const bg = (n) => JSON.stringify(visiblePaints(n.fills));
	const auto = groups.map((g, i) =>
		i === def
			? "default"
			: op(g[0]) < op(groups[def][0])
				? "disabled"
				: g.length === 1 && bg(g[0]) !== bg(groups[def][0])
					? "active"
					: "default",
	);
	const names = [];
	const taken = new Set();
	for (const i of [def, ...groups.keys()].filter((i, k, a) => a.indexOf(i) === k)) {
		let name = auto[i];
		for (let n = 2; taken.has(name); n++) name = `${auto[i]}${n}`;
		taken.add(name);
		names[i] = name;
	}
	return groups.map((g, i) => ({
		auto: names[i],
		ids: g.map((n) => n.id),
		labels: g.map((n) => ownChildText(n) || firstText(n) || n.name),
	}));
}

// Lo que se ve de una capa y su contenido, sin textos ni geometría: el tamaño solo si es fijo, y
// de los íconos solo los colores (su tamaño depende del dibujo, no del estado)
const VISUAL = [
	"fills", "strokes", "strokeWeight", "strokeAlign", "individualStrokeWeights", "opacity", "effects",
	"cornerRadius", "rectangleCornerRadii", "blendMode", "layoutMode", "itemSpacing", "paddingLeft",
	"paddingRight", "paddingTop", "paddingBottom", "primaryAxisAlignItems", "counterAxisAlignItems",
	"styles", "style", "clipsContent",
];
function visualKey(n) {
	if (VECTOR_TYPES.includes(n.type) || isIconish(n)) return JSON.stringify(palette(n));
	const own = {};
	for (const k of VISUAL) if (n[k] !== undefined) own[k] = k === "fills" || k === "strokes" ? visiblePaints(n[k]) : n[k];
	const bb = n.absoluteBoundingBox || {};
	if (n.layoutSizingHorizontal === "FIXED") own.w = Math.round(bb.width * 100);
	if (n.layoutSizingVertical === "FIXED" && n.type !== "TEXT") own.h = Math.round(bb.height * 100);
	return JSON.stringify([own, (n.children || []).filter((c) => c.visible !== false).map(visualKey)]);
}
function palette(n, out = []) {
	if (n.visible === false) return out;
	for (const p of [...visiblePaints(n.fills), ...visiblePaints(n.strokes)])
		out.push(p.type === "SOLID" ? [p.color, p.opacity] : p.type);
	(n.children || []).forEach((c) => palette(c, out));
	return out;
}
function firstText(n) {
	for (const c of n.children || []) {
		const t = ownText(c) || firstText(c);
		if (t) return t;
	}
	return null;
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

	progress("Exportando estructura…");
	// Mismo formato que una entrada de GET /v1/files/:key/nodes
	const entry = await node.exportAsync({ format: "JSON_REST_V1" });
	await addRotationGeometry(entry.document);
	const exportedAt = new Date().toISOString();
	const bundle = {
		figspec: 2,
		name: node.name,
		nodeId: node.id,
		fileKey: figma.fileKey || null, // solo disponible en plugins privados
		exportedAt,
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
	return { bundle, names: namesFile(node, entry, names, exportedAt) };
}

// ---------------------------------------------------------------- archivo de nombres
// Los nombres elegidos en la ventana, en el formato de decisiones (versión 2), para que el
// extractor los combine con las decisiones del proyecto. null si no se eligió ninguno.
// Cada capa: id, nombre en Figma, ruta y fecha. La ruta permite reconocerla si el id cambia (una
// copia del componente): pares [nombre, n] desde la raíz (en un set, desde la variante por
// defecto), con n = posición entre hermanos del mismo nombre, contando las ocultas (como las
// clases del extractor). Entra en las instancias.
function namesFile(node, entry, names, at) {
	let doc = entry.document;
	if (doc.type === "COMPONENT_SET") doc = defaultVariant(doc);
	const info = new Map(); // id → { figma, path }
	(function visit(n, path) {
		info.set(n.id, { figma: n.name, path });
		const seen = new Map();
		for (const c of n.children || []) {
			const k = seen.get(c.name) || 0;
			seen.set(c.name, k + 1);
			visit(c, [...path, [c.name, k]]);
		}
	})(doc, []);
	const entries = (byId) =>
		Object.entries(byId || {})
			.map(([id, v]) => [id, String(v || "").trim()])
			.filter(([id, v]) => v && info.has(id))
			.map(([id, v]) => ({ id, figma: info.get(id).figma, path: info.get(id).path, name: v, at }));
	const layers = entries(names.byId);
	const states = entries(names.states);
	const root = String(names.root || "").trim();
	if (!root && !layers.length && !states.length) return null;
	return {
		figspec: "decisions",
		version: 2,
		origin: "plugin",
		savedAt: at,
		component: { id: node.id, figma: node.name },
		...(root ? { root: { name: root, at } } : {}),
		layers,
		states,
		groups: [],
	};
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
// Un nombre sin letras ("1", "02", "#3") no sirve en código: siempre es vago y la sugerencia gana
function noLetters(name) {
	return !/\p{L}/u.test(String(name || ""));
}

function vagueName(node) {
	if (isGeneric(node.name) || noLetters(node.name)) return true;
	const chars = node.type === "TEXT" ? String(node.characters || "").trim() : null;
	return chars !== null && String(node.name).trim() === chars && !usableText(chars);
}
function suggestName(node, parent, iconLike) {
	// Un texto con nombre sin letras ("1") se nombra por su contenido, si sirve
	if (node.type === "TEXT") return (noLetters(node.name) && usableText(node.characters)) || "text";
	if (iconLike) {
		const near = textNear(node, parent);
		return near ? `${near} Icon` : "icon";
	}
	const role = repeated(node, parent)
		? "Item"
		: { HORIZONTAL: "Row", VERTICAL: "Column" }[node.layoutMode] || "Box";
	const text = ownChildText(node);
	if (text) return `${text} ${role}`;
	// Sin letras en Figma no hay nombre al que volver: el primer texto que sirva, más adentro
	// (en una estadística "2,245,341" + "Members" → membersRow), o solo el rol
	if (noLetters(node.name)) {
		const deep = firstUsableText(node);
		return deep ? `${deep} ${role}` : role.toLowerCase();
	}
	return null;
}

// Primer texto del diseño que sirve de nombre, en profundidad (sin entrar en capas ocultas)
function firstUsableText(node) {
	for (const c of node.children || []) {
		if (c.visible === false) continue;
		const t = ownText(c) || firstUsableText(c);
		if (t) return t;
	}
	return null;
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
