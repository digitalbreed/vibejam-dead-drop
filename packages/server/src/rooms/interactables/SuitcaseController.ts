import type { Player, SuitcaseState } from "@vibejam/shared";
import { BaseInteractableController, type InteractableEvent } from "./BaseInteractableController.js";

export class SuitcaseController extends BaseInteractableController<SuitcaseState> {
	tick(_players: Iterable<Player>, _deltaMs: number): InteractableEvent[] {
		return [];
	}

	get suitcase(): SuitcaseState {
		return this.state;
	}

	isCarriedBy(sessionId: string): boolean {
		return this.state.state === "carried" && this.state.carrierSessionId === sessionId;
	}

	isGrounded(): boolean {
		return this.state.state === "ground";
	}

	isInRange(player: Player): boolean {
		const dx = player.x - this.state.x;
		const dz = player.z - this.state.z;
		return dx * dx + dz * dz <= this.state.range * this.state.range;
	}

	distanceSqTo(player: Player): number {
		const dx = player.x - this.state.x;
		const dz = player.z - this.state.z;
		return dx * dx + dz * dz;
	}

	pickup(sessionId: string): InteractableEvent | null {
		if (this.state.state !== "ground") {
			return null;
		}
		this.state.state = "carried";
		this.state.carrierSessionId = sessionId;
		this.state.containerId = "";
		return {
			id: this.state.id,
			kind: "suitcase",
			action: "picked_up",
			bySessionId: sessionId,
		};
	}

	drop(sessionId: string, x: number, z: number): InteractableEvent | null {
		if (!this.isCarriedBy(sessionId)) {
			return null;
		}
		this.state.state = "ground";
		this.state.carrierSessionId = "";
		this.state.containerId = "";
		this.state.x = x;
		this.state.z = z;
		this.state.worldX = x;
		this.state.worldZ = z;
		return {
			id: this.state.id,
			kind: "suitcase",
			action: "dropped",
			bySessionId: sessionId,
		};
	}

	setContained(containerId: string) {
		this.state.state = "contained";
		this.state.containerId = containerId;
		this.state.carrierSessionId = "";
	}

	forceCarry(sessionId: string): InteractableEvent {
		this.state.state = "carried";
		this.state.carrierSessionId = sessionId;
		this.state.containerId = "";
		return {
			id: this.state.id,
			kind: "suitcase",
			action: "picked_up",
			bySessionId: sessionId,
		};
	}

	setUsed() {
		this.state.state = "used";
		this.state.containerId = "";
		this.state.carrierSessionId = "";
	}
}
