/**
 * Self-hosted Colyseus entry. See https://docs.colyseus.io/server
 */
import { listen } from "@colyseus/tools";
import app from "./app.config.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const startServer = async () => {
	let attempts = 0;

	while (true) {
		try {
			return await listen(app);
		} catch (error) {
			const err = error as NodeJS.ErrnoException;
			if (err?.code !== "EADDRINUSE" || attempts >= 20) {
				throw error;
			}

			attempts += 1;
			console.warn(
				`Port 2567 still in use during restart (attempt ${attempts}/20). Retrying...`,
			);
			await wait(250);
		}
	}
};

const gameServer = await startServer();

const shutdown = async () => {
	await gameServer.gracefullyShutdown(false);
	process.exit(0);
};

process.once("SIGINT", () => {
	void shutdown();
});

process.once("SIGTERM", () => {
	void shutdown();
});
