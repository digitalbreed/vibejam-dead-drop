import { CELL_SIZE } from "./constants.js";
import { mulberry32 } from "./rng.js";
import type { MapLayout } from "./generateLayout.js";

export type KeycardColor = "blue" | "red";

export interface KeycardPlacement {
	id: string;
	color: KeycardColor;
	x: number;
	z: number;
	ix: number;
	iz: number;
	roomId: number;
	range: number;
}

const KEYCARD_RANGE = 2.2;
const KEYCARD_COLORS: readonly KeycardColor[] = ["blue", "red"] as const;

function hashString(value: string): number {
	let hash = 2166136261 >>> 0;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash >>> 0;
}

function idForColor(color: KeycardColor): string {
	return `keycard_${color}`;
}

export function generateKeycardPlacements(layout: MapLayout): KeycardPlacement[] {
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

	const usedRoomIds = new Set<number>();
	const placements: KeycardPlacement[] = [];

	for (const color of KEYCARD_COLORS) {
		const id = idForColor(color);
		const baseHash = hashString(`${layout.seed}:${color}`);
		let chosenRoomId = roomIds[baseHash % roomIds.length]!;
		if (usedRoomIds.has(chosenRoomId) && usedRoomIds.size < roomIds.length) {
			for (let i = 1; i < roomIds.length; i++) {
				const candidate = roomIds[(baseHash + i) % roomIds.length]!;
				if (!usedRoomIds.has(candidate)) {
					chosenRoomId = candidate;
					break;
				}
			}
		}
		usedRoomIds.add(chosenRoomId);

		const roomCells = cellsByRoom.get(chosenRoomId)!;
		const rng = mulberry32((layout.seed ^ baseHash) >>> 0);
		const cell = roomCells[Math.floor(rng() * roomCells.length)]!;
		const offsetScale = CELL_SIZE * 0.24;
		const x = cell.ix * CELL_SIZE + (rng() * 2 - 1) * offsetScale;
		const z = cell.iz * CELL_SIZE + (rng() * 2 - 1) * offsetScale;
		placements.push({
			id,
			color,
			x,
			z,
			ix: cell.ix,
			iz: cell.iz,
			roomId: chosenRoomId,
			range: KEYCARD_RANGE,
		});
	}

	return placements.sort((a, b) => a.id.localeCompare(b.id));
}
