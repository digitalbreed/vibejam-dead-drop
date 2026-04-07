import { useMemo, useRef, useEffect, useLayoutEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Color, DoubleSide, Group, Vector2, Vector3 } from "three";
import {
	buildClosedDoorWalls,
	buildCollisionWalls,
	buildFileCabinetCollisionWalls,
	buildVaultCollisionWalls,
	CELL_SIZE,
	generateFileCabinetPlacements,
	generateVaultPlacement,
	generateMapLayout,
	layoutRoomMap,
	moveWithCollision,
	type DoorState,
	type GameClientMessages,
	type KeycardState,
	type SuitcaseState,
} from "@vibejam/shared";
import { useRoom, useRoomState } from "../colyseus/roomContext";
import { schemaMapValues } from "../colyseus/schemaMap";
import { DoorLayer } from "./doors/DoorLayer";
import {
	createWindowKeyboardInputSource,
	type KeyboardInputSource,
	type KeyboardLikeEvent,
} from "./input/keyboardInput";
import { KeycardLayer } from "./keycards/KeycardLayer";
import { LightingLayer } from "./LightingLayer";
import { MapLevel } from "./MapLevel";
import { SuitcaseLayer } from "./suitcases/SuitcaseLayer";
import { VaultLayer } from "./vaults/VaultLayer";
import { FileCabinetLayer } from "./fileCabinets/FileCabinetLayer";
import { CelRenderLayer } from "./celRender";
import { OutlinedMesh } from "./toonOutline/OutlinedMesh";

const MOVE_SPEED = 12;
const CAMERA_OFFSET = { x: 0, y: 8.5, z: 14 };
const COMPASS_LABELS = ["East", "Northeast", "North", "Northwest", "West", "Southwest", "South", "Southeast"] as const;
const ORBIT_MIN_RADIUS = 4;
const ORBIT_MAX_RADIUS = 60;
const ORBIT_MIN_POLAR = 0.2;
const ORBIT_MAX_POLAR = Math.PI - 0.2;

export type AreaInfo = {
	labelByCell: Map<string, string>;
};
export type FogState = "hidden" | "explored" | "visible";
export type PassthroughKind = "none" | "frontWall";
type KeycardColor = "blue" | "red";
const SHORT_PRESS_MAX_MS = 220;
const HOLD_START_DELAY_MS = 180;

