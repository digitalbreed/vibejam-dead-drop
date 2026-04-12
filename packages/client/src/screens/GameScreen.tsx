import { useCallback, useEffect, useRef, useState } from "react";
import type { GameServerMessages, GameTeam } from "@vibejam/shared";
import nipplejs from "nipplejs";
import { getLatestRoleAssignment, useRoom, useRoomState } from "../colyseus/roomContext";
import { schemaMapValues } from "../colyseus/schemaMap";
import { GameScene } from "../game/GameScene";
import { Ticker } from "../game/ticker";
import { BriefingPanel } from "./panels/BriefingPanel";
import { EnforcerNewspaperOutro } from "./panels/EnforcerNewspaperOutro";
import { RoundEndPanel } from "./panels/RoundEndPanel";

type BriefingStage = "hidden" | "pre-enter" | "center" | "exit";
type RoundEndStage = "hidden" | "pre-enter" | "center";
type RoundEndSummary = GameServerMessages["round_end_summary"];

type GameScreenProps = {
	devBotsVisible?: boolean;
	botsPaused?: boolean;
	onToggleDevBotsVisibility?: () => void;
	onToggleBotsPaused?: () => void;
	onPlayAnotherRound?: (gameCode: string) => void;
	onBackToStartScreen?: () => void;
};

