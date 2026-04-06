import { useEffect } from "react";
import type { GameServerMessages } from "@vibejam/shared";
import { useRoom } from "../../colyseus/roomContext";

type VaultEvent = Extract<GameServerMessages["interactable_event"], { kind: "vault" }>;

function playVaultTone(event: VaultEvent) {
	const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!AudioContextCtor) {
		return;
	}
	const context = new AudioContextCtor();
	const frequencies =
		event.action === "card_inserted"
			? [event.color === "blue" ? 620 : 520]
			: event.action === "unlocked"
				? [460, 620]
				: event.action === "completed"
					? [520, 660, 780, 940, 1120]
					: [760];
	for (let i = 0; i < frequencies.length; i++) {
		const start = context.currentTime + i * 0.11;
		const end = start + 0.1;
		const oscillator = context.createOscillator();
		const gain = context.createGain();
		oscillator.type = "triangle";
		oscillator.frequency.value = frequencies[i]!;
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(0.04, start + 0.012);
		gain.gain.exponentialRampToValueAtTime(0.0001, end);
		oscillator.connect(gain);
		gain.connect(context.destination);
		oscillator.start(start);
		oscillator.stop(end + 0.01);
	}
	window.setTimeout(() => {
		void context.close();
	}, event.action === "completed" ? 1300 : 550);
}

export function useVaultAudio(enabled = true) {
	const { room } = useRoom();

	useEffect(() => {
		if (!enabled || !room) {
			return;
		}
		return room.onMessage<GameServerMessages["interactable_event"]>("interactable_event", (message) => {
			if (message.kind !== "vault") {
				return;
			}
			playVaultTone(message);
		});
	}, [enabled, room]);
}
