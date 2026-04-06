type TitleScreenProps = {
	onJoin: () => void;
};

export function TitleScreen({ onJoin }: TitleScreenProps) {
	return (
		<div
			style={{
				minHeight: "100%",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				justifyContent: "center",
				gap: "1.5rem",
				padding: "2rem",
				textAlign: "center",
			}}
		>
			<h1 style={{ margin: 0, fontSize: "2rem", letterSpacing: "0.04em" }}>Dead Drop</h1>
			<p style={{ margin: 0, opacity: 0.85, maxWidth: "28rem", lineHeight: 1.5 }}>
				Join matchmaking, fill the lobby, then drop into the arena with other players.
			</p>
			<button
				type="button"
				onClick={onJoin}
				style={{
					padding: "0.75rem 1.5rem",
					borderRadius: "8px",
					border: "1px solid #3d5a80",
					background: "linear-gradient(180deg, #2a4a6f 0%, #1e3a57 100%)",
					color: "#e8eef5",
				}}
			>
				Join random game
			</button>
		</div>
	);
}
