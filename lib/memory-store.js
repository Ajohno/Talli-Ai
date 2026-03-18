import { createHash, randomUUID } from "node:crypto";

// Long-term memory storage for cross-chat recall. This module keeps the memory
// data model separate from thread-specific chat history.
import { getDb } from "./mongodb.js";

const MAX_MEMORY_ITEMS = 8;
const MEMORY_CATEGORIES = new Set([
  "identity",
  "preference",
  "goal",
  "project",
  "relationship",
  "context",
]);
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "we",
  "with",
  "you",
  "your",
]);

function getMemoriesCollection(db) {
  return db.collection("memories");
}

// Memories are grouped into a small fixed set of categories so the agent can
// produce predictable memory labels and retrieval behavior.
function normalizeMemoryCategory(category) {
  if (typeof category !== "string") {
    return "context";
  }

  const normalizedCategory = category.trim().toLowerCase();
  return MEMORY_CATEGORIES.has(normalizedCategory) ? normalizedCategory : "context";
}

function normalizeMemoryContent(content) {
  if (typeof content !== "string") {
    return null;
  }

  const normalizedContent = content.replace(/\s+/g, " ").trim();
  return normalizedContent === "" ? null : normalizedContent;
}

function normalizeConfidence(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return 0.5;
  }

  return Math.min(1, Math.max(0, numericValue));
}

function buildMemoryKey(content) {
  return createHash("sha256").update(content.toLowerCase()).digest("hex");
}

function serializeMemory(memory) {
  const content = normalizeMemoryContent(memory?.content);

  if (!content) {
    return null;
  }

  return {
    memoryId:
      typeof memory.memoryId === "string" && memory.memoryId !== ""
        ? memory.memoryId
        : String(memory._id),
    sessionId: memory.sessionId,
    chatId: memory.chatId ?? null,
    key: typeof memory.key === "string" ? memory.key : buildMemoryKey(content),
    category: normalizeMemoryCategory(memory.category),
    content,
    confidence: normalizeConfidence(memory.confidence),
    createdAt: memory.createdAt ? new Date(memory.createdAt).toISOString() : null,
    updatedAt: memory.updatedAt ? new Date(memory.updatedAt).toISOString() : null,
    lastRetrievedAt: memory.lastRetrievedAt
      ? new Date(memory.lastRetrievedAt).toISOString()
      : null,
  };
}

export function normalizeCandidateMemories(input) {
  if (!Array.isArray(input)) {
    return [];
  }

  const deduped = new Map();

  for (const entry of input) {
    const content = normalizeMemoryContent(entry?.content ?? entry?.fact);

    if (!content) {
      continue;
    }

    const key = buildMemoryKey(content);
    const normalized = {
      key,
      category: normalizeMemoryCategory(entry?.category),
      content,
      confidence: normalizeConfidence(entry?.confidence),
    };

    const existing = deduped.get(key);

    if (!existing || normalized.confidence >= existing.confidence) {
      deduped.set(key, normalized);
    }
  }

  return [...deduped.values()].slice(0, MAX_MEMORY_ITEMS);
}

// Upserts memories by a hashed content key so repeated extractions reinforce
// the same memory instead of endlessly duplicating it.
export async function upsertMemories(sessionId, chatId, candidateMemories) {
  const db = await getDb();
  const memories = normalizeCandidateMemories(candidateMemories);

  if (memories.length === 0) {
    return [];
  }

  const collection = getMemoriesCollection(db);
  const now = new Date();

  await Promise.all(
    memories.map((memory) =>
      collection.updateOne(
        { sessionId, key: memory.key },
        {
          $set: {
            chatId,
            category: memory.category,
            content: memory.content,
            confidence: memory.confidence,
            updatedAt: now,
          },
          $setOnInsert: {
            sessionId,
            memoryId: randomUUID(),
            key: memory.key,
            createdAt: now,
          },
        },
        { upsert: true }
      )
    )
  );

  const stored = await collection
    .find({ sessionId, key: { $in: memories.map((memory) => memory.key) } })
    .sort({ confidence: -1, updatedAt: -1 })
    .toArray();

  return stored.map(serializeMemory).filter(Boolean);
}

export async function listMemories(sessionId, limit = MAX_MEMORY_ITEMS) {
  const db = await getDb();
  const memories = await getMemoriesCollection(db)
    .find({ sessionId })
    .sort({ confidence: -1, updatedAt: -1 })
    .limit(limit)
    .toArray();

  return memories.map(serializeMemory).filter(Boolean);
}

function tokenize(text) {
  if (typeof text !== "string") {
    return [];
  }

  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

// Retrieval is intentionally simple for now: keyword overlap + confidence +
// a small recency bonus. This can later be replaced by embeddings/vector search.
function scoreMemory(memory, contextTokens) {
  const memoryTokens = tokenize(memory.content);
  const overlap = memoryTokens.filter((token) => contextTokens.has(token)).length;
  const overlapScore = overlap * 3;
  const confidenceScore = normalizeConfidence(memory.confidence) * 2;
  const recencyScore = memory.updatedAt ? 1 : 0;

  return overlapScore + confidenceScore + recencyScore;
}

export async function findRelevantMemories(sessionId, contextText, limit = 4) {
  const memories = await listMemories(sessionId, 50);

  if (memories.length === 0) {
    return [];
  }

  const contextTokens = new Set(tokenize(contextText));
  const rankedMemories = memories
    .map((memory) => ({
      ...memory,
      relevanceScore: scoreMemory(memory, contextTokens),
    }))
    .filter((memory) => memory.relevanceScore > 0 || memory.confidence >= 0.8)
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, limit);

  return rankedMemories;
}

export async function touchMemories(sessionId, memoryIds) {
  if (!Array.isArray(memoryIds) || memoryIds.length === 0) {
    return;
  }

  const db = await getDb();
  await getMemoriesCollection(db).updateMany(
    { sessionId, memoryId: { $in: memoryIds } },
    { $set: { lastRetrievedAt: new Date() } }
  );
}
