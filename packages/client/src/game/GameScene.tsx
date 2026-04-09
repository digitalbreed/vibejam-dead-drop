import { useMemo, useRef, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Vector2, Vector3 } from "three";
import {
	buildClosedDoorWalls,
	buildCollisionWalls,
	buildFileCabinetCollisionWalls,
	buildVaultCollisionWalls,
	CELL_SIZE,
	type GameServerMessages,
	generateFileCabinetPlacements,
	generateVaultPlacement,
	generateMapLayout,
	layoutRoomMap,
	moveWithCollision,
	type DoorState,
	type KeycardState,
	type SuitcaseState,
} from "@vibejam/shared";
import { useRoom, useRoomState } from "../colyseus/roomContext";
import { schemaMapValues } from "../colyseus/schemaMap";
import { DoorLayer } from "./doors/DoorLayer";
import { type KeyboardInputSource } from "./input/keyboardInput";
import { KeycardLayer } from "./keycards/KeycardLayer";
import { LightingLayer } from "./LightingLayer";
import { MapLevel } from "./MapLevel";
import { SuitcaseLayer } from "./suitcases/SuitcaseLayer";
import { VaultLayer } from "./vaults/VaultLayer";
import { FileCabinetLayer } from "./fileCabinets/FileCabinetLayer";
import { CelRenderLayer } from "./celRender";
import { TrapLayer } from "./traps/TrapLayer";
import { DebugOrbitCamera, ThirdPersonCamera, ThrottledInvalidator } from "./scene/CameraControllers";
import { ComicExplosionEffect, EXPLOSION_FX_DURATION_MS } from "./scene/ComicExplosionEffect";
import { MovementInput } from "./scene/MovementInput";
import { PlayerVisual, type KeycardColor } from "./scene/PlayerVisual";

const MOVE_SPEED = 12;
const COMPASS_LABELS = ["East", "Northeast", "North", "Northwest", "West", "Southwest", "South", "Southeast"] as const;

export type AreaInfo = {
	labelByCell: Map<string, string>;
};
export type FogState = "hidden" | "explored" | "visible";
export type PassthroughKind = "none" | "frontWall";
const DEAD_REVEAL_START_DELAY_MS = 3000;
const DEAD_REVEAL_STEP_MS = 1000;
const DEAD_CAMERA_FOLLOW_SPEED_THRESHOLD = 0.22;

type ExplosionFx = {
	id: number;
	x: number;
	z: number;
	spawnMs: number;
};


