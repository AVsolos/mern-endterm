# Verification evidence

Date: 27 October 2026. Stack: MongoDB, Express, React, Node.js.

- TypeScript checks and Vite production build pass.
- 25 automated tests pass against a real isolated MongoDB replica set. Gateway tests use a deterministic test double; they are not proof of live provider connectivity.
- Atlas connection and transaction support verified using the supplied ignored environment configuration.
- Razorpay test authentication independently verified (HTTP 200).
- Browser: registered an account, created a workspace and six persisted assets, reserved a camera, opened Razorpay Standard Checkout, and completed an INR 100 test netbanking payment. Reload showed Test Fee Paid and enabled checkout.

Coverage includes concurrent conflicting reservations, adjacent slots, membership/manager isolation, state transitions, maintenance, transactional audit rollback, server-priced reusable orders, duplicate callbacks, lost order responses, forged signatures, incorrect payment amount/currency/order/status, authorized capture, late payment after cancellation, callback reconciliation, signed webhooks, password/session hashing, origin checks, logout, malformed and oversized input.

Webhook signature and deduplication behavior is tested locally. Delivery from the Razorpay dashboard is not configured or claimed. Vercel deployment verification is recorded separately once complete. A recorded demo and submitted form are not implied by these tests.

## Vercel release status

Production frontend: https://borrowlab-mern.vercel.app
The Vercel build is ready and public. Runtime module imports were corrected using TypeScript relative-import rewriting and Node 22. The latest API check is blocked by MongoDB connectivity: new local connections also report `MongoServerSelectionError` with TLS alert errors. Atlas network access and cluster status need verification before this can be marked a healthy evaluator deployment. Earlier browser evidence of payment, checkout, and return was recorded before these new connections failed.
