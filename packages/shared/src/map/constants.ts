/** Horizontal grid step (meters). */
export const CELL_SIZE = 2.5;

/** Default vertical room height (meters). */
export const ROOM_HEIGHT = 3;

/** Center hub: circular floor radius (meters); diameter ≈ 10m. */
export const CENTER_RADIUS = 5;

/**
 * Half-size of the initial carved room in grid cells (inclusive: `-n..n` → `2n+1` wide).
 * Used by Tyrant-style dungeon growth and spawn placement.
 */
export const INITIAL_ROOM_HALF_CELLS = 2;

/** Kind of cell for visuals / logic. */
export type CellKind = "center" | "hall" | "chamber";