const KEYCARD_COLOR_BY_KIND: Record<KeycardColor, string> = {
	blue: "#1fb5ff",
	red: "#ff2c44",
};

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

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
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
	carriedKeycardColor,
	carriedSuitcase,
	isInteracting,
	interactionProgress,
	outlined = true,
}: {
	color: number;
	isLocal: boolean;
	positionRef?: React.MutableRefObject<Vector3>;
	target?: { x: number; z: number };
	smoothing: number;
	carriedKeycardColor?: KeycardColor | null;
	carriedSuitcase?: boolean;
	isInteracting?: boolean;
	interactionProgress?: number;
	outlined?: boolean;
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
			if (isInteracting) {
				const t = performance.now() / 1000;
				const jiggleX = Math.sin(t * 21 + wobblePhaseRef.current * 0.7) * 0.045;
				const jiggleY = Math.cos(t * 17 + wobblePhaseRef.current * 0.5) * 0.05;
				const jiggleZ = Math.sin(t * 19 + wobblePhaseRef.current * 0.9) * 0.045;
				visual.position.set(jiggleX, jiggleY, jiggleZ);
				const squash = 1 + Math.sin(t * 12) * 0.12;
				visual.scale.set(1.05, 1 / squash, 1.05);
			} else {
				visual.position.set(0, 0, 0);
				visual.scale.set(1, 1, 1);
			}
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
				<OutlinedMesh
					castShadow={isLocal}
					receiveShadow
					position={[0, 0.8, 0]}
					outlined={outlined}
					geometryNode={<coneGeometry args={[0.45, 1.6, 10]} />}
					materialNode={<meshToonMaterial color={colorObj} />}
				/>
				<group position={[0, 1.02, 0.3]}>
					<group ref={leftEyeRef} position={[-0.13, 0, -0.05]}>
						<mesh castShadow={isLocal}>
							<sphereGeometry args={[0.12, 18, 18]} />
							<meshToonMaterial color="#fffaf0" />
						</mesh>
						<mesh position={[0.01, -0.01, 0.075]}>
							<sphereGeometry args={[0.048, 14, 14]} />
							<meshToonMaterial color="#111111" />
						</mesh>
					</group>
					<group ref={rightEyeRef} position={[0.13, 0, -0.05]}>
						<mesh castShadow={isLocal}>
							<sphereGeometry args={[0.12, 18, 18]} />
							<meshToonMaterial color="#fffaf0" />
						</mesh>
						<mesh position={[-0.01, -0.01, 0.075]}>
							<sphereGeometry args={[0.048, 14, 14]} />
							<meshToonMaterial color="#111111" />
						</mesh>
					</group>
				</group>
				{carriedKeycardColor ? (
					<group position={[0.52, 0.51, 0.08]} rotation={[0, Math.PI / 2, 0]}>
						<OutlinedMesh
							castShadow={isLocal}
							receiveShadow
							outlined={outlined}
							geometryNode={<boxGeometry args={[0.62, 0.06, 0.38]} />}
							materialNode={
								<meshToonMaterial
									color={new Color(KEYCARD_COLOR_BY_KIND[carriedKeycardColor])}
									emissive={new Color(KEYCARD_COLOR_BY_KIND[carriedKeycardColor])}
									emissiveIntensity={0.45}
								/>
							}
						/>
						<OutlinedMesh
							position={[0, 0.036, 0]}
							castShadow={isLocal}
							receiveShadow
							outlined={outlined}
							geometryNode={<boxGeometry args={[0.22, 0.016, 0.26]} />}
							materialNode={<meshToonMaterial color="#f4f6fa" />}
						/>
					</group>
				) : null}
				{carriedSuitcase ? (
					<group position={[-0.44, 0.44, -0.02]}>
						<group rotation={[0, Math.PI / 2 - 0.28, 0]}>
							<group rotation={[0, 0, -0.1]}>
								<OutlinedMesh
									castShadow={isLocal}
									receiveShadow
									outlined={outlined}
									geometryNode={<boxGeometry args={[0.75, 0.5, 0.15]} />}
									materialNode={<meshToonMaterial color="#a9b5c2" emissive="#4a5562" emissiveIntensity={0.18} />}
								/>
								<OutlinedMesh
									position={[0, 0.24, 0]}
									castShadow={isLocal}
									receiveShadow
									outlined={outlined}
									geometryNode={<torusGeometry args={[0.12, 0.02, 10, 18]} />}
									materialNode={<meshToonMaterial color="#c3ccd6" />}
								/>
							</group>
						</group>
					</group>
				) : null}
			</group>
			{isInteracting ? (
				<group position={[0, 2.45, 0]}>
					<mesh position={[0, 0, 0]} renderOrder={1}>
						<circleGeometry args={[0.38, 40]} />
						<meshToonMaterial color="#1f2832" side={DoubleSide} depthWrite={false} />
					</mesh>
					<mesh position={[0, 0.035, 0]} rotation={[0, 0, 0]} renderOrder={2}>
						<circleGeometry
							args={[
								0.32,
								40,
								Math.PI / 2,
								-Math.PI * 2 * Math.max(0, Math.min(1, interactionProgress ?? 0)),
							]}
						/>
						<meshToonMaterial
							color="#7cd6ff"
							emissive="#2db9ff"
							emissiveIntensity={0.9}


							side={DoubleSide}
							depthWrite={false}
							polygonOffset
							polygonOffsetFactor={-1}
						/>
					</mesh>
				</group>
			) : null}
		</group>
	);
}

function ThirdPersonCamera({ targetRef, enabled }: { targetRef: React.MutableRefObject<Vector3>; enabled: boolean }) {
	const { camera } = useThree();
	useFrame(() => {
		if (!enabled) {
			return;
		}
		const target = targetRef.current;
		camera.position.set(target.x + CAMERA_OFFSET.x, target.y + CAMERA_OFFSET.y, target.z + CAMERA_OFFSET.z);
		camera.lookAt(target);
	});
	return null;
}

