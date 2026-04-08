export type MovementKeyCode = "KeyW" | "KeyA" | "KeyS" | "KeyD" | "KeyE" | "KeyQ";

export type KeyboardLikeEvent = {
	code: MovementKeyCode;
	repeat?: boolean;
};

export type KeyboardInputSource = {
	subscribe: (onDown: (event: KeyboardLikeEvent) => void, onUp: (event: KeyboardLikeEvent) => void) => () => void;
};

const MOVEMENT_CODES = new Set<MovementKeyCode>(["KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyQ"]);

export function createWindowKeyboardInputSource(): KeyboardInputSource {
	return {
		subscribe(onDown, onUp) {
			const handleDown = (event: KeyboardEvent) => {
				if (!MOVEMENT_CODES.has(event.code as MovementKeyCode)) {
					return;
				}
				onDown({ code: event.code as MovementKeyCode, repeat: event.repeat });
			};
			const handleUp = (event: KeyboardEvent) => {
				if (!MOVEMENT_CODES.has(event.code as MovementKeyCode)) {
					return;
				}
				onUp({ code: event.code as MovementKeyCode, repeat: event.repeat });
			};
			window.addEventListener("keydown", handleDown);
			window.addEventListener("keyup", handleUp);
			return () => {
				window.removeEventListener("keydown", handleDown);
				window.removeEventListener("keyup", handleUp);
			};
		},
	};
}

export function createVirtualKeyboardInputSource(): KeyboardInputSource & {
	emitDown: (event: KeyboardLikeEvent) => void;
	emitUp: (event: KeyboardLikeEvent) => void;
} {
	const downListeners = new Set<(event: KeyboardLikeEvent) => void>();
	const upListeners = new Set<(event: KeyboardLikeEvent) => void>();
	return {
		subscribe(onDown, onUp) {
			downListeners.add(onDown);
			upListeners.add(onUp);
			return () => {
				downListeners.delete(onDown);
				upListeners.delete(onUp);
			};
		},
		emitDown(event) {
			if (!MOVEMENT_CODES.has(event.code)) {
				return;
			}
			for (const listener of downListeners) {
				listener(event);
			}
		},
		emitUp(event) {
			if (!MOVEMENT_CODES.has(event.code)) {
				return;
			}
			for (const listener of upListeners) {
				listener(event);
			}
		},
	};
}
