import { useMemo } from "react";
import {
	CELL_SIZE,
	generateFileCabinetPlacements,
	generateMapLayout,
	type FileCabinetPlacement,
} from "@vibejam/shared";
import { Color } from "three";
import type { AreaInfo, FogState } from "../GameScene";
import { OutlinedMesh } from "../toonOutline/OutlinedMesh";

function fogAtPosition(fogByCell: Map<string, FogState>, x: number, z: number): FogState {
	return fogByCell.get(`${Math.round(x / CELL_SIZE)},${Math.round(z / CELL_SIZE)}`) ?? "hidden";
}

function rotationForFacing(facing: string): number {
	// Local +Z is the drawer face. Map that to world direction given by `facing` (into the room).
	switch (facing) {
		case "north":
			return Math.PI;
		case "east":
			return Math.PI / 2;
		case "west":
			return -Math.PI / 2;
		case "south":
		default:
			return 0;
	}
}

/** Match `LightingLayer` wall fixtures: bright in current area, muted in explored elsewhere. */
function cabinetPalette(inSameRoom: boolean) {
	if (inSameRoom) {
		return {
			carcass: new Color("#a8b0ba"),
			drawer: new Color("#c4cbd4"),
			handle: new Color("#8e96a0"),
		};
	}
	return {
		carcass: new Color("#5a626c"),
		drawer: new Color("#6e7680"),
		handle: new Color("#4a5159"),
	};
}

function FileCabinetMesh({ cabinet, inSameRoom }: { cabinet: FileCabinetPlacement; inSameRoom: boolean }) {
	const width = Math.max(0.5, Math.min(2, cabinet.width));
	const height = Math.max(1, Math.min(2.5, cabinet.height));
	const depth = Math.max(0.2, Math.min(0.65, cabinet.depth));
	const rotationY = rotationForFacing(cabinet.facing);

	const stackCount = Math.min(4, Math.max(2, Math.floor(cabinet.drawerCount)));
	const palette = useMemo(() => cabinetPalette(inSameRoom), [inSameRoom]);

	const EXTRUDE = 0.034 * (4 / 3);
	const carcassDepth = Math.max(0.12, depth - EXTRUDE);
	const zCarcassCenter = -depth / 2 + carcassDepth / 2;
	const zFrontPlane = depth / 2 - EXTRUDE;
	const drawerFaceDepth = EXTRUDE + 0.012;
	const slotH = height / stackCount;
	// Wider gaps help toon outlines read at gameplay distance.
	const drawerGap = 0.04;
	const sideInset = 0.05;
	const drawerWidth = Math.max(0.2, width - sideInset * 2);

	const drawerSlots = useMemo(() => {
		const slots: { y: number; h: number; z: number }[] = [];
		for (let i = 0; i < stackCount; i++) {
			const h = Math.max(0.08, slotH - drawerGap);
			const y = -height / 2 + (i + 0.5) * slotH;
			const z = zFrontPlane + drawerFaceDepth / 2;
			slots.push({ y, h, z });
		}
		return slots;
	}, [stackCount, height, slotH, zFrontPlane, drawerFaceDepth]);

	// Drawer faces sit very close to the carcass; give the outline a bit more help.
	const CABINET_OUTLINE_THICKNESS = 0.04;
	const DRAWER_OUTLINE_THICKNESS = 0.02;
	const DRAWER_FRONT_BIAS = 0.04;

	return (
		<group position={[cabinet.x, height / 2, cabinet.z]} rotation={[0, rotationY, 0]}>
			<OutlinedMesh
				receiveShadow
				castShadow={false}
				outlined={inSameRoom}
				outlineThickness={CABINET_OUTLINE_THICKNESS}
				position={[0, 0, zCarcassCenter]}
				geometryNode={<boxGeometry args={[width * 0.995, height * 0.998, carcassDepth]} />}
				materialNode={<meshToonMaterial color={palette.carcass} />}
			/>
			{drawerSlots.map((slot, index) => (
				<group key={index}>
					<OutlinedMesh
						castShadow
						receiveShadow
						outlined={inSameRoom}
						outlineThickness={DRAWER_OUTLINE_THICKNESS}
						position={[0, slot.y, slot.z + DRAWER_FRONT_BIAS]}
						geometryNode={<boxGeometry args={[drawerWidth, slot.h, drawerFaceDepth]} />}
						materialNode={<meshToonMaterial color={palette.drawer} />}
					/>
					<OutlinedMesh
						castShadow={false}
						outlined={inSameRoom}
						outlineThickness={DRAWER_OUTLINE_THICKNESS}
						position={[0, slot.y - slot.h * 0.08, slot.z + drawerFaceDepth * 0.3 + DRAWER_FRONT_BIAS]}
						geometryNode={<boxGeometry args={[drawerWidth * 0.22, 0.028, 0.014]} />}
						materialNode={<meshToonMaterial color={palette.handle} />}
					/>
				</group>
			))}
		</group>
	);
}

/**
 * World pose is always from seed (`generateFileCabinetPlacements`); synced `searchedMask` is not
 * shown on the mesh (server still tracks it for gameplay).
 */
export function FileCabinetLayer({
	fogByCell,
	revealAll,
	mapSeed,
	mapMaxDistance,
	areaInfo,
	currentArea,
	outlinesEnabled = true,
}: {
	fogByCell: Map<string, FogState>;
	revealAll: boolean;
	mapSeed: number;
	mapMaxDistance: number;
	areaInfo: AreaInfo;
	currentArea: string;
	outlinesEnabled?: boolean;
}) {
	const layout = useMemo(() => generateMapLayout(mapSeed, mapMaxDistance), [mapSeed, mapMaxDistance]);
	const placements = useMemo(() => generateFileCabinetPlacements(layout), [layout]);

	return (
		<group>
			{placements.map((cabinet, index) => {
				const visible = revealAll || fogAtPosition(fogByCell, cabinet.x, cabinet.z) !== "hidden";
				if (!visible) {
					return null;
				}
				const cellKey = `${Math.round(cabinet.x / CELL_SIZE)},${Math.round(cabinet.z / CELL_SIZE)}`;
				const cabinetArea = areaInfo.labelByCell.get(cellKey);
				const inSameRoom = outlinesEnabled && (!cabinetArea || cabinetArea === currentArea);
				const renderKey = cabinet.id && cabinet.id.length > 0 ? cabinet.id : `file-cabinet-${index}`;
				return <FileCabinetMesh key={renderKey} cabinet={cabinet} inSameRoom={inSameRoom} />;
			})}
		</group>
	);
}



