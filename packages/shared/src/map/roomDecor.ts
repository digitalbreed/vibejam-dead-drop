import type { WallRect } from "./collision.js";
import { CELL_SIZE } from "./constants.js";
import { canonicalEdgeKey, layoutOccupancy, layoutRoomMap, type MapLayout } from "./generateLayout.js";
import { mulberry32 } from "./rng.js";
import { VAULT_TILE_IX, VAULT_TILE_IZ } from "./vaults.js";

export type TableRotationQuarter = 0 | 1 | 2 | 3;
export type FrameWallSide = "north" | "west" | "east";

export interface TablePlacement {
	id: string;
	roomId: number;
	ix: number;
	iz: number;
	x: number;
	z: number;
	rotationQuarter: TableRotationQuarter;
	width: number;
	depth: number;
	height: number;
	legThickness: number;
	plateThickness: number;
}

export interface PaperPlacement {
	id: string;
	roomId: number;
	ix: number;
	iz: number;
	x: number;
	z: number;
	rotationRad: number;
	width: number;
	height: number;
}

export interface PictureFramePlacement {
	id: string;
	roomId: number;
	ix: number;
	iz: number;
	x: number;
	z: number;
	wall: FrameWallSide;
	portraitIndex: number;
}

export interface RoomDecorPlacements {
	tables: TablePlacement[];
	papers: PaperPlacement[];
	frames: PictureFramePlacement[];
}

const TABLE_WIDTH_M = 1.35;
const TABLE_DEPTH_M = 0.9;
const TABLE_HEIGHT_M = 0.78;
const TABLE_LEG_THICKNESS_M = 0.12;
const TABLE_PLATE_THICKNESS_M = 0.08;

const PAPER_WIDTH_M = 0.3;
const PAPER_HEIGHT_M = 0.42;
const PAPER_CLUSTER_JITTER_M = 0.62;
const PAPER_TILE_JITTER_M = 0.36;
const PAPER_MIN_SEPARATION_M = 0.26;

const FRAME_INSET_M = 0.08;
const NORTH_FRAME_CHANCE = 0.6;
const SIDE_FRAME_CHANCE = 0.15;

function hashString(value: string): number {
	let hash = 2166136261 >>> 0;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash >>> 0;
}

