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
