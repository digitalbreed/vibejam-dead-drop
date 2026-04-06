import { useMemo, useRef, useEffect, useLayoutEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Color, Group, Vector2, Vector3 } from "three";
import {
	buildClosedDoorWalls,
	buildCollisionWalls,
	CELL_SIZE,
	generateMapLayout,
	layoutRoomMap,
	moveWithCollision,
	type DoorState,
	type GameClientMessages,
} from "@vibejam/shared";
import { useRoom, useRoomState } from "../colyseus/roomContext";
import { schemaMapValues } from "../colyseus/schemaMap";
import { DoorLayer } from "./doors/DoorLayer";
import { LightingLayer } from "./LightingLayer";
import { MapLevel } from "./MapLevel";

const MOVE_SPEED = 12;
const CAMERA_OFFSET = { x: 0, y: 8.5, z: 14 };
const COMPASS_LABELS = ["East", "Northeast", "North", "Northwest", "West", "Southwest", "South", "Southeast"] as const;

type AreaInfo = {
	labelByCell: Map<string, string>;
};
export type FogState = "hidden" | "explored" | "visible";
export type PassthroughKind = "none" | "frontWall";

function buildFogByCell(areaInfo: AreaInfo, currentArea: string, visitedAreas: ReadonlySet<string>, revealAll: boolean): Map<string, FogState> {
	const result = new Map<string, FogState>();
	for (const [cellKey, area] of areaInfo.labelByCell) {
		if (revealAll) {
			result.set(cellKey, "visible");
			continue;
		}
		if (area === currentArea) {
			result.set(cellKey, "visible");
			continue;
		}
		if (visitedAreas.has(area)) {
			result.set(cellKey, "explored");
			continue;
		}
		result.set(cellKey, "hidden");
	}
	return result;
}

function directionLabel(ix: number, iz: number): string {
	if (ix === 0 && iz === 0) {
		return "Center";
	}
	const angle = Math.atan2(-iz, ix);
	const octant = Math.round(angle / (Math.PI / 4));
	const normalized = ((octant % 8) + 8) % 8;
	return COMPASS_LABELS[normalized]!;
}