function buildFogByCellWithForcedVisible(
	areaInfo: AreaInfo,
	currentArea: string,
	visitedAreas: ReadonlySet<string>,
	revealAll: boolean,
	forcedVisibleCells: ReadonlySet<string> | null,
): Map<string, FogState> {
	const result = new Map<string, FogState>();
	for (const [cellKey, area] of areaInfo.labelByCell) {
		if (revealAll || (forcedVisibleCells?.has(cellKey) ?? false)) {
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

function getPlayerBySessionId(players: unknown, sessionId: string): any {
	if (!players) {
		return undefined;
	}
	if (typeof players === "object" && players !== null && "get" in players && typeof (players as { get: (key: string) => unknown }).get === "function") {
		return (players as { get: (key: string) => unknown }).get(sessionId);
	}
	return (players as Record<string, any>)[sessionId];
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


function SceneContent({
	onAreaChange,
	revealAll,
	spectatorReveal,
	debugCameraEnabled,
	audioEnabled,
	inputSource,
	outlinesEnabled,
	controlsEnabled,
}: {
	onAreaChange?: (label: string) => void;
	revealAll: boolean;
	spectatorReveal: boolean;
	debugCameraEnabled: boolean;
	audioEnabled: boolean;
	inputSource?: KeyboardInputSource;
	outlinesEnabled: boolean;
	controlsEnabled: boolean;
}) {
	const { room } = useRoom();
	const players = useRoomState((s) => s.players);
	const interactables = useRoomState((s) => s.interactables);
	const keycards = useRoomState((s) => s.keycards);
	const suitcases = useRoomState((s) => s.suitcases);
	const vaults = useRoomState((s) => s.vaults);
	const traps = useRoomState((s) => s.traps);
	const mapSeed = useRoomState((s) => s.mapSeed);
	const mapMaxDistance = useRoomState((s) => s.mapMaxDistance);
	const inputRef = useRef(new Vector2(0, 0));
	const localVisualRef = useRef(new Vector3(0, 0.5, 0));
	const spectatorTargetRef = useRef(new Vector3(0, 0.5, 0));
	const deadStateRef = useRef(false);
	const deadCameraFollowRef = useRef(false);
	const authoritativeRef = useRef(new Vector3());
	const lastAreaRef = useRef<string>("");
	const [currentArea, setCurrentArea] = useState("Start Room");
	const [visitedAreas, setVisitedAreas] = useState<Set<string>>(() => new Set(["Start Room"]));
	const [explosions, setExplosions] = useState<ExplosionFx[]>([]);
	const explosionIdRef = useRef(0);
	const audioContextRef = useRef<AudioContext | null>(null);

	useEffect(() => {
		return () => {
			if (audioContextRef.current) {
				void audioContextRef.current.close();
				audioContextRef.current = null;
			}
		};
	}, []);

	const getAudioContext = () => {
		const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
		if (!AudioContextCtor) {
			return null;
		}
		if (!audioContextRef.current || audioContextRef.current.state === "closed") {
			audioContextRef.current = new AudioContextCtor();
		}
		return audioContextRef.current;
	};

	const playTrapExplosionSound = (volume: number) => {
		const context = getAudioContext();
		if (!context) {
			return;
		}
		const now = context.currentTime;
		const masterGain = context.createGain();
		masterGain.gain.setValueAtTime(0.0001, now);
		masterGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.42 * volume), now + 0.012);
		masterGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, 0.26 * volume), now + 0.28);
		masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.08);
		masterGain.connect(context.destination);

		const mainOsc = context.createOscillator();
		mainOsc.type = "sawtooth";
		mainOsc.frequency.setValueAtTime(290, now);
		mainOsc.frequency.exponentialRampToValueAtTime(64, now + 0.62);
		const mainGain = context.createGain();
		mainGain.gain.setValueAtTime(1.08, now);
		mainGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.88);
		mainOsc.connect(mainGain);
		mainGain.connect(masterGain);
		mainOsc.start(now);
		mainOsc.stop(now + 0.92);

		const tailOsc = context.createOscillator();
		tailOsc.type = "sawtooth";
		tailOsc.frequency.setValueAtTime(170, now);
		tailOsc.frequency.exponentialRampToValueAtTime(38, now + 0.95);
		const tailGain = context.createGain();
		tailGain.gain.setValueAtTime(0.86, now);
		tailGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
		tailOsc.connect(tailGain);
		tailGain.connect(masterGain);
		tailOsc.start(now + 0.01);
		tailOsc.stop(now + 1.02);

		const rumbleOsc = context.createOscillator();
		rumbleOsc.type = "sawtooth";
		rumbleOsc.frequency.setValueAtTime(78, now);
		rumbleOsc.frequency.exponentialRampToValueAtTime(26, now + 1.02);
		const rumbleGain = context.createGain();
		rumbleGain.gain.setValueAtTime(0.52, now + 0.03);
		rumbleGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.04);
		rumbleOsc.connect(rumbleGain);
		rumbleGain.connect(masterGain);
		rumbleOsc.start(now + 0.02);
		rumbleOsc.stop(now + 1.05);
	};

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

	useEffect(() => {
		if (!room) {
			return;
		}
		return room.onMessage("explosion_event", (message: GameServerMessages["explosion_event"]) => {
			const fx: ExplosionFx = {
				id: ++explosionIdRef.current,
				x: message.x,
				z: message.z,
				spawnMs: performance.now(),
			};
			setExplosions((current) => {
				const next = [...current, fx];
				return next.length > 12 ? next.slice(next.length - 12) : next;
			});
			if (!audioEnabled) {
				return;
			}
			const sessionId = room.sessionId;
			const local = sessionId ? getPlayerBySessionId(players, sessionId) : undefined;
			if (!local) {
				return;
			}
			const dx = local.x - message.x;
			const dz = local.z - message.z;
			const dist = Math.hypot(dx, dz);
			if (dist > message.range) {
				return;
			}
			const normalized = Math.min(1, dist / Math.max(0.001, message.range));
			const volume = 1 - normalized * normalized;
			playTrapExplosionSound(Math.max(0.08, volume));
		});
	}, [audioEnabled, players, room]);

	useEffect(() => {
		if (explosions.length === 0) {
			return;
		}
		const timerId = window.setInterval(() => {
			setExplosions((current) => {
				const now = performance.now();
				const next = current.filter((fx) => now - fx.spawnMs <= EXPLOSION_FX_DURATION_MS + 120);
				return next.length === current.length ? current : next;
			});
		}, 110);
		return () => window.clearInterval(timerId);
	}, [explosions.length]);

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
	const [deadRevealAreaCount, setDeadRevealAreaCount] = useState(0);
	const spectatorAreaOrder = useMemo(() => {
		const unique = new Set<string>();
		for (const areaLabel of areaInfo.labelByCell.values()) {
			unique.add(areaLabel);
		}
		return [...unique].filter((label) => label !== currentArea).sort((a, b) => a.localeCompare(b));
	}, [areaInfo.labelByCell, currentArea]);
	const spectatorRevealedAreas = useMemo(
		() => new Set(spectatorAreaOrder.slice(0, Math.min(deadRevealAreaCount, spectatorAreaOrder.length))),
		[deadRevealAreaCount, spectatorAreaOrder],
	);
	const mapBounds = useMemo(() => {
		let minX = Infinity;
		let maxX = -Infinity;
		let minZ = Infinity;
		let maxZ = -Infinity;
		for (const cell of layout.cells) {
			const x = cell.ix * CELL_SIZE;
			const z = cell.iz * CELL_SIZE;
			minX = Math.min(minX, x);
			maxX = Math.max(maxX, x);
			minZ = Math.min(minZ, z);
			maxZ = Math.max(maxZ, z);
		}
		const pad = CELL_SIZE * 1.5;
		return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
	}, [layout.cells]);
	const localSessionId = room?.sessionId;
	const localPlayerSnapshot = localSessionId ? getPlayerBySessionId(players, localSessionId) : undefined;
	const localIsAlive = localPlayerSnapshot?.isAlive !== false;
	const deadRevealComplete = deadRevealAreaCount >= spectatorAreaOrder.length;
	const revealAllNow = revealAll || spectatorReveal;
	const spectatorGlobalActive = spectatorReveal && deadRevealComplete;
	const fogByCell = useMemo(
		() =>
			buildFogByCellWithForcedVisible(
				areaInfo,
				currentArea,
				visitedAreas,
				revealAllNow,
				null,
			),
		[areaInfo, currentArea, revealAllNow, visitedAreas],
	);
	const cameraTargetRef = localIsAlive ? localVisualRef : spectatorTargetRef;

	useEffect(() => {
		if (!spectatorReveal) {
			setDeadRevealAreaCount(0);
			return;
		}
		setDeadRevealAreaCount(0);
		let cancelled = false;
		let timerId: number | null = null;

		const scheduleNextStep = () => {
			if (cancelled) {
				return;
			}
			timerId = window.setTimeout(() => {
				if (cancelled) {
					return;
				}
				setDeadRevealAreaCount((current) => {
					const next = Math.min(spectatorAreaOrder.length, current + 1);
					if (next < spectatorAreaOrder.length) {
						scheduleNextStep();
					}
					return next;
				});
			}, DEAD_REVEAL_STEP_MS);
		};

		timerId = window.setTimeout(() => {
			if (cancelled || spectatorAreaOrder.length === 0) {
				return;
			}
			scheduleNextStep();
		}, DEAD_REVEAL_START_DELAY_MS);

		return () => {
			cancelled = true;
			if (timerId !== null) {
				window.clearTimeout(timerId);
			}
		};
	}, [spectatorAreaOrder.length, spectatorReveal]);

	useEffect(() => {
		const sessionId = room?.sessionId;
		const local = sessionId ? getPlayerBySessionId(players, sessionId) : undefined;
		if (!sessionId || !local) {
			localVisualRef.current.set(0, 0.5, 0);
			spectatorTargetRef.current.set(0, 0.5, 0);
			return;
		}
		if (localVisualRef.current.lengthSq() === 0) {
			localVisualRef.current.set(local.x, 0.5, local.z);
		}
		if (local.isAlive !== false) {
			spectatorTargetRef.current.set(local.x, 0.5, local.z);
		}
	}, [players, room]);

	useFrame((_, dt) => {
		const sessionId = room?.sessionId;
		const local = sessionId ? getPlayerBySessionId(players, sessionId) : undefined;
		if (!sessionId || !local) {
			return;
		}
		if (!local.isAlive) {
			if (!deadStateRef.current) {
				deadStateRef.current = true;
				spectatorTargetRef.current.set(localVisualRef.current.x, 0.5, localVisualRef.current.z);
				deadCameraFollowRef.current = true;
			}
			authoritativeRef.current.set(local.x, 0.5, local.z);
			const deadDx = authoritativeRef.current.x - localVisualRef.current.x;
			const deadDz = authoritativeRef.current.z - localVisualRef.current.z;
			const deadErrorSq = deadDx * deadDx + deadDz * deadDz;
			if (deadErrorSq > 2.8) {
				localVisualRef.current.copy(authoritativeRef.current);
			} else {
				localVisualRef.current.x += deadDx * Math.min(1, dt * 14);
				localVisualRef.current.z += deadDz * Math.min(1, dt * 14);
			}
			const deadSpeed = Math.hypot(deadDx, deadDz) / Math.max(dt, 0.0001);
			if (deadSpeed > DEAD_CAMERA_FOLLOW_SPEED_THRESHOLD) {
				deadCameraFollowRef.current = true;
			} else if (deadSpeed < DEAD_CAMERA_FOLLOW_SPEED_THRESHOLD * 0.6) {
				deadCameraFollowRef.current = false;
			}
			if (deadCameraFollowRef.current) {
				spectatorTargetRef.current.set(localVisualRef.current.x, 0.5, localVisualRef.current.z);
				return;
			}
			const panSpeed = MOVE_SPEED * 1.2;
			spectatorTargetRef.current.x = clamp(
				spectatorTargetRef.current.x + inputRef.current.x * panSpeed * dt,
				mapBounds.minX,
				mapBounds.maxX,
			);
			spectatorTargetRef.current.z = clamp(
				spectatorTargetRef.current.z + inputRef.current.y * panSpeed * dt,
				mapBounds.minZ,
				mapBounds.maxZ,
			);
			return;
		}
		deadStateRef.current = false;
		const authoritative = authoritativeRef.current;
		authoritative.set(local.x, 0.5, local.z);
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
		const playerEntries: Array<[string, any]> =
			typeof players === "object" && players !== null && "entries" in players && typeof (players as { entries: () => Iterable<[string, any]> }).entries === "function"
				? Array.from((players as { entries: () => Iterable<[string, any]> }).entries())
				: Object.entries(players as Record<string, any>);
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
		return playerEntries.map(([id, p]) => ({
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
			interactionStyle: typeof p.interactionStyle === "string" ? p.interactionStyle : "normal",
			isAlive: p.isAlive !== false,
		}));
	}, [areaInfo.labelByCell, keycards, players, room?.sessionId, suitcases]);

	return (
		<>
			<CelRenderLayer config={{ bandCount: 3, bandGamma: 1.45 }} />
			<ThirdPersonCamera targetRef={cameraTargetRef} enabled={!debugCameraEnabled} />
			<DebugOrbitCamera targetRef={cameraTargetRef} enabled={debugCameraEnabled} />
			<MovementInput
				inputRef={inputRef}
				enabled={controlsEnabled && !debugCameraEnabled}
				inputSource={inputSource}
				deadMode={!localIsAlive}
			/>
			<ambientLight intensity={0.42} />
			<LightingLayer
				layout={layout}
				areaInfo={areaInfo}
				currentArea={currentArea}
				fogByCell={fogByCell}
				forceAllActive={spectatorGlobalActive}
				spectatorRevealedAreas={spectatorReveal ? spectatorRevealedAreas : null}
				outlinesEnabled={outlinesEnabled}
			/>
			<MapLevel
				layout={layout}
				fogByCell={fogByCell}
				areaInfo={areaInfo}
				currentArea={currentArea}
				playerPositionRef={localVisualRef}
				forceAllOutlined={spectatorGlobalActive}
				outlinesEnabled={outlinesEnabled}
			/>
			<DoorLayer fogByCell={fogByCell} revealAll={revealAllNow} audioEnabled={audioEnabled} />
			<KeycardLayer
				fogByCell={fogByCell}
				revealAll={revealAllNow}
				forceAllOutlined={spectatorGlobalActive}
				areaInfo={areaInfo}
				currentArea={currentArea}
				audioEnabled={audioEnabled}
				outlinesEnabled={outlinesEnabled}
			/>
			<SuitcaseLayer
				fogByCell={fogByCell}
				revealAll={revealAllNow}
				forceAllOutlined={spectatorGlobalActive}
				areaInfo={areaInfo}
				currentArea={currentArea}
				audioEnabled={audioEnabled}
				outlinesEnabled={outlinesEnabled}
			/>
			<FileCabinetLayer
				fogByCell={fogByCell}
				revealAll={revealAllNow}
				forceAllOutlined={spectatorGlobalActive}
				mapSeed={mapSeed ?? 0}
				mapMaxDistance={mapMaxDistance ?? 12}
				areaInfo={areaInfo}
				currentArea={currentArea}
				outlinesEnabled={outlinesEnabled}
			/>
			<VaultLayer
				fogByCell={fogByCell}
				revealAll={revealAllNow}
				forceAllOutlined={spectatorGlobalActive}
				areaInfo={areaInfo}
				currentArea={currentArea}
				audioEnabled={audioEnabled}
				outlinesEnabled={outlinesEnabled}
			/>
			<TrapLayer
				trapsState={traps}
				fogByCell={fogByCell}
				revealAll={revealAllNow}
				forceAllOutlined={spectatorGlobalActive}
				mapSeed={mapSeed ?? 0}
				mapMaxDistance={mapMaxDistance ?? 12}
				areaInfo={areaInfo}
				currentArea={currentArea}
				outlinesEnabled={outlinesEnabled}
			/>
			{explosions.map((fx) => {
				const fog = fogByCell.get(`${Math.round(fx.x / CELL_SIZE)},${Math.round(fx.z / CELL_SIZE)}`) ?? "hidden";
				if (!revealAllNow && fog === "hidden") {
					return null;
				}
				return <ComicExplosionEffect key={fx.id} x={fx.x} z={fx.z} spawnMs={fx.spawnMs} />;
			})}
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
						interactionStyle={p.interactionStyle}
						isAlive={p.isAlive}
					/>
				) : revealAllNow || p.area === currentArea ? (
					<PlayerVisual
						key={p.id}
						color={p.color}
						isLocal={false}
						target={{ x: p.x, z: p.z }}
						smoothing={18}
						carriedKeycardColor={p.carriedKeycardColor}
						carriedSuitcase={p.carriedSuitcase}
						isInteracting={false}
						interactionProgress={0}
						interactionStyle="normal"
						isAlive={p.isAlive}
						outlined={outlinesEnabled}
					/>
				) : null,
			)}
		</>
	);
}

