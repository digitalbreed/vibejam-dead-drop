import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	type ReactNode,
} from "react";

type BackgroundMusicTrack = {
	src: string;
	volume?: number;
	loop?: boolean;
};

type BackgroundMusicRequest = {
	id: string;
	track: BackgroundMusicTrack | null;
	priority: number;
	fadeMs?: number;
	updatedAt: number;
};

type BackgroundMusicContextValue = {
	setRequest: (request: Omit<BackgroundMusicRequest, "updatedAt">) => void;
	clearRequest: (id: string) => void;
};

const DEFAULT_FADE_MS = 1000;
const EPSILON = 0.0001;

const BackgroundMusicContext = createContext<BackgroundMusicContextValue | null>(null);

function clampVolume(value: number | undefined): number {
	if (!Number.isFinite(value)) {
		return 0.5;
	}
	return Math.max(0, Math.min(1, value ?? 0.5));
}

function isSameTrackSource(audioSrc: string, requestedSrc: string): boolean {
	if (!audioSrc || !requestedSrc) {
		return false;
	}
	try {
		const a = new URL(audioSrc, window.location.href);
		const b = new URL(requestedSrc, window.location.href);
		return a.pathname === b.pathname;
	} catch {
		return audioSrc.endsWith(requestedSrc);
	}
}

