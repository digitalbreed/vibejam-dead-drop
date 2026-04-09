import { defineServer, defineRoom } from "colyseus";
import cors from "cors";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameRoom } from "./rooms/GameRoom.js";

const serverBuildDir = path.dirname(fileURLToPath(import.meta.url));
const clientDistDir = path.resolve(serverBuildDir, "../../client/dist");

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

		if (existsSync(clientDistDir)) {
			app.use(express.static(clientDistDir));
			app.get("*", (req, res, next) => {
				if (!req.accepts("html")) {
					return next();
				}
				return res.sendFile(path.join(clientDistDir, "index.html"));
			});
		}
	},
});

export default server;
