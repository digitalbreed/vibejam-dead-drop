import { useEffect, useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import {
	generateFileCabinetPlacements,
	generateMapLayout,
	generateRoomDecorPlacements,
	type FrameWallSide,
	type PaperPlacement,
	type PictureFramePlacement,
	type TablePlacement,
} from "@vibejam/shared";
import { Color, DoubleSide, MeshToonMaterial, SRGBColorSpace, Texture, TextureLoader } from "three";
import type { AreaInfo, FogState } from "../GameScene";
import { buildLightingFixtures } from "../LightingLayer";
import { OutlinedMesh } from "../toonOutline/OutlinedMesh";

const TABLE_TOP_COLOR = new Color("#89684a");
const TABLE_LEG_COLOR = new Color("#5f4431");
const PAPER_COLOR = new Color("#f5f2e7");
const PAPER_COLOR_DIM = new Color("#8d877b");
const FRAME_GOLD = new Color("#b98a2e");
const FRAME_GOLD_DIM = new Color("#6f5b2d");

const FRAME_SPRITE_WIDTH = 57;
const FRAME_SPRITE_HEIGHT = 69;
const FRAME_SPRITES_PER_ROW = 4;
const FRAME_OUTER_WIDTH = 1.1;
const FRAME_OUTER_HEIGHT = 1.34;
const FRAME_DEPTH = 0.09;
const FRAME_LAYER2_WIDTH = 0.96;
const FRAME_LAYER2_HEIGHT = 1.18;
const FRAME_LAYER2_DEPTH = 0.055;
const FRAME_LAYER2_OFFSET_Z = 0.02;
const FRAME_INNER_WIDTH = 0.76;
const FRAME_INNER_HEIGHT = 0.92;
const FRAME_CENTER_Y = 1.86;
const FRAME_STANDOFF_Z = 0.078;
const FRAME_PORTRAIT_INSET_Z = 0.002;
type DecorRenderMode = "hidden" | "memory" | "active";

function wallForCabinetFacing(facing: string): FrameWallSide | "south" {
	switch (facing) {
		case "north":
			return "south";
		case "east":
			return "west";
		case "west":
			return "east";
		case "south":
		default:
			return "north";
	}
}

function frameBlockedByCabinet(
	frame: PictureFramePlacement,
	cabinet: { x: number; z: number; width: number; facing: string },
): boolean {
	const cabinetWall = wallForCabinetFacing(cabinet.facing);
	if (cabinetWall !== frame.wall) {
		return false;
	}
	const edgePadding = 0.3;
	if (frame.wall === "north") {
		return Math.abs(frame.x - cabinet.x) <= cabinet.width * 0.5 + edgePadding && Math.abs(frame.z - cabinet.z) <= 0.65;
	}
	return Math.abs(frame.z - cabinet.z) <= cabinet.width * 0.5 + edgePadding && Math.abs(frame.x - cabinet.x) <= 0.65;
}

function fogAtCell(fogByCell: Map<string, FogState>, ix: number, iz: number): FogState {
	return fogByCell.get(`${ix},${iz}`) ?? "hidden";
}

function frameRotation(wall: FrameWallSide): number {
	switch (wall) {
		case "north":
			return 0;
		case "west":
			return -Math.PI / 2;
		case "east":
		default:
			return Math.PI / 2;
	}
}

function decorModeAtCell(
	ix: number,
	iz: number,
	fogByCell: Map<string, FogState>,
	areaInfo: AreaInfo,
	currentArea: string,
	forceAllOutlined: boolean,
	revealAll: boolean,
): DecorRenderMode {
	const fog = fogAtCell(fogByCell, ix, iz);
	if (!revealAll && fog === "hidden") {
		return "hidden";
	}
	const areaLabel = areaInfo.labelByCell.get(`${ix},${iz}`);
	if (forceAllOutlined || !areaLabel || areaLabel === currentArea) {
		return "active";
	}
	return "memory";
}

function tone(base: Color, mode: Exclude<DecorRenderMode, "hidden">): Color {
	const factor = mode === "active" ? 1 : 0.62;
	return base.clone().multiplyScalar(factor);
}

function tableRotationY(table: TablePlacement): number {
	return table.rotationQuarter * (Math.PI / 2);
}

function buildPortraitTextureMap(frames: PictureFramePlacement[], base: Texture): Map<string, Texture> {
	const map = new Map<string, Texture>();
	const width = (base.image as { width?: number } | undefined)?.width ?? FRAME_SPRITE_WIDTH * FRAME_SPRITES_PER_ROW;
	const height = (base.image as { height?: number } | undefined)?.height ?? FRAME_SPRITE_HEIGHT;
	const rows = Math.max(1, Math.floor(height / FRAME_SPRITE_HEIGHT));
	const totalPortraits = rows * FRAME_SPRITES_PER_ROW;
	const repeatX = FRAME_SPRITE_WIDTH / width;
	const repeatY = FRAME_SPRITE_HEIGHT / height;

	for (const frame of frames) {
		const wrappedIndex = totalPortraits > 0 ? frame.portraitIndex % totalPortraits : 0;
		const col = wrappedIndex % FRAME_SPRITES_PER_ROW;
		const row = Math.floor(wrappedIndex / FRAME_SPRITES_PER_ROW);
		const tex = base.clone();
		tex.colorSpace = SRGBColorSpace;
		tex.repeat.set(repeatX, repeatY);
		tex.offset.set(col * repeatX, 1 - (row + 1) * repeatY);
		tex.needsUpdate = true;
		map.set(frame.id, tex);
	}

	return map;
}

function TableMesh({
	table,
	outlined,
	visible,
	mode,
}: {
	table: TablePlacement;
	outlined: boolean;
	visible: boolean;
	mode: Exclude<DecorRenderMode, "hidden">;
}) {
	const legHeight = Math.max(0.3, table.height - table.plateThickness);
	const legHalf = table.legThickness * 0.5;
	const edgeInset = 0.07;
	const legOffsetX = table.width * 0.5 - legHalf - edgeInset;
	const legOffsetZ = table.depth * 0.5 - legHalf - edgeInset;
	const legPositions: Array<[number, number]> = [
		[-legOffsetX, -legOffsetZ],
		[legOffsetX, -legOffsetZ],
		[-legOffsetX, legOffsetZ],
		[legOffsetX, legOffsetZ],
	];
	const legColor = tone(TABLE_LEG_COLOR, mode);
	const topColor = tone(TABLE_TOP_COLOR, mode);

	return (
		<group position={[table.x, 0, table.z]} rotation={[0, tableRotationY(table), 0]} visible={visible}>
			{legPositions.map(([x, z], index) => (
				<OutlinedMesh
					key={`${table.id}-leg-${index}`}
					position={[x, legHeight * 0.5, z]}
					castShadow
					receiveShadow
					outlined={outlined}
					geometryNode={<boxGeometry args={[table.legThickness, legHeight, table.legThickness]} />}
					materialNode={<meshToonMaterial color={legColor} />}
				/>
			))}
			<OutlinedMesh
				position={[0, legHeight + table.plateThickness * 0.5, 0]}
				castShadow
				receiveShadow
				outlined={outlined}
				geometryNode={<boxGeometry args={[table.width, table.plateThickness, table.depth]} />}
				materialNode={<meshToonMaterial color={topColor} />}
			/>
		</group>
	);
}

function PaperMesh({
	paper,
	outlined,
	visible,
	mode,
}: {
	paper: PaperPlacement;
	outlined: boolean;
	visible: boolean;
	mode: Exclude<DecorRenderMode, "hidden">;
}) {
	const paperColor = mode === "active" ? PAPER_COLOR : PAPER_COLOR_DIM;
	return (
		<group position={[paper.x, 0.088, paper.z]} rotation={[0, paper.rotationRad, 0]} visible={visible}>
			<OutlinedMesh
				rotation={[-Math.PI / 2, 0, 0]}
				castShadow={false}
				receiveShadow
				outlined={outlined}
				outlineThickness={0.018}
				geometryNode={<boxGeometry args={[paper.width, paper.height, 0.01]} />}
				materialNode={<meshToonMaterial color={paperColor} />}
			/>
		</group>
	);
}

function FrameMesh({
	frame,
	outlined,
	visible,
	mode,
	portraitTexture,
}: {
	frame: PictureFramePlacement;
	outlined: boolean;
	visible: boolean;
	mode: Exclude<DecorRenderMode, "hidden">;
	portraitTexture: Texture | undefined;
}) {
	const rotationY = frameRotation(frame.wall);
	const frameColor = mode === "active" ? FRAME_GOLD : FRAME_GOLD_DIM;
	const innerRingOpeningWidth = FRAME_INNER_WIDTH + 0.04;
	const innerRingOpeningHeight = FRAME_INNER_HEIGHT + 0.04;
	const portraitMaterial = useMemo(() => {
		const mat = new MeshToonMaterial({
			color: mode === "active" ? new Color("#ffffff") : new Color("#a4abb3"),
			map: portraitTexture,
			side: DoubleSide,
		});
		return mat;
	}, [mode, portraitTexture]);

	useEffect(() => {
		return () => {
			portraitMaterial.dispose();
		};
	}, [portraitMaterial]);

	return (
		<group position={[frame.x, FRAME_CENTER_Y, frame.z]} rotation={[0, rotationY, 0]} visible={visible}>
			<FrameRing
				outlined={outlined}
				outerWidth={FRAME_OUTER_WIDTH}
				outerHeight={FRAME_OUTER_HEIGHT}
				innerWidth={FRAME_LAYER2_WIDTH}
				innerHeight={FRAME_LAYER2_HEIGHT}
				depth={FRAME_DEPTH}
				centerZ={FRAME_STANDOFF_Z}
				color={frameColor}
				emissive={outlined ? "#b78f3c" : "#70592b"}
				emissiveIntensity={mode === "active" ? (outlined ? 0.5 : 0.2) : 0.08}
			/>
			<FrameRing
				outlined={outlined}
				outerWidth={FRAME_LAYER2_WIDTH}
				outerHeight={FRAME_LAYER2_HEIGHT}
				innerWidth={innerRingOpeningWidth}
				innerHeight={innerRingOpeningHeight}
				depth={FRAME_LAYER2_DEPTH}
				centerZ={FRAME_STANDOFF_Z + FRAME_LAYER2_OFFSET_Z}
				color={outlined ? "#c59a44" : "#776335"}
				emissive={outlined ? "#9a742e" : "#5f4c27"}
				emissiveIntensity={mode === "active" ? (outlined ? 0.38 : 0.15) : 0.06}
			/>
			<mesh position={[0, 0, FRAME_STANDOFF_Z + FRAME_PORTRAIT_INSET_Z]}>
				<planeGeometry args={[FRAME_INNER_WIDTH, FRAME_INNER_HEIGHT]} />
				<primitive object={portraitMaterial} attach="material" />
			</mesh>
		</group>
	);
}

function FrameRing({
	outlined,
	outerWidth,
	outerHeight,
	innerWidth,
	innerHeight,
	depth,
	centerZ,
	color,
	emissive,
	emissiveIntensity,
}: {
	outlined: boolean;
	outerWidth: number;
	outerHeight: number;
	innerWidth: number;
	innerHeight: number;
	depth: number;
	centerZ: number;
	color: string | Color;
	emissive: string;
	emissiveIntensity: number;
}) {
	const verticalThickness = Math.max(0.03, (outerWidth - innerWidth) * 0.5);
	const horizontalThickness = Math.max(0.03, (outerHeight - innerHeight) * 0.5);
	const sideHeight = Math.max(0.03, innerHeight);
	return (
		<group>
			<OutlinedMesh
				position={[0, outerHeight * 0.5 - horizontalThickness * 0.5, centerZ]}
				castShadow
				receiveShadow
				outlined={outlined}
				geometryNode={<boxGeometry args={[outerWidth, horizontalThickness, depth]} />}
				materialNode={
					<meshToonMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
				}
			/>
			<OutlinedMesh
				position={[0, -outerHeight * 0.5 + horizontalThickness * 0.5, centerZ]}
				castShadow
				receiveShadow
				outlined={outlined}
				geometryNode={<boxGeometry args={[outerWidth, horizontalThickness, depth]} />}
				materialNode={
					<meshToonMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
				}
			/>
			<OutlinedMesh
				position={[outerWidth * 0.5 - verticalThickness * 0.5, 0, centerZ]}
				castShadow
				receiveShadow
				outlined={outlined}
				geometryNode={<boxGeometry args={[verticalThickness, sideHeight, depth]} />}
				materialNode={
					<meshToonMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
				}
			/>
			<OutlinedMesh
				position={[-outerWidth * 0.5 + verticalThickness * 0.5, 0, centerZ]}
				castShadow
				receiveShadow
				outlined={outlined}
				geometryNode={<boxGeometry args={[verticalThickness, sideHeight, depth]} />}
				materialNode={
					<meshToonMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} />
				}
			/>
		</group>
	);
}

