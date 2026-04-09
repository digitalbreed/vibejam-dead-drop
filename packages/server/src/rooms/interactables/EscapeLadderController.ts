import type { EscapeLadderPlacement, EscapeLadderState, Player } from "@vibejam/shared";
import type { InteractableEvent } from "./BaseInteractableController.js";

export class EscapeLadderController {
	constructor(
		readonly state: EscapeLadderState,
		private readonly placement: EscapeLadderPlacement,
	) {}

	tick(_players: Iterable<Player>, _deltaMs: number): InteractableEvent[] {
		return [];
	}

	get ladder(): EscapeLadderState {
		return this.state;
	}

	get placementSnapshot(): EscapeLadderPlacement {
		return this.placement;
	}

	isInRange(player: Player): boolean {
		const dx = player.x - this.placement.x;
		const dz = player.z - this.placement.z;
		return dx * dx + dz * dz <= this.placement.range * this.placement.range;
	}

	canCompleteInteraction(player: Player): boolean {
		// No “pickup” / short-press interaction. Holding interaction is treated as a trap-check.
		return this.isInRange(player);
	}
}

