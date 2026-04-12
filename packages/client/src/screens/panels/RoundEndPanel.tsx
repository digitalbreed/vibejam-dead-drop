import { useEffect, useState } from "react";
import type { GameServerMessages, GameTeam } from "@vibejam/shared";
import { playUiClickSound } from "../../audio/playUiClickSound";

type RoundEndStage = "hidden" | "pre-enter" | "center";
type RoundEndSummary = GameServerMessages["round_end_summary"];

function deriveRematchCode(currentCode: string, roomId: string | undefined): string {
	const source = (currentCode.trim().length > 0 ? currentCode : roomId ?? "")
		.replace(/\s+/g, "")
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "");
	const base = source.length > 0 ? source : "ROOM";
	return `${base.slice(0, 23)}R`;
}

function teamLabel(team: GameTeam): string {
	return team === "enforcers" ? "Enforcers" : "Shredders";
}

export function RoundEndPanel({
	stage,
	summary,
	gameCode,
	roomId,
	onPlayAnotherRound,
	onBackToStartScreen,
}: {
	stage: RoundEndStage;
	summary: RoundEndSummary | null;
	gameCode: string;
	roomId: string | undefined;
	onPlayAnotherRound?: (gameCode: string) => void;
	onBackToStartScreen?: () => void;
}) {
	const [mobileLayout, setMobileLayout] = useState(false);
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
	if (stage === "hidden" || !summary) {
		return null;
	}
	const transform =
		stage === "pre-enter"
			? "translate(-50%, -50%) translateX(120vw)"
			: "translate(-50%, -50%) translateX(0)";
	const rematchCode = deriveRematchCode(gameCode, roomId);
	const shredders = summary.players.filter((player) => player.team === "shredders");
	const enforcers = summary.players.filter((player) => player.team === "enforcers");
	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				pointerEvents: "auto",
				zIndex: 10,
				background:
					"radial-gradient(circle at center, rgba(5, 9, 16, 0.35) 0%, rgba(3, 6, 11, 0.66) 62%, rgba(2, 4, 8, 0.8) 100%)",
			}}
		>
			<div
				style={{
					position: "absolute",
					left: "50%",
					top: "50%",
					transform,
					transition: "transform 720ms cubic-bezier(0.2, 0.9, 0.2, 1)",
					width: "min(92vw, 920px)",
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
						fontSize: "clamp(2.1rem, 7vw, 4.2rem)",
						lineHeight: 0.92,
						textTransform: "uppercase",
						textShadow: "0 0 24px rgba(160, 220, 255, 0.42)",
					}}
				>
					{teamLabel(summary.winnerTeam)} Won The Round
				</div>
				<p
					style={{
						margin: "0.8rem auto 0",
						maxWidth: "40rem",
						fontSize: "clamp(1rem, 2.3vw, 1.26rem)",
						lineHeight: 1.45,
						opacity: 0.96,
					}}
				>
					{summary.punchline}
				</p>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
						gap: "0.9rem",
						marginTop: "1.1rem",
						textAlign: "left",
					}}
				>
					<div
						style={{
							border: "1px solid rgba(255, 90, 90, 0.3)",
							background: "rgba(120, 26, 26, 0.18)",
							padding: "0.7rem 0.8rem",
						}}
					>
						<div style={{ fontWeight: 700, color: "#ff8f8f", textTransform: "uppercase", marginBottom: 6 }}>Shredders</div>
						{shredders.length > 0 ? (
							shredders.map((player) => (
								<div key={player.sessionId} style={{ opacity: player.isAlive ? 1 : 0.78 }}>
									{player.name}
									{player.isAlive ? "" : " (KIA)"}
								</div>
							))
						) : (
							<div style={{ opacity: 0.8 }}>No agents</div>
						)}
					</div>
					<div
						style={{
							border: "1px solid rgba(96, 164, 255, 0.28)",
							background: "rgba(30, 50, 96, 0.18)",
							padding: "0.7rem 0.8rem",
						}}
					>
						<div style={{ fontWeight: 700, color: "#9dc8ff", textTransform: "uppercase", marginBottom: 6 }}>Enforcers</div>
						{enforcers.length > 0 ? (
							enforcers.map((player) => (
								<div key={player.sessionId} style={{ opacity: player.isAlive ? 1 : 0.78 }}>
									{player.name}
									{player.isAlive ? "" : " (KIA)"}
								</div>
							))
						) : (
							<div style={{ opacity: 0.8 }}>No agents</div>
						)}
					</div>
				</div>
				<div
					style={{
						display: "flex",
						flexDirection: mobileLayout ? "column" : "row",
						alignItems: mobileLayout ? "stretch" : "center",
						justifyContent: "center",
						gap: 10,
						marginTop: "1.2rem",
					}}
				>
					<button
						type="button"
						className="comic-agent-button"
						style={mobileLayout ? { width: "100%" } : undefined}
						onClick={() => {
							playUiClickSound();
							onPlayAnotherRound?.(rematchCode);
						}}
					>
						Rematch with this team
					</button>
					<button
						type="button"
						className="comic-agent-button"
						style={mobileLayout ? { width: "100%" } : undefined}
						onClick={() => {
							playUiClickSound();
							onBackToStartScreen?.();
						}}
					>
						Back to start screen
					</button>
				</div>
			</div>
		</div>
	);
}
