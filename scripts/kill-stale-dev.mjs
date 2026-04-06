#!/usr/bin/env node
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(process.cwd()).toLowerCase();
const selfPid = process.pid;

function isCandidate(commandLine) {
	const cmd = (commandLine || "").toLowerCase();
	if (!cmd.includes(repoRoot)) {
		return false;
	}
	// Anything node-based running from this repo can interfere with dev startup.
	// Kill broadly to guarantee a single clean dev graph.
	return true;
}

async function listNodeProcessesWindows() {
	const ps = `
$procs = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -ne $null } |
  Select-Object ProcessId, ParentProcessId, CommandLine
$procs | ConvertTo-Json -Depth 3
`;
	const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", ps]);
	if (!stdout.trim()) {
		return [];
	}
	const parsed = JSON.parse(stdout);
	return Array.isArray(parsed) ? parsed : [parsed];
}

async function killPidTreeWindows(pid) {
	try {
		await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]);
		return true;
	} catch {
		return false;
	}
}

async function main() {
	if (process.platform !== "win32") {
		return;
	}
	const processes = await listNodeProcessesWindows();
	const victims = processes
		.filter((proc) => Number(proc.ProcessId) > 0 && Number(proc.ProcessId) !== selfPid)
		.filter((proc) => isCandidate(proc.CommandLine))
		.map((proc) => Number(proc.ProcessId));

	const uniqueVictims = [...new Set(victims)];
	if (uniqueVictims.length === 0) {
		console.log("[dev-clean] no stale repo node processes found");
		return;
	}
	for (const pid of uniqueVictims) {
		const ok = await killPidTreeWindows(pid);
		console.log(`[dev-clean] ${ok ? "killed" : "failed"} pid=${pid}`);
	}
}

main().catch((error) => {
	console.error(`[dev-clean] ${error.message}`);
	process.exit(1);
});
