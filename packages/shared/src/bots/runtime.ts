import type { GameTeam } from "../index.js";
import { DEFAULT_BOT_RUNTIME_CONFIG } from "./config.js";
import { computeRoomIds } from "./mapAwareness.js";
import { createInitialBotMemory, ingestEvent, refreshMemoryFromSnapshot, stateTransitionPause } from "./memory.js";
import { EnforcerStrategy } from "./strategies/enforcer.js";
import { ShredderStrategy } from "./strategies/shredder.js";
import type {
	BotCommand,
	BotDecision,
	BotEventEnvelope,
	BotLogEntry,
	BotMemory,
	BotPerceptionSnapshot,
	BotRoleStrategy,
	BotRuntimeConfig,
} from "./types.js";

function defaultCommand(logEntries: BotLogEntry[]): BotCommand {
	return {
		moveVector: null,
		interactPress: false,
		interactHold: false,
		trapHold: false,
		logEntries,
	};
}

function resolveStrategy(team: GameTeam | null): BotRoleStrategy | null {
	if (team === "shredders") {
		return ShredderStrategy;
	}
	if (team === "enforcers") {
		return EnforcerStrategy;
	}
	return null;
}

export type BotRuntime = {
	memory: BotMemory;
	config: BotRuntimeConfig;
	enqueueEvent: (event: BotEventEnvelope) => void;
	step: (snapshot: BotPerceptionSnapshot) => BotCommand;
	reset: () => void;
};

export function createBotRuntime(partialConfig: Partial<BotRuntimeConfig> = {}): BotRuntime {
	const config: BotRuntimeConfig = { ...DEFAULT_BOT_RUNTIME_CONFIG, ...partialConfig };
	let memory = createInitialBotMemory();
	const pendingEvents: BotEventEnvelope[] = [];

	const enqueueEvent = (event: BotEventEnvelope) => {
		pendingEvents.push(event);
	};

	const reset = () => {
		memory = createInitialBotMemory();
		pendingEvents.length = 0;
	};

	const step = (rawSnapshot: BotPerceptionSnapshot): BotCommand => {
		const logs: BotLogEntry[] = [];
		const snapshot = computeRoomIds(rawSnapshot, rawSnapshot.map);
		for (const event of pendingEvents.splice(0, pendingEvents.length)) {
			ingestEvent(memory, event);
		}
		refreshMemoryFromSnapshot(memory, snapshot, config);
		if (!snapshot.self || !snapshot.self.isAlive) {
			return defaultCommand(logs);
		}

		const strategy = resolveStrategy(snapshot.team);
		if (!strategy) {
			return defaultCommand(logs);
		}
		if (!memory.hasAppliedInitialOrientationPause) {
			const minMs = Math.max(0, config.initialOrientationMinMs);
			const maxMs = Math.max(minMs, config.initialOrientationMaxMs);
			stateTransitionPause(memory, snapshot.timeMs, minMs, maxMs);
			memory.hasAppliedInitialOrientationPause = true;
			logs.push({
				level: "info",
				message: `initial_orientation_pause until=${Math.round(memory.pauseUntilMs)}`,
				timeMs: snapshot.timeMs,
			});
			return defaultCommand(logs);
		}

		if (memory.escapeUntilMs > snapshot.timeMs && memory.escapeVector) {
			logs.push({ level: "debug", message: "escape_active", timeMs: snapshot.timeMs });
			return {
				moveVector: memory.escapeVector,
				interactPress: false,
				interactHold: false,
				trapHold: false,
				logEntries: logs,
			};
		}
		if (snapshot.timeMs < memory.pauseUntilMs) {
			logs.push({ level: "debug", message: "pause_active", timeMs: snapshot.timeMs });
			return defaultCommand(logs);
		}

		const decision = strategy.decide({ snapshot, memory, config, logs });
		const transitioned = decision.stateKey !== memory.lastStateKey;
		if (transitioned) {
			logs.push({
				level: "info",
				message: `state_transition ${memory.lastStateKey} -> ${decision.stateKey}${decision.targetLabel ? ` target=${decision.targetLabel}` : ""}`,
				timeMs: snapshot.timeMs,
			});
			memory.lastStateKey = decision.stateKey;
			memory.lastStateChangeMs = snapshot.timeMs;
			if (decision.pauseAfterTransition && Math.random() < config.pauseChanceOnTransition) {
				stateTransitionPause(memory, snapshot.timeMs, config.pauseMinMs, config.pauseMaxMs);
				logs.push({
					level: "debug",
					message: `pause_scheduled until=${Math.round(memory.pauseUntilMs)}`,
					timeMs: snapshot.timeMs,
				});
			}
		}

		const command = decisionToCommand(decision, logs, config);
		updateStuckState(memory, snapshot, command, logs);
		if (command.moveVector) {
			logs.push({
				level: "debug",
				message: `move_vector x=${command.moveVector.x.toFixed(2)} z=${command.moveVector.z.toFixed(2)}`,
				timeMs: snapshot.timeMs,
			});
		}
		if (command.interactPress || command.interactHold || command.trapHold) {
			logs.push({
				level: "debug",
				message: `action interactPress=${String(command.interactPress)} interactHold=${String(command.interactHold)} trapHold=${String(command.trapHold)}`,
				timeMs: snapshot.timeMs,
			});
		}
		return command;
	};

	return {
		get memory() {
			return memory;
		},
		config,
		enqueueEvent,
		step,
		reset,
	};
}

