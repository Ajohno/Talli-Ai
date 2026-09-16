import { enforceAuthRateLimit, handleAuthRequest } from "../lib/auth.js";

// Vercel serverless wrapper for authentication. Rate limiting runs before the
// shared lib/auth.js handler so local and deployed auth behavior stay aligned.

export default async function handler(req, res) {
  if (enforceAuthRateLimit(req, res)) {
    return;
  }

  return handleAuthRequest(req, res);
}
