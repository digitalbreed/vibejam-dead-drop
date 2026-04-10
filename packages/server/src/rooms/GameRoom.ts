import { Room, Client, ErrorCode, ServerError, matchMaker } from "colyseus";
import {
	buildMapAwareness,
	buildVaultCollisionWalls,
	createBotRuntime,
	DEFAULT_BOT_RUNTIME_CONFIG,
	DoorState,
	EscapeLadderState,
	type FileCabinetFacing,
	FileCabinetState,
	GameState,
	generateFileCabinetPlacements,
	generateVaultPlacement,
	KeycardState,
	Player,
	SuitcaseState,
	TrapPointState,
	TrapState,
	VaultState,
	buildClosedDoorWalls,
	buildCollisionWalls,
	buildFileCabinetCollisionWalls,
	buildEscapeLadderCollisionWalls,
	CELL_SIZE,
	layoutRoomMap,
	generateDoorPlacements,
	generateEscapeLadderPlacement,
	generateKeycardPlacements,
	generateMapLayout,
	moveWithCollision,
	type BotCommand,
	type BotEventEnvelope,
	type BotPerceptionSnapshot,
	type BotRuntime,
	type GameTeam,
	spawnInCenterHub,
	type GameClientMessages,
	type GameServerMessages,
	type MapLayout,
	type WallRect,
} from "@vibejam/shared";
import { DoorController } from "./interactables/DoorController.js";
import { EscapeLadderController } from "./interactables/EscapeLadderController.js";
import { FileCabinetController } from "./interactables/FileCabinetController.js";
import { KeycardController } from "./interactables/KeycardController.js";
import { SuitcaseController } from "./interactables/SuitcaseController.js";
import { VaultController } from "./interactables/VaultController.js";

/** Target room size for production matchmaking (humans + server bots). */
const TARGET_PLAYERS = Number(process.env.TARGET_PLAYERS ?? 4);
/** Lobby wait time before the server fills remaining slots with bots. */
const LOBBY_WAIT_MS = Number(process.env.LOBBY_WAIT_MS ?? 60_000);
const BOT_SESSION_PREFIX = "bot:";
const SERVER_BOT_DECISION_TICK_MS = Number(process.env.SERVER_BOT_DECISION_TICK_MS ?? 0);
const SERVER_BOT_INPUT_TICK_MS = Number(process.env.SERVER_BOT_INPUT_TICK_MS ?? 0);

const DEFAULT_MAP_MAX_DISTANCE = Number(process.env.MAP_MAX_DISTANCE ?? 12);
const INTERACTION_DURATION_MS = 5000;
const DOOR_TRAP_OWNER_GRACE_MS = 1000;
const TRAP_POINT_COUNT = 3;
const DOOR_TRAP_CROSSING_MARGIN = 0.24;
const PLAYER_VISUAL_HEIGHT = 1.6;
const DEAD_KNOCKBACK_MAX_DISTANCE = PLAYER_VISUAL_HEIGHT * 3;
const DEAD_KNOCKBACK_MIN_DISTANCE = DEAD_KNOCKBACK_MAX_DISTANCE * 0.72;
const DEAD_KNOCKBACK_SPEED = 11.5;
const TRAP_EXPLOSION_AUDIO_RANGE = Number(process.env.TRAP_EXPLOSION_AUDIO_RANGE ?? 26);
const MAX_OPERATOR_NAME_LENGTH = 24;
const MAX_GAME_CODE_LENGTH = 24;
const AGENT_PREFIXES = [
	"Ghost",
	"Phantom",
	"Cipher",
	"Vector",
	"Echo",
	"Nova",
	"Rogue",
	"Stealth",
	"Apex",
	"Neon",
	"Onyx",
	"Chrome",
	"Obsidian",
	"Frost",
	"Viper",
	"Raven",
	"Zero",
	"Switch",
	"Pulse",
	"Havoc",
];
const AGENT_NOUNS = [
	"Agent",
	"Operative",
	"Runner",
	"Warden",
	"Drifter",
	"Specter",
	"Hunter",
	"Cipher",
	"Sentinel",
	"Nomad",
	"Shadow",
	"Tracker",
	"Broker",
	"Striker",
	"Scout",
	"Phantom",
	"Probe",
	"Signal",
	"Mirage",
	"Oracle",
];

const PALETTE = [
	0xe74c3c, 0x3498db, 0x2ecc71, 0xf1c40f, 0x9b59b6, 0x1abc9c, 0xe67e22, 0x34495e,
];

function colorForSession(sessionId: string): number {
	let hash = 0;
	for (let i = 0; i < sessionId.length; i++) {
		hash = sessionId.charCodeAt(i) + ((hash << 5) - hash);
	}
	return PALETTE[Math.abs(hash) % PALETTE.length];
}

function pickUniqueColor(existingColors: Set<number>, sessionId: string): number {
	for (const color of PALETTE) {
		if (!existingColors.has(color)) {
			return color;
		}
	}
	return colorForSession(sessionId);
}

function shuffleInPlace<T>(list: T[]): void {
	for (let i = list.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const temp = list[i]!;
		list[i] = list[j]!;
		list[j] = temp;
	}
}

function computeEnforcerCount(playerCount: number): number {
	if (playerCount <= 1) {
		return 1;
	}
	const ratioRounded = Math.round(playerCount / 5);
	return Math.min(playerCount - 1, Math.max(1, ratioRounded));
}

type TrapTargetKind = "door" | "vault" | "file_cabinet" | "escape_ladder" | "suitcase" | "keycard";

type TrapPlacementCandidate = {
	targetKind: TrapTargetKind;
	targetId: string;
	slotIndex: number;
	outwardX: number;
	outwardZ: number;
	doorSide: number;
};

type XY = { x: number; z: number };
type DeadKnockbackState = {
	dirX: number;
	dirZ: number;
	remainingDistance: number;
	speed: number;
};

type ServerBotController = {
	sessionId: string;
	team: GameTeam;
	runtime: BotRuntime;
	desiredCommand: BotCommand;
	holdInteract: boolean;
	holdTrap: boolean;
	pulseRequested: number;
	pulseHandled: number;
	lastDecisionAtMs: number;
	lastInputAtMs: number;
};

type JoinOptions = {
	mapMaxDistance?: number;
	operatorName?: string;
	gameCode?: string;
};

function normalizeGameCode(raw: unknown): string {
	if (typeof raw !== "string") {
		return "";
	}
	const compact = raw.replace(/\s+/g, "").trim().toUpperCase();
	if (!compact) {
		return "";
	}
	return compact.replace(/[^A-Z0-9_-]/g, "").slice(0, MAX_GAME_CODE_LENGTH);
}

function randomItem<T>(list: readonly T[]): T {
	return list[Math.floor(Math.random() * list.length)]!;
}

function buildAgentCodename(existingNames: ReadonlySet<string>): string {
	// Generate from two vocab pools + numeric suffix for strong variety across games.
	for (let attempt = 0; attempt < 24; attempt++) {
		const prefix = randomItem(AGENT_PREFIXES);
		const noun = randomItem(AGENT_NOUNS);
		const tag = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
		const candidate = `${prefix} ${noun}-${tag}`.slice(0, MAX_OPERATOR_NAME_LENGTH);
		if (!existingNames.has(candidate)) {
			return candidate;
		}
	}
	const fallback = `Agent ${String(Math.floor(Math.random() * 10000)).padStart(4, "0")}`;
	if (!existingNames.has(fallback)) {
		return fallback;
	}
	let counter = 1;
	while (counter < 1000) {
		const next = `Agent-${String(counter).padStart(3, "0")}`;
		if (!existingNames.has(next)) {
			return next;
		}
		counter += 1;
	}
	return "Agent";
}

function resolveOperatorName(raw: unknown, existingNames: ReadonlySet<string>): string {
	if (typeof raw !== "string") {
		return buildAgentCodename(existingNames);
	}
	const compact = raw.replace(/\s+/g, " ").trim();
	if (!compact) {
		return buildAgentCodename(existingNames);
	}
	return compact.slice(0, MAX_OPERATOR_NAME_LENGTH);
}

export class GameRoom extends Room {
	state = new GameState();
	private input = new Map<string, { x: number; z: number }>();
	private layout!: MapLayout;
	private staticWalls: WallRect[] = [];
	private emergencyExitRoomId: number | null = null;
	private hasBroadcastExitFound = false;
	private doorControllers: DoorController[] = [];
	private keycardControllers = new Map<string, KeycardController>();
	private suitcaseControllers = new Map<string, SuitcaseController>();
	private vaultControllers = new Map<string, VaultController>();
	private fileCabinetControllers = new Map<string, FileCabinetController>();
	private escapeLadderControllers = new Map<string, EscapeLadderController>();
	private interactionHold = new Map<string, boolean>();
	private trapHold = new Map<string, boolean>();
	private pendingTrapPlacement = new Map<string, TrapPlacementCandidate>();
	private deadKnockback = new Map<string, DeadKnockbackState>();
	private keycardsPickedUpColors = new Set<string>();
	private exitFoundBroadcasted = false;
	private lobbySkipRequested = false;
	private teamBySessionId = new Map<string, GameTeam>();
	private serverBots = new Map<string, ServerBotController>();
	maxClients = 16;

