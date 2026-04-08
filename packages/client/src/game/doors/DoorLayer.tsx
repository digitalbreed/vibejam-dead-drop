import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Base, Geometry, Subtraction } from "@react-three/csg";
import type { DoorPlacement, DoorState, GameServerMessages } from "@vibejam/shared";
import { CELL_SIZE, ROOM_HEIGHT, generateDoorPlacements, generateMapLayout } from "@vibejam/shared";
import { Group, MathUtils, MeshToonMaterial, type Texture } from "three";
import { useRoom, useRoomState } from "../../colyseus/roomContext";
import { schemaMapValues } from "../../colyseus/schemaMap";
import { useEmbassyTextures } from "../decor";
import type { FogState } from "../GameScene";
import { useDoorAudio } from "./useDoorAudio";

const WALL_DEPTH = 0.14;
const DOUBLE_LEAF_HEIGHT = ROOM_HEIGHT - 0.42;
const DOUBLE_LEAF_CENTER_Y = 0.03 + DOUBLE_LEAF_HEIGHT / 2;
const SINGLE_LEAF_HEIGHT = ROOM_HEIGHT - 0.58;
const SINGLE_LEAF_CENTER_Y = 0.03 + SINGLE_LEAF_HEIGHT / 2;
const DOOR_THICKNESS = 0.1;
const DOUBLE_LEAF_WIDTH = 1.08;
const SINGLE_LEAF_WIDTH = 1.06;
const SINGLE_OPENING_WIDTH = SINGLE_LEAF_WIDTH + 0.02;
const DOUBLE_OPENING_WIDTH = DOUBLE_LEAF_WIDTH * 2 + 0.02;
const SINGLE_OPENING_HEIGHT = SINGLE_LEAF_HEIGHT + 0.06;
const DOUBLE_OPENING_HEIGHT = DOUBLE_LEAF_HEIGHT + 0.06;
const WALL_CAP_HEIGHT = 0.06;

type DoorRenderState = {
	isOpen: boolean;
	hingeSide: string;
	facing: string;
};

function fogTint(fog: FogState): string {
	return fog === "visible" ? "#ffffff" : "#67707a";
}

function mergeFog(a: FogState, b: FogState): FogState {
	if (a === "visible" || b === "visible") {
		return "visible";
	}
	if (a === "explored" || b === "explored") {
		return "explored";
	}
	return "hidden";
}

function normalizePortalSideFog(sideFog: FogState, otherSideFog: FogState): FogState {
	if (sideFog === "hidden") {
		return otherSideFog;
	}
	return sideFog;
}

function makeWallMaterials(
	positiveNormal: Texture,
	negativeNormal: Texture,
	positiveFog: FogState,
	negativeFog: FogState,
) {
	const positiveTint = fogTint(positiveFog);
	const negativeTint = fogTint(negativeFog);
	const topTint = fogTint(mergeFog(positiveFog, negativeFog));
	const mats = [
		new MeshToonMaterial({ map: positiveNormal, color: positiveTint }),
		new MeshToonMaterial({ map: negativeNormal, color: negativeTint }),
		new MeshToonMaterial({ color: topTint }),
		new MeshToonMaterial({ color: topTint }),
		new MeshToonMaterial({ map: positiveNormal, color: positiveTint }),
		new MeshToonMaterial({ map: negativeNormal, color: negativeTint }),
	];
	for (const mat of mats) {
		(mat as any).flatShading = true;
		mat.needsUpdate = true;
	}
	return mats;
}

function makeLeafMaterials(positiveNormal: string, negativeNormal: string, edge: string, metal: string) {
	return [
		new MeshToonMaterial({ color: positiveNormal}),
		new MeshToonMaterial({ color: negativeNormal}),
		new MeshToonMaterial({ color: edge}),
		new MeshToonMaterial({ color: metal}),
		new MeshToonMaterial({ color: edge}),
		new MeshToonMaterial({ color: edge}),
	];
}

