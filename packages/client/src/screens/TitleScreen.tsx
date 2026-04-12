import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useBackgroundMusic } from "../audio/BackgroundMusicContext";
import { playUiClickSound } from "../audio/playUiClickSound";

type TitleScreenProps = {
	onJoin: (params: { operatorName: string; gameCode: string }) => void;
};

type ShredParticle = {
	id: number;
	leftPct: number;
	heightRem: number;
	fallRem: number;
	driftRem: number;
	rotDeg: number;
	durationMs: number;
};

const PAPER_CYCLE_MS = 2700;
const PAPER_FEED_START_RATIO = 0.64;
const PAPER_FEED_END_RATIO = 0.92;
const OPERATOR_NAME_STORAGE_KEY = "vibejam.operatorName";

function playShredderSound(volume = 0.18): void {
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
	const duration = 0.78;

	const masterGain = ctx.createGain();
	masterGain.gain.setValueAtTime(0.0001, now);
	masterGain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.035);
	masterGain.gain.setValueAtTime(Math.max(0.0001, volume * 0.95), now + 0.16);
	masterGain.gain.setValueAtTime(Math.max(0.0001, volume * 0.9), now + 0.58);
	masterGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

	const toneA = ctx.createOscillator();
	toneA.type = "square";
	toneA.frequency.setValueAtTime(980, now);
	toneA.frequency.linearRampToValueAtTime(920, now + duration);

	const toneB = ctx.createOscillator();
	toneB.type = "square";
	toneB.frequency.setValueAtTime(1320, now);
	toneB.frequency.linearRampToValueAtTime(1240, now + duration);

	const toneMix = ctx.createGain();
	toneMix.gain.setValueAtTime(0.05, now);

	const noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
	const channel = noiseBuffer.getChannelData(0);
	for (let i = 0; i < channel.length; i++) {
		channel[i] = (Math.random() * 2 - 1) * 0.9;
	}
	const noiseSource = ctx.createBufferSource();
	noiseSource.buffer = noiseBuffer;
	const noiseGain = ctx.createGain();
	noiseGain.gain.setValueAtTime(0.62, now);

	const lowPass = ctx.createBiquadFilter();
	lowPass.type = "lowpass";
	lowPass.frequency.setValueAtTime(3000, now);
	lowPass.Q.setValueAtTime(0.2, now);

	const highPass = ctx.createBiquadFilter();
	highPass.type = "highpass";
	highPass.frequency.setValueAtTime(700, now);

	const bandPass = ctx.createBiquadFilter();
	bandPass.type = "bandpass";
	bandPass.frequency.setValueAtTime(1700, now);
	bandPass.Q.setValueAtTime(0.38, now);

	toneA.connect(toneMix);
	toneB.connect(toneMix);
	noiseSource.connect(noiseGain);
	noiseGain.connect(highPass);
	toneMix.connect(highPass);
	highPass.connect(bandPass);
	bandPass.connect(lowPass);
	lowPass.connect(masterGain);
	masterGain.connect(ctx.destination);

	noiseSource.start(now);
	toneA.start(now);
	toneB.start(now);
	noiseSource.stop(now + duration);
	toneA.stop(now + duration);
	toneB.stop(now + duration);

	window.setTimeout(() => {
		void ctx.close();
	}, Math.ceil((duration + 0.2) * 1000));
}

