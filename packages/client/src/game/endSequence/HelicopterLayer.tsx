import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { CanvasTexture, CatmullRomCurve3, Group, NearestFilter, Shape, SRGBColorSpace, Vector3 } from "three";
import { OutlinedMesh } from "../toonOutline/OutlinedMesh";

const APPROACH_MS = 1900;
const COVER_MS = 800;
const EXIT_MS = 1900;
const TOTAL_MS = APPROACH_MS + COVER_MS + EXIT_MS;

const TAIL = "#ffffff";
const BODY_TOP = "#d32626";
const BODY_BOTTOM = "#0015BC";
const METAL = "#7b8087";
const WINDOW_TINT = "#8dd5ff";
const HELI_LENGTH = 5.2;
const AIR_HEIGHT = 8.4;
const MID_AIR_HEIGHT = 4.2;
const TAIL_BOOM_LENGTH = 6.4;
const TAIL_BOOM_FRONT_X = -1.3;
const TAIL_BOOM_CENTER_X = TAIL_BOOM_FRONT_X - TAIL_BOOM_LENGTH * 0.5;
const TAIL_BOOM_REAR_X = TAIL_BOOM_CENTER_X - TAIL_BOOM_LENGTH * 0.5;
const TAIL_FIN_X = TAIL_BOOM_REAR_X + 0.25;

function intersectNdcRayWithYPlane(
	ndcX: number,
	ndcY: number,
	planeY: number,
	camera: { position: Vector3; near: number; far: number },
): Vector3 | null {
	const nearPoint = new Vector3(ndcX, ndcY, -1).unproject(camera as any);
	const farPoint = new Vector3(ndcX, ndcY, 1).unproject(camera as any);
	const dir = farPoint.sub(nearPoint);
	if (Math.abs(dir.y) < 0.0001) {
		return null;
	}
	const t = (planeY - nearPoint.y) / dir.y;
	if (!Number.isFinite(t)) {
		return null;
	}
	return nearPoint.add(dir.multiplyScalar(t));
}

