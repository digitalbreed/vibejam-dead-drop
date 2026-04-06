import { Schema, MapSchema, type } from "@colyseus/schema";
import { DoorState } from "./Interactables.js";

export class Player extends Schema {
	@type("number") x: number = 0;
	@type("number") z: number = 0;
	/** RGB as a single 24-bit integer (0xrrggbb). */
	@type("number") color: number = 0xffffff;
}

export class GameState extends Schema {
	@type("string") phase: string = "lobby";
	/** Deterministic map layout; clients mirror generation from this + `mapMaxDistance`. */
	@type("number") mapSeed: number = 0;
	/** Max Chebyshev grid distance from origin; controls map size / complexity. */
	@type("number") mapMaxDistance: number = 12;
	@type({ map: Player }) players = new MapSchema<Player>();
	@type({ map: DoorState }) interactables = new MapSchema<DoorState>();
}
