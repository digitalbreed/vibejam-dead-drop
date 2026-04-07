import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { CELL_SIZE, type KeycardState } from "@vibejam/shared";
import { Color, type Group } from "three";
import { useRoomState } from "../../colyseus/roomContext";
import { schemaMapValues } from "../../colyseus/schemaMap";
import type { FogState } from "../GameScene";
import { useKeycardAudio } from "./useKeycardAudio";

type KeycardColor = "blue" | "red";

const COLOR_BY_KEYCARD: Record<KeycardColor, string> = {
	blue: "#1fb5ff",
	red: "#ff2c44",
};

function fogAtPosition(fogByCell: Map<string, FogState>, x: number, z: number): FogState {
	return fogByCell.get(`${Math.round(x / CELL_SIZE)},${Math.round(z / CELL_SIZE)}`) ?? "hidden";
}

function KeycardMesh({
	x,
	y,
	z,
	color,
	bobSeed,
	animated,
}: {
	x: number;
	y: number;
	z: number;
	color: string;
	bobSeed: number;
	animated: boolean;
}) {
	const groupRef = useRef<Group>(null);

	useFrame((state) => {
		if (!groupRef.current) {
			return;
		}
		groupRef.current.position.x = x;
		groupRef.current.position.z = z;
		groupRef.current.position.y = animated ? y + Math.sin(state.clock.elapsedTime * 2.2 + bobSeed) * 0.008 : y;
	});

	return (
		<group ref={groupRef} position={[x, y, z]}>
			<mesh castShadow receiveShadow>
				<boxGeometry args={[0.62, 0.06, 0.38]} />
				<meshToonMaterial color={new Color(color)} emissive={new Color(color)} emissiveIntensity={0.45} />
			</mesh>
			<mesh position={[0, 0.036, 0]} castShadow receiveShadow>
				<boxGeometry args={[0.22, 0.016, 0.26]} />
				<meshToonMaterial color="#f4f6fa" />
			</mesh>
		</group>
	);
}

function GroundKeycard({ card, visible }: { card: KeycardState; visible: boolean }) {
	if (!visible) {
		return null;
	}
	const color = card.color === "red" ? COLOR_BY_KEYCARD.red : COLOR_BY_KEYCARD.blue;
	const keyId = card.keyId || card.id || "keycard";
	const bobSeed = useMemo(() => (keyId.length % 7) * 0.6, [keyId]);
	return <KeycardMesh x={card.worldX} y={0.11} z={card.worldZ} color={color} bobSeed={bobSeed} animated />;
}

export function KeycardLayer({
	fogByCell,
	revealAll,
	audioEnabled = true,
}: {
	fogByCell: Map<string, FogState>;
	revealAll: boolean;
	audioEnabled?: boolean;
}) {
	useKeycardAudio(audioEnabled);
	const keycardsState = useRoomState((state) => state.keycards);

	const keycards = useMemo(
		() => schemaMapValues<KeycardState>(keycardsState),
		[keycardsState],
	);

	return (
		<group>
			{keycards.map((card, index) => {
				const renderKey = card.keyId && card.keyId.length > 0 ? card.keyId : card.id && card.id.length > 0 ? card.id : `keycard-${card.color}-${index}`;
				if (card.state === "used" || card.state === "contained" || card.state === "carried") {
					return null;
				}
				const visible = revealAll || fogAtPosition(fogByCell, card.worldX, card.worldZ) !== "hidden";
				return <GroundKeycard key={renderKey} card={card} visible={visible} />;
			})}
		</group>
	);
}



