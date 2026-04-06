/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_COLYSEUS_URL: string | undefined;
	readonly VITE_MIN_PLAYERS: string | undefined;
	readonly VITE_MAP_MAX_DISTANCE: string | undefined;
	readonly VITE_DEV_BOTS_ENABLED: string | undefined;
	readonly VITE_DEV_BOTS_TARGET_PLAYERS: string | undefined;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
