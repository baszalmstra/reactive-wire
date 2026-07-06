const HEADER_H = 40;
const PAD_T = 10;
const ROW = 28;
const PAD_B = 12;
/** Node width and height, and the vertical centre of each pin row. */
export function nodeGeom(n) {
    const w = n.w ?? 210;
    const rows = Math.max(n.inputs.length, n.outputs.length);
    const extra = n.bodyExtra ?? 0;
    const h = HEADER_H + PAD_T + rows * ROW + extra + PAD_B;
    const cy = (i) => HEADER_H + PAD_T + ROW * i + ROW / 2;
    return {
        w,
        h,
        rows,
        inputs: n.inputs.map((p, i) => ({ ...p, cx: 0, cy: cy(i) })),
        outputs: n.outputs.map((p, i) => ({ ...p, cx: w, cy: cy(i) })),
    };
}