function easeInOut(t: number): number {
	const x = Math.max(0, Math.min(1, t));
	return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

export function HelicopterLayer({
	active,
	runId,
	target,
	roofTopY,
	preview = false,
	previewPosition = null,
	onCoverChange,
	onFinished,
}: {
	active: boolean;
	runId: number;
	target: { x: number; z: number } | null;
	roofTopY: number;
	preview?: boolean;
	previewPosition?: { x: number; y: number; z: number } | null;
	onCoverChange?: (covered: boolean) => void;
	onFinished?: () => void;
}) {
	const { camera } = useThree();
	const groupRef = useRef<Group>(null);
	const mainRotorRef = useRef<Group>(null);
	const tailRotorRef = useRef<Group>(null);
	const elapsedMsRef = useRef(0);
	const landRef = useRef(new Vector3());
	const inboundCurveRef = useRef<CatmullRomCurve3 | null>(null);
	const outboundCurveRef = useRef<CatmullRomCurve3 | null>(null);
	const coveredRef = useRef(false);
	const finishedRef = useRef(false);
	const onCoverChangeRef = useRef(onCoverChange);
	const onFinishedRef = useRef(onFinished);
	const fauxNewsTexture = useMemo(() => {
		const canvas = document.createElement("canvas");
		canvas.width = 512;
		canvas.height = 128;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return null;
		}
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.font = "700 78px Arial, sans-serif";
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillStyle = "#ffffff";
		ctx.fillText("FAUX NEWS", canvas.width / 2, canvas.height / 2 + 2);
		const texture = new CanvasTexture(canvas);
		texture.colorSpace = SRGBColorSpace;
		texture.minFilter = NearestFilter;
		texture.magFilter = NearestFilter;
		texture.generateMipmaps = false;
		texture.needsUpdate = true;
		return texture;
	}, []);
	const cockpitGlassExtrude = useMemo(() => ({ depth: 1.65, bevelEnabled: false }), []);
	const cockpitGlassUpperShape = useMemo(() => {
		const shape = new Shape();
		shape.moveTo(-0.55, -0.02);
		shape.lineTo(0.55, -0.02);
		shape.lineTo(0.55, 0.6);
		shape.closePath();
		return shape;
	}, []);
	const cockpitGlassLowerShape = useMemo(() => {
		const shape = new Shape();
		shape.moveTo(-0.55, 0.02);
		shape.lineTo(0.55, 0.02);
		shape.lineTo(0.55, -0.6);
		shape.closePath();
		return shape;
	}, []);

	useEffect(() => {
		onCoverChangeRef.current = onCoverChange;
	}, [onCoverChange]);

	useEffect(() => {
		onFinishedRef.current = onFinished;
	}, [onFinished]);

	useEffect(() => {
		return () => {
			fauxNewsTexture?.dispose();
		};
	}, [fauxNewsTexture]);

	useEffect(() => {
		if (preview && previewPosition) {
			const g = groupRef.current;
			if (g) {
				g.position.set(previewPosition.x, previewPosition.y, previewPosition.z);
				g.rotation.set(0, Math.PI, 0);
			}
			return;
		}
		elapsedMsRef.current = 0;
		coveredRef.current = false;
		finishedRef.current = false;
		onCoverChangeRef.current?.(false);
		if (!target) {
			return;
		}
		const landY = roofTopY + 1.65;
		landRef.current.set(target.x, landY, target.z);

		const playerWorld = new Vector3(target.x, landY, target.z);
		const playerNdc = playerWorld.clone().project(camera);
		const planeY = landY;
		const leftEdge =
			intersectNdcRayWithYPlane(-1, playerNdc.y, planeY, camera as any) ??
			new Vector3(target.x - 18, planeY, target.z);
		const rightEdge =
			intersectNdcRayWithYPlane(1, playerNdc.y, planeY, camera as any) ??
			new Vector3(target.x + 18, planeY, target.z);
		const lineDir = rightEdge.clone().sub(leftEdge).setY(0).normalize();
		const startGround = rightEdge.clone().add(lineDir.clone().multiplyScalar(HELI_LENGTH * 1.45));
		const endGround = leftEdge.clone().add(lineDir.clone().multiplyScalar(-HELI_LENGTH * 1.45));
		const approachMid = startGround.clone().lerp(landRef.current, 0.4);
		const exitMid = landRef.current.clone().lerp(endGround, 0.4);

		const startAir = startGround.clone();
		startAir.y += AIR_HEIGHT;
		const approachAir = approachMid.clone();
		approachAir.y += MID_AIR_HEIGHT;
		const landPoint = landRef.current.clone();
		const exitAir = exitMid.clone();
		exitAir.y += MID_AIR_HEIGHT;
		const endAir = endGround.clone();
		endAir.y += AIR_HEIGHT;

		inboundCurveRef.current = new CatmullRomCurve3([startAir, approachAir, landPoint], false, "centripetal");
		outboundCurveRef.current = new CatmullRomCurve3([landPoint, exitAir, endAir], false, "centripetal");

		const g = groupRef.current;
		if (g) {
			g.position.copy(startAir);
			g.rotation.set(0, Math.PI, 0);
		}
	}, [camera, preview, previewPosition, roofTopY, runId, target]);

	useFrame((_, dt) => {
		if (preview && previewPosition) {
			const g = groupRef.current;
			if (g) {
				g.position.set(previewPosition.x, previewPosition.y, previewPosition.z);
				g.rotation.y = Math.PI;
			}
			if (mainRotorRef.current) {
				mainRotorRef.current.rotation.y += dt * 36;
			}
			if (tailRotorRef.current) {
				tailRotorRef.current.rotation.z += dt * 44;
			}
			return;
		}
		if (!active || !target) {
			if (coveredRef.current) {
				coveredRef.current = false;
				onCoverChangeRef.current?.(false);
			}
			return;
		}
		const g = groupRef.current;
		if (!g) {
			return;
		}
		elapsedMsRef.current += dt * 1000;
		const elapsed = elapsedMsRef.current;

		// Rotor motion.
		if (mainRotorRef.current) {
			mainRotorRef.current.rotation.y += dt * 36;
		}
		if (tailRotorRef.current) {
			tailRotorRef.current.rotation.z += dt * 44;
		}

		const coverStart = APPROACH_MS;
		const coverEnd = coverStart + COVER_MS;
		const shouldCover = elapsed >= coverStart && elapsed < coverEnd;
		if (shouldCover !== coveredRef.current) {
			coveredRef.current = shouldCover;
			onCoverChangeRef.current?.(shouldCover);
		}

		const inbound = inboundCurveRef.current;
		const outbound = outboundCurveRef.current;
		if (elapsed <= APPROACH_MS && inbound) {
			const t = easeInOut(elapsed / APPROACH_MS);
			const p = inbound.getPoint(t);
			const tangent = inbound.getTangent(Math.min(0.999, t + 0.001)).setY(0);
			g.position.copy(p);
			if (tangent.lengthSq() > 0.000001) {
				g.rotation.y = Math.atan2(tangent.z, tangent.x);
			}
			return;
		}
		if (elapsed <= coverEnd) {
			g.position.set(landRef.current.x, landRef.current.y, landRef.current.z);
			return;
		}
		if (elapsed <= TOTAL_MS && outbound) {
			const t = easeInOut((elapsed - coverEnd) / EXIT_MS);
			const p = outbound.getPoint(t);
			const tangent = outbound.getTangent(Math.min(0.999, t + 0.001)).setY(0);
			g.position.copy(p);
			if (tangent.lengthSq() > 0.000001) {
				g.rotation.y = Math.atan2(tangent.z, tangent.x);
			}
			return;
		}

		if (coveredRef.current) {
			coveredRef.current = false;
			onCoverChangeRef.current?.(false);
		}
		if (!finishedRef.current) {
			finishedRef.current = true;
			onFinishedRef.current?.();
		}
	});

	const heliBody = useMemo(
		() => (
			<group>
				{/* Main fuselage upper body */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[3.5, 1.45, 1.65]} />}
					materialNode={<meshToonMaterial color={BODY_TOP} emissive="#651616" emissiveIntensity={0.12} />}
					position={[0.2, 0.45, 0]}
					castShadow
					receiveShadow
				/>
				{/* Main fuselage lower body */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[3.5, 0.6, 1.65]} />}
					materialNode={<meshToonMaterial color={BODY_BOTTOM} emissive="#4c1111" emissiveIntensity={0.16} />}
					position={[0.2, -0.56, 0]}
					castShadow
					receiveShadow
				/>
				{/* Right-side lower fuselage decal text */}
				{fauxNewsTexture ? (
					<mesh position={[0.2, -0.56, -0.84]} rotation={[0, Math.PI, 0]}>
						<planeGeometry args={[1.7, 0.42]} />
						<meshBasicMaterial map={fauxNewsTexture} transparent />
					</mesh>
				) : null}
				{/* Cockpit / nose block */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[1.2, 0.5, 1.65]} />}
					materialNode={<meshToonMaterial color={BODY_TOP} emissive="#651616" emissiveIntensity={0.12} />}
					position={[2.5, 0.12, 0]}
					castShadow
					receiveShadow
				/>
				{/* Cockpit upper glass (extruded triangle) */}
				<OutlinedMesh
					outlined
					geometryNode={<extrudeGeometry args={[cockpitGlassUpperShape, cockpitGlassExtrude]} />}
					materialNode={<meshToonMaterial color={WINDOW_TINT} emissive={WINDOW_TINT} emissiveIntensity={0.12} />}
					position={[2.5, 0.4, 0.825]}
					rotation={[0, Math.PI, 0]}
				/>
				{/* Back part upper fuselage (extruded triangle) */}
				<OutlinedMesh
					outlined
					geometryNode={<extrudeGeometry args={[cockpitGlassUpperShape, cockpitGlassExtrude]} />}
					materialNode={<meshToonMaterial color={BODY_TOP} />}
					position={[-2.1, 0.355, -0.825]}
				/>
				{/* Back part  lower fuselage (extruded triangle) */}
				<OutlinedMesh
					outlined
					geometryNode={<extrudeGeometry args={[cockpitGlassLowerShape, cockpitGlassExtrude]} />}
					materialNode={<meshToonMaterial color={BODY_BOTTOM} />}
					position={[-2.1, 0.3, -0.825]}
				/>
				{/* Cockpit lower glass (extruded triangle) */}
				<OutlinedMesh
					outlined
					geometryNode={<extrudeGeometry args={[cockpitGlassLowerShape, cockpitGlassExtrude]} />}
					materialNode={<meshToonMaterial color={WINDOW_TINT} emissive={WINDOW_TINT} emissiveIntensity={0.12} />}
					position={[2.5, -0.2, 0.825]}
					rotation={[0, Math.PI, 0]}
				/>
				{/* Tail boom */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[TAIL_BOOM_LENGTH, 0.38, 0.42]} />}
					materialNode={<meshToonMaterial color={TAIL} emissive="#5b1313" emissiveIntensity={0.1} />}
					position={[TAIL_BOOM_CENTER_X, 0.32, 0]}
					castShadow
					receiveShadow
				/>
				{/* Vertical tail fin (opposite side from tail rotor) */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[0.15, 1.5, 1.2]} />}
					materialNode={<meshToonMaterial color={BODY_TOP} />}
					position={[TAIL_FIN_X, 0.4, 0.3]}
					rotation={[0, Math.PI / 2, 0]}
					castShadow
					receiveShadow
				/>

				{/* Side window 1 (right) */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[0.22, 0.7, 1.2]} />}
					materialNode={<meshToonMaterial color={WINDOW_TINT} emissive={WINDOW_TINT} emissiveIntensity={0.12} />}
					position={[0.85, 0.45, -0.72]}
					rotation={[0, Math.PI / 2, 0]}
				/>
				{/* Side window 2 (right) */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[0.22, 0.7, 0.7]} />}
					materialNode={<meshToonMaterial color={WINDOW_TINT} emissive={WINDOW_TINT} emissiveIntensity={0.12}  />}
					position={[-0.7, 0.45, -0.72]}
					rotation={[0, Math.PI / 2, 0]}
				/>
				{/* Rotor mast / engine cap */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[0.2, 0.4, 0.2]} />}
					materialNode={<meshToonMaterial color={METAL} />}
					position={[0.3, 1.35, 0]}
				/>
			</group>
		),
		[cockpitGlassExtrude, cockpitGlassLowerShape, cockpitGlassUpperShape, fauxNewsTexture],
	);

	return (
		<group ref={groupRef} visible={preview ? !!previewPosition : active && !!target}>
			{heliBody}
			{/* Main rotor assembly (2 blades, centered pivot) */}
			<group ref={mainRotorRef} position={[0.3, 1.52, 0]}>
				{/* Main rotor blade A */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[0.13, 0.03, 9.0]} />}
					materialNode={<meshToonMaterial color={METAL} />}
				/>
				{/* Main rotor blade B (90° offset from blade A) */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[0.13, 0.03, 9.0]} />}
					materialNode={<meshToonMaterial color={METAL} />}
					rotation={[0, Math.PI / 2, 0]}
				/>
			</group>
			{/* Tail rotor assembly at boom tip */}
			<group ref={tailRotorRef} position={[TAIL_BOOM_REAR_X + 0.5, 0.25, -0.46]}>
				{/* Tail rotor blade A */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[0.12, 1.3, 0.12]} />}
					materialNode={<meshToonMaterial color={METAL} />}
					rotation={[0, 0, Math.PI / 2]}
				/>
				{/* Tail rotor blade B */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[0.12, 1.3, 0.12]} />}
					materialNode={<meshToonMaterial color={METAL} />}
				/>
			</group>
			{/* Landing skids (length 4.5) and four 45-degree side struts (two per side, length ~0.7) */}
			<group>
				{/* Left skid rail */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[4.5, 0.09, 0.1]} />}
					materialNode={<meshToonMaterial color={METAL} />}
					position={[0.3, -1.58, 1.02]}
					castShadow
					receiveShadow
				/>
				{/* Right skid rail */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[4.5, 0.09, 0.1]} />}
					materialNode={<meshToonMaterial color={METAL} />}
					position={[0.3, -1.58, -1.02]}
					castShadow
					receiveShadow
				/>
				{/* Left-front strut from lower fuselage edge */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[0.1, 0.7, 0.1]} />}
					materialNode={<meshToonMaterial color={METAL} />}
					position={[-0.8, -1.25, 0.76]}
					rotation={[-Math.PI / 4, 0, 0]}
				/>
				{/* Left-rear strut from lower fuselage edge */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[0.1, 0.7, 0.1]} />}
					materialNode={<meshToonMaterial color={METAL} />}
					position={[1.4, -1.25, 0.76]}
					rotation={[-Math.PI / 4, 0, 0]}
				/>
				{/* Right-front strut from lower fuselage edge */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[0.1, 0.7, 0.1]} />}
					materialNode={<meshToonMaterial color={METAL} />}
					position={[-0.8, -1.25, -0.76]}
					rotation={[Math.PI / 4, 0, 0]}
				/>
				{/* Right-rear strut from lower fuselage edge */}
				<OutlinedMesh
					outlined
					geometryNode={<boxGeometry args={[0.1, 0.7, 0.1]} />}
					materialNode={<meshToonMaterial color={METAL} />}
					position={[1.4, -1.25, -0.76]}
					rotation={[Math.PI / 4, 0, 0]}
				/>
			</group>
		</group>
	);
}
