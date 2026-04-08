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
	const [operatorName, setOperatorName] = useState("");
	const [gameCode, setGameCode] = useState("");
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
						Auto-assigned if empty
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
						onChange={(e) => setGameCode(e.target.value)}
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
						Joining next best public lobby if empty
					</span>
				</label>
				<button
					type="button"
					onClick={onJoin}
					style={{
						marginTop: "0.5rem",
						padding: "0.8rem 1.5rem",
						borderRadius: "8px",
						border: "2px solid #3a5575",
						background: "linear-gradient(180deg, #2a4560 0%, #2a4560 50%, #1e3550 51%, #1e3550 100%)",
						color: "#e8eef5",
						textTransform: "uppercase",
						letterSpacing: "0.08em",
						fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
						fontSize: "1.15rem",
						cursor: "pointer",
					}}
				>
					Join game
				</button>
				</div>
				</div>
			</div>
		</div>
	);
}
