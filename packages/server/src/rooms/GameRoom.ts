import { Room, Client } from "colyseus";
import {
	DoorState,
	GameState,
	Player,
	buildClosedDoorWalls,
	buildCollisionWalls,
	generateMapLayout,
	generateDoorPlacements,
	moveWithCollision,
	spawnInCenterHub,
	type GameClientMessages,
	type MapLayout,
	type WallRect,
} from "@vibejam/shared";
import { DoorController } from "./interactables/DoorController.js";

/** Minimum players before the match starts (1 = solo dev; raise for real matchmaking). */
const MIN_PLAYERS = Number(process.env.MIN_PLAYERS ?? 1);

const DEFAULT_MAP_MAX_DISTANCE = Number(process.env.MAP_MAX_DISTANCE ?? 12);

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

export class GameRoom extends Room {
	state = new GameState();
	private input = new Map<string, { x: number; z: number }>();
	private layout!: MapLayout;
	private staticWalls: WallRect[] = [];
	private doorControllers: DoorController[] = [];
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
	};

	onCreate(options: { mapMaxDistance?: number }) {
		this.state.mapSeed = (Math.random() * 0xffffffff) >>> 0;
		const cap = Math.min(64, Math.max(2, options?.mapMaxDistance ?? DEFAULT_MAP_MAX_DISTANCE));
		this.state.mapMaxDistance = cap;
		this.layout = generateMapLayout(this.state.mapSeed, this.state.mapMaxDistance);
		this.staticWalls = buildCollisionWalls(this.layout);
		this.createDoors();
		this.setSimulationInterval((deltaTime) => this.tick(deltaTime), 1000 / 20);
	}

	onJoin(client: Client) {
		const player = new Player();
		const spawn = spawnInCenterHub(this.state.mapSeed, client.sessionId);
		player.x = spawn.x;
		player.z = spawn.z;
		player.color = colorForSession(client.sessionId);
		this.state.players.set(client.sessionId, player);
		this.tryStartMatch();
	}

	onLeave(client: Client, _code: number) {
		this.state.players.delete(client.sessionId);
		this.input.delete(client.sessionId);
	}

	onDispose() {
		this.input.clear();
		this.doorControllers = [];
	}

	private tryStartMatch() {
		if (this.state.phase !== "lobby") {
			return;
		}
		if (this.clients.length < MIN_PLAYERS) {
			return;
		}
		this.state.phase = "playing";
		this.lock();
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
	}

	private createDoors() {
		this.state.interactables.clear();
		this.doorControllers = [];
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
}
