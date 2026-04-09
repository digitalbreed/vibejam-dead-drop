import { useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { CanvasTexture, Color, DoubleSide, Group, NearestFilter, SRGBColorSpace, Vector3 } from "three";
import { OutlinedMesh } from "../toonOutline/OutlinedMesh";

const MOVE_SPEED = 12;

export type KeycardColor = "blue" | "red";

const KEYCARD_COLOR_BY_KIND: Record<KeycardColor, string> = {
	blue: "#1fb5ff",
	red: "#ff2c44",
};

export function PlayerVisual({
	color,
	isLocal,
	positionRef,
	target,
	smoothing,
	carriedKeycardColor,
	carriedSuitcase,
	isInteracting,
	interactionProgress,
	interactionStyle,
	isAlive = true,
	outlined = true,
	nameLabel,
	showNameLabel = false,
}: {
	color: number;
	isLocal: boolean;
	positionRef?: MutableRefObject<Vector3>;
	target?: { x: number; z: number };
	smoothing: number;
	carriedKeycardColor?: KeycardColor | null;
	carriedSuitcase?: boolean;
	isInteracting?: boolean;
	interactionProgress?: number;
	interactionStyle?: string;
	isAlive?: boolean;
	outlined?: boolean;
	nameLabel?: string;
	showNameLabel?: boolean;
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
	const deadFlingRef = useRef(0);
	const deadSpinVelRef = useRef({ x: 0, y: 0, z: 0 });
	const deathSpinSeedRef = useRef(Math.random() * Math.PI * 2);
	const wasAliveRef = useRef(isAlive);
	const nameLabelData = useMemo(() => {
		if (!showNameLabel) {
			return null;
		}
		const text = (nameLabel ?? "").trim();
		if (!text) {
			return null;
		}
		const fontSize = 34;
		const horizontalPad = 16;
		const verticalPad = 8;
		const canvas = document.createElement("canvas");
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return null;
		}
		ctx.font = `700 ${fontSize}px 'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif`;
		const textWidth = Math.ceil(ctx.measureText(text).width);
		canvas.width = Math.max(128, textWidth + horizontalPad * 2);
		canvas.height = fontSize + verticalPad * 2;

		const paint = canvas.getContext("2d");
		if (!paint) {
			return null;
		}
		paint.clearRect(0, 0, canvas.width, canvas.height);
		paint.font = `700 ${fontSize}px 'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif`;
		paint.textAlign = "center";
		paint.textBaseline = "middle";
		const drawX = canvas.width / 2;
		const drawY = canvas.height / 2 + 1;
		paint.fillStyle = "rgba(0, 0, 0, 0.95)";
		paint.fillText(text.toUpperCase(), drawX + 4, drawY + 4);
		paint.fillStyle = "#ffffff";
		paint.fillText(text.toUpperCase(), drawX, drawY);

		const texture = new CanvasTexture(canvas);
		texture.colorSpace = SRGBColorSpace;
		texture.minFilter = NearestFilter;
		texture.magFilter = NearestFilter;
		texture.generateMipmaps = false;
		texture.needsUpdate = true;
		return { texture, width: canvas.width, height: canvas.height };
	}, [nameLabel, showNameLabel]);

	useEffect(() => {
		return () => {
			nameLabelData?.texture.dispose();
		};
	}, [nameLabelData]);

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

	useEffect(() => {
		if (wasAliveRef.current && !isAlive) {
			deadFlingRef.current = 1.1;
			deathSpinSeedRef.current = Math.random() * Math.PI * 2;
			deadSpinVelRef.current = {
				x: 8.5 + Math.random() * 2.4,
				y: 9.3 + Math.random() * 2.4,
				z: 7.9 + Math.random() * 2.4,
			};
		}
		if (!wasAliveRef.current && isAlive) {
			deadFlingRef.current = 0;
		}
		wasAliveRef.current = isAlive;
	}, [isAlive]);

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
			if (!isAlive) {
				const speed = movementAmount / Math.max(dt, 0.0001);
				if (speed > 0.2) {
					deadFlingRef.current = Math.min(1.25, deadFlingRef.current + dt * 0.55);
				}
				deadFlingRef.current = Math.max(0, deadFlingRef.current - dt);
				const flinging = deadFlingRef.current > 0;
				if (flinging) {
					const t = performance.now() / 1000 + deathSpinSeedRef.current;
					const progress = 1 - Math.min(1, deadFlingRef.current / 1.1);
					const arc = 4 * progress * (1 - progress);
					const height = 0.1 + arc * 1.55;
					visual.position.set(0, height, 0);
					visual.scale.set(1, 1, 1);
					const damping = Math.exp(-dt * 1.8);
					deadSpinVelRef.current.x *= damping;
					deadSpinVelRef.current.y *= damping;
					deadSpinVelRef.current.z *= damping;
					visual.rotation.x += dt * (deadSpinVelRef.current.x + Math.sin(t * 2.2) * 0.7);
					visual.rotation.y += dt * (deadSpinVelRef.current.y + Math.cos(t * 2.6) * 0.8);
					visual.rotation.z += dt * (deadSpinVelRef.current.z + Math.sin(t * 2.0) * 0.6);
				} else {
					visual.position.set(0, 0.1, 0);
					visual.scale.set(1, 1, 1);
					visual.rotation.y += (facingAngleRef.current - visual.rotation.y) * (1 - Math.exp(-dt * 12));
					visual.rotation.x += (-Math.PI / 2 - visual.rotation.x) * (1 - Math.exp(-dt * 16));
					visual.rotation.z += (0 - visual.rotation.z) * (1 - Math.exp(-dt * 16));
				}
			} else {
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
		}

		if (isAlive) {
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
		} else {
			if (leftEyeRef.current) {
				leftEyeRef.current.scale.y = 1;
			}
			if (rightEyeRef.current) {
				rightEyeRef.current.scale.y = 1;
			}
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
						{isAlive ? (
							<mesh position={[0.01, -0.01, 0.075]}>
								<sphereGeometry args={[0.048, 14, 14]} />
								<meshToonMaterial color="#111111" />
							</mesh>
						) : (
							<group position={[0.01, -0.01, 0.12]}>
								<mesh rotation={[0, 0, Math.PI / 4]}>
									<boxGeometry args={[0.14, 0.022, 0.01]} />
									<meshToonMaterial color="#111111" />
								</mesh>
								<mesh rotation={[0, 0, -Math.PI / 4]}>
									<boxGeometry args={[0.14, 0.022, 0.01]} />
									<meshToonMaterial color="#111111" />
								</mesh>
							</group>
						)}
					</group>
					<group ref={rightEyeRef} position={[0.13, 0, -0.05]}>
						<mesh castShadow={isLocal}>
							<sphereGeometry args={[0.12, 18, 18]} />
							<meshToonMaterial color="#fffaf0" />
						</mesh>
						{isAlive ? (
							<mesh position={[-0.01, -0.01, 0.075]}>
								<sphereGeometry args={[0.048, 14, 14]} />
								<meshToonMaterial color="#111111" />
							</mesh>
						) : (
							<group position={[-0.01, -0.01, 0.12]}>
								<mesh rotation={[0, 0, Math.PI / 4]}>
									<boxGeometry args={[0.14, 0.022, 0.01]} />
									<meshToonMaterial color="#111111" />
								</mesh>
								<mesh rotation={[0, 0, -Math.PI / 4]}>
									<boxGeometry args={[0.14, 0.022, 0.01]} />
									<meshToonMaterial color="#111111" />
								</mesh>
							</group>
						)}
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
							color={interactionStyle === "danger" ? "#ff8b8b" : "#7cd6ff"}
							emissive={interactionStyle === "danger" ? "#ff3d3d" : "#2db9ff"}
							emissiveIntensity={0.9}
							side={DoubleSide}
							depthWrite={false}
							polygonOffset
							polygonOffsetFactor={-1}
						/>
					</mesh>
				</group>
			) : null}
			{showNameLabel && nameLabelData ? (
				<sprite
					position={[0, 2.55, 0]}
					scale={[
						(nameLabelData.width / nameLabelData.height) * 0.52,
						0.52,
						1,
					]}
					renderOrder={8}
				>
					<spriteMaterial
						map={nameLabelData.texture}
						transparent
						depthWrite={false}
						depthTest={false}
					/>
				</sprite>
			) : null}
		</group>
	);
}
