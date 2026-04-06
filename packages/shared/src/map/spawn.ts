import { CELL_SIZE, INITIAL_ROOM_HALF_CELLS } from "./constants.js";
import { mulberry32 } from "./rng.js";
import { VAULT_TILE_IX, VAULT_TILE_IZ } from "./vaults.js";

function hashString(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** Random point inside the starting room (margin from edges) for a given session. */
export function spawnInCenterHub(mapSeed: number, sessionId: string): { x: number; z: number } {
	const rng = mulberry32((mapSeed ^ hashString(sessionId)) >>> 0);
	const half = INITIAL_ROOM_HALF_CELLS * CELL_SIZE - 0.6;
	for (let i = 0; i < 32; i++) {
		const x = (rng() * 2 - 1) * half;
		const z = (rng() * 2 - 1) * half;
		const ix = Math.round(x / CELL_SIZE);
		const iz = Math.round(z / CELL_SIZE);
		if (ix === VAULT_TILE_IX && iz === VAULT_TILE_IZ) {
			continue;
		}
		return { x, z };
	}
	return { x: 0, z: 0 };
}
