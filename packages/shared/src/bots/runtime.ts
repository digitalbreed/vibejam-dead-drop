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
			if (memory.escapeMode === "vault_unwedge") {
				memory.escapeVector = vaultUnwedgeStepVector(memory, snapshot);
			}
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
		if (memory.roundStartActiveAtMs <= 0) {
			memory.roundStartActiveAtMs = snapshot.timeMs;
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
		const delayedCommand = applyActionDelayHandicap(memory, snapshot, command, config, logs);
		const detouredCommand = applyDetourHandicap(memory, snapshot, delayedCommand, config, logs);
		if (shouldTriggerAmbientPause(memory, snapshot, command, config)) {
			stateTransitionPause(memory, snapshot.timeMs, config.ambientPauseMinMs, config.ambientPauseMaxMs);
			memory.lastAmbientPauseAtMs = snapshot.timeMs;
			logs.push({
				level: "debug",
				message: `ambient_pause until=${Math.round(memory.pauseUntilMs)}`,
				timeMs: snapshot.timeMs,
			});
			return defaultCommand(logs);
		}
		updateStuckState(memory, snapshot, detouredCommand, logs);
		if (detouredCommand.moveVector) {
			logs.push({
				level: "debug",
				message: `move_vector x=${detouredCommand.moveVector.x.toFixed(2)} z=${detouredCommand.moveVector.z.toFixed(2)}`,
				timeMs: snapshot.timeMs,
			});
		}
		if (detouredCommand.interactPress || detouredCommand.interactHold || detouredCommand.trapHold) {
			logs.push({
				level: "debug",
				message: `action interactPress=${String(detouredCommand.interactPress)} interactHold=${String(detouredCommand.interactHold)} trapHold=${String(detouredCommand.trapHold)}`,
				timeMs: snapshot.timeMs,
			});
		}
		return detouredCommand;
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

function shouldTriggerAmbientPause(
	memory: BotMemory,
	snapshot: BotPerceptionSnapshot,
	command: BotCommand,
	config: BotRuntimeConfig,
): boolean {
	if (!command.moveVector) {
		return false;
	}
	if (command.interactPress || command.interactHold || command.trapHold) {
		return false;
	}
	if (snapshot.timeMs - memory.lastAmbientPauseAtMs < config.ambientPauseMinSpacingMs) {
		return false;
	}
	let chance = config.ambientPauseChancePerDecision;
	if (
		memory.roundStartActiveAtMs > 0 &&
		snapshot.timeMs - memory.roundStartActiveAtMs <= config.earlyRoundPauseWindowMs
	) {
		chance += config.earlyRoundExtraPauseChancePerDecision;
	}
	return Math.random() < chance;
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
		memory.escapeMode = null;
		return;
	}
	if (!command.moveVector) {
		memory.lastPosition = { x: self.x, z: self.z };
		memory.stuckTicks = 0;
		memory.escapeMode = null;
		return;
	}
	// Ignore intentional stationary action windows (holds/presses) and tiny nudges.
	// These are common during interactions and should not trigger stuck recovery.
	if (command.interactPress || command.interactHold || command.trapHold) {
		memory.lastPosition = { x: self.x, z: self.z };
		memory.stuckTicks = 0;
		memory.escapeMode = null;
		return;
	}
	const moveMagnitude = Math.hypot(command.moveVector.x, command.moveVector.z);
	if (moveMagnitude < 0.4) {
		memory.lastPosition = { x: self.x, z: self.z };
		memory.stuckTicks = 0;
		memory.escapeMode = null;
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
	const recovery = buildRecoveryVector(snapshot);
	memory.escapeVector = recovery.vector;
	memory.escapeUntilMs = snapshot.timeMs + recovery.durationMs;
	memory.escapeMode = recovery.mode;
	memory.escapeStartedAtMs = snapshot.timeMs;
	memory.pauseUntilMs = 0;
	memory.stuckTicks = 0;
	logs.push({
		level: "warn",
		message: `stuck_recovery mode=${recovery.mode} escape_until=${Math.round(memory.escapeUntilMs)}`,
		timeMs: snapshot.timeMs,
	});
}

function applyActionDelayHandicap(
	memory: BotMemory,
	snapshot: BotPerceptionSnapshot,
	command: BotCommand,
	config: BotRuntimeConfig,
	logs: BotLogEntry[],
): BotCommand {
	const actionSig = `${command.interactPress ? 1 : 0}${command.interactHold ? 1 : 0}${command.trapHold ? 1 : 0}`;
	const wantsAction = command.interactPress || command.interactHold || command.trapHold;
	if (!wantsAction) {
		if (snapshot.timeMs >= memory.actionDelayUntilMs) {
			memory.actionDelayUntilMs = 0;
		}
		memory.lastRequestedActionSig = "";
		return command;
	}
	if (memory.lastRequestedActionSig !== actionSig && memory.actionDelayUntilMs <= 0) {
		memory.actionDelayUntilMs = snapshot.timeMs + randomBetween(config.actionDelayMinMs, config.actionDelayMaxMs);
		memory.lastRequestedActionSig = actionSig;
		logs.push({
			level: "debug",
			message: `action_delay until=${Math.round(memory.actionDelayUntilMs)}`,
			timeMs: snapshot.timeMs,
		});
		return stripActions(command);
	}
	if (snapshot.timeMs < memory.actionDelayUntilMs) {
		return stripActions(command);
	}
	memory.actionDelayUntilMs = 0;
	memory.lastRequestedActionSig = actionSig;
	return command;
}

function applyDetourHandicap(
	memory: BotMemory,
	snapshot: BotPerceptionSnapshot,
	command: BotCommand,
	config: BotRuntimeConfig,
	logs: BotLogEntry[],
): BotCommand {
	if (!command.moveVector || command.interactPress || command.interactHold || command.trapHold) {
		if (snapshot.timeMs >= memory.detourUntilMs) {
			memory.detourUntilMs = 0;
			memory.detourVector = null;
		}
		return command;
	}
	if (memory.detourUntilMs > snapshot.timeMs && memory.detourVector) {
		return { ...command, moveVector: memory.detourVector };
	}
	if (snapshot.timeMs - memory.lastDetourAtMs < config.detourMinSpacingMs) {
		return command;
	}
	let chance = config.detourChancePerDecision;
	if (
		memory.roundStartActiveAtMs > 0 &&
		snapshot.timeMs - memory.roundStartActiveAtMs <= config.earlyRoundPauseWindowMs
	) {
		chance += 0.05;
	}
	if (Math.random() >= chance) {
		return command;
	}
	const current = command.moveVector;
	const angleDeg = randomBetween(config.detourAngleMinDeg, config.detourAngleMaxDeg) * (Math.random() < 0.5 ? -1 : 1);
	const angleRad = (angleDeg * Math.PI) / 180;
	const cos = Math.cos(angleRad);
	const sin = Math.sin(angleRad);
	const vx = current.x * cos - current.z * sin;
	const vz = current.x * sin + current.z * cos;
	const len = Math.hypot(vx, vz);
	if (len <= 0.001) {
		return command;
	}
	memory.detourVector = { x: vx / len, z: vz / len };
	memory.detourUntilMs = snapshot.timeMs + randomBetween(config.detourMinMs, config.detourMaxMs);
	memory.lastDetourAtMs = snapshot.timeMs;
	logs.push({
		level: "debug",
		message: `detour until=${Math.round(memory.detourUntilMs)}`,
		timeMs: snapshot.timeMs,
	});
	return { ...command, moveVector: memory.detourVector };
}

function stripActions(command: BotCommand): BotCommand {
	if (!command.interactPress && !command.interactHold && !command.trapHold) {
		return command;
	}
	return {
		...command,
		interactPress: false,
		interactHold: false,
		trapHold: false,
	};
}

function randomBetween(min: number, max: number): number {
	const lo = Math.max(0, Math.min(min, max));
	const hi = Math.max(lo, Math.max(min, max));
	return lo + Math.random() * (hi - lo);
}

function buildRecoveryVector(
	snapshot: BotPerceptionSnapshot,
): { vector: { x: number; z: number }; durationMs: number; mode: "vault_unwedge" | "room_center" | "random" } {
	const self = snapshot.self;
	if (!self) {
		return { vector: { x: 0, z: 1 }, durationMs: 500, mode: "random" };
	}
	const carryingKeycard = snapshot.keycards.some((keycard) => keycard.carrierSessionId === self.sessionId);
	const vault = snapshot.vaults[0];
	if (carryingKeycard && vault) {
		const distToVault = Math.hypot(self.x - vault.x, self.z - vault.z);
		if (distToVault <= 4.4) {
			const dx = self.x - vault.x;
			const dz = self.z - vault.z;
			let vx = 0;
			let vz = 0;
			// Phase 1: if hugging a side corner, strafe toward center first.
			if (Math.abs(dx) > 0.72) {
				vx = dx > 0 ? -1 : 1;
				vz = 0.2;
			} else if (dz < 0.95) {
				// Phase 2: pull to front (south) with slight anti-drift toward center.
				vx = Math.abs(dx) > 0.22 ? (dx > 0 ? -0.45 : 0.45) : 0;
				vz = 1;
			} else {
				// Already near front side: settle toward insertion lane centerline.
				vx = Math.abs(dx) > 0.16 ? (dx > 0 ? -0.55 : 0.55) : 0;
				vz = 0.75;
			}
			const len = Math.hypot(vx, vz);
			if (len > 0.001) {
				return {
					vector: { x: vx / len, z: vz / len },
					durationMs: 1050,
					mode: "vault_unwedge",
				};
			}
		}
	}
	const roomCenter = self.roomId !== null ? snapshot.map.roomCenters.get(self.roomId) : null;
	if (roomCenter) {
		const vx = roomCenter.x - self.x;
		const vz = roomCenter.z - self.z;
		const len = Math.hypot(vx, vz);
		if (len > 0.001) {
			return {
				vector: { x: vx / len, z: vz / len },
				durationMs: 650,
				mode: "room_center",
			};
		}
	}
	const angle = deterministicNoise(`${self.sessionId}:${Math.round(snapshot.timeMs / 250)}`) * Math.PI * 2;
	return {
		vector: { x: Math.cos(angle), z: Math.sin(angle) },
		durationMs: 650,
		mode: "random",
	};
}

function vaultUnwedgeStepVector(
	memory: BotMemory,
	snapshot: BotPerceptionSnapshot,
): { x: number; z: number } {
	const self = snapshot.self;
	const vault = snapshot.vaults[0];
	if (!self || !vault) {
		return memory.escapeVector ?? { x: 0, z: 1 };
	}
	const elapsed = snapshot.timeMs - memory.escapeStartedAtMs;
	const dx = self.x - vault.x;
	if (elapsed < 360) {
		// Phase 1: pure lateral to unstick from side/back corner.
		return { x: dx >= 0 ? -1 : 1, z: 0 };
	}
	if (elapsed < 760) {
		// Phase 2: pure south drift to get out of the back edge.
		return { x: 0, z: 1 };
	}
	// Phase 3: diagonal settle toward front-center lane.
	const centerBias = Math.abs(dx) > 0.18 ? (dx > 0 ? -0.6 : 0.6) : 0;
	const vx = centerBias;
	const vz = 1;
	const len = Math.hypot(vx, vz);
	if (len <= 0.001) {
		return { x: 0, z: 1 };
	}
	return { x: vx / len, z: vz / len };
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