function DebugOrbitCamera({ targetRef, enabled }: { targetRef: React.MutableRefObject<Vector3>; enabled: boolean }) {
	const { camera, gl } = useThree();
	const orbitRef = useRef({
		radius: 16,
		theta: 0,
		phi: 1.1,
		dragging: false,
		lastX: 0,
		lastY: 0,
		initialized: false,
	});

	useEffect(() => {
		orbitRef.current.dragging = false;
		if (!enabled) {
			return;
		}
		orbitRef.current.initialized = false;
		const element = gl.domElement;

		const onPointerDown = (e: PointerEvent) => {
			if (e.button !== 0) {
				return;
			}
			orbitRef.current.dragging = true;
			orbitRef.current.lastX = e.clientX;
			orbitRef.current.lastY = e.clientY;
			element.setPointerCapture(e.pointerId);
		};
		const onPointerMove = (e: PointerEvent) => {
			if (!orbitRef.current.dragging) {
				return;
			}
			const dx = e.clientX - orbitRef.current.lastX;
			const dy = e.clientY - orbitRef.current.lastY;
			orbitRef.current.lastX = e.clientX;
			orbitRef.current.lastY = e.clientY;
			orbitRef.current.theta -= dx * 0.007;
			orbitRef.current.phi = clamp(orbitRef.current.phi + dy * 0.007, ORBIT_MIN_POLAR, ORBIT_MAX_POLAR);
		};
		const onPointerUp = (e: PointerEvent) => {
			orbitRef.current.dragging = false;
			if (element.hasPointerCapture(e.pointerId)) {
				element.releasePointerCapture(e.pointerId);
			}
		};
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const zoomScale = Math.exp(e.deltaY * 0.0015);
			orbitRef.current.radius = clamp(orbitRef.current.radius * zoomScale, ORBIT_MIN_RADIUS, ORBIT_MAX_RADIUS);
		};

		element.addEventListener("pointerdown", onPointerDown);
		element.addEventListener("pointermove", onPointerMove);
		element.addEventListener("pointerup", onPointerUp);
		element.addEventListener("pointercancel", onPointerUp);
		element.addEventListener("pointerleave", onPointerUp);
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			element.removeEventListener("pointerdown", onPointerDown);
			element.removeEventListener("pointermove", onPointerMove);
			element.removeEventListener("pointerup", onPointerUp);
			element.removeEventListener("pointercancel", onPointerUp);
			element.removeEventListener("pointerleave", onPointerUp);
			element.removeEventListener("wheel", onWheel);
		};
	}, [enabled, gl]);

	useFrame(() => {
		if (!enabled) {
			return;
		}
		const target = targetRef.current;
		if (!orbitRef.current.initialized) {
			const offsetX = camera.position.x - target.x;
			const offsetY = camera.position.y - target.y;
			const offsetZ = camera.position.z - target.z;
			const distance = Math.hypot(offsetX, offsetY, offsetZ);
			if (distance > 0.001) {
				orbitRef.current.radius = clamp(distance, ORBIT_MIN_RADIUS, ORBIT_MAX_RADIUS);
				orbitRef.current.theta = Math.atan2(offsetX, offsetZ);
				orbitRef.current.phi = clamp(Math.acos(clamp(offsetY / distance, -1, 1)), ORBIT_MIN_POLAR, ORBIT_MAX_POLAR);
			}
			orbitRef.current.initialized = true;
		}

		const sinPhi = Math.sin(orbitRef.current.phi);
		camera.position.set(
			target.x + orbitRef.current.radius * sinPhi * Math.sin(orbitRef.current.theta),
			target.y + orbitRef.current.radius * Math.cos(orbitRef.current.phi),
			target.z + orbitRef.current.radius * sinPhi * Math.cos(orbitRef.current.theta),
		);
		camera.lookAt(target);
	});

	return null;
}

const windowKeyboardInputSource = createWindowKeyboardInputSource();

