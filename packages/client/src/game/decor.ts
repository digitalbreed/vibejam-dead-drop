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

function fract(n: number): number {
	return n - Math.floor(n);
}

function noise2(seed: number, x: number, y: number): number {
	return fract(Math.sin(seed * 0.00013 + x * 12.9898 + y * 78.233) * 43758.5453);
}

function makeTexture(canvas: HTMLCanvasElement, repeatX: number, repeatY: number): CanvasTexture {
	const texture = new CanvasTexture(canvas);
	texture.wrapS = RepeatWrapping;
	texture.wrapT = RepeatWrapping;
	texture.repeat.set(repeatX, repeatY);
	texture.colorSpace = SRGBColorSpace;
	texture.needsUpdate = true;
	return texture;
}

function fillNoiseRect(
	ctx: CanvasRenderingContext2D,
	width: number,
	height: number,
	seed: number,
	alpha: number,
	step = 2,
): void {
	for (let y = 0; y < height; y += step) {
		for (let x = 0; x < width; x += step) {
			const n = noise2(seed, x, y);
			const shade = Math.floor(255 * n);
			ctx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${alpha})`;
			ctx.fillRect(x, y, step, step);
		}
	}
}

function createCarpetTexture(seed: number, variant: number): CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return makeTexture(canvas, 2.4, 2.4);
	}

	const redFamily = variant % 2 === 0;
	const base = new Color(redFamily ? "#4d1620" : "#1f4a2f");
	const mid = new Color(redFamily ? "#64212c" : "#295c3a");
	const line = new Color(redFamily ? "#a98b68" : "#c5b68a");
	ctx.fillStyle = `#${base.getHexString()}`;
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	ctx.globalAlpha = 0.32;
	ctx.fillStyle = `#${mid.getHexString()}`;
	for (let y = 0; y < canvas.height; y += 6) {
		const wobble = (noise2(seed + variant * 17, y, 0) - 0.5) * 3;
		ctx.fillRect(0, y + wobble, canvas.width, 3);
	}
	ctx.globalAlpha = 1;

	fillNoiseRect(ctx, canvas.width, canvas.height, seed + variant * 97, 0.07, 2);

	ctx.strokeStyle = `rgba(${Math.round(line.r * 255)}, ${Math.round(line.g * 255)}, ${Math.round(line.b * 255)}, 0.55)`;
	ctx.lineWidth = 2;
	ctx.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
	ctx.lineWidth = 1;
	ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

	for (let x = 18; x < canvas.width - 18; x += 18) {
		ctx.strokeStyle = `rgba(${Math.round(line.r * 255)}, ${Math.round(line.g * 255)}, ${Math.round(line.b * 255)}, 0.12)`;
		ctx.beginPath();
		ctx.moveTo(x, 12);
		ctx.lineTo(x, canvas.height - 12);
		ctx.stroke();
	}

	return makeTexture(canvas, 1.8, 1.8);
}

function createCorridorFloorTexture(seed: number): CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return makeTexture(canvas, 2, 2);
	}

	const base = new Color("#53575c");
	const shadow = new Color("#3f4347");
	const highlight = new Color("#656b70");
	ctx.fillStyle = `#${base.getHexString()}`;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	fillNoiseRect(ctx, canvas.width, canvas.height, seed + 901, 0.08, 2);
	fillNoiseRect(ctx, canvas.width, canvas.height, seed + 1337, 0.03, 1);

	for (let y = 0; y < canvas.height; y += 6) {
		const shade = noise2(seed + 404, 0, y);
		ctx.fillStyle = shade > 0.5 ? `rgba(${Math.round(highlight.r * 255)}, ${Math.round(highlight.g * 255)}, ${Math.round(highlight.b * 255)}, 0.05)` : `rgba(${Math.round(shadow.r * 255)}, ${Math.round(shadow.g * 255)}, ${Math.round(shadow.b * 255)}, 0.06)`;
		ctx.fillRect(0, y, canvas.width, 2);
	}

	return makeTexture(canvas, 2.6, 2.6);
}