function PortalFrame({
	openingWidth,
	openingHeight,
	positiveNormalWall,
	negativeNormalWall,
	positiveFog,
	negativeFog,
}: {
	openingWidth: number;
	openingHeight: number;
	positiveNormalWall: Texture;
	negativeNormalWall: Texture;
	positiveFog: FogState;
	negativeFog: FogState;
}) {
	const materials = useMemo(
		() => makeWallMaterials(positiveNormalWall, negativeNormalWall, positiveFog, negativeFog),
		[negativeFog, negativeNormalWall, positiveFog, positiveNormalWall],
	);
	const capMaterial = useMemo(
		() => {
			const mat = new MeshToonMaterial({ color: fogTint(mergeFog(positiveFog, negativeFog)) });
			(mat as any).flatShading = true;
			mat.needsUpdate = true;
			return mat;
		},
		[negativeFog, positiveFog],
	);
	const openingCenterY = openingHeight / 2 - ROOM_HEIGHT / 2;
	return (
		<group>
			<mesh position={[0, ROOM_HEIGHT / 2, 0]} material={materials} castShadow receiveShadow>
				<Geometry computeVertexNormals>
					<Base>
						<boxGeometry args={[WALL_DEPTH, ROOM_HEIGHT, CELL_SIZE]} />
					</Base>
					<Subtraction position={[0, openingCenterY, 0]}>
						<boxGeometry args={[WALL_DEPTH + 0.04, openingHeight, openingWidth]} />
					</Subtraction>
				</Geometry>
			</mesh>
			<mesh position={[0, ROOM_HEIGHT + WALL_CAP_HEIGHT / 2, 0]} castShadow receiveShadow>
				<Geometry computeVertexNormals>
					<Base>
						<boxGeometry args={[WALL_DEPTH + 0.005, WALL_CAP_HEIGHT, CELL_SIZE]} />
					</Base>
				</Geometry>
				<primitive object={capMaterial} attach="material" />
			</mesh>
		</group>
	);
}

function DoorLeaf({
	width,
	height,
	latchSide,
	positiveNormalColor,
	negativeNormalColor,
	edgeColor,
	metalColor,
}: {
	width: number;
	height: number;
	latchSide: "left" | "right";
	positiveNormalColor: string;
	negativeNormalColor: string;
	edgeColor: string;
	metalColor: string;
}) {
	const materials = useMemo(
		() => makeLeafMaterials(positiveNormalColor, negativeNormalColor, edgeColor, metalColor),
		[edgeColor, metalColor, negativeNormalColor, positiveNormalColor],
	);
	const panelMaterial = useMemo(
		() => new MeshToonMaterial({ color: edgeColor}),
		[edgeColor],
	);
	const knobMaterial = useMemo(
		() => new MeshToonMaterial({ color: metalColor}),
		[metalColor],
	);

	return (
		<group>
			<mesh material={materials} castShadow receiveShadow>
				<boxGeometry args={[DOOR_THICKNESS, height, width]} />
			</mesh>
			<mesh position={[0.02, 0, 0]} castShadow receiveShadow>
				<boxGeometry args={[0.04, height * 0.72, width * 0.62]} />
				<primitive object={panelMaterial} attach="material" />
			</mesh>
			<mesh position={[DOOR_THICKNESS / 2 + 0.02, 0, (latchSide === "left" ? -1 : 1) * width * 0.32]} castShadow receiveShadow>
				<sphereGeometry args={[0.045, 10, 10]} />
				<primitive object={knobMaterial} attach="material" />
			</mesh>
			<mesh position={[-DOOR_THICKNESS / 2 - 0.02, 0, (latchSide === "left" ? -1 : 1) * width * 0.32]} castShadow receiveShadow>
				<sphereGeometry args={[0.045, 10, 10]} />
				<primitive object={knobMaterial} attach="material" />
			</mesh>
		</group>
	);
}

function SingleDoor({
	isOpen,
	openingWidth,
	hingeSide,
	positiveNormalColor,
	negativeNormalColor,
	edgeColor,
	metalColor,
}: {
	isOpen: boolean;
	openingWidth: number;
	hingeSide: "left" | "right";
	positiveNormalColor: string;
	negativeNormalColor: string;
	edgeColor: string;
	metalColor: string;
}) {
	const hingeRef = useRef<Group>(null);
	const anchorZ = hingeSide === "left" ? -openingWidth / 2 : openingWidth / 2;

	useFrame((_, dt) => {
		const hinge = hingeRef.current;
		if (!hinge) {
			return;
		}
		const target = isOpen ? (hingeSide === "left" ? Math.PI * 0.52 : -Math.PI * 0.52) : 0;
		hinge.rotation.y = MathUtils.lerp(hinge.rotation.y, target, 1 - Math.exp(-dt * 14));
	});

	return (
		<group ref={hingeRef} position={[0, SINGLE_LEAF_CENTER_Y, anchorZ]}>
			<group position={[0, 0, hingeSide === "left" ? SINGLE_LEAF_WIDTH / 2 : -SINGLE_LEAF_WIDTH / 2]}>
				<DoorLeaf
					width={SINGLE_LEAF_WIDTH}
					height={SINGLE_LEAF_HEIGHT}
					latchSide={hingeSide === "left" ? "right" : "left"}
					positiveNormalColor={positiveNormalColor}
					negativeNormalColor={negativeNormalColor}
					edgeColor={edgeColor}
					metalColor={metalColor}
				/>
			</group>
		</group>
	);
}

