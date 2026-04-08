import type { BotDecisionContext, BotRoleStrategy } from "../types.js";
import {
	decideSweepMove,
	doorBetweenRooms,
	inActionRange,
	isAloneInRoom,
	livingPlayersInRoom,
	moveToRoomAwareTarget,
	moveToTarget,
	nearestDoorInRoom,
	nearestGroundKeycard,
	playerCarriedKeycard,
	primaryVault,
	shouldAvoidRoomInteraction,
} from "./common.js";

function shouldTrapVault(context: BotDecisionContext): boolean {
	const vault = primaryVault(context);
	const self = context.snapshot.self;
	if (!self || !vault) {
		return false;
	}
	if (vault.isDoorOpen) {
		return false;
	}
	if (self.roomId === null || vault.roomId !== self.roomId) {
		return false;
	}
	return isAloneInRoom(context, self.roomId);
}

function trapOuterRoomDoorway(context: BotDecisionContext) {
	const self = context.snapshot.self;
	if (!self || self.roomId === null) {
		return null;
	}
	if (!context.snapshot.map.leafChamberRoomIds.has(self.roomId)) {
		return null;
	}
	if (!isAloneInRoom(context, self.roomId)) {
		return null;
	}
	const links = context.snapshot.map.doorwaysByRoom.get(self.roomId) ?? [];
	if (links.length !== 1) {
		return null;
	}
	const doorway = links[0]!;
	if (context.memory.ownedDoorTrapDoorIds.has(doorway.doorId)) {
		return null;
	}
	const door = doorBetweenRooms(context, doorway.roomA, doorway.roomB);
	if (!door) {
		return null;
	}
	if (inActionRange(context, door)) {
		return {
			stateKey: "enforcer:trap_outer_door",
			moveVector: null,
			trapHold: true,
			targetLabel: `door:${door.id}`,
			pauseAfterTransition: true,
		};
	}
	return {
		...moveToTarget(context, door, true),
		stateKey: "enforcer:move_to_outer_door",
		targetLabel: `door:${door.id}`,
	};
}

export const EnforcerStrategy: BotRoleStrategy = {
	decide(context: BotDecisionContext) {
		const self = context.snapshot.self;
		if (!self || !self.isAlive) {
			return { stateKey: "enforcer:inactive", moveVector: null };
		}

		const vault = primaryVault(context);
		if (vault && shouldTrapVault(context)) {
			if (inActionRange(context, vault)) {
				return {
					stateKey: "enforcer:trap_vault",
					moveVector: null,
					trapHold: true,
					targetLabel: `vault:${vault.id}`,
					pauseAfterTransition: true,
				};
			}
			return {
				...moveToTarget(context, vault, true),
				stateKey: "enforcer:move_to_vault_trap",
				targetLabel: `vault:${vault.id}`,
			};
		}

		const carried = playerCarriedKeycard(context);
		if (carried) {
			if (self.roomId !== null && isAloneInRoom(context, self.roomId)) {
				if (inActionRange(context, carried)) {
					return {
						stateKey: "enforcer:drop_keycard",
						moveVector: null,
						interactPress: true,
						targetLabel: `keycard:${carried.id}`,
						pauseAfterTransition: true,
					};
				}
				return {
					...moveToTarget(context, carried, true),
					stateKey: "enforcer:prepare_keycard_trap",
					targetLabel: `keycard:${carried.id}`,
				};
			}
			if (vault) {
				return moveToRoomAwareTarget(
					context,
					vault,
					vault.roomId,
					false,
					"enforcer:route_to_vault_with_keycard",
					"enforcer:carry_keycard",
					`vault:${vault.id}`,
				);
			}
		}

		const localKeycard = nearestGroundKeycard(context, true);
		if (localKeycard && isAloneInRoom(context, self.roomId)) {
			if (inActionRange(context, localKeycard)) {
				return {
					stateKey: "enforcer:trap_keycard",
					moveVector: null,
					trapHold: true,
					targetLabel: `keycard:${localKeycard.id}`,
					pauseAfterTransition: true,
				};
			}
			return {
				...moveToTarget(context, localKeycard, true),
				stateKey: "enforcer:approach_keycard_for_trap",
				targetLabel: `keycard:${localKeycard.id}`,
			};
		}
		if (localKeycard && !shouldAvoidRoomInteraction(context, self.roomId)) {
			if (inActionRange(context, localKeycard)) {
				return {
					stateKey: "enforcer:pickup_keycard",
					moveVector: null,
					interactPress: true,
					targetLabel: `keycard:${localKeycard.id}`,
					pauseAfterTransition: true,
				};
			}
			return {
				...moveToTarget(context, localKeycard, true),
				stateKey: "enforcer:approach_keycard",
				targetLabel: `keycard:${localKeycard.id}`,
			};
		}

		const outerDoorAction = trapOuterRoomDoorway(context);
		if (outerDoorAction) {
			return outerDoorAction;
		}

		if (self.roomId !== null && livingPlayersInRoom(context, self.roomId).length === 1) {
			const roomDoor = nearestDoorInRoom(context, self.roomId);
			if (roomDoor && !context.memory.ownedDoorTrapDoorIds.has(roomDoor.id)) {
				if (inActionRange(context, roomDoor)) {
					return {
						stateKey: "enforcer:trap_room_exit",
						moveVector: null,
						trapHold: true,
						targetLabel: `door:${roomDoor.id}`,
						pauseAfterTransition: true,
					};
				}
			}
		}

		return {
			...decideSweepMove(context),
			stateKey: "enforcer:sweep",
		};
	},
};
