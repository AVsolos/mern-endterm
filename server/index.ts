import { MongoClient } from "mongodb";
import { readConfig } from "./config.ts";
import { createStore, initializeDatabase } from "./database.ts";
import { createApp } from "./app.ts";

async function main() {
  const config = readConfig();
  const client = new MongoClient(config.mongoUri, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 10,
  });
  try {
    await client.connect();
    await initializeDatabase(createStore(client, config.mongoDb));
  } catch (e) {
    await client.close();
    console.error(
      "MongoDB connection failed. Check Atlas credentials, network access, and replica-set availability.",
      { code: (e as { code?: number }).code },
    );
    process.exitCode = 1;
    return;
  }
  const app = createApp(createStore(client, config.mongoDb), config);
  const server = app.listen(
    config.port,
    config.production ? "0.0.0.0" : "127.0.0.1",
    () =>
      console.log(
        `BorrowLab Express API listening on port ${config.port}; MongoDB connected; Razorpay TEST mode.`,
      ),
  );
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    server.close(() => {
      void client.close().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Unable to start BorrowLab.");
  process.exitCode = 1;
});