function createWallTexture(seed: number, variant: number): CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 256;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return makeTexture(canvas, 1.4, 1);
	}

	const paper = new Color(variant % 3 === 0 ? "#d5c9ae" : variant % 3 === 1 ? "#d9d0bb" : "#cfc3a4");
	const paperShadow = new Color(variant % 3 === 0 ? "#c3b491" : variant % 3 === 1 ? "#c9bea8" : "#bcad89");
	const wood = new Color(variant % 2 === 0 ? "#6b4a2f" : "#5b3f28");
	const woodDark = new Color(variant % 2 === 0 ? "#543723" : "#49311f");

	ctx.fillStyle = `#${paper.getHexString()}`;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = `#${wood.getHexString()}`;
	ctx.fillRect(0, canvas.height / 2, canvas.width, canvas.height / 2);
	fillNoiseRect(ctx, canvas.width, canvas.height / 2, seed + variant * 41, 0.05, 2);

	ctx.strokeStyle = `rgba(${Math.round(paperShadow.r * 255)}, ${Math.round(paperShadow.g * 255)}, ${Math.round(paperShadow.b * 255)}, 0.22)`;
	for (let y = 18; y < canvas.height / 2 - 10; y += 22) {
		ctx.beginPath();
		ctx.moveTo(0, y);
		for (let x = 0; x <= canvas.width; x += 16) {
			const offset = Math.sin((x + seed + variant * 11 + y) * 0.08) * 2;
			ctx.lineTo(x, y + offset);
		}
		ctx.stroke();
	}

	ctx.fillStyle = `#${woodDark.getHexString()}`;
	for (let x = 0; x < canvas.width; x += 21) {
		const plankWidth = 16 + Math.floor(noise2(seed + variant * 71, x, 3) * 8);
		ctx.fillRect(x, canvas.height / 2, 2, canvas.height / 2);
		ctx.globalAlpha = 0.18;
		ctx.fillRect(x + plankWidth - 3, canvas.height / 2, 2, canvas.height / 2);
		ctx.globalAlpha = 1;
	}

	ctx.strokeStyle = "rgba(40, 25, 15, 0.35)";
	for (let y = canvas.height / 2 + 14; y < canvas.height; y += 16) {
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(canvas.width, y);
		ctx.stroke();
	}

	ctx.fillStyle = "rgba(38, 27, 18, 0.45)";
	ctx.fillRect(0, canvas.height / 2 - 4, canvas.width, 6);
	return makeTexture(canvas, 1.35, 1);
}

function createPlainCorridorWallTexture(seed: number): CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 256;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return makeTexture(canvas, 1.4, 1);
	}

	ctx.fillStyle = "#d3d5d8";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	fillNoiseRect(ctx, canvas.width, canvas.height, seed + 1207, 0.035, 2);
	ctx.strokeStyle = "rgba(154, 160, 166, 0.18)";
	for (let y = 18; y < canvas.height; y += 22) {
		ctx.beginPath();
		ctx.moveTo(0, y);
		ctx.lineTo(canvas.width, y);
		ctx.stroke();
	}

	return makeTexture(canvas, 1.3, 1);
}

function createWallCapTexture(seed: number, variant: number): CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return makeTexture(canvas, 1.6, 1.6);
	}

	const wood = new Color(variant % 2 === 0 ? "#6b4a2f" : "#5b3f28");
	const woodDark = new Color(variant % 2 === 0 ? "#543723" : "#49311f");

	ctx.fillStyle = `#${wood.getHexString()}`;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	fillNoiseRect(ctx, canvas.width, canvas.height, seed + variant * 131, 0.08, 2);

	for (let y = 10; y < canvas.height; y += 14) {
		ctx.strokeStyle = `rgba(${Math.round(woodDark.r * 255)}, ${Math.round(woodDark.g * 255)}, ${Math.round(woodDark.b * 255)}, 0.28)`;
		ctx.beginPath();
		ctx.moveTo(0, y);
		for (let x = 0; x <= canvas.width; x += 16) {
			const offset = Math.sin((x + y + seed) * 0.07) * 2.5;
			ctx.lineTo(x, y + offset);
		}
		ctx.stroke();
	}

	return makeTexture(canvas, 1.6, 1.6);
}

function createPlainCorridorWallCapTexture(seed: number): CanvasTexture {
	const canvas = document.createElement("canvas");
	canvas.width = 128;
	canvas.height = 128;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return makeTexture(canvas, 1.6, 1.6);
	}
	ctx.fillStyle = "#caced1";
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	fillNoiseRect(ctx, canvas.width, canvas.height, seed + 1523, 0.03, 2);
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
