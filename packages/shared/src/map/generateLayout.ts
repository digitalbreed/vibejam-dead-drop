import { CELL_SIZE, INITIAL_ROOM_HALF_CELLS, type CellKind } from "./constants.js";
import { mulberry32 } from "./rng.js";
import { VAULT_TILE_IX, VAULT_TILE_IZ } from "./vaults.js";

/**
 * RogueBasin dungeon-building algorithm, aligned to Version 3 feature placement:
 * - rooms and corridors are carved as rectangles
 * - every new feature keeps a one-cell buffer from other carved space
 * - connections happen through a single explicit doorway edge
 */

export interface MapCell {
	ix: number;
	iz: number;
	kind: CellKind;
	/** 0 = start room, -1 = corridors, 1+ = chambers */
	roomId: number;
}

export interface MapLayout {
	seed: number;
	maxGridDistance: number;
	bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
	cells: MapCell[];
	doorEdgeKeys: string[];
}

type CellData = { kind: CellKind; roomId: number };

type Rect = {
	x: number;
	z: number;
	width: number;
	height: number;
};

type Direction = "north" | "south" | "west" | "east";

type ExitRect = Rect & {
	dir: Direction;
};

const ROOM_MIN_SIZE = 3;
const ROOM_MAX_SIZE = 6;
const CORRIDOR_MIN_LENGTH = 2;
const CORRIDOR_MAX_LENGTH = 5;
const MAX_FEATURE_TRIES = 1000;
const ROOM_CHANCE = 50;
const HALL_ROOM_ID = -1;

const key = (ix: number, iz: number) => `${ix},${iz}`;

function parseKey(k: string): [number, number] {
	const [a, b] = k.split(",").map(Number);
	return [a, b];
}

export function canonicalEdgeKey(ix1: number, iz1: number, ix2: number, iz2: number): string {
	if (ix1 < ix2 || (ix1 === ix2 && iz1 < iz2)) {
		return `${ix1},${iz1}|${ix2},${iz2}`;
	}
	return `${ix2},${iz2}|${ix1},${iz1}`;
}

function cheb(ix: number, iz: number): number {
	return Math.max(Math.abs(ix), Math.abs(iz));
}

function randomInt(rng: () => number, minInclusive: number, maxInclusive: number): number {
	return minInclusive + Math.floor(rng() * (maxInclusive - minInclusive + 1));
}

function vectorFor(dir: Direction): [number, number] {
	switch (dir) {
		case "north":
			return [0, -1];
		case "south":
			return [0, 1];
		case "west":
			return [-1, 0];
		case "east":
			return [1, 0];
	}
}

function addExit(exits: ExitRect[], rect: Rect, dir: Direction): void {
	switch (dir) {
		case "north":
			exits.push({ x: rect.x, z: rect.z - 1, width: rect.width, height: 1, dir });
			return;
		case "south":
			exits.push({ x: rect.x, z: rect.z + rect.height, width: rect.width, height: 1, dir });
			return;
		case "west":
			exits.push({ x: rect.x - 1, z: rect.z, width: 1, height: rect.height, dir });
			return;
		case "east":
			exits.push({ x: rect.x + rect.width, z: rect.z, width: 1, height: rect.height, dir });
			return;
	}
}

function pickPointInRect(rect: Rect, rng: () => number): [number, number] {
	return [
		randomInt(rng, rect.x, rect.x + rect.width - 1),
		randomInt(rng, rect.z, rect.z + rect.height - 1),
	];
}

function canPlaceRect(
	occupied: Map<string, CellData>,
	rect: Rect,
	maxGridDistance: number,
	allowedAdjacent: Set<string>,
): boolean {
	const dirs: [number, number][] = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	];

	for (let z = rect.z; z < rect.z + rect.height; z++) {
		for (let x = rect.x; x < rect.x + rect.width; x++) {
			if (cheb(x, z) > maxGridDistance) {
				return false;
			}
			if (occupied.has(key(x, z))) {
				return false;
			}
			for (const [dx, dz] of dirs) {
				const nx = x + dx;
				const nz = z + dz;
				const inside = nx >= rect.x && nx < rect.x + rect.width && nz >= rect.z && nz < rect.z + rect.height;
				if (inside) {
					continue;
				}
				const neighborKey = key(nx, nz);
				if (occupied.has(neighborKey) && !allowedAdjacent.has(neighborKey)) {
					return false;
				}
			}
		}
	}

	return true;
}

function fillRect(occupied: Map<string, CellData>, rect: Rect, data: CellData): void {
	for (let z = rect.z; z < rect.z + rect.height; z++) {
		for (let x = rect.x; x < rect.x + rect.width; x++) {
			occupied.set(key(x, z), data);
		}
	}
}