function buildAreaInfo(layout: ReturnType<typeof generateMapLayout>): AreaInfo {
	const roomMap = layoutRoomMap(layout);
	const cells = new Map(layout.cells.map((cell) => [`${cell.ix},${cell.iz}`, cell]));
	const dirs: [number, number][] = [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	];

	const corridorComponentByCell = new Map<string, number>();
	const corridorCellsByComponent = new Map<number, string[]>();
	let nextCorridorId = 1;

	for (const cell of layout.cells) {
		if (cell.kind !== "hall") {
			continue;
		}
		const startKey = `${cell.ix},${cell.iz}`;
		if (corridorComponentByCell.has(startKey)) {
			continue;
		}
		const queue = [startKey];
		const componentCells: string[] = [];
		corridorComponentByCell.set(startKey, nextCorridorId);
		for (let index = 0; index < queue.length; index++) {
			const current = queue[index]!;
			componentCells.push(current);
			const [ix, iz] = current.split(",").map(Number);
			for (const [dx, dz] of dirs) {
				const neighborKey = `${ix + dx},${iz + dz}`;
				if (corridorComponentByCell.has(neighborKey)) {
					continue;
				}
				if (cells.get(neighborKey)?.kind !== "hall") {
					continue;
				}
				corridorComponentByCell.set(neighborKey, nextCorridorId);
				queue.push(neighborKey);
			}
		}
		corridorCellsByComponent.set(nextCorridorId, componentCells);
		nextCorridorId++;
	}

	const features: { kind: "Room" | "Corridor"; id: number; direction: string; distance: number; cells: string[] }[] = [];
	const roomCellsById = new Map<number, string[]>();
	for (const cell of layout.cells) {
		if (cell.roomId <= 0) {
			continue;
		}
		const bucket = roomCellsById.get(cell.roomId) ?? [];
		bucket.push(`${cell.ix},${cell.iz}`);
		roomCellsById.set(cell.roomId, bucket);
	}

	for (const [roomId, featureCells] of roomCellsById) {
		let sumX = 0;
		let sumZ = 0;
		for (const key of featureCells) {
			const [ix, iz] = key.split(",").map(Number);
			sumX += ix;
			sumZ += iz;
		}
		const cx = sumX / featureCells.length;
		const cz = sumZ / featureCells.length;
		features.push({
			kind: "Room",
			id: roomId,
			direction: directionLabel(cx, cz),
			distance: Math.hypot(cx, cz),
			cells: featureCells,
		});
	}

	for (const [corridorId, featureCells] of corridorCellsByComponent) {
		let sumX = 0;
		let sumZ = 0;
		for (const key of featureCells) {
			const [ix, iz] = key.split(",").map(Number);
			sumX += ix;
			sumZ += iz;
		}
		const cx = sumX / featureCells.length;
		const cz = sumZ / featureCells.length;
		features.push({
			kind: "Corridor",
			id: corridorId,
			direction: directionLabel(cx, cz),
			distance: Math.hypot(cx, cz),
			cells: featureCells,
		});
	}

	const counts = new Map<string, number>();
	const labelByCell = new Map<string, string>();
	const sorted = features.sort((a, b) => {
		if (a.kind !== b.kind) {
			return a.kind.localeCompare(b.kind);
		}
		if (a.direction !== b.direction) {
			return a.direction.localeCompare(b.direction);
		}
		if (a.distance !== b.distance) {
			return a.distance - b.distance;
		}
		return a.id - b.id;
	});

	for (const feature of sorted) {
		const counterKey = `${feature.kind}:${feature.direction}`;
		const next = (counts.get(counterKey) ?? 0) + 1;
		counts.set(counterKey, next);
		const label = `${feature.kind} ${feature.direction} ${next}`;
		for (const cellKey of feature.cells) {
			labelByCell.set(cellKey, label);
		}
	}

	for (const [cellKey, roomId] of roomMap) {
		if (roomId === 0) {
			labelByCell.set(cellKey, "Start Room");
		}
	}

	return { labelByCell };
}

