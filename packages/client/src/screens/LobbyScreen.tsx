import { useEffect, useMemo, useState } from "react";
import { useRoom, useRoomState } from "../colyseus/roomContext";

type PlayerLobbyView = {
	sessionId: string;
	name: string;
	isBot: boolean;
	color: number;
};

function schemaMapEntries<T>(value: unknown): Array<[string, T]> {
	if (!value) {
		return [];
	}
	if (
		typeof value === "object" &&
		value !== null &&
		"entries" in value &&
		typeof (value as { entries: () => Iterable<[string, T]> }).entries === "function"
	) {
		return Array.from((value as { entries: () => Iterable<[string, T]> }).entries());
	}
	return Object.entries(value as Record<string, T>);
}

function formatSeconds(seconds: number): string {
	const clamped = Math.max(0, Math.floor(seconds));
	const mm = String(Math.floor(clamped / 60)).padStart(2, "0");
	const ss = String(clamped % 60).padStart(2, "0");
	return `${mm}:${ss}`;
}

function colorIntToHex(color: number): string {
	const safe = Number.isFinite(color) ? Math.max(0, Math.min(0xffffff, Math.floor(color))) : 0xffffff;
	return `#${safe.toString(16).padStart(6, "0")}`;
}

export function LobbyScreen() {
	const { room } = useRoom();
	const phase = useRoomState((s) => s.phase);
	const gameCode = useRoomState((s) => (typeof s?.gameCode === "string" ? s.gameCode : "")) ?? "";
	const playerCount = useRoomState((s) => Number(s?.players?.size ?? 0)) ?? 0;
	const targetPlayers = useRoomState((s) => Number(s?.lobbyTargetPlayers ?? 4)) ?? 4;
	const lobbyDeadlineEpochMs = useRoomState((s) => Number(s?.lobbyDeadlineEpochMs ?? 0)) ?? 0;
	const [nowMs, setNowMs] = useState(() => Date.now());

	useEffect(() => {
		if (phase !== "lobby") {
			return;
		}
		const id = window.setInterval(() => setNowMs(Date.now()), 200);
		return () => window.clearInterval(id);
	}, [phase]);

	const players = useMemo<PlayerLobbyView[]>(
		() =>
			schemaMapEntries<any>(room?.state?.players)
				.map(([sessionId, player]) => ({
					sessionId,
					name:
						typeof player?.name === "string" && player.name.trim().length > 0
							? player.name.trim()
							: "Agent",
					isBot: !!player?.isBot,
					color: typeof player?.color === "number" ? player.color : 0xffffff,
				}))
				.sort((a, b) => {
					if (a.isBot !== b.isBot) {
						return a.isBot ? 1 : -1;
					}
					return a.name.localeCompare(b.name);
				}),
		[playerCount, room],
	);

	const count = players.length || playerCount;
	const remainingSeconds =
		lobbyDeadlineEpochMs > 0 ? Math.max(0, Math.ceil((lobbyDeadlineEpochMs - nowMs) / 1000)) : 60;

	if (phase !== "lobby") {
		return null;
	}

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				padding: "2rem 1.2rem",
				background: "radial-gradient(ellipse at center, rgba(15,25,40,0.92) 0%, rgba(8,12,18,0.96) 100%)",
				pointerEvents: "auto",
			}}
		>
			<div
				className="title-panel"
				style={{
					position: "relative",
					zIndex: 2,
					width: "min(34rem, 94vw)",
					padding: "1.65rem 1.6rem",
					border: "3px solid #1a3045",
					background: "linear-gradient(165deg, transparent 58%, rgba(20,40,60,0.5) 58%), #0c1a2a",
					boxShadow: "4px 4px 0 #050a10, 8px 8px 0 rgba(0,0,0,0.3)",
					textAlign: "left",
				}}
			>
				<h2
					style={{
						margin: "0 0 0.6rem",
						fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
						fontSize: "clamp(1.9rem, 7vw, 2.45rem)",
						letterSpacing: "0.08em",
						lineHeight: 0.9,
						textTransform: "uppercase",
						textAlign: "center",
						textShadow: "0 0 24px rgba(160, 220, 255, 0.28)",
					}}
				>
					Staging Area
				</h2>
				<p style={{ margin: 0, opacity: 0.9, lineHeight: 1.45 }}>
					<span
						style={{
							display: "block",
							fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
							fontSize: "clamp(1.35rem, 5vw, 1.85rem)",
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							textAlign: "center",
							color: "#d7e9ff",
							textShadow: "0 0 14px rgba(125, 186, 236, 0.33)",
						}}
					>
						Deployment In {formatSeconds(remainingSeconds)}
					</span>
					<span
						style={{
							display: "block",
							marginTop: "0.35rem",
							textAlign: "center",
							opacity: 0.88,
						}}
					>
						Waiting for human operatives.
					</span>
				</p>
				<p
					style={{
						margin: "0.7rem 0 0",
						opacity: 0.95,
						fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
						fontSize: "1.05rem",
						letterSpacing: "0.08em",
						textTransform: "uppercase",
						color: "#9ed0f0",
						textAlign: "center",
					}}
				>
					Join code: <strong>{gameCode || "N/A"}</strong>
				</p>
				<p
					style={{
						margin: "0.7rem 0 0",
						opacity: 0.92,
						fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
						fontSize: "1.05rem",
						letterSpacing: "0.08em",
						textTransform: "uppercase",
						color: "#8ab4d8",
						textAlign: "center",
					}}
				>
					Operatives ready: <strong>{count}</strong> / <strong>{targetPlayers}</strong>
				</p>
				<div
					style={{
						marginTop: "0.9rem",
						padding: "0.1rem 0.1rem 0.1rem",
					}}
				>
					{players.length === 0 ? (
						<div style={{ opacity: 0.75, textAlign: "center" }}>No players joined yet.</div>
					) : null}
					{players.map((player) => (
						<div
							key={player.sessionId}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								padding: "0.45rem 0.55rem",
								gap: "0.75rem",
								border: "2px solid #253545",
								borderRadius: 6,
								background: "linear-gradient(180deg, #0f1a25 0%, #0f1a25 50%, #0a1218 51%, #0a1218 100%)",
								marginBottom: "0.42rem",
							}}
						>
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: "0.5rem",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								<span
									aria-hidden
									style={{
										width: 10,
										height: 10,
										borderRadius: "50%",
										background: colorIntToHex(player.color),
										border: "1px solid rgba(220, 230, 240, 0.55)",
										boxShadow: "0 0 0 1px rgba(6, 10, 16, 0.65)",
										flexShrink: 0,
									}}
								/>
								{player.name}
							</span>
							{player.isBot ? <span title="Server bot">🤖</span> : <span />}
						</div>
					))}
					{Array.from({ length: Math.max(0, targetPlayers - count) }, (_, index) => (
						<div
							key={`empty-slot-${index}`}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								padding: "0.45rem 0.55rem",
								gap: "0.75rem",
								opacity: 0.4,
								border: "2px solid rgba(58, 76, 96, 0.75)",
								borderRadius: 6,
								background: "linear-gradient(180deg, rgba(15,26,37,0.65) 0%, rgba(10,18,24,0.62) 100%)",
								marginBottom: "0.42rem",
							}}
						>
							<span
								style={{
									display: "inline-flex",
									alignItems: "center",
									gap: "0.5rem",
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								<span
									aria-hidden
									style={{
										width: 10,
										height: 10,
										borderRadius: "50%",
										background: "rgba(180, 196, 214, 0.15)",
										border: "1px solid rgba(180, 196, 214, 0.4)",
										boxShadow: "0 0 0 1px rgba(6, 10, 16, 0.45)",
										flexShrink: 0,
									}}
								/>
								Empty Slot
							</span>
							<span />
						</div>
					))}
				</div>
				<div style={{ marginTop: "1rem", display: "flex", justifyContent: "center" }}>
					<button
						type="button"
						className="comic-agent-button"
						onClick={() => room?.send("lobby_skip_wait", {})}
					>
						Deploy with Bots
					</button>
				</div>
			</div>
		</div>
	);
}
