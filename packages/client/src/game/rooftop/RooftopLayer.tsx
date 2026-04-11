import { useMemo } from "react";
import { CELL_SIZE, ROOM_HEIGHT, generateEscapeLadderPlacement, generateMapLayout, type MapLayout } from "@vibejam/shared";
import { Base, Geometry, Subtraction } from "@react-three/csg";
import { Shape, Vector2 } from "three";
import { OutlinedMesh } from "../toonOutline/OutlinedMesh";

const ROOF_THICKNESS = 0.72;
const ROOF_BOTTOM_Y = ROOM_HEIGHT + 0.08;
const ROOF_CONCRETE_COLOR = "#7a7d80";
const HOLE_MARGIN_X = 0.45;
const HOLE_MARGIN_Z = 0.75;
const PARAPET_HEIGHT = 0.55;
const PARAPET_THICKNESS = 0.22;
const HOLE_EDGE_HEIGHT = 0.32;
const HOLE_EDGE_THICKNESS = 0.16;
const ROOF_EDGE_Y_EPSILON = 0.01;
const ROOF_OVERFLOW = 0.38;

function cross(o: Vector2, a: Vector2, b: Vector2): number {
	return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(points: Vector2[]): Vector2[] {
	if (points.length <= 3) {
		return points;
	}
	const sorted = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
	const lower: Vector2[] = [];
	for (const p of sorted) {
		while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) {
			lower.pop();
		}
		lower.push(p);
	}
	const upper: Vector2[] = [];
	for (let i = sorted.length - 1; i >= 0; i--) {
		const p = sorted[i]!;
		while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) {
			upper.pop();
		}
		upper.push(p);
	}
	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

type RoofBuildData = {
	shape: Shape;
	hull: Vector2[];
	hole:
		| {
				centerX: number;
				centerZ: number;
				halfX: number;
				halfZ: number;
		  }
		| null;
};

function expandHull(hull: Vector2[], amount: number): Vector2[] {
	if (hull.length === 0 || amount <= 0) {
		return hull;
	}
	let cx = 0;
	let cy = 0;
	for (const p of hull) {
		cx += p.x;
		cy += p.y;
	}
	cx /= hull.length;
	cy /= hull.length;
	return hull.map((p) => {
		const dx = p.x - cx;
		const dy = p.y - cy;
		const len = Math.hypot(dx, dy);
		if (len < 0.0001) {
			return p.clone();
		}
		const s = (len + amount) / len;
		return new Vector2(cx + dx * s, cy + dy * s);
	});
}

function buildRoofData(layout: MapLayout): RoofBuildData | null {
	const half = CELL_SIZE * 0.5;
	const corners: Vector2[] = [];
	for (const cell of layout.cells) {
		const x = cell.ix * CELL_SIZE;
		const z = cell.iz * CELL_SIZE;
		corners.push(new Vector2(x - half, -(z - half)));
		corners.push(new Vector2(x + half, -(z - half)));
		corners.push(new Vector2(x + half, -(z + half)));
		corners.push(new Vector2(x - half, -(z + half)));
	}
	const hullRaw = convexHull(corners);
	if (hullRaw.length < 3) {
		return null;
	}
	const hull = expandHull(hullRaw, ROOF_OVERFLOW);
	const shape = new Shape();
	shape.moveTo(hull[0]!.x, hull[0]!.y);
	for (let i = 1; i < hull.length; i++) {
		shape.lineTo(hull[i]!.x, hull[i]!.y);
	}
	shape.closePath();
	const ladder = generateEscapeLadderPlacement(layout);
	let holeData: RoofBuildData["hole"] = null;
	if (ladder) {
		const holeHalfX = ladder.width * 0.5 + HOLE_MARGIN_X;
		const holeHalfZ = ladder.depth * 0.5 + HOLE_MARGIN_Z;
		holeData = {
			centerX: ladder.x,
			centerZ: ladder.z,
			halfX: holeHalfX,
			halfZ: holeHalfZ,
		};
	}
	return { shape, hull, hole: holeData };
}

function hullEdgeSegments(hull: Vector2[]): Array<{ x: number; z: number; length: number; rotationY: number }> {
	if (hull.length < 2) {
		return [];
	}
	const segments: Array<{ x: number; z: number; length: number; rotationY: number }> = [];
	for (let i = 0; i < hull.length; i++) {
		const a = hull[i]!;
		const b = hull[(i + 1) % hull.length]!;
		const ax = a.x;
		const az = -a.y;
		const bx = b.x;
		const bz = -b.y;
		const dx = bx - ax;
		const dz = bz - az;
		const length = Math.hypot(dx, dz);
		if (length <= 0.0001) {
			continue;
		}
		segments.push({
			x: (ax + bx) * 0.5,
			z: (az + bz) * 0.5,
			length,
			rotationY: Math.atan2(dx, dz),
		});
	}
	return segments;
}

