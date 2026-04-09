import { findRoomRoute } from "../navigation.js";
import type { BotDecisionContext, BotRoleStrategy } from "../types.js";
import {
	canOpenVault,
	canInsertAtVault,
	decideSweepMove,
	inActionRange,
	isPickupLeaderForKeycard,
	isVaultInteractionLeader,
	keycardYieldPoint,
	moveToRoomAwareTarget,
	moveToTarget,
	nearestGroundKeycard,
	playerCarriedKeycard,
	playerCarriedSuitcase,
	primaryEscapeLadder,
	primaryVault,
	vaultApproachPoint,
	vaultYieldPoint,
} from "./common.js";

type SupportRole = "advance" | "ladder_check" | "escort";

const CARRIER_ESCORT_DISTANCE = 2.4;
const SWARM_NEARBY_DISTANCE = 3.25;

function deterministicNoise(key: string): number {
	let hash = 2166136261 >>> 0;
	for (let i = 0; i < key.length; i++) {
		hash ^= key.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return (hash % 1000) / 1000;
}

function supportRoleForSelf(context: BotDecisionContext, carrierSessionId: string): SupportRole {
	const self = context.snapshot.self;
	if (!self) {
		return "advance";
	}
	const ordered = context.snapshot.players
		.filter((player) => player.isAlive && player.sessionId !== carrierSessionId)
		.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
	const index = ordered.findIndex((player) => player.sessionId === self.sessionId);
	if (index < 0) {
		return "advance";
	}
	const slot = index % 3;
	if (slot === 1) {
		return "ladder_check";
	}
	if (slot === 2) {
		return "escort";
	}
	return "advance";
}

function isLadderKnown(context: BotDecisionContext, ladderRoomId: number | null): boolean {
	if (context.memory.exitFoundPublic) {
		return true;
	}
	if (ladderRoomId !== null && context.memory.visitedRoomIds.has(ladderRoomId)) {
		return true;
	}
	for (const player of context.snapshot.players) {
		if (!player.isAlive) {
			continue;
		}
		if (player.interactionKind === "escape_ladder") {
			return true;
		}
	}
	return false;
}

function moveToRoomCenter(context: BotDecisionContext, roomId: number, stateKey: string, targetLabel: string) {
	const center = context.snapshot.map.roomCenters.get(roomId);
	if (!center) {
		return { ...decideSweepMove(context), stateKey: `${stateKey}:fallback`, targetLabel };
	}
	return moveToRoomAwareTarget(context, center, roomId, false, `${stateKey}:route`, stateKey, targetLabel);
}

function supporterBehavior(context: BotDecisionContext, carrierSessionId: string) {
	const self = context.snapshot.self;
	if (!self) {
		return { stateKey: "shredder:support_inactive", moveVector: null };
	}
	const carrier = context.snapshot.players.find((player) => player.sessionId === carrierSessionId) ?? null;
	if (!carrier || !carrier.isAlive) {
		return { ...decideSweepMove(context), stateKey: "shredder:support_sweep" };
	}
	const ladder = primaryEscapeLadder(context);
	const ladderKnown = isLadderKnown(context, ladder?.roomId ?? null);
	const role = supportRoleForSelf(context, carrierSessionId);

	if (role === "ladder_check") {
		if (ladder && ladderKnown) {
			if (inActionRange(context, ladder)) {
				return {
					stateKey: "shredder:support_ladder_check",
					moveVector: null,
					interactHold: true,
					targetLabel: `escape_ladder:${ladder.id}`,
				};
			}
			return moveToRoomAwareTarget(
				context,
				ladder,
				ladder.roomId,
				false,
				"shredder:support_route_ladder",
				"shredder:support_move_ladder",
				`escape_ladder:${ladder.id}`,
			);
		}
		// Unknown ladder fallback: advance behavior.
	}

	if (role === "escort") {
		const distToCarrier = Math.hypot(self.x - carrier.x, self.z - carrier.z);
		if (distToCarrier <= CARRIER_ESCORT_DISTANCE) {
			return {
				stateKey: "shredder:support_escort_hold",
				moveVector: null,
				targetLabel: `carrier:${carrier.sessionId}`,
			};
		}
		const offsetAngle = deterministicNoise(`${self.sessionId}:escort`) * Math.PI * 2;
		const target = {
			x: carrier.x + Math.cos(offsetAngle) * 1.35,
			z: carrier.z + Math.sin(offsetAngle) * 1.35,
		};
		return {
			...moveToTarget(context, target, false),
			stateKey: "shredder:support_escort",
			targetLabel: `carrier:${carrier.sessionId}`,
		};
	}

	// Priority 1 (advance).
	if (ladder && ladderKnown && carrier.roomId !== null && ladder.roomId !== null) {
		const route = findRoomRoute(context.snapshot.map, carrier.roomId, ladder.roomId, context.memory.ownedDoorTrapDoorIds);
		if (route.length > 0) {
			const nextRoom = route[0]!.toRoomId;
			return moveToRoomCenter(context, nextRoom, "shredder:support_advance", `room:${nextRoom}`);
		}
	}

	if (carrier.roomId !== null && self.roomId !== carrier.roomId) {
		return {
			...moveToTarget(context, carrier, false),
			stateKey: "shredder:support_join_carrier_room",
			targetLabel: `carrier:${carrier.sessionId}`,
		};
	}
	if (carrier.roomId !== null) {
		const doorways = context.snapshot.map.doorwaysByRoom.get(carrier.roomId) ?? [];
		if (doorways.length > 0) {
			const cycle = Math.floor(context.snapshot.timeMs / 1800);
			const pick = Math.floor(deterministicNoise(`${self.sessionId}:door_test:${cycle}`) * doorways.length) % doorways.length;
			const doorway = doorways[pick]!;
			const nextRoom = doorway.roomA === carrier.roomId ? doorway.roomB : doorway.roomA;
			return moveToRoomCenter(context, nextRoom, "shredder:support_test_doors", `door:${doorway.doorId}`);
		}
	}

	return {
		...decideSweepMove(context),
		stateKey: "shredder:support_sweep",
	};
}

function carrierBehavior(context: BotDecisionContext) {
	const ladder = primaryEscapeLadder(context);
	if (!ladder) {
		return {
			...decideSweepMove(context),
			stateKey: "shredder:carrier_sweep",
		};
	}
	if (inActionRange(context, ladder)) {
		return {
			stateKey: "shredder:carrier_escape_interact",
			moveVector: null,
			interactHold: true,
			targetLabel: `escape_ladder:${ladder.id}`,
		};
	}
	return moveToRoomAwareTarget(
		context,
		ladder,
		ladder.roomId,
		false,
		"shredder:carrier_route_escape",
		"shredder:carrier_move_escape",
		`escape_ladder:${ladder.id}`,
	);
}

function droppedSuitcaseBehavior(context: BotDecisionContext) {
	const self = context.snapshot.self;
	if (!self) {
		return { stateKey: "shredder:drop_inactive", moveVector: null };
	}
	const dropped = context.snapshot.suitcases.find((suitcase) => suitcase.state === "ground") ?? null;
	if (!dropped) {
		return null;
	}
	const dist = Math.hypot(self.x - dropped.x, self.z - dropped.z);
	if (dist <= dropped.range + context.config.actionRangeSlack) {
		if (!isPickupLeaderForKeycard(context, {
			id: dropped.id,
			color: "blue",
			x: dropped.x,
			z: dropped.z,
			state: "ground",
			carrierSessionId: "",
			roomId: dropped.roomId,
			range: dropped.range,
		})) {
			return {
				...moveToTarget(context, { x: dropped.x + 1.0, z: dropped.z + 0.8 }, false),
				stateKey: "shredder:suitcase_yield",
				targetLabel: `suitcase:${dropped.id}`,
			};
		}
		return {
			stateKey: "shredder:pickup_suitcase",
			moveVector: null,
			interactPress: true,
			targetLabel: `suitcase:${dropped.id}`,
		};
	}
	if (dist > SWARM_NEARBY_DISTANCE) {
		return {
			...decideSweepMove(context),
			stateKey: "shredder:swarm_find_suitcase",
			targetLabel: `suitcase:${dropped.id}`,
		};
	}
	return moveToRoomAwareTarget(
		context,
		dropped,
		dropped.roomId,
		false,
		"shredder:route_dropped_suitcase",
		"shredder:approach_dropped_suitcase",
		`suitcase:${dropped.id}`,
	);
}

export const ShredderStrategy: BotRoleStrategy = {
	decide(context: BotDecisionContext) {
		const self = context.snapshot.self;
		if (!self || !self.isAlive) {
			return { stateKey: "shredder:inactive", moveVector: null };
		}

		if (context.memory.exitFoundPublic) {
			return { stateKey: "shredder:round_won_idle", moveVector: null };
		}

		const droppedSuitcaseDecision = droppedSuitcaseBehavior(context);
		if (droppedSuitcaseDecision) {
			return droppedSuitcaseDecision;
		}

		const carriedSuitcase = playerCarriedSuitcase(context);
		if (carriedSuitcase) {
			return carrierBehavior(context);
		}

		const globalCarrier = context.snapshot.suitcases.find((suitcase) => suitcase.state === "carried");
		if (globalCarrier?.carrierSessionId) {
			return supporterBehavior(context, globalCarrier.carrierSessionId);
		}

		const vault = primaryVault(context);
		if (!vault) {
			return decideSweepMove(context);
		}

		const carriedKeycard = playerCarriedKeycard(context);
		if (carriedKeycard) {
			if (canInsertAtVault(context, vault)) {
				return {
					stateKey: "shredder:insert_keycard",
					moveVector: null,
					interactPress: true,
					targetLabel: `vault:${vault.id}`,
					pauseAfterTransition: true,
				};
			}
			return moveToRoomAwareTarget(
				context,
				vaultApproachPoint(vault, self),
				vault.roomId,
				false,
				"shredder:route_to_vault",
				"shredder:position_for_insert",
				`vault:${vault.id}`,
			);
		}

		if (vault.isUnlocked && !vault.isDoorOpen) {
			if (canOpenVault(context, vault)) {
				if (!isVaultInteractionLeader(context, vault)) {
					return {
						...moveToTarget(context, vaultYieldPoint(vault, self.sessionId), false),
						stateKey: "shredder:yield_vault_open",
						targetLabel: `vault:${vault.id}`,
					};
				}
				return {
					stateKey: "shredder:open_vault",
					moveVector: null,
					interactHold: true,
					targetLabel: `vault:${vault.id}`,
					pauseAfterTransition: true,
				};
			}
			return moveToRoomAwareTarget(
				context,
				vaultApproachPoint(vault, self),
				vault.roomId,
				false,
				"shredder:route_to_open_vault",
				"shredder:move_to_open_vault",
				`vault:${vault.id}`,
			);
		}

		const localKeycard = nearestGroundKeycard(context, true, true);
		if (localKeycard && inActionRange(context, localKeycard)) {
			if (!isPickupLeaderForKeycard(context, localKeycard)) {
				return {
					...moveToTarget(context, keycardYieldPoint(context, localKeycard), false),
					stateKey: "shredder:yield_keycard_pickup",
					targetLabel: `keycard:${localKeycard.id}`,
				};
			}
			return {
				stateKey: "shredder:pickup_keycard",
				moveVector: null,
				interactPress: true,
				targetLabel: `keycard:${localKeycard.id}`,
				pauseAfterTransition: true,
			};
		}
		if (localKeycard) {
			return {
				...moveToTarget(context, localKeycard, true),
				stateKey: "shredder:approach_keycard",
				targetLabel: `keycard:${localKeycard.id}`,
			};
		}

		const visibleKeycard = nearestGroundKeycard(context, false, true);
		if (visibleKeycard) {
			return moveToRoomAwareTarget(
				context,
				visibleKeycard,
				visibleKeycard.roomId,
				false,
				"shredder:route_to_keycard",
				"shredder:approach_keycard",
				`keycard:${visibleKeycard.id}`,
			);
		}

		return {
			...decideSweepMove(context),
			stateKey: "shredder:sweep",
		};
	},
};
