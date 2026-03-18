import { handleAuthRequest } from "../lib/auth.js";

export default async function handler(req, res) {
  return handleAuthRequest(req, res);
}
