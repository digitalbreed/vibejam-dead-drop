import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CELL_SIZE, type SuitcaseState } from "@vibejam/shared";
import type { Group } from "three";
import { useRoomState } from "../../colyseus/roomContext";
import { schemaMapValues } from "../../colyseus/schemaMap";
import type { FogState } from "../GameScene";
import { useSuitcaseAudio } from "./useSuitcaseAudio";
import { OutlinedMesh } from "../toonOutline/OutlinedMesh";

function fogAtPosition(fogByCell: Map<string, FogState>, x: number, z: number): FogState {
	return fogByCell.get(`${Math.round(x / CELL_SIZE)},${Math.round(z / CELL_SIZE)}`) ?? "hidden";
}

function GroundSuitcase({ suitcase, visible, outlined }: { suitcase: SuitcaseState; visible: boolean; outlined: boolean }) {
	const groupRef = useRef<Group>(null);
	const phaseSeed = (suitcase.suitcaseId || suitcase.id || "suitcase").length;

	useFrame((state) => {
		if (!groupRef.current) {
			return;
		}
		groupRef.current.position.x = suitcase.worldX;
		groupRef.current.position.z = suitcase.worldZ;
		groupRef.current.position.y = 0.18 + Math.sin(state.clock.elapsedTime * 1.8 + phaseSeed * 0.7) * 0.01;
	});

	if (!visible) {
		return null;
	}

	return (
		<group ref={groupRef} position={[suitcase.worldX, 0.18, suitcase.worldZ]} rotation={[Math.PI / 2, 0, 0]}>
			<OutlinedMesh
				castShadow
				receiveShadow
				outlined={outlined}
				geometryNode={<boxGeometry args={[0.75, 0.5, 0.15]} />}
				materialNode={<meshToonMaterial color="#a9b5c2" emissive="#4a5562" emissiveIntensity={0.18} />}
			/>
			<OutlinedMesh
				position={[0, 0.24, 0]}
				castShadow
				receiveShadow
				outlined={outlined}
				geometryNode={<torusGeometry args={[0.12, 0.02, 10, 18]} />}
				materialNode={<meshToonMaterial color="#c3ccd6" />}
			/>
		</group>
	);
}

export function SuitcaseLayer({
	fogByCell,
	revealAll,
	areaInfo,
	currentArea,
	audioEnabled = true,
	outlinesEnabled = true,
}: {
	fogByCell: Map<string, FogState>;
	revealAll: boolean;
	areaInfo: { labelByCell: Map<string, string> };
	currentArea: string;
	audioEnabled?: boolean;
	outlinesEnabled?: boolean;
}) {
	useSuitcaseAudio(audioEnabled);
	const suitcaseState = useRoomState((state) => state.suitcases);
	const suitcases = useMemo(() => schemaMapValues<SuitcaseState>(suitcaseState), [suitcaseState]);

	return (
		<group>
			{suitcases.map((suitcase) => {
				if (suitcase.state === "used" || suitcase.state === "contained" || suitcase.state === "carried") {
					return null;
				}
				const visible = revealAll || fogAtPosition(fogByCell, suitcase.worldX, suitcase.worldZ) !== "hidden";
				const cellKey = `${Math.round(suitcase.worldX / CELL_SIZE)},${Math.round(suitcase.worldZ / CELL_SIZE)}`;
				const outlined = outlinesEnabled && !revealAll && areaInfo.labelByCell.get(cellKey) === currentArea;
				const renderKey = suitcase.suitcaseId || suitcase.id || "suitcase-fallback";
				return <GroundSuitcase key={renderKey} suitcase={suitcase} visible={visible} outlined={outlined} />;
			})}
		</group>
	);
}