function buildRoomRect(x: number, z: number, dir: Direction, width: number, height: number): Rect {
	switch (dir) {
		case "north":
			return { x: x - Math.floor(width / 2), z: z - height, width, height };
		case "south":
			return { x: x - Math.floor(width / 2), z: z + 1, width, height };
		case "west":
			return { x: x - width, z: z - Math.floor(height / 2), width, height };
		case "east":
			return { x: x + 1, z: z - Math.floor(height / 2), width, height };
	}
}

function buildStraightCorridorRect(x: number, z: number, dir: Direction, length: number): Rect {
	switch (dir) {
		case "north":
			return { x, z: z - length, width: 1, height: length };
		case "south":
			return { x, z: z + 1, width: 1, height: length };
		case "west":
			return { x: x - length, z, width: length, height: 1 };
		case "east":
			return { x: x + 1, z, width: length, height: 1 };
	}
}

function addFeatureExits(exits: ExitRect[], rect: Rect, incoming: Direction, firstRoom = false): void {
	if (incoming !== "south" || firstRoom) {
		addExit(exits, rect, "north");
	}
	if (incoming !== "north" || firstRoom) {
		addExit(exits, rect, "south");
	}
	if (incoming !== "east" || firstRoom) {
		addExit(exits, rect, "west");
	}
	if (incoming !== "west" || firstRoom) {
		addExit(exits, rect, "east");
	}
}

