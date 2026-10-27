import { MongoClient } from "mongodb";
import type { ClientSession, Db } from "mongodb";
import type { Workspace, Equipment, Booking, Activity } from "../lib/domain.ts";

export type WorkspaceDoc = Workspace & {
  _id: string;
  join_code: string;
  revision?: number;
};
export type MemberDoc = {
  _id: string;
  workspace_id: string;
  user_id: string;
  name: string;
  joined_at: number;
};
export type EquipmentDoc = Equipment & { _id: string; revision: number };
export type BookingDoc = Booking & {
  _id: string;
  revision: number;
  fee_paise: number;
  payment_status: "unpaid" | "paid";
  payment_order_id?: string;
  payment_id?: string;
  paid_at?: number;
  order_claim?: string;
  order_claimed_at?: number;
};
export type AuditDoc = Activity & {
  _id: string;
  workspace_id: string;
  actor_id: string;
  resource_id: string;
};
export type UserDoc = {
  _id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: number;
};
export type SessionDoc = { _id: string; user_id: string; expires_at: Date };
export type WebhookDoc = { _id: string; payment_id: string; received_at: Date };

export function createStore(client: MongoClient, name: string) {
  const db = client.db(name);
  return {
    client,
    db,
    workspaces: db.collection<WorkspaceDoc>("workspaces"),
    members: db.collection<MemberDoc>("members"),
    equipment: db.collection<EquipmentDoc>("equipment"),
    bookings: db.collection<BookingDoc>("bookings"),
    audit: db.collection<AuditDoc>("audit"),
    users: db.collection<UserDoc>("users"),
    sessions: db.collection<SessionDoc>("sessions"),
    webhooks: db.collection<WebhookDoc>("webhooks"),
  };
}
export type Store = ReturnType<typeof createStore>;

export async function initializeDatabase(store: Store) {
  const hello = await store.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid")
    throw new Error(
      "MongoDB must be an Atlas cluster or replica set; transactions are required.",
    );
  await Promise.all([
    store.workspaces.createIndex({ join_code: 1 }, { unique: true }),
    store.members.createIndex(
      { workspace_id: 1, user_id: 1 },
      { unique: true },
    ),
    store.members.createIndex({ user_id: 1 }),
    store.equipment.createIndex(
      { workspace_id: 1, asset_tag: 1 },
      { unique: true },
    ),
    store.bookings.createIndex({
      equipment_id: 1,
      status: 1,
      starts_at: 1,
      ends_at: 1,
    }),
    store.bookings.createIndex({ workspace_id: 1, created_at: -1 }),
    store.bookings.createIndex(
      { payment_order_id: 1 },
      {
        unique: true,
        partialFilterExpression: { payment_order_id: { $type: "string" } },
      },
    ),
    store.bookings.createIndex(
      { payment_id: 1 },
      {
        unique: true,
        partialFilterExpression: { payment_id: { $type: "string" } },
      },
    ),
    store.audit.createIndex({ workspace_id: 1, created_at: -1 }),
    store.users.createIndex({ email: 1 }, { unique: true }),
    store.sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    store.webhooks.createIndex(
      { received_at: 1 },
      { expireAfterSeconds: 90 * 86400 },
    ),
  ]);
}

export async function transaction<T>(
  store: Store,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = store.client.startSession();
  try {
    return await session.withTransaction(() => fn(session), {
      readConcern: { level: "snapshot" },
      writeConcern: { w: "majority" },
      maxCommitTimeMS: 10000,
    });
  } finally {
    await session.endSession();
  }
}
export function duplicate(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === 11000
  );
}
export function publicRecord<T extends { _id: string }>(record: T) {
  const { _id, ...value } = record;
  return value;
}
