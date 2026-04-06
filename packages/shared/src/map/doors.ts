import {
	DEFAULT_WALL_THICKNESS,
	type WallRect,
} from "./collision.js";
import { CELL_SIZE } from "./constants.js";
import { computeDecorIds } from "./decor.js";
import { canonicalEdgeKey, layoutRoomMap, type MapLayout } from "./generateLayout.js";

export type DoorVariant = "double" | "single";
export type DoorFacing = "x" | "z";
export type DoorHingeSide = "left" | "right";
export type DoorAdjacentKind = "center" | "hall" | "chamber";

export interface DoorPlacement {
	id: string;
	edgeKey: string;
	x: number;
	z: number;
	ix1: number;
	iz1: number;
	ix2: number;
	iz2: number;
	facing: DoorFacing;
	variant: DoorVariant;
	range: number;
	hingeSide: DoorHingeSide;
	side1Kind: DoorAdjacentKind;
	side2Kind: DoorAdjacentKind;
	side1FloorStyle: number;
	side2FloorStyle: number;
	side1WallStyle: number;
	side2WallStyle: number;
}

const DOOR_RANGE = 3.1;

function hashString(value: string): number {
	let hash = 2166136261 >>> 0;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash >>> 0;
}

export function generateDoorPlacements(layout: MapLayout): DoorPlacement[] {
	const cells = new Map(layout.cells.map((cell) => [`${cell.ix},${cell.iz}`, cell]));
	const roomMap = layoutRoomMap(layout);
	const decorIds = computeDecorIds(layout);
	const placements: DoorPlacement[] = [];

	for (const edgeKey of layout.doorEdgeKeys) {
		const [partA, partB] = edgeKey.split("|");
		if (!partA || !partB) {
			continue;
		}
		const [ix1, iz1] = partA.split(",").map(Number);
		const [ix2, iz2] = partB.split(",").map(Number);
		const cell1 = cells.get(`${ix1},${iz1}`);
		const cell2 = cells.get(`${ix2},${iz2}`);
		if (!cell1 || !cell2) {
			continue;
		}
		if (cell1.roomId === cell2.roomId) {
			continue;
		}
		if (cell1.kind === "hall" && cell2.kind === "hall") {
			continue;
		}

		const variant: DoorVariant = cell1.kind === "hall" || cell2.kind === "hall" ? "double" : "single";
		const facing: DoorFacing = ix1 !== ix2 ? "x" : "z";
		const x = ((ix1 + ix2) / 2) * CELL_SIZE;
		const z = ((iz1 + iz2) / 2) * CELL_SIZE;
		const edgeHash = hashString(`${layout.seed}:${edgeKey}`);
		const hingeSide: DoorHingeSide = edgeHash % 2 === 0 ? "left" : "right";

		const side1RoomId = roomMap.get(`${ix1},${iz1}`);
		const side2RoomId = roomMap.get(`${ix2},${iz2}`);
		if (side1RoomId === undefined || side2RoomId === undefined) {
			continue;
		}

		placements.push({
			id: `door_${ix1}_${iz1}_${ix2}_${iz2}`,
			edgeKey: canonicalEdgeKey(ix1, iz1, ix2, iz2),
			x,
			z,
			ix1,
			iz1,
			ix2,
			iz2,
			facing,
			variant,
			range: DOOR_RANGE,
			hingeSide,
			side1Kind: cell1.kind,
			side2Kind: cell2.kind,
			side1FloorStyle: decorIds.floorStyleByCell.get(`${ix1},${iz1}`) ?? 0,
			side2FloorStyle: decorIds.floorStyleByCell.get(`${ix2},${iz2}`) ?? 0,
			side1WallStyle: decorIds.wallStyleByCell.get(`${ix1},${iz1}`) ?? 0,
			side2WallStyle: decorIds.wallStyleByCell.get(`${ix2},${iz2}`) ?? 0,
		});
	}

	return placements.sort((a, b) => a.id.localeCompare(b.id));
}

export function buildClosedDoorWalls(
	doors: Iterable<Pick<DoorPlacement, "x" | "z" | "facing"> & { isOpen: boolean }>,
	wallThickness = DEFAULT_WALL_THICKNESS,
): WallRect[] {
	const halfCell = CELL_SIZE / 2;
	const halfThickness = wallThickness / 2;
	const walls: WallRect[] = [];
	for (const door of doors) {
		if (door.isOpen) {
			continue;
		}
		if (door.facing === "x") {
			walls.push({
				minX: door.x - halfThickness,
				maxX: door.x + halfThickness,
				minZ: door.z - halfCell,
				maxZ: door.z + halfCell,
			});
			continue;
		}
		walls.push({
			minX: door.x - halfCell,
			maxX: door.x + halfCell,
			minZ: door.z - halfThickness,
			maxZ: door.z + halfThickness,
		});
	}
	return walls;
}
