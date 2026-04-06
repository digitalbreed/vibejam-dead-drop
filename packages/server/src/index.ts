/**
 * Self-hosted Colyseus entry. See https://docs.colyseus.io/server
 */
import { listen } from "@colyseus/tools";
import app from "./app.config.js";

listen(app);