function DoubleDoor({
	isOpen,
	openingWidth,
	leftPositiveNormalColor,
	leftNegativeNormalColor,
	rightPositiveNormalColor,
	rightNegativeNormalColor,
	edgeColor,
	metalColor,
}: {
	isOpen: boolean;
	openingWidth: number;
	leftPositiveNormalColor: string;
	leftNegativeNormalColor: string;
	rightPositiveNormalColor: string;
	rightNegativeNormalColor: string;
	edgeColor: string;
	metalColor: string;
}) {
	const leftRef = useRef<Group>(null);
	const rightRef = useRef<Group>(null);

	useFrame((_, dt) => {
		const alpha = 1 - Math.exp(-dt * 14);
		const target = isOpen ? Math.PI * 0.46 : 0;
		if (leftRef.current) {
			leftRef.current.rotation.y = MathUtils.lerp(leftRef.current.rotation.y, target, alpha);
		}
		if (rightRef.current) {
			rightRef.current.rotation.y = MathUtils.lerp(rightRef.current.rotation.y, -target, alpha);
		}
	});

	return (
		<>
			<group ref={leftRef} position={[0, DOUBLE_LEAF_CENTER_Y, -openingWidth / 2]}>
				<group position={[0, 0, DOUBLE_LEAF_WIDTH / 2]}>
					<DoorLeaf
						width={DOUBLE_LEAF_WIDTH}
						height={DOUBLE_LEAF_HEIGHT}
						latchSide="right"
						positiveNormalColor={leftPositiveNormalColor}
						negativeNormalColor={leftNegativeNormalColor}
						edgeColor={edgeColor}
						metalColor={metalColor}
					/>
				</group>
			</group>
			<group ref={rightRef} position={[0, DOUBLE_LEAF_CENTER_Y, openingWidth / 2]}>
				<group position={[0, 0, -DOUBLE_LEAF_WIDTH / 2]}>
					<DoorLeaf
						width={DOUBLE_LEAF_WIDTH}
						height={DOUBLE_LEAF_HEIGHT}
						latchSide="left"
						positiveNormalColor={rightPositiveNormalColor}
						negativeNormalColor={rightNegativeNormalColor}
						edgeColor={edgeColor}
						metalColor={metalColor}
					/>
				</group>
			</group>
		</>
	);
}

function DoorItem({
	placement,
	doorState,
	side1Fog,
	side2Fog,
	side1Wall,
	side2Wall,
}: {
	placement: DoorPlacement;
	doorState?: DoorRenderState;
	side1Fog: FogState;
	side2Fog: FogState;
	side1Wall: Texture;
	side2Wall: Texture;
}) {
	const fog = mergeFog(side1Fog, side2Fog);
	if (fog === "hidden") {
		return null;
	}
	const facing = placement.facing;
	const hingeSide: "left" | "right" = doorState?.hingeSide === "right" ? "right" : placement.hingeSide;
	const isOpen = doorState?.isOpen ?? false;
	const isHallSide1 = placement.side1Kind === "hall";
	const isHallSide2 = placement.side2Kind === "hall";
	const side1Color = isHallSide1 ? "#c9cccf" : "#6f503f";
	const side1AltColor = isHallSide1 ? "#b8bdc2" : "#81604d";
	const side2Color = isHallSide2 ? "#c9cccf" : "#6f503f";
	const side2AltColor = isHallSide2 ? "#b8bdc2" : "#81604d";
	const edgeColor = isHallSide1 || isHallSide2 ? "#8d949a" : "#c8b18b";
	const metalColor = isHallSide1 || isHallSide2 ? "#6e757a" : "#735f4f";
	const openingWidth = placement.variant === "double" ? DOUBLE_OPENING_WIDTH : SINGLE_OPENING_WIDTH;
	const openingHeight = placement.variant === "double" ? DOUBLE_OPENING_HEIGHT : SINGLE_OPENING_HEIGHT;
	let normalizedSide1Fog = normalizePortalSideFog(side1Fog, side2Fog);
	let normalizedSide2Fog = normalizePortalSideFog(side2Fog, side1Fog);
	if (normalizedSide1Fog === "visible" || normalizedSide2Fog === "visible") {
		normalizedSide1Fog = "visible";
		normalizedSide2Fog = "visible";
	}
	const side1IsPositive = placement.facing === "x" ? placement.ix1 > placement.ix2 : placement.iz1 > placement.iz2;
	const normals = side1IsPositive
		? {
				negativeWall: side2Wall,
				positiveWall: side1Wall,
				negativeFog: normalizedSide2Fog,
				positiveFog: normalizedSide1Fog,
				negativeColor: side2Color,
				negativeAltColor: side2AltColor,
				positiveColor: side1Color,
				positiveAltColor: side1AltColor,
		  }
		: {
				negativeWall: side1Wall,
				positiveWall: side2Wall,
				negativeFog: normalizedSide1Fog,
				positiveFog: normalizedSide2Fog,
				negativeColor: side1Color,
				negativeAltColor: side1AltColor,
				positiveColor: side2Color,
				positiveAltColor: side2AltColor,
		  };

	return (
		<group position={[placement.x, 0, placement.z]} rotation={[0, facing === "z" ? -Math.PI / 2 : 0, 0]}>
			<PortalFrame
				openingWidth={openingWidth}
				openingHeight={openingHeight}
				positiveNormalWall={normals.positiveWall}
				negativeNormalWall={normals.negativeWall}
				positiveFog={normals.positiveFog}
				negativeFog={normals.negativeFog}
			/>
			{placement.variant === "double" ? (
				<DoubleDoor
					isOpen={isOpen}
					openingWidth={openingWidth}
					leftPositiveNormalColor={normals.positiveColor}
					leftNegativeNormalColor={normals.negativeColor}
					rightPositiveNormalColor={normals.positiveAltColor}
					rightNegativeNormalColor={normals.negativeAltColor}
					edgeColor={edgeColor}
					metalColor={metalColor}
				/>
			) : (
				<SingleDoor
					isOpen={isOpen}
					openingWidth={openingWidth}
					hingeSide={hingeSide}
					positiveNormalColor={normals.positiveColor}
					negativeNormalColor={normals.negativeColor}
					edgeColor={edgeColor}
					metalColor={metalColor}
				/>
			)}
		</group>
	);
}

