import { useEffect, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { Base, Geometry, Subtraction } from "@react-three/csg";
import { CELL_SIZE, ROOM_HEIGHT, generateVaultPlacement, type GameServerMessages, type VaultState } from "@vibejam/shared";
import { Group, MathUtils, MeshToonMaterial, PointLight } from "three";
import { useRoom, useRoomState } from "../../colyseus/roomContext";
import { schemaMapValues } from "../../colyseus/schemaMap";
import { useVaultAudio } from "./useVaultAudio";

const FRONT_FACE_Z = CELL_SIZE / 2;
const PANEL_THICKNESS = 0.22;
const PANEL_SIZE = 2.46;
const VAULT_WALL_THICKNESS = 0.22;
const DOOR_RADIUS = 1.04;
const DOOR_THICKNESS = 0.28;
const DOOR_MID_RADIUS = DOOR_RADIUS * 0.78;
const DOOR_MID_THICKNESS = 0.16;
const DOOR_INNER_RADIUS = DOOR_RADIUS * 0.56;
const DOOR_INNER_THICKNESS = 0.12;
const DOOR_CENTER_Y = 1.84;
const DOOR_CENTER_Z = FRONT_FACE_Z - DOOR_THICKNESS / 2 + 0.085;
const PANEL_CENTER_Z = FRONT_FACE_Z - PANEL_THICKNESS / 2 - 0.035;
const SLOT_BODY_Y = 0.52;
const SLOT_X_OFFSET = 0.5;
const SLOT_Z = FRONT_FACE_Z + 0.02;
const SLOT_WIDTH = 0.44;
const SLOT_HEIGHT = 0.66;
const SLOT_DEPTH = 0.05;
const SLOT_ROTATION_Z = Math.PI / 2;
const SLOT_CORNER_INDICATOR_SIZE = 0.065;
const SLOT_CORNER_INDICATOR_Z = SLOT_DEPTH / 2 + 0.012;
const SLOT_INSERT_CARD_WIDTH = 0.34;
const SLOT_INSERT_CARD_HEIGHT = 0.58;
const SLOT_INSERT_CARD_DEPTH = 0.018;
const LAMP_Y = 3.18;
const LAMP_Z = FRONT_FACE_Z + 0.08;
const MAX_SWING_RADIANS = Math.PI * 0.62;
const DOOR_BASE_FRONT_Z = DOOR_THICKNESS / 2;
const DOOR_STAGE_OVERLAP = 0.01;
const DOOR_MID_CENTER_Z = DOOR_BASE_FRONT_Z + DOOR_MID_THICKNESS / 2 - DOOR_STAGE_OVERLAP;
const DOOR_INNER_CENTER_Z = DOOR_MID_CENTER_Z + DOOR_MID_THICKNESS / 2 + DOOR_INNER_THICKNESS / 2 - DOOR_STAGE_OVERLAP;
const LOCK_HUB_Z = DOOR_INNER_CENTER_Z + DOOR_INNER_THICKNESS / 2 + 0.07;
const DOOR_HINGE_BLOCK_HEIGHT = 0.54;
const DOOR_HINGE_BLOCK_WIDTH = 0.12;
const DOOR_HINGE_BLOCK_DEPTH = 0.18;
const DOOR_WALL_CUT_DEPTH = 0.68;
const DOOR_PANEL_CUT_DEPTH = PANEL_THICKNESS + 0.08;
const SLOT_PULSE_DURATION_SEC = 0.55;
const SLOT_SWALLOW_DURATION_SEC = 0.42;
const INDICATOR_FLASH_HZ = 0.55;

type VaultFxState = {
	bluePulseStartSec: number;
	redPulseStartSec: number;
	blueSwallowStartSec: number;
	redSwallowStartSec: number;
};

function VaultDoor({
	hingeSide,
	openT,
	insertedBlue,
	insertedRed,
	bluePulseStartSec,
	redPulseStartSec,
}: {
	hingeSide: "left" | "right";
	openT: number;
	insertedBlue: boolean;
	insertedRed: boolean;
	bluePulseStartSec: number;
	redPulseStartSec: number;
}) {
	const pivotRef = useRef<Group>(null);
	const hingeX = hingeSide === "left" ? -DOOR_RADIUS : DOOR_RADIUS;
	const doorOffsetX = hingeSide === "left" ? DOOR_RADIUS : -DOOR_RADIUS;
	const hingeEdgeX = hingeSide === "left" ? -DOOR_RADIUS : DOOR_RADIUS;

	useFrame((_, dt) => {
		if (!pivotRef.current) {
			return;
		}
		const sign = hingeSide === "left" ? -1 : 1;
		const target = sign * openT * MAX_SWING_RADIANS;
		pivotRef.current.rotation.y = MathUtils.lerp(pivotRef.current.rotation.y, target, 1 - Math.exp(-dt * 14));
	});

	return (
		<group ref={pivotRef} position={[hingeX, DOOR_CENTER_Y, DOOR_CENTER_Z]}>
			<group position={[doorOffsetX, 0, 0]}>
				<mesh castShadow receiveShadow rotation={[Math.PI / 2, 0, 0]}>
					<cylinderGeometry args={[DOOR_RADIUS, DOOR_RADIUS, DOOR_THICKNESS, 40]} />
					<meshToonMaterial color="#9099a3" />
				</mesh>
				<mesh position={[0, 0, DOOR_MID_CENTER_Z]} castShadow receiveShadow rotation={[Math.PI / 2, 0, 0]}>
					<cylinderGeometry args={[DOOR_MID_RADIUS, DOOR_MID_RADIUS, DOOR_MID_THICKNESS, 40]} />
					<meshToonMaterial color="#858e97" />
				</mesh>
				<mesh position={[0, 0, DOOR_INNER_CENTER_Z]} castShadow receiveShadow rotation={[Math.PI / 2, 0, 0]}>
					<cylinderGeometry args={[DOOR_INNER_RADIUS, DOOR_INNER_RADIUS, DOOR_INNER_THICKNESS, 36]} />
					<meshToonMaterial color="#7a838d" />
				</mesh>
				<mesh position={[0, 0, LOCK_HUB_Z]} castShadow receiveShadow rotation={[Math.PI / 2, 0, 0]}>
					<cylinderGeometry args={[0.08, 0.08, 0.15, 18]} />
					<meshToonMaterial color="#6f7780" />
				</mesh>
				<mesh position={[0, 0, LOCK_HUB_Z]} castShadow receiveShadow>
					<cylinderGeometry args={[0.018, 0.018, 0.46, 12]} />
					<meshToonMaterial color="#757f89" />
				</mesh>
				<mesh position={[0, 0, LOCK_HUB_Z]} castShadow receiveShadow rotation={[0, 0, Math.PI / 2]}>
					<cylinderGeometry args={[0.018, 0.018, 0.46, 12]} />
					<meshToonMaterial color="#757f89" />
				</mesh>
				<mesh position={[0, 0, LOCK_HUB_Z]} castShadow receiveShadow rotation={[0, 0, Math.PI / 4]}>
					<cylinderGeometry args={[0.018, 0.018, 0.46, 12]} />
					<meshToonMaterial color="#757f89" />
				</mesh>
				<mesh position={[hingeEdgeX, 0, DOOR_THICKNESS / 2 - 0.02]} castShadow receiveShadow>
					<boxGeometry args={[DOOR_HINGE_BLOCK_WIDTH, DOOR_HINGE_BLOCK_HEIGHT, DOOR_HINGE_BLOCK_DEPTH]} />
					<meshToonMaterial color="#6a737d" />
				</mesh>
				<DoorIndicatorLight
					x={-0.31}
					y={-0.31}
					z={LOCK_HUB_Z + 0.02}
					baseColor="#5ebfff"
					emissiveColor="#2ea3ff"
					isInserted={insertedBlue}
					pulseStartSec={bluePulseStartSec}
				/>
				<DoorIndicatorLight
					x={0.31}
					y={-0.31}
					z={LOCK_HUB_Z + 0.02}
					baseColor="#ff8896"
					emissiveColor="#ff4e63"
					isInserted={insertedRed}
					pulseStartSec={redPulseStartSec}
				/>
			</group>
		</group>
	);
}

function DoorIndicatorLight({
	x,
	y,
	z,
	baseColor,
	emissiveColor,
	isInserted,
	pulseStartSec,
}: {
	x: number;
	y: number;
	z: number;
	baseColor: string;
	emissiveColor: string;
	isInserted: boolean;
	pulseStartSec: number;
}) {
	const materialRef = useRef<MeshToonMaterial>(null);
	const lightRef = useRef<PointLight>(null);

	useFrame(() => {
		const material = materialRef.current;
		if (!material) {
			return;
		}
		const nowSec = performance.now() / 1000;
		const elapsed = nowSec - pulseStartSec;
		const pulse = elapsed >= 0 && elapsed <= SLOT_PULSE_DURATION_SEC ? 1 - elapsed / SLOT_PULSE_DURATION_SEC : 0;
		const flash = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(nowSec * Math.PI * 2 * INDICATOR_FLASH_HZ));
		const baseIntensity = isInserted ? 3.4 : flash * 0.9;
		material.emissiveIntensity = baseIntensity + pulse * 1.8;
		if (lightRef.current) {
			lightRef.current.intensity = (isInserted ? 1.9 : flash * 0.55) + pulse * 1.2;
		}
	});

	return (
		<group position={[x, y, z]}>
			<mesh castShadow receiveShadow>
				<cylinderGeometry args={[0.085, 0.085, 0.045, 18]} />
				<meshToonMaterial color="#232b33" />
			</mesh>
			<mesh position={[0, 0, 0.03]} castShadow receiveShadow>
				<sphereGeometry args={[0.052, 16, 16]} />
				<meshToonMaterial
					ref={materialRef}
					color={baseColor}
					emissive={emissiveColor}
					emissiveIntensity={isInserted ? 3.4 : 0.3}
				
				
				/>
			</mesh>
			<pointLight ref={lightRef} color={emissiveColor} intensity={isInserted ? 1.9 : 0.35} distance={2.4} decay={2} />
		</group>
	);
}

