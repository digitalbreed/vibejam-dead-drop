import type {
	BotDecision,
	BotDecisionContext,
	BotDoorPerception,
	BotEscapeLadderPerception,
	BotKeycardPerception,
	BotPlayerPerception,
	BotSuitcasePerception,
	BotVaultPerception,
} from "../types.js";
import { chooseSweepTargetRoom, findRoomRoute, moveVectorTowards } from "../navigation.js";
import { distance } from "../mapAwareness.js";

const VAULT_INSERT_OFFSET_Z = 1.25;
const VAULT_INSERT_MIN_Z_DELTA = 0.25;
const VAULT_INTERACT_MIN_Z_DELTA = -0.1;
const VAULT_INTERACT_EXTRA_RANGE = 0.9;
const VAULT_APPROACH_OFFSET_Z = 2.05;
const VAULT_APPROACH_MAX_LATERAL = 0.55;

export function isAloneInRoom(context: BotDecisionContext, roomId: number | null): boolean {
	if (roomId === null) {
		return false;
	}
	const self = context.snapshot.self;
	if (!self) {
		return false;
	}
	for (const player of context.snapshot.players) {
		if (!player.isAlive || player.sessionId === self.sessionId) {
			continue;
		}
		if (player.roomId === roomId) {
			return false;
		}
		if (
			roomId === self.roomId &&
			player.roomId === null &&
			distance(player, self) <= context.config.aloneRoomFallbackDistance
		) {
			return false;
		}
	}
	return true;
}

export function playerCarriedKeycard(context: BotDecisionContext): BotKeycardPerception | null {
	const self = context.snapshot.self;
	if (!self) {
		return null;
	}
	return context.snapshot.keycards.find((keycard) => keycard.carrierSessionId === self.sessionId) ?? null;
}

export function playerCarriedSuitcase(context: BotDecisionContext): BotSuitcasePerception | null {
	const self = context.snapshot.self;
	if (!self) {
		return null;
	}
	return context.snapshot.suitcases.find((suitcase) => suitcase.carrierSessionId === self.sessionId) ?? null;
}

export function primaryVault(context: BotDecisionContext): BotVaultPerception | null {
	return context.snapshot.vaults[0] ?? null;
}

export function primaryEscapeLadder(context: BotDecisionContext): BotEscapeLadderPerception | null {
	if (context.snapshot.escapeLadders.length > 0) {
		return context.snapshot.escapeLadders[0]!;
	}
	const fallback = context.snapshot.map.escapeLadder;
	if (!fallback) {
		return null;
	}
	return {
		id: fallback.id,
		x: fallback.x,
		z: fallback.z,
		range: fallback.range,
		roomId: fallback.roomId,
	};
}

export function nearestGroundKeycard(
	context: BotDecisionContext,
	roomScoped = false,
	preferMissingColor = false,
): BotKeycardPerception | null {
	const self = context.snapshot.self;
	if (!self) {
		return null;
	}
	const preferredColors = preferMissingColor ? contextPreferredKeycardColors(context) : new Set<"blue" | "red">();
	let nearest: BotKeycardPerception | null = null;
	let bestDist = Number.POSITIVE_INFINITY;
	if (preferredColors.size > 0) {
		for (const keycard of context.snapshot.keycards) {
			if (keycard.state !== "ground" || !preferredColors.has(keycard.color)) {
				continue;
			}
			if (roomScoped && self.roomId !== null && keycard.roomId !== self.roomId) {
				continue;
			}
			const score = scoreKeycardCandidate(context, self, keycard);
			if (score < bestDist) {
				bestDist = score;
				nearest = keycard;
			}
		}
		if (nearest) {
			return nearest;
		}
	}
	bestDist = Number.POSITIVE_INFINITY;
	for (const keycard of context.snapshot.keycards) {
		if (keycard.state !== "ground") {
			continue;
		}
		if (roomScoped && self.roomId !== null && keycard.roomId !== self.roomId) {
			continue;
		}
		const score = scoreKeycardCandidate(context, self, keycard);
		if (score < bestDist) {
			bestDist = score;
			nearest = keycard;
		}
	}
	return nearest;
}

