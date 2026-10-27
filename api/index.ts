import type { IncomingMessage, ServerResponse } from "node:http";
import { MongoClient } from "mongodb";
import { createApp } from "../server/app.ts";
import { readConfig } from "../server/config.ts";
import { createStore, initializeDatabase } from "../server/database.ts";

// Reuse one pool per warm Vercel instance, including simultaneous cold requests.
let application: Promise<ReturnType<typeof createApp>> | undefined;
async function connect() {
  const config = readConfig();
  const client = new MongoClient(config.mongoUri, {
    maxPoolSize: 5,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 10000,
  });
  try {
    await client.connect();
    const store = createStore(client, config.mongoDb);
    await initializeDatabase(store);
    return createApp(store, config, { serveClient: false });
  } catch (error) {
    await client.close();
    throw error;
  }
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  try {
    application ??= connect().catch((error) => {
      application = undefined;
      throw error;
    });
    const app = await application;
    app(req, res);
  } catch (error) {
    const failure = error as {
      name?: string;
      code?: string | number;
      cause?: { code?: string | number };
    };
    console.error("API initialization failed", {
      name: failure.name,
      code: failure.code,
      causeCode: failure.cause?.code,
    });
    res.writeHead(503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({
        error: "Database connection unavailable. Please retry shortly.",
      }),
    );
  }
}