export function RoomDecorLayer({
	fogByCell,
	revealAll,
	forceAllOutlined = false,
	mapSeed,
	mapMaxDistance,
	areaInfo,
	currentArea,
	outlinesEnabled = true,
}: {
	fogByCell: Map<string, FogState>;
	revealAll: boolean;
	forceAllOutlined?: boolean;
	mapSeed: number;
	mapMaxDistance: number;
	areaInfo: AreaInfo;
	currentArea: string;
	outlinesEnabled?: boolean;
}) {
	const layout = useMemo(() => generateMapLayout(mapSeed, mapMaxDistance), [mapMaxDistance, mapSeed]);
	const placements = useMemo(() => generateRoomDecorPlacements(layout), [layout]);
	const cabinets = useMemo(() => generateFileCabinetPlacements(layout), [layout]);
	const wallLights = useMemo(
		() => buildLightingFixtures(layout, areaInfo).filter((fixture) => fixture.kind === "wall"),
		[areaInfo, layout],
	);
	const visibleFrames = useMemo(() => {
		const frameBlockedByLight = (frame: PictureFramePlacement) =>
			wallLights.some((fixture) => Math.hypot(fixture.x - frame.x, fixture.z - frame.z) < 0.62);
		const frameBlockedByAnyCabinet = (frame: PictureFramePlacement) =>
			cabinets.some((cabinet) => frameBlockedByCabinet(frame, cabinet));
		return placements.frames
			.filter((frame) => !frameBlockedByLight(frame) && !frameBlockedByAnyCabinet(frame))
			.map((frame, portraitIndex) => ({ ...frame, portraitIndex }));
	}, [cabinets, placements.frames, wallLights]);
	const portraitAtlasTexture = useLoader(TextureLoader, "/portraits.png");
	const portraitTextureByFrameId = useMemo(
		() => buildPortraitTextureMap(visibleFrames, portraitAtlasTexture),
		[portraitAtlasTexture, visibleFrames],
	);

	useEffect(() => {
		return () => {
			for (const tex of portraitTextureByFrameId.values()) {
				tex.dispose();
			}
		};
	}, [portraitTextureByFrameId]);

	return (
		<group>
			{placements.tables.map((table) => {
				const mode = decorModeAtCell(
					table.ix,
					table.iz,
					fogByCell,
					areaInfo,
					currentArea,
					forceAllOutlined,
					revealAll,
				);
				if (mode === "hidden") {
					return null;
				}
				const outlined = outlinesEnabled && mode === "active";
				return <TableMesh key={table.id} table={table} outlined={outlined} visible mode={mode} />;
			})}
			{placements.papers.map((paper) => {
				const mode = decorModeAtCell(
					paper.ix,
					paper.iz,
					fogByCell,
					areaInfo,
					currentArea,
					forceAllOutlined,
					revealAll,
				);
				if (mode === "hidden") {
					return null;
				}
				const outlined = outlinesEnabled && mode === "active";
				return <PaperMesh key={paper.id} paper={paper} outlined={outlined} visible mode={mode} />;
			})}
			{visibleFrames.map((frame) => {
				const mode = decorModeAtCell(
					frame.ix,
					frame.iz,
					fogByCell,
					areaInfo,
					currentArea,
					forceAllOutlined,
					revealAll,
				);
				if (mode === "hidden") {
					return null;
				}
				const outlined = outlinesEnabled && mode === "active";
				return (
					<FrameMesh
						key={frame.id}
						frame={frame}
						outlined={outlined}
						visible
						mode={mode}
						portraitTexture={portraitTextureByFrameId.get(frame.id)}
					/>
				);
			})}
		</group>
	);
}
