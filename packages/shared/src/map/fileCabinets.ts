import type { WallRect } from "./collision.js";
import { CELL_SIZE } from "./constants.js";
import { generateDoorPlacements, type DoorPlacement } from "./doors.js";
import { layoutRoomMap, type MapLayout } from "./generateLayout.js";
import { mulberry32 } from "./rng.js";

export type FileCabinetFacing = "north" | "south" | "west" | "east";

export interface FileCabinetPlacement {
	id: string;
	x: number;
	z: number;
	/** Rotates the cabinet so drawers face away from the wall. */
	facing: FileCabinetFacing;
	width: number;
	height: number;
	depth: number;
	drawerCount: number;
	roomId: number;
	range: number;
}

/** Depth into the room (m): ~⅓ deeper than the original 0.4m so the carcass reads further from the wall. */
const CABINET_DEPTH_M = (0.4 * 4) / 3;
const CABINET_RANGE = 2.4;

/** Min distance from cabinet center to a door world position (m). */
const DOOR_CLEARANCE_M = 1.45;
/** Min distance between any two cabinet centers (m). */
const MIN_CABINET_CENTER_SEP_M = 1.18;

function hashString(value: string): number {
	let hash = 2166136261 >>> 0;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash >>> 0;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function drawerCountForHeight(heightM: number): number {
	const approx = Math.round(heightM / 0.45);
	return clamp(Math.max(3, approx), 3, 8);
}

function distSq(ax: number, az: number, bx: number, bz: number): number {
	const dx = ax - bx;
	const dz = az - bz;
	return dx * dx + dz * dz;
}

function doorIsRelevantToRoom(d: DoorPlacement, roomId: number, roomMap: Map<string, number>): boolean {
	const r1 = roomMap.get(`${d.ix1},${d.iz1}`);
	const r2 = roomMap.get(`${d.ix2},${d.iz2}`);
	return r1 === roomId || r2 === roomId;
}

type WallCandidate = { x: number; z: number; facing: FileCabinetFacing };

function collectWallCandidates(
	minIx: number,
	maxIx: number,
	minIz: number,
	maxIz: number,
): WallCandidate[] {
	const out: WallCandidate[] = [];
	const northZ = (minIz - 0.5) * CELL_SIZE + CABINET_DEPTH_M / 2;
	const southZ = (maxIz + 0.5) * CELL_SIZE - CABINET_DEPTH_M / 2;
	const westX = (minIx - 0.5) * CELL_SIZE + CABINET_DEPTH_M / 2;
	const eastX = (maxIx + 0.5) * CELL_SIZE - CABINET_DEPTH_M / 2;
	for (let ix = minIx; ix <= maxIx; ix++) {
		out.push({ x: ix * CELL_SIZE, z: northZ, facing: "south" });
		out.push({ x: ix * CELL_SIZE, z: southZ, facing: "north" });
	}
	for (let iz = minIz; iz <= maxIz; iz++) {
		out.push({ x: westX, z: iz * CELL_SIZE, facing: "east" });
		out.push({ x: eastX, z: iz * CELL_SIZE, facing: "west" });
	}
	return out;
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[arr[i], arr[j]] = [arr[j]!, arr[i]!];
	}
}

export function generateFileCabinetPlacements(layout: MapLayout): FileCabinetPlacement[] {
	const cellsByRoom = new Map<number, { ix: number; iz: number }[]>();
	for (const cell of layout.cells) {
		if (cell.kind !== "chamber" || cell.roomId <= 0) {
			continue;
		}
		const list = cellsByRoom.get(cell.roomId) ?? [];
		list.push({ ix: cell.ix, iz: cell.iz });
		cellsByRoom.set(cell.roomId, list);
	}

	const roomIds = [...cellsByRoom.keys()].sort((a, b) => a - b);
	if (roomIds.length === 0) {
		return [];
	}

	const roomMap = layoutRoomMap(layout);
	const doors = generateDoorPlacements(layout);
	const doorClearanceSq = DOOR_CLEARANCE_M * DOOR_CLEARANCE_M;
	const minSepSq = MIN_CABINET_CENTER_SEP_M * MIN_CABINET_CENTER_SEP_M;

	const placements: FileCabinetPlacement[] = [];
	/** All accepted cabinet centers so far (cross-room) to prevent stacking. */
	const acceptedCenters: { x: number; z: number }[] = [];

	for (const roomId of roomIds) {
		const roomCells = cellsByRoom.get(roomId);
		if (!roomCells || roomCells.length === 0) {
			continue;
		}
		let minIx = Infinity;
		let maxIx = -Infinity;
		let minIz = Infinity;
		let maxIz = -Infinity;
		for (const cell of roomCells) {
			minIx = Math.min(minIx, cell.ix);
			maxIx = Math.max(maxIx, cell.ix);
			minIz = Math.min(minIz, cell.iz);
			maxIz = Math.max(maxIz, cell.iz);
		}

		const baseHash = hashString(`${layout.seed}:file_cabinet:${roomId}`);
		const rng = mulberry32((layout.seed ^ baseHash) >>> 0);
		const roomDoors = doors.filter((d) => doorIsRelevantToRoom(d, roomId, roomMap));

		let candidates = collectWallCandidates(minIx, maxIx, minIz, maxIz);
		candidates = candidates.filter((c) => {
			for (const d of roomDoors) {
				if (distSq(c.x, c.z, d.x, d.z) < doorClearanceSq) {
					return false;
				}
			}
			return true;
		});

		shuffleInPlace(candidates, rng);

		const wantCount = 1 + Math.floor(rng() * 3);
		const chosen: WallCandidate[] = [];
		for (const c of candidates) {
			const okGlobal = acceptedCenters.every((p) => distSq(c.x, c.z, p.x, p.z) >= minSepSq);
			const okLocal = chosen.every((p) => distSq(c.x, c.z, p.x, p.z) >= minSepSq);
			if (okGlobal && okLocal) {
				chosen.push(c);
			}
			if (chosen.length >= wantCount) {
				break;
			}
		}

		for (let index = 0; index < chosen.length; index++) {
			const c = chosen[index]!;
			const width = 0.5 + rng() * (2 - 0.5);
			const height = 1 + rng() * (2.5 - 1);
			const drawerCount = drawerCountForHeight(height);
			acceptedCenters.push({ x: c.x, z: c.z });
			placements.push({
				id: `file_cabinet_${roomId}_${index}`,
				x: c.x,
				z: c.z,
				facing: c.facing,
				width,
				height,
				depth: CABINET_DEPTH_M,
				drawerCount,
				roomId,
				range: CABINET_RANGE,
			});
		}
	}

	return placements.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Axis-aligned footprint for movement collision (matches oriented box: width × depth in XZ).
 */
export function buildFileCabinetCollisionWalls(
	placements: Iterable<Pick<FileCabinetPlacement, "x" | "z" | "width" | "depth" | "facing">>,
): WallRect[] {
	const walls: WallRect[] = [];
	for (const p of placements) {
		const hw = p.width * 0.5;
		const hd = p.depth * 0.5;
		if (p.facing === "east" || p.facing === "west") {
			walls.push({
				minX: p.x - hd,
				maxX: p.x + hd,
				minZ: p.z - hw,
				maxZ: p.z + hw,
			});
		} else {
			walls.push({
				minX: p.x - hw,
				maxX: p.x + hw,
				minZ: p.z - hd,
				maxZ: p.z + hd,
			});
		}
	}
	return walls;
}
