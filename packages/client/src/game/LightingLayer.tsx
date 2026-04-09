import { useMemo } from "react";
import { CELL_SIZE, ROOM_HEIGHT, layoutOccupancy, mulberry32, type MapLayout } from "@vibejam/shared";
import type { FogState } from "./GameScene";
import { OutlinedMesh } from "./toonOutline/OutlinedMesh";

type AreaInfo = {
	labelByCell: Map<string, string>;
};

type CorridorLight = {
	kind: "corridor";
	area: string;
	x: number;
	y: number;
	z: number;
	length: number;
	rotationY: number;
};

type WallLight = {
	kind: "wall";
	area: string;
	x: number;
	y: number;
	z: number;
	rotationY: number;
};

type Fixture = CorridorLight | WallLight;

const WALL_LIGHT_INSET = 0.18;
const CORRIDOR_ACTIVE_LIGHT_STRIDE = 2;
function shouldEnableCorridorLights(fixture: CorridorLight): boolean {
	// Corridors can have many cells; enabling a rectAreaLight+pointLight for every cell can cause
	// noticeable hitches on area transitions. Keep emissive fixtures everywhere, but only enable
	// real lights for a deterministic subset.
	const ix = Math.round(fixture.x / CELL_SIZE);
	const iz = Math.round(fixture.z / CELL_SIZE);
	return (Math.abs(ix) + Math.abs(iz)) % CORRIDOR_ACTIVE_LIGHT_STRIDE === 0;
}

function hashLabel(label: string): number {
	let hash = 2166136261 >>> 0;
	for (let i = 0; i < label.length; i++) {
		hash ^= label.charCodeAt(i);
		hash = Math.imul(hash, 16777619) >>> 0;
	}
	return hash >>> 0;
}

function chooseIndices(count: number, targetCount: number, rng: () => number): number[] {
	if (count <= targetCount) {
		return Array.from({ length: count }, (_, index) => index);
	}
	const chosen = new Set<number>();
	while (chosen.size < targetCount) {
		chosen.add(Math.floor(rng() * count));
	}
	return [...chosen].sort((a, b) => a - b);
}