	messages = {
		input: (client: Client, message: GameClientMessages["input"]) => {
			const x = typeof message.x === "number" ? message.x : 0;
			const z = typeof message.z === "number" ? message.z : 0;
			const len = Math.hypot(x, z);
			const nx = len > 1 ? x / len : x;
			const nz = len > 1 ? z / len : z;
			this.input.set(client.sessionId, { x: nx, z: nz });
		},
		interact: (client: Client, _message: GameClientMessages["interact"]) => {
			if (this.state.phase !== "playing") {
				return;
			}
			this.handleInteract(client);
		},
		interact_hold: (client: Client, message: GameClientMessages["interact_hold"]) => {
			const active = !!message?.active;
			this.handleInteractHold(client, active);
		},
		trap_hold: (client: Client, message: GameClientMessages["trap_hold"]) => {
			const active = !!message?.active;
			this.handleTrapHold(client, active);
		},
		lobby_skip_wait: (client: Client, _message: GameClientMessages["lobby_skip_wait"]) => {
			if (this.state.phase !== "lobby") {
				return;
			}
			const player = this.state.players.get(client.sessionId);
			if (!player || player.isBot) {
				return;
			}
			this.lobbySkipRequested = true;
			this.tickLobby(Date.now());
		},
	};

	async onCreate(options: JoinOptions) {
		const gameCode = normalizeGameCode(options?.gameCode);
		if (gameCode) {
			const existing = await matchMaker.query({ name: this.roomName, gameCode });
			if (existing.length > 0) {
				throw new ServerError(
					ErrorCode.MATCHMAKE_INVALID_CRITERIA,
					`room code "${gameCode}" is already active`,
				);
			}
		}
		this.state.gameCode = gameCode;
		const targetPlayers = Math.max(1, Math.min(16, Math.floor(TARGET_PLAYERS || 4)));
		this.state.lobbyTargetPlayers = targetPlayers;
		this.state.lobbyDeadlineEpochMs = 0;
		this.state.mapSeed = (Math.random() * 0xffffffff) >>> 0;
		const cap = Math.min(64, Math.max(2, options?.mapMaxDistance ?? DEFAULT_MAP_MAX_DISTANCE));
		this.state.mapMaxDistance = cap;
		this.layout = generateMapLayout(this.state.mapSeed, this.state.mapMaxDistance);
		this.emergencyExitRoomId = generateEscapeLadderPlacement(this.layout)?.roomId ?? null;
		this.staticWalls = buildCollisionWalls(this.layout);
		this.createInteractables();
		this.staticWalls = [
			...this.staticWalls,
			...buildVaultCollisionWalls(Array.from(this.state.vaults.values(), (vault) => ({ x: vault.x, z: vault.z }))),
			...buildFileCabinetCollisionWalls(generateFileCabinetPlacements(this.layout)),
			...buildEscapeLadderCollisionWalls(
				(() => {
					const placement = generateEscapeLadderPlacement(this.layout);
					return placement ? [placement] : [];
				})(),
			),
		];
		this.setSimulationInterval((deltaTime) => this.tick(deltaTime), 1000 / 20);
		this.exitFoundBroadcasted = false;
		this.lobbySkipRequested = false;
	}

	onJoin(client: Client, options: JoinOptions = {}) {
		const player = new Player();
		const spawn = spawnInCenterHub(this.state.mapSeed, client.sessionId);
		player.x = spawn.x;
		player.z = spawn.z;
		const existingNames = new Set<string>();
		for (const existing of this.state.players.values()) {
			existingNames.add(existing.name);
		}
		player.name = resolveOperatorName(options.operatorName, existingNames);
		player.isBot = false;
		const existingColors = new Set<number>();
		for (const existing of this.state.players.values()) {
			existingColors.add(existing.color);
		}
		player.color = pickUniqueColor(existingColors, client.sessionId);
		player.isAlive = true;
		this.state.players.set(client.sessionId, player);
		this.initializeTrapPoints(client.sessionId);
		if (this.state.phase === "lobby" && this.state.lobbyDeadlineEpochMs <= 0) {
			this.state.lobbyDeadlineEpochMs = Date.now() + Math.max(1_000, LOBBY_WAIT_MS);
		}
		this.tryStartMatch();
	}

	onLeave(client: Client, _code: number) {
		const player = this.state.players.get(client.sessionId);
		if (player) {
			const carried = this.findCarriedKeycard(client.sessionId);
			if (carried) {
				carried.drop(client.sessionId, player.x, player.z);
			}
			const carriedSuitcase = this.findCarriedSuitcase(client.sessionId);
			if (carriedSuitcase) {
				carriedSuitcase.drop(client.sessionId, player.x, player.z);
			}
		}
		this.state.players.delete(client.sessionId);
		this.input.delete(client.sessionId);
		this.interactionHold.delete(client.sessionId);
		this.trapHold.delete(client.sessionId);
		this.pendingTrapPlacement.delete(client.sessionId);
		this.deadKnockback.delete(client.sessionId);
		this.removeOwnedTraps(client.sessionId);
		this.removeTrapPoints(client.sessionId);
		this.teamBySessionId.delete(client.sessionId);
	}

	onDispose() {
		this.input.clear();
		this.interactionHold.clear();
		this.trapHold.clear();
		this.pendingTrapPlacement.clear();
		this.deadKnockback.clear();
		this.doorControllers = [];
		this.keycardControllers.clear();
		this.suitcaseControllers.clear();
		this.vaultControllers.clear();
		this.fileCabinetControllers.clear();
		this.escapeLadderControllers.clear();
		this.teamBySessionId.clear();
		this.serverBots.clear();
	}

	private tryStartMatch() {
		if (this.state.phase !== "lobby") {
			return;
		}
		if (this.clients.length <= 0) {
			return;
		}
		if (this.state.players.size < this.state.lobbyTargetPlayers) {
			return;
		}
		const assignments = this.assignTeams();
		this.teamBySessionId = new Map(assignments);
		this.initializeServerBots(assignments);
		this.sendRoleAssignments(assignments);
		this.state.phase = "playing";
		this.lock();
	}

	private assignTeams(): Map<string, GameTeam> {
		const sessionIds = Array.from(this.state.players.keys());
		shuffleInPlace(sessionIds);
		const enforcerCount = computeEnforcerCount(sessionIds.length);
		const assignments = new Map<string, GameTeam>();
		for (let i = 0; i < sessionIds.length; i++) {
			assignments.set(sessionIds[i]!, i < enforcerCount ? "enforcers" : "shredders");
		}
		return assignments;
	}

	private sendRoleAssignments(assignments: ReadonlyMap<string, GameTeam>): void {
		for (const client of this.clients) {
			const team = assignments.get(client.sessionId);
			if (!team) {
				continue;
			}
			client.send("role_assignment", { team });
		}
	}

	private tickLobby(nowMs: number): void {
		if (this.state.phase !== "lobby") {
			return;
		}
		if (this.clients.length <= 0) {
			return;
		}
		if (this.state.lobbyDeadlineEpochMs <= 0) {
			this.state.lobbyDeadlineEpochMs = nowMs + Math.max(1_000, LOBBY_WAIT_MS);
		}
		if (this.state.players.size >= this.state.lobbyTargetPlayers) {
			this.tryStartMatch();
			return;
		}
		if (this.lobbySkipRequested || nowMs >= this.state.lobbyDeadlineEpochMs) {
			this.fillLobbyWithServerBots();
			this.tryStartMatch();
		}
	}

	private fillLobbyWithServerBots(): void {
		if (this.state.phase !== "lobby") {
			return;
		}
		const needed = Math.max(0, this.state.lobbyTargetPlayers - this.state.players.size);
		if (needed <= 0) {
			return;
		}
		const existingNames = new Set<string>();
		const existingColors = new Set<number>();
		for (const [sessionId, player] of this.state.players.entries()) {
			existingNames.add(player.name);
			existingColors.add(player.color);
			if (sessionId.startsWith(BOT_SESSION_PREFIX)) {
				this.serverBots.delete(sessionId);
			}
		}
		for (let i = 0; i < needed; i++) {
			const sessionId = this.createServerBotSessionId(i);
			if (this.state.players.has(sessionId)) {
				continue;
			}
			const player = new Player();
			const spawn = spawnInCenterHub(this.state.mapSeed, sessionId);
			player.x = spawn.x;
			player.z = spawn.z;
			player.name = resolveOperatorName(undefined, existingNames);
			player.isBot = true;
			player.color = pickUniqueColor(existingColors, sessionId);
			player.isAlive = true;
			this.state.players.set(sessionId, player);
			this.input.set(sessionId, { x: 0, z: 0 });
			this.initializeTrapPoints(sessionId);
			existingNames.add(player.name);
			existingColors.add(player.color);
		}
	}

