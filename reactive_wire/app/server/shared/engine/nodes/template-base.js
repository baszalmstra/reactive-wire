/** Build a NodeData at the origin from a node's intrinsic shape, leaving id/position to the caller. */
export const base = (id, partial) => ({
    id,
    x: 0,
    y: 0,
    ...partial,
});
