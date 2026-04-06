import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
	CELL_SIZE,
	ROOM_HEIGHT,
	canonicalEdgeKey,
	computeDecorIds,
	layoutOccupancy,
	layoutRoomMap,
	type MapCell,
	type MapLayout,
} from "@vibejam/shared";
import type { FogState } from "./GameScene";
import {
	Color,
	InstancedMesh,
	Matrix4,
	MeshStandardMaterial,
	Quaternion,
	Vector2,
	Vector3,
} from "three";
import { useEmbassyTextures, type DecorTextures } from "./decor";

type WallSegment = {
	x: number;
	y: number;
	z: number;
	rotY: number;
	style: number;
	fog: FogState;
	active: boolean;
	cutout: boolean;
};

const SOUTH_WALL_CUTOUT_RADIUS_WORLD = CELL_SIZE * 0.68;
const SOUTH_WALL_CUTOUT_SOFTNESS = 36;
const PLAYER_CONE_TIP_OFFSET_Y = 1.3;

function fogTint(fog: FogState): string {
	return fog === "visible" ? "#ffffff" : "#67707a";
}

function SouthWallCutoutMaterial({
	texture,
	fog,
	playerPositionRef,
}: {
	texture: DecorTextures["walls"][number];
	fog: FogState;
	playerPositionRef: MutableRefObject<Vector3>;
}) {
	const materialRef = useRef<MeshStandardMaterial>(null);
	const { camera, size, gl } = useThree();
	const uniforms = useMemo(
		() => ({
			cutoutCenter: { value: new Vector2(0, 0) },
			cutoutRadius: { value: 0 },
			cutoutSoftness: { value: SOUTH_WALL_CUTOUT_SOFTNESS },
			screenSize: { value: new Vector2(size.width, size.height) },
		}),
		[size.height, size.width],
	);
	const projectedPlayer = useMemo(() => new Vector3(), []);
	const projectedRadiusPoint = useMemo(() => new Vector3(), []);
	const cutoutCenterWorld = useMemo(() => new Vector3(), []);

	useFrame(() => {
		const pixelWidth = size.width * gl.getPixelRatio();
		const pixelHeight = size.height * gl.getPixelRatio();
		cutoutCenterWorld.copy(playerPositionRef.current);
		cutoutCenterWorld.y += PLAYER_CONE_TIP_OFFSET_Y;
		projectedPlayer.copy(cutoutCenterWorld).project(camera);
		projectedRadiusPoint
			.copy(cutoutCenterWorld)
			.add(new Vector3(SOUTH_WALL_CUTOUT_RADIUS_WORLD, 0, 0))
			.project(camera);
		uniforms.cutoutCenter.value.set(
			(projectedPlayer.x * 0.5 + 0.5) * pixelWidth,
			(projectedPlayer.y * 0.5 + 0.5) * pixelHeight,
		);
		uniforms.cutoutRadius.value = Math.max(
			48,
			Math.abs((projectedRadiusPoint.x - projectedPlayer.x) * 0.5 * pixelWidth),
		);
		uniforms.screenSize.value.set(pixelWidth, pixelHeight);
	});

	return (
		<meshStandardMaterial
			ref={materialRef}
			map={texture}
			color={new Color(fogTint(fog))}
			roughness={0.92}
			metalness={0.02}
			onBeforeCompile={(shader) => {
				shader.uniforms.cutoutCenter = uniforms.cutoutCenter;
				shader.uniforms.cutoutRadius = uniforms.cutoutRadius;
				shader.uniforms.cutoutSoftness = uniforms.cutoutSoftness;
				shader.vertexShader = shader.vertexShader
					.replace(
						"#include <common>",
						"#include <common>",
					);
				shader.fragmentShader = shader.fragmentShader
					.replace(
						"#include <common>",
						"#include <common>\nuniform vec2 cutoutCenter;\nuniform float cutoutRadius;\nuniform float cutoutSoftness;\nuniform vec2 screenSize;",
					)
					.replace(
						"#include <clipping_planes_fragment>",
						"#include <clipping_planes_fragment>\nvec2 cutoutCoord = vec2( gl_FragCoord.x, gl_FragCoord.y );\nfloat cutoutDist = distance( cutoutCoord, cutoutCenter );\nfloat cutoutInnerRadius = max( 0.0, cutoutRadius - cutoutSoftness );\nif ( cutoutDist <= cutoutInnerRadius ) discard;\nfloat cutoutVisibility = smoothstep( cutoutInnerRadius, cutoutRadius, cutoutDist );\ncutoutVisibility *= cutoutVisibility;\nif ( rand( gl_FragCoord.xy ) > cutoutVisibility ) discard;",
					);
			}}
			customProgramCacheKey={() => "south-wall-cutout-v1"}
		/>
	);
}

