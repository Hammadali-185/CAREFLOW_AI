# Decisions

These are the choices that shape CareFlow AI, and the costs that come with them.

## One API and one web app

Booking, accounts, and the assistant share one Express process and one React app. A separate worker, queue, or model service would add failure modes the clinic does not need yet. The cost is that a slow model call occupies an API request until it times out.

## PostgreSQL is the source of truth

Prisma models the tables. Hand-written SQL adds checks, composite tenant foreign keys, triggers, and GiST exclusion constraints. `database/schema.sql` is the review copy of that end state. Applying both the SQL file and the migrations on one database would create the tables twice.

`prisma migrate diff` wants to drop the composite tenant foreign keys because the Prisma schema cannot express them. That diff is not applied. New migrations are written by hand.

## Overlap is rejected in the database

Two bookings for one staff member cannot overlap while they are `requested` or `confirmed`. The exclusion constraint is the final guard. The booking transaction also locks the staff row and rebuilds the open slots before insert. Reschedule cancels the old row and inserts the new one in the same transaction, so a failure leaves the original visit in place.

Half-open ranges make back-to-back visits legal. Cancelled, completed, and no-show visits do not block time.

## The browser shows a booking only after commit

The form and the assistant render "Your visit is booked" from the appointment returned by the API. A model sentence is not that response. Create, cancel, and reschedule each finish inside one database transaction before the handler returns.

## Idempotency is optional

`Idempotency-Key` on create replays the same patient, clinic, service, staff member, and start. A reused key with a different payload is rejected. Clients that omit the key can still book, so a double submit without a key can create two visits at different times, or one `409` if the times overlap.

## Sessions are opaque cookies

The database stores a SHA-256 digest. The cookie is HTTP-only and host-only. Local development uses `SameSite=Lax`. Production uses `SameSite=None`, `Partitioned`, and `Secure` so a browser keeps the session when the site and API are different `onrender.com` hosts. CSRF uses a custom header on every state change and an HMAC token on authenticated mutations. Login and signup are rate-limited in process memory. Other routes are not.

## The model cannot write to the database

Mistral runs only on the API. Its reply must match a strict intent schema. The API then searches real slots or asks a question it composed from the catalog. Confirmation calls the same booking service as the form. A missing key, timeout, or invalid reply leaves the appointment table unchanged and tells the patient to use the form.

## Time zones

Each clinic has an IANA timezone. Slot labels use that calendar. The API sets `TIME ZONE UTC` on every pooled connection because the driver adapter can drop offsets. Tests that share one PGlite socket use a pool size of one. A production pool uses the `pg` default unless `PG_POOL_MAX` is set.

## Local PostgreSQL

`docker-compose.yml` is PostgreSQL 16 for a machine that has Docker. The automated tests do not require it. They migrate and seed PostgreSQL 17.5 through PGlite. Docker was not installed on the machine that produced the assessment report, so Compose was not started there.
