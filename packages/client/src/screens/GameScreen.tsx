import { useEffect, useRef, useState } from "react";
import type { GameTeam } from "@vibejam/shared";
import { getLatestRoleAssignment, useRoom, useRoomState } from "../colyseus/roomContext";
import { schemaMapValues } from "../colyseus/schemaMap";
import { GameScene } from "../game/GameScene";
import { Ticker } from "../game/ticker";

type BriefingStage = "hidden" | "pre-enter" | "center" | "exit";

type BriefingCopy = {
	teamLabel: string;
	mission: string;
	color: string;
};

const BRIEFING_BY_TEAM: Record<GameTeam, BriefingCopy> = {
	shredders: {
		teamLabel: "SHREDDERS",
		color: "#FF0000",
		mission:
			"Find the keycards, crack the vault, and drag the briefcase to the exit before Enforcers ask awkward questions.",
	},
	enforcers: {
		teamLabel: "ENFORCERS",
		color: "#0015BC",
		mission:
			"Protect the office's deeply suspicious paper trail. Stall, harass, and make every Shredder miss their fake lunch break.",
	},
};

type GameScreenProps = {
	devBotsVisible?: boolean;
	botsPaused?: boolean;
	onToggleDevBotsVisibility?: () => void;
	onToggleBotsPaused?: () => void;
};

