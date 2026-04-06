import { Schema, type } from "@colyseus/schema";

export class InteractableState extends Schema {
	@type("string") id: string = "";
	@type("string") kind: string = "";
	@type("number") range: number = 0;
	@type("number") x: number = 0;
	@type("number") z: number = 0;
}

export class DoorState extends InteractableState {
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

export class KeycardState extends InteractableState {
	@type("string") keyId: string = "";
	@type("number") worldX: number = 0;
	@type("number") worldZ: number = 0;
	@type("string") color: string = "blue";
	@type("string") state: string = "ground";
	@type("string") carrierSessionId: string = "";
	@type("string") containerId: string = "";
}

export class SuitcaseState extends InteractableState {
	@type("string") suitcaseId: string = "";
	@type("number") worldX: number = 0;
	@type("number") worldZ: number = 0;
	@type("string") state: string = "ground";
	@type("string") carrierSessionId: string = "";
	@type("string") containerId: string = "";
}

export class VaultState extends InteractableState {
	@type("boolean") insertedBlue: boolean = false;
	@type("boolean") insertedRed: boolean = false;
	@type("boolean") isUnlocked: boolean = false;
	@type("boolean") isDoorOpen: boolean = false;
	@type("string") doorHingeSide: string = "left";
	@type("number") doorOpenT: number = 0;
}