export function DoorLayer({
	fogByCell,
	revealAll,
	audioEnabled = true,
}: {
	fogByCell: Map<string, FogState>;
	revealAll: boolean;
	audioEnabled?: boolean;
}) {
	useDoorAudio(audioEnabled);
	const { room } = useRoom();
	const interactables = useRoomState((state) => state.interactables);
	const mapSeed = useRoomState((state) => state.mapSeed);
	const mapMaxDistance = useRoomState((state) => state.mapMaxDistance);
	const layout = useMemo(() => generateMapLayout(mapSeed ?? 0, mapMaxDistance ?? 12), [mapMaxDistance, mapSeed]);
	const placements = useMemo(() => generateDoorPlacements(layout), [layout]);
	const list = useMemo(() => schemaMapValues<DoorState>(interactables), [interactables]);
	const [openById, setOpenById] = useState<Map<string, boolean>>(
		() => new Map(placements.map((placement) => [placement.id, false])),
	);
	const stateById = useMemo(
		() =>
			new Map(
				list.map((door) => [
					door.id,
					{
						isOpen: openById.get(door.id) ?? false,
						hingeSide: door.hingeSide,
						facing: door.facing,
					} satisfies DoorRenderState,
				]),
			),
		[list, openById],
	);
	const textures = useEmbassyTextures(layout.seed);

	useEffect(() => {
		setOpenById((current) => {
			const next = new Map<string, boolean>();
			for (const placement of placements) {
				next.set(placement.id, current.get(placement.id) ?? false);
			}
			for (const door of list) {
				if (!next.has(door.id) || current.get(door.id) === undefined) {
					next.set(door.id, door.isOpen);
				}
			}
			return next;
		});
	}, [list, placements]);

	useEffect(() => {
		if (!room) {
			return;
		}
		return room.onMessage("interactable_event", (event: GameServerMessages["interactable_event"]) => {
			if (event.kind !== "door") {
				return;
			}
			setOpenById((current) => {
				const next = new Map(current);
				next.set(event.id, event.action === "opened");
				return next;
			});
		});
	}, [room]);

	return (
		<group>
			{placements.map((placement) => (
				(() => {
					const fog1 = fogByCell.get(`${placement.ix1},${placement.iz1}`) ?? "hidden";
					const fog2 = fogByCell.get(`${placement.ix2},${placement.iz2}`) ?? "hidden";
					const side1Fog: FogState = revealAll ? "visible" : fog1;
					const side2Fog: FogState = revealAll ? "visible" : fog2;
					return (
				<DoorItem
					key={placement.id}
					placement={placement}
					doorState={
						stateById.get(placement.id) ?? {
							isOpen: openById.get(placement.id) ?? false,
							hingeSide: placement.hingeSide,
							facing: placement.facing,
						}
					}
					side1Fog={side1Fog}
					side2Fog={side2Fog}
					side1Wall={textures.walls[placement.side1WallStyle]!}
					side2Wall={textures.walls[placement.side2WallStyle]!}
				/>
					);
				})()
			))}
		</group>
	);
}


