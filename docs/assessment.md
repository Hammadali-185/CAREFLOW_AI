# Assessment

This record is from the verification run on 15 October 2026. Commands were executed from the repository root on Windows. Docker was not installed, so `docker-compose.yml` was not started. Tests used PostgreSQL 17.5 through PGlite.

## 1. Implemented features

- Patient registration against an existing clinic slug, login, logout, and an HTTP-only session cookie.
- Patient home, visit list with search and status filters, manual booking, cancellation, and rescheduling.
- Scheduling assistant that calls Mistral only from the API, validates a strict intent, and books only after the patient confirms a real slot.
- Staff and clinic-administrator clinic desk: today's count, a seven-day strip, services, and weekly hours.
- PostgreSQL constraints for tenant references, active-appointment overlap, and chat workflow state.

## 2. Incomplete features

- Notifications are not implemented.
- There is no HTTP action to mark a visit completed or as a no-show. Those statuses exist in the database enum.
- The browser end-to-end run does not complete a booking through a live Mistral response. The harness starts the API with no provider key. A scripted model in the API integration tests does complete chat booking, cancellation, and rescheduling.
- This machine did not start Docker PostgreSQL 16. A deployment was not performed.

## 3. Commands and results

| Command             | Result                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`          | Passed. API 8 files, 63 tests. Web 9 files, 15 tests.                                                                                              |
| `npm run typecheck` | Passed. Shared, API, web, and Playwright projects.                                                                                                 |
| `npm run lint`      | Passed. ESLint and Prettier.                                                                                                                       |
| `npm run build`     | Passed. Shared and API compiled. Vite built the web app. The main JavaScript chunk is 552 kB (166 kB gzip) and Vite warned that it exceeds 500 kB. |
| `npm run test:e2e`  | Passed. 12 tests, one worker, 37.7 seconds. Viewports 320, 390, 768, and 1280.                                                                     |

The first `npm test` in this session failed because `apps/api/tests/schema.integration.test.ts` exceeded Vitest's 10 second hook limit while other checks were running. The API Vitest config now allows 60 seconds for hooks. A later `npm test` with that setting passed, including all 12 schema tests.

## 4. Known defects and limitations

- Login and signup rate limits live in one process and reset on restart. Other routes are not rate-limited.
- `Secure` is added to the session cookie only when `NODE_ENV` is `production`.
- A production web build reads `VITE_API_BASE_URL` at build time. The build in this session embedded `http://127.0.0.1:4000` from the local web environment file.
- The assistant emergency check is a phrase list, not clinical triage.
- Idempotency applies when the client sends `Idempotency-Key`. A retry without that header can create a second visit when the times do not overlap.
- PGlite verification uses one database connection. A production pool uses the `pg` default unless `PG_POOL_MAX` is set.

## 5. Architecture

One React application and one Express API share Zod contracts in `@careflow/shared`. The web app owns screens and server state. The API owns validation, authorization, Mistral, and PostgreSQL. Signed-in pages use a sidebar from 1024 pixels up and a bottom shortcut bar below that. Details are in [architecture.md](architecture.md) and [decisions.md](decisions.md).

## 6. Database and concurrency

Migrations live in `apps/api/prisma/migrations`. `database/schema.sql` is the review copy of the same end state. `database/seed.sql` loads Harbor Light. The entity diagram is in [database.md](database.md).

An active appointment is `requested` or `confirmed`. A GiST exclusion constraint rejects an overlapping active range for the same staff member. The booking transaction also locks the staff row and rebuilds open slots. Reschedule cancels the old row and inserts the new one in that transaction. Ranges are half-open, so back-to-back visits are allowed. Composite foreign keys keep a visit inside one clinic. Do not apply the Prisma diff that drops those foreign keys.

## 7. AI integration and fallback

The browser never receives `MISTRAL_API_KEY`. A missing key, timeout, rate limit, or reply that fails the intent schema is stored as assistant text and does not insert an appointment. The patient is sent to the booking form. Slot search and confirmation use the same booking service as the form. The screen says a visit is booked only after that service returns the saved appointment.

## 8. Security controls and remaining risks

Implemented controls, and the gaps that passing tests do not close, are in [security.md](security.md). In short: Argon2id passwords, hashed session tokens, CSRF headers, an explicit CORS list, membership checks, Zod validation, Helmet, and log scrubbing of PostgreSQL URLs. Rate limiting does not cover booking or chat. There has been no separate penetration test. Passing this suite does not mean the application is safe to expose on the public internet.

## 9. Reproducing the workflow

Prerequisites: Node.js 22.12 or newer and npm 11 or newer. Docker is required only when using `npm run db:up`.

```powershell
npm install
Copy-Item apps\api\.env.example apps\api\.env
Copy-Item apps\web\.env.example apps\web\.env
npm run db:up
npm run db:deploy
npm run db:seed
npm run dev
```

Open `http://127.0.0.1:5173`. Use the same host in `VITE_API_BASE_URL`. The demo password is `DemoCareflow!2026`. Ali Subhan (`ali.subhan@harbor-light.example`) is the clinic administrator. Hamza Qureshi is staff. Fatima Noor is a patient. The clinic slug is `harbor-light`.

Automated checks:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm test` does not need Docker. `npm run test:e2e` starts its own database, the API on port 4010, and the web app on port 5174.

## 10. Demonstration checklist

No screenshots were saved in this run. Playwright checked these paths and rejected horizontal overflow wider than one pixel.

- Landing, sign-in, and registration at 320, 390, 768, and 1280 pixels.
- A new patient registers at `harbor-light`, reaches `Hello, E2E Patient`, and sends a chat message. With no provider key the alert says the assistant is not configured and offers the form. The page does not say the visit is booked.
- That patient books a follow-up from the form, sees `Your visit is booked`, reschedules it, cancels it, signs out, signs in, and still sees the cancelled visit.
- Hamza Qureshi signs in and sees the clinic desk, including the Today region, without horizontal overflow.

Manual pass with a seeded database:

1. Sign in as Fatima and confirm the October visits on the home page come from the API.
2. Sign in as Hamza and confirm Ali's visits are absent from Hamza's desk.
3. Open a patient account and confirm `/clinic` says the desk is for staff.
