import { handleChatsRequest } from "../lib/chats.js";

export default async function handler(req, res) {
  return handleChatsRequest(req, res);
}