export function BackgroundMusicProvider({ children }: { children: ReactNode }) {
	const requestsRef = useRef<Map<string, BackgroundMusicRequest>>(new Map());
	const [channelA, channelB] = useMemo(() => [new Audio(), new Audio()], []);
	const activeChannelRef = useRef<0 | 1>(0);
	const fadeFrameRef = useRef<number | null>(null);

	const getTopRequest = useCallback((): BackgroundMusicRequest | null => {
		let selected: BackgroundMusicRequest | null = null;
		for (const request of requestsRef.current.values()) {
			if (!selected) {
				selected = request;
				continue;
			}
			if (request.priority > selected.priority) {
				selected = request;
				continue;
			}
			if (request.priority === selected.priority && request.updatedAt > selected.updatedAt) {
				selected = request;
			}
		}
		return selected;
	}, []);

	const stopFade = useCallback(() => {
		if (fadeFrameRef.current !== null) {
			window.cancelAnimationFrame(fadeFrameRef.current);
			fadeFrameRef.current = null;
		}
	}, []);

	const runFade = useCallback(
		(params: {
			fromAudio?: HTMLAudioElement;
			fromStart: number;
			fromEnd: number;
			toAudio?: HTMLAudioElement;
			toStart: number;
			toEnd: number;
			durationMs: number;
			onComplete?: () => void;
		}) => {
			stopFade();
			const durationMs = Math.max(0, params.durationMs);
			if (durationMs === 0) {
				if (params.fromAudio) {
					params.fromAudio.volume = params.fromEnd;
				}
				if (params.toAudio) {
					params.toAudio.volume = params.toEnd;
				}
				params.onComplete?.();
				return;
			}
			const startMs = performance.now();
			const tick = (nowMs: number) => {
				const t = Math.max(0, Math.min(1, (nowMs - startMs) / durationMs));
				if (params.fromAudio) {
					params.fromAudio.volume = params.fromStart + (params.fromEnd - params.fromStart) * t;
				}
				if (params.toAudio) {
					params.toAudio.volume = params.toStart + (params.toEnd - params.toStart) * t;
				}
				if (t >= 1) {
					fadeFrameRef.current = null;
					params.onComplete?.();
					return;
				}
				fadeFrameRef.current = window.requestAnimationFrame(tick);
			};
			fadeFrameRef.current = window.requestAnimationFrame(tick);
		},
		[stopFade],
	);

	const applyTopRequest = useCallback(() => {
		const top = getTopRequest();
		const activeIndex = activeChannelRef.current;
		const active = activeIndex === 0 ? channelA : channelB;
		const inactive = activeIndex === 0 ? channelB : channelA;
		const fadeMs = Math.max(0, top?.fadeMs ?? DEFAULT_FADE_MS);

		if (!top?.track) {
			const activeSilent = active.paused || active.volume <= EPSILON;
			const inactiveSilent = inactive.paused || inactive.volume <= EPSILON;
			if (activeSilent && inactiveSilent) {
				return;
			}
			runFade({
				fromAudio: active,
				fromStart: active.volume,
				fromEnd: 0,
				toAudio: inactive,
				toStart: inactive.volume,
				toEnd: 0,
				durationMs: fadeMs,
				onComplete: () => {
					active.pause();
					active.currentTime = 0;
					inactive.pause();
					inactive.currentTime = 0;
				},
			});
			return;
		}

		const nextSrc = top.track.src;
		const nextVolume = clampVolume(top.track.volume);
		const nextLoop = top.track.loop ?? true;

		const activeIsTarget = isSameTrackSource(active.src, nextSrc);
		if (activeIsTarget) {
			active.loop = nextLoop;
			if (active.paused) {
				void active.play().catch(() => {});
			}
			const shouldFadeOutInactive = !inactive.paused || inactive.volume > EPSILON;
			runFade({
				fromAudio: shouldFadeOutInactive ? inactive : undefined,
				fromStart: shouldFadeOutInactive ? inactive.volume : 0,
				fromEnd: 0,
				toAudio: active,
				toStart: active.volume,
				toEnd: nextVolume,
				durationMs: fadeMs,
				onComplete: () => {
					if (!shouldFadeOutInactive) {
						return;
					}
					inactive.pause();
					inactive.currentTime = 0;
				},
			});
			return;
		}

		inactive.src = nextSrc;
		inactive.loop = nextLoop;
		inactive.preload = "auto";
		inactive.volume = 0;
		inactive.currentTime = 0;
		void inactive.play().catch(() => {});

		runFade({
			fromAudio: active,
			fromStart: active.volume,
			fromEnd: 0,
			toAudio: inactive,
			toStart: 0,
			toEnd: nextVolume,
			durationMs: fadeMs,
			onComplete: () => {
				active.pause();
				active.currentTime = 0;
			},
		});
		activeChannelRef.current = activeIndex === 0 ? 1 : 0;
	}, [channelA, channelB, getTopRequest, runFade]);

	const setRequest = useCallback(
		(request: Omit<BackgroundMusicRequest, "updatedAt">) => {
			requestsRef.current.set(request.id, {
				...request,
				updatedAt: Date.now(),
			});
			applyTopRequest();
		},
		[applyTopRequest],
	);

	const clearRequest = useCallback(
		(id: string) => {
			if (!requestsRef.current.delete(id)) {
				return;
			}
			applyTopRequest();
		},
		[applyTopRequest],
	);

	useEffect(
		() => () => {
			stopFade();
			channelA.pause();
			channelA.src = "";
			channelB.pause();
			channelB.src = "";
		},
		[channelA, channelB, stopFade],
	);

	const value = useMemo<BackgroundMusicContextValue>(
		() => ({
			setRequest,
			clearRequest,
		}),
		[clearRequest, setRequest],
	);

	return (
		<BackgroundMusicContext.Provider value={value}>
			{children}
		</BackgroundMusicContext.Provider>
	);
}

export function useBackgroundMusic(
	track: BackgroundMusicTrack | null,
	options?: { enabled?: boolean; priority?: number; fadeMs?: number },
) {
	const context = useContext(BackgroundMusicContext);
	const requestIdRef = useRef(`bgm-${Math.random().toString(36).slice(2, 10)}`);
	const enabled = options?.enabled ?? true;
	const priority = options?.priority ?? 0;

	useEffect(() => {
		if (!context) {
			return;
		}
		if (!enabled || !track) {
			context.clearRequest(requestIdRef.current);
			return;
		}
		context.setRequest({
			id: requestIdRef.current,
			track,
			priority,
			fadeMs: options?.fadeMs,
		});
		return () => {
			context.clearRequest(requestIdRef.current);
		};
	}, [context, enabled, options?.fadeMs, priority, track]);
}
