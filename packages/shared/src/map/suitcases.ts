import { CELL_SIZE } from "./constants.js";
import { mulberry32 } from "./rng.js";
import type { MapLayout } from "./generateLayout.js";

export interface SuitcasePlacement {
	id: string;
	x: number;
	z: number;
	ix: number;
	iz: number;
	roomId: number;
	range: number;
}

const SUITCASE_ID = "suitcase_primary";
const SUITCASE_RANGE = 2.25;

function hashString(value: string): number {
	let hash = 2166136261 >>> 0;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash >>> 0;
}

export function generateSuitcasePlacements(layout: MapLayout): SuitcasePlacement[] {
	const cellsByRoom = new Map<number, { ix: number; iz: number }[]>();
	for (const cell of layout.cells) {
		if (cell.roomId <= 0) {
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
	const baseHash = hashString(`${layout.seed}:${SUITCASE_ID}`);
	const chosenRoomId = roomIds[baseHash % roomIds.length]!;
	const roomCells = cellsByRoom.get(chosenRoomId)!;
	const rng = mulberry32((layout.seed ^ baseHash) >>> 0);
	const cell = roomCells[Math.floor(rng() * roomCells.length)]!;
	const offsetScale = CELL_SIZE * 0.22;
	const x = cell.ix * CELL_SIZE + (rng() * 2 - 1) * offsetScale;
	const z = cell.iz * CELL_SIZE + (rng() * 2 - 1) * offsetScale;

	return [
		{
			id: SUITCASE_ID,
			x,
			z,
			ix: cell.ix,
			iz: cell.iz,
			roomId: chosenRoomId,
			range: SUITCASE_RANGE,
		},
	];
}
