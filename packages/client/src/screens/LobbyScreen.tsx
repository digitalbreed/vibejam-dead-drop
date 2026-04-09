import { useEffect, useMemo, useState } from "react";
import { useRoom, useRoomState } from "../colyseus/roomContext";

type PlayerLobbyView = {
	sessionId: string;
	name: string;
	isBot: boolean;
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

export function LobbyScreen() {
	const { room } = useRoom();
	const phase = useRoomState((s) => s.phase);
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
					Lobby
				</h2>
				<p style={{ margin: 0, opacity: 0.9, lineHeight: 1.45 }}>
					Waiting up to <strong>{formatSeconds(remainingSeconds)}</strong> for human players. Remaining
					slots will be filled with server bots before match start.
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
					}}
				>
					Players in room: <strong>{count}</strong> / <strong>{targetPlayers}</strong>
				</p>
				<div
					style={{
						marginTop: "0.9rem",
						border: "2px solid #253545",
						borderRadius: 6,
						padding: "0.55rem 0.65rem 0.5rem",
						maxHeight: "10rem",
						overflowY: "auto",
						background: "linear-gradient(180deg, #0f1a25 0%, #0f1a25 50%, #0a1218 51%, #0a1218 100%)",
					}}
				>
					{players.length === 0 ? (
						<div style={{ opacity: 0.75 }}>No players joined yet.</div>
					) : (
						players.map((player) => (
							<div
								key={player.sessionId}
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									padding: "0.22rem 0.1rem",
									gap: "0.75rem",
									borderBottom: "1px solid rgba(54, 77, 101, 0.45)",
								}}
							>
								<span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
									{player.name}
								</span>
								{player.isBot ? <span title="Server bot">🤖</span> : <span style={{ opacity: 0.55 }}>human</span>}
							</div>
						))
					)}
				</div>
				<div style={{ marginTop: "1rem", display: "flex", justifyContent: "center" }}>
					<button
						type="button"
						onClick={() => room?.send("lobby_skip_wait", {})}
						style={{
							pointerEvents: "auto",
							marginTop: "0.2rem",
							padding: "0.8rem 1.5rem",
							borderRadius: 8,
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
						Start Now (Fill with Bots)
					</button>
				</div>
			</div>
		</div>
	);
}
