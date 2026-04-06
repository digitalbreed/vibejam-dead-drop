export { GameState, Player } from "./schema/GameState.js";
export { InteractableState, DoorState } from "./schema/Interactables.js";
export * from "./map/index.js";

/** Match flow before/after the Colyseus room locks for a running round. */
export type GamePhase = "lobby" | "playing";

/** Client → server messages for `GameRoom`. */
export type GameClientMessages = {
	input: { x: number; z: number };
};

/** Server → client transient gameplay events. */
export type GameServerMessages = {
	interactable_event: {
		id: string;
		kind: "door";
		action: "opened" | "closed";
	};
};
