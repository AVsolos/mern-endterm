# Product and architecture

BorrowLab serves campus equipment managers and borrowers. The five workflows are workspace membership, conflict-safe reservation, verified test payment, manager handover/return, and inventory/audit management.

## Runtime

React/Vite is served by Vercel's static delivery. All `/api/*` routes enter `api/index.ts`, which initializes and reuses a bounded MongoDB pool and delegates to Express. Local development runs Express and Vite separately with a same-origin proxy. Database, sessions, and audit state are in MongoDB Atlas, never the function filesystem.

## Data and consistency

Collections: users, sessions, workspaces, members, equipment, bookings, audit, webhooks. Unique indexes protect normalized email, workspace invitation, workspace membership, asset tags, and provider order/payment IDs. Sessions and webhook deduplication records have TTL indexes; authentication also checks expiry directly.

Every equipment-changing transaction writes its equipment revision before checking availability. Competing transactions contend on that shared document and retry, preventing write skew. Reservation and audit records commit together. Slots use half-open intervals `[start,end)`; adjacent reservations are allowed. Checked-out equipment blocks every new reservation until returned. Expired uncollected reservations remain history but stop blocking future slots.

Booking states are `reserved -> checked_out -> returned`, or `reserved -> cancelled`. Conditional updates enforce state transitions. Checkout requires manager role, verified payment, and a time from 15 minutes before pickup until reservation end. Maintenance requires resolving active commitments first. Invitation rotation and joins serialize on the workspace revision.

## Payment lifecycle

The API saves the fee at reservation time. Only the booking owner can create/pay/reconcile an order. Order creation uses a database claim and a deterministic booking receipt; retries search the provider before creating another order. The callback HMAC uses the stored order ID. The server then checks the provider payment's order, amount, INR currency, and captured status, capturing an authorized test payment if needed. Paid status and audit insert commit together.

Raw-body webhooks require their separate HMAC and event ID. Repeated callbacks/events are idempotent. Reconciliation fetches provider state when the browser callback is lost. A late payment never revives a cancelled reservation. All fees are explicitly non-refundable simulations; live keys are rejected.

## Boundaries and tradeoffs

Opaque sessions are hashed in MongoDB; passwords are salted scrypt hashes. SameSite cookies, exact-origin mutation checks, bounded JSON, authorization, and sanitized errors protect APIs. Each Vercel instance has its own rate-limit counters. A distributed limiter, account recovery, email verification, production billing/refunds, and notifications are outside this submission.

The database must be Atlas or a replica set because transactional correctness is part of the design. Cold starts establish a small pool and verify indexes. No database credentials or Razorpay secrets are shipped in the React bundle. Public deployment permits evaluator registration; private workspace records still require membership.
