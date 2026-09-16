import { handleChatsRequest } from "../lib/chats.js";

// Vercel serverless wrapper: conversation CRUD delegates to lib/chats.js,
// keeping the deployed route thin and the business logic reusable locally.


export default async function handler(req, res) {
  return handleChatsRequest(req, res);
}