function SlotUnit({
	x,
	slotColor,
	slotEmissive,
	inserted,
	pulseStartSec,
	swallowStartSec,
}: {
	x: number;
	slotColor: string;
	slotEmissive: string;
	inserted: boolean;
	pulseStartSec: number;
	swallowStartSec: number;
}) {
	const bodyMaterialRef = useRef<MeshToonMaterial>(null);
	const cornerMaterialRef = useRef<MeshToonMaterial>(null);
	const swallowRef = useRef<Group>(null);

	useFrame(() => {
		const nowSec = performance.now() / 1000;
		const pulseElapsed = nowSec - pulseStartSec;
		const pulse = pulseElapsed >= 0 && pulseElapsed <= SLOT_PULSE_DURATION_SEC ? 1 - pulseElapsed / SLOT_PULSE_DURATION_SEC : 0;
		const baseIntensity = inserted ? 0.95 : 0.05;
		if (bodyMaterialRef.current) {
			bodyMaterialRef.current.emissiveIntensity = baseIntensity * 0.25 + pulse * 0.45;
		}
		if (cornerMaterialRef.current) {
			cornerMaterialRef.current.emissiveIntensity = baseIntensity + pulse * 1.6;
		}

		const swallowElapsed = nowSec - swallowStartSec;
		if (!swallowRef.current) {
			return;
		}
		if (swallowElapsed < 0 || swallowElapsed > SLOT_SWALLOW_DURATION_SEC) {
			swallowRef.current.visible = false;
			return;
		}
		const t = swallowElapsed / SLOT_SWALLOW_DURATION_SEC;
		swallowRef.current.visible = true;
		swallowRef.current.position.z = SLOT_INSERT_CARD_DEPTH + 0.05 - t * 0.16;
	});

	return (
		<group position={[x, SLOT_BODY_Y, SLOT_Z]} rotation={[0, 0, SLOT_ROTATION_Z]}>
			<mesh castShadow receiveShadow>
				<boxGeometry args={[SLOT_WIDTH, SLOT_HEIGHT, SLOT_DEPTH]} />
				<meshToonMaterial ref={bodyMaterialRef} color="#3a4651" emissive={slotEmissive} emissiveIntensity={inserted ? 0.24 : 0.01} />
			</mesh>
			<mesh
				position={[
					SLOT_WIDTH / 2 - SLOT_CORNER_INDICATOR_SIZE * 0.8,
					SLOT_HEIGHT / 2 - SLOT_CORNER_INDICATOR_SIZE * 0.8,
					SLOT_CORNER_INDICATOR_Z,
				]}
				castShadow
				receiveShadow
			>
				<boxGeometry args={[SLOT_CORNER_INDICATOR_SIZE, SLOT_CORNER_INDICATOR_SIZE, 0.016]} />
				<meshToonMaterial ref={cornerMaterialRef} color={slotColor} emissive={slotEmissive} emissiveIntensity={inserted ? 0.95 : 0.05} />
			</mesh>
			<group ref={swallowRef} position={[0, 0, SLOT_INSERT_CARD_DEPTH + 0.05]} visible={false}>
				<mesh castShadow receiveShadow>
					<boxGeometry args={[SLOT_INSERT_CARD_WIDTH, SLOT_INSERT_CARD_HEIGHT, SLOT_INSERT_CARD_DEPTH]} />
					<meshToonMaterial color={slotColor} emissive={slotEmissive} emissiveIntensity={0.7} />
				</mesh>
			</group>
		</group>
	);
}

