# MERN migration and Razorpay test payments

The initial commits used React, Vinext, and D1/SQLite. No MongoDB credentials were used or connected in that version. The updated target is MongoDB, Express, React, and Node.js, as requested by Atharva Singh. The old deployment archive must not be published as the MERN release.

## Scope

- Retain equipment discovery, reservations, manager checkout/return, inventory, workspace isolation, and audit history.
- Replace D1 with MongoDB replica-set transactions and indexed collections.
- Replace platform-specific identity with email/password accounts and opaque, HttpOnly cookie sessions stored as hashes in MongoDB.
- Run Express and the React production build as one Node service.
- Add a booking fee using Razorpay **test mode only**; require verified captured payment before checkout.
- Create orders on the server, verify checkout signatures and captured amount/currency/order, reconcile signed webhooks, and process repeated callbacks idempotently.
- Keep MongoDB credentials and Razorpay secrets in ignored environment configuration.

## Consistency

Every equipment-changing transaction first increments that equipment's revision. Concurrent transactions therefore contend on a shared document and retry instead of allowing both reservations after stale reads. Reservation and audit changes commit together. Client availability remains advisory.

Test payments remain separate from the booking state. Cancelled reservations are never revived by a late payment callback. The booking fee is a non-refundable test charge, disclosed before payment; no real-money billing or live keys are supported.

## Milestones

1. Document target stack and safe configuration.
2. Implement MongoDB service, Express authentication/API, and React/Vite runtime.
3. Implement Razorpay test checkout and verified payment lifecycle.
4. Test real MongoDB transactions and gateway failure cases; update deployment and evaluator documentation.

Atlas connectivity and a completed Razorpay test checkout must be reported separately from local integration tests. A local test replica set does not establish an Atlas connection.
