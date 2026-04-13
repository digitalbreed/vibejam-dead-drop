import { playUiClickSound } from "../../audio/playUiClickSound";
import { usePortal } from "../../portal/PortalContext";

export function PortalLinks({
	usernameOverride,
	colorOverride,
	marginTop = "0.9rem",
}: {
	usernameOverride?: string;
	colorOverride?: string;
	marginTop?: string;
}) {
	const { hasLastGameRef, sendBackToLastGame, sendToNextGame } = usePortal();
	return (
		<div
			style={{
				marginTop,
				display: "flex",
				justifyContent: "center",
				gap: "0.8rem",
				flexWrap: "wrap",
			}}
		>
			<button
				type="button"
				style={{
					padding: 0,
					border: 0,
					background: "transparent",
					fontSize: "0.88rem",
					textDecoration: "underline",
					textUnderlineOffset: "0.16em",
					color: "#8ab4d8",
					cursor: "pointer",
				}}
				onClick={() => {
					playUiClickSound();
					sendToNextGame({ username: usernameOverride, color: colorOverride });
				}}
			>
				Send me to next Vibe Jam game
			</button>
			<button
				type="button"
				disabled={!hasLastGameRef}
				onClick={
					hasLastGameRef
						? () => {
							playUiClickSound();
							sendBackToLastGame({ username: usernameOverride, color: colorOverride });
						}
						: undefined
				}
				style={{
					padding: 0,
					border: 0,
					background: "transparent",
					fontSize: "0.88rem",
					textDecoration: "underline",
					textUnderlineOffset: "0.16em",
					color: "#8ab4d8",
					opacity: hasLastGameRef ? 1 : 0.5,
					cursor: hasLastGameRef ? "pointer" : "not-allowed",
					pointerEvents: hasLastGameRef ? "auto" : "none",
				}}
			>
				Back to last game
			</button>
		</div>
	);
}

