import { useEffect, useMemo, useRef, useState } from "react";
import { DECOR_PORTRAIT_ATLAS_COLUMNS } from "@vibejam/shared";

const PAGE_DELAY_MS = 2000;
const PAGE_COUNT = 4;
const PANEL_DELAY_AFTER_LAST_PAGE_MS = 1000;
const OUTRO_COMPLETE_MS = (PAGE_COUNT - 1) * PAGE_DELAY_MS + PANEL_DELAY_AFTER_LAST_PAGE_MS;

const HEADLINES: Array<{ lead: string; sub: string }> = [
	{
		lead: "ISLAND FILES UNSEALED",
		sub: "Administration Caught in Massive Private-Island Scandal with Video Evidence, $200M in Secret Payments, and Signed Cover-Up Orders",
	},
	{
		lead: "ENTIRE ADMINISTRATION INDICTED",
		sub: "Federal Scandal, Racketeering, and Obstruction Charges Land as Island Files Crush All Defenses",
	},
	{
		lead: "HOUSE IMPEACHES PRESIDENT AND VICE PRESIDENT",
		sub: "Entire Administration Deemed Unfit After Island Files Trigger Mass Felony Convictions",
	},
	{
		lead: "TOTAL COLLAPSE",
		sub: "Entire Administration Convicted and Removed as Unfit; Next in Line Assumes Presidency Amid Constitutional Crisis",
	},
];
const PORTRAIT_SPRITE_WIDTH = 57;
const PORTRAIT_SPRITE_HEIGHT = 69;
const PORTRAIT_ATLAS_WIDTH = 256;
const PORTRAIT_ATLAS_HEIGHT = 256;

function playSlapSound(volume = 0.28): void {
	const AudioContextCtor =
		window.AudioContext ??
		(window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
	if (!AudioContextCtor) {
		return;
	}
	const ctx = new AudioContextCtor();
	const now = ctx.currentTime;
	const gain = ctx.createGain();
	gain.gain.setValueAtTime(0.0001, now);
	gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), now + 0.008);
	gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
	gain.connect(ctx.destination);

	const osc = ctx.createOscillator();
	osc.type = "square";
	osc.frequency.setValueAtTime(260, now);
	osc.frequency.exponentialRampToValueAtTime(130, now + 0.07);
	osc.connect(gain);
	osc.start(now);
	osc.stop(now + 0.11);

	window.setTimeout(() => {
		void ctx.close();
	}, 250);
}

