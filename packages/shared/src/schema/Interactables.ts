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
