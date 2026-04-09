export { GameState, Player } from "./schema/GameState.js";
export {
	type InteractableBaseFields,
	DoorState,
	KeycardState,
	SuitcaseState,
	VaultState,
	FileCabinetState,
	EscapeLadderState,
	TrapState,
	TrapPointState,
} from "./schema/Interactables.js";
export * from "./map/index.js";
export * from "./bots/index.js";

/** Match flow before/after the Colyseus room locks for a running round. */
export type GamePhase = "lobby" | "playing";
export type GameTeam = "shredders" | "enforcers";

/** Client -> server messages for `GameRoom`. */
export type GameClientMessages = {
	input: { x: number; z: number };
	interact: {};
	interact_hold: { active: boolean };
	trap_hold: { active: boolean };
	lobby_skip_wait: {};
};

/** Server -> client transient gameplay events. */
export type GameServerMessages = {
	role_assignment: {
		team: GameTeam;
	};
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
		  }
		| {
				id: string;
				kind: "file_cabinet";
				action: "drawer_searched";
				drawerIndex: number;
				bySessionId: string;
		  };
	interaction_feedback: {
		kind: "error_beep";
	};
	explosion_event: {
		x: number;
		z: number;
		range: number;
	};
	ticker_event:
		| {
				event: "keycard_first_pickup";
				color: string;
		  }
		| {
				event: "agent_died";
				agentName: string;
		  }
		| {
				event: "exit_found";
		  };
};
