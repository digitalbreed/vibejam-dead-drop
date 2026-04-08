import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
	CELL_SIZE,
	generateFileCabinetPlacements,
	generateMapLayout,
	type DoorState,
	type KeycardState,
	type SuitcaseState,
	type TrapState,
	type VaultState,
} from "@vibejam/shared";
import { Color, MeshToonMaterial } from "three";
import { useRoom, useRoomState } from "../../colyseus/roomContext";
import { schemaMapValues } from "../../colyseus/schemaMap";
import type { FogState } from "../GameScene";
import { OutlinedMesh } from "../toonOutline/OutlinedMesh";

function fogAtPosition(fogByCell: Map<string, FogState>, x: number, z: number): FogState {
	return fogByCell.get(`${Math.round(x / CELL_SIZE)},${Math.round(z / CELL_SIZE)}`) ?? "hidden";
}

function TrapCharge({
	position,
	rotationY,
	showTripwire = false,
	tripwireFacing = "x",
	tripwireHeight = 0,
	tripwireLength = CELL_SIZE * 0.95,
	outlined,
}: {
	position: [number, number, number];
	rotationY: number;
	showTripwire?: boolean;
	tripwireFacing?: "x" | "z";
	tripwireHeight?: number;
	tripwireLength?: number;
	outlined: boolean;
}) {
	const timerMaterialRef = useRef<MeshToonMaterial>(null);

	useFrame((state) => {
		const mat = timerMaterialRef.current;
		if (!mat) {
			return;
		}
		const pulse = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 10);
		mat.emissiveIntensity = 0.4 + pulse * 2;
	});

	return (
		<group position={position} rotation={[0, rotationY, 0]}>
			{[-0.12, 0, 0.12].map((xOffset) => (
				<OutlinedMesh
					key={`tnt-${xOffset}`}
					position={[xOffset, 0, 0]}
					outlined={outlined}
					castShadow
					receiveShadow
					geometryNode={<boxGeometry args={[0.11, 0.34, 0.11]} />}
					materialNode={<meshToonMaterial color="#b1261f" emissive="#4d0d0a" emissiveIntensity={0.35} />}
				/>
			))}
			<OutlinedMesh
				position={[0, 0.27, 0]}
				outlined={outlined}
				castShadow
				receiveShadow
				geometryNode={<boxGeometry args={[0.2, 0.08, 0.16]} />}
				materialNode={<meshToonMaterial color="#2b3138" />}
			/>
			<mesh position={[0, 0.32, 0]}>
				<sphereGeometry args={[0.035, 16, 16]} />
				<meshToonMaterial ref={timerMaterialRef} color={new Color("#ffd08a")} emissive="#ff4824" emissiveIntensity={2} />
			</mesh>
			{showTripwire ? (
				<mesh position={[0, tripwireHeight, 0]} rotation={[Math.PI / 2, 0, tripwireFacing === "x" ? 0 : Math.PI / 2]}>
					<cylinderGeometry args={[0.012, 0.012, tripwireLength, 10]} />
					<meshToonMaterial color="#ff2d2d" emissive="#ff5c5c" emissiveIntensity={1.8} />
				</mesh>
			) : null}
		</group>
	);
}

function DoorTrap({
	door,
	side,
	outlined,
}: {
	door: DoorState;
	side: number;
	outlined: boolean;
}) {
	const halfOpening = door.variant === "double" ? 1.1 : 0.56;
	const laserLength = halfOpening * 2;
	const sideOffset = 0.24;
	const laserY = 0.52;
	const tntY = laserY;
	const laserThickness = 0.02;
	// Place TNT opposite the hinge so the opened leaf is less likely to occlude it.
	const oppositeHingeSide = door.hingeSide === "left" ? 1 : -1;
	if (door.facing === "z") {
		return (
			<group position={[door.x, 0, door.z]}>
				<TrapCharge
					position={[oppositeHingeSide * halfOpening, tntY, side * sideOffset]}
					rotationY={oppositeHingeSide > 0 ? 0 : Math.PI}
					outlined={outlined}
				/>
				<mesh position={[0, laserY, side * sideOffset]}>
					<boxGeometry args={[laserLength, laserThickness, laserThickness]} />
					<meshToonMaterial color="#ff2d2d" emissive="#ff5c5c" emissiveIntensity={1.8} />
				</mesh>
			</group>
		);
	}
	return (
		<group position={[door.x, 0, door.z]}>
			<TrapCharge
				position={[side * sideOffset, tntY, oppositeHingeSide * halfOpening]}
				rotationY={oppositeHingeSide > 0 ? Math.PI / 2 : -Math.PI / 2}
				outlined={outlined}
			/>
			<mesh position={[side * sideOffset, laserY, 0]}>
				<boxGeometry args={[laserThickness, laserThickness, laserLength]} />
				<meshToonMaterial color="#ff2d2d" emissive="#ff5c5c" emissiveIntensity={1.8} />
			</mesh>
		</group>
	);
}

