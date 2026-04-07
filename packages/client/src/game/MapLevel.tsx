import { useMemo, useRef, type MutableRefObject } from "react";
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
	DoubleSide,
	MeshBasicMaterial,
	MeshToonMaterial,
	Vector2,
	Vector3,
	type BufferGeometry,
	BoxGeometry,
} from "three";
import { useEmbassyTextures, type DecorTextures } from "./decor";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createBackfaceOutlineMaterial } from "./toonOutline/outlineMaterial";

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
const OUTLINE_COLOR = "#000000";
const OUTLINE_THICKNESS = 0.028;

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
	const materialRef = useRef<MeshToonMaterial>(null);
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
		<meshToonMaterial
			ref={materialRef}
			map={texture}
			color={new Color(fogTint(fog))}
			side={DoubleSide}
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

function SouthWallCutoutOutlineMaterial({
	fog,
	playerPositionRef,
	thickness = OUTLINE_THICKNESS,
}: {
	fog: FogState;
	playerPositionRef: MutableRefObject<Vector3>;
	thickness?: number;
}) {
	const materialRef = useRef<MeshBasicMaterial>(null);
	const { camera, size, gl } = useThree();
	const uniforms = useMemo(
		() => ({
			cutoutCenter: { value: new Vector2(0, 0) },
			cutoutRadius: { value: 0 },
			cutoutSoftness: { value: SOUTH_WALL_CUTOUT_SOFTNESS },
			screenSize: { value: new Vector2(size.width, size.height) },
			outlineThickness: { value: thickness },
		}),
		[size.height, size.width, thickness],
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
		projectedRadiusPoint.copy(cutoutCenterWorld).add(new Vector3(SOUTH_WALL_CUTOUT_RADIUS_WORLD, 0, 0)).project(camera);
		uniforms.cutoutCenter.value.set((projectedPlayer.x * 0.5 + 0.5) * pixelWidth, (projectedPlayer.y * 0.5 + 0.5) * pixelHeight);
		uniforms.cutoutRadius.value = Math.max(48, Math.abs((projectedRadiusPoint.x - projectedPlayer.x) * 0.5 * pixelWidth));
		uniforms.screenSize.value.set(pixelWidth, pixelHeight);
	});

	return (
		<meshBasicMaterial
			ref={materialRef}
			color={new Color(OUTLINE_COLOR)}
			side={DoubleSide}
			onBeforeCompile={(shader) => {
				shader.uniforms.cutoutCenter = uniforms.cutoutCenter;
				shader.uniforms.cutoutRadius = uniforms.cutoutRadius;
				shader.uniforms.cutoutSoftness = uniforms.cutoutSoftness;
				shader.uniforms.screenSize = uniforms.screenSize;
				shader.uniforms.outlineThickness = uniforms.outlineThickness;

				shader.vertexShader = shader.vertexShader
					.replace("#include <common>", "#include <common>\nuniform float outlineThickness;")
					.replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += normal * outlineThickness;");

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
			customProgramCacheKey={() => `south-wall-cutout-outline-v1:${fog}:${String(thickness)}`}
		/>
	);
}

function boxAt({
	w,
	h,
	d,
	x,
	y,
	z,
}: {
	w: number;
	h: number;
	d: number;
	x: number;
	y: number;
	z: number;
}): BufferGeometry {
	const g = new BoxGeometry(w, h, d);
	g.translate(x, y, z);
	return g;
}

function MergedToonMesh({
	geometry,
	materialNode,
	outlineThickness = OUTLINE_THICKNESS,
	outlined = true,
	outlineMaterialNode,
}: {
	geometry: BufferGeometry;
	materialNode: React.ReactNode;
	outlineThickness?: number;
	outlined?: boolean;
	outlineMaterialNode?: React.ReactNode;
}) {
	const outlineMaterial = useMemo(
		() => createBackfaceOutlineMaterial({ color: OUTLINE_COLOR, thickness: outlineThickness }),
		[outlineThickness],
	);

	return (
		<group>
			{outlined ? (
				outlineMaterialNode ? (
					<mesh geometry={geometry} castShadow receiveShadow>
						{outlineMaterialNode}
					</mesh>
				) : (
					<mesh geometry={geometry} material={outlineMaterial} castShadow receiveShadow />
				)
			) : null}
			<mesh geometry={geometry} castShadow receiveShadow>
				{materialNode}
			</mesh>
		</group>
	);
}

function MergedFloors({
	layout,
	textures,
	fogByCell,
	areaInfo,
	currentArea,
	outlinesEnabled,
}: {
	layout: MapLayout;
	textures: DecorTextures;
	fogByCell: Map<string, FogState>;
	areaInfo: { labelByCell: Map<string, string> };
	currentArea: string;
	outlinesEnabled: boolean;
}) {
	const decorIds = useMemo(() => computeDecorIds(layout), [layout]);
	const floors = useMemo(() => {
		// Requirement: treat each room and each connected corridor as one mesh (per style/fog bucket).
		// Corridors are `roomId = -1` and may exist as multiple disconnected components.
		const hallKeySet = new Set<string>();
		const cellByKey = new Map<string, MapCell>();
		for (const cell of layout.cells) {
			const key = `${cell.ix},${cell.iz}`;
			cellByKey.set(key, cell);
			if (cell.roomId === -1) {
				hallKeySet.add(key);
			}
		}

		const corridorComponentByCell = new Map<string, number>();
		let nextCorridorId = 1;
		const dirs: [number, number][] = [
			[1, 0],
			[-1, 0],
			[0, 1],
			[0, -1],
		];
		for (const k of hallKeySet) {
			if (corridorComponentByCell.has(k)) {
				continue;
			}
			const queue = [k];
			corridorComponentByCell.set(k, nextCorridorId);
			for (let i = 0; i < queue.length; i++) {
				const current = queue[i]!;
				const [ix, iz] = current.split(",").map(Number);
				for (const [dx, dz] of dirs) {
					const nk = `${ix + dx},${iz + dz}`;
					if (!hallKeySet.has(nk) || corridorComponentByCell.has(nk)) {
						continue;
					}
					corridorComponentByCell.set(nk, nextCorridorId);
					queue.push(nk);
				}
			}
			nextCorridorId++;
		}

		type FloorMesh = { key: string; fog: FogState; style: number; active: boolean; geometry: BufferGeometry };
		const buckets = new Map<string, { fog: FogState; style: number; active: boolean; geoms: BufferGeometry[] }>();
		for (const cell of layout.cells) {
			const fog = fogByCell.get(`${cell.ix},${cell.iz}`) ?? "hidden";
			if (fog === "hidden") {
				continue;
			}
			const style = decorIds.floorStyleByCell.get(`${cell.ix},${cell.iz}`) ?? 0;
			const label = areaInfo.labelByCell.get(`${cell.ix},${cell.iz}`);
			const active = label === currentArea;
			const componentId =
				cell.roomId === -1 ? `c${corridorComponentByCell.get(`${cell.ix},${cell.iz}`) ?? 0}` : `r${cell.roomId}`;
			const bucketKey = `${componentId}:${style}:${fog}`;
			const bucket = buckets.get(bucketKey) ?? { fog, style, active: false, geoms: [] as BufferGeometry[] };
			bucket.active ||= active;
			bucket.geoms.push(boxAt({ w: CELL_SIZE, h: 0.08, d: CELL_SIZE, x: cell.ix * CELL_SIZE, y: 0.04, z: cell.iz * CELL_SIZE }));
			buckets.set(bucketKey, bucket);
		}

		const merged: FloorMesh[] = [];
		for (const [key, bucket] of buckets) {
			const geometry = mergeGeometries(bucket.geoms, false);
			if (!geometry) {
				continue;
			}
			merged.push({ key, fog: bucket.fog, style: bucket.style, active: bucket.active, geometry });
		}
		return merged.sort((a, b) => a.style - b.style || a.fog.localeCompare(b.fog) || a.key.localeCompare(b.key));
	}, [areaInfo.labelByCell, currentArea, decorIds.floorStyleByCell, fogByCell, layout.cells]);

	return (
		<>
			{floors.map((floor) => (
				<MergedToonMesh
					key={`floor-${floor.key}`}
					geometry={floor.geometry}
					outlined={outlinesEnabled && floor.active}
					materialNode={<meshToonMaterial map={textures.floors[floor.style]!} color={fogTint(floor.fog)} />}
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
	outlined,
}: {
	segments: WallSegment[];
	texture: DecorTextures["walls"][number];
	height?: number;
	thickness?: number;
	fog: FogState;
	playerPositionRef?: MutableRefObject<Vector3>;
	outlined: boolean;
}) {
	if (segments.length === 0) {
		return null;
	}

	const geometry = useMemo(() => {
		const geoms: BufferGeometry[] = [];
		for (const segment of segments) {
			const isRotated = Math.abs(segment.rotY - Math.PI / 2) < 0.0001;
			// Base geometry is a box centered at the segment pose.
			// rotY=0 => thickness in X, length in Z. rotY=pi/2 => thickness in Z, length in X.
			const g = isRotated
				? boxAt({ w: CELL_SIZE, h: height, d: thickness, x: segment.x, y: segment.y, z: segment.z })
				: boxAt({ w: thickness, h: height, d: CELL_SIZE, x: segment.x, y: segment.y, z: segment.z });
			geoms.push(g);
		}
		return mergeGeometries(geoms, false) ?? null;
	}, [height, segments, thickness]);

	if (!geometry) {
		return null;
	}

	const materialNode = playerPositionRef ? (
		<SouthWallCutoutMaterial texture={texture} fog={fog} playerPositionRef={playerPositionRef} />
	) : (
		<meshToonMaterial map={texture} color={fogTint(fog)} />
	);

	return (
		<MergedToonMesh
			geometry={geometry}
			materialNode={materialNode}
			outlined={outlined}
			outlineMaterialNode={
				playerPositionRef ? (
					<SouthWallCutoutOutlineMaterial fog={fog} playerPositionRef={playerPositionRef} />
				) : undefined
			}
		/>
	);
}

function InstancedWalls({
	layout,
	textures,
	fogByCell,
	areaInfo,
	currentArea,
	playerPositionRef,
	outlinesEnabled,
}: {
	layout: MapLayout;
	textures: DecorTextures;
	fogByCell: Map<string, FogState>;
	areaInfo: { labelByCell: Map<string, string> };
	currentArea: string;
	playerPositionRef: MutableRefObject<Vector3>;
	outlinesEnabled: boolean;
}) {
	const occ = useMemo(() => layoutOccupancy(layout), [layout]);
	const rooms = useMemo(() => layoutRoomMap(layout), [layout]);
	const doors = useMemo(() => new Set(layout.doorEdgeKeys), [layout.doorEdgeKeys]);
	const decorIds = useMemo(() => computeDecorIds(layout), [layout]);

	const groups = useMemo(() => {
		const buckets = new Map<
			string,
			{ bucketKey: string; style: number; fog: FogState; active: boolean; cutout: boolean; segments: WallSegment[] }
		>();
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

		// Collapse adjacent segments into longer boxes so outlines don't appear between them.
		// We do this by emitting "atomic" edges, then merging runs per orientation/style/fog/active/cutout.
		type Atomic = {
			orientation: "x" | "z";
			lineKey: string;
			t: number;
			style: number;
			fog: FogState;
			active: boolean;
			cutout: boolean;
		};
		const atomics: Atomic[] = [];

		for (const cell of layout.cells) {
			for (const [dx, dz] of dirs) {
				const nx = cell.ix + dx;
				const nz = cell.iz + dz;
				if (!needsWall(cell.ix, cell.iz, nx, nz) || !shouldEmit(cell.ix, cell.iz, nx, nz)) {
					continue;
				}

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
				if (dx !== 0) {
					// Wall plane at x = cellX +/- halfCell, spans one cell in Z at iz.
					const lineX = dx === 1 ? cell.ix + 0.5 : cell.ix - 0.5;
					atomics.push({
						orientation: "x",
						lineKey: `x:${lineX}`,
						t: cell.iz,
						style,
						fog,
						active,
						cutout: false,
					});
				} else if (dz !== 0) {
					// Wall plane at z = cellZ +/- halfCell, spans one cell in X at ix.
					const lineZ = dz === 1 ? cell.iz + 0.5 : cell.iz - 0.5;
					atomics.push({
						orientation: "z",
						lineKey: `z:${lineZ}`,
						t: cell.ix,
						style,
						fog,
						active,
						cutout: dz === 1 && currentAreaLabel === currentArea,
					});
				}
			}
		}

		// Group atomics by matching material/cutout + same wall line.
		const byLine = new Map<
			string,
			{ style: number; fog: FogState; active: boolean; cutout: boolean; orientation: "x" | "z"; lineKey: string; ts: number[] }
		>();
		for (const a of atomics) {
			const k = `${a.lineKey}:${a.style}:${a.fog}:${a.active ? "a" : "i"}:${a.cutout ? "c" : "s"}`;
			const bucket =
				byLine.get(k) ??
				{
					style: a.style,
					fog: a.fog,
					active: a.active,
					cutout: a.cutout,
					orientation: a.orientation,
					lineKey: a.lineKey,
					ts: [] as number[],
				};
			bucket.ts.push(a.t);
			byLine.set(k, bucket);
		}

		for (const bucket of byLine.values()) {
			bucket.ts.sort((a, b) => a - b);
			const [axis, raw] = bucket.lineKey.split(":");
			const line = Number(raw);
			const addRun = (start: number, end: number) => {
				const runLenCells = end - start + 1;
				const length = runLenCells * CELL_SIZE;
				const centerT = (start + end) / 2;
				let segment: WallSegment;
				if (axis === "x") {
					segment = {
						x: line * CELL_SIZE,
						y: h,
						z: centerT * CELL_SIZE,
						rotY: 0,
						style: bucket.style,
						fog: bucket.fog,
						active: bucket.active,
						cutout: bucket.cutout,
					};
					// Encode run length in z via a "virtual" trick: we will still build merged geometry in `WallBatch`
					// by composing cell-sized segments. To keep it simple and stable with cutouts, we keep segments atomic here.
				} else {
					segment = {
						x: centerT * CELL_SIZE,
						y: h,
						z: line * CELL_SIZE,
						rotY: Math.PI / 2,
						style: bucket.style,
						fog: bucket.fog,
						active: bucket.active,
						cutout: bucket.cutout,
					};
				}
				// For now, represent the run as multiple "cell segments" but within a single bucket; the outline seam issue
				// is addressed by merging geometry in `WallBatch` (single BufferGeometry).
				// We therefore emit one segment per cell position in the run.
				for (let t = start; t <= end; t++) {
					const s =
						axis === "x"
							? { ...segment, z: t * CELL_SIZE, rotY: 0 }
							: { ...segment, x: t * CELL_SIZE, rotY: Math.PI / 2 };
					const key = `${bucket.style}:${bucket.fog}:${bucket.active ? "active" : "inactive"}:${bucket.cutout ? "cutout" : "solid"}`;
					const outBucket =
						buckets.get(key) ??
						{ bucketKey: key, style: bucket.style, fog: bucket.fog, active: bucket.active, cutout: bucket.cutout, segments: [] as WallSegment[] };
					outBucket.segments.push(s);
					buckets.set(key, outBucket);
				}
				void length; // silence unused if TS narrows; kept for readability.
			};

			let runStart = bucket.ts[0]!;
			let prev = runStart;
			for (let i = 1; i < bucket.ts.length; i++) {
				const t = bucket.ts[i]!;
				if (t !== prev + 1) {
					addRun(runStart, prev);
					runStart = t;
				}
				prev = t;
			}
			addRun(runStart, prev);
		}

		return [...buckets.values()].sort(
			(a, b) => a.style - b.style || a.fog.localeCompare(b.fog) || Number(a.active) - Number(b.active) || Number(a.cutout) - Number(b.cutout),
		);
	}, [areaInfo.labelByCell, currentArea, decorIds.wallStyleByCell, doors, fogByCell, layout.cells, occ, rooms]);

	return (
		<>
			{groups.map(({ bucketKey, style, fog, segments, cutout, active }) => (
				<WallBatch
					key={`wall-${bucketKey}`}
					segments={segments}
					texture={textures.walls[style]!}
					fog={fog}
					playerPositionRef={cutout ? playerPositionRef : undefined}
					outlined={outlinesEnabled && active}
				/>
			))}
			{groups.map(({ bucketKey, style, fog, segments, cutout, active }) => (
				<group key={`wall-cap-${bucketKey}`} position={[0, ROOM_HEIGHT / 2 + 0.03, 0]}>
					<WallBatch
						segments={segments}
						texture={textures.wallCaps[style]!}
						height={0.06}
						thickness={0.145}
						fog={fog}
						playerPositionRef={cutout ? playerPositionRef : undefined}
						outlined={outlinesEnabled && active}
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
	outlinesEnabled = true,
}: {
	layout: MapLayout;
	fogByCell: Map<string, FogState>;
	areaInfo: { labelByCell: Map<string, string> };
	currentArea: string;
	playerPositionRef: MutableRefObject<Vector3>;
	outlinesEnabled?: boolean;
}) {
	const textures = useEmbassyTextures(layout.seed);
	return (
		<group>
			<MergedFloors
				layout={layout}
				textures={textures}
				fogByCell={fogByCell}
				areaInfo={areaInfo}
				currentArea={currentArea}
				outlinesEnabled={outlinesEnabled}
			/>
			<InstancedWalls
				layout={layout}
				textures={textures}
				fogByCell={fogByCell}
				areaInfo={areaInfo}
				currentArea={currentArea}
				playerPositionRef={playerPositionRef}
				outlinesEnabled={outlinesEnabled}
			/>
		</group>
	);
}



