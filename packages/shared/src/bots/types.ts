import type { GameTeam, GameServerMessages } from "../index.js";

export type BotVector = { x: number; z: number };

export type BotPlayerPerception = {
	sessionId: string;
	x: number;
	z: number;
	isAlive: boolean;
	isInteracting: boolean;
	interactionKind: string;
	interactionTargetId: string;
	roomId: number | null;
};

export type BotDoorPerception = {
	id: string;
	x: number;
	z: number;
	isOpen: boolean;
	range: number;
	facing: "x" | "z";
	roomA: number | null;
	roomB: number | null;
};

export type BotKeycardPerception = {
	id: string;
	color: "blue" | "red";
	x: number;
	z: number;
	state: string;
	carrierSessionId: string;
	roomId: number | null;
	range: number;
};

export type BotVaultPerception = {
	id: string;
	x: number;
	z: number;
	range: number;
	isUnlocked: boolean;
	isDoorOpen: boolean;
	roomId: number | null;
};

export type BotSuitcasePerception = {
	id: string;
	x: number;
	z: number;
	state: string;
	carrierSessionId: string;
	containerId: string;
	roomId: number | null;
	range: number;
};

export type BotTrapPerception = {
	id: string;
	ownerSessionId: string;
	targetKind: string;
	targetId: string;
	status: string;
};

export type BotTrapPointPerception = {
	id: string;
	ownerSessionId: string;
	slotIndex: number;
	status: string;
	trapId: string;
};

export type BotFileCabinetPerception = {
	id: string;
	searchedMask: number;
	roomId: number | null;
};

export type BotDoorway = {
	doorId: string;
	x: number;
	z: number;
	roomA: number;
	roomB: number;
};

export type BotMapAwareness = {
	seed: number;
	maxDistance: number;
	roomByCell: Map<string, number>;
	roomCenters: Map<number, { x: number; z: number }>;
	chamberRoomIds: Set<number>;
	doorways: BotDoorway[];
	doorwaysByRoom: Map<number, BotDoorway[]>;
	leafChamberRoomIds: Set<number>;
};

export type BotPerceptionSnapshot = {
	timeMs: number;
	team: GameTeam | null;
	map: BotMapAwareness;
	selfSessionId: string;
	self: BotPlayerPerception | null;
	players: BotPlayerPerception[];
	doors: BotDoorPerception[];
	keycards: BotKeycardPerception[];
	vaults: BotVaultPerception[];
	suitcases: BotSuitcasePerception[];
	traps: BotTrapPerception[];
	trapPoints: BotTrapPointPerception[];
	fileCabinets: BotFileCabinetPerception[];
};

export type BotLogLevel = "debug" | "info" | "warn";

export type BotLogEntry = {
	level: BotLogLevel;
	message: string;
	timeMs: number;
};

export type BotCommand = {
	moveVector: BotVector | null;
	interactPress: boolean;
	interactHold: boolean;
	trapHold: boolean;
	logEntries: BotLogEntry[];
};

export type BotRoleFacts = {
	designatedCarrier: boolean;
};

export type BotMemory = {
	visitedRoomIds: Set<number>;
	interactedTargets: Set<string>;
	ownedDoorTrapDoorIds: Set<string>;
	seenInteractionByRoom: Map<number, number>;
	publicKeycardPickupColors: Set<string>;
	roleFacts: BotRoleFacts;
	lastStateKey: string;
	pauseUntilMs: number;
	lastStateChangeMs: number;
	hasAppliedInitialOrientationPause: boolean;
	lastPosition: { x: number; z: number } | null;
	stuckTicks: number;
	escapeUntilMs: number;
	escapeVector: BotVector | null;
};

export type BotRuntimeConfig = {
	/** Decision tick frequency; lower = snappier but higher CPU usage. */
	decisionTickMs: number;
	/** Input tick frequency used by the adapter that converts move vectors to key presses. */
	inputTickMs: number;
	/** Minimum idle pause after a state transition. */
	pauseMinMs: number;
	/** Maximum idle pause after a state transition. */
	pauseMaxMs: number;
	/** Probability of applying a pause on state transitions. */
	pauseChanceOnTransition: number;
	/** Minimum initial delay at round start to mimic player orientation. */
	initialOrientationMinMs: number;
	/** Maximum initial delay at round start to mimic player orientation. */
	initialOrientationMaxMs: number;
	/** How long to remember that a non-local player was interacting in a room. */
	interactionSeenTtlMs: number;
	/** If farther than this from target, keep a wall-avoidance center bias. */
	interactionApproachRadius: number;
	/** Bias strength to keep bots away from edges/corners while moving. */
	wallAvoidanceBias: number;
	/** Move vector magnitude smaller than this is treated as stop. */
	movementDeadzone: number;
	/** Distance considered close enough to a waypoint target. */
	waypointArrivalDistance: number;
	/** Distance to consider actionable interaction range (extra slack over interactable range). */
	actionRangeSlack: number;
	/** Distance threshold for alone checks to include nearby room-center uncertainty. */
	aloneRoomFallbackDistance: number;
};

export type BotEventEnvelope =
	| {
			timeMs: number;
			type: "interactable_event";
			message: GameServerMessages["interactable_event"];
	  }
	| {
			timeMs: number;
			type: "ticker_event";
			message: GameServerMessages["ticker_event"];
	  };

export type BotDecisionContext = {
	snapshot: BotPerceptionSnapshot;
	memory: BotMemory;
	config: BotRuntimeConfig;
	logs: BotLogEntry[];
};

export type BotDecision = {
	stateKey: string;
	moveVector: BotVector | null;
	interactPress?: boolean;
	interactHold?: boolean;
	trapHold?: boolean;
	targetLabel?: string;
	pauseAfterTransition?: boolean;
};

export type BotRoleStrategy = {
	decide(context: BotDecisionContext): BotDecision;
};
