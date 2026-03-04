import { handleAgentRequest } from "../lib/agent.js";

export default async function handler(req, res) {
  return handleAgentRequest(req, res);
}