function updateStuckState(
	memory: BotMemory,
	snapshot: BotPerceptionSnapshot,
	command: BotCommand,
	logs: BotLogEntry[],
) {
	const self = snapshot.self;
	if (!self) {
		memory.lastPosition = null;
		memory.stuckTicks = 0;
		return;
	}
	if (!command.moveVector) {
		memory.lastPosition = { x: self.x, z: self.z };
		memory.stuckTicks = 0;
		return;
	}
	// Ignore intentional stationary action windows (holds/presses) and tiny nudges.
	// These are common during interactions and should not trigger stuck recovery.
	if (command.interactPress || command.interactHold || command.trapHold) {
		memory.lastPosition = { x: self.x, z: self.z };
		memory.stuckTicks = 0;
		return;
	}
	const moveMagnitude = Math.hypot(command.moveVector.x, command.moveVector.z);
	if (moveMagnitude < 0.4) {
		memory.lastPosition = { x: self.x, z: self.z };
		memory.stuckTicks = 0;
		return;
	}
	const previous = memory.lastPosition;
	memory.lastPosition = { x: self.x, z: self.z };
	if (!previous) {
		memory.stuckTicks = 0;
		return;
	}
	const delta = Math.hypot(self.x - previous.x, self.z - previous.z);
	if (delta < 0.025) {
		memory.stuckTicks += 1;
	} else {
		memory.stuckTicks = 0;
	}
	if (memory.stuckTicks < 12) {
		return;
	}
	const roomCenter = self.roomId !== null ? snapshot.map.roomCenters.get(self.roomId) : null;
	let escapeX = 0;
	let escapeZ = 0;
	if (roomCenter) {
		escapeX = roomCenter.x - self.x;
		escapeZ = roomCenter.z - self.z;
	}
	const len = Math.hypot(escapeX, escapeZ);
	if (len <= 0.001) {
		const angle = deterministicNoise(`${self.sessionId}:${Math.round(snapshot.timeMs / 250)}`) * Math.PI * 2;
		escapeX = Math.cos(angle);
		escapeZ = Math.sin(angle);
	} else {
		escapeX /= len;
		escapeZ /= len;
	}
	memory.escapeVector = { x: escapeX, z: escapeZ };
	memory.escapeUntilMs = snapshot.timeMs + 650;
	memory.pauseUntilMs = 0;
	memory.stuckTicks = 0;
	logs.push({
		level: "warn",
		message: `stuck_recovery escape_until=${Math.round(memory.escapeUntilMs)}`,
		timeMs: snapshot.timeMs,
	});
}

function deterministicNoise(key: string): number {
	let hash = 2166136261 >>> 0;
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return (hash % 1000) / 1000;
}

function decisionToCommand(decision: BotDecision, logs: BotLogEntry[], config: BotRuntimeConfig): BotCommand {
	let moveVector = decision.moveVector;
	if (moveVector && Math.hypot(moveVector.x, moveVector.z) < config.movementDeadzone) {
		moveVector = null;
	}
	return {
		moveVector,
		interactPress: !!decision.interactPress,
		interactHold: !!decision.interactHold,
		trapHold: !!decision.trapHold,
		logEntries: logs,
	};
}
