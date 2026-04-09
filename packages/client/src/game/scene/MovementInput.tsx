import { useEffect, useRef, type MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import { Vector2 } from "three";
import { type GameClientMessages } from "@vibejam/shared";
import { useRoom } from "../../colyseus/roomContext";
import {
	createWindowKeyboardInputSource,
	type KeyboardInputSource,
	type KeyboardLikeEvent,
} from "../input/keyboardInput";

const SHORT_PRESS_MAX_MS = 220;
const HOLD_START_DELAY_MS = 180;

const windowKeyboardInputSource = createWindowKeyboardInputSource();

export function MovementInput({
	inputRef,
	enabled,
	inputSource,
	deadMode,
}: {
	inputRef: MutableRefObject<Vector2>;
	enabled: boolean;
	inputSource?: KeyboardInputSource;
	deadMode: boolean;
}) {
	const { room } = useRoom();
	const keys = useRef({ KeyW: false, KeyA: false, KeyS: false, KeyD: false });
	const interactHoldRef = useRef<{
		pressed: boolean;
		holdSent: boolean;
		startMs: number;
		timerId: number | null;
	}>({ pressed: false, holdSent: false, startMs: 0, timerId: null });
	const trapHoldRef = useRef<{
		pressed: boolean;
		holdSent: boolean;
		startMs: number;
		timerId: number | null;
	}>({ pressed: false, holdSent: false, startMs: 0, timerId: null });

	const source = inputSource ?? windowKeyboardInputSource;
	const deadStopSentRef = useRef(false);

	useEffect(() => {
		const onDown = (e: KeyboardLikeEvent) => {
			if (!enabled) {
				return;
			}
			if (!deadMode && e.code === "KeyE" && !e.repeat && room) {
				interactHoldRef.current.pressed = true;
				interactHoldRef.current.holdSent = false;
				interactHoldRef.current.startMs = performance.now();
				if (interactHoldRef.current.timerId !== null) {
					window.clearTimeout(interactHoldRef.current.timerId);
				}
				interactHoldRef.current.timerId = window.setTimeout(() => {
					if (!interactHoldRef.current.pressed || interactHoldRef.current.holdSent) {
						return;
					}
					interactHoldRef.current.holdSent = true;
					const holdPayload: GameClientMessages["interact_hold"] = { active: true };
					room.send("interact_hold", holdPayload);
				}, HOLD_START_DELAY_MS);
			}
			if (!deadMode && e.code === "KeyQ" && !e.repeat && room) {
				trapHoldRef.current.pressed = true;
				trapHoldRef.current.holdSent = false;
				trapHoldRef.current.startMs = performance.now();
				if (trapHoldRef.current.timerId !== null) {
					window.clearTimeout(trapHoldRef.current.timerId);
				}
				trapHoldRef.current.timerId = window.setTimeout(() => {
					if (!trapHoldRef.current.pressed || trapHoldRef.current.holdSent) {
						return;
					}
					trapHoldRef.current.holdSent = true;
					const holdPayload: GameClientMessages["trap_hold"] = { active: true };
					room.send("trap_hold", holdPayload);
				}, HOLD_START_DELAY_MS);
			}
			if (e.code in keys.current) {
				keys.current[e.code as keyof typeof keys.current] = true;
			}
		};
		const onUp = (e: KeyboardLikeEvent) => {
			if (e.code === "KeyE" && room) {
				const heldMs = performance.now() - interactHoldRef.current.startMs;
				interactHoldRef.current.pressed = false;
				if (interactHoldRef.current.timerId !== null) {
					window.clearTimeout(interactHoldRef.current.timerId);
					interactHoldRef.current.timerId = null;
				}
				if (interactHoldRef.current.holdSent) {
					const holdPayload: GameClientMessages["interact_hold"] = { active: false };
					room.send("interact_hold", holdPayload);
				}
				if (!deadMode && !interactHoldRef.current.holdSent && heldMs <= SHORT_PRESS_MAX_MS) {
					const interactPayload: GameClientMessages["interact"] = {};
					room.send("interact", interactPayload);
				}
				interactHoldRef.current.holdSent = false;
			}
			if (e.code === "KeyQ" && room) {
				trapHoldRef.current.pressed = false;
				if (trapHoldRef.current.timerId !== null) {
					window.clearTimeout(trapHoldRef.current.timerId);
					trapHoldRef.current.timerId = null;
				}
				if (trapHoldRef.current.holdSent) {
					const holdPayload: GameClientMessages["trap_hold"] = { active: false };
					room.send("trap_hold", holdPayload);
				}
				trapHoldRef.current.holdSent = false;
			}
			if (e.code in keys.current) {
				keys.current[e.code as keyof typeof keys.current] = false;
			}
		};
		return source.subscribe(onDown, onUp);
	}, [deadMode, enabled, room, source]);

	useFrame(() => {
		if (!room) {
			return;
		}
		if (!enabled) {
			keys.current.KeyW = false;
			keys.current.KeyA = false;
			keys.current.KeyS = false;
			keys.current.KeyD = false;
			inputRef.current.set(0, 0);
			if (interactHoldRef.current.timerId !== null) {
				window.clearTimeout(interactHoldRef.current.timerId);
				interactHoldRef.current.timerId = null;
			}
			if (interactHoldRef.current.holdSent) {
				interactHoldRef.current.pressed = false;
				interactHoldRef.current.holdSent = false;
				const holdPayload: GameClientMessages["interact_hold"] = { active: false };
				room.send("interact_hold", holdPayload);
			}
			if (trapHoldRef.current.timerId !== null) {
				window.clearTimeout(trapHoldRef.current.timerId);
				trapHoldRef.current.timerId = null;
			}
			if (trapHoldRef.current.holdSent) {
				trapHoldRef.current.pressed = false;
				trapHoldRef.current.holdSent = false;
				const holdPayload: GameClientMessages["trap_hold"] = { active: false };
				room.send("trap_hold", holdPayload);
			}
			const payload: GameClientMessages["input"] = { x: 0, z: 0 };
			room.send("input", payload);
			return;
		}
		const k = keys.current;
		let x = 0;
		let z = 0;
		if (k.KeyW) {
			z -= 1;
		}
		if (k.KeyS) {
			z += 1;
		}
		if (k.KeyA) {
			x -= 1;
		}
		if (k.KeyD) {
			x += 1;
		}
		const len = Math.hypot(x, z);
		const nx = len > 1 ? x / len : x;
		const nz = len > 1 ? z / len : z;
		inputRef.current.set(nx, nz);
		if (deadMode) {
			if (!deadStopSentRef.current) {
				const payload: GameClientMessages["input"] = { x: 0, z: 0 };
				room.send("input", payload);
				deadStopSentRef.current = true;
			}
			return;
		}
		deadStopSentRef.current = false;
		const payload: GameClientMessages["input"] = { x: nx, z: nz };
		room.send("input", payload);
	});

	return null;
}