function VaultItem({
	vault,
	fx,
	insertedBlue,
	insertedRed,
	openT,
}: {
	vault: VaultState;
	fx: VaultFxState;
	insertedBlue: boolean;
	insertedRed: boolean;
	openT: number;
}) {
	const hingeSide = vault.doorHingeSide === "right" ? "right" : "left";

	return (
		<group position={[vault.x, 0, vault.z]}>
			<mesh
				position={[-CELL_SIZE / 2 + VAULT_WALL_THICKNESS / 2, ROOM_HEIGHT / 2, 0]}
				castShadow
				receiveShadow
			>
				<boxGeometry args={[VAULT_WALL_THICKNESS, ROOM_HEIGHT, CELL_SIZE]} />
				<meshToonMaterial color="#7c8792" />
			</mesh>
			<mesh
				position={[CELL_SIZE / 2 - VAULT_WALL_THICKNESS / 2, ROOM_HEIGHT / 2, 0]}
				castShadow
				receiveShadow
			>
				<boxGeometry args={[VAULT_WALL_THICKNESS, ROOM_HEIGHT, CELL_SIZE]} />
				<meshToonMaterial color="#7c8792" />
			</mesh>
			<mesh
				position={[
					0,
					ROOM_HEIGHT / 2,
					-CELL_SIZE / 2 + VAULT_WALL_THICKNESS / 2,
				]}
				castShadow
				receiveShadow
			>
				<boxGeometry
					args={[CELL_SIZE - VAULT_WALL_THICKNESS * 2, ROOM_HEIGHT, VAULT_WALL_THICKNESS]}
				/>
				<meshToonMaterial color="#7c8792" />
			</mesh>
			<mesh
				position={[
					0,
					VAULT_WALL_THICKNESS / 2,
					-CELL_SIZE / 2 + (CELL_SIZE - VAULT_WALL_THICKNESS) / 2,
				]}
				castShadow
				receiveShadow
			>
				<boxGeometry
					args={[CELL_SIZE - VAULT_WALL_THICKNESS * 2, VAULT_WALL_THICKNESS, CELL_SIZE - VAULT_WALL_THICKNESS]}
				/>
				<meshToonMaterial color="#6f7983" />
			</mesh>
			<mesh
				position={[
					0,
					ROOM_HEIGHT - VAULT_WALL_THICKNESS / 2,
					-CELL_SIZE / 2 + (CELL_SIZE - VAULT_WALL_THICKNESS) / 2,
				]}
				castShadow
				receiveShadow
			>
				<boxGeometry
					args={[CELL_SIZE - VAULT_WALL_THICKNESS * 2, VAULT_WALL_THICKNESS, CELL_SIZE - VAULT_WALL_THICKNESS]}
				/>
				<meshToonMaterial color="#6f7983" />
			</mesh>
			<mesh
				position={[
					0,
					ROOM_HEIGHT / 2,
					CELL_SIZE / 2 - VAULT_WALL_THICKNESS / 2,
				]}
				castShadow
				receiveShadow
			>
				<Geometry computeVertexNormals>
					<Base>
						<boxGeometry
							args={[CELL_SIZE - VAULT_WALL_THICKNESS * 2, ROOM_HEIGHT, VAULT_WALL_THICKNESS]}
						/>
					</Base>
					<Subtraction
						position={[0, DOOR_CENTER_Y - ROOM_HEIGHT / 2, 0]}
						rotation={[Math.PI / 2, 0, 0]}
					>
						<cylinderGeometry args={[DOOR_RADIUS + 0.035, DOOR_RADIUS + 0.035, DOOR_WALL_CUT_DEPTH, 48]} />
					</Subtraction>
				</Geometry>
				<meshToonMaterial color="#7c8792" />
			</mesh>
			<mesh position={[0, DOOR_CENTER_Y, PANEL_CENTER_Z]} castShadow receiveShadow>
				<Geometry computeVertexNormals>
					<Base>
						<boxGeometry args={[PANEL_SIZE, PANEL_SIZE, PANEL_THICKNESS]} />
					</Base>
					<Subtraction rotation={[Math.PI / 2, 0, 0]}>
						<cylinderGeometry args={[DOOR_RADIUS + 0.02, DOOR_RADIUS + 0.02, DOOR_PANEL_CUT_DEPTH, 48]} />
					</Subtraction>
				</Geometry>
				<meshToonMaterial color="#5f6872" />
			</mesh>
			<mesh position={[0, DOOR_CENTER_Y, FRONT_FACE_Z + 0.008]} castShadow receiveShadow rotation={[Math.PI / 2, 0, 0]}>
				<ringGeometry args={[DOOR_RADIUS + 0.01, DOOR_RADIUS + 0.1, 44]} />
				<meshToonMaterial color="#4d5863" />
			</mesh>
			<SlotUnit
				x={-SLOT_X_OFFSET}
				slotColor="#5ebfff"
				slotEmissive="#39a7ff"
				inserted={insertedBlue}
				pulseStartSec={fx.bluePulseStartSec}
				swallowStartSec={fx.blueSwallowStartSec}
			/>
			<SlotUnit
				x={SLOT_X_OFFSET}
				slotColor="#ff8896"
				slotEmissive="#ff4e63"
				inserted={insertedRed}
				pulseStartSec={fx.redPulseStartSec}
				swallowStartSec={fx.redSwallowStartSec}
			/>
			<group position={[0, LAMP_Y, LAMP_Z]}>
				<mesh castShadow receiveShadow>
					<boxGeometry args={[0.46, 0.12, 0.12]} />
					<meshToonMaterial color="#3b444e" />
				</mesh>
				<mesh position={[0, -0.06, 0]}>
					<sphereGeometry args={[0.08, 16, 16]} />
					<meshToonMaterial color="#ffdca8" emissive="#ffc26a" emissiveIntensity={2.2} />
				</mesh>
				<pointLight color="#ffdca8" intensity={5} distance={6.5} decay={2} />
			</group>
			<VaultDoor
				hingeSide={hingeSide}
				openT={openT}
				insertedBlue={insertedBlue}
				insertedRed={insertedRed}
				bluePulseStartSec={fx.bluePulseStartSec}
				redPulseStartSec={fx.redPulseStartSec}
			/>
		</group>
	);
}

