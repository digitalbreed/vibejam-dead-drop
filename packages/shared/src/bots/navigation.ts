import type { BotMapAwareness, BotRuntimeConfig, BotVector } from "./types.js";
import { distance } from "./mapAwareness.js";

export type BotRouteStep = {
	doorId: string;
	fromRoomId: number;
	toRoomId: number;
	x: number;
	z: number;
};

export function findRoomRoute(
	map: BotMapAwareness,
	fromRoomId: number,
	toRoomId: number,
	blockedDoorIds: ReadonlySet<string>,
): BotRouteStep[] {
	if (fromRoomId === toRoomId) {
		return [];
	}
	const queue: number[] = [fromRoomId];
	const prevByRoom = new Map<number, { roomId: number; doorway: BotMapAwareness["doorways"][number] }>();
	const visited = new Set<number>([fromRoomId]);
	for (let i = 0; i < queue.length; i++) {
		const roomId = queue[i]!;
		const doorways = map.doorwaysByRoom.get(roomId) ?? [];
		for (const doorway of doorways) {
			if (blockedDoorIds.has(doorway.doorId)) {
				continue;
			}
			const nextRoom = doorway.roomA === roomId ? doorway.roomB : doorway.roomA;
			if (visited.has(nextRoom)) {
				continue;
			}
			visited.add(nextRoom);
			prevByRoom.set(nextRoom, { roomId, doorway });
			if (nextRoom === toRoomId) {
				break;
			}
			queue.push(nextRoom);
		}
	}
	if (!prevByRoom.has(toRoomId)) {
		return [];
	}
	const reversed: BotRouteStep[] = [];
	let current = toRoomId;
	while (current !== fromRoomId) {
		const prev = prevByRoom.get(current);
		if (!prev) {
			return [];
		}
		reversed.push({
			doorId: prev.doorway.doorId,
			fromRoomId: prev.roomId,
			toRoomId: current,
			x: prev.doorway.x,
			z: prev.doorway.z,
		});
		current = prev.roomId;
	}
	return reversed.reverse();
}

function normalize(x: number, z: number): BotVector | null {
	const len = Math.hypot(x, z);
	if (len <= 0.0001) {
		return null;
	}
	return { x: x / len, z: z / len };
}

export function moveVectorTowards(
	from: { x: number; z: number },
	to: { x: number; z: number },
	currentRoomCenter: { x: number; z: number } | null,
	config: BotRuntimeConfig,
	allowWallProximity: boolean,
): BotVector | null {
	const direct = normalize(to.x - from.x, to.z - from.z);
	if (!direct) {
		return null;
	}
	if (allowWallProximity || !currentRoomCenter) {
		return direct;
	}
	const centerDistance = distance(from, currentRoomCenter);
	if (centerDistance < 0.9) {
		return direct;
	}
	const toCenter = normalize(currentRoomCenter.x - from.x, currentRoomCenter.z - from.z);
	if (!toCenter) {
		return direct;
	}
	const bias = Math.max(0, Math.min(1, config.wallAvoidanceBias));
	const mixedX = direct.x * (1 - bias) + toCenter.x * bias;
	const mixedZ = direct.z * (1 - bias) + toCenter.z * bias;
	return normalize(mixedX, mixedZ);
}

export function chooseSweepTargetRoom(
	map: BotMapAwareness,
	currentRoomId: number,
	visitedRoomIds: ReadonlySet<number>,
	blockedDoorIds: ReadonlySet<string>,
	actorSessionId: string,
): number {
	const roomIds = [...map.chamberRoomIds];
	const unvisited = roomIds.filter((roomId) => !visitedRoomIds.has(roomId));
	const candidates = unvisited.length > 0 ? unvisited : roomIds;
	let best = currentRoomId;
	let bestLen = Number.POSITIVE_INFINITY;
	let bestScore = Number.POSITIVE_INFINITY;
	for (const roomId of candidates) {
		if (roomId === currentRoomId) {
			return roomId;
		}
		const route = findRoomRoute(map, currentRoomId, roomId, blockedDoorIds);
		if (route.length === 0) {
			continue;
		}
		const noise = deterministicNoise(`${actorSessionId}:room:${roomId}`) * 0.8;
		const score = route.length + noise;
		if (route.length < bestLen || (route.length === bestLen && score < bestScore)) {
			bestLen = route.length;
			bestScore = score;
			best = roomId;
		}
	}
	return best;
}

function deterministicNoise(key: string): number {
	let hash = 2166136261 >>> 0;
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return (hash % 1000) / 1000;
}