function buildFixtures(layout: MapLayout, areaInfo: AreaInfo): Fixture[] {
	const occupancy = layoutOccupancy(layout);
	const cellData = new Map(layout.cells.map((cell) => [`${cell.ix},${cell.iz}`, cell] as const));
	const cellsByArea = new Map<string, { ix: number; iz: number }[]>();
	for (const cell of layout.cells) {
		const area = areaInfo.labelByCell.get(`${cell.ix},${cell.iz}`);
		if (!area) {
			continue;
		}
		const bucket = cellsByArea.get(area) ?? [];
		bucket.push({ ix: cell.ix, iz: cell.iz });
		cellsByArea.set(area, bucket);
	}

	const fixtures: Fixture[] = [];
	for (const [area, cells] of cellsByArea) {
		const rng = mulberry32(layout.seed ^ hashLabel(area));
		if (area.startsWith("Corridor")) {
			for (const cell of cells) {
				const east = cellData.get(`${cell.ix + 1},${cell.iz}`)?.kind === "hall";
				const west = cellData.get(`${cell.ix - 1},${cell.iz}`)?.kind === "hall";
				const south = cellData.get(`${cell.ix},${cell.iz + 1}`)?.kind === "hall";
				const north = cellData.get(`${cell.ix},${cell.iz - 1}`)?.kind === "hall";
				const alongX = east || west;
				const alongZ = north || south;
				fixtures.push({
					kind: "corridor",
					area,
					x: cell.ix * CELL_SIZE,
					y: ROOM_HEIGHT - 0.14,
					z: cell.iz * CELL_SIZE,
					length: alongX && !alongZ ? CELL_SIZE * 0.72 : CELL_SIZE * 0.56,
					rotationY: alongX && !alongZ ? Math.PI / 2 : 0,
				});
			}
			continue;
		}

		const candidatesByWall = new Map<string, WallLight[]>();
		for (const cell of cells) {
			const wx = cell.ix * CELL_SIZE;
			const wz = cell.iz * CELL_SIZE;
			const addCandidate = (wall: string, x: number, z: number, rotationY: number) => {
				const bucket = candidatesByWall.get(wall) ?? [];
				bucket.push({
					kind: "wall",
					area,
					x,
					y: 1.55,
					z,
					rotationY,
				});
				candidatesByWall.set(wall, bucket);
			};
			if (!occupancy.has(`${cell.ix + 1},${cell.iz}`)) {
				addCandidate("east", wx + CELL_SIZE / 2 - WALL_LIGHT_INSET, wz, -Math.PI / 2);
			}
			if (!occupancy.has(`${cell.ix - 1},${cell.iz}`)) {
				addCandidate("west", wx - CELL_SIZE / 2 + WALL_LIGHT_INSET, wz, Math.PI / 2);
			}
			if (!occupancy.has(`${cell.ix},${cell.iz + 1}`)) {
				addCandidate("south", wx, wz + CELL_SIZE / 2 - WALL_LIGHT_INSET, Math.PI);
			}
			if (!occupancy.has(`${cell.ix},${cell.iz - 1}`)) {
				addCandidate("north", wx, wz - CELL_SIZE / 2 + WALL_LIGHT_INSET, 0);
			}
		}

		for (const [, candidates] of [...candidatesByWall.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
			if (candidates.length === 0) {
				continue;
			}
			const targetCount = Math.max(1, Math.floor(candidates.length / 3));
			for (const index of chooseIndices(candidates.length, targetCount, rng)) {
				const candidate = candidates[index];
				if (candidate) {
					fixtures.push(candidate);
				}
			}
		}
	}
	return fixtures;
}

function CorridorFixture({
	mode,
	fixture,
	outlinesEnabled,
	allowRealtimeLight,
	visible,
}: {
	mode: "off" | "memory" | "active";
	fixture: CorridorLight;
	outlinesEnabled: boolean;
	allowRealtimeLight: boolean;
	visible: boolean;
}) {
	const active = mode === "active";
	const memory = mode === "memory";
	const lightsEnabled = active && allowRealtimeLight && shouldEnableCorridorLights(fixture);
	return (
		<group position={[fixture.x, fixture.y, fixture.z]} rotation={[0, fixture.rotationY, 0]} visible={visible}>
			<OutlinedMesh
				castShadow
				receiveShadow
				outlined={outlinesEnabled && active}
				geometryNode={<boxGeometry args={[0.08, 0.05, fixture.length]} />}
				materialNode={
					<meshToonMaterial
						color={active ? "#dfefff" : memory ? "#7c8792" : "#4c545d"}
						emissive={active ? "#d6ecff" : memory ? "#6f7a86" : "#000000"}
						emissiveIntensity={active ? 1.4 : memory ? 0.18 : 0}
					/>
				}
			/>
			{lightsEnabled ? <rectAreaLight args={["#cde6ff", 3.4, fixture.length * 0.92, 0.24]} position={[0, -0.1, 0]} rotation={[-Math.PI / 2, 0, 0]} /> : null}
			{lightsEnabled ? <pointLight color="#d8ebff" intensity={0.75} distance={5.5} decay={2} position={[0, -0.22, 0]} /> : null}
		</group>
	);
}

function WallFixture({
	mode,
	fixture,
	outlinesEnabled,
	allowRealtimeLight,
	visible,
}: {
	mode: "off" | "memory" | "active";
	fixture: WallLight;
	outlinesEnabled: boolean;
	allowRealtimeLight: boolean;
	visible: boolean;
}) {
	const active = mode === "active";
	const memory = mode === "memory";
	return (
		<group position={[fixture.x, fixture.y, fixture.z]} rotation={[0, fixture.rotationY, 0]} visible={visible}>
			<OutlinedMesh
				position={[0, 0, 0]}
				castShadow
				receiveShadow
				outlined={outlinesEnabled && active}
				geometryNode={<boxGeometry args={[0.18, 0.34, 0.28]} />}
				materialNode={<meshToonMaterial color="#8a6c4a" />}
			/>
			<OutlinedMesh
				position={[0, 0.16, 0.09]}
				castShadow={false}
				receiveShadow={false}
				outlined={outlinesEnabled && active}
				geometryNode={<sphereGeometry args={[0.11, 12, 12]} />}
				materialNode={
					<meshToonMaterial
						color={active ? "#ffe7ba" : memory ? "#988872" : "#6e6254"}
						emissive={active ? "#ffd89a" : memory ? "#8e7b64" : "#000000"}
						emissiveIntensity={active ? 2.13 : memory ? 0.12 : 0}
					/>
				}
			/>
			{active && allowRealtimeLight ? (
				<pointLight
					color="#ffd7a1"
					intensity={2.6}
					distance={14.2}
					decay={2}
					position={[0, 0.1, 0.46]}
				/>
			) : null}
		</group>
	);
}

export function LightingLayer({
	layout,
	areaInfo,
	currentArea,
	fogByCell,
	forceAllActive = false,
	spectatorRevealedAreas = null,
	outlinesEnabled = true,
}: {
	layout: MapLayout;
	areaInfo: AreaInfo;
	currentArea: string;
	fogByCell: Map<string, FogState>;
	forceAllActive?: boolean;
	spectatorRevealedAreas?: ReadonlySet<string> | null;
	outlinesEnabled?: boolean;
}) {
	const fixtures = useMemo(() => buildFixtures(layout, areaInfo), [areaInfo, layout]);
	const spectatorMode = spectatorRevealedAreas !== null;

	return (
		<group>
			{fixtures.map((fixture, index) => {
				const cellKey =
					fixture.kind === "corridor"
						? `${Math.round(fixture.x / CELL_SIZE)},${Math.round(fixture.z / CELL_SIZE)}`
						: `${Math.round(fixture.x / CELL_SIZE)},${Math.round(fixture.z / CELL_SIZE)}`;
				const fog = fogByCell.get(cellKey) ?? "hidden";
				const isSpectatorRevealed = spectatorRevealedAreas?.has(fixture.area) ?? false;
				const isVisible = fog !== "hidden" || forceAllActive || isSpectatorRevealed;
				const active = forceAllActive || fixture.area === currentArea || isSpectatorRevealed;
				const mode: "off" | "memory" | "active" =
					!isVisible ? "off" : active ? "active" : fog === "explored" ? "memory" : "off";
				// Avoid cumulative shader/light-cost spikes while spectator reveal progresses.
				// Spectator still gets progressive reveal via emissive fixtures + fog visibility.
				const allowRealtimeLight = !spectatorMode;
				return fixture.kind === "corridor" ? (
					<CorridorFixture
						key={`${fixture.area}-${index}`}
						fixture={fixture}
						mode={mode}
						outlinesEnabled={outlinesEnabled}
						allowRealtimeLight={allowRealtimeLight}
						visible={isVisible}
					/>
				) : (
					<WallFixture
						key={`${fixture.area}-${index}`}
						fixture={fixture}
						mode={mode}
						outlinesEnabled={outlinesEnabled}
						allowRealtimeLight={allowRealtimeLight}
						visible={isVisible}
					/>
				);
			})}
		</group>
	);
}
