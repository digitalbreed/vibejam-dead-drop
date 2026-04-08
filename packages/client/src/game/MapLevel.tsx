import { useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
	CELL_SIZE,
	ROOM_HEIGHT,
	canonicalEdgeKey,
	computeDecorIds,
	layoutOccupancy,
	layoutRoomMap,
	type MapLayout,
} from "@vibejam/shared";
import type { FogState } from "./GameScene";
import {
	Color,
	BackSide,
	DoubleSide,
	InstancedMesh,
	Matrix4,
	MeshBasicMaterial,
	MeshToonMaterial,
	Object3D,
	NearestFilter,
	Vector2,
	Vector3,
	BoxGeometry,
} from "three";
import { useEmbassyTextures, type DecorTextures } from "./decor";
import { createBackfaceOutlineMaterial } from "./toonOutline/outlineMaterial";

type FogLike = FogState | undefined;

const SOUTH_WALL_CUTOUT_RADIUS_WORLD = CELL_SIZE * 0.68;
const SOUTH_WALL_CUTOUT_SOFTNESS = 36;
const PLAYER_CONE_TIP_OFFSET_Y = 1.3;
const OUTLINE_COLOR = "#000000";
const OUTLINE_THICKNESS = 0.028;
const WALL_THICKNESS = 0.14;
const CORNER_FILLER_SIZE = WALL_THICKNESS / 2;

function fogTint(fog: FogState): string {
	return fog === "visible" ? "#ffffff" : "#67707a";
}

function mergeFog(a: FogLike, b: FogLike): FogState {
	if (a === "visible" || b === "visible") return "visible";
	if (a === "explored" || b === "explored") return "explored";
	return "hidden";
}

