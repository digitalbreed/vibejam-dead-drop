import { useEffect, useRef } from "react";

interface AudioState {
	context: AudioContext | null;
	intervalId: number | null;
}

export function useTickerAudio(isVisible: boolean) {
	const audioRef = useRef<AudioState>({ context: null, intervalId: null });

	useEffect(() => {
		if (isVisible) {
			// Start beeping
			if (!audioRef.current.context) {
				const AudioContextCtor =
					window.AudioContext ??
					(window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
				if (AudioContextCtor) {
					audioRef.current.context = new AudioContextCtor();
				}
			}

			const context = audioRef.current.context;
			if (!context) return;

			const playBeep = () => {
				if (!context || context.state === "closed") return;

				const oscillator = context.createOscillator();
				const gain = context.createGain();

				// Random frequency between 600-900Hz for morse-like effect
				const frequency = 600 + Math.random() * 300;
				// Random duration between 60-100ms
				const duration = 0.06 + Math.random() * 0.04;

				oscillator.type = "triangle";
				oscillator.frequency.value = frequency;

				const now = context.currentTime;
				gain.gain.setValueAtTime(0.0001, now);
				gain.gain.exponentialRampToValueAtTime(0.08, now + 0.005);
				gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

				oscillator.connect(gain);
				gain.connect(context.destination);
				oscillator.start(now);
				oscillator.stop(now + duration + 0.01);
			};

			// Play first beep immediately
			playBeep();

			// Random interval between beeps (80-150ms)
			const scheduleNextBeep = (): number => {
				const interval = 80 + Math.random() * 70;
				return window.setTimeout(() => {
					playBeep();
					if (audioRef.current.context && audioRef.current.context.state !== "closed") {
						audioRef.current.intervalId = scheduleNextBeep();
					}
				}, interval);
			};

			audioRef.current.intervalId = scheduleNextBeep();

			return () => {
				if (audioRef.current.intervalId !== null) {
					window.clearTimeout(audioRef.current.intervalId);
					audioRef.current.intervalId = null;
				}
			};
		} else {
			// Stop beeping and close audio context
			if (audioRef.current.intervalId !== null) {
				window.clearTimeout(audioRef.current.intervalId);
				audioRef.current.intervalId = null;
			}
			if (audioRef.current.context) {
				void audioRef.current.context.close();
				audioRef.current.context = null;
			}
		}
	}, [isVisible]);
}
