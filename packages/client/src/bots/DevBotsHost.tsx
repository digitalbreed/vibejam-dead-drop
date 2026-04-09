import { useCallback, useEffect, useState } from "react";
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
import { useDevBotController } from "./useDevBotController";

const MAX_BOT_COUNT = 3;
const DEFAULT_TARGET_PLAYERS = 4;
const DEFAULT_RENDER_FPS = 15;
const DEFAULT_MAX_VISIBLE_PREVIEWS = 3;

type BotPreviewMode = "full" | "placeholder" | "none";

function readPositiveInt(raw: unknown, fallback: number): number {
	const value = Number(raw);
	if (!Number.isFinite(value)) {
		return fallback;
	}
	return Math.max(1, Math.floor(value));
}

function readTargetPlayers(): number {
	return readPositiveInt(import.meta.env.VITE_DEV_BOTS_TARGET_PLAYERS ?? DEFAULT_TARGET_PLAYERS, DEFAULT_TARGET_PLAYERS);
}

function readRenderFps(): number {
	return readPositiveInt(import.meta.env.VITE_DEV_BOTS_RENDER_FPS ?? DEFAULT_RENDER_FPS, DEFAULT_RENDER_FPS);
}

function readMaxVisiblePreviews(): number {
	return readPositiveInt(
		import.meta.env.VITE_DEV_BOTS_MAX_VISIBLE_PREVIEWS ?? DEFAULT_MAX_VISIBLE_PREVIEWS,
		DEFAULT_MAX_VISIBLE_PREVIEWS,
	);
}

function BotClientViewport({
	slot,
	mode,
	renderFps,
	botsPaused,
}: {
	slot: number;
	mode: BotPreviewMode;
	renderFps: number;
	botsPaused: boolean;
}) {
	const { room, isConnecting, error } = useRoom();
	const localSessionId = room?.sessionId;
	const phase = useRoomState((state) => state.phase);
	const localIsAlive = useRoomState((state) => {
		if (!localSessionId) {
			return true;
		}
		const sourcePlayers = state?.players;
		if (!sourcePlayers) {
			return true;
		}
		const player =
			typeof sourcePlayers.get === "function"
				? sourcePlayers.get(localSessionId)
				: (sourcePlayers as Record<string, any>)[localSessionId];
		return player?.isAlive !== false;
	});
	const localName = useRoomState((state) => {
		if (!localSessionId) {
			return "";
		}
		const sourcePlayers = state?.players;
		if (!sourcePlayers) {
			return "";
		}
		const player =
			typeof sourcePlayers.get === "function"
				? sourcePlayers.get(localSessionId)
				: (sourcePlayers as Record<string, any>)[localSessionId];
		return typeof player?.name === "string" ? player.name.trim() : "";
	});
	const [team, setTeam] = useState<GameTeam | null>(null);
	const safeLocalIsAlive = localIsAlive ?? true;
	const safeLocalName = localName ?? "";

	useDevBotController({
		slot,
		room,
		team,
		phase,
		isConnecting,
		error,
		isAlive: safeLocalIsAlive !== false,
		isPaused: botsPaused,
	});

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

	if (mode === "none") {
		return null;
	}

	const roleLabel = team === "enforcers" ? "Enforcer" : team === "shredders" ? "Shredder" : null;
	const activeName = safeLocalName || `Bot ${slot + 1}`;
	const activeLabel = roleLabel ? `${activeName}, ${roleLabel}` : activeName;
	const activeText =
		phase === "lobby"
			? `Bot ${slot + 1} waiting`
			: safeLocalIsAlive === false
				? `Bot ${slot + 1} dead`
				: `Bot ${slot + 1} (${activeLabel}) active`;
	const statusText = mode === "placeholder" ? `${activeText} (preview paused)` : activeText;

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
			{mode === "full" ? (
				<GameScene
					revealAll={false}
					debugCameraEnabled={false}
					audioEnabled={false}
					controlsEnabled={false}
					outlinesEnabled={false}
					frameloop="demand"
					renderFps={renderFps}
					dpr={0.65}
					shadows={false}
				/>
			) : (
				<div
					style={{
						position: "absolute",
						inset: 0,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						color: "rgba(216, 229, 246, 0.85)",
						fontSize: "0.74rem",
						background: "linear-gradient(140deg, rgba(7, 12, 18, 0.84), rgba(14, 20, 30, 0.7))",
					}}
				>
					Preview paused
				</div>
			)}
		</div>
	);
}

function BotClientSlot({
	roomId,
	slot,
	mode,
	renderFps,
	botsPaused,
}: {
	roomId: string;
	slot: number;
	mode: BotPreviewMode;
	renderFps: number;
	botsPaused: boolean;
}) {
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
			<BotClientViewport slot={slot} mode={mode} renderFps={renderFps} botsPaused={botsPaused} />
		</RoomProvider>
	);
}

export function DevBotsHost({ visible = true, botsPaused = false }: { visible?: boolean; botsPaused?: boolean }) {
	const { room } = useRoom();
	const phase = useRoomState((state) => state.phase);
	const playerCount = useRoomState((state) => schemaMapValues(state.players).length);
	const targetPlayers = readTargetPlayers();
	const renderFps = readRenderFps();
	const maxVisiblePreviews = readMaxVisiblePreviews();
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

	const previewCount = visible ? Math.min(botCount, maxVisiblePreviews) : 0;
	const slots = Array.from({ length: botCount }, (_, slot) => slot);

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
				display: visible ? "flex" : "none",
				flexDirection: "column",
				gap: 10,
				pointerEvents: "none",
				zIndex: 5,
			}}
		>
			{slots.map((slot) => (
				<div
					key={`bot-slot-${slot}`}
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
					<BotClientSlot
						roomId={room.roomId}
						slot={slot}
						mode={visible ? (slot < previewCount ? "full" : "placeholder") : "none"}
						renderFps={renderFps}
						botsPaused={botsPaused}
					/>
				</div>
			))}
		</div>
	);
}