export function TitleScreen({ onJoin }: TitleScreenProps) {
	const titleMusicTrack = useMemo(
		() => ({
			src: "/mod01.ogg",
			volume: 0.45,
			loop: true,
		}),
		[],
	);
	useBackgroundMusic(titleMusicTrack, { priority: 10, fadeMs: 1000 });

	const [shreds, setShreds] = useState<ShredParticle[]>([]);
	const [operatorName, setOperatorName] = useState("");
	const [gameCode, setGameCode] = useState("");
	const nextShredIdRef = useRef(1);
	const lastShredSoundCycleRef = useRef(-1);
	const paperCycleStartMsRef = useRef(typeof performance !== "undefined" ? performance.now() : 0);

	useEffect(() => {
		lastShredSoundCycleRef.current = -1;
		const cycleStartMs = paperCycleStartMsRef.current;
		const emitter = window.setInterval(() => {
			const elapsedMs = Math.max(0, performance.now() - cycleStartMs);
			const phase = (elapsedMs % PAPER_CYCLE_MS) / PAPER_CYCLE_MS;
			if (phase < PAPER_FEED_START_RATIO || phase > PAPER_FEED_END_RATIO) {
				return;
			}
			const cycle = Math.floor(elapsedMs / PAPER_CYCLE_MS);
			if (cycle !== lastShredSoundCycleRef.current) {
				lastShredSoundCycleRef.current = cycle;
				playShredderSound(0.05);
			}
			setShreds((current) => {
				const next = current.slice(-80);
				for (let i = 0; i < 2; i++) {
					next.push({
						id: nextShredIdRef.current++,
						leftPct: 1 + Math.random() * 98,
						heightRem: 4 + Math.random() * 2.2,
						fallRem: 16.5 + Math.random() * 7.5,
						driftRem: (Math.random() - 0.5) * 1.2,
						rotDeg: (Math.random() - 0.5) * 36,
						durationMs: 980 + Math.random() * 320,
					});
				}
				return next;
			});
		}, 70);

		return () => {
			window.clearInterval(emitter);
		};
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const saved = window.localStorage.getItem(OPERATOR_NAME_STORAGE_KEY);
		if (typeof saved === "string" && saved.trim().length > 0) {
			setOperatorName(saved.trim());
		}
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const trimmed = operatorName.trim();
		if (trimmed.length > 0) {
			window.localStorage.setItem(OPERATOR_NAME_STORAGE_KEY, trimmed);
			return;
		}
		window.localStorage.removeItem(OPERATOR_NAME_STORAGE_KEY);
	}, [operatorName]);

	const removeShred = (id: number) => {
		setShreds((current) => current.filter((shred) => shred.id !== id));
	};

	return (
		<div
			style={{
				minHeight: "100%",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: "1.2rem",
				padding: "2rem 1.2rem",
				textAlign: "center",
				position: "relative",
				overflow: "hidden",
				//background: "#00324f",
				background:
					"radial-gradient(ellipse at center, rgba(15,25,40,0.92) 0%, rgba(8,12,18,0.96) 100%)",

			}}
		>
			{/* SVG cel-shaded corner curve */}
			{/* <svg
				style={{
					position: "absolute",
					inset: 0,
					width: "300%",
					height: "400%",
					pointerEvents: "none",
				}}
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
			>
				<ellipse cx="120" cy="0" rx="120" ry="100" fill="#002236" />
			</svg> */}
			<div
				style={{
					position: "relative",
					width: "min(34rem, 94vw)",
				}}
			>
				<div
					style={{
						position: "absolute",
						left: "50%",
						top: "-13rem",
						transform: "translateX(-50%)",
						width: "75%",
						height: "13rem",
						pointerEvents: "none",
						zIndex: 0,
					}}
				>
					<div className="title-paper-feed">
						<div className="title-paper-lines">
							{Array.from({ length: 14 }, (_, i) => (
								<div key={`paper-line-${i}`} className="title-paper-line-row">
									{Array.from({ length: 4 + (i % 4) }, (_, j) => {
										const widthRem = 1.6 + (((i * 17 + j * 29) % 11) / 10) * 2.7;
										return (
											<span
												key={`paper-line-${i}-word-${j}`}
												className={`title-paper-word ${((i * 13 + j * 7) % 9 === 0) ? "title-paper-word-redacted" : ""}`}
												style={{ width: `${widthRem.toFixed(2)}rem` }}
											/>
										);
									})}
								</div>
							))}
						</div>
					</div>
				</div>
				<div
					style={{
						position: "absolute",
						left: "50%",
						bottom: "-2.35rem",
						transform: "translateX(-50%)",
						width: "75%",
						height: "4.2rem",
						pointerEvents: "none",
						zIndex: 0,
					}}
				>
					{shreds.map((shred) => {
						const stripStyle: CSSProperties & Record<string, string> = {
							left: `${shred.leftPct}%`,
							"--shred-height": `${shred.heightRem}rem`,
							"--shred-fall": `${shred.fallRem}rem`,
							"--shred-drift": `${shred.driftRem}rem`,
							"--shred-rot": `${shred.rotDeg}deg`,
							animationDuration: `${shred.durationMs}ms`,
						};
						return (
							<span
								key={shred.id}
								className="title-paper-shred-particle"
								style={stripStyle}
								onAnimationEnd={() => removeShred(shred.id)}
							/>
						);
					})}
				</div>
				<div
					className="title-panel"
					style={{
					position: "relative",
					zIndex: 2,
					padding: "2rem 1.6rem",
					border: "3px solid #1a3045",
					background: "linear-gradient(165deg, transparent 58%, rgba(20,40,60,0.5) 58%), #0c1a2a",
					boxShadow: "4px 4px 0 #050a10, 8px 8px 0 rgba(0,0,0,0.3)",
				}}
			>
				<h1
					style={{
						margin: 0,
						fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
						fontSize: "clamp(2.5rem, 11vw, 4.8rem)",
						letterSpacing: "0.06em",
						lineHeight: 0.9,
						textTransform: "uppercase",
						textShadow: "0 0 24px rgba(160, 220, 255, 0.42)",
					}}
				>
					The Island Files
				</h1>
				<p style={{ margin: "0.9rem 0 0", opacity: 0.9, lineHeight: 1.45 }}>
					Corrupt memos, missing evidence, and too many keycards. Pick your operation and start the office espionage.
				</p>
				<div style={{ display: "flex", flexDirection: "column", gap: "1rem", width: "min(22rem, 100%)", margin: "1.35rem auto 0" }}>
				<label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", textAlign: "left" }}>
					<span style={{
						fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
						fontSize: "0.95rem",
						letterSpacing: "0.1em",
						textTransform: "uppercase",
						color: "#8ab4d8",
					}}>
						Operator name
					</span>
					<input
						type="text"
						value={operatorName}
						onChange={(e) => setOperatorName(e.target.value)}
						placeholder="e.g. Mata Hari"
						style={{
							padding: "0.7rem 1rem",
							borderRadius: "6px",
							border: "2px solid #253545",
							background: "linear-gradient(180deg, #0f1a25 0%, #0f1a25 50%, #0a1218 51%, #0a1218 100%)",
							color: "#d6e0ea",
							fontSize: "0.95rem",
							outline: "none",
						}}
					/>
					<span style={{ fontSize: "0.75rem", color: "#607890", fontStyle: "italic" }}>
						<strong>Optional:</strong> auto-assigned if empty
					</span>
				</label>
				<label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", textAlign: "left" }}>
					<span style={{
						fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
						fontSize: "0.95rem",
						letterSpacing: "0.1em",
						textTransform: "uppercase",
						color: "#8ab4d8",
					}}>
						Game code
					</span>
					<input
						type="text"
						value={gameCode}
						onChange={(e) =>
							setGameCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))
						}
						placeholder="e.g. ABC123"
						style={{
							padding: "0.7rem 1rem",
							borderRadius: "6px",
							border: "2px solid #253545",
							background: "linear-gradient(180deg, #0f1a25 0%, #0f1a25 50%, #0a1218 51%, #0a1218 100%)",
							color: "#d6e0ea",
							fontSize: "0.95rem",
							outline: "none",
						}}
					/>
					<span style={{ fontSize: "0.75rem", color: "#607890", fontStyle: "italic" }}>
					<strong>Optional:</strong> enter a specific room code, or leave empty for next best public lobby
					</span>
				</label>
				<button
					type="button"
					className="comic-agent-button"
					onClick={() =>
						{
							playUiClickSound();
							const trimmedOperatorName = operatorName.trim();
							if (typeof window !== "undefined") {
								if (trimmedOperatorName.length > 0) {
									window.localStorage.setItem(OPERATOR_NAME_STORAGE_KEY, trimmedOperatorName);
								} else {
									window.localStorage.removeItem(OPERATOR_NAME_STORAGE_KEY);
								}
							}
							onJoin({
								operatorName: trimmedOperatorName,
								gameCode: gameCode.trim(),
							});
						}
					}
				>
					Join game
				</button>
				</div>
				</div>
			</div>
		</div>
	);
}
