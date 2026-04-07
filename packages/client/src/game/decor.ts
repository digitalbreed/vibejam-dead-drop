import { useEffect, useMemo } from "react";
import { LONG_CORRIDOR_STYLE, FLOOR_STYLE_COUNT, WALL_STYLE_COUNT } from "@vibejam/shared";
import { CanvasTexture, Color, RepeatWrapping, SRGBColorSpace } from "three";

export type DecorTextures = {
	floors: CanvasTexture[];
	walls: CanvasTexture[];
	wallCaps: CanvasTexture[];
};

type DoorFacePalette = {
	panel: string;
	panelAlt: string;
	trim: string;
	metal: string;
};

function makeTexture(canvas: HTMLCanvasElement, repeatX: number, repeatY: number): CanvasTexture {
	const texture = new CanvasTexture(canvas);
	texture.wrapS = RepeatWrapping;
	texture.wrapT = RepeatWrapping;
	texture.repeat.set(repeatX, repeatY);
	texture.colorSpace = SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

function createCarpetTexture(seed: number, variant: number): CanvasTexture {
	void seed;
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return makeTexture(canvas, 2.4, 2.4);
	}

	const redFamily = variant % 2 === 0;
	const base = new Color(redFamily ? "#8a1f2e" : "#2d7a3d");
	ctx.fillStyle = `#${base.getHexString()}`;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	return makeTexture(canvas, 1.8, 1.8);
}

function createCorridorFloorTexture(seed: number): CanvasTexture {
	void seed;
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return makeTexture(canvas, 2, 2);
	}

	const base = new Color("#5a5f66");
	ctx.fillStyle = `#${base.getHexString()}`;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	return makeTexture(canvas, 2.6, 2.6);
}

function createWallTexture(seed: number, variant: number): CanvasTexture {
	void seed;
	void variant;
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 256;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return makeTexture(canvas, 1.4, 1);
	}

	const wallpaper = new Color("#d6c7ad");
	const wood = new Color("#6a4a31");
	const trim = new Color("#4f3724");

	const splitY = Math.floor(canvas.height * 0.54);
	ctx.fillStyle = `#${wallpaper.getHexString()}`;
	ctx.fillRect(0, 0, canvas.width, splitY);
	ctx.fillStyle = `#${wood.getHexString()}`;
	ctx.fillRect(0, splitY, canvas.width, canvas.height - splitY);
	ctx.fillStyle = `#${trim.getHexString()}`;
	ctx.fillRect(0, splitY - 2, canvas.width, 4);
	return makeTexture(canvas, 1.35, 1);
}

function createPlainCorridorWallTexture(seed: number): CanvasTexture {
	void seed;
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 256;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return makeTexture(canvas, 1.4, 1);
	}

	const upper = new Color("#d7dadd");
	const lower = new Color("#8e949c");
	const trim = new Color("#5c636c");
	const baseboard = new Color("#474d55");
	const splitY = Math.floor(canvas.height * 0.54);
	ctx.fillStyle = `#${upper.getHexString()}`;
	ctx.fillRect(0, 0, canvas.width, splitY);
	ctx.fillStyle = `#${lower.getHexString()}`;
	ctx.fillRect(0, splitY, canvas.width, canvas.height - splitY);
	ctx.fillStyle = `#${trim.getHexString()}`;
	ctx.fillRect(0, splitY - 2, canvas.width, 4);
	ctx.fillStyle = `#${baseboard.getHexString()}`;
	ctx.fillRect(0, canvas.height - 14, canvas.width, 14);
	ctx.fillStyle = "rgba(70, 76, 84, 0.45)";
	for (let x = 0; x < canvas.width; x += 32) {
		ctx.fillRect(x, splitY + 2, 3, canvas.height - splitY - 16);
	}

	return makeTexture(canvas, 1.3, 1);
}

function createWallCapTexture(seed: number, variant: number): CanvasTexture {
	void seed;
	void variant;
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return makeTexture(canvas, 1.6, 1.6);
	}

	const wood = new Color("#5b3f28");

	ctx.fillStyle = `#${wood.getHexString()}`;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	return makeTexture(canvas, 1.6, 1.6);
}

function createPlainCorridorWallCapTexture(seed: number): CanvasTexture {
	void seed;
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return makeTexture(canvas, 1.6, 1.6);
	}
	ctx.fillStyle = "#7f858d";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	return makeTexture(canvas, 1.8, 1.8);
}

export function useEmbassyTextures(seed: number): DecorTextures {
	const textures = useMemo(() => {
		const floors = Array.from({ length: FLOOR_STYLE_COUNT }, (_, i) =>
			i === LONG_CORRIDOR_STYLE ? createCorridorFloorTexture(seed) : createCarpetTexture(seed, i),
		);
		const walls = Array.from({ length: WALL_STYLE_COUNT }, (_, i) =>
			i === LONG_CORRIDOR_STYLE ? createPlainCorridorWallTexture(seed) : createWallTexture(seed, i),
		);
		const wallCaps = Array.from({ length: WALL_STYLE_COUNT }, (_, i) =>
			i === LONG_CORRIDOR_STYLE ? createPlainCorridorWallCapTexture(seed) : createWallCapTexture(seed, i),
		);
		return { floors, walls, wallCaps };
	}, [seed]);

	useEffect(() => {
		return () => {
			for (const texture of textures.floors) texture.dispose();
			for (const texture of textures.walls) texture.dispose();
			for (const texture of textures.wallCaps) texture.dispose();
		};
	}, [textures]);

	return textures;
}

export function doorPaletteForSide(kind: string, style: number): DoorFacePalette {
	if (kind === "hall" || style === LONG_CORRIDOR_STYLE) {
		return {
			panel: "#c8cbcf",
			panelAlt: "#b7bcc0",
			trim: "#8f969b",
			metal: "#6e757a",
		};
	}
	const redFamily = style % 2 === 0;
	return {
		panel: redFamily ? "#6a4031" : "#5c4632",
		panelAlt: redFamily ? "#7a4a39" : "#6a513a",
		trim: redFamily ? "#c7b38e" : "#d1c09c",
		metal: "#6f5d4d",
	};
}
