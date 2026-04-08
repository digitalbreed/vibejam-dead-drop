import { useEffect, useState } from "react";
import type { GameTeam } from "@vibejam/shared";
import { getLatestRoleAssignment, useRoom, useRoomState } from "../colyseus/roomContext";
import { schemaMapValues } from "../colyseus/schemaMap";
import { GameScene } from "../game/GameScene";
import { Ticker } from "../game/ticker";

type BriefingStage = "hidden" | "pre-enter" | "center" | "exit";

type BriefingCopy = {
	teamLabel: string;
	mission: string;
};

const BRIEFING_BY_TEAM: Record<GameTeam, BriefingCopy> = {
	shredders: {
		teamLabel: "TEAM SHREDDERS",
		mission:
			"Find the keycards, crack the vault, and drag the briefcase to the exit before Enforcers ask awkward questions.",
	},
	enforcers: {
		teamLabel: "TEAM ENFORCERS",
		mission:
			"Protect the office's deeply suspicious paper trail. Stall, harass, and make every Shredder miss their fake lunch break.",
	},
};

type GameScreenProps = {
	devBotsVisible?: boolean;
	onToggleDevBotsVisibility?: () => void;
};

export function GameScreen({ devBotsVisible = true, onToggleDevBotsVisibility }: GameScreenProps) {
	const { room } = useRoom();
	const phase = useRoomState((s) => s.phase);
	const players = useRoomState((s) => s.players);
	const trapPoints = useRoomState((s) => s.trapPoints);
	const [areaLabel, setAreaLabel] = useState("Start Room");
	const [revealAll, setRevealAll] = useState(false);
	const [debugCameraEnabled, setDebugCameraEnabled] = useState(false);
	const [team, setTeam] = useState<GameTeam | null>(null);
	const [briefingStage, setBriefingStage] = useState<BriefingStage>("hidden");
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
	const effectiveRevealAll = revealAll || localIsDead;
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
			</div>
			<div
				style={{
					position: "fixed",
					top: 12,
					left: 12,
					zIndex: 3,
					display: "flex",
					gap: 8,
				}}
			>
				{trapSlots.map((slot) => {
					const isActive = slot.status === "active";
					const isUsed = slot.status === "used";
					const isCharging = activeTrapSlot === slot.slotIndex;
					const progress = isCharging ? activeTrapProgress : 0;
					return (
						<div
							key={slot.id}
							style={{
								width: 84,
								height: 54,
								position: "relative",
								borderRadius: 8,
								border: `1px solid ${
									isUsed ? "rgba(255, 84, 84, 0.9)" : isActive ? "rgba(76, 246, 150, 0.9)" : "rgba(156, 174, 196, 0.55)"
								}`,
								background: isUsed
									? "rgba(112, 24, 24, 0.8)"
									: isActive
										? "rgba(18, 88, 50, 0.82)"
										: "rgba(18, 24, 32, 0.82)",
								animation: isActive ? "trap-hud-blink 1s steps(2, end) infinite" : "none",
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								overflow: "hidden",
							}}
						>
							<div style={{ fontSize: "0.78rem", letterSpacing: "0.06em", color: "#e7eef8" }}>TNT {slot.slotIndex + 1}</div>
							{isCharging ? (
								<div
									style={{
										position: "absolute",
										left: 0,
										bottom: 0,
										height: 4,
										width: `${Math.round(progress * 100)}%`,
										background: "#ff5353",
									}}
								/>
							) : null}
						</div>
					);
				})}
			</div>
			<GameScene onAreaChange={setAreaLabel} revealAll={effectiveRevealAll} debugCameraEnabled={debugCameraEnabled} />
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
								You Are
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