	private initializeServerBots(assignments: ReadonlyMap<string, GameTeam>): void {
		this.serverBots.clear();
		for (const [sessionId, player] of this.state.players.entries()) {
			if (!player.isBot) {
				continue;
			}
			const team = assignments.get(sessionId);
			if (!team) {
				continue;
			}
			const runtime = createBotRuntime({
				decisionTickMs:
					SERVER_BOT_DECISION_TICK_MS > 0
						? SERVER_BOT_DECISION_TICK_MS
						: DEFAULT_BOT_RUNTIME_CONFIG.decisionTickMs,
				inputTickMs:
					SERVER_BOT_INPUT_TICK_MS > 0 ? SERVER_BOT_INPUT_TICK_MS : DEFAULT_BOT_RUNTIME_CONFIG.inputTickMs,
			});
			this.serverBots.set(sessionId, {
				sessionId,
				team,
				runtime,
				desiredCommand: {
					moveVector: null,
					interactPress: false,
					interactHold: false,
					trapHold: false,
					logEntries: [],
				},
				holdInteract: false,
				holdTrap: false,
				pulseRequested: 0,
				pulseHandled: 0,
				lastDecisionAtMs: 0,
				lastInputAtMs: 0,
			});
		}
	}

	private tickServerBots(nowMs: number): void {
		if (this.serverBots.size <= 0) {
			return;
		}
		for (const bot of this.serverBots.values()) {
			const player = this.state.players.get(bot.sessionId);
			if (!player) {
				continue;
			}
			if (nowMs - bot.lastDecisionAtMs >= bot.runtime.config.decisionTickMs) {
				bot.lastDecisionAtMs = nowMs;
				const snapshot = this.buildServerBotSnapshot(bot.sessionId, bot.team, nowMs);
				const command = bot.runtime.step(snapshot);
				bot.desiredCommand = command;
				if (command.interactPress) {
					bot.pulseRequested += 1;
				}
				for (const entry of command.logEntries) {
					if (entry.level === "debug") {
						continue;
					}
					const prefix = `[srv-bot:${player.name}:${bot.team}]`;
					if (entry.level === "warn") {
						console.warn(prefix, entry.message);
					} else {
						console.info(prefix, entry.message);
					}
				}
			}
			if (nowMs - bot.lastInputAtMs < bot.runtime.config.inputTickMs) {
				continue;
			}
			bot.lastInputAtMs = nowMs;
			const command = bot.desiredCommand;
			this.input.set(bot.sessionId, {
				x: command.moveVector?.x ?? 0,
				z: command.moveVector?.z ?? 0,
			});
			if (bot.holdInteract !== !!command.interactHold) {
				bot.holdInteract = !!command.interactHold;
				this.handleInteractHoldBySession(bot.sessionId, bot.holdInteract);
			}
			if (bot.holdTrap !== !!command.trapHold) {
				bot.holdTrap = !!command.trapHold;
				this.handleTrapHoldBySession(bot.sessionId, bot.holdTrap);
			}
			if (bot.pulseRequested > bot.pulseHandled) {
				bot.pulseHandled = bot.pulseRequested;
				if (!bot.holdInteract) {
					this.handleInteractBySession(bot.sessionId);
				}
			}
		}
	}

	private createServerBotSessionId(slot: number): string {
		const stamp = Date.now().toString(36);
		let attempt = 0;
		while (attempt < 128) {
			const suffix = Math.floor(Math.random() * 0xffff)
				.toString(16)
				.padStart(4, "0");
			const sessionId = `${BOT_SESSION_PREFIX}${stamp}:${slot}:${attempt}:${suffix}`;
			if (!this.state.players.has(sessionId)) {
				return sessionId;
			}
			attempt += 1;
		}
		return `${BOT_SESSION_PREFIX}${stamp}:${slot}:${Math.floor(Math.random() * 1_000_000)}`;
	}

	private tick(deltaMs: number) {
		const nowMs = Date.now();
		if (this.state.phase === "lobby") {
			this.tickLobby(nowMs);
			return;
		}
		if (this.state.phase !== "playing") {
			return;
		}
		this.tickServerBots(nowMs);
		const alivePlayers = Array.from(this.state.players.values()).filter((player) => player.isAlive);
		const previousPositionBySessionId = new Map<string, XY>();
		for (const [sessionId, player] of this.state.players.entries()) {
			if (!player.isAlive) {
				continue;
			}
			previousPositionBySessionId.set(sessionId, { x: player.x, z: player.z });
		}
		for (const controller of this.doorControllers) {
			const events = controller.tick(alivePlayers, deltaMs);
			for (const event of events) {
				this.emitInteractableEvent(event);
			}
		}
		for (const controller of this.vaultControllers.values()) {
			const events = controller.tick(alivePlayers, deltaMs);
			for (const event of events) {
				this.emitInteractableEvent(event);
			}
		}
		const dt = deltaMs / 1000;
		const speed = 12;
		const dynamicWalls = buildClosedDoorWalls(
			Array.from(this.state.interactables.values(), (door) => ({
				x: door.x,
				z: door.z,
				facing: door.facing === "z" ? "z" : "x",
				isOpen: door.isOpen,
			})),
		);
		const walls = [...this.staticWalls, ...dynamicWalls];
		this.state.players.forEach((player, sessionId) => {
			if (!player.isAlive) {
				return;
			}
			const inp = this.input.get(sessionId) ?? { x: 0, z: 0 };
			const next = moveWithCollision(player.x, player.z, inp.x * speed * dt, inp.z * speed * dt, walls);
			player.x = next.x;
			player.z = next.z;
		});

		// One-time public ticker: first time any player enters the Emergency Exit room.
		if (!this.hasBroadcastExitFound && this.emergencyExitRoomId !== null) {
			const roomMap = layoutRoomMap(this.layout);
			for (const player of this.state.players.values()) {
				if (!player.isAlive) {
					continue;
				}
				const ix = Math.round(player.x / CELL_SIZE);
				const iz = Math.round(player.z / CELL_SIZE);
				const roomId = roomMap.get(`${ix},${iz}`);
				if (roomId === this.emergencyExitRoomId) {
					this.hasBroadcastExitFound = true;
					this.emitTickerEvent({ event: "exit_found" });
					break;
				}
			}
		}

		this.tickDeadKnockback(dt, walls);
		this.checkDoorTrapCrossings(previousPositionBySessionId);
		this.tickInteractions(deltaMs);
	}

	private createInteractables() {
		this.state.interactables.clear();
		this.state.keycards.clear();
		this.state.suitcases.clear();
		this.state.vaults.clear();
		this.state.fileCabinets.clear();
		this.state.escapeLadders.clear();
		this.state.traps.clear();
		this.doorControllers = [];
		this.keycardControllers.clear();
		this.suitcaseControllers.clear();
		this.vaultControllers.clear();
		this.fileCabinetControllers.clear();
		this.escapeLadderControllers.clear();
		this.exitFoundBroadcasted = false;
		this.createVaults();
		this.createDoors();
		this.createKeycards();
		this.createSuitcases();
		this.createFileCabinets();
		this.createEscapeLadder();
	}

	private createVaults() {
		const placement = generateVaultPlacement();
		const vault = new VaultState();
		vault.id = placement.id;
		vault.kind = "vault";
		vault.range = placement.range;
		vault.x = placement.x;
		vault.z = placement.z;
		vault.insertedBlue = false;
		vault.insertedRed = false;
		vault.isUnlocked = false;
		vault.isDoorOpen = false;
		vault.doorHingeSide = placement.doorHingeSide;
		vault.doorOpenT = 0;
		this.state.vaults.set(vault.id, vault);
		this.vaultControllers.set(vault.id, new VaultController(vault));
	}

	private createDoors() {
		for (const placement of generateDoorPlacements(this.layout)) {
			const door = new DoorState();
			door.id = placement.id;
			door.kind = "door";
			door.range = placement.range;
			door.x = placement.x;
			door.z = placement.z;
			door.variant = placement.variant;
			door.isOpen = false;
			door.isLocked = false;
			door.nearbyCount = 0;
			door.hingeSide = placement.hingeSide;
			door.facing = placement.facing;
			door.side1Kind = placement.side1Kind;
			door.side2Kind = placement.side2Kind;
			door.side1FloorStyle = placement.side1FloorStyle;
			door.side2FloorStyle = placement.side2FloorStyle;
			door.side1WallStyle = placement.side1WallStyle;
			door.side2WallStyle = placement.side2WallStyle;
			this.state.interactables.set(door.id, door);
			this.doorControllers.push(new DoorController(door));
		}
	}

	private createKeycards() {
		for (const placement of generateKeycardPlacements(this.layout)) {
			const keycard = new KeycardState();
			keycard.id = placement.id;
			keycard.keyId = placement.id;
			keycard.kind = "keycard";
			keycard.range = placement.range;
			keycard.x = placement.x;
			keycard.z = placement.z;
			keycard.worldX = placement.x;
			keycard.worldZ = placement.z;
			keycard.color = placement.color;
			keycard.state = "ground";
			keycard.carrierSessionId = "";
			keycard.containerId = "";
			this.state.keycards.set(keycard.id, keycard);
			this.keycardControllers.set(keycard.id, new KeycardController(keycard));
		}
	}

