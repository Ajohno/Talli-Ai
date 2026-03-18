import { randomUUID } from "node:crypto";
import { getDb } from "./mongodb.js";

export const DEFAULT_CHAT_TITLE = "New chat";
export const DEFAULT_CONVERSATION = [
  {
    role: "assistant",
    content:
      "Hi! I'm Talli. Let me know if I can be of any assistance. I will help as best I can!",
  },
];

const MAX_CHAT_MESSAGES = 24;
export const MIN_SUMMARY_MESSAGES = 6;

function getChatsCollection(db) {
  return db.collection("chats");
}

export function normalizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0) {
    return null;
  }

  const messages = input
    .filter((message) => {
      return (
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim() !== ""
      );
    })
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }));

  return messages.length > 0 ? messages : null;
}

export function normalizeSessionId(input) {
  if (typeof input !== "string") {
    return null;
  }

  const sessionId = input.trim();
  return sessionId !== "" ? sessionId : null;
}

export function normalizeChatId(input) {
  if (typeof input !== "string") {
    return null;
  }

  const chatId = input.trim();
  return chatId !== "" ? chatId : null;
}

export function getDefaultConversation() {
  return DEFAULT_CONVERSATION.map((message) => ({ ...message }));
}

function buildPreview(conversation) {
  const sanitizedConversation = normalizeMessages(conversation) ?? [];

  if (
    sanitizedConversation.length <= 1 &&
    sanitizedConversation[0]?.content === DEFAULT_CONVERSATION[0].content
  ) {
    return "Ready when you are.";
  }

  const lastMessage = sanitizedConversation[sanitizedConversation.length - 1];
  const preview = lastMessage?.content?.replace(/\s+/g, " ").trim() ?? "";

  if (!preview) {
    return "Ready when you are.";
  }

  return preview.length > 72 ? `${preview.slice(0, 69)}...` : preview;
}

function buildTitleFromConversation(conversation) {
  const firstUserMessage = (normalizeMessages(conversation) ?? []).find(
    (message) => message.role === "user"
  );
  const titleSource = firstUserMessage?.content?.replace(/\s+/g, " ").trim() ?? "";

  if (!titleSource) {
    return DEFAULT_CHAT_TITLE;
  }

  return titleSource.length > 48 ? `${titleSource.slice(0, 45)}...` : titleSource;
}

function trimConversation(conversation) {
  const sanitizedConversation = normalizeMessages(conversation) ?? getDefaultConversation();

  if (sanitizedConversation.length <= MAX_CHAT_MESSAGES) {
    return sanitizedConversation;
  }

  const firstMessage = sanitizedConversation[0];
  const remainingMessages = sanitizedConversation.slice(-(MAX_CHAT_MESSAGES - 1));

  if (
    firstMessage &&
    firstMessage.role === "assistant" &&
    firstMessage.content === DEFAULT_CONVERSATION[0].content
  ) {
    return [firstMessage, ...remainingMessages];
  }

  return sanitizedConversation.slice(-MAX_CHAT_MESSAGES);
}

function serializeChat(chat) {
  const conversation = normalizeMessages(chat?.conversation) ?? getDefaultConversation();
  const title =
    typeof chat?.title === "string" && chat.title.trim() !== ""
      ? chat.title.trim()
      : buildTitleFromConversation(conversation);

  return {
    chatId: chat.chatId,
    sessionId: chat.sessionId,
    title,
    archived: Boolean(chat.archived),
    conversation,
    summary:
      typeof chat?.summary === "string" && chat.summary.trim() !== ""
        ? chat.summary.trim()
        : null,
    summaryUpdatedAt: chat.summaryUpdatedAt
      ? new Date(chat.summaryUpdatedAt).toISOString()
      : null,
    summaryMessageCount:
      Number.isInteger(chat?.summaryMessageCount) && chat.summaryMessageCount >= 0
        ? chat.summaryMessageCount
        : 0,
    preview: buildPreview(conversation),
    createdAt: chat.createdAt ? new Date(chat.createdAt).toISOString() : null,
    updatedAt: chat.updatedAt ? new Date(chat.updatedAt).toISOString() : null,
  };
}

