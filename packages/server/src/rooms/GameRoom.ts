import { Room, Client } from "colyseus";
import {
	buildVaultCollisionWalls,
	DoorState,
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
	CELL_SIZE,
	generateDoorPlacements,
	generateKeycardPlacements,
	generateMapLayout,
	moveWithCollision,
	type GameTeam,
	spawnInCenterHub,
	type GameClientMessages,
	type GameServerMessages,
	type MapLayout,
	type WallRect,
} from "@vibejam/shared";
import { DoorController } from "./interactables/DoorController.js";
import { FileCabinetController } from "./interactables/FileCabinetController.js";
import { KeycardController } from "./interactables/KeycardController.js";
import { SuitcaseController } from "./interactables/SuitcaseController.js";
import { VaultController } from "./interactables/VaultController.js";

/** Minimum players before the match starts (1 = solo dev; raise for real matchmaking). */
const MIN_PLAYERS = Number(
	process.env.MIN_PLAYERS ?? (process.env.NODE_ENV === "production" ? 1 : 4),
);

const DEFAULT_MAP_MAX_DISTANCE = Number(process.env.MAP_MAX_DISTANCE ?? 12);
const INTERACTION_DURATION_MS = 5000;
const DOOR_TRAP_OWNER_GRACE_MS = 1000;
const TRAP_POINT_COUNT = 3;
const DOOR_TRAP_CROSSING_MARGIN = 0.24;
const MAX_OPERATOR_NAME_LENGTH = 24;

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

type TrapTargetKind = "door" | "vault" | "file_cabinet" | "suitcase" | "keycard";

type TrapPlacementCandidate = {
	targetKind: TrapTargetKind;
	targetId: string;
	slotIndex: number;
	outwardX: number;
	outwardZ: number;
	doorSide: number;
};

type XY = { x: number; z: number };

type JoinOptions = {
	mapMaxDistance?: number;
	operatorName?: string;
	gameCode?: string;
};

function defaultOperatorName(sessionId: string): string {
	return `Agent ${sessionId.slice(-4).toUpperCase()}`;
}

function resolveOperatorName(raw: unknown, sessionId: string): string {
	if (typeof raw !== "string") {
		return defaultOperatorName(sessionId);
	}
	const compact = raw.replace(/\s+/g, " ").trim();
	if (!compact) {
		return defaultOperatorName(sessionId);
	}
	return compact.slice(0, MAX_OPERATOR_NAME_LENGTH);
}

