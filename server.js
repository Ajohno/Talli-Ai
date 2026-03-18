import "dotenv/config";

// Local development entrypoint. Vercel uses the files in /api directly,
// but the Express server lets the project run as a single Node app locally.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleAgentRequest } from "./lib/agent.js";
import { handleAuthRequest } from "./lib/auth.js";
import { handleChatsRequest } from "./lib/chats.js";

// The local server serves the static frontend and forwards API traffic to
// the same request handlers used by the deployed API routes.
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("public"));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.all("/api/agent", (req, res) => {
  return handleAgentRequest(req, res);
});

app.all("/api/auth", (req, res) => {
  return handleAuthRequest(req, res);
});

app.all("/api/chats", (req, res) => {
  return handleChatsRequest(req, res);
});

app.listen(port, () => {
  console.log(`Running: http://localhost:${port}`);
});

export default app;
