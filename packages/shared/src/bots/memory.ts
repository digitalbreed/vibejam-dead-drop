import type { BotEventEnvelope, BotMemory, BotPerceptionSnapshot, BotRuntimeConfig } from "./types.js";

export function createInitialBotMemory(): BotMemory {
	return {
		visitedRoomIds: new Set<number>(),
		interactedTargets: new Set<string>(),
		ownedDoorTrapDoorIds: new Set<string>(),
		seenInteractionByRoom: new Map<number, number>(),
		publicKeycardPickupColors: new Set<string>(),
		exitFoundPublic: false,
		roleFacts: {
			designatedCarrier: false,
		},
		lastStateKey: "init",
		pauseUntilMs: 0,
		lastStateChangeMs: 0,
		hasAppliedInitialOrientationPause: false,
		lastPosition: null,
		stuckTicks: 0,
		escapeUntilMs: 0,
		escapeVector: null,
		escapeMode: null,
		escapeStartedAtMs: 0,
		roundStartActiveAtMs: 0,
		lastAmbientPauseAtMs: 0,
		lastDetourAtMs: 0,
		detourUntilMs: 0,
		detourVector: null,
		actionDelayUntilMs: 0,
		lastRequestedActionSig: "",
	};
}

export function ingestEvent(memory: BotMemory, event: BotEventEnvelope): void {
	if (event.type === "ticker_event") {
		if (event.message.event === "keycard_first_pickup") {
			memory.publicKeycardPickupColors.add(event.message.color);
		}
		if (event.message.event === "exit_found") {
			memory.exitFoundPublic = true;
		}
		return;
	}
	if (event.message.kind === "keycard" && event.message.action === "picked_up") {
		memory.interactedTargets.add(`keycard:${event.message.id}`);
	}
	if (event.message.kind === "vault" && (event.message.action === "unlocked" || event.message.action === "opened")) {
		memory.interactedTargets.add(`vault:${event.message.id}:${event.message.action}`);
	}
}

export function refreshMemoryFromSnapshot(
	memory: BotMemory,
	snapshot: BotPerceptionSnapshot,
	config: BotRuntimeConfig,
): void {
	const self = snapshot.self;
	if (!self || !self.isAlive) {
		memory.ownedDoorTrapDoorIds.clear();
		return;
	}
	if (self.roomId !== null) {
		memory.visitedRoomIds.add(self.roomId);
	}

	const nextDoorTrapIds = new Set<string>();
	for (const trap of snapshot.traps) {
		if (trap.ownerSessionId !== self.sessionId) {
			continue;
		}
		if (trap.status !== "active") {
			continue;
		}
		if (trap.targetKind === "door") {
			nextDoorTrapIds.add(trap.targetId);
		}
	}
	memory.ownedDoorTrapDoorIds = nextDoorTrapIds;

	if (snapshot.suitcases.some((suitcase) => suitcase.carrierSessionId === self.sessionId)) {
		memory.roleFacts.designatedCarrier = true;
	}

	for (const player of snapshot.players) {
		if (!player.isAlive || player.sessionId === self.sessionId) {
			continue;
		}
		if (!player.isInteracting || player.roomId === null) {
			continue;
		}
		memory.seenInteractionByRoom.set(player.roomId, snapshot.timeMs);
	}

	for (const [roomId, seenAt] of [...memory.seenInteractionByRoom.entries()]) {
		if (snapshot.timeMs - seenAt > config.interactionSeenTtlMs) {
			memory.seenInteractionByRoom.delete(roomId);
		}
	}
}

export function stateTransitionPause(memory: BotMemory, nowMs: number, minMs: number, maxMs: number): void {
	const span = Math.max(0, maxMs - minMs);
	const pause = minMs + Math.random() * span;
	memory.pauseUntilMs = nowMs + pause;
}