	private createSuitcases() {
		const vaultPlacement = generateVaultPlacement();
		const suitcase = new SuitcaseState();
		suitcase.id = "suitcase_primary";
		suitcase.suitcaseId = suitcase.id;
		suitcase.kind = "suitcase";
		suitcase.range = 2.25;
		suitcase.x = vaultPlacement.x;
		suitcase.z = vaultPlacement.z;
		suitcase.worldX = vaultPlacement.x;
		suitcase.worldZ = vaultPlacement.z;
		suitcase.state = "contained";
		suitcase.carrierSessionId = "";
		suitcase.containerId = vaultPlacement.id;
		this.state.suitcases.set(suitcase.id, suitcase);
		this.suitcaseControllers.set(suitcase.id, new SuitcaseController(suitcase));
	}

	private createFileCabinets() {
		for (const placement of generateFileCabinetPlacements(this.layout)) {
			const cabinet = new FileCabinetState();
			cabinet.id = placement.id;
			cabinet.kind = "file_cabinet";
			cabinet.searchedMask = 0;
			this.state.fileCabinets.set(cabinet.id, cabinet);
			this.fileCabinetControllers.set(cabinet.id, new FileCabinetController(cabinet, placement));
		}
	}

	private createEscapeLadder() {
		const placement = generateEscapeLadderPlacement(this.layout);
		if (!placement) {
			return;
		}
		const ladder = new EscapeLadderState();
		ladder.id = placement.id;
		ladder.kind = "escape_ladder";
		this.state.escapeLadders.set(ladder.id, ladder);
		this.escapeLadderControllers.set(ladder.id, new EscapeLadderController(ladder, placement));
	}

	private handleInteract(client: Client) {
		this.handleInteractBySession(client.sessionId, client);
	}

	private handleInteractBySession(sessionId: string, client?: Client) {
		const player = this.state.players.get(sessionId);
		if (!player) {
			return;
		}
		if (!player.isAlive) {
			return;
		}
		if (player.isInteracting) {
			return;
		}
		const carriedSuitcase = this.findCarriedSuitcase(sessionId);
		if (carriedSuitcase) {
			const event = carriedSuitcase.drop(sessionId, player.x, player.z);
			if (event) {
				this.emitInteractableEvent(event, client ? { except: client } : undefined);
			}
			return;
		}
		const carried = this.findCarriedKeycard(sessionId);
		if (carried) {
			const vault = this.findNearestInsertableVault(player, carried.keycard);
			if (vault) {
				const trap = this.findActiveTrapForTarget("vault", vault.vault.id);
				if (trap) {
					this.triggerTrap(trap, sessionId);
					return;
				}
				const events = vault.insertCard(carried.keycard, sessionId);
				if (events.length > 0) {
					carried.setContained(vault.vault.id);
				}
				for (const event of events) {
					this.emitInteractableEvent(event);
				}
				return;
			}
			const event = carried.drop(sessionId, player.x, player.z);
			if (event) {
				this.emitInteractableEvent(event, client ? { except: client } : undefined);
			}
			return;
		}
		const nearestSuitcase = this.findNearestGroundSuitcase(player);
		if (nearestSuitcase) {
			const trap = this.findActiveTrapForTarget("suitcase", nearestSuitcase.suitcase.id);
			if (trap) {
				this.triggerTrap(trap, sessionId);
				return;
			}
			const event = nearestSuitcase.pickup(sessionId);
			if (event) {
				this.emitInteractableEvent(event, client ? { except: client } : undefined);
			}
			return;
		}
		const nearest = this.findNearestGroundKeycard(player);
		if (!nearest) {
			return;
		}
		const trap = this.findActiveTrapForTarget("keycard", nearest.keycard.id);
		if (trap) {
			this.triggerTrap(trap, sessionId);
			return;
		}
		const event = nearest.pickup(sessionId);
		if (event) {
			this.emitInteractableEvent(event, client ? { except: client } : undefined);
			if (!this.keycardsPickedUpColors.has(nearest.keycard.color)) {
				this.keycardsPickedUpColors.add(nearest.keycard.color);
				this.emitTickerEvent({ event: "keycard_first_pickup", color: nearest.keycard.color });
			}
		}
	}

	private findCarriedKeycard(sessionId: string): KeycardController | null {
		for (const controller of this.keycardControllers.values()) {
			if (controller.isCarriedBy(sessionId)) {
				return controller;
			}
		}
		return null;
	}

	private findNearestGroundKeycard(player: Player): KeycardController | null {
		let nearest: KeycardController | null = null;
		let nearestDistSq = Infinity;
		for (const controller of this.keycardControllers.values()) {
			if (!controller.isGrounded() || !controller.isInRange(player)) {
				continue;
			}
			const distSq = controller.distanceSqTo(player);
			if (distSq < nearestDistSq) {
				nearestDistSq = distSq;
				nearest = controller;
			}
		}
		return nearest;
	}

	private findCarriedSuitcase(sessionId: string): SuitcaseController | null {
		for (const controller of this.suitcaseControllers.values()) {
			if (controller.isCarriedBy(sessionId)) {
				return controller;
			}
		}
		return null;
	}

	private findNearestGroundSuitcase(player: Player): SuitcaseController | null {
		let nearest: SuitcaseController | null = null;
		let nearestDistSq = Infinity;
		for (const controller of this.suitcaseControllers.values()) {
			if (!controller.isGrounded() || !controller.isInRange(player)) {
				continue;
			}
			const distSq = controller.distanceSqTo(player);
			if (distSq < nearestDistSq) {
				nearestDistSq = distSq;
				nearest = controller;
			}
		}
		return nearest;
	}

	private findNearestInsertableVault(player: Player, carried: KeycardState): VaultController | null {
		let nearest: VaultController | null = null;
		let nearestDistSq = Infinity;
		for (const controller of this.vaultControllers.values()) {
			if (!controller.canInsertCard(carried) || !controller.isInInsertRange(player)) {
				continue;
			}
			const dx = player.x - controller.vault.x;
			const dz = player.z - controller.vault.z;
			const distSq = dx * dx + dz * dz;
			if (distSq < nearestDistSq) {
				nearestDistSq = distSq;
				nearest = controller;
			}
		}
		return nearest;
	}

	private handleInteractHold(client: Client, active: boolean) {
		this.handleInteractHoldBySession(client.sessionId, active, () => {
			client.send("interaction_feedback", { kind: "error_beep" });
		});
	}

	private handleInteractHoldBySession(sessionId: string, active: boolean, onError?: () => void) {
		if (this.state.phase !== "playing") {
			return;
		}
		this.interactionHold.set(sessionId, active);
		const player = this.state.players.get(sessionId);
		if (!player || !player.isAlive) {
			return;
		}
		if (!active) {
			if (
				player.isInteracting &&
				player.interactionKind !== "trap_place" &&
				player.interactionElapsedMs >= player.interactionDurationMs - 50
			) {
				this.completeInteraction(sessionId, player);
				return;
			}
			this.cancelInteraction(sessionId, player);
			return;
		}
		if (player.isInteracting) {
			return;
		}
		const candidate = this.findInteractionCandidate(player);
		if (!candidate) {
			onError?.();
			return;
		}
		if (candidate.kind === "vault") {
			const trap = this.findActiveTrapForTarget("vault", candidate.id);
			if (trap) {
				this.triggerTrap(trap, sessionId);
				return;
			}
		}
		if (this.isInteractionTargetBusy(candidate.kind, candidate.id, sessionId)) {
			onError?.();
			return;
		}
		player.isInteracting = true;
		player.interactionKind = candidate.kind;
		player.interactionTargetId = candidate.id;
		player.interactionElapsedMs = 0;
		player.interactionDurationMs = candidate.durationMs;
		player.interactionStyle = "normal";
		player.interactionTrapSlotIndex = -1;
	}