function nowMs() {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function isDev() {
	return typeof import.meta !== "undefined" && !!(import.meta as any).env?.DEV;
}

type CutoutUniforms = {
	cutoutCenter: { value: Vector2 };
	cutoutRadius: { value: number };
	cutoutSoftness: { value: number };
	screenSize: { value: Vector2 };
};

function useSouthWallCutoutUniforms(playerPositionRef: MutableRefObject<Vector3>) {
	const { camera, size, gl } = useThree();
	const uniforms = useMemo<CutoutUniforms>(
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
	const radiusOffset = useMemo(() => new Vector3(SOUTH_WALL_CUTOUT_RADIUS_WORLD, 0, 0), []);

	useFrame(() => {
		const pixelWidth = size.width * gl.getPixelRatio();
		const pixelHeight = size.height * gl.getPixelRatio();
		cutoutCenterWorld.copy(playerPositionRef.current);
		cutoutCenterWorld.y += PLAYER_CONE_TIP_OFFSET_Y;
		projectedPlayer.copy(cutoutCenterWorld).project(camera);
		projectedRadiusPoint.copy(cutoutCenterWorld).add(radiusOffset).project(camera);
		uniforms.cutoutCenter.value.set((projectedPlayer.x * 0.5 + 0.5) * pixelWidth, (projectedPlayer.y * 0.5 + 0.5) * pixelHeight);
		uniforms.cutoutRadius.value = Math.max(48, Math.abs((projectedRadiusPoint.x - projectedPlayer.x) * 0.5 * pixelWidth));
		uniforms.screenSize.value.set(pixelWidth, pixelHeight);
	});

	return uniforms;
}

function createCutoutToonMaterial(texture: DecorTextures["walls"][number], uniforms: CutoutUniforms) {
	const material = new MeshToonMaterial({
		map: texture,
		color: new Color("#ffffff"),
		side: DoubleSide,
		// Must stay false: BoxGeometry has no vertex colors; vertexColors:true zeros diffuse and looks black.
		vertexColors: false,
	});
	material.onBeforeCompile = (shader) => {
		shader.uniforms.cutoutCenter = uniforms.cutoutCenter;
		shader.uniforms.cutoutRadius = uniforms.cutoutRadius;
		shader.uniforms.cutoutSoftness = uniforms.cutoutSoftness;
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				"#include <common>\nuniform vec2 cutoutCenter;\nuniform float cutoutRadius;\nuniform float cutoutSoftness;\nuniform vec2 screenSize;",
			)
			.replace(
				"#include <clipping_planes_fragment>",
				"#include <clipping_planes_fragment>\nvec2 cutoutCoord = vec2( gl_FragCoord.x, gl_FragCoord.y );\nfloat cutoutDist = distance( cutoutCoord, cutoutCenter );\nfloat cutoutInnerRadius = max( 0.0, cutoutRadius - cutoutSoftness );\nif ( cutoutDist <= cutoutInnerRadius ) discard;\nfloat cutoutVisibility = smoothstep( cutoutInnerRadius, cutoutRadius, cutoutDist );\ncutoutVisibility *= cutoutVisibility;\nif ( rand( gl_FragCoord.xy ) > cutoutVisibility ) discard;",
			);
	};
	(material as any).customProgramCacheKey = () => "south-wall-cutout-instanced-v2";
	return material;
}

function createCutoutToonMaterialNoMap(uniforms: CutoutUniforms) {
	const material = new MeshToonMaterial({
		color: new Color("#ffffff"),
		side: DoubleSide,
		vertexColors: false,
	});
	material.onBeforeCompile = (shader) => {
		shader.uniforms.cutoutCenter = uniforms.cutoutCenter;
		shader.uniforms.cutoutRadius = uniforms.cutoutRadius;
		shader.uniforms.cutoutSoftness = uniforms.cutoutSoftness;
		shader.fragmentShader = shader.fragmentShader
			.replace(
				"#include <common>",
				"#include <common>\nuniform vec2 cutoutCenter;\nuniform float cutoutRadius;\nuniform float cutoutSoftness;\nuniform vec2 screenSize;",
			)
			.replace(
				"#include <clipping_planes_fragment>",
				"#include <clipping_planes_fragment>\nvec2 cutoutCoord = vec2( gl_FragCoord.x, gl_FragCoord.y );\nfloat cutoutDist = distance( cutoutCoord, cutoutCenter );\nfloat cutoutInnerRadius = max( 0.0, cutoutRadius - cutoutSoftness );\nif ( cutoutDist <= cutoutInnerRadius ) discard;\nfloat cutoutVisibility = smoothstep( cutoutInnerRadius, cutoutRadius, cutoutDist );\ncutoutVisibility *= cutoutVisibility;\nif ( rand( gl_FragCoord.xy ) > cutoutVisibility ) discard;",
			);
	};
	(material as any).customProgramCacheKey = () => "south-wall-cutout-instanced-nomap-v1";
	return material;
}

function createSolidToonMaterial() {
	return new MeshToonMaterial({
		color: new Color("#ffffff"),
		vertexColors: false,
	});
}

function createCutoutOutlineMaterial(uniforms: CutoutUniforms, thickness: number) {
	const material = new MeshBasicMaterial({
		color: new Color(OUTLINE_COLOR),
		side: BackSide,
		depthWrite: false,
	});
	material.onBeforeCompile = (shader) => {
		shader.uniforms.cutoutCenter = uniforms.cutoutCenter;
		shader.uniforms.cutoutRadius = uniforms.cutoutRadius;
		shader.uniforms.cutoutSoftness = uniforms.cutoutSoftness;
		shader.uniforms.screenSize = uniforms.screenSize;
		shader.uniforms.outlineThickness = { value: thickness };
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
	};
	(material as any).customProgramCacheKey = () => `south-wall-cutout-outline-instanced-v2:${String(thickness)}`;
	return material;
}

type FloorInstance = {
	cellKey: string;
	areaLabel: string | undefined;
	style: number;
};

function FloorsInstanced({
	layout,
	textures,
	fogByCell,
	areaInfo,
	currentArea,
	forceAllOutlined,
	outlinesEnabled,
}: {
	layout: MapLayout;
	textures: DecorTextures;
	fogByCell: Map<string, FogState>;
	areaInfo: { labelByCell: Map<string, string> };
	currentArea: string;
	forceAllOutlined: boolean;
	outlinesEnabled: boolean;
}) {
	const decorIds = useMemo(() => computeDecorIds(layout), [layout]);

	const unitBox = useMemo(() => new BoxGeometry(1, 1, 1), []);
	const baseMatrixByCellKey = useMemo(() => {
		const t0 = nowMs();
		const temp = new Object3D();
		const result = new Map<string, Matrix4>();
		for (const cell of layout.cells) {
			const key = `${cell.ix},${cell.iz}`;
			temp.position.set(cell.ix * CELL_SIZE, 0.04, cell.iz * CELL_SIZE);
			temp.quaternion.identity();
			temp.scale.set(CELL_SIZE, 0.08, CELL_SIZE);
			temp.updateMatrix();
			result.set(key, temp.matrix.clone());
		}
		if (isDev()) {
			const dt = nowMs() - t0;
			if (dt > 10) console.debug(`[MapLevel] floors build matrices ${dt.toFixed(1)}ms (${layout.cells.length} cells)`);
		}
		return result;
	}, [layout.cells]);

	const instancesByStyle = useMemo(() => {
		const t0 = nowMs();
		const byStyle = new Map<number, FloorInstance[]>();
		for (const cell of layout.cells) {
			const cellKey = `${cell.ix},${cell.iz}`;
			const style = decorIds.floorStyleByCell.get(cellKey) ?? 0;
			const areaLabel = areaInfo.labelByCell.get(cellKey);
			const bucket = byStyle.get(style) ?? [];
			bucket.push({ cellKey, areaLabel, style });
			byStyle.set(style, bucket);
		}
		if (isDev()) {
			const dt = nowMs() - t0;
			if (dt > 10) console.debug(`[MapLevel] floors group by style ${dt.toFixed(1)}ms`);
		}
		return byStyle;
	}, [areaInfo.labelByCell, decorIds.floorStyleByCell, layout.cells]);

	const floorMeshRefs = useRef(new Map<number, InstancedMesh>());
	const outlineMeshRefs = useRef(new Map<number, InstancedMesh>());

	const floorMaterialsByStyle = useMemo(() => {
		const materials = new Map<number, MeshToonMaterial>();
		for (const [style] of instancesByStyle) {
			const tex = textures.floors[style];
			if (!tex) continue;
			materials.set(
				style,
				new MeshToonMaterial({
					map: tex,
					color: new Color("#ffffff"),
					vertexColors: false,
				}),
			);
		}
		return materials;
	}, [instancesByStyle, textures.floors]);

	const outlineMaterial = useMemo(() => createBackfaceOutlineMaterial({ color: OUTLINE_COLOR, thickness: OUTLINE_THICKNESS }), []);

	useLayoutEffect(() => {
		const start = nowMs();
		const hiddenMatrix = new Matrix4().makeScale(0, 0, 0);
		for (const [style, instances] of instancesByStyle) {
			const floorMesh = floorMeshRefs.current.get(style);
			const outlineMesh = outlineMeshRefs.current.get(style);
			if (!floorMesh || !outlineMesh) continue;

			for (let i = 0; i < instances.length; i++) {
				const inst = instances[i]!;
				const fog = fogByCell.get(inst.cellKey) ?? "hidden";
				const base = baseMatrixByCellKey.get(inst.cellKey) ?? hiddenMatrix;
				const visible = fog !== "hidden";

				floorMesh.setMatrixAt(i, visible ? base : hiddenMatrix);
				floorMesh.setColorAt(i, new Color(fogTint(fog === "hidden" ? "explored" : fog)));

				const active = outlinesEnabled && visible && (forceAllOutlined || inst.areaLabel === currentArea);
				outlineMesh.setMatrixAt(i, active ? base : hiddenMatrix);
			}

			floorMesh.instanceMatrix.needsUpdate = true;
			(outlineMesh.instanceMatrix as any).needsUpdate = true;
			if ((floorMesh as any).instanceColor) {
				(floorMesh as any).instanceColor.needsUpdate = true;
			}
		}
		if (isDev()) {
			const elapsed = nowMs() - start;
			if (elapsed > 6) {
				console.debug(`[MapLevel] floors instanced update ${elapsed.toFixed(1)}ms`);
			}
		}
	}, [baseMatrixByCellKey, currentArea, fogByCell, forceAllOutlined, instancesByStyle, outlinesEnabled]);

	return (
		<group>
			{[...instancesByStyle.entries()].map(([style, instances]) => {
				const material = floorMaterialsByStyle.get(style);
				if (!material) return null;
				return (
					<group key={`floor-style-${style}`}>
						<instancedMesh
							ref={(mesh) => {
								if (mesh) floorMeshRefs.current.set(style, mesh);
								else floorMeshRefs.current.delete(style);
							}}
							args={[unitBox, material, instances.length]}
							frustumCulled={false}
							castShadow
							receiveShadow
						/>
						<instancedMesh
							ref={(mesh) => {
								if (mesh) outlineMeshRefs.current.set(style, mesh);
								else outlineMeshRefs.current.delete(style);
							}}
							args={[unitBox, outlineMaterial, instances.length]}
							frustumCulled={false}
							castShadow
							receiveShadow
						/>
					</group>
				);
			})}
		</group>
	);
}

type WallAtomic = {
	style: number;
	orientation: "x" | "z";
	line: number;
	startT: number;
	endT: number;
	cellKeyA: string | undefined;
	cellKeyB: string | undefined;
	areaA: string | undefined;
	areaB: string | undefined;
	cutoutArea: string | undefined;
};

type WallCornerCap = {
	x: number;
	z: number;
	offsetX: number;
	offsetZ: number;
	style: number;
	cellKeys: string[];
};

function buildWallAtomics(layout: MapLayout, areaInfo: { labelByCell: Map<string, string> }) {
	const occ = layoutOccupancy(layout);
	const rooms = layoutRoomMap(layout);
	const doors = new Set(layout.doorEdgeKeys);
	const decorIds = computeDecorIds(layout);

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
		if (!o1 && !o2) return false;
		if (o1 !== o2) return true;
		const r1 = rooms.get(k1)!;
		const r2 = rooms.get(k2)!;
		if (r1 === r2) return false;
		return !doors.has(canonicalEdgeKey(ix1, iz1, ix2, iz2));
	};

	const shouldEmit = (ix: number, iz: number, nx: number, nz: number) => {
		const neighborKey = `${nx},${nz}`;
		if (!occ.has(neighborKey)) return true;
		return ix < nx || (ix === nx && iz < nz);
	};

	const styleForWall = (ix: number, iz: number, nx: number, nz: number) => {
		const currentKey = `${ix},${iz}`;
		const neighborKey = `${nx},${nz}`;
		const currentStyle = decorIds.wallStyleByCell.get(currentKey) ?? 0;
		const neighborStyle = decorIds.wallStyleByCell.get(neighborKey);
		const currentRoom = rooms.get(currentKey);
		const neighborRoom = rooms.get(neighborKey);
		if (currentRoom === -1 && neighborRoom !== -1) return currentStyle;
		if (neighborRoom === -1 && currentRoom !== -1) return neighborStyle ?? currentStyle;
		return currentStyle;
	};

	type AtomicCellEdge = {
		style: number;
		orientation: "x" | "z";
		line: number;
		t: number;
		cellKeyA: string | undefined;
		cellKeyB: string | undefined;
		areaA: string | undefined;
		areaB: string | undefined;
		cutoutArea: string | undefined;
	};

	const atomics: AtomicCellEdge[] = [];
	for (const cell of layout.cells) {
		for (const [dx, dz] of dirs) {
			const nx = cell.ix + dx;
			const nz = cell.iz + dz;
			if (!needsWall(cell.ix, cell.iz, nx, nz) || !shouldEmit(cell.ix, cell.iz, nx, nz)) continue;

			const cellKeyA = `${cell.ix},${cell.iz}`;
			const cellKeyB = occ.has(`${nx},${nz}`) ? `${nx},${nz}` : undefined;
			const areaA = areaInfo.labelByCell.get(cellKeyA);
			const areaB = cellKeyB ? areaInfo.labelByCell.get(cellKeyB) : undefined;
			const style = styleForWall(cell.ix, cell.iz, nx, nz);

			if (dx !== 0) {
				const line = dx === 1 ? cell.ix + 0.5 : cell.ix - 0.5;
				atomics.push({
					style,
					orientation: "x",
					line,
					t: cell.iz,
					cellKeyA,
					cellKeyB,
					areaA,
					areaB,
					cutoutArea: undefined,
				});
			} else if (dz !== 0) {
				const line = dz === 1 ? cell.iz + 0.5 : cell.iz - 0.5;
				// Only the south wall (dz === 1) of a cell gets the cutout when that cell's area is active.
				const cutoutArea = dz === 1 ? areaA : undefined;
				atomics.push({
					style,
					orientation: "z",
					line,
					t: cell.ix,
					cellKeyA,
					cellKeyB,
					areaA,
					areaB,
					cutoutArea,
				});
			}
		}
	}

	// Collapse contiguous t runs on the same line, same style, and same metadata so outlines don’t seam between pieces.
	const byLine = new Map<string, AtomicCellEdge[]>();
	for (const a of atomics) {
		const k = `${a.orientation}:${a.line}:${a.style}:${a.cellKeyA ?? ""}:${a.cellKeyB ?? ""}:${a.cutoutArea ?? ""}`;
		const bucket = byLine.get(k) ?? [];
		bucket.push(a);
		byLine.set(k, bucket);
	}

	const runs: WallAtomic[] = [];
	for (const bucket of byLine.values()) {
		bucket.sort((a, b) => a.t - b.t);
		let runStart = bucket[0]!;
		let prevT = runStart.t;
		for (let i = 1; i < bucket.length; i++) {
			const cur = bucket[i]!;
			if (cur.t !== prevT + 1) {
				runs.push({
					style: runStart.style,
					orientation: runStart.orientation,
					line: runStart.line,
					startT: runStart.t,
					endT: prevT,
					cellKeyA: runStart.cellKeyA,
					cellKeyB: runStart.cellKeyB,
					areaA: runStart.areaA,
					areaB: runStart.areaB,
					cutoutArea: runStart.cutoutArea,
				});
				runStart = cur;
			}
			prevT = cur.t;
		}
		runs.push({
			style: runStart.style,
			orientation: runStart.orientation,
			line: runStart.line,
			startT: runStart.t,
			endT: prevT,
			cellKeyA: runStart.cellKeyA,
			cellKeyB: runStart.cellKeyB,
			areaA: runStart.areaA,
			areaB: runStart.areaB,
			cutoutArea: runStart.cutoutArea,
		});
	}

	type CornerVertexBucket = {
		xCount: number;
		zCount: number;
		xDirs: Set<number>;
		zDirs: Set<number>;
		styleVotes: Map<number, number>;
		cellKeys: Set<string>;
	};
	const vertexBuckets = new Map<string, CornerVertexBucket>();
	const vertexKey = (vx: number, vz: number) => `${vx.toFixed(3)},${vz.toFixed(3)}`;
	const doorVertexKeys = new Set<string>();
	for (const edgeKey of layout.doorEdgeKeys) {
		const [partA, partB] = edgeKey.split("|");
		if (!partA || !partB) continue;
		const [ix1, iz1] = partA.split(",").map(Number);
		const [ix2, iz2] = partB.split(",").map(Number);
		if (ix1 === ix2) {
			const line = (iz1 + iz2) / 2;
			doorVertexKeys.add(vertexKey(ix1 - 0.5, line));
			doorVertexKeys.add(vertexKey(ix1 + 0.5, line));
		} else {
			const line = (ix1 + ix2) / 2;
			doorVertexKeys.add(vertexKey(line, iz1 - 0.5));
			doorVertexKeys.add(vertexKey(line, iz1 + 0.5));
		}
	}
	const touchVertex = (vx: number, vz: number, orientation: "x" | "z", dir: number, a: AtomicCellEdge) => {
		const key = vertexKey(vx, vz);
		const bucket = vertexBuckets.get(key) ?? {
			xCount: 0,
			zCount: 0,
			xDirs: new Set<number>(),
			zDirs: new Set<number>(),
			styleVotes: new Map<number, number>(),
			cellKeys: new Set<string>(),
		};
		if (orientation === "x") {
			bucket.xCount++;
			bucket.xDirs.add(dir);
		} else {
			bucket.zCount++;
			bucket.zDirs.add(dir);
		}
		if (a.cellKeyA) {
			bucket.cellKeys.add(a.cellKeyA);
		}
		if (a.cellKeyB) {
			bucket.cellKeys.add(a.cellKeyB);
		}
		bucket.styleVotes.set(a.style, (bucket.styleVotes.get(a.style) ?? 0) + 1);
		vertexBuckets.set(key, bucket);
	};
	for (const a of atomics) {
		if (a.orientation === "x") {
			// x-oriented edge runs along z; at start endpoint edge continues toward +z, at end toward -z.
			touchVertex(a.line, a.t - 0.5, "x", 1, a);
			touchVertex(a.line, a.t + 0.5, "x", -1, a);
		} else {
			// z-oriented edge runs along x; at start endpoint edge continues toward +x, at end toward -x.
			touchVertex(a.t - 0.5, a.line, "z", 1, a);
			touchVertex(a.t + 0.5, a.line, "z", -1, a);
		}
	}

	const corners: WallCornerCap[] = [];
	for (const [key, bucket] of vertexBuckets) {
		if (bucket.xCount !== 1 || bucket.zCount !== 1) continue;
		if (doorVertexKeys.has(key)) continue;
		const xDir = bucket.xDirs.values().next().value as number | undefined;
		const zDir = bucket.zDirs.values().next().value as number | undefined;
		if ((xDir !== 1 && xDir !== -1) || (zDir !== 1 && zDir !== -1)) continue;
		let style = 0;
		let bestVotes = -1;
		for (const [candidateStyle, votes] of bucket.styleVotes) {
			if (votes > bestVotes || (votes === bestVotes && candidateStyle < style)) {
				style = candidateStyle;
				bestVotes = votes;
			}
		}
		const [vx, vz] = key.split(",").map(Number);
		corners.push({
			x: vx * CELL_SIZE,
			z: vz * CELL_SIZE,
			// Fill only the missing quadrant (opposite of the two wall directions).
			offsetX: (-zDir * CORNER_FILLER_SIZE) / 2,
			offsetZ: (-xDir * CORNER_FILLER_SIZE) / 2,
			style,
			cellKeys: [...bucket.cellKeys],
		});
	}

	return { runs, corners, decorIds };
}