export function isPickupLeaderForKeycard(
	context: BotDecisionContext,
	keycard: BotKeycardPerception,
	radiusPad = 1.1,
): boolean {
	const self = context.snapshot.self;
	if (!self) {
		return false;
	}
	const contenders = context.snapshot.players.filter((player) => {
		if (!player.isAlive) {
			return false;
		}
		const inSameRoom = player.roomId !== null && keycard.roomId !== null && player.roomId === keycard.roomId;
		const closeEnough = distance(player, keycard) <= keycard.range + radiusPad;
		return inSameRoom || closeEnough;
	});
	if (contenders.length <= 1) {
		return true;
	}
	let winnerSessionId = self.sessionId;
	let bestScore = Number.POSITIVE_INFINITY;
	for (const contender of contenders) {
		const score =
			distance(contender, keycard) +
			deterministicNoise(`${contender.sessionId}:pickup:${keycard.id}`) * 0.35;
		if (score < bestScore) {
			bestScore = score;
			winnerSessionId = contender.sessionId;
		}
	}
	return winnerSessionId === self.sessionId;
}

function scoreKeycardCandidate(
	context: BotDecisionContext,
	self: { x: number; z: number; sessionId: string },
	keycard: BotKeycardPerception,
): number {
	const selfDistance = distance(self, keycard);
	let score = selfDistance + deterministicNoise(`${self.sessionId}:keycard:${keycard.id}`) * 0.6;
	for (const player of context.snapshot.players) {
		if (!player.isAlive || player.sessionId === self.sessionId) {
			continue;
		}
		const theirDist = distance(player, keycard);
		if (theirDist + 0.35 < selfDistance) {
			score += 1.4;
		}
	}
	return score;
}

export function keycardYieldPoint(
	context: BotDecisionContext,
	keycard: BotKeycardPerception,
): { x: number; z: number } {
	const self = context.snapshot.self;
	if (!self) {
		return { x: keycard.x, z: keycard.z + 1.2 };
	}
	const dx = self.x - keycard.x;
	const dz = self.z - keycard.z;
	const len = Math.hypot(dx, dz);
	if (len <= 0.001) {
		const angle = deterministicNoise(`${self.sessionId}:yield:${keycard.id}`) * Math.PI * 2;
		return {
			x: keycard.x + Math.cos(angle) * 1.1,
			z: keycard.z + Math.sin(angle) * 1.1,
		};
	}
	return {
		x: keycard.x + (dx / len) * 1.1,
		z: keycard.z + (dz / len) * 1.1,
	};
}

export function isVaultInteractionLeader(
	context: BotDecisionContext,
	vault: BotVaultPerception,
	radiusPad = 1.8,
): boolean {
	const self = context.snapshot.self;
	if (!self) {
		return false;
	}
	const contenders = context.snapshot.players.filter((player) => {
		if (!player.isAlive) {
			return false;
		}
		const inSameRoom = player.roomId !== null && vault.roomId !== null && player.roomId === vault.roomId;
		const nearVault = distance(player, vault) <= vault.range + radiusPad;
		return inSameRoom || nearVault;
	});
	if (contenders.length <= 1) {
		return true;
	}
	let winnerSessionId = self.sessionId;
	let bestScore = Number.POSITIVE_INFINITY;
	for (const contender of contenders) {
		const score =
			distance(contender, vault) +
			deterministicNoise(`${contender.sessionId}:vault_open:${vault.id}`) * 0.45;
		if (score < bestScore) {
			bestScore = score;
			winnerSessionId = contender.sessionId;
		}
	}
	return winnerSessionId === self.sessionId;
}

export function vaultYieldPoint(
	vault: BotVaultPerception,
	sessionId: string,
): { x: number; z: number } {
	const side = deterministicNoise(`${sessionId}:vault_yield:${vault.id}`) < 0.5 ? -1 : 1;
	return {
		x: vault.x + side * 1.4,
		z: vault.z + 2.45,
	};
}

