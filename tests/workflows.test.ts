import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createService } from "../lib/service.ts";
import type { Database, Statement } from "../lib/service.ts";
import { AppError, interval, overlaps } from "../lib/domain.ts";

const now = Date.UTC(2026, 9, 27, 12),
  minute = 60000;
const owner = { userId: "manager", displayName: "Lab manager" };
const member = { userId: "borrower", displayName: "Aditi" };
const outsider = { userId: "outsider", displayName: "Other user" };
const id = () => crypto.randomUUID();
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(new URL("../drizzle", import.meta.url))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(
      readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"),
    );
  class Query implements Statement {
    sql: string;
    values: unknown[] = [];
    constructor(sql: string) {
      this.sql = sql;
    }
    bind(...values: unknown[]) {
      this.values = values;
      return this;
    }
    async first<T>() {
      return (sqlite.prepare(this.sql).get(...(this.values as never[])) ??
        null) as T | null;
    }
    async all<T>() {
      return {
        results: sqlite
          .prepare(this.sql)
          .all(...(this.values as never[])) as T[],
      };
    }
    run() {
      return sqlite.prepare(this.sql).run(...(this.values as never[]));
    }
  }
  const db: Database = {
    prepare(sql) {
      return new Query(sql);
    },
    async batch(queries) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const result = queries.map((q) => (q as Query).run());
        sqlite.exec("COMMIT");
        return result;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db, sqlite };
}
async function setup() {
  const { db, sqlite } = database();
  const manager = createService(db, owner, now);
  const workspaceId = id();
  await manager.createWorkspace({
    id: workspaceId,
    name: "Campus media lab",
    sample: true,
  });
  const initial = await manager.snapshot(workspaceId);
  const borrower = createService(db, member, now);
  await borrower.joinWorkspace({ code: initial.workspace.join_code });
  const equipmentId = initial.equipment[0].id;
  const booking = (more = {}) => ({
    workspaceId,
    equipmentId,
    id: id(),
    startsAt: now + 10 * minute,
    endsAt: now + 70 * minute,
    purpose: "Film a student interview",
    ...more,
  });
  return { db, sqlite, manager, borrower, workspaceId, equipmentId, booking };
}
const rejects = (fn: Promise<unknown>, status: number) =>
  assert.rejects(fn, (e) => e instanceof AppError && e.status === status);

