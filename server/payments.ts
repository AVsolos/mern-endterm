import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError, uuid } from "../lib/domain.ts";
import type { Actor } from "../lib/domain.ts";
import { transaction } from "./database.ts";
import type { Store, BookingDoc } from "./database.ts";
import type { Config } from "./config.ts";

export type GatewayOrder = { id: string; amount: number; currency: string; receipt: string; status: string };
export type GatewayPayment = { id: string; order_id: string; amount: number; currency: string; status: string; captured: boolean };
export interface Gateway {
  createOrder(amount: number, receipt: string): Promise<GatewayOrder>;
  findOrders(receipt: string): Promise<GatewayOrder[]>;
  getOrder(id: string): Promise<GatewayOrder>;
  getPayment(id: string): Promise<GatewayPayment>;
  capturePayment(id: string, amount: number): Promise<GatewayPayment>;
  orderPayments(id: string): Promise<GatewayPayment[]>;
}
export function razorpayGateway(config: Config): Gateway {
  async function request<T>(path: string, data?: unknown): Promise<T> {
    if (!config.razorpayKeyId.startsWith("rzp_test_") || !config.razorpaySecret) throw new AppError("Razorpay test payments are not configured.", 503);
    let response: Response;
    try { response = await fetch(`https://api.razorpay.com/v1${path}`, {
      method: data ? "POST" : "GET", headers: { Authorization: `Basic ${Buffer.from(`${config.razorpayKeyId}:${config.razorpaySecret}`).toString("base64")}`, "Content-Type": "application/json" },
      body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(12000),
    }); } catch { throw new AppError("Razorpay did not respond. Retry the same booking; an existing order will be reused.", 502); }
    if (!response.ok) throw new AppError("Razorpay could not complete this test payment request. Retry or check the test dashboard.", 502);
    return await response.json() as T;
  }
  return {
    createOrder: (amount, receipt) => request("/orders", { amount, currency: "INR", receipt, notes: { booking_id: receipt } }),
    findOrders: async receipt => (await request<{ items: GatewayOrder[] }>(`/orders?receipt=${encodeURIComponent(receipt)}&count=100`)).items,
    getOrder: id => request(`/orders/${encodeURIComponent(id)}`),
    getPayment: id => request(`/payments/${encodeURIComponent(id)}`),
    capturePayment: (id, amount) => request(`/payments/${encodeURIComponent(id)}/capture`, { amount, currency: "INR" }),
    orderPayments: async id => (await request<{ items: GatewayPayment[] }>(`/orders/${encodeURIComponent(id)}/payments`)).items,
  };
}
export function validSignature(message: string | Buffer, signature: unknown, secret: string) {
  if (!secret || typeof signature !== "string" || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac("sha256", secret).update(message).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
function providerId(value: unknown, prefix: string) {
  if (typeof value !== "string" || !new RegExp(`^${prefix}_[A-Za-z0-9]{1,64}$`).test(value)) throw new AppError("Invalid payment reference.");
  return value;
}
export function createPayments(store: Store, config: Config, gateway: Gateway = razorpayGateway(config)) {
  async function owned(id: unknown, actor: Actor) {
    const b = await store.bookings.findOne({ _id: uuid(id), user_id: actor.userId });
    if (!b || !await store.members.findOne({ workspace_id: b.workspace_id, user_id: actor.userId })) throw new AppError("Reservation not found.", 404);
    return b;
  }
  function validateOrder(order: GatewayOrder, booking: BookingDoc) {
    if (!order.id?.startsWith("order_") || order.amount !== booking.fee_paise || order.currency !== "INR" || order.receipt !== booking.id) throw new AppError("The payment order does not match this reservation.", 409);
  }
  function checkout(order: GatewayOrder, b: BookingDoc) {
    validateOrder(order, b);
    return { key: config.razorpayKeyId, orderId: order.id, amount: b.fee_paise, currency: "INR", bookingId: b.id, mode: "test" };
  }
  async function createOrder(id: unknown, actor: Actor) {
    if (!config.razorpayKeyId.startsWith("rzp_test_") || !config.razorpaySecret) throw new AppError("Razorpay test payments are not configured.", 503);
    const b = await owned(id, actor), now = Date.now();
    if (b.payment_status === "paid") throw new AppError("This booking fee is already paid. Refresh your reservations.", 409);
    if (b.status !== "reserved" || b.ends_at <= now) throw new AppError("Only an active reservation can be paid.", 409);
    if (b.payment_order_id) return checkout(await gateway.getOrder(b.payment_order_id), b);
    const claim = crypto.randomUUID();
    const claimed = await store.bookings.findOneAndUpdate({ _id: b.id, status: "reserved", payment_status: "unpaid", payment_order_id: { $exists: false }, $or: [{ order_claim: { $exists: false } }, { order_claimed_at: { $lt: now - 120000 } }] }, { $set: { order_claim: claim, order_claimed_at: now }, $inc: { revision: 1 } }, { returnDocument: "after" });
    if (!claimed) {
      const latest = await owned(id, actor);
      if (latest.payment_order_id && latest.status === "reserved") return checkout(await gateway.getOrder(latest.payment_order_id), latest);
      throw new AppError("A payment order is being prepared. Wait a moment, then retry.", 409);
    }
    try {
      // Recover a server-created order if the preceding request timed out before saving its ID.
      const existing = (await gateway.findOrders(b.id)).filter(order => order.receipt === b.id);
      if (existing.length > 1) throw new AppError("Multiple payment orders need review in the test dashboard. No new order was created.", 409);
      const order = existing[0] ?? await gateway.createOrder(b.fee_paise, b.id);
      validateOrder(order, b);
      const saved = await store.bookings.findOneAndUpdate({ _id: b.id, order_claim: claim }, { $set: { payment_order_id: order.id }, $unset: { order_claim: "", order_claimed_at: "" }, $inc: { revision: 1 } }, { returnDocument: "after" });
      if (!saved || saved.status !== "reserved" || saved.ends_at <= Date.now()) throw new AppError("The reservation changed while preparing payment. Refresh before continuing.", 409);
      return checkout(order, saved);
    } catch (e) {
      await store.bookings.updateOne({ _id: b.id, order_claim: claim }, { $unset: { order_claim: "", order_claimed_at: "" } });
      throw e;
    }
  }
  async function authoritativePayment(paymentId: string, b: BookingDoc, allowCapture: boolean) {
    let p = await gateway.getPayment(providerId(paymentId, "pay"));
    const matches = (payment: GatewayPayment) => payment.id === paymentId && payment.order_id === b.payment_order_id && payment.amount === b.fee_paise && payment.currency === "INR";
    if (!matches(p)) throw new AppError("Payment details do not match the stored booking fee.", 409);
    if (allowCapture && p.status === "authorized") p = await gateway.capturePayment(p.id, b.fee_paise);
    if (!matches(p) || p.status !== "captured" || p.captured !== true) throw new AppError("Payment is not captured yet. Use Check payment status before trying another payment.", 409);
    return p;
  }
  async function recordPaid(b: BookingDoc, p: GatewayPayment, actorName: string, eventId?: string) {
    return transaction(store, async session => {
      const current = await store.bookings.findOneAndUpdate({ _id: b.id }, { $inc: { revision: 1 } }, { session, returnDocument: "after" });
      if (!current || current.payment_order_id !== p.order_id || current.fee_paise !== p.amount) throw new AppError("Reservation payment reference changed.", 409);
      if (eventId && await store.webhooks.findOne({ _id: eventId }, { session })) return { id: b.id, paid: true };
      if (current.payment_status === "paid" && current.payment_id !== p.id) throw new AppError("This reservation already has another payment recorded.", 409);
      if (current.payment_status !== "paid") {
        await store.bookings.updateOne({ _id: b.id }, { $set: { payment_status: "paid", payment_id: p.id, paid_at: Date.now() } }, { session });
        const auditId = crypto.randomUUID();
        await store.audit.insertOne({ _id: auditId, id: auditId, workspace_id: b.workspace_id, actor_id: b.user_id, actor_name: actorName, action: "Test booking fee verified", resource_id: b.id, detail: `INR ${(b.fee_paise / 100).toFixed(2)} · ${p.id}${current.status === "cancelled" ? " · booking remains cancelled" : ""}`, created_at: Date.now() }, { session });
      }
      if (eventId) await store.webhooks.insertOne({ _id: eventId, payment_id: p.id, received_at: new Date() }, { session });
      return { id: b.id, paid: true };
    });
  }
  async function verify(input: Record<string, unknown>, actor: Actor) {
    const b = await owned(input.bookingId, actor), paymentId = providerId(input.razorpay_payment_id, "pay");
    if (!b.payment_order_id || input.razorpay_order_id !== b.payment_order_id || !validSignature(`${b.payment_order_id}|${paymentId}`, input.razorpay_signature, config.razorpaySecret)) throw new AppError("Payment signature verification failed.", 400);
    const p = await authoritativePayment(paymentId, b, true);
    return recordPaid(b, p, actor.displayName);
  }
  async function reconcile(id: unknown, actor: Actor) {
    const b = await owned(id, actor);
    if (b.payment_status === "paid") return { id: b.id, paid: true };
    if (!b.payment_order_id) throw new AppError("No payment order exists for this reservation.", 409);
    const payments = await gateway.orderPayments(b.payment_order_id);
    const p = payments.find(p => p.status === "captured") ?? payments.find(p => p.status === "authorized");
    if (!p) throw new AppError("No successful payment found yet. A failed or dismissed checkout does not mark your fee paid.", 409);
    return recordPaid(b, await authoritativePayment(p.id, b, true), actor.displayName);
  }
  async function webhook(raw: Buffer, signature: unknown, eventId: unknown) {
    if (!config.webhookSecret) throw new AppError("Webhook secret is not configured.", 503);
    if (!validSignature(raw, signature, config.webhookSecret)) throw new AppError("Invalid webhook signature.", 400);
    if (typeof eventId !== "string" || eventId.length < 1 || eventId.length > 128) throw new AppError("Missing webhook event identifier.", 400);
    let payload: { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string } } } };
    try { payload = JSON.parse(raw.toString("utf8")); } catch { throw new AppError("Invalid webhook JSON."); }
    if (payload.event !== "payment.captured") return { ignored: true };
    const incoming = payload.payload?.payment?.entity;
    const orderId = providerId(incoming?.order_id, "order"), paymentId = providerId(incoming?.id, "pay");
    const b = await store.bookings.findOne({ payment_order_id: orderId });
    if (!b) return { ignored: true };
    if (await store.webhooks.findOne({ _id: eventId })) return { duplicate: true };
    return recordPaid(b, await authoritativePayment(paymentId, b, false), "Razorpay test webhook", eventId);
  }
  return { createOrder, verify, reconcile, webhook };
}
