import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameState, type GameTeam } from "@vibejam/shared";
import {
	colyseusClient,
	getLatestRoleAssignment,
	prepareGameRoom,
	RoomProvider,
	useRoom,
	useRoomState,
} from "../colyseus/roomContext";
import { schemaMapValues } from "../colyseus/schemaMap";
import { GameScene } from "../game/GameScene";
import {
	createVirtualKeyboardInputSource,
	type MovementKeyCode,
	type KeyboardInputSource,
} from "../game/input/keyboardInput";

const MAX_BOT_COUNT = 3;
const DEFAULT_TARGET_PLAYERS = 4;
const BOT_MOVE_CODES: MovementKeyCode[] = ["KeyW", "KeyA", "KeyS", "KeyD"];

function readTargetPlayers(): number {
	const value = Number(import.meta.env.VITE_DEV_BOTS_TARGET_PLAYERS ?? DEFAULT_TARGET_PLAYERS);
	if (!Number.isFinite(value)) {
		return DEFAULT_TARGET_PLAYERS;
	}
	return Math.max(1, Math.floor(value));
}

function useWanderBotInput(inputSource: KeyboardInputSource & { emitDown: (event: { code: MovementKeyCode; repeat?: boolean }) => void; emitUp: (event: { code: MovementKeyCode; repeat?: boolean }) => void }, active: boolean) {
	const activeCodeRef = useRef<MovementKeyCode | null>(null);

	useEffect(() => {
		let timerId: number | null = null;

		const release = () => {
			if (!activeCodeRef.current) {
				return;
			}
			inputSource.emitUp({ code: activeCodeRef.current });
			activeCodeRef.current = null;
		};

		const scheduleNext = () => {
			timerId = window.setTimeout(step, 450 + Math.random() * 900);
		};

		const step = () => {
			release();
			if (active && Math.random() > 0.18) {
				const nextCode = BOT_MOVE_CODES[Math.floor(Math.random() * BOT_MOVE_CODES.length)]!;
				activeCodeRef.current = nextCode;
				inputSource.emitDown({ code: nextCode, repeat: false });
			}
			scheduleNext();
		};

		if (active) {
			scheduleNext();
		} else {
			release();
		}

		return () => {
			if (timerId !== null) {
				window.clearTimeout(timerId);
			}
			release();
		};
	}, [active, inputSource]);
}

function BotViewport({ slot }: { slot: number }) {
	const { room, isConnecting, error } = useRoom();
	const phase = useRoomState((state) => state.phase);
	const [team, setTeam] = useState<GameTeam | null>(null);
	const inputSource = useMemo(() => createVirtualKeyboardInputSource(), []);
	useWanderBotInput(inputSource, !!room && !isConnecting && !error);

	useEffect(() => {
		const cached = getLatestRoleAssignment(room);
		if (cached) {
			setTeam(cached.team);
		}
	}, [room]);

	useEffect(() => {
		if (!room) {
			return;
		}
		return room.onMessage("role_assignment", (message: { team: GameTeam }) => {
			setTeam(message.team);
		});
	}, [room]);

	useEffect(() => {
		if (phase !== "lobby") {
			return;
		}
		setTeam(null);
	}, [phase]);

	const roleLabel = team === "enforcers" ? "Enforcer" : team === "shredders" ? "Shredder" : null;
	const statusText =
		phase === "lobby"
			? `Bot ${slot + 1} waiting`
			: roleLabel
				? `Bot ${slot + 1} (${roleLabel}) active`
				: `Bot ${slot + 1} active`;

	return (
		<div style={{ position: "relative", width: "100%", height: "100%" }}>
			<div
				style={{
					position: "absolute",
					top: 8,
					left: 8,
					zIndex: 4,
					padding: "0.16rem 0.4rem",
					fontSize: "0.72rem",
					borderRadius: 4,
					background: "rgba(7, 10, 15, 0.74)",
					border: "1px solid rgba(100, 130, 175, 0.38)",
				}}
			>
				{statusText}
			</div>
			{error ? (
				<div
					style={{
						position: "absolute",
						inset: 0,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						padding: "0.4rem",
						fontSize: "0.74rem",
						textAlign: "center",
						background: "rgba(20, 6, 8, 0.84)",
						zIndex: 3,
					}}
				>
					{error.message}
				</div>
			) : null}
			<GameScene revealAll={false} debugCameraEnabled={false} audioEnabled={false} inputSource={inputSource} outlinesEnabled={false} />
		</div>
	);
}

function BotClientSlot({ roomId, slot }: { roomId: string; slot: number }) {
	const connectBotRoom = useCallback(
		() =>
			colyseusClient
				.joinById(
					roomId,
					{
						devBot: true,
						botSlot: slot + 1,
					},
					GameState,
				)
				.then((room) => {
					prepareGameRoom(room);
					return room;
				}),
		[roomId, slot],
	);

	return (
		<RoomProvider
			connect={connectBotRoom}
			deps={[roomId, slot]}
		>
			<BotViewport slot={slot} />
		</RoomProvider>
	);
}

export function DevBotsHost() {
	const { room } = useRoom();
	const phase = useRoomState((state) => state.phase);
	const playerCount = useRoomState((state) => schemaMapValues(state.players).length);
	const targetPlayers = readTargetPlayers();
	const [botCount, setBotCount] = useState(0);

	useEffect(() => {
		if (!room) {
			setBotCount(0);
			return;
		}
		if (phase !== "lobby" && botCount === 0) {
			return;
		}
		if (botCount > 0) {
			return;
		}
		const requiredBots = Math.max(0, targetPlayers - Math.max(1, playerCount ?? 1));
		setBotCount(Math.min(MAX_BOT_COUNT, requiredBots));
	}, [botCount, phase, playerCount, room, targetPlayers]);

	if (!room || botCount <= 0) {
		return null;
	}

	return (
		<div
			style={{
				position: "fixed",
				top: 12,
				right: 12,
				bottom: 12,
				width: "24vw",
				minWidth: 220,
				maxWidth: 360,
				display: "flex",
				flexDirection: "column",
				gap: 10,
				pointerEvents: "none",
				zIndex: 5,
			}}
		>
			{Array.from({ length: botCount }, (_, slot) => (
				<div
					key={`bot-view-${slot}`}
					style={{
						position: "relative",
						flex: 1,
						minHeight: 120,
						borderRadius: 10,
						overflow: "hidden",
						border: "1px solid rgba(126, 149, 185, 0.52)",
						boxShadow: "0 8px 24px rgba(0, 0, 0, 0.44)",
						background: "rgba(9, 13, 21, 0.72)",
					}}
				>
					<BotClientSlot roomId={room.roomId} slot={slot} />
				</div>
			))}
		</div>
	);
}