function MovementInput({
	inputRef,
	enabled,
	inputSource,
}: {
	inputRef: React.MutableRefObject<Vector2>;
	enabled: boolean;
	inputSource?: KeyboardInputSource;
}) {
	const { room } = useRoom();
	const keys = useRef({ KeyW: false, KeyA: false, KeyS: false, KeyD: false });
	const holdRef = useRef<{
		pressed: boolean;
		holdSent: boolean;
		startMs: number;
		timerId: number | null;
	}>({ pressed: false, holdSent: false, startMs: 0, timerId: null });

	const source = inputSource ?? windowKeyboardInputSource;

	useEffect(() => {
		const onDown = (e: KeyboardLikeEvent) => {
			if (!enabled) {
				return;
			}
			if (e.code === "KeyE" && !e.repeat && room) {
				holdRef.current.pressed = true;
				holdRef.current.holdSent = false;
				holdRef.current.startMs = performance.now();
				if (holdRef.current.timerId !== null) {
					window.clearTimeout(holdRef.current.timerId);
				}
				holdRef.current.timerId = window.setTimeout(() => {
					if (!holdRef.current.pressed || holdRef.current.holdSent) {
						return;
					}
					holdRef.current.holdSent = true;
					const holdPayload: GameClientMessages["interact_hold"] = { active: true };
					room.send("interact_hold", holdPayload);
				}, HOLD_START_DELAY_MS);
			}
			if (e.code in keys.current) {
				keys.current[e.code as keyof typeof keys.current] = true;
			}
		};
		const onUp = (e: KeyboardLikeEvent) => {
			if (e.code === "KeyE" && room) {
				const heldMs = performance.now() - holdRef.current.startMs;
				holdRef.current.pressed = false;
				if (holdRef.current.timerId !== null) {
					window.clearTimeout(holdRef.current.timerId);
					holdRef.current.timerId = null;
				}
				if (holdRef.current.holdSent) {
					const holdPayload: GameClientMessages["interact_hold"] = { active: false };
					room.send("interact_hold", holdPayload);
				}
				if (!holdRef.current.holdSent && heldMs <= SHORT_PRESS_MAX_MS) {
					const interactPayload: GameClientMessages["interact"] = {};
					room.send("interact", interactPayload);
				}
				holdRef.current.holdSent = false;
			}
			if (e.code in keys.current) {
				keys.current[e.code as keyof typeof keys.current] = false;
			}
		};
		return source.subscribe(onDown, onUp);
	}, [enabled, room, source]);

	useFrame(() => {
		if (!room) {
			return;
		}
		if (!enabled) {
			keys.current.KeyW = false;
			keys.current.KeyA = false;
			keys.current.KeyS = false;
			keys.current.KeyD = false;
			inputRef.current.set(0, 0);
			if (holdRef.current.timerId !== null) {
				window.clearTimeout(holdRef.current.timerId);
				holdRef.current.timerId = null;
			}
			if (holdRef.current.holdSent) {
				holdRef.current.pressed = false;
				holdRef.current.holdSent = false;
				const holdPayload: GameClientMessages["interact_hold"] = { active: false };
				room.send("interact_hold", holdPayload);
			}
			const payload: GameClientMessages["input"] = { x: 0, z: 0 };
			room.send("input", payload);
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

function SceneContent({
	onAreaChange,
	revealAll,
	debugCameraEnabled,
	audioEnabled,
	inputSource,
	outlinesEnabled,
}: {
	onAreaChange?: (label: string) => void;
	revealAll: boolean;
	debugCameraEnabled: boolean;
	audioEnabled: boolean;
	inputSource?: KeyboardInputSource;
	outlinesEnabled: boolean;
}) {
	const { room } = useRoom();
	const players = useRoomState((s) => s.players);
	const interactables = useRoomState((s) => s.interactables);
	const keycards = useRoomState((s) => s.keycards);
	const suitcases = useRoomState((s) => s.suitcases);
	const vaults = useRoomState((s) => s.vaults);
	const mapSeed = useRoomState((s) => s.mapSeed);
	const mapMaxDistance = useRoomState((s) => s.mapMaxDistance);
	const inputRef = useRef(new Vector2(0, 0));
	const localVisualRef = useRef(new Vector3(0, 0.5, 0));
	const lastAreaRef = useRef<string>("");
	const [currentArea, setCurrentArea] = useState("Start Room");
	const [visitedAreas, setVisitedAreas] = useState<Set<string>>(() => new Set(["Start Room"]));

	useEffect(() => {
		if (!audioEnabled) {
			return;
		}
		if (!room) {
			return;
		}
		return room.onMessage("interaction_feedback", (message: { kind: "error_beep" }) => {
			if (message.kind !== "error_beep") {
				return;
			}
			const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!AudioContextCtor) {
				return;
			}
			const context = new AudioContextCtor();
			const oscillator = context.createOscillator();
			const gain = context.createGain();
			oscillator.type = "square";
			oscillator.frequency.value = 210;
			gain.gain.setValueAtTime(0.0001, context.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.01);
			gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.17);
			oscillator.connect(gain);
			gain.connect(context.destination);
			oscillator.start();
			oscillator.stop(context.currentTime + 0.19);
			window.setTimeout(() => {
				void context.close();
			}, 280);
		});
	}, [audioEnabled, room]);

	const layout = useMemo(() => {
		return generateMapLayout(mapSeed ?? 0, mapMaxDistance ?? 12);
	}, [mapSeed, mapMaxDistance]);
	const staticWalls = useMemo(() => buildCollisionWalls(layout), [layout]);
	const fileCabinetWalls = useMemo(
		() => buildFileCabinetCollisionWalls(generateFileCabinetPlacements(layout)),
		[layout],
	);
	const dynamicWalls = useMemo(() => {
		const doors = schemaMapValues<DoorState>(interactables);
		const syncedVaults = schemaMapValues<{ x: number; z: number }>(vaults);
		const vaultCollisionSources =
			syncedVaults.length > 0
				? syncedVaults
				: (() => {
						const fallback = generateVaultPlacement();
						return [{ x: fallback.x, z: fallback.z }];
					})();
		const vaultWalls = buildVaultCollisionWalls(
			vaultCollisionSources.map((vault) => ({
				x: vault.x,
				z: vault.z,
			})),
		);
		return buildClosedDoorWalls(
			doors.map((door) => ({
				x: door.x,
				z: door.z,
				facing: door.facing === "z" ? "z" : "x",
				isOpen: door.isOpen,
			})),
		).concat(vaultWalls);
	}, [interactables, vaults]);
	const walls = useMemo(
		() => [...staticWalls, ...dynamicWalls, ...fileCabinetWalls],
		[dynamicWalls, fileCabinetWalls, staticWalls],
	);
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
			onAreaChange?.(label);
		}
	}, -100);

	const list = useMemo(() => {
		if (!players) {
			return [];
		}
		const carriedColorBySessionId = new Map<string, KeycardColor>();
		for (const card of schemaMapValues<KeycardState>(keycards)) {
			if (card.state !== "carried" || !card.carrierSessionId) {
				continue;
			}
			carriedColorBySessionId.set(card.carrierSessionId, card.color === "red" ? "red" : "blue");
		}
		const carriedSuitcaseBySessionId = new Set<string>();
		for (const suitcase of schemaMapValues<SuitcaseState>(suitcases)) {
			if (suitcase.state !== "carried" || !suitcase.carrierSessionId) {
				continue;
			}
			carriedSuitcaseBySessionId.add(suitcase.carrierSessionId);
		}
		return Object.entries(players as Record<string, any>).map(([id, p]) => ({
			id,
			x: p.x,
			z: p.z,
			color: p.color,
			isLocal: id === room?.sessionId,
			area: areaInfo.labelByCell.get(`${Math.round(p.x / CELL_SIZE)},${Math.round(p.z / CELL_SIZE)}`) ?? "Out of Bounds",
			carriedKeycardColor: carriedColorBySessionId.get(id) ?? null,
			carriedSuitcase: carriedSuitcaseBySessionId.has(id),
			isInteracting: !!p.isInteracting,
			interactionProgress:
				typeof p.interactionDurationMs === "number" && p.interactionDurationMs > 0
					? Math.max(0, Math.min(1, p.interactionElapsedMs / p.interactionDurationMs))
					: 0,
		}));
	}, [areaInfo.labelByCell, keycards, players, room?.sessionId, suitcases]);

	return (
		<>
			<CelRenderLayer config={{ bandCount: 3, bandGamma: 1.45 }} />
			<ThirdPersonCamera targetRef={localVisualRef} enabled={!debugCameraEnabled} />
			<DebugOrbitCamera targetRef={localVisualRef} enabled={debugCameraEnabled} />
			<MovementInput inputRef={inputRef} enabled={!debugCameraEnabled} inputSource={inputSource} />
			<ambientLight intensity={0.42} />
			<LightingLayer layout={layout} areaInfo={areaInfo} currentArea={currentArea} fogByCell={fogByCell} />
			<MapLevel
				layout={layout}
				fogByCell={fogByCell}
				areaInfo={areaInfo}
				currentArea={currentArea}
				playerPositionRef={localVisualRef}
				outlinesEnabled={outlinesEnabled}
			/>
			<DoorLayer fogByCell={fogByCell} revealAll={revealAll} audioEnabled={audioEnabled} />
			<KeycardLayer
				fogByCell={fogByCell}
				revealAll={revealAll}
				areaInfo={areaInfo}
				currentArea={currentArea}
				audioEnabled={audioEnabled}
				outlinesEnabled={outlinesEnabled}
			/>
			<SuitcaseLayer
				fogByCell={fogByCell}
				revealAll={revealAll}
				areaInfo={areaInfo}
				currentArea={currentArea}
				audioEnabled={audioEnabled}
				outlinesEnabled={outlinesEnabled}
			/>
			<FileCabinetLayer
				fogByCell={fogByCell}
				revealAll={revealAll}
				mapSeed={mapSeed ?? 0}
				mapMaxDistance={mapMaxDistance ?? 12}
				areaInfo={areaInfo}
				currentArea={currentArea}
			/>
			<VaultLayer
				fogByCell={fogByCell}
				revealAll={revealAll}
				areaInfo={areaInfo}
				currentArea={currentArea}
				audioEnabled={audioEnabled}
				outlinesEnabled={outlinesEnabled}
			/>
			{list.map((p) =>
				p.isLocal ? (
					<PlayerVisual
						key={p.id}
						color={p.color}
						isLocal
						positionRef={localVisualRef}
						smoothing={0}
						outlined={outlinesEnabled}
						carriedKeycardColor={p.carriedKeycardColor}
						carriedSuitcase={p.carriedSuitcase}
						isInteracting={p.isInteracting}
						interactionProgress={p.interactionProgress}
					/>
				) : revealAll || p.area === currentArea ? (
					<PlayerVisual
						key={p.id}
						color={p.color}
						isLocal={false}
						target={{ x: p.x, z: p.z }}
						smoothing={18}
						carriedKeycardColor={p.carriedKeycardColor}
						carriedSuitcase={p.carriedSuitcase}
						isInteracting={p.isInteracting}
						interactionProgress={p.interactionProgress}
						outlined={false}
					/>
				) : null,
			)}
		</>
	);
}

export function GameScene({
	onAreaChange,
	revealAll,
	debugCameraEnabled,
	audioEnabled = true,
	inputSource,
	outlinesEnabled = true,
}: {
	onAreaChange?: (label: string) => void;
	revealAll: boolean;
	debugCameraEnabled: boolean;
	audioEnabled?: boolean;
	inputSource?: KeyboardInputSource;
	outlinesEnabled?: boolean;
}) {
	return (
		<Canvas shadows camera={{ fov: 50, near: 0.1, far: 500 }} style={{ width: "100%", height: "100%" }}>
			<color attach="background" args={["#0e141c"]} />
			<SceneContent
				onAreaChange={onAreaChange}
				revealAll={revealAll}
				debugCameraEnabled={debugCameraEnabled}
				audioEnabled={audioEnabled}
				inputSource={inputSource}
				outlinesEnabled={outlinesEnabled}
			/>
		</Canvas>
	);
}



