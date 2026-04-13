import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const PORTAL_PARAMS_STORAGE_KEY = "vibejam.portalParams";
const PORTAL_COLOR_STORAGE_KEY = "vibejam.portalColor";
const PORTAL_REDIRECT_URL = "https://vibej.am/portal/2026";
const PORTAL_PARAM_KEYS = [
	"username",
	"color",
	"speed",
	"ref",
	"avatar_url",
	"team",
	"hp",
	"speed_x",
	"speed_y",
	"speed_z",
	"rotation_x",
	"rotation_y",
	"rotation_z",
] as const;

type PortalParamKey = (typeof PORTAL_PARAM_KEYS)[number];
type PortalParams = Partial<Record<PortalParamKey, string>>;

type PortalOverrides = {
	username?: string;
	color?: string;
};

type PortalContextValue = {
	portalParams: PortalParams;
	portalColor?: string;
	incomingUsername?: string;
	hasLastGameRef: boolean;
	sendToNextGame: (overrides?: PortalOverrides) => void;
	sendBackToLastGame: (overrides?: PortalOverrides) => void;
};

const PortalContext = createContext<PortalContextValue | null>(null);

function normalizePortalValue(value: string | null | undefined): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function readStoredPortalParams(raw: string | null): PortalParams {
	if (!raw) {
		return {};
	}
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const next: PortalParams = {};
		for (const key of PORTAL_PARAM_KEYS) {
			const value = parsed[key];
			if (typeof value !== "string") {
				continue;
			}
			const normalized = normalizePortalValue(value);
			if (normalized) {
				next[key] = normalized;
			}
		}
		return next;
	} catch {
		return {};
	}
}

function readPortalParamsFromSearch(search: string): PortalParams {
	const parsed: PortalParams = {};
	const query = new URLSearchParams(search);
	for (const key of PORTAL_PARAM_KEYS) {
		const normalized = normalizePortalValue(query.get(key));
		if (normalized) {
			parsed[key] = normalized;
		}
	}
	return parsed;
}

function normalizePortalColor(raw: string | undefined): string | undefined {
	if (!raw) {
		return undefined;
	}
	const normalized = raw.trim().toLowerCase();
	if (normalized === "red" || normalized === "green" || normalized === "yellow") {
		return normalized;
	}
	const hex = normalized.replace(/^#/, "");
	if (/^[0-9a-f]{3}$/.test(hex) || /^[0-9a-f]{6}$/.test(hex)) {
		return `#${hex}`;
	}
	return undefined;
}

function normalizePortalRefDestination(raw: string | undefined): string | undefined {
	if (!raw) {
		return undefined;
	}
	const value = raw.trim();
	if (!value) {
		return undefined;
	}
	try {
		return new URL(value).toString();
	} catch {
		// Common portal refs are bare domains; default to https.
	}
	if (/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(value)) {
		return `https://${value}`;
	}
	if (value.startsWith("/")) {
		return value;
	}
	return undefined;
}

export function PortalProvider({ children }: { children: ReactNode }) {
	const [portalParams, setPortalParams] = useState<PortalParams>({});
	const [portalColor, setPortalColor] = useState<string | undefined>(undefined);
	const [incomingUsername, setIncomingUsername] = useState<string | undefined>(undefined);

	useEffect(() => {
		if (typeof window === "undefined") {
			return;
		}
		const storedPortalParams = readStoredPortalParams(
			window.localStorage.getItem(PORTAL_PARAMS_STORAGE_KEY),
		);
		const queryPortalParams = readPortalParamsFromSearch(window.location.search);
		const mergedPortalParams: PortalParams = {
			...storedPortalParams,
			...queryPortalParams,
		};
		setPortalParams(mergedPortalParams);
		window.localStorage.setItem(PORTAL_PARAMS_STORAGE_KEY, JSON.stringify(mergedPortalParams));

		const usernameFromQuery = normalizePortalValue(queryPortalParams.username);
		setIncomingUsername(usernameFromQuery);

		const colorFromQuery = normalizePortalColor(queryPortalParams.color);
		const colorFromStorage = normalizePortalColor(
			normalizePortalValue(window.localStorage.getItem(PORTAL_COLOR_STORAGE_KEY)),
		);
		const resolvedColor = colorFromQuery ?? colorFromStorage;
		setPortalColor(resolvedColor);
		if (resolvedColor) {
			window.localStorage.setItem(PORTAL_COLOR_STORAGE_KEY, resolvedColor);
		} else {
			window.localStorage.removeItem(PORTAL_COLOR_STORAGE_KEY);
		}
	}, []);

	const buildPortalPayload = (overrides?: PortalOverrides): PortalParams => {
		if (typeof window === "undefined") {
			return portalParams;
		}
		const payload: PortalParams = { ...portalParams };
		const overrideName = normalizePortalValue(overrides?.username);
		const overrideColor = normalizePortalColor(overrides?.color);
		if (overrideName) {
			payload.username = overrideName;
		}
		if (overrideColor) {
			payload.color = overrideColor;
		} else if (portalColor) {
			payload.color = portalColor;
		}
		payload.ref = window.location.origin;
		return payload;
	};

	const sendToNextGame = (overrides?: PortalOverrides) => {
		if (typeof window === "undefined") {
			return;
		}
		const nextUrl = new URL(PORTAL_REDIRECT_URL);
		const payload = buildPortalPayload(overrides);
		for (const key of PORTAL_PARAM_KEYS) {
			const value = normalizePortalValue(payload[key]);
			if (value) {
				nextUrl.searchParams.set(key, value);
			}
		}
		window.localStorage.setItem(PORTAL_PARAMS_STORAGE_KEY, JSON.stringify(payload));
		window.location.assign(nextUrl.toString());
	};

	const sendBackToLastGame = (overrides?: PortalOverrides) => {
		if (typeof window === "undefined") {
			return;
		}
		const lastRefDestination = normalizePortalRefDestination(portalParams.ref);
		if (!lastRefDestination) {
			return;
		}
		const destination = new URL(lastRefDestination, window.location.origin);
		const payload = buildPortalPayload(overrides);
		for (const key of PORTAL_PARAM_KEYS) {
			const value = normalizePortalValue(payload[key]);
			if (value) {
				destination.searchParams.set(key, value);
			}
		}
		window.localStorage.setItem(PORTAL_PARAMS_STORAGE_KEY, JSON.stringify(payload));
		window.location.assign(destination.toString());
	};

	const value = useMemo<PortalContextValue>(
		() => ({
			portalParams,
			portalColor,
			incomingUsername,
			hasLastGameRef: !!normalizePortalRefDestination(portalParams.ref),
			sendToNextGame,
			sendBackToLastGame,
		}),
		[incomingUsername, portalColor, portalParams],
	);

	return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortal() {
	const value = useContext(PortalContext);
	if (!value) {
		throw new Error("usePortal must be used within PortalProvider");
	}
	return value;
}