function PlayerVisual({
	color,
	isLocal,
	positionRef,
	target,
	smoothing,
}: {
	color: number;
	isLocal: boolean;
	positionRef?: React.MutableRefObject<Vector3>;
	target?: { x: number; z: number };
	smoothing: number;
}) {
	const groupRef = useRef<Group>(null);
	const visualRef = useRef<Group>(null);
	const leftEyeRef = useRef<Group>(null);
	const rightEyeRef = useRef<Group>(null);
	const colorObj = useMemo(() => new Color(color), [color]);
	const targetRef = useRef(new Vector3(target?.x ?? 0, 0, target?.z ?? 0));
	const lastPositionRef = useRef(new Vector3(target?.x ?? 0, 0, target?.z ?? 0));
	const facingAngleRef = useRef(0);
	const blinkTimerRef = useRef(Math.random() * 2.5 + 0.5);
	const blinkDurationRef = useRef(0);
	const wobblePhaseRef = useRef(Math.random() * Math.PI * 2);

	useLayoutEffect(() => {
		const group = groupRef.current;
		if (!group) {
			return;
		}
		if (positionRef) {
			group.position.copy(positionRef.current);
			targetRef.current.copy(positionRef.current);
			lastPositionRef.current.copy(positionRef.current);
			return;
		}
		group.position.set(target?.x ?? 0, 0, target?.z ?? 0);
		targetRef.current.set(target?.x ?? 0, 0, target?.z ?? 0);
		lastPositionRef.current.set(target?.x ?? 0, 0, target?.z ?? 0);
	}, []);

	useEffect(() => {
		if (!positionRef && target) {
			targetRef.current.set(target.x, 0, target.z);
		}
	}, [positionRef, target?.x, target?.z]);

	useFrame((_, dt) => {
		const group = groupRef.current;
		const visual = visualRef.current;
		if (!group) {
			return;
		}
		if (positionRef) {
			group.position.copy(positionRef.current);
		} else {
			const alpha = 1 - Math.exp(-dt * smoothing);
			group.position.lerp(targetRef.current, alpha);
		}

		const dx = group.position.x - lastPositionRef.current.x;
		const dz = group.position.z - lastPositionRef.current.z;
		const movementSq = dx * dx + dz * dz;
		const movementAmount = Math.sqrt(movementSq);
		if (movementSq > 0.00001) {
			facingAngleRef.current = Math.atan2(dx, dz);
		}
		lastPositionRef.current.copy(group.position);

		if (visual) {
			const turnAlpha = 1 - Math.exp(-dt * 12);
			visual.rotation.y += (facingAngleRef.current - visual.rotation.y) * turnAlpha;
			const speed = movementAmount / Math.max(dt, 0.0001);
			if (speed > 0.05) {
				wobblePhaseRef.current += dt * Math.min(18, 4 + speed * 0.9);
			}
			const wobbleStrength = Math.min(1, speed / MOVE_SPEED);
			const wobbleRoll = Math.sin(wobblePhaseRef.current) * 0.22 * wobbleStrength;
			visual.rotation.x = 0;
			visual.rotation.z += (wobbleRoll - visual.rotation.z) * (1 - Math.exp(-dt * 14));
		}

		if (blinkDurationRef.current > 0) {
			blinkDurationRef.current = Math.max(0, blinkDurationRef.current - dt);
		} else {
			blinkTimerRef.current -= dt;
			if (blinkTimerRef.current <= 0) {
				blinkDurationRef.current = 0.12;
				blinkTimerRef.current = Math.random() * 2.8 + 1.4;
			}
		}

		const blinkPhase = blinkDurationRef.current > 0 ? 1 - Math.abs(blinkDurationRef.current - 0.06) / 0.06 : 0;
		const eyelidScale = 1 - blinkPhase * 0.92;
		if (leftEyeRef.current) {
			leftEyeRef.current.scale.y = eyelidScale;
		}
		if (rightEyeRef.current) {
			rightEyeRef.current.scale.y = eyelidScale;
		}
	});

	return (
		<group ref={groupRef}>
			<group ref={visualRef}>
				<mesh castShadow={isLocal} receiveShadow position={[0, 0.8, 0]}>
					<coneGeometry args={[0.45, 1.6, 10]} />
					<meshStandardMaterial color={colorObj} roughness={0.45} metalness={0.1} />
				</mesh>
				<group position={[0, 1.02, 0.3]}>
					<group ref={leftEyeRef} position={[-0.13, 0, -0.05]}>
						<mesh castShadow={isLocal}>
							<sphereGeometry args={[0.12, 18, 18]} />
							<meshStandardMaterial color="#fffaf0" roughness={0.55} metalness={0} />
						</mesh>
						<mesh position={[0.01, -0.01, 0.075]}>
							<sphereGeometry args={[0.048, 14, 14]} />
							<meshStandardMaterial color="#111111" roughness={0.35} metalness={0.05} />
						</mesh>
					</group>
					<group ref={rightEyeRef} position={[0.13, 0, -0.05]}>
						<mesh castShadow={isLocal}>
							<sphereGeometry args={[0.12, 18, 18]} />
							<meshStandardMaterial color="#fffaf0" roughness={0.55} metalness={0} />
						</mesh>
						<mesh position={[-0.01, -0.01, 0.075]}>
							<sphereGeometry args={[0.048, 14, 14]} />
							<meshStandardMaterial color="#111111" roughness={0.35} metalness={0.05} />
						</mesh>
					</group>
				</group>
			</group>
		</group>
	);
}