	private findInteractionCandidate(
		player: Player,
	): { kind: "vault" | "file_cabinet" | "escape_ladder"; id: string; durationMs: number } | null {
		let nearestCabinet: FileCabinetController | null = null;
		let nearestCabinetDistSq = Infinity;
		for (const controller of this.fileCabinetControllers.values()) {
			if (!controller.canCompleteInteraction(player)) {
				continue;
			}
			const dx = player.x - controller.placementSnapshot.x;
			const dz = player.z - controller.placementSnapshot.z;
			const distSq = dx * dx + dz * dz;
			if (distSq < nearestCabinetDistSq) {
				nearestCabinetDistSq = distSq;
				nearestCabinet = controller;
			}
		}

		let nearestVault: VaultController | null = null;
		let nearestVaultDistSq = Infinity;
		for (const controller of this.vaultControllers.values()) {
			if (!controller.canCompleteInteraction(player)) {
				continue;
			}
			const dx = player.x - controller.vault.x;
			const dz = player.z - controller.vault.z;
			const distSq = dx * dx + dz * dz;
			if (distSq < nearestVaultDistSq) {
				nearestVaultDistSq = distSq;
				nearestVault = controller;
			}
		}

		let nearestLadder: EscapeLadderController | null = null;
		let nearestLadderDistSq = Infinity;
		for (const controller of this.escapeLadderControllers.values()) {
			if (!controller.canCompleteInteraction(player)) {
				continue;
			}
			const dx = player.x - controller.placementSnapshot.x;
			const dz = player.z - controller.placementSnapshot.z;
			const distSq = dx * dx + dz * dz;
			if (distSq < nearestLadderDistSq) {
				nearestLadderDistSq = distSq;
				nearestLadder = controller;
			}
		}

		if (!nearestCabinet && !nearestVault && !nearestLadder) {
			return null;
		}

		// Choose nearest among eligible hold interactions.
		const bestKind =
			nearestLadder && (!nearestCabinet || nearestLadderDistSq <= nearestCabinetDistSq) && (!nearestVault || nearestLadderDistSq <= nearestVaultDistSq)
				? ("escape_ladder" as const)
				: nearestCabinet && (!nearestVault || nearestCabinetDistSq <= nearestVaultDistSq)
					? ("file_cabinet" as const)
					: ("vault" as const);

		if (bestKind === "escape_ladder") {
			return { kind: "escape_ladder", id: nearestLadder!.ladder.id, durationMs: INTERACTION_DURATION_MS };
		}
		if (bestKind === "file_cabinet") {
			return { kind: "file_cabinet", id: nearestCabinet!.cabinet.id, durationMs: INTERACTION_DURATION_MS };
		}
		return { kind: "vault", id: nearestVault!.vault.id, durationMs: INTERACTION_DURATION_MS };
	}

	private handleTrapHold(client: Client, active: boolean) {
		this.handleTrapHoldBySession(client.sessionId, active, () => {
			client.send("interaction_feedback", { kind: "error_beep" });
		});
	}

	private handleTrapHoldBySession(sessionId: string, active: boolean, onError?: () => void) {
		if (this.state.phase !== "playing") {
			return;
		}
		this.trapHold.set(sessionId, active);
		const player = this.state.players.get(sessionId);
		if (!player || !player.isAlive) {
			return;
		}
		if (!active) {
			if (
				player.isInteracting &&
				player.interactionKind === "trap_place" &&
				player.interactionElapsedMs >= player.interactionDurationMs - 50
			) {
				this.completeTrapPlacement(sessionId, player);
				return;
			}
			if (player.interactionKind === "trap_place") {
				this.cancelInteraction(sessionId, player);
			}
			return;
		}
		if (player.isInteracting) {
			return;
		}
		const candidate = this.findTrapPlacementCandidate(sessionId, player);
		if (!candidate) {
			onError?.();
			return;
		}
		if (this.isInteractionTargetBusy("trap_place", candidate.targetId, sessionId)) {
			onError?.();
			return;
		}
		this.pendingTrapPlacement.set(sessionId, candidate);
		player.isInteracting = true;
		player.interactionKind = "trap_place";
		player.interactionTargetId = candidate.targetId;
		player.interactionElapsedMs = 0;
		player.interactionDurationMs = INTERACTION_DURATION_MS;
		player.interactionStyle = "danger";
		player.interactionTrapSlotIndex = candidate.slotIndex;
	}

	private findTrapPlacementCandidate(sessionId: string, player: Player): TrapPlacementCandidate | null {
		const slotIndex = this.findFirstUnusedTrapPointSlot(sessionId);
		if (slotIndex < 0) {
			return null;
		}
		let best: (TrapPlacementCandidate & { distSq: number }) | null = null;

		for (const door of this.state.interactables.values()) {
			const dx = player.x - door.x;
			const dz = player.z - door.z;
			const distSq = dx * dx + dz * dz;
			if (distSq > door.range * door.range) {
				continue;
			}
			const doorSide = this.computeDoorSide(door, player);
			const outward = door.facing === "z" ? { x: 0, z: doorSide } : { x: doorSide, z: 0 };
			const candidate: TrapPlacementCandidate & { distSq: number } = {
				targetKind: "door",
				targetId: door.id,
				slotIndex,
				outwardX: outward.x,
				outwardZ: outward.z,
				doorSide,
				distSq,
			};
			if (!best || candidate.distSq < best.distSq) {
				best = candidate;
			}
		}

		for (const controller of this.vaultControllers.values()) {
			if (controller.vault.isDoorOpen || !controller.isInInteractionRange(player)) {
				continue;
			}
			const dx = player.x - controller.vault.x;
			const dz = player.z - controller.vault.z;
			const distSq = dx * dx + dz * dz;
			const candidate: TrapPlacementCandidate & { distSq: number } = {
				targetKind: "vault",
				targetId: controller.vault.id,
				slotIndex,
				outwardX: 1,
				outwardZ: 0,
				doorSide: 1,
				distSq,
			};
			if (!best || candidate.distSq < best.distSq) {
				best = candidate;
			}
		}

		for (const controller of this.fileCabinetControllers.values()) {
			if (!controller.isInRange(player) || !controller.isPlayerInFront(player)) {
				continue;
			}
			const dx = player.x - controller.placementSnapshot.x;
			const dz = player.z - controller.placementSnapshot.z;
			const distSq = dx * dx + dz * dz;
			const outward = this.outwardForCabinetFacing(controller.placementSnapshot.facing);
			const candidate: TrapPlacementCandidate & { distSq: number } = {
				targetKind: "file_cabinet",
				targetId: controller.cabinet.id,
				slotIndex,
				outwardX: outward.x,
				outwardZ: outward.z,
				doorSide: 1,
				distSq,
			};
			if (!best || candidate.distSq < best.distSq) {
				best = candidate;
			}
		}

		for (const controller of this.escapeLadderControllers.values()) {
			if (!controller.isInRange(player)) {
				continue;
			}
			const dx = player.x - controller.placementSnapshot.x;
			const dz = player.z - controller.placementSnapshot.z;
			const distSq = dx * dx + dz * dz;
			const outward = this.outwardCardinalFromObjectToPlayer(
				controller.placementSnapshot.x,
				controller.placementSnapshot.z,
				player,
			);
			const candidate: TrapPlacementCandidate & { distSq: number } = {
				targetKind: "escape_ladder",
				targetId: controller.ladder.id,
				slotIndex,
				outwardX: outward.x,
				outwardZ: outward.z,
				doorSide: 1,
				distSq,
			};
			if (!best || candidate.distSq < best.distSq) {
				best = candidate;
			}
		}

		for (const controller of this.suitcaseControllers.values()) {
			if (!controller.isGrounded() || !controller.isInRange(player)) {
				continue;
			}
			const distSq = controller.distanceSqTo(player);
			const outward = this.outwardFromObjectToPlayer(controller.suitcase.x, controller.suitcase.z, player);
			const candidate: TrapPlacementCandidate & { distSq: number } = {
				targetKind: "suitcase",
				targetId: controller.suitcase.id,
				slotIndex,
				outwardX: outward.x,
				outwardZ: outward.z,
				doorSide: 1,
				distSq,
			};
			if (!best || candidate.distSq < best.distSq) {
				best = candidate;
			}
		}

		for (const controller of this.keycardControllers.values()) {
			if (!controller.isGrounded() || !controller.isInRange(player)) {
				continue;
			}
			const distSq = controller.distanceSqTo(player);
			const outward = this.outwardFromObjectToPlayer(controller.keycard.x, controller.keycard.z, player);
			const candidate: TrapPlacementCandidate & { distSq: number } = {
				targetKind: "keycard",
				targetId: controller.keycard.id,
				slotIndex,
				outwardX: outward.x,
				outwardZ: outward.z,
				doorSide: 1,
				distSq,
			};
			if (!best || candidate.distSq < best.distSq) {
				best = candidate;
			}
		}

		if (!best) {
			return null;
		}
		return {
			targetKind: best.targetKind,
			targetId: best.targetId,
			slotIndex: best.slotIndex,
			outwardX: best.outwardX,
			outwardZ: best.outwardZ,
			doorSide: best.doorSide,
		};
	}

	private canContinueTrapPlacement(sessionId: string, player: Player): boolean {
		const pending = this.pendingTrapPlacement.get(sessionId);
		if (!pending) {
			return false;
		}
		const trapPoint = this.state.trapPoints.get(this.trapPointId(sessionId, pending.slotIndex));
		if (!trapPoint || trapPoint.status !== "unused") {
			return false;
		}
		return this.canPlaceTrapAtTarget(player, pending.targetKind, pending.targetId);
	}

