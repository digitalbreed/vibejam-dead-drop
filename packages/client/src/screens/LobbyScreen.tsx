import { useRoomState } from "../colyseus/roomContext";
import { schemaMapValues } from "../colyseus/schemaMap";

const minDisplay = Number(import.meta.env.VITE_MIN_PLAYERS ?? (import.meta.env.DEV ? 4 : 1));

export function LobbyScreen() {
	const count = useRoomState((s) => schemaMapValues(s.players).length);
	const phase = useRoomState((s) => s.phase);

	if (phase !== "lobby") {
		return null;
	}

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				pointerEvents: "none",
				background: "radial-gradient(ellipse at center, rgba(15,25,40,0.92) 0%, rgba(8,12,18,0.96) 100%)",
			}}
		>
			<div
				style={{
					padding: "1.5rem 2rem",
					borderRadius: "12px",
					border: "1px solid rgba(100, 140, 200, 0.35)",
					background: "rgba(12, 18, 28, 0.85)",
					maxWidth: "24rem",
					textAlign: "center",
				}}
			>
				<h2 style={{ margin: "0 0 0.75rem", fontSize: "1.25rem" }}>Lobby</h2>
				<p style={{ margin: 0, opacity: 0.9, lineHeight: 1.5 }}>
					Matchmaking: filling the room to at least <strong>{minDisplay}</strong> player
					{minDisplay === 1 ? "" : "s"} before the round starts.
				</p>
				<p style={{ margin: "1rem 0 0", fontVariantNumeric: "tabular-nums" }}>
					Players in this room: <strong>{count}</strong>
				</p>
			</div>
		</div>
	);
}
