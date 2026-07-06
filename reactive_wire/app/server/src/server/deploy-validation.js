const VALUE_TYPES = new Set(["bool", "num", "str", "color", "duration", "datetime", "any"]);
const MAX_NODES = 1_000;
const MAX_EDGES = 4_000;
const MAX_MACROS = 100;
const MAX_PINS = 64;
const MAX_RECORD_KEYS = 200;
const SAFE_KEY = /^(?!(__proto__|prototype|constructor)$).{1,200}$/;
function isRecord(v) {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}
function asString(v, fallback = "", max = 240) {
    const s = typeof v === "string" ? v : fallback;
    return s.slice(0, max);
}
function asNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}
function safeJson(v, depth = 0) {
    if (v == null || typeof v === "string" || typeof v === "number" || typeof v === "boolean")
        return v;
    if (depth >= 6)
        return null;
    if (Array.isArray(v))
        return v.slice(0, 200).map((x) => safeJson(x, depth + 1));
    if (!isRecord(v))
        return null;
    const out = {};
    let count = 0;
    for (const [k, val] of Object.entries(v)) {
        if (!SAFE_KEY.test(k))
            continue;
        if (count++ >= MAX_RECORD_KEYS)
            break;
        out[k] = safeJson(val, depth + 1);
    }
    return out;
}
function safeRecord(v) {
    return isRecord(v) ? safeJson(v) : {};
}
function sanitizePins(raw, label) {
    if (raw === undefined)
        return [];
    if (!Array.isArray(raw))
        throw new Error(`${label} must be an array`);
    if (raw.length > MAX_PINS)
        throw new Error(`${label} has too many pins`);
    return raw.map((p, i) => {
        if (!isRecord(p))
            throw new Error(`${label}[${i}] must be an object`);
        const id = asString(p.id).trim();
        if (!id)
            throw new Error(`${label}[${i}].id must be a non-empty string`);
        const rawType = asString(p.type, "any");
        const type = VALUE_TYPES.has(rawType) ? rawType : "any";
        const pin = { id, label: asString(p.label, id), type };
        if (typeof p.unit === "string")
            pin.unit = p.unit.slice(0, 40);
        if (typeof p.variadic === "boolean")
            pin.variadic = p.variadic;
        if (typeof p.ghost === "boolean")
            pin.ghost = p.ghost;
        if (typeof p.missing === "string")
            pin.missing = p.missing.slice(0, 240);
        if (typeof p.editable === "boolean")
            pin.editable = p.editable;
        return pin;
    });
}
function sanitizeNode(raw, index) {
    if (!isRecord(raw))
        throw new Error(`nodes[${index}] must be an object`);
    const id = asString(raw.id).trim();
    const type = asString(raw.type).trim();
    if (!id)
        throw new Error(`nodes[${index}].id must be a non-empty string`);
    if (!type)
        throw new Error(`nodes[${index}].type must be a non-empty string`);
    const node = {
        id,
        type,
        title: asString(raw.title, type),
        subtitle: asString(raw.subtitle, ""),
        icon: asString(raw.icon, "const"),
        x: asNumber(raw.x),
        y: asNumber(raw.y),
        inputs: sanitizePins(raw.inputs, `nodes[${index}].inputs`),
        outputs: sanitizePins(raw.outputs, `nodes[${index}].outputs`),
    };
    if (typeof raw.stateful === "boolean")
        node.stateful = raw.stateful;
    if (raw.config !== undefined)
        node.config = safeRecord(raw.config);
    if (raw.values !== undefined)
        node.values = safeRecord(raw.values);
    if (Number.isFinite(Number(raw.w)) && Number(raw.w) > 0)
        node.w = asNumber(raw.w);
    if (Number.isFinite(Number(raw.bodyExtra)) && Number(raw.bodyExtra) >= 0)
        node.bodyExtra = asNumber(raw.bodyExtra);
    if (raw.widget === "color" || raw.widget === "sink")
        node.widget = raw.widget;
    if (Array.isArray(raw.typeGroup))
        node.typeGroup = raw.typeGroup.map((x) => asString(x).trim()).filter(Boolean).slice(0, MAX_PINS);
    return node;
}
function sanitizeEdges(raw, nodeIds, label = "edges") {
    if (raw === undefined)
        return [];
    if (!Array.isArray(raw))
        throw new Error(`${label} must be an array`);
    if (raw.length > MAX_EDGES)
        throw new Error(`${label} has too many entries`);
    return raw.map((e, i) => {
        if (!isRecord(e) || !isRecord(e.from) || !isRecord(e.to))
            throw new Error(`${label}[${i}] must have from/to objects`);
        const fromNode = asString(e.from.node).trim();
        const fromPin = asString(e.from.pin).trim();
        const toNode = asString(e.to.node).trim();
        const toPin = asString(e.to.pin).trim();
        if (!fromNode || !fromPin || !toNode || !toPin)
            throw new Error(`${label}[${i}] endpoints must name node and pin`);
        if (!nodeIds.has(fromNode) || !nodeIds.has(toNode))
            throw new Error(`${label}[${i}] references an unknown node`);
        return {
            id: asString(e.id, `${fromNode}:${fromPin}->${toNode}:${toPin}`),
            from: { node: fromNode, pin: fromPin },
            to: { node: toNode, pin: toPin },
        };
    });
}
function sanitizeGraph(raw, label = "graph") {
    if (!Array.isArray(raw.nodes))
        throw new Error(`${label}.nodes must be an array`);
    if (raw.nodes.length > MAX_NODES)
        throw new Error(`${label}.nodes has too many entries`);
    const nodes = raw.nodes.map((n, i) => sanitizeNode(n, i));
    const ids = new Set();
    for (const n of nodes) {
        if (ids.has(n.id))
            throw new Error(`${label}.nodes contains duplicate id ${JSON.stringify(n.id)}`);
        ids.add(n.id);
    }
    const edges = sanitizeEdges(raw.edges, ids, `${label}.edges`);
    return { nodes, edges };
}
function sanitizeMacro(key, raw) {
    if (!isRecord(raw))
        throw new Error(`macros.${key} must be an object`);
    const id = asString(raw.id, key).trim();
    if (!id)
        throw new Error(`macros.${key}.id must be a non-empty string`);
    const { nodes, edges } = sanitizeGraph(raw, `macros.${key}`);
    return {
        id,
        name: asString(raw.name, id),
        inputs: sanitizePins(raw.inputs, `macros.${key}.inputs`),
        outputs: sanitizePins(raw.outputs, `macros.${key}.outputs`),
        nodes,
        edges,
        stateful: typeof raw.stateful === "boolean" ? raw.stateful : nodes.some((n) => n.stateful),
    };
}
export function sanitizeDeployRequest(raw) {
    try {
        if (!isRecord(raw))
            return { ok: false, error: "Deploy graph must be an object" };
        const { nodes, edges } = sanitizeGraph(raw);
        let macros;
        if (raw.macros !== undefined) {
            if (!isRecord(raw.macros))
                throw new Error("graph.macros must be an object");
            const entries = Object.entries(raw.macros);
            if (entries.length > MAX_MACROS)
                throw new Error("graph.macros has too many entries");
            macros = {};
            for (const [key, value] of entries) {
                if (!SAFE_KEY.test(key))
                    continue;
                const macro = sanitizeMacro(key, value);
                macros[macro.id] = macro;
            }
        }
        return { ok: true, graph: { nodes, edges, ...(macros ? { macros } : {}) } };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