	private canPlaceTrapAtTarget(player: Player, targetKind: TrapTargetKind, targetId: string): boolean {
		if (targetKind === "door") {
			const door = this.state.interactables.get(targetId);
			if (!door) {
				return false;
			}
			const dx = player.x - door.x;
			const dz = player.z - door.z;
			return dx * dx + dz * dz <= door.range * door.range;
		}
		if (targetKind === "vault") {
			const controller = this.vaultControllers.get(targetId);
			return !!controller && !controller.vault.isDoorOpen && controller.isInInteractionRange(player);
		}
		if (targetKind === "file_cabinet") {
			const controller = this.fileCabinetControllers.get(targetId);
			return !!controller && controller.isInRange(player) && controller.isPlayerInFront(player);
		}
		if (targetKind === "escape_ladder") {
			const controller = this.escapeLadderControllers.get(targetId);
			return !!controller && controller.isInRange(player);
		}
		if (targetKind === "suitcase") {
			const controller = this.suitcaseControllers.get(targetId);
			return !!controller && controller.isGrounded() && controller.isInRange(player);
		}
		const controller = this.keycardControllers.get(targetId);
		return !!controller && controller.isGrounded() && controller.isInRange(player);
	}

	private tickInteractions(deltaMs: number) {
		for (const [sessionId, player] of this.state.players.entries()) {
			if (!player.isAlive) {
				if (player.isInteracting) {
					this.cancelInteraction(sessionId, player);
				}
				continue;
			}
			if (!player.isInteracting) {
				continue;
			}
			if (player.interactionKind === "trap_place") {
				if (!this.trapHold.get(sessionId)) {
					this.cancelInteraction(sessionId, player);
					continue;
				}
				if (!this.canContinueTrapPlacement(sessionId, player)) {
					this.cancelInteraction(sessionId, player);
					continue;
				}
			} else {
				if (!this.interactionHold.get(sessionId)) {
					this.cancelInteraction(sessionId, player);
					continue;
				}
				if (!this.canContinueInteraction(player)) {
					this.cancelInteraction(sessionId, player);
					continue;
				}
			}
			player.interactionElapsedMs = Math.min(
				player.interactionDurationMs,
				player.interactionElapsedMs + deltaMs,
			);
			if (player.interactionElapsedMs >= player.interactionDurationMs) {
				if (player.interactionKind === "trap_place") {
					this.completeTrapPlacement(sessionId, player);
				} else {
					this.completeInteraction(sessionId, player);
				}
			}
		}
	}

	private canContinueInteraction(player: Player): boolean {
		if (player.interactionKind === "vault") {
			const controller = this.vaultControllers.get(player.interactionTargetId);
			if (!controller) {
				return false;
			}
			return controller.vault.isUnlocked && !controller.vault.isDoorOpen;
		}
		if (player.interactionKind === "file_cabinet") {
			const controller = this.fileCabinetControllers.get(player.interactionTargetId);
			if (!controller) {
				return false;
			}
			return (
				controller.hasUnsearchedDrawer() &&
				controller.isInRange(player) &&
				controller.isPlayerInFront(player)
			);
		}
		if (player.interactionKind === "escape_ladder") {
			const controller = this.escapeLadderControllers.get(player.interactionTargetId);
			return !!controller && controller.isInRange(player);
		}
		return false;
	}

	private completeInteraction(sessionId: string, player: Player) {
		if (player.interactionKind === "vault") {
			const controller = this.vaultControllers.get(player.interactionTargetId);
			if (controller && controller.vault.isUnlocked && !controller.vault.isDoorOpen) {
				for (const event of controller.completeInteraction()) {
					this.emitInteractableEvent(event);
				}
				const suitcase = this.findPrimarySuitcase();
				if (suitcase) {
					const event = suitcase.forceCarry(sessionId);
					this.emitInteractableEvent(event);
				}
			}
		} else if (player.interactionKind === "file_cabinet") {
			const controller = this.fileCabinetControllers.get(player.interactionTargetId);
			if (controller && controller.canCompleteInteraction(player)) {
				const trap = this.findActiveTrapForTarget("file_cabinet", controller.cabinet.id);
				if (trap) {
					this.triggerTrap(trap, sessionId);
					this.resetInteractionState(player);
					return;
				}
				for (const event of controller.completeInteraction(sessionId)) {
					this.emitInteractableEvent(event);
				}
			}
		} else if (player.interactionKind === "escape_ladder") {
			const controller = this.escapeLadderControllers.get(player.interactionTargetId);
			if (controller && controller.canCompleteInteraction(player)) {
				const trap = this.findActiveTrapForTarget("escape_ladder", controller.ladder.id);
				if (trap) {
					this.triggerTrap(trap, sessionId);
					this.resetInteractionState(player);
					return;
				}
				const carriedSuitcase = this.findCarriedSuitcase(sessionId);
				if (carriedSuitcase) {
					carriedSuitcase.setUsed();
					if (!this.exitFoundBroadcasted) {
						this.exitFoundBroadcasted = true;
						this.emitTickerEvent({ event: "exit_found" });
					}
				}
			}
		}
		this.resetInteractionState(player);
	}

	private completeTrapPlacement(sessionId: string, player: Player) {
		const pending = this.pendingTrapPlacement.get(sessionId);
		if (!pending) {
			this.resetInteractionState(player);
			return;
		}
		this.pendingTrapPlacement.delete(sessionId);
		const trapPoint = this.state.trapPoints.get(this.trapPointId(sessionId, pending.slotIndex));
		if (!trapPoint || trapPoint.status !== "unused") {
			this.resetInteractionState(player);
			return;
		}

		const existingTrap = this.findActiveTrapForTarget(pending.targetKind, pending.targetId);
		if (existingTrap) {
			trapPoint.status = "used";
			trapPoint.trapId = "";
			this.resetInteractionState(player);
			this.triggerTrap(existingTrap, sessionId);
			return;
		}

		const trap = new TrapState();
		trap.id = this.createTrapId(sessionId, pending.slotIndex);
		trap.ownerSessionId = sessionId;
		trap.targetKind = pending.targetKind;
		trap.targetId = pending.targetId;
		trap.status = "active";
		trap.trapPointSlotIndex = pending.slotIndex;
		trap.placedAtMs = Date.now();
		trap.ownerGraceUntilMs =
			pending.targetKind === "door" ? trap.placedAtMs + DOOR_TRAP_OWNER_GRACE_MS : 0;
		trap.outwardX = pending.outwardX;
		trap.outwardZ = pending.outwardZ;
		trap.doorSide = pending.doorSide;
		this.state.traps.set(trap.id, trap);
		trapPoint.status = "active";
		trapPoint.trapId = trap.id;

		this.resetInteractionState(player);
	}

	private cancelInteraction(sessionId: string, player: Player) {
		if (!player.isInteracting) {
			return;
		}
		this.pendingTrapPlacement.delete(sessionId);
		this.resetInteractionState(player);
	}

	private resetInteractionState(player: Player) {
		player.isInteracting = false;
		player.interactionKind = "";
		player.interactionTargetId = "";
		player.interactionElapsedMs = 0;
		player.interactionDurationMs = 0;
		player.interactionStyle = "normal";
		player.interactionTrapSlotIndex = -1;
	}

	private findPrimarySuitcase(): SuitcaseController | null {
		return this.suitcaseControllers.values().next().value ?? null;
	}

	private initializeTrapPoints(sessionId: string) {
		for (let slot = 0; slot < TRAP_POINT_COUNT; slot++) {
			const point = new TrapPointState();
			point.id = this.trapPointId(sessionId, slot);
			point.ownerSessionId = sessionId;
			point.slotIndex = slot;
			point.status = "unused";
			point.trapId = "";
			this.state.trapPoints.set(point.id, point);
		}
	}

	private removeTrapPoints(sessionId: string) {
		for (let slot = 0; slot < TRAP_POINT_COUNT; slot++) {
			this.state.trapPoints.delete(this.trapPointId(sessionId, slot));
		}
	}

	private removeOwnedTraps(sessionId: string) {
		const ownedTrapIds: string[] = [];
		for (const trap of this.state.traps.values()) {
			if (trap.ownerSessionId !== sessionId) {
				continue;
			}
			ownedTrapIds.push(trap.id);
		}
		for (const trapId of ownedTrapIds) {
			this.state.traps.delete(trapId);
		}
	}

	private trapPointId(ownerSessionId: string, slotIndex: number): string {
		return `trap_point_${ownerSessionId}_${slotIndex}`;
	}

	private isInteractionTargetBusy(
		interactionKind: "vault" | "file_cabinet" | "escape_ladder" | "trap_place",
		targetId: string,
		excludingSessionId: string,
	): boolean {
		for (const [sessionId, other] of this.state.players.entries()) {
			if (sessionId === excludingSessionId) {
				continue;
			}
			if (!other.isAlive || !other.isInteracting) {
				continue;
			}
			if (other.interactionKind !== interactionKind) {
				continue;
			}
			if (other.interactionTargetId !== targetId) {
				continue;
			}
			return true;
		}
		return false;
	}

	private findFirstUnusedTrapPointSlot(ownerSessionId: string): number {
		for (let slot = 0; slot < TRAP_POINT_COUNT; slot++) {
			const trapPoint = this.state.trapPoints.get(this.trapPointId(ownerSessionId, slot));
			if (trapPoint?.status === "unused") {
				return slot;
			}
		}
		return -1;
	}