async function migrateLegacySession(sessionId) {
  const db = await getDb();
  const legacySession = await db.collection("sessions").findOne({ sessionId });

  if (!legacySession) {
    return null;
  }

  const conversation = normalizeMessages(legacySession.conversation) ?? getDefaultConversation();
  const createdAt = legacySession.createdAt ?? legacySession.updatedAt ?? new Date();
  const updatedAt = legacySession.updatedAt ?? createdAt;
  const chat = {
    sessionId,
    chatId: randomUUID(),
    title: buildTitleFromConversation(conversation),
    archived: false,
    conversation: trimConversation(conversation),
    summary: null,
    summaryUpdatedAt: null,
    summaryMessageCount: 0,
    createdAt,
    updatedAt,
  };

  await getChatsCollection(db).insertOne(chat);
  return serializeChat(chat);
}

export async function listChats(sessionId) {
  const db = await getDb();
  let chats = await getChatsCollection(db)
    .find({ sessionId })
    .sort({ updatedAt: -1, createdAt: -1 })
    .toArray();

  if (chats.length === 0) {
    const migratedChat = await migrateLegacySession(sessionId);

    if (migratedChat) {
      return [migratedChat];
    }

    return [];
  }

  return chats.map(serializeChat);
}

export async function createChat(sessionId) {
  const db = await getDb();
  const now = new Date();
  const chat = {
    sessionId,
    chatId: randomUUID(),
    title: DEFAULT_CHAT_TITLE,
    archived: false,
    conversation: getDefaultConversation(),
    summary: null,
    summaryUpdatedAt: null,
    summaryMessageCount: 0,
    createdAt: now,
    updatedAt: now,
  };

  await getChatsCollection(db).insertOne(chat);
  return serializeChat(chat);
}

export async function getChat(sessionId, chatId) {
  const db = await getDb();
  const chat = await getChatsCollection(db).findOne({ sessionId, chatId });
  return chat ? serializeChat(chat) : null;
}

export async function saveChatConversation(sessionId, chatId, conversation) {
  const db = await getDb();
  const existingChat = await getChatsCollection(db).findOne({ sessionId, chatId });

  if (!existingChat) {
    return null;
  }

  const trimmedConversation = trimConversation(conversation);
  const now = new Date();
  const title =
    existingChat.title && existingChat.title !== DEFAULT_CHAT_TITLE
      ? existingChat.title
      : buildTitleFromConversation(trimmedConversation);

  await getChatsCollection(db).updateOne(
    { sessionId, chatId },
    {
      $set: {
        title,
        conversation: trimmedConversation,
        updatedAt: now,
      },
    }
  );

  return getChat(sessionId, chatId);
}

export async function saveChatSummary(sessionId, chatId, summary, summaryMessageCount = null) {
  const db = await getDb();
  const normalizedSummary =
    typeof summary === "string" && summary.trim() !== "" ? summary.trim() : null;
  const normalizedSummaryMessageCount =
    Number.isInteger(summaryMessageCount) && summaryMessageCount >= 0
      ? summaryMessageCount
      : 0;
  const result = await getChatsCollection(db).updateOne(
    { sessionId, chatId },
    {
      $set: {
        summary: normalizedSummary,
        summaryUpdatedAt: normalizedSummary ? new Date() : null,
        summaryMessageCount: normalizedSummary ? normalizedSummaryMessageCount : 0,
      },
    }
  );

  if (result.matchedCount === 0) {
    return null;
  }

  return getChat(sessionId, chatId);
}

export async function setChatArchived(sessionId, chatId, archived) {
  const db = await getDb();
  const result = await getChatsCollection(db).updateOne(
    { sessionId, chatId },
    {
      $set: {
        archived,
        updatedAt: new Date(),
      },
    }
  );

  if (result.matchedCount === 0) {
    return null;
  }

  return getChat(sessionId, chatId);
}

export async function clearChat(sessionId, chatId) {
  const db = await getDb();
  const result = await getChatsCollection(db).updateOne(
    { sessionId, chatId },
    {
      $set: {
        title: DEFAULT_CHAT_TITLE,
        conversation: getDefaultConversation(),
        summary: null,
        summaryUpdatedAt: null,
        summaryMessageCount: 0,
        updatedAt: new Date(),
      },
    }
  );

  if (result.matchedCount === 0) {
    return null;
  }

  return getChat(sessionId, chatId);
}

export async function deleteChat(sessionId, chatId) {
  const db = await getDb();
  const result = await getChatsCollection(db).deleteOne({ sessionId, chatId });
  return result.deletedCount > 0;
}
