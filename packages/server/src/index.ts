/**
 * Self-hosted Colyseus entry. See https://docs.colyseus.io/server
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listen } from "@colyseus/tools";
import app from "./app.config.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT ?? 2567);
const MAX_RETRY_ATTEMPTS = 50;

type ManagedServer = {
	gracefullyShutdown: (exit?: boolean) => Promise<void>;
};

type ServerGlobals = typeof globalThis & {
	__vibejamActiveServer?: ManagedServer;
	__vibejamSignalHooksInstalled?: boolean;
	__vibejamShutdownInProgress?: boolean;
};

const globalState = globalThis as ServerGlobals;

async function listPidsOnPort(port: number): Promise<number[]> {
	if (process.platform === "win32") {
		const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"]);
		const pids = new Set<number>();
		for (const line of stdout.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed.startsWith("TCP")) {
				continue;
			}
			const parts = trimmed.split(/\s+/);
			if (parts.length < 5) {
				continue;
			}
			const localAddress = parts[1] ?? "";
			if (!localAddress.endsWith(`:${port}`)) {
				continue;
			}
			const pid = Number(parts[parts.length - 1] ?? "");
			if (Number.isInteger(pid) && pid > 0) {
				pids.add(pid);
			}
		}
		return [...pids];
	}
	try {
		const { stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
		const pids = new Set<number>();
		for (const line of stdout.split(/\r?\n/)) {
			const pid = Number(line.trim());
			if (Number.isInteger(pid) && pid > 0) {
				pids.add(pid);
			}
		}
		return [...pids];
	} catch {
		return [];
	}
}

async function stopPidTree(pid: number) {
	if (pid === process.pid || pid <= 0) {
		return;
	}
	if (process.platform === "win32") {
		try {
			await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]);
		} catch {
			// ignore
		}
		return;
	}
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		// ignore
	}
}

async function freePortForDev(port: number) {
	if (process.env.NODE_ENV === "production") {
		return;
	}
	for (let attempt = 1; attempt <= 20; attempt++) {
		const victims = (await listPidsOnPort(port)).filter((pid) => pid !== process.pid);
		if (victims.length === 0) {
			return;
		}
		for (const pid of victims) {
			console.warn(`[server] killing stale process on port ${port}: pid=${pid}`);
			await stopPidTree(pid);
		}
		await wait(120);
	}
}

function isAddressInUseError(error: unknown): boolean {
	const code = (error as { code?: unknown })?.code;
	if (code === "EADDRINUSE") {
		return true;
	}
	const message = String((error as { message?: unknown })?.message ?? "");
	const fallback = String(error ?? "");
	return (
		message.includes("EADDRINUSE") ||
		message.includes("address already in use") ||
		fallback.includes("EADDRINUSE") ||
		fallback.includes("address already in use")
	);
}

async function shutdownPreviousInProcessServer() {
	if (!globalState.__vibejamActiveServer) {
		return;
	}
	try {
		console.warn("[server] shutting down previous in-process server instance before restart");
		await globalState.__vibejamActiveServer.gracefullyShutdown(false);
	} catch {
		// ignore
	} finally {
		globalState.__vibejamActiveServer = undefined;
	}
}

const startServer = async () => {
	let attempts = 0;

	while (true) {
		try {
			return await listen(app);
		} catch (error) {
			const addressInUse = isAddressInUseError(error);
			const recoverable = addressInUse || process.env.NODE_ENV !== "production";
			if (!recoverable) {
				throw error;
			}

			attempts += 1;
			if (attempts > MAX_RETRY_ATTEMPTS) {
				const pids = await listPidsOnPort(PORT);
				throw new Error(
					`Server startup failed after ${MAX_RETRY_ATTEMPTS} retries. Last error: ${String(
						(error as { message?: unknown })?.message ?? error,
					)}. Port ${PORT} PIDs: ${pids.join(", ") || "none"}`,
				);
			}
			await shutdownPreviousInProcessServer();
			await freePortForDev(PORT);
			console.warn(
				`Server startup retry ${attempts}/${MAX_RETRY_ATTEMPTS} (${addressInUse ? "EADDRINUSE" : "startup error"}). Retrying...`,
			);
			await wait(300);
		}
	}
};

await shutdownPreviousInProcessServer();
const gameServer = await startServer();
globalState.__vibejamActiveServer = gameServer as ManagedServer;

const shutdown = async () => {
	if (globalState.__vibejamShutdownInProgress) {
		return;
	}
	globalState.__vibejamShutdownInProgress = true;
	await gameServer.gracefullyShutdown(false);
	globalState.__vibejamActiveServer = undefined;
	process.exit(0);
};

if (!globalState.__vibejamSignalHooksInstalled) {
	globalState.__vibejamSignalHooksInstalled = true;
	process.once("SIGINT", () => {
		void shutdown();
	});

	process.once("SIGTERM", () => {
		void shutdown();
	});
}