export function generateMapLayout(seed: number, maxGridDistance: number): MapLayout {
	const rng = mulberry32(seed);
	const occupied = new Map<string, CellData>();
	const doorEdges = new Set<string>();
	const exits: ExitRect[] = [];
	let nextRoomId = 1;

	const firstRoomSize = INITIAL_ROOM_HALF_CELLS * 2 + 1;
	const firstRoom: Rect = {
		x: -INITIAL_ROOM_HALF_CELLS,
		z: -INITIAL_ROOM_HALF_CELLS,
		width: firstRoomSize,
		height: firstRoomSize,
	};

	fillRect(occupied, firstRoom, { kind: "center", roomId: 0 });
	addFeatureExits(exits, firstRoom, "north", true);

	const tryCreateFeature = (exitIndex: number): boolean => {
		const exit = exits[exitIndex];
		const [x, z] = pickPointInRect(exit, rng);
		const [dx, dz] = vectorFor(exit.dir);
		const parentX = x - dx;
		const parentZ = z - dz;
		const parentKey = key(parentX, parentZ);
		const parent = occupied.get(parentKey);
		if (!parent) {
			return false;
		}

		if (randomInt(rng, 0, 99) < ROOM_CHANCE) {
			const rect = buildRoomRect(
				x,
				z,
				exit.dir,
				randomInt(rng, ROOM_MIN_SIZE, ROOM_MAX_SIZE),
				randomInt(rng, ROOM_MIN_SIZE, ROOM_MAX_SIZE),
			);
			const doorKey = key(x, z);
			if (cheb(x, z) > maxGridDistance || occupied.has(doorKey)) {
				return false;
			}
			const [doorDx, doorDz] = vectorFor(exit.dir);
			const roomAnchorKey = key(x + doorDx, z + doorDz);
			const roomAdjacency = new Set<string>([doorKey]);
			if (!canPlaceRect(occupied, rect, maxGridDistance, roomAdjacency)) {
				return false;
			}
			const doorAdjacency = new Set<string>([parentKey, roomAnchorKey]);
			if (!canPlaceRect(occupied, { x, z, width: 1, height: 1 }, maxGridDistance, doorAdjacency)) {
				return false;
			}
			fillRect(occupied, { x, z, width: 1, height: 1 }, { kind: "chamber", roomId: nextRoomId });
			fillRect(occupied, rect, { kind: "chamber", roomId: nextRoomId });
			nextRoomId++;
			addFeatureExits(exits, rect, exit.dir);
		} else {
			const doorKey = key(x, z);
			if (cheb(x, z) > maxGridDistance || occupied.has(doorKey)) {
				return false;
			}
			const [doorDx, doorDz] = vectorFor(exit.dir);
			const corridorLength = randomInt(rng, CORRIDOR_MIN_LENGTH, CORRIDOR_MAX_LENGTH);
			const corridorRect = buildStraightCorridorRect(x, z, exit.dir, corridorLength);
			const corridorAnchorKey = key(x + doorDx, z + doorDz);
			const corridorAdjacency = new Set<string>([doorKey]);
			if (!canPlaceRect(occupied, corridorRect, maxGridDistance, corridorAdjacency)) {
				return false;
			}
			const doorAdjacency = new Set<string>([parentKey, corridorAnchorKey]);
			if (!canPlaceRect(occupied, { x, z, width: 1, height: 1 }, maxGridDistance, doorAdjacency)) {
				return false;
			}
			const endX = x + doorDx * (corridorLength + 1);
			const endZ = z + doorDz * (corridorLength + 1);
			const endDoorKey = key(endX, endZ);
			const roomRect = buildRoomRect(
				endX,
				endZ,
				exit.dir,
				randomInt(rng, ROOM_MIN_SIZE, ROOM_MAX_SIZE),
				randomInt(rng, ROOM_MIN_SIZE, ROOM_MAX_SIZE),
			);
			if (cheb(endX, endZ) > maxGridDistance || occupied.has(endDoorKey)) {
				return false;
			}
			const roomAnchorKey = key(endX + doorDx, endZ + doorDz);
			const roomAdjacency = new Set<string>([endDoorKey]);
			if (!canPlaceRect(occupied, roomRect, maxGridDistance, roomAdjacency)) {
				return false;
			}
			const farDoorAdjacency = new Set<string>([key(x + doorDx * corridorLength, z + doorDz * corridorLength), roomAnchorKey]);
			if (!canPlaceRect(occupied, { x: endX, z: endZ, width: 1, height: 1 }, maxGridDistance, farDoorAdjacency)) {
				return false;
			}
			fillRect(occupied, { x, z, width: 1, height: 1 }, { kind: "hall", roomId: HALL_ROOM_ID });
			fillRect(occupied, corridorRect, { kind: "hall", roomId: HALL_ROOM_ID });
			fillRect(occupied, { x: endX, z: endZ, width: 1, height: 1 }, { kind: "hall", roomId: HALL_ROOM_ID });
			fillRect(occupied, roomRect, { kind: "chamber", roomId: nextRoomId });
			addFeatureExits(exits, roomRect, exit.dir);
			doorEdges.add(canonicalEdgeKey(x + doorDx * corridorLength, z + doorDz * corridorLength, endX, endZ));
			doorEdges.add(canonicalEdgeKey(endX, endZ, endX + doorDx, endZ + doorDz));
			nextRoomId++;
		}

		doorEdges.add(canonicalEdgeKey(parentX, parentZ, x, z));
		exits.splice(exitIndex, 1);
		return true;
	};

	for (let placed = 1; placed < MAX_FEATURE_TRIES; placed++) {
		if (exits.length === 0) {
			break;
		}

		let created = false;
		for (let tries = 0; tries < MAX_FEATURE_TRIES; tries++) {
			const exitIndex = randomInt(rng, 0, exits.length - 1);
			if (tryCreateFeature(exitIndex)) {
				created = true;
				break;
			}
		}
		if (!created) {
			break;
		}
	}

	const cells: MapCell[] = [];
	let minX = Infinity;
	let maxX = -Infinity;
	let minZ = Infinity;
	let maxZ = -Infinity;

	for (const [k, d] of occupied) {
		const [ix, iz] = parseKey(k);
		cells.push({ ix, iz, kind: d.kind, roomId: d.roomId });
		const wx = ix * CELL_SIZE;
		const wz = iz * CELL_SIZE;
		const halfCell = CELL_SIZE / 2;
		minX = Math.min(minX, wx - halfCell);
		maxX = Math.max(maxX, wx + halfCell);
		minZ = Math.min(minZ, wz - halfCell);
		maxZ = Math.max(maxZ, wz + halfCell);
	}

	// Keep the wall line behind the vault solid: remove any generated door edges there
	// so layout-based wall/collision/rendering stays consistent with door placement rules.
	doorEdges.delete(canonicalEdgeKey(VAULT_TILE_IX, VAULT_TILE_IZ, VAULT_TILE_IX, VAULT_TILE_IZ - 1));
	doorEdges.delete(canonicalEdgeKey(VAULT_TILE_IX, VAULT_TILE_IZ - 1, VAULT_TILE_IX, VAULT_TILE_IZ - 2));

	return {
		seed,
		maxGridDistance,
		bounds: { minX, maxX, minZ, maxZ },
		cells,
		doorEdgeKeys: [...doorEdges],
	};
}

export function layoutOccupancy(layout: MapLayout): Set<string> {
	return new Set(layout.cells.map((c) => key(c.ix, c.iz)));
}

export function layoutRoomMap(layout: MapLayout): Map<string, number> {
	return new Map(layout.cells.map((c) => [key(c.ix, c.iz), c.roomId]));
}

export function cellWorldCenter(ix: number, iz: number): { x: number; z: number } {
	return { x: ix * CELL_SIZE, z: iz * CELL_SIZE };
}
