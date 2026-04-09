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
			<div
				style={{
					position: "fixed",
					inset: 0,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					padding: "2rem 1.2rem",
					background: "radial-gradient(ellipse at center, rgba(15,25,40,0.92) 0%, rgba(8,12,18,0.96) 100%)",
				}}
			>
				<div
					className="title-panel"
					style={{
						width: "min(32rem, 94vw)",
						padding: "1.4rem 1.5rem",
						border: "3px solid #1a3045",
						background: "linear-gradient(165deg, transparent 58%, rgba(20,40,60,0.5) 58%), #0c1a2a",
						boxShadow: "4px 4px 0 #050a10, 8px 8px 0 rgba(0,0,0,0.3)",
						textAlign: "center",
					}}
				>
					<p
						style={{
							margin: 0,
							fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
							fontSize: "clamp(1.3rem, 5.2vw, 1.9rem)",
							letterSpacing: "0.07em",
							textTransform: "uppercase",
							color: "#ff8f8f",
						}}
					>
						Connection Error
					</p>
					<p style={{ margin: "0.5rem 0 0", color: "#f5c2c2", opacity: 0.95 }}>{error.message}</p>
				</div>
			</div>
		);
	}

	if (isConnecting || !room) {
		return (
			<div
				style={{
					position: "fixed",
					inset: 0,
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					padding: "2rem 1.2rem",
					background: "radial-gradient(ellipse at center, rgba(15,25,40,0.92) 0%, rgba(8,12,18,0.96) 100%)",
				}}
			>
				<div
					className="title-panel"
					style={{
						width: "min(30rem, 94vw)",
						padding: "1.35rem 1.45rem",
						border: "3px solid #1a3045",
						background: "linear-gradient(165deg, transparent 58%, rgba(20,40,60,0.5) 58%), #0c1a2a",
						boxShadow: "4px 4px 0 #050a10, 8px 8px 0 rgba(0,0,0,0.3)",
						textAlign: "center",
					}}
				>
					<p
						style={{
							margin: 0,
							fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
							fontSize: "clamp(1.3rem, 5.1vw, 1.8rem)",
							letterSpacing: "0.07em",
							textTransform: "uppercase",
							color: "#cfe7ff",
						}}
					>
						Connecting to Matchmaker...
					</p>
				</div>
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
