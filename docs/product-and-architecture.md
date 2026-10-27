# BorrowLab

## Problem and users

Student clubs and small campus labs share cameras, audio gear, electronics, and tools. Chat-based lending loses availability information and accountability. BorrowLab gives members a reliable reservation schedule and gives equipment managers a controlled handover workflow.

## Four complete workflows

1. **Set up a shared workspace:** sign in, create a workspace, load optional sample equipment, and invite members using a revocable join code. Joining never grants management access.
2. **Discover and reserve:** search/filter real inventory, choose start/end times, check conflicts, submit a purpose, and receive a persisted reservation. Simultaneous requests cannot double-book an asset.
3. **Manage a loan:** borrowers see/cancel their reservations; managers check equipment out and record returns. The server enforces ownership, role, timing, and legal status transitions. Late returns are highlighted.
4. **Maintain inventory:** managers add equipment, change service status safely, review workspace bookings, and inspect an append-only activity trail.

## Stack and boundaries

- React and TypeScript UI with Vinext route handlers.
- Cloudflare Worker API and D1/SQLite persistent relational storage.
- Drizzle schema and checked-in SQL migrations; parameterized SQL for atomic workflow commands.
- Sites/ChatGPT identity at the hosting gateway. Local mock identity is loopback-only development behavior supplied by the starter.
- Node's test runner and a real SQLite adapter test service logic, permissions, constraints, and concurrent reservation behavior.

Every workspace has an owner/manager and members. Workspace membership is checked on each API operation. A high-entropy, rotatable join code is a bearer invitation; only the manager can see it. Client requests never determine user identity or role. Workspaces isolate evaluator demos from other users' data.

## Consistency rules

- One equipment row represents one physical asset with a unique asset tag per workspace.
- Booking intervals are half-open `[start, end)`, permitting back-to-back reservations.
- Minimum duration is 15 minutes; maximum is 7 days; start must be within the next 90 days.
- An atomic conditional INSERT both checks availability and creates the booking. Availability shown in the browser is advisory; the write is authoritative.
- A checked-out item blocks new reservations until returned, including when overdue.
- State transitions are conditional UPDATEs. Only managers check out or return; borrowers can cancel only their own reserved bookings. Managers can cancel reserved bookings in their workspace.
- Handover opens 15 minutes before the reservation and closes at its end. Returns are allowed whenever checked out.
- Maintenance cannot be enabled while an item has a future/current reservation or an outstanding loan.
- Client-generated UUIDs make booking submission retries idempotent; reuse with changed fields fails.
- Mutation and audit insertion use a single database batch transaction.
- All timestamps persist as Unix milliseconds; UI input/display uses the browser's local timezone.

## Commit milestones

Requirements → scaffold and design → persistent workflow engine with tests → complete UI → verification and fixes → release documentation and deployment.

## Scope limits

No payments, attachments, notifications, recurring bookings, or equipment quantity pools. No claim of school-wide identity verification: possession of a workspace invitation grants borrower membership. Authentication requires a ChatGPT account on hosted Sites. An evaluator can create their own workspace after sign-in.

## Delivery evidence

Deployment, GitHub publication, demo video, and form completion are tracked separately in `submission-checklist.md`; source completion does not imply final submission.