function contextPreferredKeycardColors(context: BotDecisionContext): Set<"blue" | "red"> {
	const preferred = new Set<"blue" | "red">();
	const blueContained = context.snapshot.keycards.some(
		(keycard) => keycard.color === "blue" && keycard.state === "contained",
	);
	const redContained = context.snapshot.keycards.some(
		(keycard) => keycard.color === "red" && keycard.state === "contained",
	);
	if (blueContained && !redContained) {
		preferred.add("red");
		return preferred;
	}
	if (redContained && !blueContained) {
		preferred.add("blue");
		return preferred;
	}
	const seenBlue = context.memory.publicKeycardPickupColors.has("blue");
	const seenRed = context.memory.publicKeycardPickupColors.has("red");
	if (seenBlue && !seenRed) {
		preferred.add("red");
		return preferred;
	}
	if (seenRed && !seenBlue) {
		preferred.add("blue");
		return preferred;
	}
	return preferred;
}

export function inActionRange(context: BotDecisionContext, target: { x: number; z: number; range: number }): boolean {
	const self = context.snapshot.self;
	if (!self) {
		return false;
	}
	return distance(self, target) <= target.range + context.config.actionRangeSlack;
}

export function vaultInsertPoint(vault: BotVaultPerception): { x: number; z: number } {
	return { x: vault.x, z: vault.z + VAULT_INSERT_OFFSET_Z };
}

export function vaultApproachPoint(
	vault: BotVaultPerception,
	self: { x: number; z: number } | null,
): { x: number; z: number } {
	if (!self) {
		return { x: vault.x, z: vault.z + VAULT_APPROACH_OFFSET_Z };
	}
	const rawLateral = self.x - vault.x;
	const lateral = Math.max(-1, Math.min(1, rawLateral)) * VAULT_APPROACH_MAX_LATERAL;
	return {
		x: vault.x + lateral,
		z: vault.z + VAULT_APPROACH_OFFSET_Z,
	};
}

export function canInsertAtVault(context: BotDecisionContext, vault: BotVaultPerception): boolean {
	const self = context.snapshot.self;
	if (!self) {
		return false;
	}
	if (self.z < vault.z + VAULT_INSERT_MIN_Z_DELTA) {
		return false;
	}
	return distance(self, vaultInsertPoint(vault)) <= vault.range;
}

export function canOpenVault(context: BotDecisionContext, vault: BotVaultPerception): boolean {
	const self = context.snapshot.self;
	if (!self) {
		return false;
	}
	if (self.z < vault.z + VAULT_INTERACT_MIN_Z_DELTA) {
		return false;
	}
	return distance(self, vaultInsertPoint(vault)) <= vault.range + VAULT_INTERACT_EXTRA_RANGE;
}

export function doorBetweenRooms(context: BotDecisionContext, roomA: number, roomB: number): BotDoorPerception | null {
	return (
		context.snapshot.doors.find((door) => {
			if (door.roomA === null || door.roomB === null) {
				return false;
			}
			return (
				(door.roomA === roomA && door.roomB === roomB) ||
				(door.roomA === roomB && door.roomB === roomA)
			);
		}) ?? null
	);
}

function moveToRoomTarget(context: BotDecisionContext, targetRoomId: number): BotDecision {
	const self = context.snapshot.self;
	if (!self || self.roomId === null) {
		return { stateKey: "nav:idle", moveVector: null };
	}
	if (self.roomId === targetRoomId) {
		const center = context.snapshot.map.roomCenters.get(targetRoomId) ?? null;
		if (!center) {
			return { stateKey: `nav:arrived:${targetRoomId}`, moveVector: null };
		}
		const moveVector = moveVectorTowards(self, center, center, context.config, false);
		return {
			stateKey: `nav:arrived:${targetRoomId}`,
			moveVector,
			targetLabel: `room:${targetRoomId}`,
		};
	}
	const route = findRoomRoute(context.snapshot.map, self.roomId, targetRoomId, context.memory.ownedDoorTrapDoorIds);
	if (route.length === 0) {
		return { stateKey: `nav:blocked:${targetRoomId}`, moveVector: null, targetLabel: `room:${targetRoomId}` };
	}
	const nextDoorway = route[0]!;
	const fromCenter = context.snapshot.map.roomCenters.get(nextDoorway.fromRoomId) ?? null;
	const toCenter = context.snapshot.map.roomCenters.get(nextDoorway.toRoomId) ?? null;
	let doorwayTarget = { x: nextDoorway.x, z: nextDoorway.z };
	if (fromCenter && toCenter) {
		const dx = toCenter.x - fromCenter.x;
		const dz = toCenter.z - fromCenter.z;
		const len = Math.hypot(dx, dz);
		if (len > 0.001) {
			const nudge = 0.38;
			doorwayTarget = {
				x: nextDoorway.x + (dx / len) * nudge,
				z: nextDoorway.z + (dz / len) * nudge,
			};
		}
	}
	const currentCenter = context.snapshot.map.roomCenters.get(self.roomId) ?? null;
	const doorwayDistance = distance(self, nextDoorway);
	const moveVector = moveVectorTowards(
		self,
		doorwayTarget,
		currentCenter,
		context.config,
		doorwayDistance < 1.2,
	);
	return {
		stateKey: `nav:route:${targetRoomId}`,
		moveVector,
		targetLabel: `door:${nextDoorway.doorId}`,
	};
}