export function RooftopLayer({
	mapSeed,
	mapMaxDistance,
	visible,
}: {
	mapSeed: number;
	mapMaxDistance: number;
	visible: boolean;
}) {
	const roofData = useMemo(() => {
		const layout = generateMapLayout(mapSeed, mapMaxDistance);
		const data = buildRoofData(layout);
		if (!data) {
			return null;
		}
		return data;
	}, [mapMaxDistance, mapSeed]);

	if (!roofData) {
		return null;
	}
	const roofTopY = ROOF_BOTTOM_Y + ROOF_THICKNESS;
	const edgeSegments = hullEdgeSegments(roofData.hull);

	return (
		<group visible={visible}>
			<mesh
				position={[0, ROOF_BOTTOM_Y, 0]}
				rotation={[-Math.PI / 2, 0, 0]}
				castShadow
				receiveShadow
			>
				<Geometry computeVertexNormals>
					<Base>
						<extrudeGeometry args={[roofData.shape, { depth: ROOF_THICKNESS, bevelEnabled: false }]} />
					</Base>
					{roofData.hole ? (
						<Subtraction
							position={[
								roofData.hole.centerX,
								-roofData.hole.centerZ,
								ROOF_THICKNESS * 0.5,
							]}
						>
							<boxGeometry
								args={[
									roofData.hole.halfX * 2,
									roofData.hole.halfZ * 2,
									ROOF_THICKNESS + 1.2,
								]}
							/>
						</Subtraction>
					) : null}
				</Geometry>
				<meshToonMaterial color={ROOF_CONCRETE_COLOR} emissive="#474a4f" emissiveIntensity={0.12} />
			</mesh>
			{edgeSegments.map((segment, index) => (
				<OutlinedMesh
					key={`parapet-${index}`}
					outlined
					position={[segment.x, roofTopY + PARAPET_HEIGHT * 0.5 + ROOF_EDGE_Y_EPSILON, segment.z]}
					rotation={[0, segment.rotationY, 0]}
					castShadow
					receiveShadow
					geometryNode={<boxGeometry args={[PARAPET_THICKNESS, PARAPET_HEIGHT, segment.length]} />}
					materialNode={<meshToonMaterial color="#858a8f" emissive="#494d52" emissiveIntensity={0.14} />}
				/>
			))}
			{roofData.hole ? (
				<group>
					<OutlinedMesh
						outlined
						position={[
							roofData.hole.centerX - roofData.hole.halfX + HOLE_EDGE_THICKNESS * 0.5,
							roofTopY + HOLE_EDGE_HEIGHT * 0.5 + ROOF_EDGE_Y_EPSILON,
							roofData.hole.centerZ,
						]}
						castShadow
						receiveShadow
						geometryNode={<boxGeometry args={[HOLE_EDGE_THICKNESS, HOLE_EDGE_HEIGHT, roofData.hole.halfZ * 2 + HOLE_EDGE_THICKNESS * 2]} />}
						materialNode={<meshToonMaterial color="#8a8f95" emissive="#50545a" emissiveIntensity={0.12} />}
					/>
					<OutlinedMesh
						outlined
						position={[
							roofData.hole.centerX + roofData.hole.halfX - HOLE_EDGE_THICKNESS * 0.5,
							roofTopY + HOLE_EDGE_HEIGHT * 0.5 + ROOF_EDGE_Y_EPSILON,
							roofData.hole.centerZ,
						]}
						castShadow
						receiveShadow
						geometryNode={<boxGeometry args={[HOLE_EDGE_THICKNESS, HOLE_EDGE_HEIGHT, roofData.hole.halfZ * 2 + HOLE_EDGE_THICKNESS * 2]} />}
						materialNode={<meshToonMaterial color="#8a8f95" emissive="#50545a" emissiveIntensity={0.12} />}
					/>
					<OutlinedMesh
						outlined
						position={[
							roofData.hole.centerX,
							roofTopY + HOLE_EDGE_HEIGHT * 0.5 + ROOF_EDGE_Y_EPSILON,
							roofData.hole.centerZ - roofData.hole.halfZ + HOLE_EDGE_THICKNESS * 0.5,
						]}
						castShadow
						receiveShadow
						geometryNode={<boxGeometry args={[roofData.hole.halfX * 2, HOLE_EDGE_HEIGHT, HOLE_EDGE_THICKNESS]} />}
						materialNode={<meshToonMaterial color="#8a8f95" emissive="#50545a" emissiveIntensity={0.12} />}
					/>
					<OutlinedMesh
						outlined
						position={[
							roofData.hole.centerX,
							roofTopY + HOLE_EDGE_HEIGHT * 0.5 + ROOF_EDGE_Y_EPSILON,
							roofData.hole.centerZ + roofData.hole.halfZ - HOLE_EDGE_THICKNESS * 0.5,
						]}
						castShadow
						receiveShadow
						geometryNode={<boxGeometry args={[roofData.hole.halfX * 2, HOLE_EDGE_HEIGHT, HOLE_EDGE_THICKNESS]} />}
						materialNode={<meshToonMaterial color="#8a8f95" emissive="#50545a" emissiveIntensity={0.12} />}
					/>
				</group>
			) : null}
		</group>
	);
}
