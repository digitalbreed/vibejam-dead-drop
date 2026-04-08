import { Room, Client } from "colyseus";
import {
	buildVaultCollisionWalls,
	DoorState,
	FileCabinetState,
	GameState,
	generateFileCabinetPlacements,
	generateVaultPlacement,
	KeycardState,
	Player,
	SuitcaseState,
	VaultState,
	buildClosedDoorWalls,
	buildCollisionWalls,
	buildFileCabinetCollisionWalls,
	generateDoorPlacements,
	generateKeycardPlacements,
	generateMapLayout,
	moveWithCollision,
	type GameTeam,
	spawnInCenterHub,
	type GameClientMessages,
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
	};

	onCreate(options: { mapMaxDistance?: number }) {
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

	onJoin(client: Client) {
		const player = new Player();
		const spawn = spawnInCenterHub(this.state.mapSeed, client.sessionId);
		player.x = spawn.x;
		player.z = spawn.z;
		const existingColors = new Set<number>();
		for (const existing of this.state.players.values()) {
			existingColors.add(existing.color);
		}
		player.color = pickUniqueColor(existingColors, client.sessionId);
		this.state.players.set(client.sessionId, player);
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
	}

	onDispose() {
		this.input.clear();
		this.interactionHold.clear();
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
		for (const controller of this.doorControllers) {
			const events = controller.tick(this.state.players.values(), deltaMs);
			for (const event of events) {
				this.broadcast("interactable_event", event);
			}
		}
		for (const controller of this.vaultControllers.values()) {
			const events = controller.tick(this.state.players.values(), deltaMs);
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
			const inp = this.input.get(sessionId) ?? { x: 0, z: 0 };
			const next = moveWithCollision(player.x, player.z, inp.x * speed * dt, inp.z * speed * dt, walls);
			player.x = next.x;
			player.z = next.z;
		});
		this.tickInteractions(deltaMs);
	}

	private createInteractables() {
		this.state.interactables.clear();
		this.state.keycards.clear();
		this.state.suitcases.clear();
		this.state.vaults.clear();
		this.state.fileCabinets.clear();
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
		if (!player) {
			return;
		}
		if (!active) {
			if (player.isInteracting && player.interactionElapsedMs >= player.interactionDurationMs - 50) {
				this.completeInteraction(sessionId, player);
				return;
			}
			this.cancelInteraction(player);
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
		player.isInteracting = true;
		player.interactionKind = candidate.kind;
		player.interactionTargetId = candidate.id;
		player.interactionElapsedMs = 0;
		player.interactionDurationMs = candidate.durationMs;
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

	private tickInteractions(deltaMs: number) {
		for (const [sessionId, player] of this.state.players.entries()) {
			if (!player.isInteracting) {
				continue;
			}
			if (!this.interactionHold.get(sessionId)) {
				this.cancelInteraction(player);
				continue;
			}
			if (!this.canContinueInteraction(player)) {
				this.cancelInteraction(player);
				continue;
			}
			player.interactionElapsedMs = Math.min(
				player.interactionDurationMs,
				player.interactionElapsedMs + deltaMs,
			);
			if (player.interactionElapsedMs >= player.interactionDurationMs) {
				this.completeInteraction(sessionId, player);
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

	private cancelInteraction(player: Player) {
		if (!player.isInteracting) {
			return;
		}
		this.resetInteractionState(player);
	}

	private resetInteractionState(player: Player) {
		player.isInteracting = false;
		player.interactionKind = "";
		player.interactionTargetId = "";
		player.interactionElapsedMs = 0;
		player.interactionDurationMs = 0;
	}

	private findPrimarySuitcase(): SuitcaseController | null {
		return this.suitcaseControllers.values().next().value ?? null;
	}
}
