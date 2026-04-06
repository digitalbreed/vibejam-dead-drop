import type { FileCabinetFacing, FileCabinetPlacement, FileCabinetState, Player } from "@vibejam/shared";
import type { InteractableEvent } from "./BaseInteractableController.js";

/**
 * File cabinets keep minimal synced `FileCabinetState`; range/position/drawer count come from
 * deterministic `FileCabinetPlacement` (same as client).
 */
export class FileCabinetController {
	constructor(
		readonly state: FileCabinetState,
		private readonly placement: FileCabinetPlacement,
	) {}

	tick(_players: Iterable<Player>, _deltaMs: number): InteractableEvent[] {
		return [];
	}

	get cabinet(): FileCabinetState {
		return this.state;
	}

	get placementSnapshot(): FileCabinetPlacement {
		return this.placement;
	}

	isInRange(player: Player): boolean {
		const dx = player.x - this.placement.x;
		const dz = player.z - this.placement.z;
		const range = this.placement.range;
		return dx * dx + dz * dz <= range * range;
	}

	/**
	 * Drawer side faces into the room (see `facing`). Vector from cabinet center to player should
	 * align with that direction so we do not pick a nearer cabinet on another wall (corner case).
	 */
	isPlayerInFront(player: Player): boolean {
		const dx = player.x - this.placement.x;
		const dz = player.z - this.placement.z;
		const facing: FileCabinetFacing = this.placement.facing;
		let dot: number;
		if (facing === "north") {
			dot = -dz;
		} else if (facing === "south") {
			dot = dz;
		} else if (facing === "east") {
			dot = dx;
		} else {
			dot = -dx;
		}
		return dot >= -0.42;
	}

	hasUnsearchedDrawer(): boolean {
		const drawerCount = Math.max(0, Math.floor(this.placement.drawerCount));
		if (drawerCount <= 0) {
			return false;
		}
		const allMask = drawerCount >= 31 ? 0x7fffffff : (1 << drawerCount) - 1;
		return (this.state.searchedMask & allMask) !== allMask;
	}

	canCompleteInteraction(player: Player): boolean {
		return this.isInRange(player) && this.hasUnsearchedDrawer() && this.isPlayerInFront(player);
	}

	completeInteraction(bySessionId: string): InteractableEvent[] {
		const events: InteractableEvent[] = [];
		const drawerCount = Math.max(0, Math.floor(this.placement.drawerCount));
		if (drawerCount <= 0) {
			return events;
		}
		for (let i = 0; i < drawerCount; i++) {
			const bit = 1 << i;
			if ((this.state.searchedMask & bit) === 0) {
				this.state.searchedMask |= bit;
				events.push({
					id: this.state.id,
					kind: "file_cabinet",
					action: "drawer_searched",
					drawerIndex: i,
					bySessionId,
				});
				break;
			}
		}
		return events;
	}
}