export function TrapLayer({
	trapsState,
	fogByCell,
	revealAll,
	forceAllOutlined = false,
	mapSeed,
	mapMaxDistance,
	areaInfo,
	currentArea,
	outlinesEnabled = true,
}: {
	trapsState: any;
	fogByCell: Map<string, FogState>;
	revealAll: boolean;
	forceAllOutlined?: boolean;
	mapSeed: number;
	mapMaxDistance: number;
	areaInfo: { labelByCell: Map<string, string> };
	currentArea: string;
	outlinesEnabled?: boolean;
}) {
	const { room } = useRoom();
	const interactables = useRoomState((state) => state.interactables);
	const vaults = useRoomState((state) => state.vaults);
	const keycards = useRoomState((state) => state.keycards);
	const suitcases = useRoomState((state) => state.suitcases);
	const localSessionId = room?.sessionId ?? "";
	const traps = useMemo(() => schemaMapValues<TrapState>(trapsState), [trapsState]);
	const doorsById = useMemo(
		() => new Map(schemaMapValues<DoorState>(interactables).map((door) => [door.id, door])),
		[interactables],
	);
	const vaultById = useMemo(
		() => new Map(schemaMapValues<VaultState>(vaults).map((vault) => [vault.id, vault])),
		[vaults],
	);
	const keycardById = useMemo(
		() => new Map(schemaMapValues<KeycardState>(keycards).map((keycard) => [keycard.id, keycard])),
		[keycards],
	);
	const suitcaseById = useMemo(
		() => new Map(schemaMapValues<SuitcaseState>(suitcases).map((suitcase) => [suitcase.id, suitcase])),
		[suitcases],
	);
	const cabinetById = useMemo(() => {
		const layout = generateMapLayout(mapSeed, mapMaxDistance);
		return new Map(generateFileCabinetPlacements(layout).map((placement) => [placement.id, placement]));
	}, [mapMaxDistance, mapSeed]);

	return (
		<group>
			{traps.map((trap) => {
				if (trap.status !== "active") {
					return null;
				}
				if (trap.ownerSessionId !== localSessionId) {
					return null;
				}

				let x = 0;
				let y = 0.42;
				let z = 0;
				let rotationY = Math.atan2(trap.outwardX, trap.outwardZ);

				if (trap.targetKind === "door") {
					const door = doorsById.get(trap.targetId);
					if (!door) {
						return null;
					}
					x = door.x;
					z = door.z;
					y = 0;
				} else if (trap.targetKind === "vault") {
					const vault = vaultById.get(trap.targetId);
					if (!vault || vault.isDoorOpen) {
						return null;
					}
					x = vault.x + 0.96;
					y = 2.76;
					z = vault.z + CELL_SIZE / 2 + 0.2;
					rotationY = 0;
				} else if (trap.targetKind === "file_cabinet") {
					const cabinet = cabinetById.get(trap.targetId);
					if (!cabinet) {
						return null;
					}
					x = cabinet.x + trap.outwardX * 0.42;
					y = Math.max(0.62, cabinet.height * 0.5 + 0.08);
					z = cabinet.z + trap.outwardZ * 0.42;
				} else if (trap.targetKind === "suitcase") {
					const suitcase = suitcaseById.get(trap.targetId);
					if (!suitcase || suitcase.state !== "ground") {
						return null;
					}
					x = suitcase.worldX + trap.outwardX * 0.36;
					y = 0.46;
					z = suitcase.worldZ + trap.outwardZ * 0.36;
				} else if (trap.targetKind === "keycard") {
					const keycard = keycardById.get(trap.targetId);
					if (!keycard || keycard.state !== "ground") {
						return null;
					}
					x = keycard.worldX + trap.outwardX * 0.32;
					y = 0.34;
					z = keycard.worldZ + trap.outwardZ * 0.32;
				}

				const visible = revealAll || fogAtPosition(fogByCell, x, z) !== "hidden";
				if (!visible) {
					return null;
				}
				const cellKey = `${Math.round(x / CELL_SIZE)},${Math.round(z / CELL_SIZE)}`;
				const outlined =
					outlinesEnabled &&
					(forceAllOutlined || (!revealAll && areaInfo.labelByCell.get(cellKey) === currentArea));
				if (trap.targetKind === "door") {
					const door = doorsById.get(trap.targetId);
					if (!door) {
						return null;
					}
					return (
						<DoorTrap
							key={trap.id}
							door={door}
							side={trap.doorSide >= 0 ? 1 : -1}
							outlined={outlined}
						/>
					);
				}
				return (
					<TrapCharge
						key={trap.id}
						position={[x, y, z]}
						rotationY={rotationY}
						outlined={outlined}
					/>
				);
			})}
		</group>
	);
}