export function GameScreen({
	devBotsVisible = true,
	botsPaused = false,
	onToggleDevBotsVisibility,
	onToggleBotsPaused,
	onPlayAnotherRound,
	onBackToStartScreen,
}: GameScreenProps) {
	const isDevMode = import.meta.env.DEV;
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
	const [roundEndStage, setRoundEndStage] = useState<RoundEndStage>("hidden");
	const [roundEndSummary, setRoundEndSummary] = useState<RoundEndSummary | null>(null);
	const [escapeOutroDone, setEscapeOutroDone] = useState(false);
	const [enforcerOutroActive, setEnforcerOutroActive] = useState(false);
	const [enforcerOutroComplete, setEnforcerOutroComplete] = useState(false);
	const [touchControlsEnabled, setTouchControlsEnabled] = useState(false);
	const [touchInteractPressed, setTouchInteractPressed] = useState(false);
	const [touchTrapPressed, setTouchTrapPressed] = useState(false);
	const fpsRef = useRef(0);
	const joystickZoneRef = useRef<HTMLDivElement | null>(null);
	const touchMoveRef = useRef({ x: 0, z: 0 });
	const mapSeed = useRoomState((s) => s.mapSeed);
	const gameCode = useRoomState((s) => (typeof s?.gameCode === "string" ? s.gameCode : "")) ?? "";
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
	const dismissBriefing = useCallback(() => {
		setBriefingStage((current) => (current === "center" ? "exit" : current));
	}, []);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const mediaQuery = window.matchMedia("(hover: none) and (pointer: coarse)");
		const update = () => setTouchControlsEnabled(mediaQuery.matches);
		update();
		mediaQuery.addEventListener("change", update);
		return () => mediaQuery.removeEventListener("change", update);
	}, []);

	useEffect(() => {
		if (!touchControlsEnabled) {
			touchMoveRef.current.x = 0;
			touchMoveRef.current.z = 0;
			setTouchInteractPressed(false);
			setTouchTrapPressed(false);
			return;
		}
		if (!joystickZoneRef.current) {
			return;
		}
		const joystick = nipplejs.create({
			zone: joystickZoneRef.current,
			mode: "static",
			position: { left: "50%", top: "50%" },
			size: 126,
			color: "rgba(255,255,255,0.88)",
			restOpacity: 0.4,
			fadeTime: 100,
		});
		const handleMove = (event: unknown) => {
			dismissBriefing();
			const data = (event as { data?: { vector?: { x?: number; y?: number } } })?.data;
			if (!data?.vector) {
				return;
			}
			touchMoveRef.current.x = Number.isFinite(data.vector.x) ? data.vector.x ?? 0 : 0;
			touchMoveRef.current.z = Number.isFinite(data.vector.y) ? -(data.vector.y ?? 0) : 0;
		};
		const handleEnd = () => {
			touchMoveRef.current.x = 0;
			touchMoveRef.current.z = 0;
		};
		joystick.on("move", handleMove);
		joystick.on("end", handleEnd);
		return () => {
			touchMoveRef.current.x = 0;
			touchMoveRef.current.z = 0;
			joystick.off("move", handleMove);
			joystick.off("end", handleEnd);
			joystick.destroy();
		};
	}, [dismissBriefing, touchControlsEnabled]);

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
		if (!room) {
			return;
		}
		return room.onMessage("round_end_summary", (message: RoundEndSummary) => {
			setRoundEndSummary(message);
		});
	}, [room]);

	useEffect(() => {
		if (!room) {
			return;
		}
		return room.onMessage("enforcer_outro_event", (message: GameServerMessages["enforcer_outro_event"]) => {
			if (message.stage !== "start") {
				return;
			}
			setEnforcerOutroComplete(false);
			setEnforcerOutroActive(true);
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
		setRoundEndStage("hidden");
		setRoundEndSummary(null);
		setEscapeOutroDone(false);
		setEnforcerOutroActive(false);
		setEnforcerOutroComplete(false);
	}, [phase]);

	useEffect(() => {
		if (roundEndStage !== "hidden") {
			return;
		}
		if (!roundEndSummary) {
			return;
		}
		const ready =
			roundEndSummary.winnerTeam === "shredders"
				? escapeOutroDone
				: enforcerOutroComplete;
		if (!ready) {
			return;
		}
		setRoundEndStage("pre-enter");
	}, [enforcerOutroComplete, escapeOutroDone, roundEndStage, roundEndSummary]);

	useEffect(() => {
		return () => {
			touchMoveRef.current.x = 0;
			touchMoveRef.current.z = 0;
		};
	}, []);

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
		const onKeyDown = () => dismissBriefing();
		const onPointerDown = () => dismissBriefing();
		const onTouchStart = () => dismissBriefing();
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("touchstart", onTouchStart, { passive: true });
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("touchstart", onTouchStart);
		};
	}, [briefingStage, dismissBriefing]);

	useEffect(() => {
		if (briefingStage !== "exit") {
			return;
		}
		const timer = window.setTimeout(() => {
			setBriefingStage("hidden");
		}, 760);
		return () => window.clearTimeout(timer);
	}, [briefingStage]);

	useEffect(() => {
		if (roundEndStage !== "pre-enter") {
			return;
		}
		let second: number | null = null;
		const first = window.requestAnimationFrame(() => {
			second = window.requestAnimationFrame(() => {
				setRoundEndStage("center");
			});
		});
		return () => {
			window.cancelAnimationFrame(first);
			if (second !== null) {
				window.cancelAnimationFrame(second);
			}
		};
	}, [roundEndStage]);

	const playerName =
		typeof localPlayer?.name === "string" && localPlayer.name.trim().length > 0
			? localPlayer.name.trim()
			: "Agent";
	const teamLabel = team === "enforcers" ? "ENFORCERS" : team === "shredders" ? "SHREDDERS" : "UNASSIGNED";
	const teamColor = team === "enforcers" ? "#0015BC" : team === "shredders" ? "#FF0000" : "#a8b6c8";
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
	return (
		<div style={{ width: "100%", height: "100%", minHeight: "100vh" }}>
			{isDevMode ? (
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
				<button
					type="button"
					onClick={() => room?.send("debug_escape_ladder_sequence", {})}
					style={{
						marginTop: 6,
						marginLeft: 6,
						padding: "0.18rem 0.45rem",
						fontSize: "0.78rem",
						borderRadius: 4,
						border: "1px solid rgba(120, 150, 200, 0.45)",
						background: "rgba(20, 28, 40, 0.75)",
						color: "#dfe7f2",
						cursor: "pointer",
					}}
				>
					Debug Escape
				</button>
				<button
					type="button"
					onClick={() => room?.send("debug_enforcer_outro_sequence", {})}
					style={{
						marginTop: 6,
						marginLeft: 6,
						padding: "0.18rem 0.45rem",
						fontSize: "0.78rem",
						borderRadius: 4,
						border: "1px solid rgba(120, 150, 200, 0.45)",
						background: "rgba(20, 28, 40, 0.75)",
						color: "#dfe7f2",
						cursor: "pointer",
					}}
				>
					Debug Enforcer Outro
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
			) : null}
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
					color: "#333333",
					pointerEvents: "none",
					whiteSpace: "nowrap",
				}}
			>
				FPS: {fps} PING: {pingMs === null ? "--" : `${pingMs} ms`} SEED: {mapSeed ?? 0}
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
							flexDirection: touchControlsEnabled ? "column" : "row",
							alignItems: touchControlsEnabled ? "flex-start" : "center",
							gap: touchControlsEnabled ? 2 : 6,
							color: "#ffffff",
							fontSize: "1.45rem",
							lineHeight: 1,
							fontWeight: 700,
						}}
					>
						{touchControlsEnabled ? (
							<>
								<span>{playerName}</span>
								<span style={{ color: teamColor, fontSize: "1.05rem", letterSpacing: "0.08em" }}>{teamLabel}</span>
							</>
						) : (
							<>
								<span>{playerName}</span>
								<span style={{ opacity: 0.75 }}>-</span>
								<span style={{ color: teamColor }}>{teamLabel}</span>
							</>
						)}
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
				controlsEnabled={!enforcerOutroActive && roundEndStage === "hidden"}
				touchInputRef={touchMoveRef}
				touchInteractPressed={touchInteractPressed}
				touchTrapPressed={touchTrapPressed}
				onEscapeOutroComplete={() => {
					setEscapeOutroDone(true);
				}}
			/>
			{touchControlsEnabled ? (
				<div
					style={{
						position: "fixed",
						inset: 0,
						zIndex: 7,
						pointerEvents: "none",
					}}
				>
					<div
						style={{
							position: "absolute",
							left: 18,
							bottom: 18,
							width: 162,
							height: 162,
							borderRadius: "50%",
							background: "rgba(11, 16, 23, 0.24)",
							border: "1px solid rgba(255, 255, 255, 0.16)",
							backdropFilter: "blur(1px)",
							pointerEvents: "auto",
							touchAction: "none",
							userSelect: "none",
							WebkitUserSelect: "none",
							WebkitTouchCallout: "none",
							WebkitTapHighlightColor: "transparent",
						}}
						onContextMenu={(event) => event.preventDefault()}
						ref={joystickZoneRef}
					/>
					<div
						style={{
							position: "absolute",
							right: 18,
							bottom: 18,
							display: "flex",
							flexDirection: "column",
							gap: 10,
							pointerEvents: "none",
						}}
					>
						<button
							type="button"
							onPointerDown={(event) => {
								event.preventDefault();
								dismissBriefing();
								setTouchTrapPressed(true);
							}}
							onPointerUp={() => setTouchTrapPressed(false)}
							onPointerCancel={() => setTouchTrapPressed(false)}
							onPointerLeave={() => setTouchTrapPressed(false)}
							onContextMenu={(event) => event.preventDefault()}
							style={{
								width: 110,
								height: 58,
								borderRadius: 14,
								border: "1px solid rgba(255, 120, 120, 0.58)",
								background: "rgba(200, 22, 22, 0.42)",
								color: "rgba(255, 244, 244, 0.96)",
								fontSize: 16,
								fontWeight: 700,
								letterSpacing: "0.06em",
								textTransform: "uppercase",
								pointerEvents: "auto",
								touchAction: "none",
								userSelect: "none",
								WebkitUserSelect: "none",
								WebkitTouchCallout: "none",
								WebkitTapHighlightColor: "transparent",
							}}
						>
							Trap
						</button>
						<button
							type="button"
							onPointerDown={(event) => {
								event.preventDefault();
								dismissBriefing();
								setTouchInteractPressed(true);
							}}
							onPointerUp={() => setTouchInteractPressed(false)}
							onPointerCancel={() => setTouchInteractPressed(false)}
							onPointerLeave={() => setTouchInteractPressed(false)}
							onContextMenu={(event) => event.preventDefault()}
							style={{
								width: 110,
								height: 58,
								borderRadius: 14,
								border: "1px solid rgba(255, 255, 255, 0.58)",
								background: "rgba(255, 255, 255, 0.32)",
								color: "#f8f8f8",
								fontSize: 14,
								fontWeight: 700,
								letterSpacing: "0.06em",
								textTransform: "uppercase",
								pointerEvents: "auto",
								touchAction: "none",
								userSelect: "none",
								WebkitUserSelect: "none",
								WebkitTouchCallout: "none",
								WebkitTapHighlightColor: "transparent",
							}}
						>
							Interact
						</button>
					</div>
				</div>
			) : null}
			<BriefingPanel stage={briefingStage} team={team} />
			<EnforcerNewspaperOutro
				active={enforcerOutroActive}
				onComplete={() => {
					setEnforcerOutroComplete(true);
				}}
			/>
			<RoundEndPanel
				stage={roundEndStage}
				summary={roundEndSummary}
				gameCode={gameCode}
				roomId={room?.roomId}
				onPlayAnotherRound={onPlayAnotherRound}
				onBackToStartScreen={onBackToStartScreen}
			/>
			<Ticker />
		</div>
	);
}