export function VaultLayer({
	fogByCell: _fogByCell,
	revealAll: _revealAll,
	audioEnabled = true,
}: {
	fogByCell: Map<string, "hidden" | "explored" | "visible">;
	revealAll: boolean;
	audioEnabled?: boolean;
}) {
	useVaultAudio(audioEnabled);
	const { room } = useRoom();
	const vaultState = useRoomState((state) => state.vaults);
	const [fx, setFx] = useState<VaultFxState>({
		bluePulseStartSec: -1000,
		redPulseStartSec: -1000,
		blueSwallowStartSec: -1000,
		redSwallowStartSec: -1000,
	});
	const [latchedInserted, setLatchedInserted] = useState<{ blue: boolean; red: boolean }>({
		blue: false,
		red: false,
	});
	const [latchedDoorOpen, setLatchedDoorOpen] = useState(false);
	const synced = schemaMapValues<VaultState>(vaultState);
	const syncedPrimary = synced.find((item) => typeof item?.x === "number" && typeof item?.z === "number");
	const fallbackPlacement = generateVaultPlacement();
	const vault = (syncedPrimary
		? {
				id: syncedPrimary.id && syncedPrimary.id.length > 0 ? syncedPrimary.id : fallbackPlacement.id,
				kind: "vault",
				range: syncedPrimary.range,
				x: fallbackPlacement.x,
				z: fallbackPlacement.z,
				insertedBlue: !!syncedPrimary.insertedBlue,
				insertedRed: !!syncedPrimary.insertedRed,
				isUnlocked: !!syncedPrimary.isUnlocked,
				isDoorOpen: !!syncedPrimary.isDoorOpen,
				doorHingeSide: syncedPrimary.doorHingeSide === "right" ? "right" : fallbackPlacement.doorHingeSide,
				doorOpenT: Number.isFinite(syncedPrimary.doorOpenT) ? syncedPrimary.doorOpenT : syncedPrimary.isDoorOpen ? 1 : 0,
			}
		: {
				id: fallbackPlacement.id,
				kind: "vault",
				range: fallbackPlacement.range,
				x: fallbackPlacement.x,
				z: fallbackPlacement.z,
				insertedBlue: false,
				insertedRed: false,
				isUnlocked: false,
				isDoorOpen: false,
				doorHingeSide: fallbackPlacement.doorHingeSide,
				doorOpenT: 0,
			}) as VaultState;
	const effectiveInsertedBlue = vault.insertedBlue || latchedInserted.blue;
	const effectiveInsertedRed = vault.insertedRed || latchedInserted.red;
	const effectiveOpenT = latchedDoorOpen ? 1 : vault.doorOpenT;

	useEffect(() => {
		if (!vaultState || schemaMapValues<VaultState>(vaultState).length > 0) {
			return;
		}
		console.warn("[vault] state.vaults is empty; rendering deterministic fallback vault.");
	}, [vaultState]);

	useEffect(() => {
		if (vault.isDoorOpen) {
			setLatchedDoorOpen(true);
			return;
		}
		if (!vault.isUnlocked && !vault.insertedBlue && !vault.insertedRed) {
			setLatchedDoorOpen(false);
		}
	}, [vault.id, vault.insertedBlue, vault.insertedRed, vault.isDoorOpen, vault.isUnlocked]);

	useEffect(() => {
		if (!room) {
			return;
		}
		return room.onMessage<GameServerMessages["interactable_event"]>("interactable_event", (message) => {
			if (message.kind !== "vault") {
				return;
			}
			if (message.action === "opened" || message.action === "completed") {
				setLatchedDoorOpen(true);
				return;
			}
			if (message.action !== "card_inserted") {
				return;
			}
			const nowSec = performance.now() / 1000;
			if (message.color === "blue") {
				setFx((current) => ({
					...current,
					bluePulseStartSec: nowSec,
					blueSwallowStartSec: nowSec,
				}));
				setLatchedInserted((current) => ({ ...current, blue: true }));
				return;
			}
			setFx((current) => ({
				...current,
				redPulseStartSec: nowSec,
				redSwallowStartSec: nowSec,
			}));
			setLatchedInserted((current) => ({ ...current, red: true }));
		});
	}, [room]);

	return (
		<group>
			<VaultItem
				key={vault.id}
				vault={vault}
				fx={fx}
				insertedBlue={effectiveInsertedBlue}
				insertedRed={effectiveInsertedRed}
				openT={effectiveOpenT}
			/>
		</group>
	);
}