	private findActiveTrapForTarget(targetKind: TrapTargetKind, targetId: string): TrapState | null {
		for (const trap of this.state.traps.values()) {
			if (trap.status !== "active") {
				continue;
			}
			if (trap.targetKind === targetKind && trap.targetId === targetId) {
				return trap;
			}
		}
		return null;
	}

	private triggerTrap(trap: TrapState, triggeringSessionId: string, blastDirection?: XY) {
		if (trap.status !== "active") {
			return;
		}
		if (!this.state.traps.has(trap.id)) {
			return;
		}
		trap.status = "triggered";
		const ownerPoint = this.state.trapPoints.get(this.trapPointId(trap.ownerSessionId, trap.trapPointSlotIndex));
		if (ownerPoint) {
			ownerPoint.status = "used";
			ownerPoint.trapId = trap.id;
		}
		const triggeringPlayer = this.state.players.get(triggeringSessionId);
		const explosionOrigin =
			this.resolveTrapOrigin(trap) ??
			(triggeringPlayer ? { x: triggeringPlayer.x, z: triggeringPlayer.z } : null);
		if (explosionOrigin) {
			this.broadcast("explosion_event", {
				x: explosionOrigin.x,
				z: explosionOrigin.z,
				range: TRAP_EXPLOSION_AUDIO_RANGE,
			});
		}
		this.state.traps.delete(trap.id);
		this.killPlayer(triggeringSessionId, trap, blastDirection);
	}

	private killPlayer(sessionId: string, triggerTrap?: TrapState, blastDirection?: XY) {
		const player = this.state.players.get(sessionId);
		if (!player || !player.isAlive) {
			return;
		}
		player.isAlive = false;
		if (player.isInteracting) {
			this.cancelInteraction(sessionId, player);
		}
		this.interactionHold.delete(sessionId);
		this.trapHold.delete(sessionId);
		this.pendingTrapPlacement.delete(sessionId);
		this.input.set(sessionId, { x: 0, z: 0 });
		this.startDeadKnockback(sessionId, player, triggerTrap, blastDirection);
		const deathDrop = this.computeNearbyDropPosition(player);

		const carried = this.findCarriedKeycard(sessionId);
		if (carried) {
			const event = carried.drop(sessionId, deathDrop.x, deathDrop.z);
			if (event) {
				this.emitInteractableEvent(event);
			}
		}
		const carriedSuitcase = this.findCarriedSuitcase(sessionId);
		if (carriedSuitcase) {
			const event = carriedSuitcase.drop(sessionId, deathDrop.x, deathDrop.z);
			if (event) {
				this.emitInteractableEvent(event);
			}
		}

		const payload: Extract<GameServerMessages["ticker_event"], { event: "agent_died" }> = {
			event: "agent_died",
			agentName: player.name,
		};
		this.emitTickerEvent(payload);
	}

	private buildServerBotSnapshot(sessionId: string, team: GameTeam, nowMs: number): BotPerceptionSnapshot {
		const doors: BotPerceptionSnapshot["doors"] = Array.from(this.state.interactables.values(), (door) => ({
			id: door.id,
			x: door.x,
			z: door.z,
			isOpen: door.isOpen,
			range: door.range,
			facing: door.facing === "z" ? "z" : "x",
			roomA: null as number | null,
			roomB: null as number | null,
		}));
		const map = buildMapAwareness(this.state.mapSeed, this.state.mapMaxDistance, doors);
		const players: BotPerceptionSnapshot["players"] = Array.from(this.state.players.entries(), ([id, player]) => ({
			sessionId: id,
			x: player.x,
			z: player.z,
			isAlive: player.isAlive,
			isInteracting: player.isInteracting,
			interactionKind: player.interactionKind,
			interactionTargetId: player.interactionTargetId,
			roomId: null as number | null,
		}));
		const self = players.find((player) => player.sessionId === sessionId) ?? null;
		const keycards: BotPerceptionSnapshot["keycards"] = Array.from(this.state.keycards.values(), (card) => ({
			id: card.id,
			color: card.color === "red" ? "red" : "blue",
			x: card.worldX,
			z: card.worldZ,
			state: card.state,
			carrierSessionId: card.carrierSessionId,
			roomId: null as number | null,
			range: card.range,
		}));
		const vaults: BotPerceptionSnapshot["vaults"] = Array.from(this.state.vaults.values(), (vault) => ({
			id: vault.id,
			x: vault.x,
			z: vault.z,
			range: vault.range,
			isUnlocked: vault.isUnlocked,
			isDoorOpen: vault.isDoorOpen,
			roomId: null as number | null,
		}));
		const suitcases: BotPerceptionSnapshot["suitcases"] = Array.from(this.state.suitcases.values(), (suitcase) => ({
			id: suitcase.id,
			x: suitcase.worldX,
			z: suitcase.worldZ,
			state: suitcase.state,
			carrierSessionId: suitcase.carrierSessionId,
			containerId: suitcase.containerId,
			roomId: null as number | null,
			range: suitcase.range,
		}));
		const knownLadder = map.escapeLadder;
		const escapeLadders: BotPerceptionSnapshot["escapeLadders"] = Array.from(
			this.state.escapeLadders.values(),
			(ladder) => ({
				id: ladder.id,
				x: knownLadder?.x ?? 0,
				z: knownLadder?.z ?? 0,
				range: knownLadder?.range ?? 2.1,
				roomId: null as number | null,
			}),
		);
		const traps: BotPerceptionSnapshot["traps"] = Array.from(this.state.traps.values(), (trap) => ({
			id: trap.id,
			ownerSessionId: trap.ownerSessionId,
			targetKind: trap.targetKind,
			targetId: trap.targetId,
			status: trap.status,
		}));
		const trapPoints: BotPerceptionSnapshot["trapPoints"] = Array.from(
			this.state.trapPoints.values(),
			(point) => ({
				id: point.id,
				ownerSessionId: point.ownerSessionId,
				slotIndex: point.slotIndex,
				status: point.status,
				trapId: point.trapId,
			}),
		);
		const fileCabinets: BotPerceptionSnapshot["fileCabinets"] = Array.from(
			this.state.fileCabinets.values(),
			(cabinet) => ({
				id: cabinet.id,
				searchedMask: cabinet.searchedMask,
				roomId: null as number | null,
			}),
		);
		return {
			timeMs: nowMs,
			team,
			map,
			selfSessionId: sessionId,
			self,
			players,
			doors,
			keycards,
			vaults,
			suitcases,
			escapeLadders,
			traps,
			trapPoints,
			fileCabinets,
		};
	}

	private emitInteractableEvent(
		event: GameServerMessages["interactable_event"],
		options?: { except?: Client },
	): void {
		this.broadcast("interactable_event", event, options);
		this.enqueueBotEvent({ type: "interactable_event", message: event, timeMs: Date.now() });
	}

	private emitTickerEvent(event: GameServerMessages["ticker_event"]): void {
		this.broadcast("ticker_event", event);
		this.enqueueBotEvent({ type: "ticker_event", message: event, timeMs: Date.now() });
	}

	private enqueueBotEvent(event: BotEventEnvelope): void {
		for (const bot of this.serverBots.values()) {
			bot.runtime.enqueueEvent(event);
		}
	}

	private tickDeadKnockback(dt: number, walls: WallRect[]) {
		for (const [sessionId, knockback] of this.deadKnockback.entries()) {
			const player = this.state.players.get(sessionId);
			if (!player || player.isAlive) {
				this.deadKnockback.delete(sessionId);
				continue;
			}
			if (knockback.remainingDistance <= 0) {
				this.deadKnockback.delete(sessionId);
				continue;
			}
			const desiredStep = Math.min(knockback.remainingDistance, knockback.speed * dt);
			if (desiredStep <= 0.0001) {
				this.deadKnockback.delete(sessionId);
				continue;
			}
			const next = moveWithCollision(
				player.x,
				player.z,
				knockback.dirX * desiredStep,
				knockback.dirZ * desiredStep,
				walls,
			);
			const moved = Math.hypot(next.x - player.x, next.z - player.z);
			player.x = next.x;
			player.z = next.z;
			knockback.remainingDistance = Math.max(0, knockback.remainingDistance - moved);
			// If blocked almost immediately, stop the knockback to avoid jittering against collision.
			if (moved < desiredStep * 0.15 || knockback.remainingDistance <= 0.01) {
				this.deadKnockback.delete(sessionId);
			}
		}
	}

	private checkDoorTrapCrossings(previousPositionBySessionId: ReadonlyMap<string, XY>) {
		const nowMs = Date.now();
		for (const trap of this.state.traps.values()) {
			if (trap.status !== "active" || trap.targetKind !== "door") {
				continue;
			}
			const door = this.state.interactables.get(trap.targetId);
			if (!door) {
				continue;
			}
			for (const [sessionId, player] of this.state.players.entries()) {
				if (!player.isAlive) {
					continue;
				}
				if (trap.ownerSessionId === sessionId && nowMs < trap.ownerGraceUntilMs) {
					continue;
				}
				const prev = previousPositionBySessionId.get(sessionId);
				if (!prev) {
					continue;
				}
				if (!this.didCrossDoorPlane(door, prev, { x: player.x, z: player.z })) {
					continue;
				}
				const nextPosition = { x: player.x, z: player.z };
				const blastDirection = this.computeDoorBlastDirection(door, prev, nextPosition);
				this.triggerTrap(trap, sessionId, blastDirection);
				break;
			}
		}
	}