export function EnforcerNewspaperOutro({
	active,
	onComplete,
}: {
	active: boolean;
	onComplete?: () => void;
}) {
	const [visiblePages, setVisiblePages] = useState(0);
	const [portraitIndexByPage, setPortraitIndexByPage] = useState<number[]>([]);
	const [horizontalOffsetByPage, setHorizontalOffsetByPage] = useState<number[]>([]);
	const [mobileLayout, setMobileLayout] = useState(false);
	const completeFiredRef = useRef(false);
	const onCompleteRef = useRef(onComplete);
	const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
	const skeletonRows = useMemo(
		() =>
			Array.from({ length: 38 }, (_, rowIndex) =>
				Array.from({ length: 2 }, (_, colIndex) =>
					Array.from({ length: 5 + ((rowIndex + colIndex) % 4) }, (_, wordIndex) => {
						const width = 18 + ((rowIndex * 23 + colIndex * 11 + wordIndex * 17) % 42);
						return `${width}%`;
					}),
				),
			),
		[],
	);

	useEffect(() => {
		onCompleteRef.current = onComplete;
	}, [onComplete]);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const query = window.matchMedia("(max-width: 720px)");
		const update = () => setMobileLayout(query.matches);
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);

	useEffect(() => {
		if (!active || visiblePages <= 0) {
			return;
		}
		const pageIndex = visiblePages - 1;
		const node = pageRefs.current[pageIndex];
		if (!node) {
			return;
		}
		const rotation = -7 + pageIndex * 3;
		const finalTransform = `translateX(-50%) rotate(${rotation}deg) rotateX(0deg) scale(1)`;
		void node.animate(
			[
				{
					transform: `translateX(-50%) translateY(-58vh) rotate(${rotation + 14}deg) rotateX(72deg) scale(1.24)`,
					opacity: 0,
				},
				{
					transform: `translateX(-50%) translateY(-8vh) rotate(${rotation - 4}deg) rotateX(18deg) scale(1.06)`,
					opacity: 1,
					offset: 0.74,
				},
				{
					transform: finalTransform,
					opacity: 1,
				},
			],
			{
				duration: 860,
				easing: "cubic-bezier(0.08, 0.82, 0.22, 1)",
				fill: "both",
			},
		);
	}, [active, visiblePages]);

	useEffect(() => {
		if (!active) {
			setVisiblePages(0);
			setPortraitIndexByPage([]);
			setHorizontalOffsetByPage([]);
			completeFiredRef.current = false;
			return;
		}
		setVisiblePages(0);
		const portraits = [0, 1, 2, 3];
		for (let i = portraits.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			const tmp = portraits[i];
			portraits[i] = portraits[j];
			portraits[j] = tmp;
		}
		setPortraitIndexByPage(portraits.slice(0, PAGE_COUNT));
		setHorizontalOffsetByPage(
			Array.from({ length: PAGE_COUNT }, (_, i) => {
				const base = (i - (PAGE_COUNT - 1) * 0.5) * 3.2;
				const jitter = (Math.random() - 0.5) * 1.4;
				return base + jitter;
			}),
		);
		completeFiredRef.current = false;
		const timers: number[] = [];
		for (let i = 0; i < PAGE_COUNT; i++) {
			timers.push(
				window.setTimeout(() => {
					setVisiblePages((current) => Math.max(current, i + 1));
					playSlapSound(0.28);
				}, i * PAGE_DELAY_MS),
			);
		}
		timers.push(
			window.setTimeout(() => {
				if (!completeFiredRef.current) {
					completeFiredRef.current = true;
					onCompleteRef.current?.();
				}
			}, OUTRO_COMPLETE_MS),
		);
		return () => {
			for (const timer of timers) {
				window.clearTimeout(timer);
			}
		};
	}, [active]);

	if (!active) {
		return null;
	}

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 9,
				pointerEvents: "none",
				perspective: 1200,
				background:
					"radial-gradient(circle at center, rgba(5, 9, 16, 0.34) 0%, rgba(3, 6, 11, 0.65) 62%, rgba(2, 4, 8, 0.78) 100%)",
			}}
		>
			{HEADLINES.map((headline, index) => {
				if (index >= visiblePages) {
					return null;
				}
				const top = 42 + index * 90;
				const rotation = -7 + index * 3;
				const horizontalOffset = horizontalOffsetByPage[index] ?? 0;
				const portraitIndex = portraitIndexByPage[index] ?? 0;
				const portraitColumn = index % 2;
				const portraitCol = portraitIndex % DECOR_PORTRAIT_ATLAS_COLUMNS;
				const portraitOffsetXPct =
					PORTRAIT_ATLAS_WIDTH <= PORTRAIT_SPRITE_WIDTH
						? 0
						: (portraitCol * PORTRAIT_SPRITE_WIDTH) / (PORTRAIT_ATLAS_WIDTH - PORTRAIT_SPRITE_WIDTH) * 100;
				const portraitOffsetYPct = 0;
				const serifPaper = index % 2 === 1;
				return (
					<div
						key={`paper-${index}`}
						ref={(node) => {
							pageRefs.current[index] = node;
						}}
						style={{
							position: "absolute",
							left: `${50 + horizontalOffset}%`,
							top,
							transform: `translateX(-50%) rotate(${rotation}deg)`,
							transformOrigin: "50% 24%",
							width: mobileLayout ? "96vw" : "min(74vw, 560px)",
							aspectRatio: "0.72 / 1",
							padding: "1rem 1rem 1.2rem",
							background: "linear-gradient(180deg, #f2f2eb 0%, #e6e6dd 100%)",
							color: "#151515",
							border: "2px solid #b8b8ae",
							boxShadow: "0 14px 30px rgba(0, 0, 0, 0.42)",
							overflow: "hidden",
						}}
					>
						<div
							style={{
								fontFamily: serifPaper
									? "'Times New Roman', Times, serif"
									: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
								fontSize: "clamp(1.45rem, 3vw, 2.35rem)",
								lineHeight: serifPaper ? 1.02 : 0.95,
								textTransform: "uppercase",
								letterSpacing: "0.03em",
								textAlign: "center",
							}}
						>
							{headline.lead}
						</div>
						<div
							style={{
								fontFamily: serifPaper
									? "'Times New Roman', Times, serif"
									: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
								fontSize: "clamp(0.82rem, 1.5vw, 1.22rem)",
								lineHeight: 1.08,
								textTransform: "uppercase",
								letterSpacing: serifPaper ? "0.01em" : "0.02em",
								textAlign: "center",
								marginTop: "0.2rem",
							}}
						>
							{headline.sub}
						</div>
						<div
							style={{
								display: "grid",
								gridTemplateColumns: "1fr 1fr",
								gap: "0.8rem",
								marginTop: "0.85rem",
								height: "calc(100% - 10.4rem)",
							}}
						>
							{[0, 1].map((columnIndex) => {
								const topRows = skeletonRows.slice(0, 16);
								const bottomRows = skeletonRows.slice(16);
								const showPortrait = columnIndex === portraitColumn;
								return (
									<div
										key={`col-${index}-${columnIndex}`}
										style={{ display: "flex", flexDirection: "column", gap: 4, minHeight: 0 }}
									>
										{topRows.map((row, rowIndex) => {
											const fakeHeadline = rowIndex % 6 === 0;
											return (
												<div
													key={`row-top-${index}-${columnIndex}-${rowIndex}`}
													style={{ display: "flex", gap: 4, alignItems: "center" }}
												>
													{fakeHeadline ? (
														<>
															<span
																style={{
																	display: "inline-block",
																	height: 9,
																	width: "68%",
																	background: "rgba(35, 35, 35, 0.24)",
																}}
															/>
															<span
																style={{
																	display: "inline-block",
																	height: 9,
																	width: "30%",
																	background: "rgba(35, 35, 35, 0.2)",
																}}
															/>
														</>
													) : (
														row[columnIndex].map((wordWidth, wordIndex) => (
															<span
																key={`word-top-${index}-${columnIndex}-${rowIndex}-${wordIndex}`}
																style={{
																	display: "inline-block",
																	height: 5,
																	width: wordWidth,
																	background: "rgba(35, 35, 35, 0.18)",
																}}
															/>
														))
													)}
												</div>
											);
										})}
										{showPortrait ? (
											<div
												style={{
													position: "relative",
													border: "1px solid rgba(22, 22, 22, 0.45)",
													background: "#ddd",
													height: "33%",
													minHeight: 96,
													overflow: "hidden",
													margin: "2px 0",
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
												}}
											>
												<div
													style={{
														width: "88%",
														maxWidth: 172,
														aspectRatio: "57 / 69",
														backgroundImage: "url('/portraits.png')",
														backgroundRepeat: "no-repeat",
														backgroundSize: `${(PORTRAIT_ATLAS_WIDTH / PORTRAIT_SPRITE_WIDTH) * 100}% ${(PORTRAIT_ATLAS_HEIGHT / PORTRAIT_SPRITE_HEIGHT) * 100}%`,
														backgroundPosition: `${portraitOffsetXPct}% ${portraitOffsetYPct}%`,
														filter: "grayscale(1) contrast(1.1)",
														border: "1px solid rgba(22, 22, 22, 0.35)",
													}}
												/>
											</div>
										) : null}
										{bottomRows.map((row, rowIndex) => {
											const fakeHeadline = rowIndex % 7 === 0;
											return (
												<div
													key={`row-bottom-${index}-${columnIndex}-${rowIndex}`}
													style={{ display: "flex", gap: 4, alignItems: "center" }}
												>
													{fakeHeadline ? (
														<>
															<span
																style={{
																	display: "inline-block",
																	height: 8,
																	width: "52%",
																	background: "rgba(35, 35, 35, 0.22)",
																}}
															/>
															<span
																style={{
																	display: "inline-block",
																	height: 8,
																	width: "44%",
																	background: "rgba(35, 35, 35, 0.2)",
																}}
															/>
														</>
													) : (
														row[columnIndex].map((wordWidth, wordIndex) => (
															<span
																key={`word-bottom-${index}-${columnIndex}-${rowIndex}-${wordIndex}`}
																style={{
																	display: "inline-block",
																	height: 5,
																	width: wordWidth,
																	background: "rgba(35, 35, 35, 0.18)",
																}}
															/>
														))
													)}
												</div>
											);
										})}
									</div>
								);
							})}
						</div>
					</div>
				);
			})}
		</div>
	);
}
