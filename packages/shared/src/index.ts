export { GameState, Player } from "./schema/GameState.js";
export { InteractableState, DoorState, KeycardState, SuitcaseState, VaultState } from "./schema/Interactables.js";
export * from "./map/index.js";

/** Match flow before/after the Colyseus room locks for a running round. */
export type GamePhase = "lobby" | "playing";

/** Client -> server messages for `GameRoom`. */
export type GameClientMessages = {
	input: { x: number; z: number };
	interact: {};
	interact_hold: { active: boolean };
};

/** Server -> client transient gameplay events. */
export type GameServerMessages = {
	interactable_event:
		| {
				id: string;
				kind: "door";
				action: "opened" | "closed";
		  }
		| {
				id: string;
				kind: "keycard";
				action: "picked_up" | "dropped";
				color: "blue" | "red";
				bySessionId: string;
		  }
		| {
				id: string;
				kind: "suitcase";
				action: "picked_up" | "dropped";
				bySessionId: string;
		  }
		| {
				id: string;
				kind: "vault";
				action: "card_inserted";
				color: "blue" | "red";
				bySessionId: string;
		  }
		| {
				id: string;
				kind: "vault";
				action: "unlocked" | "opened" | "completed";
		  };
	interaction_feedback: {
		kind: "error_beep";
	};
};
