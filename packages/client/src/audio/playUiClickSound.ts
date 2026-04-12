export function playUiClickSound(volume = 0.14): void {
	if (typeof window === "undefined") {
		return;
	}
	const AudioContextCtor =
		window.AudioContext ??
		(window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!AudioContextCtor) {
		return;
	}

	const ctx = new AudioContextCtor();
	const now = ctx.currentTime;
	const duration = 0.075;

	const osc = ctx.createOscillator();
	osc.type = "square";
	osc.frequency.setValueAtTime(1700, now);
	osc.frequency.exponentialRampToValueAtTime(980, now + duration);

	const highPass = ctx.createBiquadFilter();
	highPass.type = "highpass";
	highPass.frequency.setValueAtTime(520, now);

	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.0001, now);
	gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.004);
	gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

	osc.connect(highPass);
	highPass.connect(gain);
	gain.connect(ctx.destination);

	osc.start(now);
	osc.stop(now + duration);

	window.setTimeout(() => {
		void ctx.close();
	}, 220);
}
