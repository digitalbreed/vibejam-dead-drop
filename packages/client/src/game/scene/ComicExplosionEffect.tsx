import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { DoubleSide, Group, Shape, ShapeGeometry, type MeshToonMaterial } from "three";

export const EXPLOSION_FX_DURATION_MS = 980;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function buildComicBurstShape(points: number, innerRadius: number, outerRadius: number): Shape {
	const shape = new Shape();
	const total = points * 2;
	for (let i = 0; i <= total; i++) {
		const angle = (i / total) * Math.PI * 2;
		const radius = i % 2 === 0 ? outerRadius : innerRadius;
		const x = Math.cos(angle) * radius;
		const y = Math.sin(angle) * radius;
		if (i === 0) {
			shape.moveTo(x, y);
		} else {
			shape.lineTo(x, y);
		}
	}
	shape.closePath();
	return shape;
}

export function ComicExplosionEffect({
	x,
	z,
	spawnMs,
	durationMs = EXPLOSION_FX_DURATION_MS,
}: {
	x: number;
	z: number;
	spawnMs: number;
	durationMs?: number;
}) {
	const billboardRef = useRef<Group>(null);
	const animRef = useRef<Group>(null);
	const outerMatRef = useRef<MeshToonMaterial>(null);
	const midMatRef = useRef<MeshToonMaterial>(null);
	const coreMatRef = useRef<MeshToonMaterial>(null);
	const streakMatRef = useRef<MeshToonMaterial>(null);
	const { camera } = useThree();
	const spinDirRef = useRef(Math.random() > 0.5 ? 1 : -1);
	const outerBurstGeometry = useMemo(() => new ShapeGeometry(buildComicBurstShape(14, 0.63, 1.18)), []);
	const midBurstGeometry = useMemo(() => new ShapeGeometry(buildComicBurstShape(12, 0.44, 0.86)), []);
	const coreBurstGeometry = useMemo(() => new ShapeGeometry(buildComicBurstShape(10, 0.3, 0.64)), []);

	useFrame(() => {
		const billboard = billboardRef.current;
		const anim = animRef.current;
		if (!billboard || !anim) {
			return;
		}
		billboard.lookAt(camera.position.x, billboard.position.y, camera.position.z);
		const t = clamp((performance.now() - spawnMs) / durationMs, 0, 1);
		const burstIn = clamp(t / 0.18, 0, 1);
		const settle = clamp((t - 0.22) / 0.78, 0, 1);
		const scale = 0.06 + burstIn * (2.55 - 1.35 * settle);
		const rise = Math.sin(Math.min(1, t * 1.1) * Math.PI) * 0.82;
		anim.scale.set(scale, scale, scale);
		anim.position.y = rise;
		anim.rotation.z = spinDirRef.current * t * 0.42;
		if (outerMatRef.current) {
			outerMatRef.current.emissiveIntensity = 0.55;
		}
		if (midMatRef.current) {
			midMatRef.current.emissiveIntensity = 0.62;
		}
		if (coreMatRef.current) {
			coreMatRef.current.emissiveIntensity = 0.85;
		}
		if (streakMatRef.current) {
			streakMatRef.current.emissiveIntensity = 0.52;
		}
	});

	return (
		<group ref={billboardRef} position={[x, 0.9, z]}>
			<group ref={animRef}>
				<mesh geometry={outerBurstGeometry}>
					<meshToonMaterial ref={outerMatRef} color="#ffb11e" emissive="#ff7e1f" side={DoubleSide} />
				</mesh>
				<mesh geometry={midBurstGeometry} position={[0, 0, 0.016]}>
					<meshToonMaterial ref={midMatRef} color="#ff5b1f" emissive="#ff3b16" side={DoubleSide} />
				</mesh>
				<mesh geometry={coreBurstGeometry} position={[0, 0, 0.032]}>
					<meshToonMaterial ref={coreMatRef} color="#ffe446" emissive="#ffcf2b" side={DoubleSide} />
				</mesh>
				{[0, 0.85, 1.6, 2.45, 3.25, 4.05, 4.9, 5.65].map((a, i) => (
					<mesh
						key={`explosion-streak-${i}`}
						position={[Math.cos(a) * 0.92, Math.sin(a) * 0.92, 0.01]}
						rotation={[0, 0, a + Math.PI / 2]}
					>
						<coneGeometry args={[0.09, 0.72, 3]} />
						<meshToonMaterial
							ref={i === 0 ? streakMatRef : undefined}
							color="#f62a35"
							emissive="#d81824"
							side={DoubleSide}
						/>
					</mesh>
				))}
			</group>
		</group>
	);
}
