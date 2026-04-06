import { useState } from "react";
import { useRoomState } from "../colyseus/roomContext";
import { GameScene } from "../game/GameScene";

export function GameScreen() {
	const [areaLabel, setAreaLabel] = useState("Start Room");
	const [revealAll, setRevealAll] = useState(false);
	const mapSeed = useRoomState((s) => s.mapSeed);

	return (
		<div style={{ width: "100%", height: "100%", minHeight: "100vh" }}>
			<div
				style={{
					position: "fixed",
					top: 12,
					left: 12,
					zIndex: 2,
					padding: "0.35rem 0.6rem",
					borderRadius: 6,
					fontSize: "0.85rem",
					background: "rgba(10, 14, 22, 0.75)",
					border: "1px solid rgba(90, 120, 170, 0.35)",
				}}
			>
				<div>Seed: {mapSeed ?? 0}</div>
				<div>{areaLabel}</div>
				<button
					type="button"
					onClick={() => setRevealAll((current) => !current)}
					style={{
						marginTop: 6,
						padding: "0.18rem 0.45rem",
						fontSize: "0.78rem",
						borderRadius: 4,
						border: "1px solid rgba(120, 150, 200, 0.45)",
						background: revealAll ? "rgba(90, 130, 190, 0.3)" : "rgba(20, 28, 40, 0.75)",
						color: "#dfe7f2",
						cursor: "pointer",
					}}
				>
					Reveal
				</button>
			</div>
			<GameScene onAreaChange={setAreaLabel} revealAll={revealAll} />
		</div>
	);
}