function WallsInstanced({
	layout,
	textures,
	fogByCell,
	areaInfo,
	currentArea,
	playerPositionRef,
	forceAllOutlined,
	outlinesEnabled,
}: {
	layout: MapLayout;
	textures: DecorTextures;
	fogByCell: Map<string, FogState>;
	areaInfo: { labelByCell: Map<string, string> };
	currentArea: string;
	playerPositionRef: MutableRefObject<Vector3>;
	forceAllOutlined: boolean;
	outlinesEnabled: boolean;
}) {
	const { runs, corners } = useMemo(() => {
		const t0 = nowMs();
		const built = buildWallAtomics(layout, areaInfo);
		if (isDev()) {
			const dt = nowMs() - t0;
			if (dt > 12) console.debug(`[MapLevel] walls build atomics ${dt.toFixed(1)}ms (${built.runs.length} runs)`);
		}
		return built;
	}, [areaInfo, layout]);
	const cutoutUniforms = useSouthWallCutoutUniforms(playerPositionRef);

	const unitBox = useMemo(() => new BoxGeometry(1, 1, 1), []);
	const baseMatrixByRun = useMemo(() => {
		const temp = new Object3D();
		const result: Matrix4[] = [];
		for (const r of runs) {
			const runLenCells = r.endT - r.startT + 1;
			const length = runLenCells * CELL_SIZE;
			const centerT = (r.startT + r.endT) / 2;
			if (r.orientation === "x") {
				temp.position.set(r.line * CELL_SIZE, ROOM_HEIGHT / 2, centerT * CELL_SIZE);
				temp.quaternion.identity();
				temp.scale.set(WALL_THICKNESS, ROOM_HEIGHT, length);
			} else {
				temp.position.set(centerT * CELL_SIZE, ROOM_HEIGHT / 2, r.line * CELL_SIZE);
				temp.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
				temp.scale.set(WALL_THICKNESS, ROOM_HEIGHT, length);
			}
			temp.updateMatrix();
			result.push(temp.matrix.clone());
		}
		return result;
	}, [runs]);
	const cornerBaseMatrices = useMemo(() => {
		const temp = new Object3D();
		const result: Matrix4[] = [];
		for (const c of corners) {
			temp.position.set(c.x + c.offsetX, ROOM_HEIGHT / 2, c.z + c.offsetZ);
			temp.quaternion.identity();
			temp.scale.set(CORNER_FILLER_SIZE, ROOM_HEIGHT, CORNER_FILLER_SIZE);
			temp.updateMatrix();
			result.push(temp.matrix.clone());
		}
		return result;
	}, [corners]);
	const cornersByStyle = useMemo(() => {
		const grouped = new Map<number, { indices: number[] }>();
		for (let i = 0; i < corners.length; i++) {
			const c = corners[i]!;
			const bucket = grouped.get(c.style) ?? { indices: [] as number[] };
			bucket.indices.push(i);
			grouped.set(c.style, bucket);
		}
		return grouped;
	}, [corners]);

	const runsByStyle = useMemo(() => {
		const map = new Map<number, { indices: number[] }>();
		for (let i = 0; i < runs.length; i++) {
			const r = runs[i]!;
			const bucket = map.get(r.style) ?? { indices: [] as number[] };
			bucket.indices.push(i);
			map.set(r.style, bucket);
		}
		return map;
	}, [runs]);

	const outlineMaterial = useMemo(() => createBackfaceOutlineMaterial({ color: OUTLINE_COLOR, thickness: OUTLINE_THICKNESS }), []);
	const cutoutOutlineMaterial = useMemo(() => createCutoutOutlineMaterial(cutoutUniforms, OUTLINE_THICKNESS), [cutoutUniforms]);

	const wallMaterialsByStyle = useMemo(() => {
		const materials = new Map<number, MeshToonMaterial | MeshToonMaterial[]>();
		for (const [style] of runsByStyle) {
			const tex = textures.walls[style];
			if (!tex) continue;
			const side = new MeshToonMaterial({
				map: tex,
				color: new Color("#ffffff"),
				vertexColors: false,
			});
			// BoxGeometry face material order: +x, -x, +y(top), -y(bottom), +z, -z
			const top = createSolidToonMaterial();
			materials.set(style, [side, side, top, side, side, side]);
		}
		return materials;
	}, [runsByStyle, textures.walls]);

	const wallCutoutMaterialsByStyle = useMemo(() => {
		const materials = new Map<number, MeshToonMaterial | MeshToonMaterial[]>();
		for (const [style] of runsByStyle) {
			const tex = textures.walls[style];
			if (!tex) continue;
			const side = createCutoutToonMaterial(tex, cutoutUniforms);
			const top = createCutoutToonMaterialNoMap(cutoutUniforms);
			materials.set(style, [side, side, top, side, side, side]);
		}
		return materials;
	}, [cutoutUniforms, runsByStyle, textures.walls]);

	const normalWallRefs = useRef(new Map<number, InstancedMesh>());
	const cutoutWallRefs = useRef(new Map<number, InstancedMesh>());
	const normalWallOutlineRefs = useRef(new Map<number, InstancedMesh>());
	const cutoutWallOutlineRefs = useRef(new Map<number, InstancedMesh>());
	const cornerFillerRefs = useRef(new Map<number, InstancedMesh>());
	const cornerFillerOutlineRefs = useRef(new Map<number, InstancedMesh>());
	const cornerFillerMaterialsByStyle = useMemo(() => {
		const materials = new Map<number, MeshToonMaterial | MeshToonMaterial[]>();
		for (const [style] of cornersByStyle) {
			const tex = textures.walls[style];
			if (!tex) continue;
			const fillerSideTex = tex.clone();
			fillerSideTex.generateMipmaps = false;
			fillerSideTex.minFilter = NearestFilter;
			fillerSideTex.magFilter = NearestFilter;
			fillerSideTex.needsUpdate = true;
			const side = new MeshToonMaterial({
				map: fillerSideTex,
				color: new Color("#ffffff"),
				vertexColors: false,
			});
			const top = createSolidToonMaterial();
			materials.set(
				style,
				// Match wall face assignment so filler tops don't show wall UV projection.
				[side, side, top, top, side, side],
			);
		}
		return materials;
	}, [cornersByStyle, textures.walls]);

	const hiddenMatrix = useMemo(() => new Matrix4().makeScale(0, 0, 0), []);

	useLayoutEffect(() => {
		const start = nowMs();
		const tempColor = new Color();
		for (const [style, { indices }] of runsByStyle) {
			const wall = normalWallRefs.current.get(style);
			const wallCut = cutoutWallRefs.current.get(style);
			const wallO = normalWallOutlineRefs.current.get(style);
			const wallCutO = cutoutWallOutlineRefs.current.get(style);
			if (!wall || !wallCut || !wallO || !wallCutO) continue;

			for (let localIndex = 0; localIndex < indices.length; localIndex++) {
				const runIndex = indices[localIndex]!;
				const r = runs[runIndex]!;
				const fog = mergeFog(fogByCell.get(r.cellKeyA ?? ""), r.cellKeyB ? fogByCell.get(r.cellKeyB) : "hidden");
				const visible = fog !== "hidden";
				const active =
					outlinesEnabled && visible && (forceAllOutlined || r.areaA === currentArea || r.areaB === currentArea);
				const useCutout = visible && r.cutoutArea === currentArea;
				const wallBase = baseMatrixByRun[runIndex] ?? hiddenMatrix;

				// Color is per-instance; keep material base color white.
				tempColor.set(fogTint(fog === "hidden" ? "explored" : fog));

				// Normal vs cutout is a matrix toggle between two parallel instanced meshes.
				wall.setMatrixAt(localIndex, !useCutout && visible ? wallBase : hiddenMatrix);
				wallCut.setMatrixAt(localIndex, useCutout ? wallBase : hiddenMatrix);

				wall.setColorAt(localIndex, tempColor);
				wallCut.setColorAt(localIndex, tempColor);

				// Outline: same split for cutout vs normal.
				wallO.setMatrixAt(localIndex, active && !useCutout ? wallBase : hiddenMatrix);
				wallCutO.setMatrixAt(localIndex, active && useCutout ? wallBase : hiddenMatrix);
			}

			for (const m of [wall, wallCut, wallO, wallCutO]) {
				m.instanceMatrix.needsUpdate = true;
				if ((m as any).instanceColor) (m as any).instanceColor.needsUpdate = true;
			}
		}
		if (isDev()) {
			const elapsed = nowMs() - start;
			if (elapsed > 8) {
				console.debug(`[MapLevel] walls instanced update ${elapsed.toFixed(1)}ms`);
			}
		}
	}, [baseMatrixByRun, currentArea, fogByCell, forceAllOutlined, hiddenMatrix, outlinesEnabled, runs, runsByStyle]);

	useLayoutEffect(() => {
		const tempColor = new Color();
		for (const [style, { indices }] of cornersByStyle) {
			const mesh = cornerFillerRefs.current.get(style);
			const meshOutline = cornerFillerOutlineRefs.current.get(style);
			if (!mesh || !meshOutline) continue;
			for (let localIndex = 0; localIndex < indices.length; localIndex++) {
				const cornerIndex = indices[localIndex]!;
				const corner = corners[cornerIndex]!;
				let fog: FogState = "hidden";
				for (const cellKey of corner.cellKeys) {
					fog = mergeFog(fog, fogByCell.get(cellKey));
					if (fog === "visible") break;
				}
				const visible = fog !== "hidden";
				mesh.setMatrixAt(localIndex, visible ? cornerBaseMatrices[cornerIndex]! : hiddenMatrix);
				const active =
					outlinesEnabled &&
					visible &&
					(forceAllOutlined || corner.cellKeys.some((cellKey) => areaInfo.labelByCell.get(cellKey) === currentArea));
				meshOutline.setMatrixAt(localIndex, active ? cornerBaseMatrices[cornerIndex]! : hiddenMatrix);
				tempColor.set(fogTint(fog === "hidden" ? "explored" : fog));
				mesh.setColorAt(localIndex, tempColor);
			}
			mesh.instanceMatrix.needsUpdate = true;
			meshOutline.instanceMatrix.needsUpdate = true;
			if ((mesh as any).instanceColor) {
				(mesh as any).instanceColor.needsUpdate = true;
			}
		}
	}, [areaInfo.labelByCell, cornerBaseMatrices, corners, cornersByStyle, currentArea, fogByCell, forceAllOutlined, hiddenMatrix, outlinesEnabled]);

	return (
		<group>
			{[...runsByStyle.entries()].map(([style, { indices }]) => {
				const wallMat = wallMaterialsByStyle.get(style);
				const wallCutMat = wallCutoutMaterialsByStyle.get(style);
				if (!wallMat || !wallCutMat) return null;
				const count = indices.length;
				return (
					<group key={`wall-style-${style}`}>
						<instancedMesh
							ref={(mesh) => {
								if (mesh) normalWallRefs.current.set(style, mesh);
								else normalWallRefs.current.delete(style);
							}}
							args={[unitBox, wallMat, count]}
							frustumCulled={false}
							castShadow
							receiveShadow
						/>
						<instancedMesh
							ref={(mesh) => {
								if (mesh) cutoutWallRefs.current.set(style, mesh);
								else cutoutWallRefs.current.delete(style);
							}}
							args={[unitBox, wallCutMat, count]}
							frustumCulled={false}
							castShadow
							receiveShadow
						/>
						<instancedMesh
							ref={(mesh) => {
								if (mesh) normalWallOutlineRefs.current.set(style, mesh);
								else normalWallOutlineRefs.current.delete(style);
							}}
							args={[unitBox, outlineMaterial, count]}
							frustumCulled={false}
							castShadow
							receiveShadow
						/>
						<instancedMesh
							ref={(mesh) => {
								if (mesh) cutoutWallOutlineRefs.current.set(style, mesh);
								else cutoutWallOutlineRefs.current.delete(style);
							}}
							args={[unitBox, cutoutOutlineMaterial, count]}
							frustumCulled={false}
							castShadow
							receiveShadow
						/>

					</group>
				);
			})}
			{[...cornersByStyle.entries()].map(([style, { indices }]) => {
				const material = cornerFillerMaterialsByStyle.get(style);
				if (!material) return null;
				return (
					<group key={`corner-filler-style-${style}`}>
						<instancedMesh
							ref={(mesh) => {
								if (mesh) cornerFillerRefs.current.set(style, mesh);
								else cornerFillerRefs.current.delete(style);
							}}
							args={[unitBox, material, indices.length]}
							frustumCulled={false}
							castShadow
							receiveShadow
						/>
						<instancedMesh
							ref={(mesh) => {
								if (mesh) cornerFillerOutlineRefs.current.set(style, mesh);
								else cornerFillerOutlineRefs.current.delete(style);
							}}
							args={[unitBox, outlineMaterial, indices.length]}
							frustumCulled={false}
							castShadow
							receiveShadow
						/>
					</group>
				);
			})}
		</group>
	);
}

export function MapLevel({
	layout,
	fogByCell,
	areaInfo,
	currentArea,
	playerPositionRef,
	forceAllOutlined = false,
	outlinesEnabled = true,
}: {
	layout: MapLayout;
	fogByCell: Map<string, FogState>;
	areaInfo: { labelByCell: Map<string, string> };
	currentArea: string;
	playerPositionRef: MutableRefObject<Vector3>;
	forceAllOutlined?: boolean;
	outlinesEnabled?: boolean;
}) {
	const textures = useEmbassyTextures(layout.seed);
	return (
		<group>
			<FloorsInstanced
				layout={layout}
				textures={textures}
				fogByCell={fogByCell}
				areaInfo={areaInfo}
				currentArea={currentArea}
				forceAllOutlined={forceAllOutlined}
				outlinesEnabled={outlinesEnabled}
			/>
			<WallsInstanced
				layout={layout}
				textures={textures}
				fogByCell={fogByCell}
				areaInfo={areaInfo}
				currentArea={currentArea}
				playerPositionRef={playerPositionRef}
				forceAllOutlined={forceAllOutlined}
				outlinesEnabled={outlinesEnabled}
			/>
		</group>
	);
}
