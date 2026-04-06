import type { DoorState, Player } from "@vibejam/shared";
import { BaseInteractableController, type InteractableEvent } from "./BaseInteractableController.js";

const CLOSE_GRACE_MS = 450;

export class DoorController extends BaseInteractableController<DoorState> {
	private closeGraceRemainingMs = 0;

	tick(players: Iterable<Player>, deltaMs: number): InteractableEvent[] {
		const nearbyCount = this.countPlayersInRange(players);
		const events: InteractableEvent[] = [];
		if (nearbyCount > 0) {
			this.closeGraceRemainingMs = CLOSE_GRACE_MS;
		} else if (this.closeGraceRemainingMs > 0) {
			this.closeGraceRemainingMs = Math.max(0, this.closeGraceRemainingMs - deltaMs);
		}
		const nextOpen = !this.state.isLocked && (nearbyCount > 0 || this.closeGraceRemainingMs > 0);

		if (this.state.nearbyCount !== nearbyCount) {
			this.state.nearbyCount = nearbyCount;
		}
		if (this.state.isOpen !== nextOpen) {
			this.state.isOpen = nextOpen;
			events.push({
				id: this.state.id,
				kind: "door",
				action: nextOpen ? "opened" : "closed",
			});
		}

		return events;
	}
}
