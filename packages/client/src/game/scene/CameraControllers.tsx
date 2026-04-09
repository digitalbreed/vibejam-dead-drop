import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3 } from "three";

const CAMERA_OFFSET = { x: 0, y: 8.5, z: 14 };
const ORBIT_MIN_RADIUS = 4;
const ORBIT_MAX_RADIUS = 60;
const ORBIT_MIN_POLAR = 0.2;
const ORBIT_MAX_POLAR = Math.PI - 0.2;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function ThirdPersonCamera({
	targetRef,
	enabled,
}: {
	targetRef: MutableRefObject<Vector3>;
	enabled: boolean;
}) {
	const { camera } = useThree();
	useFrame(() => {
		if (!enabled) {
			return;
		}
		const target = targetRef.current;
		camera.position.set(target.x + CAMERA_OFFSET.x, target.y + CAMERA_OFFSET.y, target.z + CAMERA_OFFSET.z);
		camera.lookAt(target);
	});
	return null;
}

export function DebugOrbitCamera({
	targetRef,
	enabled,
}: {
	targetRef: MutableRefObject<Vector3>;
	enabled: boolean;
}) {
	const { camera, gl } = useThree();
	const orbitRef = useRef({
		radius: 16,
		theta: 0,
		phi: 1.1,
		dragging: false,
		lastX: 0,
		lastY: 0,
		initialized: false,
	});

	useEffect(() => {
		orbitRef.current.dragging = false;
		if (!enabled) {
			return;
		}
		orbitRef.current.initialized = false;
		const element = gl.domElement;

		const onPointerDown = (e: PointerEvent) => {
			if (e.button !== 0) {
				return;
			}
			orbitRef.current.dragging = true;
			orbitRef.current.lastX = e.clientX;
			orbitRef.current.lastY = e.clientY;
			element.setPointerCapture(e.pointerId);
		};
		const onPointerMove = (e: PointerEvent) => {
			if (!orbitRef.current.dragging) {
				return;
			}
			const dx = e.clientX - orbitRef.current.lastX;
			const dy = e.clientY - orbitRef.current.lastY;
			orbitRef.current.lastX = e.clientX;
			orbitRef.current.lastY = e.clientY;
			orbitRef.current.theta -= dx * 0.007;
			orbitRef.current.phi = clamp(orbitRef.current.phi + dy * 0.007, ORBIT_MIN_POLAR, ORBIT_MAX_POLAR);
		};
		const onPointerUp = (e: PointerEvent) => {
			orbitRef.current.dragging = false;
			if (element.hasPointerCapture(e.pointerId)) {
				element.releasePointerCapture(e.pointerId);
			}
		};
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			const zoomScale = Math.exp(e.deltaY * 0.0015);
			orbitRef.current.radius = clamp(orbitRef.current.radius * zoomScale, ORBIT_MIN_RADIUS, ORBIT_MAX_RADIUS);
		};

		element.addEventListener("pointerdown", onPointerDown);
		element.addEventListener("pointermove", onPointerMove);
		element.addEventListener("pointerup", onPointerUp);
		element.addEventListener("pointercancel", onPointerUp);
		element.addEventListener("pointerleave", onPointerUp);
		element.addEventListener("wheel", onWheel, { passive: false });
		return () => {
			element.removeEventListener("pointerdown", onPointerDown);
			element.removeEventListener("pointermove", onPointerMove);
			element.removeEventListener("pointerup", onPointerUp);
			element.removeEventListener("pointercancel", onPointerUp);
			element.removeEventListener("pointerleave", onPointerUp);
			element.removeEventListener("wheel", onWheel);
		};
	}, [enabled, gl]);

	useFrame(() => {
		if (!enabled) {
			return;
		}
		const target = targetRef.current;
		if (!orbitRef.current.initialized) {
			const offsetX = camera.position.x - target.x;
			const offsetY = camera.position.y - target.y;
			const offsetZ = camera.position.z - target.z;
			const distance = Math.hypot(offsetX, offsetY, offsetZ);
			if (distance > 0.001) {
				orbitRef.current.radius = clamp(distance, ORBIT_MIN_RADIUS, ORBIT_MAX_RADIUS);
				orbitRef.current.theta = Math.atan2(offsetX, offsetZ);
				orbitRef.current.phi = clamp(Math.acos(clamp(offsetY / distance, -1, 1)), ORBIT_MIN_POLAR, ORBIT_MAX_POLAR);
			}
			orbitRef.current.initialized = true;
		}

		const sinPhi = Math.sin(orbitRef.current.phi);
		camera.position.set(
			target.x + orbitRef.current.radius * sinPhi * Math.sin(orbitRef.current.theta),
			target.y + orbitRef.current.radius * Math.cos(orbitRef.current.phi),
			target.z + orbitRef.current.radius * sinPhi * Math.cos(orbitRef.current.theta),
		);
		camera.lookAt(target);
	});

	return null;
}

export function ThrottledInvalidator({ fps }: { fps: number }) {
	const { invalidate } = useThree();

	useEffect(() => {
		if (!Number.isFinite(fps) || fps <= 0) {
			return;
		}
		const intervalMs = Math.max(16, Math.round(1000 / fps));
		const intervalId = window.setInterval(() => {
			invalidate();
		}, intervalMs);
		return () => {
			window.clearInterval(intervalId);
		};
	}, [fps, invalidate]);

	return null;
}
