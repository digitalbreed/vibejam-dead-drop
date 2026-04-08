import { useEffect, useMemo, useRef } from "react";
import type { Room } from "@colyseus/sdk";
import {
	buildMapAwareness,
	createBotRuntime,
	type BotCommand,
	type BotPerceptionSnapshot,
	type BotPlayerPerception,
	type BotTrapPointPerception,
	type BotRuntimeConfig,
	type GameServerMessages,
	type GameState,
	type GameTeam,
} from "@vibejam/shared";
type UseDevBotControllerParams = {
	slot: number;
	room: Room<any, GameState> | undefined;
	team: GameTeam | null;
	phase: string | undefined;
	isConnecting: boolean;
	error: Error | undefined;
	isAlive: boolean;
	isPaused?: boolean;
};

type BotDoorPerception = BotPerceptionSnapshot["doors"][number];
type BotKeycardPerception = BotPerceptionSnapshot["keycards"][number];
type BotVaultPerception = BotPerceptionSnapshot["vaults"][number];
type BotSuitcasePerception = BotPerceptionSnapshot["suitcases"][number];
type BotTrapPerception = BotPerceptionSnapshot["traps"][number];
type BotFileCabinetPerception = BotPerceptionSnapshot["fileCabinets"][number];

function schemaMapEntries<T>(value: unknown): Array<[string, T]> {
	if (!value) {
		return [];
	}
	if (
		typeof value === "object" &&
		value !== null &&
		"entries" in value &&
		typeof (value as { entries: () => Iterable<[string, T]> }).entries === "function"
	) {
		return Array.from((value as { entries: () => Iterable<[string, T]> }).entries());
	}
	return Object.entries(value as Record<string, T>);
}

function schemaMapValues<T>(value: unknown): T[] {
	return schemaMapEntries<T>(value).map((entry) => entry[1]);
}

