import { MongoClient } from "mongodb";

/*
 * PHASE 1 LEARNING GUIDE — DATABASE CONNECTION
 *
 * MongoDB is the persistent source of truth for Phase 1 chats and memories.
 * The browser does NOT connect to MongoDB directly; only backend modules call
 * getDb(). This is an important security and architecture boundary.
 *
 * globalThis._mongoClientPromise reuses one connection promise across hot
 * server/serverless executions instead of opening a new MongoDB connection for
 * every request.
 *
 * Naming note: many storage functions call the owner key "sessionId". In guest
 * mode it really is the browser session id; after Google sign-in it becomes an
 * account-scoped value such as "google:<Google subject id>".
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB_NAME || "talli";

if (!uri) {
  throw new Error("Missing MONGODB_URI environment variable.");
}

let clientPromise;
let indexesReadyPromise;

if (!globalThis._mongoClientPromise) {
  const client = new MongoClient(uri);
  globalThis._mongoClientPromise = client.connect();
}

clientPromise = globalThis._mongoClientPromise;

// These indexes enforce the ownership/data rules at the database layer:
// one chat id per owner, one normalized memory key per owner, and efficient
// sorting/filtering for chat and memory retrieval.
async function ensureIndexes(db) {
  await db.collection("chats").createIndex(
    { sessionId: 1, chatId: 1 },
    { unique: true }
  );
  await db.collection("chats").createIndex({ sessionId: 1, archived: 1, updatedAt: -1 });
  await db.collection("memories").createIndex(
    { sessionId: 1, key: 1 },
    { unique: true }
  );
  await db.collection("memories").createIndex({ sessionId: 1, updatedAt: -1 });
}

export async function getDb() {
  const client = await clientPromise;
  const db = client.db(dbName);

  if (!indexesReadyPromise) {
    indexesReadyPromise = ensureIndexes(db);
  }

  await indexesReadyPromise;
  return db;
}
