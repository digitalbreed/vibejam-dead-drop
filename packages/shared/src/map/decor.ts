import { canonicalEdgeKey, layoutRoomMap, type MapCell, type MapLayout } from "./generateLayout.js";

export const FLOOR_STYLE_COUNT = 7;
export const WALL_STYLE_COUNT = 7;
export const LONG_CORRIDOR_STYLE = FLOOR_STYLE_COUNT - 1;
export const DECOR_PORTRAIT_ATLAS_COLUMNS = 4;
export const DECOR_PORTRAIT_ATLAS_ROWS = 3;
export const DECOR_PORTRAIT_COUNT = DECOR_PORTRAIT_ATLAS_COLUMNS * DECOR_PORTRAIT_ATLAS_ROWS;

export type DecorIds = {
	floorStyleByCell: Map<string, number>;
	wallStyleByCell: Map<string, number>;
};

function hash32(...values: number[]): number {
	let h = 2166136261 >>> 0;
	for (const value of values) {
		h ^= value >>> 0;
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h >>> 0;
}

export function computeDecorIds(layout: MapLayout): DecorIds {
	const corridorComponentByCell = new Map<string, number>();
	const corridorComponentSize = new Map<number, number>();
	const cells = new Map(layout.cells.map((cell) => [`${cell.ix},${cell.iz}`, cell]));
	const hallKeys = layout.cells.filter((cell) => cell.kind === "hall").map((cell) => `${cell.ix},${cell.iz}`);
	const dirs: [number, number][] = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	];
	let nextComponent = 1;

	for (const start of hallKeys) {
		if (corridorComponentByCell.has(start)) {
			continue;
		}
		const queue = [start];
		corridorComponentByCell.set(start, nextComponent);
		for (let index = 0; index < queue.length; index++) {
			const current = queue[index]!;
			const [ix, iz] = current.split(",").map(Number);
			for (const [dx, dz] of dirs) {
				const neighborKey = `${ix + dx},${iz + dz}`;
				if (corridorComponentByCell.has(neighborKey)) {
					continue;
				}
				if (cells.get(neighborKey)?.kind !== "hall") {
					continue;
				}
				corridorComponentByCell.set(neighborKey, nextComponent);
				queue.push(neighborKey);
			}
		}
		corridorComponentSize.set(nextComponent, queue.length);
		nextComponent++;
	}

	const floorStyleByCell = new Map<string, number>();
	const wallStyleByCell = new Map<string, number>();

	for (const cell of layout.cells) {
		const cellKey = `${cell.ix},${cell.iz}`;
		const featureId = cell.roomId >= 0 ? cell.roomId : 1000 + (corridorComponentByCell.get(cellKey) ?? 0);
		const base = hash32(layout.seed, featureId, cell.kind === "hall" ? 17 : 29);
		const corridorId = corridorComponentByCell.get(cellKey);
		const isLongCorridor = cell.kind === "hall" && corridorId !== undefined && (corridorComponentSize.get(corridorId) ?? 0) > 1;
		if (isLongCorridor) {
			floorStyleByCell.set(cellKey, LONG_CORRIDOR_STYLE);
			wallStyleByCell.set(cellKey, LONG_CORRIDOR_STYLE);
			continue;
		}
		floorStyleByCell.set(cellKey, base % (FLOOR_STYLE_COUNT - 1));
		wallStyleByCell.set(cellKey, hash32(layout.seed, featureId, 53) % (WALL_STYLE_COUNT - 1));
	}

	return { floorStyleByCell, wallStyleByCell };
}

export function pickWallStyleForEdge(
	layout: MapLayout,
	decorIds: DecorIds,
	ix1: number,
	iz1: number,
	ix2: number,
	iz2: number,
): number {
	const cells = new Map(layout.cells.map((cell) => [`${cell.ix},${cell.iz}`, cell]));
	const currentKey = `${ix1},${iz1}`;
	const neighborKey = `${ix2},${iz2}`;
	const currentStyle = decorIds.wallStyleByCell.get(currentKey) ?? 0;
	const neighborStyle = decorIds.wallStyleByCell.get(neighborKey);
	const currentCell = cells.get(currentKey);
	const neighborCell = cells.get(neighborKey);
	if (currentCell?.kind === "hall" && neighborCell?.kind !== "hall") {
		return currentStyle;
	}
	if (neighborCell?.kind === "hall" && currentCell?.kind !== "hall") {
		return neighborStyle ?? currentStyle;
	}
	return currentStyle;
}

export function findConnectedFeatureCell(
	layout: MapLayout,
	cell: MapCell,
	excludeKey: string,
): string | null {
	const roomMap = layoutRoomMap(layout);
	const dirs: [number, number][] = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	];
	for (const [dx, dz] of dirs) {
		const nx = cell.ix + dx;
		const nz = cell.iz + dz;
		const neighborKey = `${nx},${nz}`;
		if (neighborKey === excludeKey) {
			continue;
		}
		const neighborRoomId = roomMap.get(neighborKey);
		if (neighborRoomId === cell.roomId) {
			return neighborKey;
		}
	}
	return null;
}

export function parseCellKey(key: string): [number, number] {
	const [ix, iz] = key.split(",").map(Number);
	return [ix, iz];
}

export function oppositeDoorEdge(layout: MapLayout, cellAKey: string, cellBKey: string): boolean {
	const [ax, az] = parseCellKey(cellAKey);
	const [bx, bz] = parseCellKey(cellBKey);
	return layout.doorEdgeKeys.includes(canonicalEdgeKey(ax, az, bx, bz));
}
