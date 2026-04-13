import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { BackgroundMusicProvider } from "./audio/BackgroundMusicContext";
import { PortalProvider } from "./portal/PortalContext";
import "./index.css";

if (import.meta.env.PROD && typeof document !== "undefined") {
	const existing = document.querySelector('script[data-vibejam-widget="2026"]');
	if (!existing) {
		const script = document.createElement("script");
		script.async = true;
		script.src = "https://vibej.am/2026/widget.js";
		script.setAttribute("data-vibejam-widget", "2026");
		document.head.appendChild(script);
	}
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<PortalProvider>
			<BackgroundMusicProvider>
				<App />
			</BackgroundMusicProvider>
		</PortalProvider>
	</StrictMode>,
);