export function moveToRoomAwareTarget(
	context: BotDecisionContext,
	target: { x: number; z: number },
	targetRoomId: number | null,
	allowWallProximity: boolean,
	stateKeyWhenRouting: string,
	stateKeyWhenDirect: string,
	targetLabel: string,
): BotDecision {
	const self = context.snapshot.self;
	if (!self || self.roomId === null || targetRoomId === null) {
		return {
			...moveToTarget(context, target, allowWallProximity),
			stateKey: stateKeyWhenDirect,
			targetLabel,
		};
	}
	if (self.roomId !== targetRoomId) {
		const routing = moveToRoomTarget(context, targetRoomId);
		if (!routing.moveVector) {
			const targetCenter = context.snapshot.map.roomCenters.get(targetRoomId);
			if (targetCenter) {
				return {
					...moveToTarget(context, targetCenter, false),
					stateKey: `${stateKeyWhenRouting}:recover`,
					targetLabel,
				};
			}
		}
		return { ...routing, stateKey: stateKeyWhenRouting, targetLabel };
	}
	return {
		...moveToTarget(context, target, allowWallProximity),
		stateKey: stateKeyWhenDirect,
		targetLabel,
	};
}

export function decideSweepMove(context: BotDecisionContext): BotDecision {
	const self = context.snapshot.self;
	if (!self || self.roomId === null) {
		return { stateKey: "sweep:idle", moveVector: null };
	}
	const targetRoomId = chooseSweepTargetRoom(
		context.snapshot.map,
		self.roomId,
		context.memory.visitedRoomIds,
		context.memory.ownedDoorTrapDoorIds,
		self.sessionId,
	);
	return moveToRoomTarget(context, targetRoomId);
}

export function moveToTarget(context: BotDecisionContext, target: { x: number; z: number }, allowWallProximity: boolean): BotDecision {
	const self = context.snapshot.self;
	if (!self || self.roomId === null) {
		return { stateKey: "move:idle", moveVector: null };
	}
	const center = context.snapshot.map.roomCenters.get(self.roomId) ?? null;
	return {
		stateKey: "move:target",
		moveVector: moveVectorTowards(self, target, center, context.config, allowWallProximity),
	};
}

export function shouldAvoidRoomInteraction(context: BotDecisionContext, roomId: number | null): boolean {
	if (roomId === null) {
		return false;
	}
	const seenAt = context.memory.seenInteractionByRoom.get(roomId);
	if (seenAt === undefined) {
		return false;
	}
	return context.snapshot.timeMs - seenAt <= context.config.interactionSeenTtlMs;
}

export function nearestDoorInRoom(context: BotDecisionContext, roomId: number): BotDoorPerception | null {
	const self = context.snapshot.self;
	if (!self) {
		return null;
	}
	let nearest: BotDoorPerception | null = null;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const door of context.snapshot.doors) {
		if (door.roomA !== roomId && door.roomB !== roomId) {
			continue;
		}
		const dist = distance(self, door);
		if (dist < bestDist) {
			bestDist = dist;
			nearest = door;
		}
	}
	return nearest;
}

export function livingPlayersInRoom(context: BotDecisionContext, roomId: number | null): BotPlayerPerception[] {
	if (roomId === null) {
		return [];
	}
	return context.snapshot.players.filter((player) => player.isAlive && player.roomId === roomId);
}

function deterministicNoise(key: string): number {
	let hash = 2166136261 >>> 0;
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return (hash % 1000) / 1000;
}
