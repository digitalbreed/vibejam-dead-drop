import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import { Color, Group, Vector3 } from "three";

const RISE_MS = 1200;
const REMOTE_FADE_OUT_MS = 2400;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function easeOutCubic(t: number): number {
	const x = clamp(t, 0, 1);
	return 1 - Math.pow(1 - x, 3);
}

function GhostSprite({
	color,
	baseX,
	baseZ,
	spawnMs,
	followAnchorRef,
	showContinuously,
}: {
	color: number;
	baseX: number;
	baseZ: number;
	spawnMs: number;
	followAnchorRef?: MutableRefObject<Vector3> | null;
	showContinuously: boolean;
}) {
	const groupRef = useRef<Group>(null);
	const visualRef = useRef<Group>(null);
	const leftEyeRef = useRef<Group>(null);
	const rightEyeRef = useRef<Group>(null);
	const blinkTimerRef = useRef(Math.random() * 2.4 + 0.6);
	const blinkDurationRef = useRef(0);
	const lastMotionRef = useRef<{ x: number; z: number }>({ x: baseX, z: baseZ });
	const facingAngleRef = useRef(0);
	const colorObj = useMemo(() => new Color(color), [color]);
	const wobbleSeed = useRef(Math.random() * Math.PI * 2);

	useFrame((_, dt) => {
		const group = groupRef.current;
		if (!group) {
			return;
		}
		const now = performance.now();
		const elapsedMs = Math.max(0, now - spawnMs);
		const tRise = easeOutCubic(elapsedMs / RISE_MS);
		const lift = 0.4 + tRise * 2.2;
		const t = now / 1000;
		const wiggleX = Math.sin(t * 3.2 + wobbleSeed.current) * 0.22;
		const wiggleZ = Math.cos(t * 2.8 + wobbleSeed.current * 0.75) * 0.08;
		let motionX = baseX;
		let motionZ = baseZ;

		if (followAnchorRef && showContinuously && elapsedMs >= RISE_MS) {
			motionX = followAnchorRef.current.x;
			motionZ = followAnchorRef.current.z;
			group.position.set(
				motionX + wiggleX,
				followAnchorRef.current.y + 1.2 + Math.sin(t * 2 + wobbleSeed.current) * 0.2,
				motionZ + wiggleZ,
			);
		} else {
			group.position.set(motionX + wiggleX, lift + Math.sin(t * 2 + wobbleSeed.current) * 0.08, motionZ + wiggleZ);
		}
		// Face only the true travel direction; ignore wiggle offsets to prevent yaw jitter.
		const dx = motionX - lastMotionRef.current.x;
		const dz = motionZ - lastMotionRef.current.z;
		if (dx * dx + dz * dz > 0.000001) {
			facingAngleRef.current = Math.atan2(dx, dz);
		}
		lastMotionRef.current.x = motionX;
		lastMotionRef.current.z = motionZ;
		if (visualRef.current) {
			visualRef.current.rotation.y +=
				(facingAngleRef.current - visualRef.current.rotation.y) * (1 - Math.exp(-dt * 12));
		}

		if (blinkDurationRef.current > 0) {
			blinkDurationRef.current = Math.max(0, blinkDurationRef.current - dt);
		} else {
			blinkTimerRef.current -= dt;
			if (blinkTimerRef.current <= 0) {
				blinkDurationRef.current = 0.12;
				blinkTimerRef.current = Math.random() * 2.8 + 1.3;
			}
		}
		const blinkPhase = blinkDurationRef.current > 0 ? 1 - Math.abs(blinkDurationRef.current - 0.06) / 0.06 : 0;
		const eyelidScale = 1 - blinkPhase * 0.9;
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
			<mesh position={[0, 0.82, 0]}>
				<coneGeometry args={[0.42, 1.6, 10]} />
				<meshToonMaterial color={colorObj} emissive={colorObj} emissiveIntensity={0.28} transparent opacity={0.35} depthWrite={false} />
			</mesh>
			<group position={[0, 1.02, 0.3]}>
				<group ref={leftEyeRef} position={[-0.13, 0, -0.05]}>
					<mesh>
						<sphereGeometry args={[0.12, 18, 18]} />
						<meshToonMaterial color="#fffaf0" transparent opacity={0.42} depthWrite={false} />
					</mesh>
					<mesh position={[0.01, -0.01, 0.075]}>
						<sphereGeometry args={[0.048, 14, 14]} />
						<meshToonMaterial color="#111111" transparent opacity={0.56} depthWrite={false} />
					</mesh>
				</group>
				<group ref={rightEyeRef} position={[0.13, 0, -0.05]}>
					<mesh>
						<sphereGeometry args={[0.12, 18, 18]} />
						<meshToonMaterial color="#fffaf0" transparent opacity={0.42} depthWrite={false} />
					</mesh>
					<mesh position={[-0.01, -0.01, 0.075]}>
						<sphereGeometry args={[0.048, 14, 14]} />
						<meshToonMaterial color="#111111" transparent opacity={0.56} depthWrite={false} />
					</mesh>
				</group>
			</group>
			</group>
		</group>
	);
}

export type GhostPlayerSnapshot = {
	id: string;
	x: number;
	z: number;
	color: number;
	isAlive: boolean;
	isLocal: boolean;
};

export function DeathGhostLayer({
	players,
	deathStartedAtMsById,
	localSessionId,
	localCameraAttach,
	cameraAnchorRef,
}: {
	players: GhostPlayerSnapshot[];
	deathStartedAtMsById: ReadonlyMap<string, number>;
	localSessionId?: string;
	localCameraAttach: boolean;
	cameraAnchorRef: MutableRefObject<Vector3>;
}) {
	return (
		<group>
			{players.map((player) => {
				if (player.isAlive) {
					return null;
				}
				const spawnedAt = deathStartedAtMsById.get(player.id);
				if (!spawnedAt) {
					return null;
				}
				const isLocalHumanGhost = player.id === localSessionId;
				if (!isLocalHumanGhost) {
					const elapsedMs = performance.now() - spawnedAt;
					if (elapsedMs > REMOTE_FADE_OUT_MS) {
						return null;
					}
				}
				return (
					<GhostSprite
						key={`ghost-${player.id}`}
						color={player.color}
						baseX={player.x}
						baseZ={player.z}
						spawnMs={spawnedAt}
						followAnchorRef={isLocalHumanGhost ? cameraAnchorRef : null}
						showContinuously={isLocalHumanGhost && localCameraAttach}
					/>
				);
			})}
		</group>
	);
}
