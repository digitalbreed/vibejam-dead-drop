import { useEffect, useRef, useState, type CSSProperties } from "react";

type TitleScreenProps = {
	onJoin: () => void;
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

export function TitleScreen({ onJoin }: TitleScreenProps) {
	const [shreds, setShreds] = useState<ShredParticle[]>([]);
	const nextShredIdRef = useRef(1);

	useEffect(() => {
		const emitter = window.setInterval(() => {
			const phase = (performance.now() % PAPER_CYCLE_MS) / PAPER_CYCLE_MS;
			if (phase < PAPER_FEED_START_RATIO || phase > PAPER_FEED_END_RATIO) {
				return;
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
				background:
					"radial-gradient(ellipse at center, rgba(15,25,40,0.92) 0%, rgba(8,12,18,0.96) 100%)",
			}}
		>
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
												className="title-paper-word"
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
					border: "1px solid rgba(192, 221, 255, 0.3)",
					background: "linear-gradient(160deg, #08121d 0%, #0c1a2a 62%, #102235 100%)",
					boxShadow: "0 22px 70px rgba(0, 0, 0, 0.62)",
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
				<div style={{ display: "flex", flexDirection: "column", gap: "0.65rem", width: "min(22rem, 100%)", margin: "1.35rem auto 0" }}>
				<button
					type="button"
					onClick={onJoin}
					style={{
						padding: "0.8rem 1.5rem",
						borderRadius: "8px",
						border: "1px solid rgba(146, 190, 234, 0.52)",
						background: "linear-gradient(180deg, #294865 0%, #1c3249 100%)",
						color: "#e8eef5",
						textTransform: "uppercase",
						letterSpacing: "0.08em",
						fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
						fontSize: "1.15rem",
					}}
				>
					Start operation
				</button>
				<button
					type="button"
					style={{
						padding: "0.8rem 1.5rem",
						borderRadius: "8px",
						border: "1px solid rgba(128, 160, 194, 0.38)",
						background: "linear-gradient(180deg, #172432 0%, #0f1a25 100%)",
						color: "#d6e0ea",
						textTransform: "uppercase",
						letterSpacing: "0.08em",
						fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
						fontSize: "1.08rem",
					}}
				>
					Start private game
				</button>
				<button
					type="button"
					style={{
						padding: "0.8rem 1.5rem",
						borderRadius: "8px",
						border: "1px solid rgba(128, 160, 194, 0.38)",
						background: "linear-gradient(180deg, #172432 0%, #0f1a25 100%)",
						color: "#d6e0ea",
						textTransform: "uppercase",
						letterSpacing: "0.08em",
						fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
						fontSize: "1.08rem",
					}}
				>
					Join private game
				</button>
				</div>
				</div>
			</div>
		</div>
	);
}
