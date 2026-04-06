/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_COLYSEUS_URL: string | undefined;
	readonly VITE_MAP_MAX_DISTANCE: string | undefined;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
