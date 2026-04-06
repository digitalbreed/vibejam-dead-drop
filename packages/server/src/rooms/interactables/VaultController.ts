import type { KeycardState, Player, VaultState } from "@vibejam/shared";
import { BaseInteractableController, type InteractableEvent } from "./BaseInteractableController.js";

const VAULT_FRONT_DIRECTION_Z = 1;
const VAULT_FRONT_OFFSET_Z = 1.25;
const VAULT_FRONT_SOUTH_TOLERANCE = 0.25;
const DOOR_OPEN_SPEED_PER_SEC = 2.5;

export class VaultController extends BaseInteractableController<VaultState> {
	tick(_players: Iterable<Player>, deltaMs: number): InteractableEvent[] {
		const target = this.state.isDoorOpen ? 1 : 0;
		const delta = (DOOR_OPEN_SPEED_PER_SEC * deltaMs) / 1000;
		if (target > this.state.doorOpenT) {
			this.state.doorOpenT = Math.min(1, this.state.doorOpenT + delta);
		} else if (target < this.state.doorOpenT) {
			this.state.doorOpenT = Math.max(0, this.state.doorOpenT - delta);
		}
		return [];
	}

	get vault(): VaultState {
		return this.state;
	}

	isInInsertRange(player: Player): boolean {
		const slotX = this.state.x;
		const slotZ = this.state.z + VAULT_FRONT_DIRECTION_Z * VAULT_FRONT_OFFSET_Z;
		const dx = player.x - slotX;
		const dz = player.z - slotZ;
		if (player.z < this.state.z + VAULT_FRONT_SOUTH_TOLERANCE) {
			return false;
		}
		return dx * dx + dz * dz <= this.state.range * this.state.range;
	}

	isInInteractionRange(player: Player): boolean {
		const slotX = this.state.x;
		const slotZ = this.state.z + VAULT_FRONT_DIRECTION_Z * VAULT_FRONT_OFFSET_Z;
		const dx = player.x - slotX;
		const dz = player.z - slotZ;
		const range = this.state.range + 0.9;
		if (player.z < this.state.z - 0.1) {
			return false;
		}
		return dx * dx + dz * dz <= range * range;
	}

	canInsertCard(card: KeycardState): boolean {
		if (card.state !== "carried") {
			return false;
		}
		if (card.color === "blue") {
			return !this.state.insertedBlue;
		}
		if (card.color === "red") {
			return !this.state.insertedRed;
		}
		return false;
	}

	insertCard(card: KeycardState, bySessionId: string): InteractableEvent[] {
		const events: InteractableEvent[] = [];
		const color = card.color === "red" ? "red" : "blue";
		if (color === "blue" && !this.state.insertedBlue) {
			this.state.insertedBlue = true;
		} else if (color === "red" && !this.state.insertedRed) {
			this.state.insertedRed = true;
		} else {
			return events;
		}
		events.push({
			id: this.state.id,
			kind: "vault",
			action: "card_inserted",
			color,
			bySessionId,
		});
		const shouldUnlock = this.state.insertedBlue && this.state.insertedRed && !this.state.isUnlocked;
		if (!shouldUnlock) {
			return events;
		}
		this.state.isUnlocked = true;
		events.push({
			id: this.state.id,
			kind: "vault",
			action: "unlocked",
		});
		return events;
	}

	canCompleteInteraction(player: Player): boolean {
		return this.state.isUnlocked && !this.state.isDoorOpen && this.isInInteractionRange(player);
	}

	completeInteraction(): InteractableEvent[] {
		const events: InteractableEvent[] = [];
		if (this.state.isDoorOpen) {
			return events;
		}
		this.state.isDoorOpen = true;
		if (this.state.doorOpenT < 0.02) {
			this.state.doorOpenT = 0.02;
		}
		events.push({
			id: this.state.id,
			kind: "vault",
			action: "opened",
		});
		events.push({
			id: this.state.id,
			kind: "vault",
			action: "completed",
		});
		return events;
	}
}
