import type { BotRuntimeConfig } from "./types.js";

/**
 * Centralized bot tuning knobs.
 * Keep role-independent behavior values here so both client bots and future server bots stay aligned.
 */
export const DEFAULT_BOT_RUNTIME_CONFIG: BotRuntimeConfig = {
	decisionTickMs: 220,
	inputTickMs: 50,
	pauseMinMs: 700,
	pauseMaxMs: 1800,
	pauseChanceOnTransition: 0.58,
	initialOrientationMinMs: 1000,
	initialOrientationMaxMs: 3000,
	interactionSeenTtlMs: 5000,
	interactionApproachRadius: 2.2,
	wallAvoidanceBias: 0.25,
	movementDeadzone: 0.12,
	waypointArrivalDistance: 0.6,
	actionRangeSlack: 0.45,
	aloneRoomFallbackDistance: 2.6,
};
