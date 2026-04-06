import { Schema, type } from "@colyseus/schema";

/**
 * Shared field shape for map-positioned interactables (for typing and docs only).
 *
 * ## Do not use schema inheritance
 *
 * Each interactable **must** be a single flat `class FooState extends Schema { ... }` with **every**
 * `@type` field declared on that class. Do **not** add `extends SomeBaseInteractable` — Colyseus
 * tooling and `@colyseus/react` snapshots only enumerate `constructor[Symbol.metadata]` on the
 * concrete class, so inherited fields were historically missing from React snapshots.
 *
 * Repeat `id`, `kind`, `range`, `x`, `z` (when needed) explicitly on each type that needs them.
 *
 * See `docs/interactables.md`.
 */
export type InteractableBaseFields = {
	id: string;
	kind: string;
	range: number;
	x: number;
	z: number;
};

export class DoorState extends Schema {
	@type("string") id: string = "";
	@type("string") kind: string = "";
	@type("number") range: number = 0;
	@type("number") x: number = 0;
	@type("number") z: number = 0;
	@type("string") variant: string = "single";
	@type("boolean") isOpen: boolean = false;
	@type("boolean") isLocked: boolean = false;
	@type("number") nearbyCount: number = 0;
	@type("string") hingeSide: string = "left";
	@type("string") facing: string = "x";
	@type("string") side1Kind: string = "chamber";
	@type("string") side2Kind: string = "chamber";
	@type("number") side1FloorStyle: number = 0;
	@type("number") side2FloorStyle: number = 0;
	@type("number") side1WallStyle: number = 0;
	@type("number") side2WallStyle: number = 0;
}

export class KeycardState extends Schema {
	@type("string") id: string = "";
	@type("string") kind: string = "";
	@type("number") range: number = 0;
	@type("number") x: number = 0;
	@type("number") z: number = 0;
	@type("string") keyId: string = "";
	@type("number") worldX: number = 0;
	@type("number") worldZ: number = 0;
	@type("string") color: string = "blue";
	@type("string") state: string = "ground";
	@type("string") carrierSessionId: string = "";
	@type("string") containerId: string = "";
}

export class SuitcaseState extends Schema {
	@type("string") id: string = "";
	@type("string") kind: string = "";
	@type("number") range: number = 0;
	@type("number") x: number = 0;
	@type("number") z: number = 0;
	@type("string") suitcaseId: string = "";
	@type("number") worldX: number = 0;
	@type("number") worldZ: number = 0;
	@type("string") state: string = "ground";
	@type("string") carrierSessionId: string = "";
	@type("string") containerId: string = "";
}

export class VaultState extends Schema {
	@type("string") id: string = "";
	@type("string") kind: string = "";
	@type("number") range: number = 0;
	@type("number") x: number = 0;
	@type("number") z: number = 0;
	@type("boolean") insertedBlue: boolean = false;
	@type("boolean") insertedRed: boolean = false;
	@type("boolean") isUnlocked: boolean = false;
	@type("boolean") isDoorOpen: boolean = false;
	@type("string") doorHingeSide: string = "left";
	@type("number") doorOpenT: number = 0;
}

/**
 * Authoritative gameplay state for file cabinets. **Geometry and world position are not synced:**
 * both server and client derive placement from `generateFileCabinetPlacements(generateMapLayout(mapSeed, mapMaxDistance))`
 * so IDs match and the snapshot stays small.
 */
export class FileCabinetState extends Schema {
	@type("string") id: string = "";
	@type("string") kind: string = "";
	/** Bitmask: bit i set => drawer i has been searched. */
	@type("number") searchedMask: number = 0;
}
