# Verification evidence

Date: 27 October 2026. Stack: MongoDB, Express, React, Node.js.

- TypeScript checks and Vite production build pass.
- 25 automated tests pass against a real isolated MongoDB replica set. Gateway tests use a deterministic test double; they are not proof of live provider connectivity.
- Atlas connection and transaction support verified using the supplied ignored environment configuration.
- Razorpay test authentication independently verified (HTTP 200).
- Browser: registered an account, created a workspace and six persisted assets, reserved a camera, opened Razorpay Standard Checkout, and completed an INR 100 test netbanking payment. Reload showed Test Fee Paid and enabled checkout.

Coverage includes concurrent conflicting reservations, adjacent slots, membership/manager isolation, state transitions, maintenance, transactional audit rollback, server-priced reusable orders, duplicate callbacks, lost order responses, forged signatures, incorrect payment amount/currency/order/status, authorized capture, late payment after cancellation, callback reconciliation, signed webhooks, password/session hashing, origin checks, logout, malformed and oversized input.

Webhook signature and deduplication behavior is tested locally. Delivery from the Razorpay dashboard is not configured or claimed. Hosted verification is recorded below. A recorded demo and submitted form are not implied by these tests.

## Vercel release status

Production application: https://borrowlab-mern.vercel.app

- Vercel production deployment is READY and publicly accessible.
- TypeScript relative-import rewriting and Node 22 fix the serverless module imports.
- The student updated Atlas network access. Fresh Atlas connectivity and transaction support pass; the public `/api/health` returns `{"status":"ok","database":"mongodb","payments":"test"}`.
- Production email/password sign-in succeeds with the existing Atlas account. The deployed app reads the same workspace and inventory, and a new reservation persists through the Vercel Express API.
- GitHub is publicly accessible without authentication (HTTP 200).

The temporary Atlas access-list failure is resolved. No credentials were committed. Git auto-deploy is not connected because the Vercel GitHub integration is absent; the verified release was deployed directly from the same local source.

Hosted end-to-end check: reserved Rode Wireless GO II through Vercel, completed INR 100 Razorpay test payment, received server-verified Test Fee Paid status, then checked out and returned the equipment with a condition note. Reload preserved the paid and returned records. No real money was charged.
