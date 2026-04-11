import { useMemo } from "react";
import { Color } from "three";
import {
	CELL_SIZE,
	ROOM_HEIGHT,
	generateEscapeLadderPlacement,
	generateMapLayout,
	type EscapeLadderPlacement,
} from "@vibejam/shared";
import type { AreaInfo, FogState } from "../GameScene";
import { OutlinedMesh } from "../toonOutline/OutlinedMesh";

function fogAtPosition(fogByCell: Map<string, FogState>, x: number, z: number): FogState {
	return fogByCell.get(`${Math.round(x / CELL_SIZE)},${Math.round(z / CELL_SIZE)}`) ?? "hidden";
}

function ladderPalette(inSameRoom: boolean) {
	if (inSameRoom) {
		return {
			steel: new Color("#e1e6ee"),
			steelDark: new Color("#d0d6de"),
		};
	}
	return {
		steel: new Color("#b8c0c9"),
		steelDark: new Color("#a1aab5"),
	};
}

function EscapeLadderMesh({
	ladder,
	inSameRoom,
	outlined,
}: {
	ladder: EscapeLadderPlacement;
	inSameRoom: boolean;
	outlined: boolean;
}) {
	const palette = useMemo(() => ladderPalette(inSameRoom), [inSameRoom]);

	const height = Math.max(1.2, Math.min(ROOM_HEIGHT + 2.2, ladder.height));
	const width = Math.max(0.6, Math.min(1.4, ladder.width));
	const depth = Math.max(0.12, Math.min(0.28, ladder.depth));

	const railThickness = 0.06;
	const rungThickness = 0.045;
	const rungDepth = depth * 0.75;
	const clearTop = 0.12;
	const clearBottom = 0.08;
	const usableHeight = Math.max(0.8, height - clearTop - clearBottom);
	const rungCount = Math.max(6, Math.min(18, Math.floor(usableHeight / 0.24)));
	const rungSpacing = usableHeight / (rungCount - 1);
	const rungY0 = -height / 2 + clearBottom;

	// Wide side always faces the game camera: stretch east-west (X). No rotation needed.
	return (
		<group position={[ladder.x, height / 2, ladder.z]}>
			<OutlinedMesh
				outlined={outlined}
				castShadow
				receiveShadow
				position={[-width / 2 + railThickness / 2, 0, 0]}
				geometryNode={<boxGeometry args={[railThickness, height, depth]} />}
				materialNode={<meshStandardMaterial color={palette.steelDark} roughness={0.5} metalness={0.3} />}
			/>
			<OutlinedMesh
				outlined={outlined}
				castShadow
				receiveShadow
				position={[width / 2 - railThickness / 2, 0, 0]}
				geometryNode={<boxGeometry args={[railThickness, height, depth]} />}
				materialNode={<meshStandardMaterial color={palette.steelDark} roughness={0.5} metalness={0.3} />}
			/>
			{Array.from({ length: rungCount }, (_, i) => (
				<OutlinedMesh
					key={i}
					outlined={outlined}
					castShadow
					receiveShadow
					position={[0, rungY0 + i * rungSpacing, 0]}
					geometryNode={<boxGeometry args={[width - railThickness * 1.6, rungThickness, rungDepth]} />}
					materialNode={<meshStandardMaterial color={palette.steel} roughness={0.45} metalness={0.35} />}
				/>
			))}
		</group>
	);
}

export function EscapeLadderLayer({
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
	const layout = useMemo(() => generateMapLayout(mapSeed, mapMaxDistance), [mapSeed, mapMaxDistance]);
	const ladder = useMemo(() => generateEscapeLadderPlacement(layout), [layout]);
	if (!ladder) {
		return null;
	}
	const visible = revealAll || fogAtPosition(fogByCell, ladder.x, ladder.z) !== "hidden";
	if (!visible) {
		return null;
	}
	const cellKey = `${Math.round(ladder.x / CELL_SIZE)},${Math.round(ladder.z / CELL_SIZE)}`;
	const ladderArea = areaInfo.labelByCell.get(cellKey);
	const inSameRoom = !ladderArea || ladderArea === currentArea;
	const outlined = outlinesEnabled && (forceAllOutlined || (!revealAll && inSameRoom));
	return (
		<group>
			<EscapeLadderMesh ladder={ladder} inSameRoom={inSameRoom} outlined={outlined} />
		</group>
	);
}
