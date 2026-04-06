import { useEffect } from "react";
import type { GameServerMessages } from "@vibejam/shared";
import { useRoom } from "../../colyseus/roomContext";

type KeycardEvent = Extract<GameServerMessages["interactable_event"], { kind: "keycard" }>;

function playKeycardChime(action: KeycardEvent["action"]) {
	const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!AudioContextCtor) {
		return;
	}
	const context = new AudioContextCtor();
	const frequencies = action === "picked_up" ? [660, 880] : [880, 660];
	const noteDuration = 0.1;
	const gap = 0.03;
	for (let i = 0; i < frequencies.length; i++) {
		const start = context.currentTime + i * (noteDuration + gap);
		const end = start + noteDuration;
		const oscillator = context.createOscillator();
		const gain = context.createGain();
		oscillator.type = "triangle";
		oscillator.frequency.value = frequencies[i]!;
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(0.045, start + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, end);
		oscillator.connect(gain);
		gain.connect(context.destination);
		oscillator.start(start);
		oscillator.stop(end + 0.01);
	}
	window.setTimeout(() => {
		void context.close();
	}, 450);
}

export function useKeycardAudio(enabled = true) {
	const { room } = useRoom();

	useEffect(() => {
		if (!enabled || !room) {
			return;
		}
		return room.onMessage<GameServerMessages["interactable_event"]>("interactable_event", (message) => {
			if (message.kind !== "keycard") {
				return;
			}
			playKeycardChime(message.action);
		});
	}, [enabled, room]);
}
