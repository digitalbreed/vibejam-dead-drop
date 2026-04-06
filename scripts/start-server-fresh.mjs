#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
	const args = { port: 2567, dryRun: false };
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (token === "--port" && i + 1 < argv.length) {
			args.port = Number(argv[++i]);
			continue;
		}
		if (token === "--dry-run") {
			args.dryRun = true;
		}
	}
	if (!Number.isFinite(args.port) || args.port <= 0 || args.port > 65535) {
		throw new Error(`Invalid --port value: ${args.port}`);
	}
	return args;
}

async function listPidsOnPort(port) {
	if (process.platform === "win32") {
		const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"]);
		const pids = new Set();
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
			const pidText = parts[parts.length - 1] ?? "";
			if (!localAddress.endsWith(`:${port}`)) {
				continue;
			}
			const pid = Number(pidText);
			if (Number.isInteger(pid) && pid > 0) {
				pids.add(pid);
			}
		}
		return [...pids];
	}

	try {
		const { stdout } = await execFileAsync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
		const pids = new Set();
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

function isAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function sleep(ms) {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopPid(pid) {
	if (!isAlive(pid)) {
		return;
	}
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		return;
	}
	for (let i = 0; i < 10; i++) {
		if (!isAlive(pid)) {
			return;
		}
		await sleep(100);
	}
	if (isAlive(pid)) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// ignore
		}
	}
}

async function freePort(port) {
	const pids = await listPidsOnPort(port);
	const victims = pids.filter((pid) => pid !== process.pid);
	if (victims.length === 0) {
		console.log(`[port-clean] port ${port} already free`);
		return;
	}
	for (const pid of victims) {
		console.log(`[port-clean] stopping pid=${pid} on port ${port}`);
		await stopPid(pid);
	}

	for (let i = 0; i < 20; i++) {
		const remaining = (await listPidsOnPort(port)).filter((pid) => pid !== process.pid);
		if (remaining.length === 0) {
			console.log(`[port-clean] port ${port} is now free`);
			return;
		}
		await sleep(150);
	}

	const remaining = (await listPidsOnPort(port)).filter((pid) => pid !== process.pid);
	if (remaining.length > 0) {
		throw new Error(`Port ${port} is still bound by pid(s): ${remaining.join(", ")}`);
	}
}

function startServer() {
	console.log("[server-start] launching @vibejam/server");
	const child = execFile(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "start", "-w", "packages/server"], {
		stdio: "inherit",
	});
	child.on("exit", (code, signal) => {
		if (signal) {
			process.kill(process.pid, signal);
			return;
		}
		process.exit(code ?? 0);
	});
	child.on("error", (error) => {
		console.error(`[server-start] failed: ${error.message}`);
		process.exit(1);
	});
}

async function runNpm(args, label) {
	const npmBin = "npm";
	console.log(`[${label}] npm ${args.join(" ")}`);
	await new Promise((resolve, reject) => {
		const child = spawn(npmBin, args, { stdio: "inherit", shell: process.platform === "win32" });
		child.on("error", (error) => reject(new Error(`${label} failed: ${error.message}`)));
		child.on("exit", (code, signal) => {
			if (signal) {
				reject(new Error(`${label} interrupted by signal ${signal}`));
				return;
			}
			if ((code ?? 1) !== 0) {
				reject(new Error(`${label} failed with exit code ${code}`));
				return;
			}
			resolve(undefined);
		});
	});
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	await freePort(args.port);
	await runNpm(["run", "build", "-w", "packages/shared"], "shared-build");
	if (args.dryRun) {
		console.log("[server-start] dry-run complete");
		return;
	}
	startServer();
}

main().catch((error) => {
	console.error(`[start-server-fresh] ${error.message}`);
	process.exit(1);
});