function FloorBatch({ cells, texture, fog }: { cells: MapCell[]; texture: DecorTextures["floors"][number]; fog: FogState }) {
	const ref = useRef<InstancedMesh>(null);
	const matrix = useMemo(() => new Matrix4(), []);

	useLayoutEffect(() => {
		const mesh = ref.current;
		if (!mesh) {
			return;
		}
		for (let i = 0; i < cells.length; i++) {
			const cell = cells[i]!;
			matrix.makeTranslation(cell.ix * CELL_SIZE, 0.04, cell.iz * CELL_SIZE);
			mesh.setMatrixAt(i, matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
	}, [cells, matrix]);

	if (cells.length === 0) {
		return null;
	}

	return (
		<instancedMesh ref={ref} args={[undefined, undefined, cells.length]} receiveShadow castShadow>
			<boxGeometry args={[CELL_SIZE, 0.08, CELL_SIZE]} />
			<meshStandardMaterial map={texture} color={fogTint(fog)} roughness={0.9} metalness={0.02} />
		</instancedMesh>
	);
}

function InstancedFloors({ layout, textures, fogByCell }: { layout: MapLayout; textures: DecorTextures; fogByCell: Map<string, FogState> }) {
	const decorIds = useMemo(() => computeDecorIds(layout), [layout]);
	const groups = useMemo(() => {
		const buckets = new Map<string, { style: number; fog: FogState; cells: MapCell[] }>();
		for (const cell of layout.cells) {
			const fog = fogByCell.get(`${cell.ix},${cell.iz}`) ?? "hidden";
			if (fog === "hidden") {
				continue;
			}
			const style = decorIds.floorStyleByCell.get(`${cell.ix},${cell.iz}`) ?? 0;
			const key = `${style}:${fog}`;
			const bucket = buckets.get(key) ?? { style, fog, cells: [] };
			bucket.cells.push(cell);
			buckets.set(key, bucket);
		}
		return [...buckets.values()].sort((a, b) => a.style - b.style || a.fog.localeCompare(b.fog));
	}, [decorIds.floorStyleByCell, fogByCell, layout.cells]);

	return (
		<>
			{groups.map(({ style, fog, cells }) => (
				<FloorBatch
					key={`floor-${style}-${fog}`}
					cells={cells}
					texture={textures.floors[style]!}
					fog={fog}
				/>
			))}
		</>
	);
}

function WallBatch({
	segments,
	texture,
	height = ROOM_HEIGHT,
	thickness = 0.14,
	fog,
	playerPositionRef,
}: {
	segments: WallSegment[];
	texture: DecorTextures["walls"][number];
	height?: number;
	thickness?: number;
	fog: FogState;
	playerPositionRef?: MutableRefObject<Vector3>;
}) {
	const ref = useRef<InstancedMesh>(null);
	const matrix = useMemo(() => new Matrix4(), []);
	const quat = useMemo(() => new Quaternion(), []);
	const pos = useMemo(() => new Vector3(), []);
	const scale = useMemo(() => new Vector3(1, 1, 1), []);
	const yAxis = useMemo(() => new Vector3(0, 1, 0), []);

	useLayoutEffect(() => {
		const mesh = ref.current;
		if (!mesh) {
			return;
		}
		for (let i = 0; i < segments.length; i++) {
			const segment = segments[i]!;
			pos.set(segment.x, segment.y, segment.z);
			quat.setFromAxisAngle(yAxis, segment.rotY);
			matrix.compose(pos, quat, scale);
			mesh.setMatrixAt(i, matrix);
		}
		mesh.instanceMatrix.needsUpdate = true;
	}, [matrix, pos, quat, scale, segments, yAxis]);

	if (segments.length === 0) {
		return null;
	}

	return (
		<instancedMesh ref={ref} args={[undefined, undefined, segments.length]} castShadow receiveShadow>
			<boxGeometry args={[thickness, height, CELL_SIZE]} />
			{playerPositionRef ? (
				<SouthWallCutoutMaterial texture={texture} fog={fog} playerPositionRef={playerPositionRef} />
			) : (
				<meshStandardMaterial map={texture} color={fogTint(fog)} roughness={0.92} metalness={0.02} />
			)}
		</instancedMesh>
	);
}

function InstancedWalls({
	layout,
	textures,
	fogByCell,
	areaInfo,
	currentArea,
	playerPositionRef,
}: {
	layout: MapLayout;
	textures: DecorTextures;
	fogByCell: Map<string, FogState>;
	areaInfo: { labelByCell: Map<string, string> };
	currentArea: string;
	playerPositionRef: MutableRefObject<Vector3>;
}) {
	const occ = useMemo(() => layoutOccupancy(layout), [layout]);
	const rooms = useMemo(() => layoutRoomMap(layout), [layout]);
	const doors = useMemo(() => new Set(layout.doorEdgeKeys), [layout.doorEdgeKeys]);
	const decorIds = useMemo(() => computeDecorIds(layout), [layout]);

	const groups = useMemo(() => {
		const buckets = new Map<string, { bucketKey: string; style: number; fog: FogState; active: boolean; cutout: boolean; segments: WallSegment[] }>();
		const h = ROOM_HEIGHT / 2;
		const dirs: [number, number][] = [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		];

		const needsWall = (ix1: number, iz1: number, ix2: number, iz2: number) => {
			const k1 = `${ix1},${iz1}`;
			const k2 = `${ix2},${iz2}`;
			const o1 = occ.has(k1);
			const o2 = occ.has(k2);
			if (!o1 && !o2) {
				return false;
			}
			if (o1 !== o2) {
				return true;
			}
			const r1 = rooms.get(k1)!;
			const r2 = rooms.get(k2)!;
			if (r1 === r2) {
				return false;
			}
			return !doors.has(canonicalEdgeKey(ix1, iz1, ix2, iz2));
		};

		const shouldEmit = (ix: number, iz: number, nx: number, nz: number) => {
			const neighborKey = `${nx},${nz}`;
			if (!occ.has(neighborKey)) {
				return true;
			}
			return ix < nx || (ix === nx && iz < nz);
		};

		const styleForWall = (ix: number, iz: number, nx: number, nz: number) => {
			const currentKey = `${ix},${iz}`;
			const neighborKey = `${nx},${nz}`;
			const currentStyle = decorIds.wallStyleByCell.get(currentKey) ?? 0;
			const neighborStyle = decorIds.wallStyleByCell.get(neighborKey);
			const currentRoom = rooms.get(currentKey);
			const neighborRoom = rooms.get(neighborKey);
			if (currentRoom === -1 && neighborRoom !== -1) {
				return currentStyle;
			}
			if (neighborRoom === -1 && currentRoom !== -1) {
				return neighborStyle ?? currentStyle;
			}
			return currentStyle;
		};

		for (const cell of layout.cells) {
			for (const [dx, dz] of dirs) {
				const nx = cell.ix + dx;
				const nz = cell.iz + dz;
				if (!needsWall(cell.ix, cell.iz, nx, nz) || !shouldEmit(cell.ix, cell.iz, nx, nz)) {
					continue;
				}

				const wx = cell.ix * CELL_SIZE;
				const wz = cell.iz * CELL_SIZE;
				const style = styleForWall(cell.ix, cell.iz, nx, nz);
				const currentFog = fogByCell.get(`${cell.ix},${cell.iz}`) ?? "hidden";
				const neighborFog = fogByCell.get(`${nx},${nz}`) ?? "hidden";
				const fog: FogState = currentFog === "visible" || neighborFog === "visible" ? "visible" : currentFog === "explored" || neighborFog === "explored" ? "explored" : "hidden";
				if (fog === "hidden") {
					continue;
				}
				const currentAreaLabel = areaInfo.labelByCell.get(`${cell.ix},${cell.iz}`);
				const neighborAreaLabel = areaInfo.labelByCell.get(`${nx},${nz}`);
				const active = currentAreaLabel === currentArea || neighborAreaLabel === currentArea;
				let segment: WallSegment | null = null;
				if (dx === 1) {
					segment = { x: wx + CELL_SIZE / 2, y: h, z: wz, rotY: 0, style, fog, active, cutout: false };
				} else if (dx === -1) {
					segment = { x: wx - CELL_SIZE / 2, y: h, z: wz, rotY: 0, style, fog, active, cutout: false };
				} else if (dz === 1) {
					segment = {
						x: wx,
						y: h,
						z: wz + CELL_SIZE / 2,
						rotY: Math.PI / 2,
						style,
						fog,
						active,
						cutout: currentAreaLabel === currentArea,
					};
				} else if (dz === -1) {
					segment = { x: wx, y: h, z: wz - CELL_SIZE / 2, rotY: Math.PI / 2, style, fog, active, cutout: false };
				}
				if (!segment) {
					continue;
				}
				const key = `${style}:${fog}:${active ? "active" : "inactive"}:${segment.cutout ? "cutout" : "solid"}`;
				const bucket = buckets.get(key) ?? { bucketKey: key, style, fog, active, cutout: segment.cutout, segments: [] as WallSegment[] };
				bucket.segments.push(segment);
				buckets.set(key, bucket);
			}
		}

		return [...buckets.values()].sort(
			(a, b) => a.style - b.style || a.fog.localeCompare(b.fog) || Number(a.active) - Number(b.active) || Number(a.cutout) - Number(b.cutout),
		);
	}, [areaInfo.labelByCell, currentArea, decorIds.wallStyleByCell, doors, fogByCell, layout.cells, occ, rooms]);

	return (
		<>
			{groups.map(({ bucketKey, style, fog, segments, cutout }) => (
				<WallBatch
					key={`wall-${bucketKey}`}
					segments={segments}
					texture={textures.walls[style]!}
					fog={fog}
					playerPositionRef={cutout ? playerPositionRef : undefined}
				/>
			))}
			{groups.map(({ bucketKey, style, fog, segments, cutout }) => (
				<group key={`wall-cap-${bucketKey}`} position={[0, ROOM_HEIGHT / 2 + 0.03, 0]}>
					<WallBatch
						segments={segments}
						texture={textures.wallCaps[style]!}
						height={0.06}
						thickness={0.145}
						fog={fog}
						playerPositionRef={cutout ? playerPositionRef : undefined}
					/>
				</group>
			))}
		</>
	);
}

export function MapLevel({
	layout,
	fogByCell,
	areaInfo,
	currentArea,
	playerPositionRef,
}: {
	layout: MapLayout;
	fogByCell: Map<string, FogState>;
	areaInfo: { labelByCell: Map<string, string> };
	currentArea: string;
	playerPositionRef: MutableRefObject<Vector3>;
}) {
	const textures = useEmbassyTextures(layout.seed);
	return (
		<group>
			<InstancedFloors layout={layout} textures={textures} fogByCell={fogByCell} />
			<InstancedWalls
				layout={layout}
				textures={textures}
				fogByCell={fogByCell}
				areaInfo={areaInfo}
				currentArea={currentArea}
				playerPositionRef={playerPositionRef}
			/>
		</group>
	);
}