test("interval validation and half-open boundaries", () => {
  assert.equal(overlaps(10, 20, 20, 30), false);
  assert.equal(overlaps(10, 21, 20, 30), true);
  for (const [start, end] of [
    [now - 1, now + minute],
    [now, now + minute],
    [NaN, now],
    [now, Infinity],
    [now, now + 8 * 86400000],
    [now + 91 * 86400000, now + 92 * 86400000],
  ])
    assert.throws(() => interval(start, end, now), AppError);
  assert.deepEqual(interval(now, now + 15 * minute, now), {
    start: now,
    end: now + 15 * minute,
  });
});
test("workspace provisioning, safe invitation, and role-scoped snapshot", async () => {
  const s = await setup();
  const b = await s.borrower.snapshot(s.workspaceId);
  assert.equal(b.equipment.length, 6);
  assert.equal(b.manager, false);
  assert.equal(b.workspace.join_code, undefined);
  assert.equal(b.activity.length, 0);
  assert.equal(b.memberCount, 2);
  await rejects(
    createService(s.db, outsider, now).snapshot(s.workspaceId),
    404,
  );
  await rejects(s.borrower.rotateInvite({ workspaceId: s.workspaceId }), 403);
});
test("concurrent overlapping reservations have exactly one winner and one audit event", async () => {
  const s = await setup();
  const results = await Promise.allSettled([
    s.borrower.reserve(s.booking()),
    s.manager.reserve(s.booking()),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  const snapshot = await s.manager.snapshot(s.workspaceId);
  assert.equal(snapshot.bookings.length, 1);
  assert.equal(
    snapshot.activity.filter((a) => a.action === "Reservation made").length,
    1,
  );
});
test("adjacent slots allowed; overlap refused; cancellation releases slot", async () => {
  const s = await setup(),
    first = s.booking();
  await s.borrower.reserve(first);
  await s.manager.reserve(
    s.booking({ startsAt: first.endsAt, endsAt: first.endsAt + 60 * minute }),
  );
  await rejects(
    s.borrower.reserve(s.booking({ startsAt: first.startsAt + minute })),
    409,
  );
  await s.borrower.transition({
    workspaceId: s.workspaceId,
    id: first.id,
    transition: "cancel",
  });
  await s.borrower.reserve(s.booking());
});
test("retry is idempotent and changed payload cannot reuse key", async () => {
  const s = await setup(),
    request = s.booking();
  await s.borrower.reserve(request);
  await s.borrower.reserve(request);
  await rejects(
    s.borrower.reserve({ ...request, purpose: "Something different" }),
    409,
  );
  assert.equal((await s.manager.snapshot(s.workspaceId)).bookings.length, 1);
});
test("ownership, role checks, handover, and return are enforced", async () => {
  const s = await setup(),
    request = s.booking();
  await s.borrower.reserve(request);
  await rejects(
    s.borrower.transition({
      workspaceId: s.workspaceId,
      id: request.id,
      transition: "checkout",
    }),
    403,
  );
  await rejects(
    s.manager.transition({
      workspaceId: s.workspaceId,
      id: request.id,
      transition: "return",
    }),
    409,
  );
  await s.manager.transition({
    workspaceId: s.workspaceId,
    id: request.id,
    transition: "checkout",
  });
  await rejects(
    s.borrower.transition({
      workspaceId: s.workspaceId,
      id: request.id,
      transition: "cancel",
    }),
    409,
  );
  await rejects(
    s.borrower.reserve(
      s.booking({
        startsAt: now + 2 * 86400000,
        endsAt: now + 2 * 86400000 + 60 * minute,
      }),
    ),
    409,
  );
  await s.manager.transition({
    workspaceId: s.workspaceId,
    id: request.id,
    transition: "return",
    note: "Lens checked, all parts present",
  });
  await s.manager.transition({
    workspaceId: s.workspaceId,
    id: request.id,
    transition: "return",
  });
  const snapshot = await s.manager.snapshot(s.workspaceId);
  assert.equal(snapshot.bookings[0].status, "returned");
  assert.equal(
    snapshot.bookings[0].return_note,
    "Lens checked, all parts present",
  );
  assert.equal(
    snapshot.activity.filter((a) => a.action === "Equipment returned").length,
    1,
  );
});
test("early and expired checkouts fail; overdue loan blocks next checkout", async () => {
  const s = await setup(),
    first = s.booking(),
    next = s.booking({
      startsAt: now + 70 * minute,
      endsAt: now + 130 * minute,
    });
  await s.borrower.reserve(first);
  await s.borrower.reserve(next);
  await rejects(
    s.manager.transition({
      workspaceId: s.workspaceId,
      id: next.id,
      transition: "checkout",
    }),
    409,
  );
  await s.manager.transition({
    workspaceId: s.workspaceId,
    id: first.id,
    transition: "checkout",
  });
  const later = createService(s.db, owner, now + 75 * minute);
  await rejects(
    later.transition({
      workspaceId: s.workspaceId,
      id: next.id,
      transition: "checkout",
    }),
    409,
  );
  await later.transition({
    workspaceId: s.workspaceId,
    id: first.id,
    transition: "return",
  });
  await later.transition({
    workspaceId: s.workspaceId,
    id: next.id,
    transition: "checkout",
  });
  const expired = s.booking({
    equipmentId: (await s.manager.snapshot(s.workspaceId)).equipment[1].id,
  });
  await s.borrower.reserve(expired);
  await rejects(
    later.transition({
      workspaceId: s.workspaceId,
      id: expired.id,
      transition: "checkout",
    }),
    409,
  );
});
test("maintenance respects active bookings and prevents new reservations", async () => {
  const s = await setup(),
    request = s.booking();
  await s.borrower.reserve(request);
  const maintenance = {
    workspaceId: s.workspaceId,
    id: s.equipmentId,
    status: "maintenance",
  };
  await rejects(s.manager.setEquipmentStatus(maintenance), 409);
  await rejects(s.borrower.setEquipmentStatus(maintenance), 403);
  await s.manager.transition({
    workspaceId: s.workspaceId,
    id: request.id,
    transition: "cancel",
  });
  await s.manager.setEquipmentStatus(maintenance);
  await rejects(s.borrower.reserve(s.booking()), 409);
  await s.manager.setEquipmentStatus({ ...maintenance, status: "active" });
  await s.borrower.reserve(s.booking());
});
test("asset tags unique within workspace and member cannot add assets", async () => {
  const s = await setup();
  const equipment = {
    workspaceId: s.workspaceId,
    id: id(),
    name: "Tripod",
    category: "Tools",
    assetTag: "TRI-001",
    location: "Shelf A",
    description: "",
  };
  await rejects(s.borrower.addEquipment(equipment), 403);
  await s.manager.addEquipment(equipment);
  await s.manager.addEquipment(equipment);
  await rejects(s.manager.addEquipment({ ...equipment, id: id() }), 409);
});
test("invitation rotation invalidates old code and joins remain idempotent", async () => {
  const s = await setup(),
    before = await s.manager.snapshot(s.workspaceId);
  await s.borrower.joinWorkspace({ code: before.workspace.join_code });
  assert.equal((await s.manager.snapshot(s.workspaceId)).memberCount, 2);
  await s.manager.rotateInvite({ workspaceId: s.workspaceId });
  await rejects(
    createService(s.db, outsider, now).joinWorkspace({
      code: before.workspace.join_code,
    }),
    404,
  );
});
test("cross-workspace asset injection and another borrower's cancellation fail", async () => {
  const s = await setup(),
    other = createService(s.db, outsider, now),
    secondId = id();
  await other.createWorkspace({
    id: secondId,
    name: "Different lab",
    sample: true,
  });
  await rejects(other.reserve(s.booking({ workspaceId: secondId })), 404);
  const code = (await s.manager.snapshot(s.workspaceId)).workspace.join_code;
  await other.joinWorkspace({ code });
  const request = s.booking();
  await s.borrower.reserve(request);
  await rejects(
    other.transition({
      workspaceId: s.workspaceId,
      id: request.id,
      transition: "cancel",
    }),
    403,
  );
  assert.equal((await other.snapshot(s.workspaceId)).bookings.length, 0);
});
test("failed audit rolls back the booking transaction", async () => {
  const s = await setup();
  s.sqlite.exec(
    "CREATE TRIGGER audit_failure BEFORE INSERT ON audit BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;",
  );
  await assert.rejects(
    s.borrower.reserve(s.booking()),
    /simulated disk failure/,
  );
  assert.equal((await s.manager.snapshot(s.workspaceId)).bookings.length, 0);
});
