# Verification record

## Automated checks

`npm test` runs the application service against real in-memory SQLite initialized from the committed Drizzle migrations, not mocked query results.

Covered cases:

1. Invalid date values, booking duration, lead time, and half-open intervals.
2. Workspace creation, membership, manager/borrower snapshots, and private invitation visibility.
3. Concurrent overlapping reservations: exactly one succeeds and one audit event is written.
4. Adjacent bookings, conflict rejection, and cancellation releasing availability.
5. Idempotent retry and rejection of changed data under the same request ID.
6. Role enforcement, legal handover/return transitions, and saved condition notes.
7. Early/expired checkout rejection and overdue loans blocking subsequent handovers.
8. Maintenance restrictions and restoration of service.
9. Asset-tag uniqueness and inventory write authorization.
10. Invitation rotation and repeated join requests.
11. Cross-workspace injection, borrower privacy, and ownership enforcement.
12. Database failure during audit insertion rolls back the booking itself.

The concurrency test interleaves service calls before their atomic SQLite statements. It verifies our algorithm against SQLite semantics, not geographic Cloudflare load or a distributed load test.

`npm run typecheck` checks the TypeScript source. `npm run build` produces the Worker and browser bundles. GitHub Actions repeats these on pushes and pull requests.

## Browser verification — local D1, 27 October 2026

Verified through the actual UI:

- Anonymous welcome page and local development sign-in.
- Create a workspace with six persisted sample equipment records.
- Reserve a Sony camera for a future two-hour slot.
- Availability changes from six to five, with the camera's reserve action disabled.
- Manager checks out the camera and records its return with a condition note.
- Reload the page: workspace and records persist, availability returns to six.
- Activity contains reservation, checkout, return, and workspace creation events.
- Narrow viewport uses responsive navigation and stacked forms.

Hosted identity, public availability, and production D1 verification are recorded separately after deployment. Local mock sign-in is not evidence of a successful hosted sign-in.

## Known scope limits

- Account identity requires ChatGPT on hosted Sites; the public welcome page is anonymous.
- Availability refreshes every 30 seconds and on mutations; the write always rechecks it.
- Lists show the latest 250 bookings and 80 audit events; conflict checks include all relevant bookings.
- A checked-out item blocks future reservations conservatively until it is returned.
- Workspace member removal, ownership transfer, and account deletion are outside this release.
- No email/SMS reminders, recurring reservations, payments, uploads, or offline writes.
- Service authorization assumes Sites strips untrusted identity headers and injects verified identity. Do not expose the Worker directly behind an untrusted gateway.
