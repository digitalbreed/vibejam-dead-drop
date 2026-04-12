import type { GameTeam } from "@vibejam/shared";

type BriefingStage = "hidden" | "pre-enter" | "center" | "exit";

type BriefingCopy = {
	teamLabel: string;
	mission: string;
};

const BRIEFING_BY_TEAM: Record<GameTeam, BriefingCopy> = {
	shredders: {
		teamLabel: "SHREDDERS",
		mission:
			"Find the keycards, crack the vault, and drag the briefcase to the exit before Enforcers ask awkward questions.",
	},
	enforcers: {
		teamLabel: "ENFORCERS",
		mission:
			"Expose the Island Files. Hunt down every Shredder, secure the evidence, and force the scandal onto tomorrow's front page.",
	},
};

export function BriefingPanel({ stage, team }: { stage: BriefingStage; team: GameTeam | null }) {
	const briefingCopy = team ? BRIEFING_BY_TEAM[team] : null;
	if (stage === "hidden" || !briefingCopy) {
		return null;
	}
	const transform =
		stage === "pre-enter"
			? "translate(-50%, -50%) translateX(120vw)"
			: stage === "exit"
				? "translate(-50%, -50%) translateX(-132vw)"
				: "translate(-50%, -50%) translateX(0)";
	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				pointerEvents: "none",
				zIndex: 8,
				background:
					"radial-gradient(circle at center, rgba(5, 9, 16, 0.22) 0%, rgba(3, 6, 11, 0.56) 62%, rgba(2, 4, 8, 0.7) 100%)",
			}}
		>
			<div
				style={{
					position: "absolute",
					left: "50%",
					top: "50%",
					transform,
					transition: "transform 720ms cubic-bezier(0.2, 0.9, 0.2, 1)",
					width: "min(90vw, 820px)",
					padding: "2rem 2.2rem",
					border: "1px solid rgba(192, 221, 255, 0.3)",
					background:
						"linear-gradient(160deg, rgba(6, 12, 18, 0.95) 0%, rgba(10, 18, 26, 0.95) 62%, rgba(16, 24, 34, 0.94) 100%)",
					boxShadow: "0 22px 70px rgba(0, 0, 0, 0.62)",
					textAlign: "center",
					letterSpacing: "0.02em",
				}}
			>
				<div
					style={{
						fontFamily: "'Bebas Neue', Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif",
						fontSize: "clamp(2.2rem, 8vw, 4.6rem)",
						lineHeight: 0.9,
						textTransform: "uppercase",
						textShadow: "0 0 24px rgba(160, 220, 255, 0.42)",
					}}
				>
					<div style={{ opacity: 0.8, fontSize: "0.5em", marginBottom: "0.45rem", letterSpacing: "0.22em" }}>
						Your Team
					</div>
					<div>{briefingCopy.teamLabel}</div>
				</div>
				<p
					style={{
						margin: "1.1rem auto 0",
						maxWidth: "40rem",
						fontSize: "clamp(1rem, 2.35vw, 1.32rem)",
						lineHeight: 1.45,
						opacity: 0.95,
					}}
				>
					{briefingCopy.mission}
				</p>
				<div style={{ marginTop: "1rem", opacity: 0.74, fontSize: "0.86rem", textTransform: "uppercase", letterSpacing: "0.11em" }}>
					Press any key or tap to continue
				</div>
			</div>
		</div>
	);
}
