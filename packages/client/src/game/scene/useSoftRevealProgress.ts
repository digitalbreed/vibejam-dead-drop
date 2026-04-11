import { useEffect, useState } from "react";

export function useSoftRevealProgress({
	active,
	totalCount,
	startDelayMs,
	stepMs,
}: {
	active: boolean;
	totalCount: number;
	startDelayMs: number;
	stepMs: number;
}): number {
	const [count, setCount] = useState(0);

	useEffect(() => {
		if (!active) {
			setCount(0);
			return;
		}
		setCount(0);
		let cancelled = false;
		let timerId: number | null = null;

		const scheduleNextStep = () => {
			if (cancelled) {
				return;
			}
			timerId = window.setTimeout(() => {
				if (cancelled) {
					return;
				}
				setCount((current) => {
					const next = Math.min(totalCount, current + 1);
					if (next < totalCount) {
						scheduleNextStep();
					}
					return next;
				});
			}, stepMs);
		};

		timerId = window.setTimeout(() => {
			if (cancelled || totalCount === 0) {
				return;
			}
			scheduleNextStep();
		}, startDelayMs);

		return () => {
			cancelled = true;
			if (timerId !== null) {
				window.clearTimeout(timerId);
			}
		};
	}, [active, startDelayMs, stepMs, totalCount]);

	return count;
}
