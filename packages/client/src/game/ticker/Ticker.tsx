import { useTickerState } from "./useTickerState";
import { useTickerAudio } from "./useTickerAudio";

export function Ticker() {
	const { message, phase, isVisible, scrollDurationMs } = useTickerState();
	useTickerAudio(isVisible);

	const formattedMessage = `+++ ${message} +++`;

	const opacity = phase === "fade-in" ? 1 : phase === "scrolling" ? 1 : 0;
	const scrollDurationSec = scrollDurationMs / 1000;
	const bandHeight = 48;
	const dottedInset = 2;
	const dottedPitch = 8;

	if (!isVisible) return null;

	return (
		<div
			style={{
				position: "fixed",
				bottom: 40,
				left: 0,
				right: 0,
				height: bandHeight,
				overflow: "hidden",
				zIndex: 6,
				opacity,
				transition: phase === "fade-in" || phase === "fade-out" ? "opacity 300ms ease-in-out" : "none",
				boxShadow: "0 -4px 12px rgba(0, 0, 0, 0.3)",
				pointerEvents: "none",
				background: "linear-gradient(180deg, #f5f0e1 0%, #e8e0d0 100%)",
				borderTop: "2px solid #8b7355",
				borderBottom: "2px solid #6b5344",
			}}
		>
			<div
				style={{
					position: "absolute",
					zIndex: 1,
					left: "100vw",
					top: 0,
					bottom: 0,
					display: "flex",
					alignItems: "center",
					whiteSpace: "nowrap",
					animation: phase === "scrolling" ? `ticker-scroll ${scrollDurationSec}s linear forwards` : "none",
				}}
			>
				<div
					style={{
						whiteSpace: "nowrap",
						fontFamily: "'Courier New', Courier, monospace",
						fontSize: "1.2rem",
						fontWeight: "bold",
						textTransform: "uppercase",
						color: "#1a1a1a",
						letterSpacing: "0.05em",
						lineHeight: 1,
					}}
				>
					{formattedMessage}
				</div>
			</div>
			<div
				aria-hidden="true"
				style={{
					position: "absolute",
					zIndex: 2,
					left: -dottedPitch,
					top: dottedInset,
					width: `calc(100% + ${dottedPitch * 2}px)`,
					borderTop: "2px dashed rgba(86, 67, 50, 0.7)",
				}}
			/>
			<div
				aria-hidden="true"
				style={{
					position: "absolute",
					zIndex: 2,
					left: -dottedPitch,
					bottom: dottedInset,
					width: `calc(100% + ${dottedPitch * 2}px)`,
					borderBottom: "2px dashed rgba(86, 67, 50, 0.7)",
				}}
			/>
		</div>
	);
}
