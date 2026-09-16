import { handleAgentRequest } from "../lib/agent.js";

// Vercel serverless wrapper: production /api/agent requests are intentionally
// forwarded to the same lib/agent.js logic used by the local Express server.
import { handleAgentRequest } from "../lib/agent.js";

export default async function handler(req, res) {
  return handleAgentRequest(req, res);
}