function randomInt(rng: () => number, minInclusive: number, maxInclusive: number): number {
	return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

function cellKey(ix: number, iz: number): string {
	return `${ix},${iz}`;
}

function boundaryHasWall(
	ix: number,
	iz: number,
	nx: number,
	nz: number,
	roomId: number,
	occupancy: Set<string>,
	roomByCell: Map<string, number>,
	doorEdges: Set<string>,
): boolean {
	const neighborKey = cellKey(nx, nz);
	if (!occupancy.has(neighborKey)) {
		return true;
	}
	if (roomByCell.get(neighborKey) === roomId) {
		return false;
	}
	return !doorEdges.has(canonicalEdgeKey(ix, iz, nx, nz));
}

function rotationIsQuarterOdd(rotationQuarter: TableRotationQuarter): boolean {
	return rotationQuarter === 1 || rotationQuarter === 3;
}

function isVaultTableBlockedTile(ix: number, iz: number): boolean {
	// Keep the vault cell and its immediate front approach clear.
	return (ix === VAULT_TILE_IX && iz === VAULT_TILE_IZ) || (ix === VAULT_TILE_IX && iz === VAULT_TILE_IZ + 1);
}

function isVaultBackNorthWall(ix: number, iz: number): boolean {
	// North walls on the vault-back line at vault X.
	return ix === VAULT_TILE_IX && (iz === VAULT_TILE_IZ || iz === VAULT_TILE_IZ - 1);
}

export function generateRoomDecorPlacements(layout: MapLayout): RoomDecorPlacements {
	const occupancy = layoutOccupancy(layout);
	const roomByCell = layoutRoomMap(layout);
	const doorEdges = new Set(layout.doorEdgeKeys);
	const cellsByRoom = new Map<number, { ix: number; iz: number }[]>();

	for (const cell of layout.cells) {
		if (cell.kind === "hall" || cell.roomId < 0) {
			continue;
		}
		const bucket = cellsByRoom.get(cell.roomId) ?? [];
		bucket.push({ ix: cell.ix, iz: cell.iz });
		cellsByRoom.set(cell.roomId, bucket);
	}

	const roomIds = [...cellsByRoom.keys()].sort((a, b) => a - b);
	const tables: TablePlacement[] = [];
	const papers: PaperPlacement[] = [];
	type FrameCandidate = {
		roomId: number;
		ix: number;
		iz: number;
		x: number;
		z: number;
		wall: FrameWallSide;
	};
	const frameCandidates: FrameCandidate[] = [];

	for (const roomId of roomIds) {
		const roomCells = cellsByRoom.get(roomId);
		if (!roomCells || roomCells.length === 0) {
			continue;
		}
		const rng = mulberry32((layout.seed ^ hashString(`room_decor:${roomId}`)) >>> 0);

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

		const roomWidthCells = maxIx - minIx + 1;
		const roomHeightCells = maxIz - minIz + 1;
		const sortedRoomCells = [...roomCells].sort((a, b) => (a.iz - b.iz) || (a.ix - b.ix));

		const innerTiles = sortedRoomCells.filter((cell) => {
			const north = roomByCell.get(cellKey(cell.ix, cell.iz - 1)) === roomId;
			const south = roomByCell.get(cellKey(cell.ix, cell.iz + 1)) === roomId;
			const west = roomByCell.get(cellKey(cell.ix - 1, cell.iz)) === roomId;
			const east = roomByCell.get(cellKey(cell.ix + 1, cell.iz)) === roomId;
			return north && south && west && east;
		});

		if (roomWidthCells > 3 && roomHeightCells > 3 && innerTiles.length > 0) {
			const tableTiles = innerTiles.filter((tile) => !isVaultTableBlockedTile(tile.ix, tile.iz));
			if (tableTiles.length === 0) {
				continue;
			}
			const tile = tableTiles[Math.floor(rng() * tableTiles.length)]!;
			const rotationQuarter = randomInt(rng, 0, 3) as TableRotationQuarter;
			tables.push({
				id: `table_${roomId}`,
				roomId,
				ix: tile.ix,
				iz: tile.iz,
				x: tile.ix * CELL_SIZE,
				z: tile.iz * CELL_SIZE,
				rotationQuarter,
				width: TABLE_WIDTH_M,
				depth: TABLE_DEPTH_M,
				height: TABLE_HEIGHT_M,
				legThickness: TABLE_LEG_THICKNESS_M,
				plateThickness: TABLE_PLATE_THICKNESS_M,
			});
		}

		const paperAnchor = (innerTiles.length > 0 ? innerTiles : sortedRoomCells)[Math.floor(rng() * (innerTiles.length > 0 ? innerTiles.length : sortedRoomCells.length))]!;
		const anchorX = paperAnchor.ix * CELL_SIZE + (rng() - 0.5) * PAPER_TILE_JITTER_M;
		const anchorZ = paperAnchor.iz * CELL_SIZE + (rng() - 0.5) * PAPER_TILE_JITTER_M;
		const paperCount = randomInt(rng, 1, 5);
		const paperPoints: Array<{ x: number; z: number }> = [];
		for (let paperIndex = 0; paperIndex < paperCount; paperIndex++) {
			let px = anchorX + (rng() - 0.5) * PAPER_CLUSTER_JITTER_M;
			let pz = anchorZ + (rng() - 0.5) * PAPER_CLUSTER_JITTER_M;
			for (let attempt = 0; attempt < 8; attempt++) {
				const ok = paperPoints.every((point) => {
					const dx = px - point.x;
					const dz = pz - point.z;
					return dx * dx + dz * dz >= PAPER_MIN_SEPARATION_M * PAPER_MIN_SEPARATION_M;
				});
				if (ok) {
					break;
				}
				px = anchorX + (rng() - 0.5) * PAPER_CLUSTER_JITTER_M;
				pz = anchorZ + (rng() - 0.5) * PAPER_CLUSTER_JITTER_M;
			}
			paperPoints.push({ x: px, z: pz });
			papers.push({
				id: `paper_${roomId}_${paperIndex}`,
				roomId,
				ix: paperAnchor.ix,
				iz: paperAnchor.iz,
				x: px,
				z: pz,
				rotationRad: (rng() * Math.PI * 2) - Math.PI,
				width: PAPER_WIDTH_M,
				height: PAPER_HEIGHT_M,
			});
		}

		for (const cell of sortedRoomCells) {
			if (
				boundaryHasWall(cell.ix, cell.iz, cell.ix, cell.iz - 1, roomId, occupancy, roomByCell, doorEdges) &&
				!isVaultBackNorthWall(cell.ix, cell.iz)
			) {
				frameCandidates.push({
					roomId,
					ix: cell.ix,
					iz: cell.iz,
					x: cell.ix * CELL_SIZE,
					z: (cell.iz - 0.5) * CELL_SIZE + FRAME_INSET_M,
					wall: "north",
				});
			}
			if (
				boundaryHasWall(cell.ix, cell.iz, cell.ix - 1, cell.iz, roomId, occupancy, roomByCell, doorEdges)
			) {
				frameCandidates.push({
					roomId,
					ix: cell.ix,
					iz: cell.iz,
					x: (cell.ix - 0.5) * CELL_SIZE + FRAME_INSET_M,
					z: cell.iz * CELL_SIZE,
					wall: "west",
				});
			}
			if (
				boundaryHasWall(cell.ix, cell.iz, cell.ix + 1, cell.iz, roomId, occupancy, roomByCell, doorEdges)
			) {
				frameCandidates.push({
					roomId,
					ix: cell.ix,
					iz: cell.iz,
					x: (cell.ix + 0.5) * CELL_SIZE - FRAME_INSET_M,
					z: cell.iz * CELL_SIZE,
					wall: "east",
				});
			}
		}
	}

	const wallOrder: Record<FrameWallSide, number> = {
		north: 0,
		west: 1,
		east: 2,
	};
	frameCandidates.sort((a, b) => {
		if (a.roomId !== b.roomId) {
			return a.roomId - b.roomId;
		}
		if (a.wall !== b.wall) {
			return wallOrder[a.wall] - wallOrder[b.wall];
		}
		if (a.iz !== b.iz) {
			return a.iz - b.iz;
		}
		if (a.ix !== b.ix) {
			return a.ix - b.ix;
		}
		return 0;
	});

	const frames: PictureFramePlacement[] = [];
	let portraitIndex = 0;
	for (const candidate of frameCandidates) {
		const rng = mulberry32((layout.seed ^ hashString(`frame:${candidate.roomId}:${candidate.wall}:${candidate.ix}:${candidate.iz}`)) >>> 0);
		const roll = rng();
		const chance = candidate.wall === "north" ? NORTH_FRAME_CHANCE : SIDE_FRAME_CHANCE;
		if (roll > chance) {
			continue;
		}
		frames.push({
			id: `frame_${candidate.roomId}_${candidate.wall}_${candidate.ix}_${candidate.iz}`,
			roomId: candidate.roomId,
			ix: candidate.ix,
			iz: candidate.iz,
			x: candidate.x,
			z: candidate.z,
			wall: candidate.wall,
			portraitIndex,
		});
		portraitIndex++;
	}

	return {
		tables,
		papers,
		frames,
	};
}

export function buildTableCollisionWalls(
	placements: Iterable<Pick<TablePlacement, "x" | "z" | "width" | "depth" | "rotationQuarter">>,
): WallRect[] {
	const walls: WallRect[] = [];
	for (const table of placements) {
		const rotated = rotationIsQuarterOdd(table.rotationQuarter);
		const width = rotated ? table.depth : table.width;
		const depth = rotated ? table.width : table.depth;
		const halfW = width * 0.5;
		const halfD = depth * 0.5;
		walls.push({
			minX: table.x - halfW,
			maxX: table.x + halfW,
			minZ: table.z - halfD,
			maxZ: table.z + halfD,
		});
	}
	return walls;
}
