import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"@vibejam/shared": path.resolve(root, "../shared/src/index.ts"),
		},
	},
	server: {
		port: 5173,
		fs: {
			allow: [path.resolve(root, "..")],
		},
	},
});
