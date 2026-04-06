import { useEffect } from "react";
import type { GameServerMessages } from "@vibejam/shared";
import { useRoom } from "../../colyseus/roomContext";

type DoorEvent = Extract<GameServerMessages["interactable_event"], { kind: "door" }>;

function playDoorTone(action: DoorEvent["action"]) {
	const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!AudioContextCtor) {
		return;
	}
	const context = new AudioContextCtor();
	const oscillator = context.createOscillator();
	const gain = context.createGain();
	oscillator.type = "triangle";
	oscillator.frequency.value = action === "opened" ? 480 : 320;
	gain.gain.setValueAtTime(0.0001, context.currentTime);
	gain.gain.exponentialRampToValueAtTime(0.04, context.currentTime + 0.01);
	gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.16);
	oscillator.connect(gain);
	gain.connect(context.destination);
	oscillator.start();
	oscillator.stop(context.currentTime + 0.18);
	void oscillator.addEventListener("ended", () => {
		void context.close();
	});
}

export function useDoorAudio(enabled = true) {
	const { room } = useRoom();

	useEffect(() => {
		if (!enabled || !room) {
			return;
		}
		return room.onMessage<GameServerMessages["interactable_event"]>("interactable_event", (message) => {
			if (message.kind !== "door") {
				return;
			}
			playDoorTone(message.action);
		});
	}, [enabled, room]);
}