export function GameScreen({
	devBotsVisible = true,
	botsPaused = false,
	onToggleDevBotsVisibility,
	onToggleBotsPaused,
}: GameScreenProps) {
	const { room } = useRoom();
	const phase = useRoomState((s) => s.phase);
	const players = useRoomState((s) => s.players);
	const trapPoints = useRoomState((s) => s.trapPoints);
	const [areaLabel, setAreaLabel] = useState("Start Room");
	const [revealAll, setRevealAll] = useState(false);
	const [debugCameraEnabled, setDebugCameraEnabled] = useState(false);
	const [fps, setFps] = useState(0);
	const [pingMs, setPingMs] = useState<number | null>(null);
	const [team, setTeam] = useState<GameTeam | null>(null);
	const [briefingStage, setBriefingStage] = useState<BriefingStage>("hidden");
	const fpsRef = useRef(0);
	const mapSeed = useRoomState((s) => s.mapSeed);
	const getPlayerBySessionId = (source: unknown, sessionId: string): any => {
		if (!source) {
			return undefined;
		}
		if (typeof source === "object" && source !== null && "get" in source && typeof (source as { get: (key: string) => unknown }).get === "function") {
			return (source as { get: (key: string) => unknown }).get(sessionId);
		}
		return (source as Record<string, any>)[sessionId];
	};
	const localPlayer = room?.sessionId ? getPlayerBySessionId(players, room.sessionId) : undefined;
	const localIsDead = !!localPlayer && localPlayer.isAlive === false;
	const trapSlots = schemaMapValues<any>(trapPoints)
		.filter((point) => point?.ownerSessionId === room?.sessionId)
		.sort((a, b) => a.slotIndex - b.slotIndex);
	const activeTrapSlot = localPlayer?.isInteracting && localPlayer?.interactionStyle === "danger"
		? localPlayer?.interactionTrapSlotIndex
		: -1;
	const activeTrapProgress =
		localPlayer?.isInteracting &&
		localPlayer?.interactionStyle === "danger" &&
		typeof localPlayer?.interactionDurationMs === "number" &&
		localPlayer.interactionDurationMs > 0
			? Math.max(0, Math.min(1, localPlayer.interactionElapsedMs / localPlayer.interactionDurationMs))
			: 0;

	useEffect(() => {
		const cached = getLatestRoleAssignment(room);
		if (cached) {
			setTeam(cached.team);
			setBriefingStage("pre-enter");
		}
	}, [room]);

	useEffect(() => {
		if (!room) {
			return;
		}
		return room.onMessage("role_assignment", (message: { team: GameTeam }) => {
			setTeam(message.team);
			setBriefingStage("pre-enter");
		});
	}, [room]);

	useEffect(() => {
		let rafId = 0;
		let frameCount = 0;
		let sampleStart = performance.now();
		const measure = (now: number) => {
			frameCount += 1;
			const elapsed = now - sampleStart;
			if (elapsed >= 500) {
				const nextFps = Math.round((frameCount * 1000) / elapsed);
				if (nextFps !== fpsRef.current) {
					fpsRef.current = nextFps;
					setFps(nextFps);
				}
				frameCount = 0;
				sampleStart = now;
			}
			rafId = window.requestAnimationFrame(measure);
		};
		rafId = window.requestAnimationFrame(measure);
		return () => window.cancelAnimationFrame(rafId);
	}, []);

	useEffect(() => {
		if (!room) {
			setPingMs(null);
			return;
		}
		let cancelled = false;
		const measurePing = () => {
			try {
				room.ping((ms: number) => {
					if (!cancelled) {
						setPingMs(Math.round(ms));
					}
				});
			} catch {
				if (!cancelled) {
					setPingMs(null);
				}
			}
		};
		measurePing();
		const intervalId = window.setInterval(measurePing, 1500);
		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
		};
	}, [room]);

	useEffect(() => {
		if (phase !== "lobby") {
			return;
		}
		setTeam(null);
		setBriefingStage("hidden");
	}, [phase]);

	useEffect(() => {
		if (briefingStage !== "pre-enter") {
			return;
		}
		let second: number | null = null;
		const first = window.requestAnimationFrame(() => {
			second = window.requestAnimationFrame(() => {
				setBriefingStage("center");
			});
		});
		return () => {
			window.cancelAnimationFrame(first);
			if (second !== null) {
				window.cancelAnimationFrame(second);
			}
		};
	}, [briefingStage]);

	useEffect(() => {
		if (briefingStage !== "center") {
			return;
		}
		const onKeyDown = () => {
			setBriefingStage("exit");
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [briefingStage]);

	useEffect(() => {
		if (briefingStage !== "exit") {
			return;
		}
		const timer = window.setTimeout(() => {
			setBriefingStage("hidden");
		}, 760);
		return () => window.clearTimeout(timer);
	}, [briefingStage]);

	const briefingCopy = team ? BRIEFING_BY_TEAM[team] : null;
	const playerName =
		typeof localPlayer?.name === "string" && localPlayer.name.trim().length > 0
			? localPlayer.name.trim()
			: "Agent";
	const teamLabel = team ? BRIEFING_BY_TEAM[team].teamLabel : "UNASSIGNED";
	const teamColor = team ? BRIEFING_BY_TEAM[team].color : "#a8b6c8";
	const trapSlotsByIndex = new Map<number, any>(
		trapSlots.map((slot) => [Number(slot?.slotIndex ?? -1), slot]),
	);
	const trapIndicators = Array.from({ length: 3 }, (_, slotIndex) => {
		const slot = trapSlotsByIndex.get(slotIndex);
		return (
			slot ?? {
				id: `trap-slot-placeholder-${slotIndex}`,
				slotIndex,
				status: "unused",
			}
		);
	});

	const briefingTransform =
		briefingStage === "pre-enter"
			? "translate(-50%, -50%) translateX(120vw)"
			: briefingStage === "exit"
				? "translate(-50%, -50%) translateX(-132vw)"
				: "translate(-50%, -50%) translateX(0)";

	return (
		<div style={{ width: "100%", height: "100%", minHeight: "100vh" }}>
			<div
				style={{
					position: "fixed",
					bottom: 12,
					left: 12,
					zIndex: 2,
					padding: "0.35rem 0.6rem",
					borderRadius: 6,
					fontSize: "0.85rem",
					background: "rgba(10, 14, 22, 0.75)",
					border: "1px solid rgba(90, 120, 170, 0.35)",
				}}
			>
				<div>Seed: {mapSeed ?? 0}</div>
				<div>{areaLabel}</div>
				<button
					type="button"
					onClick={() => setRevealAll((current) => !current)}
					style={{
						marginTop: 6,
						padding: "0.18rem 0.45rem",
						fontSize: "0.78rem",
						borderRadius: 4,
						border: "1px solid rgba(120, 150, 200, 0.45)",
						background: revealAll ? "rgba(90, 130, 190, 0.3)" : "rgba(20, 28, 40, 0.75)",
						color: "#dfe7f2",
						cursor: "pointer",
					}}
				>
					Reveal
				</button>
				<button
					type="button"
					onClick={() => setDebugCameraEnabled((current) => !current)}
					style={{
						marginTop: 6,
						marginLeft: 6,
						padding: "0.18rem 0.45rem",
						fontSize: "0.78rem",
						borderRadius: 4,
						border: "1px solid rgba(120, 150, 200, 0.45)",
						background: debugCameraEnabled ? "rgba(90, 130, 190, 0.3)" : "rgba(20, 28, 40, 0.75)",
						color: "#dfe7f2",
						cursor: "pointer",
					}}
				>
					Debug Cam
				</button>
				{onToggleDevBotsVisibility ? (
					<button
						type="button"
						onClick={onToggleDevBotsVisibility}
						style={{
							marginTop: 6,
							marginLeft: 6,
							padding: "0.18rem 0.45rem",
							fontSize: "0.78rem",
							borderRadius: 4,
							border: "1px solid rgba(120, 150, 200, 0.45)",
							background: devBotsVisible ? "rgba(90, 130, 190, 0.3)" : "rgba(20, 28, 40, 0.75)",
							color: "#dfe7f2",
							cursor: "pointer",
						}}
					>
						{devBotsVisible ? "Hide Bots" : "Show Bots"}
					</button>
				) : null}
				{onToggleBotsPaused ? (
					<button
						type="button"
						onClick={onToggleBotsPaused}
						style={{
							marginTop: 6,
							marginLeft: 6,
							padding: "0.18rem 0.45rem",
							fontSize: "0.78rem",
							borderRadius: 4,
							border: "1px solid rgba(120, 150, 200, 0.45)",
							background: botsPaused ? "rgba(190, 116, 90, 0.35)" : "rgba(20, 28, 40, 0.75)",
							color: "#dfe7f2",
							cursor: "pointer",
						}}
					>
						{botsPaused ? "Resume Bots" : "Pause Bots"}
					</button>
				) : null}
			</div>
			<div
				style={{
					position: "fixed",
					top: 0,
					right: 0,
					zIndex: 9,
					fontFamily: "Arial, sans-serif",
					fontSize: 11,
					lineHeight: 1.3,
					letterSpacing: "0.03em",
					textTransform: "uppercase",
					color: "#9cff9c",
					pointerEvents: "none",
					whiteSpace: "nowrap",
				}}
			>
				FPS: {fps} PING: {pingMs === null ? "--" : `${pingMs} ms`}
			</div>
			<div
				style={{
					position: "fixed",
					top: 12,
					left: 12,
					zIndex: 3,
					display: "flex",
					alignItems: "stretch",
					gap: 18,
					fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
					textTransform: "uppercase",
					letterSpacing: "0.06em",
					textShadow: "0 1px 8px rgba(0, 0, 0, 0.65)",
				}}
			>
				<div style={{ display: "flex", flexDirection: "column", gap: 2, justifyContent: "space-between" }}>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 6,
							color: "#ffffff",
							fontSize: "1.45rem",
							lineHeight: 1,
							fontWeight: 700,
						}}
					>
						<span>{playerName}</span>
						<span style={{ opacity: 0.75 }}>-</span>
						<span style={{ color: teamColor }}>{teamLabel}</span>
					</div>
					<div
						style={{
							fontSize: "0.9rem",
							letterSpacing: "0.03em",
							color: "rgba(214, 227, 242, 0.86)",
						}}
					>
						{areaLabel}
					</div>
				</div>
				<div style={{ display: "flex", gap: 8, alignItems: "stretch", height: "2.35rem" }}>
					{trapIndicators.map((slot) => {
						const isActive = slot.status === "active";
						const isUsed = slot.status === "used";
						const isCharging = activeTrapSlot === slot.slotIndex;
						const progress = isCharging ? activeTrapProgress : 0;
						const borderWidth = 4;
						const borderColor = isUsed
							? "rgba(255, 84, 84, 0.94)"
							: isActive
								? "rgba(24, 141, 75, 0.95)"
								: "rgba(255, 255, 255, 0.4)";
						return (
							<div
								key={slot.id}
								style={{
									height: "100%",
									aspectRatio: "1 / 1",
									boxSizing: "border-box",
									position: "relative",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									overflow: "hidden"
								}}
							>
								<div style={{
									position: "absolute",
									top: 0,
									left: 0,
									right: 0,
									bottom: 0,
									borderRadius: "50%",
									border: `${borderWidth}px solid ${borderColor}`,
									background: "rgba(18, 24, 32, 0.82)",
									animation: isActive ? "trap-hud-blink 1s steps(2, end) infinite" : "none",
								}}>
									<div
										style={{
											position: "absolute",
											inset: 0,
											borderRadius: "50%",
											overflow: "hidden",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
										}}
									>
										<span
											aria-label={`Bomb slot ${slot.slotIndex + 1}`}
											role="img"
											style={{
												fontSize: "1rem",
												lineHeight: 1,
												filter: isUsed ? "grayscale(1) brightness(0.65)" : "none",
											}}
										>
											💣
										</span>
									</div>
								</div>
								{isCharging ? (
									<div
										aria-hidden="true"
										style={{
											position: "absolute",
											top: 0,
											left: 0,
											right: 0,
											bottom: 0,
											borderRadius: "50%",
											pointerEvents: "none",
											background: `conic-gradient(from 0deg, rgba(255, 83, 83, 1) 0turn ${progress}turn, transparent ${progress}turn 1turn)`,
											//WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${borderWidth}px), #000 calc(100% - ${borderWidth}px))`,
											mask: `radial-gradient(farthest-side, transparent calc(100% - ${borderWidth}px), #000 calc(100% - ${borderWidth}px))`,

										}}
									/>
								) : null}
							</div>
						);
					})}
				</div>
			</div>
			<GameScene
				onAreaChange={setAreaLabel}
				revealAll={revealAll}
				spectatorReveal={localIsDead}
				debugCameraEnabled={debugCameraEnabled}
			/>
			{briefingStage !== "hidden" && briefingCopy ? (
				<div
					style={{
						position: "fixed",
						inset: 0,
						pointerEvents: "none",
						zIndex: 8,
						background:
							"radial-gradient(circle at center, rgba(5, 9, 16, 0.22) 0%, rgba(3, 6, 11, 0.56) 62%, rgba(2, 4, 8, 0.7) 100%)",
					}}
				>
					<div
						style={{
							position: "absolute",
							left: "50%",
							top: "50%",
							transform: briefingTransform,
							transition: "transform 720ms cubic-bezier(0.2, 0.9, 0.2, 1)",
							width: "min(90vw, 820px)",
							padding: "2rem 2.2rem",
							border: "1px solid rgba(192, 221, 255, 0.3)",
							background:
								"linear-gradient(160deg, rgba(6, 12, 18, 0.95) 0%, rgba(10, 18, 26, 0.95) 62%, rgba(16, 24, 34, 0.94) 100%)",
							boxShadow: "0 22px 70px rgba(0, 0, 0, 0.62)",
							textAlign: "center",
							letterSpacing: "0.02em",
						}}
					>
						<div
							style={{
								fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
								fontSize: "clamp(2.2rem, 8vw, 4.6rem)",
								lineHeight: 0.9,
								textTransform: "uppercase",
								textShadow: "0 0 24px rgba(160, 220, 255, 0.42)",
							}}
						>
							<div style={{ opacity: 0.8, fontSize: "0.5em", marginBottom: "0.45rem", letterSpacing: "0.22em" }}>
								Your Team
							</div>
							<div>{briefingCopy.teamLabel}</div>
						</div>
						<p
							style={{
								margin: "1.1rem auto 0",
								maxWidth: "40rem",
								fontSize: "clamp(1rem, 2.35vw, 1.32rem)",
								lineHeight: 1.45,
								opacity: 0.95,
							}}
						>
							{briefingCopy.mission}
						</p>
						<div style={{ marginTop: "1rem", opacity: 0.74, fontSize: "0.86rem", textTransform: "uppercase", letterSpacing: "0.11em" }}>
							Press any key to continue
						</div>
					</div>
				</div>
			) : null}
			<Ticker />
		</div>
	);
}
