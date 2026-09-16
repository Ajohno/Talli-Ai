import "dotenv/config";

/*
 * PHASE 1 LEARNING GUIDE — APPLICATION ENTRYPOINT
 *
 * This file is the local-development shell around the same backend handlers
 * used in production. The important architecture is:
 *
 *   Browser (public/) -> /api/* route -> lib/* handler -> services / MongoDB
 *
 * Express is mostly wiring here; the real application behavior lives in lib/.
 * Vercel does not need this Express server because the small files in /api
 * call those same lib/ handlers as serverless functions.
 *
 * Phase 1B takeaway: the frontend can be replaced without rewriting the
 * Phase 1 backend as long as the new UI keeps the existing API contracts.
 */
import "dotenv/config";

// Local development entrypoint. Vercel uses the files in /api directly,
// but the Express server lets the project run as a single Node app locally.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleAgentRequest } from "./lib/agent.js";
import { authRateLimitMiddleware, handleAuthRequest } from "./lib/auth.js";
import { handleChatsRequest } from "./lib/chats.js";
import rateLimit from "express-rate-limit";

// The local server serves the static frontend and forwards API traffic to
// the same request handlers used by the deployed API routes.
const app = express();
const port = process.env.PORT || 3000;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

app.use(express.json());
app.use(express.static("public"));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// AI messages enter here locally. The handler owns model calls, tool calls,
// memory retrieval, summarization, and persistence of the completed reply.
app.all("/api/agent", (req, res) => {
  return handleAgentRequest(req, res);
});

app.all("/api/auth", authLimiter, authRateLimitMiddleware, (req, res) => {
  return handleAuthRequest(req, res);
});

// Conversation-management requests enter here: list/create/archive/restore/
// clear/delete. Keeping these operations separate from /api/agent lets the UI
// manage threads without involving the AI model.
app.all("/api/chats", (req, res) => {
  return handleChatsRequest(req, res);
});

app.listen(port, () => {
  console.log(`Running: http://localhost:${port}`);
});

export default app;
