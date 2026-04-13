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
	preferredColor?: string;
};

function normalizeGameCode(value: string): string {
	return value
		.replace(/\s+/g, "")
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.slice(0, 24);
}

function isNoRoomsFoundForCriteriaError(rawError: unknown): boolean {
	const text = String((rawError as { message?: unknown })?.message ?? rawError ?? "").toLowerCase();
	return text.includes("no rooms found with provided criteria");
}

function buildJoinErrorMessage(rawError: unknown, gameCode: string): string {
	const fallback = "Unable to join game. Please try again.";
	const text = String((rawError as { message?: unknown })?.message ?? rawError ?? "");
	const normalized = text.toLowerCase();
	const codeLabel = gameCode.trim();

	if (normalized.includes("locked")) {
		return codeLabel
			? `Room "${codeLabel}" is already full or already running.`
			: "This room is already full or already running.";
	}
	if (normalized.includes("already active")) {
		return codeLabel
			? `Room "${codeLabel}" is already full or already running.`
			: "This room is already full or already running.";
	}
	if (normalized.includes("max clients")) {
		return codeLabel
			? `Room "${codeLabel}" is already full.`
			: "This room is already full.";
	}
	if (normalized.includes("already full")) {
		return codeLabel
			? `Room "${codeLabel}" is already full.`
			: "This room is already full.";
	}
	if (normalized.includes("room not found")) {
		return codeLabel
			? `No room found for code "${codeLabel}". Check the code and try again.`
			: fallback;
	}

	return text.trim().length > 0 ? text : fallback;
}

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

function ConnectedFlow({
	onPlayAnotherRound,
	onBackToStartScreen,
}: {
	onPlayAnotherRound: (gameCode: string) => void;
	onBackToStartScreen: () => void;
}) {
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
					onPlayAnotherRound={async (gameCode) => {
						try {
							await room.leave();
						} catch {
							// best effort; reconnect path below still updates UI state
						}
						onPlayAnotherRound(gameCode);
					}}
					onBackToStartScreen={async () => {
						try {
							await room.leave();
						} catch {
							// best effort; return to title anyway
						}
						onBackToStartScreen();
					}}
				/>
			)}
			<DevBotsLoader visible={devBotsVisible} botsPaused={botsPaused} />
		</>
	);
}

export default function App() {
	const [joinRequested, setJoinRequested] = useState(false);
	const [connectionAttempt, setConnectionAttempt] = useState(0);
	const [joinParams, setJoinParams] = useState<JoinParams>({
		operatorName: "",
		gameCode: "",
		preferredColor: undefined,
	});
	const mapMaxDistance = useMemo(
		() => Number(import.meta.env.VITE_MAP_MAX_DISTANCE ?? 12),
		[],
	);
	const connectMainRoom = useCallback(
		async () => {
			const gameCode = normalizeGameCode(joinParams.gameCode);
			try {
				let room;
				if (gameCode.length > 0) {
					const options = {
						mapMaxDistance,
						operatorName: joinParams.operatorName,
						gameCode,
						preferredColor: joinParams.preferredColor,
					};
					try {
						room = await colyseusClient.join("game_room", options, GameState);
					} catch (joinError) {
						if (!isNoRoomsFoundForCriteriaError(joinError)) {
							throw joinError;
						}
						room = await colyseusClient.create("game_room", options, GameState);
					}
				} else {
					room = await colyseusClient.joinOrCreate(
						"game_room",
						{
							mapMaxDistance,
							operatorName: joinParams.operatorName,
							preferredColor: joinParams.preferredColor,
						},
						GameState,
					);
				}
				prepareGameRoom(room);
				return room;
			} catch (error) {
				throw new Error(buildJoinErrorMessage(error, gameCode));
			}
		},
		[joinParams.gameCode, joinParams.operatorName, joinParams.preferredColor, mapMaxDistance],
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
					deps={[joinRequested, joinParams.operatorName, joinParams.gameCode, connectionAttempt]}
				>
					<ConnectedFlow
						onPlayAnotherRound={(gameCode) => {
							setJoinParams((current) => ({
								operatorName: current.operatorName,
								gameCode,
								preferredColor: current.preferredColor,
							}));
							setConnectionAttempt((current) => current + 1);
							setJoinRequested(true);
						}}
						onBackToStartScreen={() => {
							setJoinRequested(false);
						}}
					/>
				</RoomProvider>
			)}
		</>
	);
}
