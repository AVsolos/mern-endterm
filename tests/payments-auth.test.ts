import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import request from "supertest";
import { startMongo, stopMongo, freshStore } from "./mongo-fixture.ts";
import { createService } from "../server/service.ts";
import { createPayments, validSignature } from "../server/payments.ts";
import type {
  Gateway,
  GatewayOrder,
  GatewayPayment,
} from "../server/payments.ts";
import { createApp } from "../server/app.ts";
import { readConfig } from "../server/config.ts";
import type { Config } from "../server/config.ts";
import { AppError } from "../lib/domain.ts";
before(startMongo);
after(stopMongo);
const config: Config = {
  mongoUri: "mongodb://127.0.0.1/test",
  mongoDb: "test",
  port: 3001,
  origin: "http://127.0.0.1:5173",
  production: false,
  razorpayKeyId: "rzp_test_fixture",
  razorpaySecret: "test-only-secret-not-a-real-key",
  webhookSecret: "test-only-webhook-secret",
  bookingFee: 10000,
};
const owner = { userId: "owner", displayName: "Lab manager" };
const borrower = { userId: "borrower", displayName: "Student" };
class FakeGateway implements Gateway {
  orders = new Map<string, GatewayOrder>();
  payments = new Map<string, GatewayPayment>();
  creates = 0;
  captures = 0;
  loseResponse = false;
  async createOrder(amount: number, receipt: string) {
    this.creates++;
    const o = {
      id: `order_${this.creates}`,
      amount,
      currency: "INR",
      receipt,
      status: "created",
    };
    this.orders.set(o.id, o);
    if (this.loseResponse) {
      this.loseResponse = false;
      throw new Error("Simulated lost response after order creation");
    }
    return o;
  }
  async findOrders(receipt: string) {
    return [...this.orders.values()].filter((o) => o.receipt === receipt);
  }
  async getOrder(id: string) {
    const o = this.orders.get(id);
    if (!o) throw new Error("Unknown order");
    return o;
  }
  async getPayment(id: string) {
    const p = this.payments.get(id);
    if (!p) throw new Error("Unknown payment");
    return p;
  }
  async capturePayment(id: string, amount: number) {
    this.captures++;
    const p = await this.getPayment(id);
    assert.equal(amount, p.amount);
    const captured = { ...p, captured: true, status: "captured" };
    this.payments.set(id, captured);
    return captured;
  }
  async orderPayments(id: string) {
    return [...this.payments.values()].filter((p) => p.order_id === id);
  }
  paid(order: GatewayOrder, more: Partial<GatewayPayment> = {}) {
    const p: GatewayPayment = {
      id: "pay_fixture",
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      status: "captured",
      captured: true,
      ...more,
    };
    this.payments.set(p.id, p);
    return p;
  }
}
async function setup() {
  const store = await freshStore(),
    now = Date.now(),
    manager = createService(store, owner, now, 10000),
    member = createService(store, borrower, now, 10000);
  const workspaceId = crypto.randomUUID();
  await manager.createWorkspace({
    id: workspaceId,
    name: "Payments test lab",
    sample: true,
  });
  const snapshot = await manager.snapshot(workspaceId);
  await member.joinWorkspace({ code: snapshot.workspace.join_code });
  const bookingId = crypto.randomUUID();
  await member.reserve({
    workspaceId,
    id: bookingId,
    equipmentId: snapshot.equipment[0].id,
    startsAt: now + 5 * 60000,
    endsAt: now + 60 * 60000,
    purpose: "Test project filming",
  });
  const gateway = new FakeGateway(),
    payments = createPayments(store, config, gateway);
  return { store, manager, member, workspaceId, bookingId, gateway, payments };
}
function callback(
  bookingId: string,
  orderId: string,
  paymentId = "pay_fixture",
) {
  return {
    bookingId,
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: createHmac("sha256", config.razorpaySecret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex"),
  };
}
const rejects = (promise: Promise<unknown>, status: number) =>
  assert.rejects(promise, (e) => e instanceof AppError && e.status === status);

test("configuration rejects live keys; signature comparison rejects malformed and tampered signatures", () => {
  assert.throws(
    () =>
      readConfig({
        MONGODB_URI: config.mongoUri,
        RAZORPAY_KEY_ID: "rzp_live_forbidden",
      }),
    /test keys/,
  );
  assert.equal(validSignature("hello", "no", "key"), false);
  assert.equal(validSignature("hello", "0".repeat(64), "key"), false);
  const s = createHmac("sha256", "key").update("hello").digest("hex");
  assert.equal(validSignature("hello", s, "key"), true);
  assert.equal(validSignature("changed", s, "key"), false);
});
test("server-priced order reuse and checkout only after verified captured payment", async () => {
  const s = await setup();
  const first = await s.payments.createOrder(s.bookingId, borrower),
    second = await s.payments.createOrder(s.bookingId, borrower);
  assert.equal(first.amount, 10000);
  assert.equal(first.mode, "test");
  assert.equal(first.orderId, second.orderId);
  assert.equal(s.gateway.creates, 1);
  await rejects(
    s.manager.transition({
      workspaceId: s.workspaceId,
      id: s.bookingId,
      transition: "checkout",
    }),
    409,
  );
  s.gateway.paid(await s.gateway.getOrder(first.orderId));
  await s.payments.verify(callback(s.bookingId, first.orderId), borrower);
  await s.payments.verify(callback(s.bookingId, first.orderId), borrower);
  await s.manager.transition({
    workspaceId: s.workspaceId,
    id: s.bookingId,
    transition: "checkout",
  });
  assert.equal(
    (await s.manager.snapshot(s.workspaceId)).bookings[0].status,
    "checked_out",
  );
  assert.equal(
    await s.store.audit.countDocuments({ action: "Test booking fee verified" }),
    1,
  );
});
test("concurrent order requests create one provider order", async () => {
  const s = await setup();
  await Promise.allSettled([
    s.payments.createOrder(s.bookingId, borrower),
    s.payments.createOrder(s.bookingId, borrower),
  ]);
  assert.equal(s.gateway.creates, 1);
  assert.ok(
    (await s.store.bookings.findOne({ _id: s.bookingId }))?.payment_order_id,
  );
});
test("lost provider response is recovered by receipt without making a new order", async () => {
  const s = await setup();
  s.gateway.loseResponse = true;
  await assert.rejects(
    s.payments.createOrder(s.bookingId, borrower),
    /lost response/,
  );
  const result = await s.payments.createOrder(s.bookingId, borrower);
  assert.equal(result.orderId, "order_1");
  assert.equal(s.gateway.creates, 1);
});
test("foreign owner, forged signature, and order substitution are rejected", async () => {
  const s = await setup(),
    order = await s.payments.createOrder(s.bookingId, borrower);
  await rejects(s.payments.createOrder(s.bookingId, owner), 404);
  await rejects(
    s.payments.verify(
      {
        ...callback(s.bookingId, order.orderId),
        razorpay_signature: "0".repeat(64),
      },
      borrower,
    ),
    400,
  );
  await rejects(
    s.payments.verify(callback(s.bookingId, "order_other"), borrower),
    400,
  );
  assert.equal(
    (await s.store.bookings.findOne({ _id: s.bookingId }))?.payment_status,
    "unpaid",
  );
});
test("amount, currency, provider order, and capture status must all match", async () => {
  const s = await setup(),
    order = await s.payments.createOrder(s.bookingId, borrower),
    providerOrder = await s.gateway.getOrder(order.orderId);
  for (const mismatch of [
    { amount: 1 },
    { currency: "USD" },
    { order_id: "order_other" },
    { status: "failed", captured: false },
  ]) {
    s.gateway.paid(providerOrder, mismatch);
    await rejects(
      s.payments.verify(callback(s.bookingId, order.orderId), borrower),
      409,
    );
  }
  assert.equal(
    await s.store.audit.countDocuments({ action: "Test booking fee verified" }),
    0,
  );
});
test("authorized payment is captured using stored amount before marking paid", async () => {
  const s = await setup(),
    order = await s.payments.createOrder(s.bookingId, borrower);
  s.gateway.paid(await s.gateway.getOrder(order.orderId), {
    status: "authorized",
    captured: false,
  });
  await s.payments.verify(callback(s.bookingId, order.orderId), borrower);
  assert.equal(s.gateway.captures, 1);
  assert.equal(
    (await s.store.bookings.findOne({ _id: s.bookingId }))?.payment_status,
    "paid",
  );
});
test("cancelled reservation is not revived by late payment; no new checkout is allowed", async () => {
  const s = await setup(),
    order = await s.payments.createOrder(s.bookingId, borrower);
  await s.member.transition({
    workspaceId: s.workspaceId,
    id: s.bookingId,
    transition: "cancel",
  });
  await rejects(s.payments.createOrder(s.bookingId, borrower), 409);
  s.gateway.paid(await s.gateway.getOrder(order.orderId));
  await s.payments.verify(callback(s.bookingId, order.orderId), borrower);
  const b = await s.store.bookings.findOne({ _id: s.bookingId });
  assert.equal(b?.status, "cancelled");
  assert.equal(b?.payment_status, "paid");
  await rejects(
    s.manager.transition({
      workspaceId: s.workspaceId,
      id: s.bookingId,
      transition: "checkout",
    }),
    409,
  );
});
test("missed browser callback can be reconciled without creating another charge", async () => {
  const s = await setup(),
    order = await s.payments.createOrder(s.bookingId, borrower);
  await rejects(s.payments.reconcile(s.bookingId, borrower), 409);
  s.gateway.paid(await s.gateway.getOrder(order.orderId));
  assert.equal((await s.payments.reconcile(s.bookingId, borrower)).paid, true);
  assert.equal(s.gateway.creates, 1);
});
test("signed raw-body webhook and repeated event IDs update payment once", async () => {
  const s = await setup(),
    order = await s.payments.createOrder(s.bookingId, borrower);
  s.gateway.paid(await s.gateway.getOrder(order.orderId));
  const raw = Buffer.from(
    JSON.stringify({
      event: "payment.captured",
      payload: {
        payment: { entity: { id: "pay_fixture", order_id: order.orderId } },
      },
    }),
  );
  const signature = createHmac("sha256", config.webhookSecret)
    .update(raw)
    .digest("hex");
  const invalid = Buffer.from("null");
  await rejects(
    s.payments.webhook(
      invalid,
      createHmac("sha256", config.webhookSecret).update(invalid).digest("hex"),
      "event_invalid",
    ),
    400,
  );
  await rejects(s.payments.webhook(raw, "0".repeat(64), "event_test"), 400);
  await s.payments.webhook(raw, signature, "event_test");
  await s.payments.webhook(raw, signature, "event_test");
  await s.payments.verify(callback(s.bookingId, order.orderId), borrower);
  assert.equal(
    await s.store.audit.countDocuments({ action: "Test booking fee verified" }),
    1,
  );
  assert.equal(await s.store.webhooks.countDocuments({}), 1);
});
test("database failure does not leave a paid flag without its audit record", async () => {
  const s = await setup(),
    order = await s.payments.createOrder(s.bookingId, borrower);
  s.gateway.paid(await s.gateway.getOrder(order.orderId));
  await s.store.db.command({
    collMod: "audit",
    validator: { impossible_field: { $exists: true } },
    validationLevel: "strict",
  });
  await assert.rejects(
    s.payments.verify(callback(s.bookingId, order.orderId), borrower),
    /validation/,
  );
  assert.equal(
    (await s.store.bookings.findOne({ _id: s.bookingId }))?.payment_status,
    "unpaid",
  );
});
test("Express accounts hash passwords and tokens, require session and origin, and invalidate logout", async () => {
  const store = await freshStore(),
    app = createApp(store, config, { rateLimits: false }),
    agent = request.agent(app);
  await agent.get("/api/workspace").expect(401);
  await agent
    .post("/api/auth/register")
    .set("Origin", "https://evil.example")
    .send({})
    .expect(403);
  const result = await agent
    .post("/api/auth/register")
    .set("Origin", config.origin)
    .send({
      name: "Test student",
      email: "student@example.test",
      password: "A-test-password-123",
    })
    .expect(201);
  assert.ok(result.headers["set-cookie"][0].includes("HttpOnly"));
  assert.ok(result.headers["set-cookie"][0].includes("SameSite=Lax"));
  assert.equal(result.body.token, undefined);
  const user = await store.users.findOne({ email: "student@example.test" });
  assert.notEqual(user?.password_hash, "A-test-password-123");
  const token = result.headers["set-cookie"][0].split(";")[0].split("=")[1];
  const session = await store.sessions.findOne({ user_id: user?._id });
  assert.notEqual(session?._id, token);
  await agent.get("/api/workspace").expect(200);
  await agent
    .post("/api/workspace")
    .set("Origin", config.origin)
    .send({
      action: "create",
      id: crypto.randomUUID(),
      name: "Account test lab",
      userId: "forged-owner",
    })
    .expect(200);
  assert.equal((await store.workspaces.findOne({}))?.owner_id, user?._id);
  await agent
    .post("/api/auth/logout")
    .set("Origin", config.origin)
    .send({})
    .expect(200);
  await agent.get("/api/workspace").expect(401);
  await agent
    .post("/api/auth/login")
    .set("Origin", config.origin)
    .send({ email: "student@example.test", password: "A-wrong-password-123" })
    .expect(401);
  await agent
    .post("/api/auth/login")
    .set("Origin", config.origin)
    .send({ email: "student@example.test", password: "A-test-password-123" })
    .expect(200);
  await agent
    .get("/api/auth/me")
    .expect(200)
    .then((r) => assert.equal(r.body.user.displayName, "Test student"));
});
test("Express rejects malformed, oversized, and missing JSON requests", async () => {
  const app = createApp(await freshStore(), config, { rateLimits: false });
  await request(app)
    .post("/api/auth/login")
    .set("Origin", config.origin)
    .set("Content-Type", "application/json")
    .send("{")
    .expect(400);
  await request(app)
    .post("/api/auth/login")
    .set("Origin", config.origin)
    .send({ huge: "x".repeat(9000) })
    .expect(413);
  await request(app)
    .post("/api/auth/login")
    .set("Origin", config.origin)
    .set("Content-Type", "text/plain")
    .send("hi")
    .expect(415);
  await request(app).get("/api/unknown").expect(404);
});
