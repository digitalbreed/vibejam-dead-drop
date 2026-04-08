import { useEffect, useState } from "react";
import type { GameServerMessages } from "@vibejam/shared";
import { useRoom } from "../../colyseus/roomContext";

type TickerEvent = GameServerMessages["ticker_event"];

export type TickerState = {
	message: string;
	phase: "idle" | "fade-in" | "scrolling" | "fade-out";
};

const FADE_IN_DURATION_MS = 300;
const FADE_OUT_DURATION_MS = 300;
const BASE_SCROLL_DURATION_MS = 10000;
const PER_CHAR_SCROLL_DURATION_MS = 75;

function getTickerText(event: TickerEvent): string {
	if (event.event === "keycard_first_pickup") {
		return `SOMEONE FOUND THE ${event.color.toUpperCase()} KEYCARD`;
	}
	return "UNKNOWN EVENT";
}

function computeScrollDuration(message: string): number {
	return BASE_SCROLL_DURATION_MS + message.length * PER_CHAR_SCROLL_DURATION_MS;
}

export function useTickerState() {
	const { room } = useRoom();
	const [queue, setQueue] = useState<TickerEvent[]>([]);
	const [state, setState] = useState<TickerState>({ message: "", phase: "idle" });

	// Listen for ticker events
	useEffect(() => {
		if (!room) return;
		return room.onMessage<GameServerMessages["ticker_event"]>("ticker_event", (message) => {
			setQueue((q) => [...q, message]);
		});
	}, [room]);

	// Process queue
	useEffect(() => {
		if (state.phase !== "idle" || queue.length === 0) return;

		const next = queue[0];
		setQueue((q) => q.slice(1));
		setState({ message: getTickerText(next), phase: "fade-in" });
	}, [state.phase, queue]);

	// Handle phase transitions
	useEffect(() => {
		if (state.phase === "fade-in") {
			const timer = window.setTimeout(() => {
				setState((s) => ({ ...s, phase: "scrolling" }));
			}, FADE_IN_DURATION_MS);
			return () => window.clearTimeout(timer);
		}

		if (state.phase === "scrolling") {
			const timer = window.setTimeout(() => {
				setState((s) => ({ ...s, phase: "fade-out" }));
			}, computeScrollDuration(state.message));
			return () => window.clearTimeout(timer);
		}

		if (state.phase === "fade-out") {
			const timer = window.setTimeout(() => {
				setState({ message: "", phase: "idle" });
			}, FADE_OUT_DURATION_MS);
			return () => window.clearTimeout(timer);
		}
	}, [state.phase, state.message]);

	const isVisible = state.phase !== "idle";
	const scrollDurationMs = computeScrollDuration(state.message);

	return { ...state, isVisible, scrollDurationMs };
}