export function GameScene({
	onAreaChange,
	revealAll,
	spectatorReveal = false,
	debugCameraEnabled,
	audioEnabled = true,
	inputSource,
	outlinesEnabled = true,
	frameloop = "always",
	dpr,
	shadows = true,
	renderFps,
	controlsEnabled = true,
}: {
	onAreaChange?: (label: string) => void;
	revealAll: boolean;
	spectatorReveal?: boolean;
	debugCameraEnabled: boolean;
	audioEnabled?: boolean;
	inputSource?: KeyboardInputSource;
	outlinesEnabled?: boolean;
	frameloop?: "always" | "demand" | "never";
	dpr?: number | [number, number];
	shadows?: boolean;
	renderFps?: number;
	controlsEnabled?: boolean;
}) {
	return (
		<Canvas
			shadows={shadows}
			frameloop={frameloop}
			dpr={dpr}
			camera={{ fov: 50, near: 0.1, far: 500 }}
			style={{ width: "100%", height: "100%" }}
		>
			<color attach="background" args={["#0e141c"]} />
			{frameloop === "demand" && Number.isFinite(renderFps) && (renderFps ?? 0) > 0 ? (
				<ThrottledInvalidator fps={renderFps ?? 0} />
			) : null}
			<SceneContent
				onAreaChange={onAreaChange}
				revealAll={revealAll}
				spectatorReveal={spectatorReveal}
				debugCameraEnabled={debugCameraEnabled}
				audioEnabled={audioEnabled}
				inputSource={inputSource}
				outlinesEnabled={outlinesEnabled}
				controlsEnabled={controlsEnabled}
			/>
		</Canvas>
	);
}
