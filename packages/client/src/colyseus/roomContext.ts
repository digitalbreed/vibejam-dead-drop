import { Client } from "@colyseus/sdk";
import { createRoomContext } from "@colyseus/react";
import type { GameState } from "@vibejam/shared";

const url = import.meta.env.VITE_COLYSEUS_URL ?? "http://localhost:2567";

export const colyseusClient = new Client(url);

export const { RoomProvider, useRoom, useRoomState } = createRoomContext<GameState>();