function readEnvIntervalMs(raw: unknown): number | undefined {
	const value = Number(raw);
	if (!Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return Math.floor(value);
}

const BOT_DECISION_TICK_OVERRIDE_MS = readEnvIntervalMs(import.meta.env.VITE_DEV_BOTS_DECISION_TICK_MS);
const BOT_INPUT_TICK_OVERRIDE_MS = readEnvIntervalMs(import.meta.env.VITE_DEV_BOTS_INPUT_TICK_MS);
const BOT_DEBUG_LOG_ENABLED = String(import.meta.env.VITE_DEV_BOTS_LOG ?? "0").trim() === "1";

function toPlayerPerception(playersState: unknown): BotPlayerPerception[] {
	return schemaMapEntries<any>(playersState).map(([sessionId, player]) => ({
		sessionId,
		x: typeof player?.x === "number" ? player.x : 0,
		z: typeof player?.z === "number" ? player.z : 0,
		isAlive: player?.isAlive !== false,
		isInteracting: !!player?.isInteracting,
		interactionKind: typeof player?.interactionKind === "string" ? player.interactionKind : "",
		interactionTargetId:
			typeof player?.interactionTargetId === "string" ? player.interactionTargetId : "",
		roomId: null,
	}));
}

function nowMs() {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function logBot(slot: number, team: GameTeam | null, message: string, level: "debug" | "info" | "warn") {
	if (level === "debug" && !BOT_DEBUG_LOG_ENABLED) {
		return;
	}
	const prefix = `[bot:${slot + 1}${team ? `:${team}` : ""}]`;
	if (level === "warn") {
		console.warn(prefix, message);
		return;
	}
	if (level === "info") {
		console.info(prefix, message);
		return;
	}
	console.debug(prefix, message);
}

export function useDevBotController(params: UseDevBotControllerParams) {
	const {
		slot,
		room,
		team,
		phase,
		isConnecting,
		error,
		isAlive,
		isPaused = false,
	} = params;

	const runtimeConfig = useMemo<Partial<BotRuntimeConfig>>(
		() => ({
			decisionTickMs: BOT_DECISION_TICK_OVERRIDE_MS,
			inputTickMs: BOT_INPUT_TICK_OVERRIDE_MS,
		}),
		[],
	);
	const runtime = useMemo(() => createBotRuntime(runtimeConfig), [runtimeConfig]);
	const projectionCacheRef = useRef({
		players: new Map<string, BotPlayerPerception>(),
		doors: new Map<string, BotDoorPerception>(),
		keycards: new Map<string, BotKeycardPerception>(),
		vaults: new Map<string, BotVaultPerception>(),
		suitcases: new Map<string, BotSuitcasePerception>(),
		traps: new Map<string, BotTrapPerception>(),
		trapPoints: new Map<string, BotTrapPointPerception>(),
		fileCabinets: new Map<string, BotFileCabinetPerception>(),
	});
	const latestTeamRef = useRef<GameTeam | null>(team);
	const desiredCommandRef = useRef<BotCommand>({
		moveVector: null,
		interactPress: false,
		interactHold: false,
		trapHold: false,
		logEntries: [],
	});
	const pulseRef = useRef({ requested: 0, handled: 0, timerId: null as number | null });
	const holdRef = useRef({ interact: false, trap: false });

	latestTeamRef.current = team;

	const active = !!room && phase === "playing" && !isConnecting && !error && isAlive && !isPaused;

	useEffect(() => {
		if (!active) {
			runtime.reset();
			desiredCommandRef.current = {
				moveVector: null,
				interactPress: false,
				interactHold: false,
				trapHold: false,
				logEntries: [],
			};
		}
	}, [active, runtime]);

	useEffect(() => {
		if (!room) {
			return;
		}
		const offInteractable = room.onMessage<GameServerMessages["interactable_event"]>(
			"interactable_event",
			(message) => {
				runtime.enqueueEvent({ type: "interactable_event", message, timeMs: nowMs() });
			},
		);
		const offTicker = room.onMessage<GameServerMessages["ticker_event"]>("ticker_event", (message) => {
			runtime.enqueueEvent({ type: "ticker_event", message, timeMs: nowMs() });
		});
		return () => {
			offInteractable?.();
			offTicker?.();
		};
	}, [room, runtime]);

	useEffect(() => {
		if (!active || !room) {
			return;
		}
		const intervalId = window.setInterval(() => {
			const snapshotState = room.state as any;
			if (!snapshotState) {
				return;
			}
			const mapSeed = snapshotState.mapSeed;
			const mapMaxDistance = snapshotState.mapMaxDistance;
			if (typeof mapSeed !== "number" || typeof mapMaxDistance !== "number") {
				return;
			}

			const caches = projectionCacheRef.current;
			const players = toPlayerPerception(snapshotState.players).map((player) => {
				const cached = caches.players.get(player.sessionId);
				if (cached) {
					cached.x = player.x;
					cached.z = player.z;
					cached.isAlive = player.isAlive;
					cached.isInteracting = player.isInteracting;
					cached.interactionKind = player.interactionKind;
					cached.interactionTargetId = player.interactionTargetId;
					cached.roomId = null;
					return cached;
				}
				caches.players.set(player.sessionId, player);
				return player;
			});
			const nextPlayerIds = new Set(players.map((player) => player.sessionId));
			for (const sessionId of caches.players.keys()) {
				if (!nextPlayerIds.has(sessionId)) {
					caches.players.delete(sessionId);
				}
			}
			const selfSessionId = room.sessionId;
			const self = players.find((player) => player.sessionId === selfSessionId) ?? null;
			const doors = schemaMapValues<any>(snapshotState.interactables)
				.filter((door) => door?.kind === "door")
				.map((door) => {
					const id = String(door.id ?? "");
					const cached = caches.doors.get(id);
					if (cached) {
						cached.x = typeof door.x === "number" ? door.x : 0;
						cached.z = typeof door.z === "number" ? door.z : 0;
						cached.isOpen = !!door.isOpen;
						cached.range = typeof door.range === "number" ? door.range : 0;
						cached.facing = door.facing === "z" ? "z" : "x";
						cached.roomA = null;
						cached.roomB = null;
						return cached;
					}
					const created: BotDoorPerception = {
						id,
						x: typeof door.x === "number" ? door.x : 0,
						z: typeof door.z === "number" ? door.z : 0,
						isOpen: !!door.isOpen,
						range: typeof door.range === "number" ? door.range : 0,
						facing: door.facing === "z" ? "z" : "x",
						roomA: null,
						roomB: null,
					};
					caches.doors.set(id, created);
					return created;
				});
			const nextDoorIds = new Set(doors.map((door) => door.id));
			for (const id of caches.doors.keys()) {
				if (!nextDoorIds.has(id)) {
					caches.doors.delete(id);
				}
			}
			const map = buildMapAwareness(mapSeed, mapMaxDistance, doors);

			const snapshot: BotPerceptionSnapshot = {
				timeMs: nowMs(),
				team: latestTeamRef.current,
				map,
				selfSessionId,
				self,
				players,
				doors,
				keycards: schemaMapValues<any>(snapshotState.keycards).map((card) => {
					const id = String(card.id ?? "");
					const cached = caches.keycards.get(id);
					if (cached) {
						cached.color = card.color === "red" ? "red" : "blue";
						cached.x = typeof card.worldX === "number" ? card.worldX : Number(card.x ?? 0);
						cached.z = typeof card.worldZ === "number" ? card.worldZ : Number(card.z ?? 0);
						cached.state = typeof card.state === "string" ? card.state : "ground";
						cached.carrierSessionId =
							typeof card.carrierSessionId === "string" ? card.carrierSessionId : "";
						cached.roomId = null;
						cached.range = typeof card.range === "number" ? card.range : 0;
						return cached;
					}
					const created: BotKeycardPerception = {
						id,
						color: card.color === "red" ? "red" : "blue",
						x: typeof card.worldX === "number" ? card.worldX : Number(card.x ?? 0),
						z: typeof card.worldZ === "number" ? card.worldZ : Number(card.z ?? 0),
						state: typeof card.state === "string" ? card.state : "ground",
						carrierSessionId:
							typeof card.carrierSessionId === "string" ? card.carrierSessionId : "",
						roomId: null,
						range: typeof card.range === "number" ? card.range : 0,
					};
					caches.keycards.set(id, created);
					return created;
				}),
				vaults: schemaMapValues<any>(snapshotState.vaults).map((vault) => {
					const id = String(vault.id ?? "");
					const cached = caches.vaults.get(id);
					if (cached) {
						cached.x = Number(vault.x ?? 0);
						cached.z = Number(vault.z ?? 0);
						cached.range = Number(vault.range ?? 0);
						cached.isUnlocked = !!vault.isUnlocked;
						cached.isDoorOpen = !!vault.isDoorOpen;
						cached.roomId = null;
						return cached;
					}
					const created: BotVaultPerception = {
						id,
						x: Number(vault.x ?? 0),
						z: Number(vault.z ?? 0),
						range: Number(vault.range ?? 0),
						isUnlocked: !!vault.isUnlocked,
						isDoorOpen: !!vault.isDoorOpen,
						roomId: null,
					};
					caches.vaults.set(id, created);
					return created;
				}),
				suitcases: schemaMapValues<any>(snapshotState.suitcases).map((suitcase) => {
					const id = String(suitcase.id ?? "");
					const cached = caches.suitcases.get(id);
					if (cached) {
						cached.x = typeof suitcase.worldX === "number" ? suitcase.worldX : Number(suitcase.x ?? 0);
						cached.z = typeof suitcase.worldZ === "number" ? suitcase.worldZ : Number(suitcase.z ?? 0);
						cached.state = typeof suitcase.state === "string" ? suitcase.state : "ground";
						cached.carrierSessionId =
							typeof suitcase.carrierSessionId === "string" ? suitcase.carrierSessionId : "";
						cached.containerId =
							typeof suitcase.containerId === "string" ? suitcase.containerId : "";
						cached.roomId = null;
						cached.range = typeof suitcase.range === "number" ? suitcase.range : 0;
						return cached;
					}
					const created: BotSuitcasePerception = {
						id,
						x: typeof suitcase.worldX === "number" ? suitcase.worldX : Number(suitcase.x ?? 0),
						z: typeof suitcase.worldZ === "number" ? suitcase.worldZ : Number(suitcase.z ?? 0),
						state: typeof suitcase.state === "string" ? suitcase.state : "ground",
						carrierSessionId:
							typeof suitcase.carrierSessionId === "string" ? suitcase.carrierSessionId : "",
						containerId: typeof suitcase.containerId === "string" ? suitcase.containerId : "",
						roomId: null,
						range: typeof suitcase.range === "number" ? suitcase.range : 0,
					};
					caches.suitcases.set(id, created);
					return created;
				}),
				traps: schemaMapValues<any>(snapshotState.traps).map((trap) => {
					const id = String(trap.id ?? "");
					const cached = caches.traps.get(id);
					if (cached) {
						cached.ownerSessionId = String(trap.ownerSessionId ?? "");
						cached.targetKind = String(trap.targetKind ?? "");
						cached.targetId = String(trap.targetId ?? "");
						cached.status = String(trap.status ?? "");
						return cached;
					}
					const created: BotTrapPerception = {
						id,
						ownerSessionId: String(trap.ownerSessionId ?? ""),
						targetKind: String(trap.targetKind ?? ""),
						targetId: String(trap.targetId ?? ""),
						status: String(trap.status ?? ""),
					};
					caches.traps.set(id, created);
					return created;
				}),
				trapPoints: schemaMapValues<any>(snapshotState.trapPoints).map((trapPoint) => {
					const id = String(trapPoint.id ?? "");
					const cached = caches.trapPoints.get(id);
					if (cached) {
						cached.ownerSessionId = String(trapPoint.ownerSessionId ?? "");
						cached.slotIndex = Number(trapPoint.slotIndex ?? 0);
						cached.status = String(trapPoint.status ?? "");
						cached.trapId = String(trapPoint.trapId ?? "");
						return cached;
					}
					const created: BotTrapPointPerception = {
						id,
						ownerSessionId: String(trapPoint.ownerSessionId ?? ""),
						slotIndex: Number(trapPoint.slotIndex ?? 0),
						status: String(trapPoint.status ?? ""),
						trapId: String(trapPoint.trapId ?? ""),
					};
					caches.trapPoints.set(id, created);
					return created;
				}),
				fileCabinets: schemaMapValues<any>(snapshotState.fileCabinets).map((cabinet) => {
					const id = String(cabinet.id ?? "");
					const cached = caches.fileCabinets.get(id);
					if (cached) {
						cached.searchedMask = Number(cabinet.searchedMask ?? 0);
						cached.roomId = null;
						return cached;
					}
					const created: BotFileCabinetPerception = {
						id,
						searchedMask: Number(cabinet.searchedMask ?? 0),
						roomId: null,
					};
					caches.fileCabinets.set(id, created);
					return created;
				}),
			};

			const nextCommand = runtime.step(snapshot);
			desiredCommandRef.current = nextCommand;
			if (nextCommand.interactPress) {
				pulseRef.current.requested += 1;
			}
			for (const entry of nextCommand.logEntries) {
				logBot(slot, latestTeamRef.current, entry.message, entry.level);
			}
		}, runtime.config.decisionTickMs);
		return () => {
			window.clearInterval(intervalId);
		};
	}, [active, room, runtime, slot]);

	useEffect(() => {
		const sendStopAndReleaseHolds = () => {
			if (!room) {
				return;
			}
			room.send("input", { x: 0, z: 0 });
			if (holdRef.current.interact) {
				room.send("interact_hold", { active: false });
				holdRef.current.interact = false;
			}
			if (holdRef.current.trap) {
				room.send("trap_hold", { active: false });
				holdRef.current.trap = false;
			}
		};

		const tick = () => {
			if (!room) {
				return;
			}
			if (!active) {
				sendStopAndReleaseHolds();
				return;
			}
			const command = desiredCommandRef.current;
			const moveX = command.moveVector?.x ?? 0;
			const moveZ = command.moveVector?.z ?? 0;
			room.send("input", { x: moveX, z: moveZ });

			const shouldHoldInteract = !!command.interactHold;
			if (shouldHoldInteract !== holdRef.current.interact) {
				room.send("interact_hold", { active: shouldHoldInteract });
				holdRef.current.interact = shouldHoldInteract;
			}

			const shouldHoldTrap = !!command.trapHold;
			if (shouldHoldTrap !== holdRef.current.trap) {
				room.send("trap_hold", { active: shouldHoldTrap });
				holdRef.current.trap = shouldHoldTrap;
			}

			if (pulseRef.current.requested > pulseRef.current.handled) {
				pulseRef.current.handled = pulseRef.current.requested;
				if (!holdRef.current.interact) {
					room.send("interact", {});
				}
			}
		};

		const intervalId = window.setInterval(tick, runtime.config.inputTickMs);
		return () => {
			window.clearInterval(intervalId);
			if (pulseRef.current.timerId !== null) {
				window.clearTimeout(pulseRef.current.timerId);
				pulseRef.current.timerId = null;
			}
			if (room) {
				sendStopAndReleaseHolds();
			}
		};
	}, [active, room, runtime.config.inputTickMs]);
}
