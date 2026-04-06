import type { GameServerMessages, InteractableState, Player } from "@vibejam/shared";

export type InteractableEvent = GameServerMessages["interactable_event"];

export abstract class BaseInteractableController<TState extends InteractableState> {
	constructor(protected readonly state: TState) {}

	abstract tick(players: Iterable<Player>, deltaMs: number): InteractableEvent[];

	protected countPlayersInRange(players: Iterable<Player>): number {
		let count = 0;
		const rangeSq = this.state.range * this.state.range;
		for (const player of players) {
			const dx = player.x - this.state.x;
			const dz = player.z - this.state.z;
			if (dx * dx + dz * dz <= rangeSq) {
				count++;
			}
		}
		return count;
	}
}
