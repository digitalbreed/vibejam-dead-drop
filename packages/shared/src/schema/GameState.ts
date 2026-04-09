import { Schema, MapSchema, type } from "@colyseus/schema";
import {
	DoorState,
	EscapeLadderState,
	FileCabinetState,
	KeycardState,
	SuitcaseState,
	TrapPointState,
	TrapState,
	VaultState,
} from "./Interactables.js";

export class Player extends Schema {
	@type("number") x: number = 0;
	@type("number") z: number = 0;
	@type("string") name: string = "";
	@type("boolean") isBot: boolean = false;
	/** RGB as a single 24-bit integer (0xrrggbb). */
	@type("number") color: number = 0xffffff;
	@type("boolean") isInteracting: boolean = false;
	@type("string") interactionKind: string = "";
	@type("string") interactionTargetId: string = "";
	@type("number") interactionElapsedMs: number = 0;
	@type("number") interactionDurationMs: number = 0;
	@type("string") interactionStyle: string = "normal";
	@type("number") interactionTrapSlotIndex: number = -1;
	@type("boolean") isAlive: boolean = true;
}

export class GameState extends Schema {
	@type("string") phase: string = "lobby";
	/** Target total players for this lobby (humans + server bots). */
	@type("number") lobbyTargetPlayers: number = 4;
	/** Lobby deadline in Unix epoch milliseconds; 0 means not yet armed. */
	@type("number") lobbyDeadlineEpochMs: number = 0;
	/** Deterministic map layout; clients mirror generation from this + `mapMaxDistance`. */
	@type("number") mapSeed: number = 0;
	/** Max Chebyshev grid distance from origin; controls map size / complexity. */
	@type("number") mapMaxDistance: number = 12;
	@type({ map: Player }) players = new MapSchema<Player>();
	@type({ map: DoorState }) interactables = new MapSchema<DoorState>();
	@type({ map: KeycardState }) keycards = new MapSchema<KeycardState>();
	@type({ map: SuitcaseState }) suitcases = new MapSchema<SuitcaseState>();
	@type({ map: VaultState }) vaults = new MapSchema<VaultState>();
	@type({ map: FileCabinetState }) fileCabinets = new MapSchema<FileCabinetState>();
	@type({ map: EscapeLadderState }) escapeLadders = new MapSchema<EscapeLadderState>();
	@type({ map: TrapState }) traps = new MapSchema<TrapState>();
	@type({ map: TrapPointState }) trapPoints = new MapSchema<TrapPointState>();
}