	private computeDoorBlastDirection(door: DoorState, prev: XY, next: XY): XY {
		if (door.facing === "z") {
			const dz = next.z - prev.z;
			if (Math.abs(dz) > 0.0001) {
				return { x: 0, z: dz > 0 ? -1 : 1 };
			}
			return { x: 0, z: prev.z >= door.z ? 1 : -1 };
		}
		const dx = next.x - prev.x;
		if (Math.abs(dx) > 0.0001) {
			return { x: dx > 0 ? -1 : 1, z: 0 };
		}
		return { x: prev.x >= door.x ? 1 : -1, z: 0 };
	}

	private didCrossDoorPlane(door: DoorState, prev: XY, next: XY): boolean {
		const halfSpan = CELL_SIZE / 2 + DOOR_TRAP_CROSSING_MARGIN;
		if (door.facing === "z") {
			if (Math.abs(prev.x - door.x) > halfSpan && Math.abs(next.x - door.x) > halfSpan) {
				return false;
			}
			const a = prev.z - door.z;
			const b = next.z - door.z;
			if (Math.abs(a) < 0.02 && Math.abs(b) < 0.02) {
				return false;
			}
			return a * b <= 0;
		}
		if (Math.abs(prev.z - door.z) > halfSpan && Math.abs(next.z - door.z) > halfSpan) {
			return false;
		}
		const a = prev.x - door.x;
		const b = next.x - door.x;
		if (Math.abs(a) < 0.02 && Math.abs(b) < 0.02) {
			return false;
		}
		return a * b <= 0;
	}

	private createTrapId(sessionId: string, slotIndex: number): string {
		const suffix = Math.floor(Math.random() * 0x100000)
			.toString(16)
			.padStart(5, "0");
		return `trap_${sessionId}_${slotIndex}_${Date.now()}_${suffix}`;
	}

	private computeDoorSide(door: DoorState, player: Player): number {
		if (door.facing === "z") {
			return player.z >= door.z ? 1 : -1;
		}
		return player.x >= door.x ? 1 : -1;
	}

	private outwardForCabinetFacing(facing: FileCabinetFacing): XY {
		if (facing === "north") {
			return { x: 0, z: -1 };
		}
		if (facing === "east") {
			return { x: 1, z: 0 };
		}
		if (facing === "west") {
			return { x: -1, z: 0 };
		}
		return { x: 0, z: 1 };
	}

	private outwardFromObjectToPlayer(x: number, z: number, player: Player): XY {
		const dx = player.x - x;
		const dz = player.z - z;
		const len = Math.hypot(dx, dz);
		if (len <= 0.001) {
			return { x: 0, z: 1 };
		}
		return { x: dx / len, z: dz / len };
	}

	private outwardCardinalFromObjectToPlayer(x: number, z: number, player: Player): XY {
		const dx = player.x - x;
		const dz = player.z - z;
		// Snap to cardinal directions so trap visuals align cleanly.
		if (Math.abs(dx) >= Math.abs(dz)) {
			return { x: dx >= 0 ? 1 : -1, z: 0 };
		}
		return { x: 0, z: dz >= 0 ? 1 : -1 };
	}

	private computeNearbyDropPosition(player: Player): XY {
		const walls = this.currentCollisionWalls();
		const vaultAvoidRadiusSq = (CELL_SIZE * 0.38) * (CELL_SIZE * 0.38);
		const baseAngle = Math.random() * Math.PI * 2;
		let best: { x: number; z: number; moved: number } = { x: player.x, z: player.z, moved: 0 };
		for (let i = 0; i < 14; i++) {
			const angle = baseAngle + (Math.PI * 2 * i) / 14;
			const radius = 0.38 + (i % 4) * 0.14;
			const candidate = moveWithCollision(
				player.x,
				player.z,
				Math.cos(angle) * radius,
				Math.sin(angle) * radius,
				walls,
			);
			let blockedByVault = false;
			for (const vault of this.state.vaults.values()) {
				const dx = candidate.x - vault.x;
				const dz = candidate.z - vault.z;
				if (dx * dx + dz * dz <= vaultAvoidRadiusSq) {
					blockedByVault = true;
					break;
				}
			}
			if (blockedByVault) {
				continue;
			}
			const moved = Math.hypot(candidate.x - player.x, candidate.z - player.z);
			if (moved > best.moved) {
				best = { x: candidate.x, z: candidate.z, moved };
			}
		}
		return { x: best.x, z: best.z };
	}

	private currentCollisionWalls(): WallRect[] {
		const dynamicWalls = buildClosedDoorWalls(
			Array.from(this.state.interactables.values(), (door) => ({
				x: door.x,
				z: door.z,
				facing: door.facing === "z" ? "z" : "x",
				isOpen: door.isOpen,
			})),
		);
		return [...this.staticWalls, ...dynamicWalls];
	}

	private startDeadKnockback(
		sessionId: string,
		player: Player,
		triggerTrap?: TrapState,
		blastDirection?: XY,
	) {
		if (!triggerTrap) {
			this.deadKnockback.delete(sessionId);
			return;
		}
		let direction = this.computeTrapBlastDirection(triggerTrap, player);
		if (blastDirection) {
			const len = Math.hypot(blastDirection.x, blastDirection.z);
			if (len > 0.001) {
				direction = { x: blastDirection.x / len, z: blastDirection.z / len };
			}
		}
		const travelDistance =
			DEAD_KNOCKBACK_MIN_DISTANCE +
			Math.random() * (DEAD_KNOCKBACK_MAX_DISTANCE - DEAD_KNOCKBACK_MIN_DISTANCE);
		this.deadKnockback.set(sessionId, {
			dirX: direction.x,
			dirZ: direction.z,
			remainingDistance: travelDistance,
			speed: DEAD_KNOCKBACK_SPEED,
		});
	}

	private computeTrapBlastDirection(trap: TrapState, player: Player): XY {
		const origin = this.resolveTrapOrigin(trap);
		if (origin) {
			const dx = player.x - origin.x;
			const dz = player.z - origin.z;
			const len = Math.hypot(dx, dz);
			if (len > 0.001) {
				return { x: dx / len, z: dz / len };
			}
		}
		const fallbackX = trap.outwardX;
		const fallbackZ = trap.outwardZ;
		const fallbackLen = Math.hypot(fallbackX, fallbackZ);
		if (fallbackLen > 0.001) {
			return { x: fallbackX / fallbackLen, z: fallbackZ / fallbackLen };
		}
		return { x: 0, z: 1 };
	}

	private resolveTrapOrigin(trap: TrapState): XY | null {
		if (trap.targetKind === "door") {
			const door = this.state.interactables.get(trap.targetId);
			if (!door) {
				return null;
			}
			const halfOpening = door.variant === "double" ? 1.1 : 0.56;
			const sideOffset = 0.24;
			const side = trap.doorSide >= 0 ? 1 : -1;
			const oppositeHingeSide = door.hingeSide === "left" ? 1 : -1;
			if (door.facing === "z") {
				return {
					x: door.x + oppositeHingeSide * halfOpening,
					z: door.z + side * sideOffset,
				};
			}
			return {
				x: door.x + side * sideOffset,
				z: door.z + oppositeHingeSide * halfOpening,
			};
		}
		if (trap.targetKind === "vault") {
			const vault = this.vaultControllers.get(trap.targetId)?.vault;
			if (!vault) {
				return null;
			}
			return { x: vault.x + 0.96, z: vault.z + CELL_SIZE / 2 + 0.2 };
		}
		if (trap.targetKind === "file_cabinet") {
			const placement = this.fileCabinetControllers.get(trap.targetId)?.placementSnapshot;
			if (!placement) {
				return null;
			}
			return {
				x: placement.x + trap.outwardX * 0.42,
				z: placement.z + trap.outwardZ * 0.42,
			};
		}
		if (trap.targetKind === "escape_ladder") {
			const placement = this.escapeLadderControllers.get(trap.targetId)?.placementSnapshot;
			if (!placement) {
				return null;
			}
			return {
				x: placement.x + trap.outwardX * 0.28,
				z: placement.z + trap.outwardZ * 0.28,
			};
		}
		if (trap.targetKind === "suitcase") {
			const suitcase = this.suitcaseControllers.get(trap.targetId)?.suitcase;
			if (!suitcase) {
				return null;
			}
			return {
				x: suitcase.worldX + trap.outwardX * 0.36,
				z: suitcase.worldZ + trap.outwardZ * 0.36,
			};
		}
		if (trap.targetKind === "keycard") {
			const keycard = this.keycardControllers.get(trap.targetId)?.keycard;
			if (!keycard) {
				return null;
			}
			return {
				x: keycard.worldX + trap.outwardX * 0.32,
				z: keycard.worldZ + trap.outwardZ * 0.32,
			};
		}
		return null;
	}
}
