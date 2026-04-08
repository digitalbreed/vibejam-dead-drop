import type { BotDecisionContext, BotRoleStrategy } from "../types.js";
import {
	canOpenVault,
	canInsertAtVault,
	decideSweepMove,
	inActionRange,
	isPickupLeaderForKeycard,
	keycardYieldPoint,
	moveToRoomAwareTarget,
	moveToTarget,
	nearestGroundKeycard,
	playerCarriedKeycard,
	playerCarriedSuitcase,
	primaryVault,
	vaultApproachPoint,
} from "./common.js";

export const ShredderStrategy: BotRoleStrategy = {
	decide(context: BotDecisionContext) {
		const self = context.snapshot.self;
		if (!self || !self.isAlive) {
			return { stateKey: "shredder:inactive", moveVector: null };
		}

		const carriedSuitcase = playerCarriedSuitcase(context);
		if (carriedSuitcase) {
			return {
				stateKey: "shredder:designated_carrier",
				moveVector: null,
				targetLabel: `suitcase:${carriedSuitcase.id}`,
			};
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
