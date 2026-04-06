import { createContext, createElement, useContext, type ReactNode } from "react";
import { Client, type Room } from "@colyseus/sdk";
import {
	useRoom as useColyseusRoom,
	useRoomState as useColyseusRoomState,
} from "@colyseus/react";
import type { GameState } from "@vibejam/shared";

const url = import.meta.env.VITE_COLYSEUS_URL ?? "http://localhost:2567";
export const colyseusClient = new Client(url);

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