function ThirdPersonCamera({ targetRef }: { targetRef: React.MutableRefObject<Vector3> }) {
	const { camera } = useThree();
	useFrame(() => {
		const target = targetRef.current;
		camera.position.set(target.x + CAMERA_OFFSET.x, target.y + CAMERA_OFFSET.y, target.z + CAMERA_OFFSET.z);
		camera.lookAt(target);
	});
	return null;
}

function MovementInput({ inputRef }: { inputRef: React.MutableRefObject<Vector2> }) {
	const { room } = useRoom();
	const keys = useRef({ KeyW: false, KeyA: false, KeyS: false, KeyD: false });

	useEffect(() => {
		const onDown = (e: KeyboardEvent) => {
			if (e.code in keys.current) {
				keys.current[e.code as keyof typeof keys.current] = true;
			}
		};
		const onUp = (e: KeyboardEvent) => {
			if (e.code in keys.current) {
				keys.current[e.code as keyof typeof keys.current] = false;
			}
		};
		window.addEventListener("keydown", onDown);
		window.addEventListener("keyup", onUp);
		return () => {
			window.removeEventListener("keydown", onDown);
			window.removeEventListener("keyup", onUp);
		};
	}, []);

	useFrame(() => {
		if (!room) {
			return;
		}
		const k = keys.current;
		let x = 0;
		let z = 0;
		if (k.KeyW) {
			z -= 1;
		}
		if (k.KeyS) {
			z += 1;
		}
		if (k.KeyA) {
			x -= 1;
		}
		if (k.KeyD) {
			x += 1;
		}
		const len = Math.hypot(x, z);
		const nx = len > 1 ? x / len : x;
		const nz = len > 1 ? z / len : z;
		inputRef.current.set(nx, nz);
		const payload: GameClientMessages["input"] = { x: nx, z: nz };
		room.send("input", payload);
	});

	return null;
}

