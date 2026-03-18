import { enforceAuthRateLimit, handleAuthRequest } from "../lib/auth.js";

export default async function handler(req, res) {
  if (enforceAuthRateLimit(req, res)) {
    return;
  }

  return handleAuthRequest(req, res);
}
