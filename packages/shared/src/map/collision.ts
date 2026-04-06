import { CELL_SIZE } from "./constants.js";
import { canonicalEdgeKey, layoutOccupancy, layoutRoomMap, type MapLayout } from "./generateLayout.js";

export const DEFAULT_PLAYER_RADIUS = 0.35;
export const DEFAULT_WALL_THICKNESS = 0.14;

export type WallRect = {
	minX: number;
	maxX: number;
	minZ: number;
	maxZ: number;
};

export function buildCollisionWalls(
	layout: MapLayout,
	wallThickness = DEFAULT_WALL_THICKNESS,
): WallRect[] {
	const occ = layoutOccupancy(layout);
	const rooms = layoutRoomMap(layout);
	const doors = new Set(layout.doorEdgeKeys);
	const walls: WallRect[] = [];
	const halfCell = CELL_SIZE / 2;
	const halfThickness = wallThickness / 2;
	const dirs: [number, number][] = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	];

	const needsWall = (ix1: number, iz1: number, ix2: number, iz2: number) => {
		const k1 = `${ix1},${iz1}`;
		const k2 = `${ix2},${iz2}`;
		const o1 = occ.has(k1);
		const o2 = occ.has(k2);
		if (!o1 && !o2) {
			return false;
		}
		if (o1 !== o2) {
			return true;
		}
		const r1 = rooms.get(k1)!;
		const r2 = rooms.get(k2)!;
		if (r1 === r2) {
			return false;
		}
		return !doors.has(canonicalEdgeKey(ix1, iz1, ix2, iz2));
	};

	const shouldEmit = (ix: number, iz: number, nx: number, nz: number) => {
		const neighborKey = `${nx},${nz}`;
		if (!occ.has(neighborKey)) {
			return true;
		}
		return ix < nx || (ix === nx && iz < nz);
	};

	const pushWall = (ix: number, iz: number, dx: number, dz: number) => {
		const wx = ix * CELL_SIZE;
		const wz = iz * CELL_SIZE;
		if (dx !== 0) {
			const x = wx + dx * halfCell;
			walls.push({
				minX: x - halfThickness,
				maxX: x + halfThickness,
				minZ: wz - halfCell,
				maxZ: wz + halfCell,
			});
			return;
		}
		const z = wz + dz * halfCell;
		walls.push({
			minX: wx - halfCell,
			maxX: wx + halfCell,
			minZ: z - halfThickness,
			maxZ: z + halfThickness,
		});
	};

	for (const cell of layout.cells) {
		for (const [dx, dz] of dirs) {
			const nx = cell.ix + dx;
			const nz = cell.iz + dz;
			if (!needsWall(cell.ix, cell.iz, nx, nz)) {
				continue;
			}
			if (!shouldEmit(cell.ix, cell.iz, nx, nz)) {
				continue;
			}
			pushWall(cell.ix, cell.iz, dx, dz);
		}
	}

	return walls;
}

export function moveWithCollision(
	x: number,
	z: number,
	deltaX: number,
	deltaZ: number,
	walls: WallRect[],
	radius = DEFAULT_PLAYER_RADIUS,
): { x: number; z: number } {
	const nextX = moveAxis(x, z, deltaX, "x", walls, radius);
	const nextZ = moveAxis(nextX, z, deltaZ, "z", walls, radius);
	return { x: nextX, z: nextZ };
}

function moveAxis(
	x: number,
	z: number,
	delta: number,
	axis: "x" | "z",
	walls: WallRect[],
	radius: number,
): number {
	if (delta === 0) {
		return axis === "x" ? x : z;
	}
	const start = axis === "x" ? x : z;
	const target = start + delta;
	const fixed = axis === "x" ? z : x;
	let resolved = target;

	for (const wall of walls) {
		if (!overlapsWallOnPerpendicularAxis(fixed, wall, axis, radius)) {
			continue;
		}
		if (axis === "x") {
			if (delta > 0 && x + radius <= wall.minX && target + radius > wall.minX) {
				resolved = Math.min(resolved, wall.minX - radius);
			}
			if (delta < 0 && x - radius >= wall.maxX && target - radius < wall.maxX) {
				resolved = Math.max(resolved, wall.maxX + radius);
			}
			continue;
		}
		if (delta > 0 && z + radius <= wall.minZ && target + radius > wall.minZ) {
			resolved = Math.min(resolved, wall.minZ - radius);
		}
		if (delta < 0 && z - radius >= wall.maxZ && target - radius < wall.maxZ) {
			resolved = Math.max(resolved, wall.maxZ + radius);
		}
	}

	const nextX = axis === "x" ? resolved : x;
	const nextZ = axis === "z" ? resolved : z;
	if (intersectsAnyWall(nextX, nextZ, radius, walls)) {
		return start;
	}
	return resolved;
}

function intersectsAnyWall(x: number, z: number, radius: number, walls: WallRect[]): boolean {
	return walls.some((wall) => circleIntersectsRect(x, z, radius, wall));
}

function overlapsWallOnPerpendicularAxis(
	fixedPosition: number,
	wall: WallRect,
	axis: "x" | "z",
	radius: number,
): boolean {
	if (axis === "x") {
		return fixedPosition + radius > wall.minZ && fixedPosition - radius < wall.maxZ;
	}
	return fixedPosition + radius > wall.minX && fixedPosition - radius < wall.maxX;
}

function circleIntersectsRect(x: number, z: number, radius: number, rect: WallRect): boolean {
	const closestX = Math.max(rect.minX, Math.min(x, rect.maxX));
	const closestZ = Math.max(rect.minZ, Math.min(z, rect.maxZ));
	const dx = x - closestX;
	const dz = z - closestZ;
	return dx * dx + dz * dz < radius * radius;
}
