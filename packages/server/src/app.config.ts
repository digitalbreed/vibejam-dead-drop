import { defineServer, defineRoom } from "colyseus";
import cors from "cors";
import express from "express";
import { GameRoom } from "./rooms/GameRoom.js";

const server = defineServer({
	rooms: {
		game_room: defineRoom(GameRoom),
	},
	express: (app) => {
		app.use(cors({ origin: true, credentials: true }));
		app.use(express.json());
		app.get("/health", (_req, res) => {
			res.json({ ok: true });
		});
	},
});

export default server;
