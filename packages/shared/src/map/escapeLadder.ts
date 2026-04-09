import type { WallRect } from "./collision.js";
import { CELL_SIZE, ROOM_HEIGHT } from "./constants.js";
import { generateDoorPlacements } from "./doors.js";
import { layoutRoomMap, type MapLayout } from "./generateLayout.js";
import { mulberry32 } from "./rng.js";

export interface EscapeLadderPlacement {
	id: string;
	x: number;
	z: number;
	/** Chamber roomId containing this ladder. */
	roomId: number;
	/** Interaction range (m). */
	range: number;
	/** Visual/collision footprint. Wide side is always east-west (X). */
	width: number;
	depth: number;
	/** Visual height (m). */
	height: number;
}

const LADDER_ID = "escape_ladder_0";
const LADDER_RANGE = 2.1;
const LADDER_WIDTH_M = 1.05;
const LADDER_DEPTH_M = 0.18;

function hashString(value: string): number {
	let hash = 2166136261 >>> 0;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash >>> 0;
}

function roomDegreeByRoomId(layout: MapLayout): Map<number, number> {
	const roomMap = layoutRoomMap(layout);
	const doors = generateDoorPlacements(layout);
	const deg = new Map<number, number>();
	for (const d of doors) {
		const r1 = roomMap.get(`${d.ix1},${d.iz1}`) ?? 0;
		const r2 = roomMap.get(`${d.ix2},${d.iz2}`) ?? 0;
		// We only care about chamber rooms (1+), and count a connection if it touches another region.
		if (r1 > 0 && r2 !== r1) {
			deg.set(r1, (deg.get(r1) ?? 0) + 1);
		}
		if (r2 > 0 && r1 !== r2) {
			deg.set(r2, (deg.get(r2) ?? 0) + 1);
		}
	}
	return deg;
}

function roomBoundsByRoomId(layout: MapLayout): Map<number, { minIx: number; maxIx: number; minIz: number; maxIz: number }> {
	const bounds = new Map<number, { minIx: number; maxIx: number; minIz: number; maxIz: number }>();
	for (const cell of layout.cells) {
		if (cell.kind !== "chamber" || cell.roomId <= 0) {
			continue;
		}
		const existing = bounds.get(cell.roomId);
		if (!existing) {
			bounds.set(cell.roomId, { minIx: cell.ix, maxIx: cell.ix, minIz: cell.iz, maxIz: cell.iz });
			continue;
		}
		existing.minIx = Math.min(existing.minIx, cell.ix);
		existing.maxIx = Math.max(existing.maxIx, cell.ix);
		existing.minIz = Math.min(existing.minIz, cell.iz);
		existing.maxIz = Math.max(existing.maxIz, cell.iz);
	}
	return bounds;
}

/**
 * Deterministically pick exactly one *leaf* chamber room (degree 1) and place a ladder at its center.
 * If no leaf rooms exist (rare), fall back to the smallest-numbered chamber room.
 */
export function generateEscapeLadderPlacement(layout: MapLayout): EscapeLadderPlacement | null {
	const deg = roomDegreeByRoomId(layout);
	const bounds = roomBoundsByRoomId(layout);
	const chamberRoomIds = [...bounds.keys()].sort((a, b) => a - b);
	if (chamberRoomIds.length === 0) {
		return null;
	}
	const leafRoomIds = chamberRoomIds.filter((roomId) => (deg.get(roomId) ?? 0) === 1);
	const candidates = leafRoomIds.length > 0 ? leafRoomIds : chamberRoomIds;

	const seedHash = hashString(`${layout.seed}:escape_ladder`);
	const rng = mulberry32((layout.seed ^ seedHash) >>> 0);
	const chosenRoomId = candidates[Math.floor(rng() * candidates.length)] ?? candidates[0]!;
	const b = bounds.get(chosenRoomId)!;

	// Place at chamber AABB center (in cell units).
	const cx = (b.minIx + b.maxIx) / 2;
	const cz = (b.minIz + b.maxIz) / 2;

	return {
		id: LADDER_ID,
		x: cx * CELL_SIZE,
		z: cz * CELL_SIZE,
		roomId: chosenRoomId,
		range: LADDER_RANGE,
		width: LADDER_WIDTH_M,
		depth: LADDER_DEPTH_M,
		height: ROOM_HEIGHT,
	};
}

export function buildEscapeLadderCollisionWalls(
	placements: Iterable<Pick<EscapeLadderPlacement, "x" | "z" | "width" | "depth">>,
): WallRect[] {
	const walls: WallRect[] = [];
	for (const p of placements) {
		const hw = p.width * 0.5;
		const hd = p.depth * 0.5;
		walls.push({
			minX: p.x - hw,
			maxX: p.x + hw,
			minZ: p.z - hd,
			maxZ: p.z + hd,
		});
	}
	return walls;
}