export class GameRoom extends Room {
	state = new GameState();
	private input = new Map<string, { x: number; z: number }>();
	private layout!: MapLayout;
	private staticWalls: WallRect[] = [];
	private doorControllers: DoorController[] = [];
	private keycardControllers = new Map<string, KeycardController>();
	private suitcaseControllers = new Map<string, SuitcaseController>();
	private vaultControllers = new Map<string, VaultController>();
	private fileCabinetControllers = new Map<string, FileCabinetController>();
	private interactionHold = new Map<string, boolean>();
	private trapHold = new Map<string, boolean>();
	private pendingTrapPlacement = new Map<string, TrapPlacementCandidate>();
	private keycardsPickedUpColors = new Set<string>();
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
	};

	onCreate(options: JoinOptions) {
		this.state.mapSeed = (Math.random() * 0xffffffff) >>> 0;
		const cap = Math.min(64, Math.max(2, options?.mapMaxDistance ?? DEFAULT_MAP_MAX_DISTANCE));
		this.state.mapMaxDistance = cap;
		this.layout = generateMapLayout(this.state.mapSeed, this.state.mapMaxDistance);
		this.staticWalls = buildCollisionWalls(this.layout);
		this.createInteractables();
		this.staticWalls = [
			...this.staticWalls,
			...buildVaultCollisionWalls(Array.from(this.state.vaults.values(), (vault) => ({ x: vault.x, z: vault.z }))),
			...buildFileCabinetCollisionWalls(generateFileCabinetPlacements(this.layout)),
		];
		this.setSimulationInterval((deltaTime) => this.tick(deltaTime), 1000 / 20);
	}

	onJoin(client: Client, options: JoinOptions = {}) {
		const player = new Player();
		const spawn = spawnInCenterHub(this.state.mapSeed, client.sessionId);
		player.x = spawn.x;
		player.z = spawn.z;
		player.name = resolveOperatorName(options.operatorName, client.sessionId);
		const existingColors = new Set<number>();
		for (const existing of this.state.players.values()) {
			existingColors.add(existing.color);
		}
		player.color = pickUniqueColor(existingColors, client.sessionId);
		player.isAlive = true;
		this.state.players.set(client.sessionId, player);
		this.initializeTrapPoints(client.sessionId);
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
		this.removeOwnedTraps(client.sessionId);
		this.removeTrapPoints(client.sessionId);
	}

	onDispose() {
		this.input.clear();
		this.interactionHold.clear();
		this.trapHold.clear();
		this.pendingTrapPlacement.clear();
		this.doorControllers = [];
		this.keycardControllers.clear();
		this.suitcaseControllers.clear();
		this.vaultControllers.clear();
		this.fileCabinetControllers.clear();
	}

	private tryStartMatch() {
		if (this.state.phase !== "lobby") {
			return;
		}
		if (this.clients.length < MIN_PLAYERS) {
			return;
		}
		const assignments = this.assignTeams();
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

	private tick(deltaMs: number) {
		if (this.state.phase !== "playing") {
			return;
		}
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
				this.broadcast("interactable_event", event);
			}
		}
		for (const controller of this.vaultControllers.values()) {
			const events = controller.tick(alivePlayers, deltaMs);
			for (const event of events) {
				this.broadcast("interactable_event", event);
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
		this.checkDoorTrapCrossings(previousPositionBySessionId);
		this.tickInteractions(deltaMs);
	}

	private createInteractables() {
		this.state.interactables.clear();
		this.state.keycards.clear();
		this.state.suitcases.clear();
		this.state.vaults.clear();
		this.state.fileCabinets.clear();
		this.state.traps.clear();
		this.doorControllers = [];
		this.keycardControllers.clear();
		this.suitcaseControllers.clear();
		this.vaultControllers.clear();
		this.fileCabinetControllers.clear();
		this.createVaults();
		this.createDoors();
		this.createKeycards();
		this.createSuitcases();
		this.createFileCabinets();
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

	private handleInteract(client: Client) {
		const sessionId = client.sessionId;
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
				this.broadcast("interactable_event", event, { except: client });
			}
			return;
		}
		const carried = this.findCarriedKeycard(sessionId);
		if (carried) {
			const vault = this.findNearestInsertableVault(player, carried.keycard);
			if (vault) {
				const events = vault.insertCard(carried.keycard, sessionId);
				if (events.length > 0) {
					carried.setContained(vault.vault.id);
				}
				for (const event of events) {
					this.broadcast("interactable_event", event);
				}
				return;
			}
			const event = carried.drop(sessionId, player.x, player.z);
			if (event) {
				this.broadcast("interactable_event", event, { except: client });
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
				this.broadcast("interactable_event", event, { except: client });
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
			this.broadcast("interactable_event", event, { except: client });
			if (!this.keycardsPickedUpColors.has(nearest.keycard.color)) {
				this.keycardsPickedUpColors.add(nearest.keycard.color);
				this.broadcast("ticker_event", { event: "keycard_first_pickup", color: nearest.keycard.color });
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
		if (this.state.phase !== "playing") {
			return;
		}
		const sessionId = client.sessionId;
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
			client.send("interaction_feedback", { kind: "error_beep" });
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
			client.send("interaction_feedback", { kind: "error_beep" });
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
	): { kind: "vault" | "file_cabinet"; id: string; durationMs: number } | null {
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

		if (!nearestCabinet && !nearestVault) {
			return null;
		}
		if (nearestCabinet && (!nearestVault || nearestCabinetDistSq <= nearestVaultDistSq)) {
			return { kind: "file_cabinet", id: nearestCabinet.cabinet.id, durationMs: INTERACTION_DURATION_MS };
		}
		return { kind: "vault", id: nearestVault!.vault.id, durationMs: INTERACTION_DURATION_MS };
	}

	private handleTrapHold(client: Client, active: boolean) {
		if (this.state.phase !== "playing") {
			return;
		}
		const sessionId = client.sessionId;
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
			client.send("interaction_feedback", { kind: "error_beep" });
			return;
		}
		if (this.isInteractionTargetBusy("trap_place", candidate.targetId, sessionId)) {
			client.send("interaction_feedback", { kind: "error_beep" });
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
		return false;
	}

	private completeInteraction(sessionId: string, player: Player) {
		if (player.interactionKind === "vault") {
			const controller = this.vaultControllers.get(player.interactionTargetId);
			if (controller && controller.vault.isUnlocked && !controller.vault.isDoorOpen) {
				for (const event of controller.completeInteraction()) {
					this.broadcast("interactable_event", event);
				}
				const suitcase = this.findPrimarySuitcase();
				if (suitcase) {
					const event = suitcase.forceCarry(sessionId);
					this.broadcast("interactable_event", event);
				}
			}
		} else if (player.interactionKind === "file_cabinet") {
			const controller = this.fileCabinetControllers.get(player.interactionTargetId);
			if (controller && controller.canCompleteInteraction(player)) {
				for (const event of controller.completeInteraction(sessionId)) {
					this.broadcast("interactable_event", event);
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
		interactionKind: "vault" | "file_cabinet" | "trap_place",
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

	private triggerTrap(trap: TrapState, triggeringSessionId: string) {
		if (trap.status !== "active") {
			return;
		}
		trap.status = "triggered";
		const ownerPoint = this.state.trapPoints.get(this.trapPointId(trap.ownerSessionId, trap.trapPointSlotIndex));
		if (ownerPoint) {
			ownerPoint.status = "used";
			ownerPoint.trapId = trap.id;
		}
		this.killPlayer(triggeringSessionId);
	}

	private killPlayer(sessionId: string) {
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

		const carried = this.findCarriedKeycard(sessionId);
		if (carried) {
			const event = carried.drop(sessionId, player.x, player.z);
			if (event) {
				this.broadcast("interactable_event", event);
			}
		}
		const carriedSuitcase = this.findCarriedSuitcase(sessionId);
		if (carriedSuitcase) {
			const event = carriedSuitcase.drop(sessionId, player.x, player.z);
			if (event) {
				this.broadcast("interactable_event", event);
			}
		}

		const payload: Extract<GameServerMessages["ticker_event"], { event: "agent_died" }> = {
			event: "agent_died",
			agentCode: sessionId.slice(-4).toUpperCase(),
		};
		this.broadcast("ticker_event", payload);
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
				this.triggerTrap(trap, sessionId);
				break;
			}
		}
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
}
