import {
  clearChat,
  createChat,
  deleteChat,
  listChats,
  normalizeChatId,
  normalizeSessionId,
  setChatArchived,
} from "./chat-store.js";
import { resolveOwnerId } from "./auth.js";

async function parseRequestBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }

  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function getQuerySessionId(req) {
  if (typeof req.query?.sessionId === "string") {
    return req.query.sessionId;
  }

  if (typeof req.url === "string") {
    const url = new URL(req.url, "http://localhost");
    return url.searchParams.get("sessionId");
  }

  return null;
}

export async function handleChatsRequest(req, res) {
  try {
    if (req.method === "GET") {
      const ownerId = resolveOwnerId(req, normalizeSessionId(getQuerySessionId(req)));

      if (!ownerId) {
        return res.status(400).json({ error: "Missing sessionId." });
      }

      let chats = await listChats(ownerId);

      if (chats.length === 0) {
        const chat = await createChat(ownerId);
        chats = [chat];
      }

      return res.status(200).json({ chats });
    }

    const body = await parseRequestBody(req);
    const ownerId = resolveOwnerId(req, normalizeSessionId(body?.sessionId));

    if (!ownerId) {
      return res.status(400).json({ error: "Missing sessionId." });
    }

    if (req.method === "POST") {
      const chat = await createChat(ownerId);
      const chats = await listChats(ownerId);
      return res.status(200).json({ chat, chats });
    }

    if (req.method === "PATCH") {
      const chatId = normalizeChatId(body?.chatId);
      const action = typeof body?.action === "string" ? body.action : null;

      if (!chatId) {
        return res.status(400).json({ error: "Missing chatId." });
      }

      let chat = null;

      if (action === "archive") {
        chat = await setChatArchived(ownerId, chatId, true);
      } else if (action === "restore") {
        chat = await setChatArchived(ownerId, chatId, false);
      } else if (action === "clear") {
        chat = await clearChat(ownerId, chatId);
      } else {
        return res.status(400).json({ error: "Unsupported action." });
      }

      if (!chat) {
        return res.status(404).json({ error: "Chat not found." });
      }

      const chats = await listChats(ownerId);
      return res.status(200).json({ chat, chats });
    }

    if (req.method === "DELETE") {
      const chatId = normalizeChatId(body?.chatId);

      if (!chatId) {
        return res.status(400).json({ error: "Missing chatId." });
      }

      const deleted = await deleteChat(ownerId, chatId);

      if (!deleted) {
        return res.status(404).json({ error: "Chat not found." });
      }

      const chats = await listChats(ownerId);
      return res.status(200).json({ deletedChatId: chatId, chats });
    }

    return res.status(405).json({ error: "Method not allowed." });
  } catch (error) {
    console.error("Chat error:", error);
    return res.status(500).json({ error: "Server error." });
  }
}
