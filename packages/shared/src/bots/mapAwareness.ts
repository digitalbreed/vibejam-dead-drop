import {
	CELL_SIZE,
	generateEscapeLadderPlacement,
	generateMapLayout,
	layoutRoomMap,
	type MapLayout,
} from "../map/index.js";
import type { BotDoorPerception, BotMapAwareness, BotPerceptionSnapshot } from "./types.js";

const DOOR_ID_RE = /^door_(-?\d+)_(-?\d+)_(-?\d+)_(-?\d+)$/;
const HALL_COMPONENT_BASE_ID = 1_000_000;

type DoorEndpointPair = {
	ix1: number;
	iz1: number;
	ix2: number;
	iz2: number;
};

function parseDoorEndpointsFromId(id: string): DoorEndpointPair | null {
	const match = DOOR_ID_RE.exec(id);
	if (!match) {
		return null;
	}
	return {
		ix1: Number(match[1]),
		iz1: Number(match[2]),
		ix2: Number(match[3]),
		iz2: Number(match[4]),
	};
}

function worldToCell(x: number, z: number): { ix: number; iz: number } {
	return { ix: Math.round(x / CELL_SIZE), iz: Math.round(z / CELL_SIZE) };
}

function roomIdForCell(roomByCell: ReadonlyMap<string, number>, ix: number, iz: number): number | null {
	const roomId = roomByCell.get(`${ix},${iz}`);
	return typeof roomId === "number" ? roomId : null;
}

export function roomIdForWorldPosition(roomByCell: ReadonlyMap<string, number>, x: number, z: number): number | null {
	const cell = worldToCell(x, z);
	return roomIdForCell(roomByCell, cell.ix, cell.iz);
}

function buildRoomCenters(layout: MapLayout, roomByCell: ReadonlyMap<string, number>): Map<number, { x: number; z: number }> {
	const sums = new Map<number, { x: number; z: number; count: number }>();
	for (const cell of layout.cells) {
		const roomId = roomByCell.get(`${cell.ix},${cell.iz}`);
		if (typeof roomId !== "number") {
			continue;
		}
		const entry = sums.get(roomId) ?? { x: 0, z: 0, count: 0 };
		entry.x += cell.ix * CELL_SIZE;
		entry.z += cell.iz * CELL_SIZE;
		entry.count += 1;
		sums.set(roomId, entry);
	}
	const centers = new Map<number, { x: number; z: number }>();
	for (const [roomId, entry] of sums) {
		centers.set(roomId, { x: entry.x / entry.count, z: entry.z / entry.count });
	}
	return centers;
}

function buildRoomByCell(layout: MapLayout): { roomByCell: Map<string, number>; chamberRoomIds: Set<number> } {
	const baseRoomMap = layoutRoomMap(layout);
	const cellByKey = new Map(layout.cells.map((cell) => [`${cell.ix},${cell.iz}`, cell]));
	const roomByCell = new Map<string, number>();
	const chamberRoomIds = new Set<number>();
	const dirs: [number, number][] = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	];

	for (const [key, roomId] of baseRoomMap) {
		roomByCell.set(key, roomId);
	}

	let nextHallComponentId = HALL_COMPONENT_BASE_ID;
	const visited = new Set<string>();
	for (const cell of layout.cells) {
		const startKey = `${cell.ix},${cell.iz}`;
		if (cell.kind === "hall" && !visited.has(startKey)) {
			const queue = [startKey];
			visited.add(startKey);
			for (let i = 0; i < queue.length; i++) {
				const currentKey = queue[i]!;
				roomByCell.set(currentKey, nextHallComponentId);
				const [ix, iz] = currentKey.split(",").map(Number);
				for (const [dx, dz] of dirs) {
					const neighborKey = `${ix + dx},${iz + dz}`;
					if (visited.has(neighborKey)) {
						continue;
					}
					if (cellByKey.get(neighborKey)?.kind !== "hall") {
						continue;
					}
					visited.add(neighborKey);
					queue.push(neighborKey);
				}
			}
			nextHallComponentId++;
		}
		if (cell.kind === "chamber" && cell.roomId > 0) {
			chamberRoomIds.add(cell.roomId);
		}
	}

	return { roomByCell, chamberRoomIds };
}

