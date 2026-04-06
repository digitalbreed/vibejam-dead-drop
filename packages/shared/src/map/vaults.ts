import type { WallRect } from "./collision.js";
import { CELL_SIZE } from "./constants.js";

export type VaultHingeSide = "left" | "right";

export interface VaultPlacement {
	id: string;
	ix: number;
	iz: number;
	x: number;
	z: number;
	range: number;
	doorHingeSide: VaultHingeSide;
}

export const VAULT_ID = "vault_start_0_-1";
export const VAULT_TILE_IX = 0;
export const VAULT_TILE_IZ = -1;
const VAULT_INTERACT_RANGE = 1.95;
const VAULT_COLLISION_PAD_X = 0.05;
const VAULT_COLLISION_EXTRA_SOUTH = 0.58;

export function generateVaultPlacement(): VaultPlacement {
	return {
		id: VAULT_ID,
		ix: VAULT_TILE_IX,
		iz: VAULT_TILE_IZ,
		x: VAULT_TILE_IX * CELL_SIZE,
		z: VAULT_TILE_IZ * CELL_SIZE,
		range: VAULT_INTERACT_RANGE,
		doorHingeSide: "left",
	};
}

export function buildVaultCollisionWalls(
	placements: Iterable<Pick<VaultPlacement, "x" | "z">>,
): WallRect[] {
	const halfCell = CELL_SIZE / 2;
	const walls: WallRect[] = [];
	for (const placement of placements) {
		walls.push({
			minX: placement.x - halfCell - VAULT_COLLISION_PAD_X,
			maxX: placement.x + halfCell + VAULT_COLLISION_PAD_X,
			minZ: placement.z - halfCell,
			maxZ: placement.z + halfCell + VAULT_COLLISION_EXTRA_SOUTH,
		});
	}
	return walls;
}
