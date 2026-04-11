import { createContext, createElement, useContext, type ReactNode } from "react";
import { Client, type Room } from "@colyseus/sdk";
import {
	useRoom as useColyseusRoom,
	useRoomState as useColyseusRoomState,
} from "@colyseus/react";
import type { GameState, GameTeam } from "@vibejam/shared";

const defaultUrl =
	typeof window !== "undefined" ? window.location.origin : "http://localhost:2567";
const url = import.meta.env.VITE_COLYSEUS_URL ?? defaultUrl;
export const colyseusClient = new Client(url);

export type RoleAssignmentMessage = {
	team: GameTeam;
};

type TrackedRoom = Room<any, GameState> & {
	__latestRoleAssignment?: RoleAssignmentMessage;
};

/**
 * Attach handlers synchronously when the room is created, before React's `useEffect` subscribers run.
 * Otherwise the SDK can receive `ROOM_DATA` first and warn: `onMessage() not registered for type '…'`
 * (common with HMR and with servers that broadcast immediately after join).
 * Real logic still registers additional listeners via `onMessage` (nanoevents stacks callbacks).
 */
export function prepareGameRoom(room: Room<any, GameState>): void {
	const trackedRoom = room as TrackedRoom;
	trackedRoom.__latestRoleAssignment = undefined;
	room.onMessage("role_assignment", (message: RoleAssignmentMessage) => {
		trackedRoom.__latestRoleAssignment = message;
	});
	room.onMessage("interactable_event", () => {});
	room.onMessage("interaction_feedback", () => {});
	room.onMessage("explosion_event", () => {});
	room.onMessage("escape_sequence_event", () => {});
	room.onMessage("ticker_event", () => {});
}

export function getLatestRoleAssignment(
	room: Room<any, GameState> | undefined,
): RoleAssignmentMessage | undefined {
	return (room as TrackedRoom | undefined)?.__latestRoleAssignment;
}

type RoomConnect = (() => Promise<Room<any, GameState>>) | null | undefined;

type RoomProviderProps = {
	connect?: RoomConnect;
	deps?: unknown[];
	children: ReactNode;
};

type RoomContextValue = {
	room: Room<any, GameState> | undefined;
	error: Error | undefined;
	isConnecting: boolean;
};

const RoomContext = createContext<RoomContextValue>({
	room: undefined,
	error: undefined,
	isConnecting: false,
});

export function RoomProvider({ connect, deps, children }: RoomProviderProps) {
	const { room, error, isConnecting } = useColyseusRoom(connect ?? null, deps);
	return createElement(
		RoomContext.Provider,
		{
			value: { room: room as Room<any, GameState> | undefined, error, isConnecting },
		},
		children,
	);
}

export function useRoom() {
	return useContext(RoomContext);
}

export function useRoomState<TSelected>(
	selector: (state: any) => TSelected,
): TSelected | undefined {
	const { room } = useRoom();
	return useColyseusRoomState(room as Room<any, GameState> | undefined, selector) as
		| TSelected
		| undefined;
}
