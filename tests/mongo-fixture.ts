import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { createStore, initializeDatabase } from "../server/database.ts";
let replica: MongoMemoryReplSet;
let client: MongoClient;
export async function startMongo() {
  replica = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    binary: { version: "8.0.12" },
  });
  client = await new MongoClient(replica.getUri()).connect();
}
export async function freshStore() {
  const store = createStore(
    client,
    `test_${crypto.randomUUID().replaceAll("-", "")}`,
  );
  await initializeDatabase(store);
  return store;
}
export async function stopMongo() {
  await client?.close();
  await replica?.stop();
}
