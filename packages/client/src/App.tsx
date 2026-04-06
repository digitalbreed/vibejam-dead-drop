import { useState } from "react";
import { GameState } from "@vibejam/shared";
import { colyseusClient, RoomProvider, useRoom, useRoomState } from "./colyseus/roomContext";
import { TitleScreen } from "./screens/TitleScreen";
import { LobbyScreen } from "./screens/LobbyScreen";
import { GameScreen } from "./screens/GameScreen";

function ConnectedFlow() {
	const { room, error, isConnecting } = useRoom();
	const phase = useRoomState((s) => s.phase);

	if (error) {
		return (
			<div style={{ padding: "2rem", color: "#f88" }}>
				<p style={{ margin: 0 }}>Connection error: {error.message}</p>
			</div>
		);
	}

	if (isConnecting || !room) {
		return (
			<div style={{ padding: "2rem", opacity: 0.9 }}>
				<p style={{ margin: 0 }}>Connecting to matchmaker…</p>
			</div>
		);
	}

	if (phase === "lobby") {
		return <LobbyScreen />;
	}

	return <GameScreen />;
}

export default function App() {
	const [joinRequested, setJoinRequested] = useState(false);

	return (
		<>
			{!joinRequested && <TitleScreen onJoin={() => setJoinRequested(true)} />}
			{joinRequested && (
				<RoomProvider
					connect={() =>
						colyseusClient.joinOrCreate(
							"game_room",
							{ mapMaxDistance: Number(import.meta.env.VITE_MAP_MAX_DISTANCE ?? 12) },
							GameState,
						)
					}
					deps={[joinRequested]}
				>
					<ConnectedFlow />
				</RoomProvider>
			)}
		</>
	);
}
