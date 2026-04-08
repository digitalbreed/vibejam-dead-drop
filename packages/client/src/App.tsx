import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { GameState } from "@vibejam/shared";
import {
	colyseusClient,
	prepareGameRoom,
	RoomProvider,
	useRoom,
	useRoomState,
} from "./colyseus/roomContext";
import { TitleScreen } from "./screens/TitleScreen";
import { LobbyScreen } from "./screens/LobbyScreen";
import { GameScreen } from "./screens/GameScreen";

type JoinParams = {
	operatorName: string;
	gameCode: string;
};

const devBotsEnabled =
	import.meta.env.DEV &&
	(import.meta.env.VITE_DEV_BOTS_ENABLED ?? "1").trim() !== "0";

function DevBotsLoader({ visible, botsPaused }: { visible: boolean; botsPaused: boolean }) {
	const { room } = useRoom();
	const [Host, setHost] = useState<ComponentType<{ visible?: boolean; botsPaused?: boolean }> | null>(null);

	useEffect(() => {
		if (!devBotsEnabled) {
			return;
		}
		let mounted = true;
		void import("./bots/DevBotsHost").then((mod) => {
			if (!mounted) {
				return;
			}
			setHost(() => mod.DevBotsHost);
		});
		return () => {
			mounted = false;
		};
	}, []);

	if (!devBotsEnabled || !Host || !room) {
		return null;
	}

	return <Host visible={visible} botsPaused={botsPaused} />;
}

function ConnectedFlow() {
	const { room, error, isConnecting } = useRoom();
	const phase = useRoomState((s) => s.phase);
	const [devBotsVisible, setDevBotsVisible] = useState(false);
	const [botsPaused, setBotsPaused] = useState(false);

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

	return (
		<>
			{phase === "lobby" ? (
				<LobbyScreen />
			) : (
				<GameScreen
					devBotsVisible={devBotsVisible}
					botsPaused={botsPaused}
					onToggleDevBotsVisibility={() => setDevBotsVisible((current) => !current)}
					onToggleBotsPaused={() => setBotsPaused((current) => !current)}
				/>
			)}
			<DevBotsLoader visible={devBotsVisible} botsPaused={botsPaused} />
		</>
	);
}

export default function App() {
	const [joinRequested, setJoinRequested] = useState(false);
	const [joinParams, setJoinParams] = useState<JoinParams>({
		operatorName: "",
		gameCode: "",
	});
	const mapMaxDistance = useMemo(
		() => Number(import.meta.env.VITE_MAP_MAX_DISTANCE ?? 12),
		[],
	);
	const connectMainRoom = useCallback(
		() =>
			colyseusClient
				.joinOrCreate(
					"game_room",
					{
						mapMaxDistance,
						operatorName: joinParams.operatorName,
						gameCode: joinParams.gameCode,
					},
					GameState,
				)
				.then((room) => {
				prepareGameRoom(room);
				return room;
			}),
		[joinParams.gameCode, joinParams.operatorName, mapMaxDistance],
	);

	return (
		<>
			{!joinRequested && (
				<TitleScreen
					onJoin={(params) => {
						setJoinParams(params);
						setJoinRequested(true);
					}}
				/>
			)}
			{joinRequested && (
				<RoomProvider
					connect={connectMainRoom}
					deps={[joinRequested]}
				>
					<ConnectedFlow />
				</RoomProvider>
			)}
		</>
	);
}