function buildDoorways(
	doors: BotDoorPerception[],
	roomByCell: ReadonlyMap<string, number>,
): {
	doorways: BotMapAwareness["doorways"];
	doorwaysByRoom: BotMapAwareness["doorwaysByRoom"];
	leafChamberRoomIds: Set<number>;
} {
	const doorways: BotMapAwareness["doorways"] = [];
	const doorwaysByRoom = new Map<number, BotMapAwareness["doorways"][number][]>();
	for (const door of doors) {
		const parsed = parseDoorEndpointsFromId(door.id);
		let roomA: number | null = null;
		let roomB: number | null = null;
		if (parsed) {
			roomA = roomIdForCell(roomByCell, parsed.ix1, parsed.iz1);
			roomB = roomIdForCell(roomByCell, parsed.ix2, parsed.iz2);
		} else {
			roomA = door.roomA;
			roomB = door.roomB;
		}
		if (roomA === null || roomB === null || roomA === roomB) {
			continue;
		}
		const doorway = {
			doorId: door.id,
			x: door.x,
			z: door.z,
			roomA,
			roomB,
		};
		doorways.push(doorway);
		const sideA = doorwaysByRoom.get(roomA) ?? [];
		sideA.push(doorway);
		doorwaysByRoom.set(roomA, sideA);
		const sideB = doorwaysByRoom.get(roomB) ?? [];
		sideB.push(doorway);
		doorwaysByRoom.set(roomB, sideB);
	}
	const leafChamberRoomIds = new Set<number>();
	for (const [roomId, connectedDoorways] of doorwaysByRoom) {
		if (roomId > 0 && connectedDoorways.length === 1) {
			leafChamberRoomIds.add(roomId);
		}
	}
	return { doorways, doorwaysByRoom, leafChamberRoomIds };
}

const awarenessCache = new Map<string, BotMapAwareness>();

export function buildMapAwareness(seed: number, maxDistance: number, doors: BotDoorPerception[]): BotMapAwareness {
	const cacheKey = `${seed}:${maxDistance}`;
	const cached = awarenessCache.get(cacheKey);
	if (cached && (cached.doorways.length > 0 || doors.length === 0)) {
		return cached;
	}
	const layout = generateMapLayout(seed, maxDistance);
	const { roomByCell, chamberRoomIds } = buildRoomByCell(layout);
	const roomCenters = buildRoomCenters(layout, roomByCell);
	const escapeLadderPlacement = generateEscapeLadderPlacement(layout);
	const { doorways, doorwaysByRoom, leafChamberRoomIds } = buildDoorways(doors, roomByCell);
	const awareness: BotMapAwareness = {
		seed,
		maxDistance,
		roomByCell,
		roomCenters,
		chamberRoomIds,
		escapeLadder: escapeLadderPlacement
			? {
					id: escapeLadderPlacement.id,
					x: escapeLadderPlacement.x,
					z: escapeLadderPlacement.z,
					roomId: escapeLadderPlacement.roomId,
					range: escapeLadderPlacement.range,
			  }
			: null,
		doorways,
		doorwaysByRoom,
		leafChamberRoomIds,
	};
	awarenessCache.set(cacheKey, awareness);
	return awareness;
}

export function hydrateDoorRooms(doors: BotDoorPerception[], roomByCell: ReadonlyMap<string, number>): BotDoorPerception[] {
	return doors.map((door) => {
		const parsed = parseDoorEndpointsFromId(door.id);
		if (!parsed) {
			return door;
		}
		const roomA = roomIdForCell(roomByCell, parsed.ix1, parsed.iz1);
		const roomB = roomIdForCell(roomByCell, parsed.ix2, parsed.iz2);
		return {
			...door,
			roomA,
			roomB,
		};
	});
}

export function computeRoomIds(snapshot: Omit<BotPerceptionSnapshot, "map">, map: BotMapAwareness): BotPerceptionSnapshot {
	const toRoom = (x: number, z: number) => roomIdForWorldPosition(map.roomByCell, x, z);
	const self = snapshot.self
		? {
				...snapshot.self,
				roomId: toRoom(snapshot.self.x, snapshot.self.z),
		  }
		: null;
	const players = snapshot.players.map((player) => ({ ...player, roomId: toRoom(player.x, player.z) }));
	const keycards = snapshot.keycards.map((card) => ({ ...card, roomId: toRoom(card.x, card.z) }));
	const vaults = snapshot.vaults.map((vault) => ({ ...vault, roomId: toRoom(vault.x, vault.z) }));
	const suitcases = snapshot.suitcases.map((suitcase) => ({ ...suitcase, roomId: toRoom(suitcase.x, suitcase.z) }));
	const escapeLadders = snapshot.escapeLadders.map((ladder) => ({ ...ladder, roomId: toRoom(ladder.x, ladder.z) }));
	const doors = hydrateDoorRooms(snapshot.doors, map.roomByCell);
	const fileCabinets = snapshot.fileCabinets;
	return {
		...snapshot,
		self,
		players,
		doors,
		keycards,
		vaults,
		suitcases,
		escapeLadders,
		fileCabinets,
		map,
	};
}

export function distanceSq(a: { x: number; z: number }, b: { x: number; z: number }): number {
	const dx = a.x - b.x;
	const dz = a.z - b.z;
	return dx * dx + dz * dz;
}

export function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
	return Math.sqrt(distanceSq(a, b));
}
