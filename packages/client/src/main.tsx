import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { BackgroundMusicProvider } from "./audio/BackgroundMusicContext";
import "./index.css";

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<BackgroundMusicProvider>
			<App />
		</BackgroundMusicProvider>
	</StrictMode>,
);