function SceneContent({ onAreaChange, revealAll }: { onAreaChange?: (label: string) => void; revealAll: boolean }) {
	const { room } = useRoom();
	const players = useRoomState((s) => s.players);
	const interactables = useRoomState((s) => s.interactables);
	const mapSeed = useRoomState((s) => s.mapSeed);
	const mapMaxDistance = useRoomState((s) => s.mapMaxDistance);
	const inputRef = useRef(new Vector2(0, 0));
	const localVisualRef = useRef(new Vector3(0, 0.5, 0));
	const lastAreaRef = useRef<string>("");
	const [currentArea, setCurrentArea] = useState("Start Room");
	const [visitedAreas, setVisitedAreas] = useState<Set<string>>(() => new Set(["Start Room"]));

	const layout = useMemo(() => {
		return generateMapLayout(mapSeed ?? 0, mapMaxDistance ?? 12);
	}, [mapSeed, mapMaxDistance]);
	const staticWalls = useMemo(() => buildCollisionWalls(layout), [layout]);
	const dynamicWalls = useMemo(() => {
		const doors = schemaMapValues<DoorState>(interactables);
		return buildClosedDoorWalls(
			doors.map((door) => ({
				x: door.x,
				z: door.z,
				facing: door.facing === "z" ? "z" : "x",
				isOpen: door.isOpen,
			})),
		);
	}, [interactables]);
	const walls = useMemo(() => [...staticWalls, ...dynamicWalls], [dynamicWalls, staticWalls]);
	const areaInfo = useMemo(() => buildAreaInfo(layout), [layout]);
	const fogByCell = useMemo(() => buildFogByCell(areaInfo, currentArea, visitedAreas, revealAll), [areaInfo, currentArea, revealAll, visitedAreas]);

	useEffect(() => {
		if (!room?.sessionId || !players?.[room.sessionId]) {
			localVisualRef.current.set(0, 0.5, 0);
			return;
		}
		const local = players[room.sessionId];
		if (localVisualRef.current.lengthSq() === 0) {
			localVisualRef.current.set(local.x, 0.5, local.z);
		}
	}, [players, room]);

	useFrame((_, dt) => {
		const sessionId = room?.sessionId;
		if (!sessionId || !players?.[sessionId]) {
			return;
		}

		const local = players[sessionId];
		const authoritative = new Vector3(local.x, 0.5, local.z);
		const predictedStepX = inputRef.current.x * MOVE_SPEED * dt;
		const predictedStepZ = inputRef.current.y * MOVE_SPEED * dt;
		const predicted = moveWithCollision(
			localVisualRef.current.x,
			localVisualRef.current.z,
			predictedStepX,
			predictedStepZ,
			walls,
		);
		localVisualRef.current.x = predicted.x;
		localVisualRef.current.z = predicted.z;

		const dx = authoritative.x - localVisualRef.current.x;
		const dz = authoritative.z - localVisualRef.current.z;
		const errorSq = dx * dx + dz * dz;

		if (errorSq > 2.25) {
			localVisualRef.current.copy(authoritative);
		} else {
			localVisualRef.current.x += dx * Math.min(1, dt * 10);
			localVisualRef.current.z += dz * Math.min(1, dt * 10);
		}
		if (onAreaChange) {
			const ix = Math.round(localVisualRef.current.x / CELL_SIZE);
			const iz = Math.round(localVisualRef.current.z / CELL_SIZE);
			const label = areaInfo.labelByCell.get(`${ix},${iz}`) ?? "Out of Bounds";
			if (label !== lastAreaRef.current) {
				lastAreaRef.current = label;
				setCurrentArea(label);
				setVisitedAreas((current) => {
					if (current.has(label)) {
						return current;
					}
					const next = new Set(current);
					next.add(label);
					return next;
				});
				onAreaChange(label);
			}
		}
	});

	const list = useMemo(() => {
		if (!players) {
			return [];
		}
		return Object.entries(players).map(([id, p]) => ({
			id,
			x: p.x,
			z: p.z,
			color: p.color,
			isLocal: id === room?.sessionId,
			area: areaInfo.labelByCell.get(`${Math.round(p.x / CELL_SIZE)},${Math.round(p.z / CELL_SIZE)}`) ?? "Out of Bounds",
		}));
	}, [areaInfo.labelByCell, players, room?.sessionId]);

	return (
		<>
			<ThirdPersonCamera targetRef={localVisualRef} />
			<MovementInput inputRef={inputRef} />
			<ambientLight intensity={0.42} />
			<LightingLayer layout={layout} areaInfo={areaInfo} currentArea={currentArea} fogByCell={fogByCell} />
			<MapLevel
				layout={layout}
				fogByCell={fogByCell}
				areaInfo={areaInfo}
				currentArea={currentArea}
				playerPositionRef={localVisualRef}
			/>
			<DoorLayer fogByCell={fogByCell} revealAll={revealAll} />
			{list.map((p) =>
				p.isLocal ? (
					<PlayerVisual
						key={p.id}
						color={p.color}
						isLocal
						positionRef={localVisualRef}
						smoothing={0}
					/>
				) : revealAll || p.area === currentArea ? (
					<PlayerVisual
						key={p.id}
						color={p.color}
						isLocal={false}
						target={{ x: p.x, z: p.z }}
						smoothing={18}
					/>
				) : null,
			)}
		</>
	);
}

export function GameScene({ onAreaChange, revealAll }: { onAreaChange?: (label: string) => void; revealAll: boolean }) {
	return (
		<Canvas shadows camera={{ fov: 50, near: 0.1, far: 500 }} style={{ width: "100%", height: "100%" }}>
			<color attach="background" args={["#0e141c"]} />
			<SceneContent onAreaChange={onAreaChange} revealAll={revealAll} />
		</Canvas>
	);
}
