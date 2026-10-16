# CareFlow AI

CareFlow AI is a mobile-friendly clinic app for appointment booking. Sign-in creates a session. Patients book from a form or ask the scheduling assistant. A visit is saved only after they confirm a real open time.

- [Run it locally](#install)
- [High-level architecture](#high-level-architecture)
- [Key design decisions and tradeoffs](#key-design-decisions-and-tradeoffs)
- [Assumptions and known limitations](#assumptions-and-known-limitations)

## Prerequisites

- Node.js 22.12 or newer
- npm 11 or newer
- Docker, with the Compose plugin, for PostgreSQL

## Install

From the repository root:

```powershell
npm install
Copy-Item apps\api\.env.example apps\api\.env
Copy-Item apps\web\.env.example apps\web\.env
```

```bash
npm install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

`npm install` builds `@careflow/shared` and generates the Prisma client. The example environment files contain local defaults only. Do not put database passwords or AI provider keys in `apps/web/.env`.

## Run PostgreSQL

```powershell
npm run db:up
npm run db:deploy
npm run db:seed
```

`db:up` starts PostgreSQL 16 from `docker-compose.yml`. `db:deploy` applies the committed migrations. `db:seed` records schema version `2.0.0` and the Harbor Light demo clinic. The API still starts if the database is down; `GET /api/ready` then reports the database as down.

Stop the container with `npm run db:down`. Follow logs with `npm run db:logs`.

## Run the applications

Start both processes:

```powershell
npm run dev
```

Or start them separately:

```powershell
npm run dev:api
npm run dev:web
```

- Web: http://127.0.0.1:5173
- API: http://127.0.0.1:4000
- Liveness: http://127.0.0.1:4000/api/health
- Readiness: http://127.0.0.1:4000/api/ready

The landing page calls liveness and readiness and shows the result. `127.0.0.1` and `localhost` are different browser origins, so the API example allows both frontend origins. Use the same host in the browser address bar and in `VITE_API_BASE_URL` so the session cookie is sent. The demo password for the seeded accounts is `DemoCareflow!2026`. Ali Subhan (`ali.subhan@harbor-light.example`) is the clinic administrator. Registration joins an existing clinic as a patient; the demo slug is `harbor-light`.

## Scripts

| Command                     | Purpose                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`               | Shared build, then API and web together                                         |
| `npm run dev:web`           | Vite only                                                                       |
| `npm run dev:api`           | API only, after building shared contracts                                       |
| `npm run build`             | Compile shared, API, and web                                                    |
| `npm run lint`              | ESLint and Prettier check                                                       |
| `npm run format`            | Prettier write                                                                  |
| `npm run typecheck`         | Generate the Prisma client and type-check every package                         |
| `npm test`                  | Unit and API tests. Docker is not required                                      |
| `npm run test:e2e`          | Playwright. Starts its own database, API on port 4010, and web app on port 5174 |
| `npm run db:up` / `db:down` | Start or stop PostgreSQL                                                        |
| `npm run db:generate`       | Generate the Prisma client                                                      |
| `npm run db:deploy`         | Apply committed migrations                                                      |
| `npm run db:migrate`        | Create or apply migrations during schema work                                   |
| `npm run db:seed`           | Load the fictional Harbor Light demo clinic                                     |
| `npm run db:studio`         | Open Prisma Studio                                                              |

Before the first Playwright run, install a browser:

```powershell
npx playwright install chromium
```

`npm run test:e2e` does not use Docker or the app already running on ports 4000 and 5173. It applies the migrations and `database/seed.sql` to a temporary database, starts the API on `http://127.0.0.1:4010` with no AI provider key, and starts the web app on `http://127.0.0.1:5174`. The browser checks run at 320, 390, 768, and 1280 pixels wide, one at a time.

## Environment

API (`apps/api/.env`):

| Variable       | Role                                                                |
| -------------- | ------------------------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string. Required.                             |
| `CORS_ORIGIN`  | Comma-separated frontend origins. Required. Wildcards are rejected. |
| `CSRF_SECRET`  | HMAC key for CSRF tokens. Required. At least 32 characters.         |
| `PORT`         | API port. Defaults to `4000`.                                       |
| `NODE_ENV`     | `development`, `test`, or `production`.                             |
| `LOG_LEVEL`    | `debug`, `info`, `warn`, or `error`.                                |

Web (`apps/web/.env`):

| Variable            | Role                                                      |
| ------------------- | --------------------------------------------------------- |
| `VITE_API_BASE_URL` | Absolute API origin, for example `http://127.0.0.1:4000`. |

The web app stops on a configuration screen when that URL is missing. The API exits before listening when required variables are missing or invalid.

Optional assistant settings in `apps/api/.env`:

| Variable             | Role                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `MISTRAL_API_KEY`    | Provider key. Leave it unset to run the API without the model. The browser never receives it. |
| `MISTRAL_MODEL`      | Model name. The example default is `mistral-small-latest`.                                    |
| `MISTRAL_TIMEOUT_MS` | Request timeout in milliseconds. The example default is `20000`. Maximum accepted is `60000`. |

## High-level architecture

CareFlow AI is one npm workspace with three parts:

```text
apps/web            React screens, forms, and server state
apps/api            Express HTTP API, validation, sessions, and PostgreSQL
packages/shared     Zod contracts both sides parse
database            Review copy of the schema, plus the demo seed
```

A browser action calls `apps/web/src/lib/api-client.ts`. The API mounts health, auth, clinic, scheduling, and assistant routes under `/api`. Controllers call services. Services call repositories. Only `apps/api/src/server.ts` opens a port and constructs the Prisma client. Tests import `apps/api/src/app.ts` and do not listen.

Signed-in routes are `/dashboard`, `/account`, `/assistant`, `/book`, `/visits`, and `/clinic`. Public signup creates a patient membership. Staff and the clinic administrator (`owner`) use the clinic desk. Patients use the dashboard, the booking form, and the assistant.

The assistant calls Mistral from the API. Greetings and emergency phrases are handled before the model. Any other reply must match the shared intent schema. Searching slots and saving a visit go through the same scheduling service as the form. The screen says a visit is booked only after that service returns the saved row.

PostgreSQL is the system of record. Prisma Migrate applies `apps/api/prisma/migrations`. `database/schema.sql` is the same end state for review and for the catalog test. `npm run db:seed` runs `database/seed.sql`.

Directory detail is in [docs/architecture.md](docs/architecture.md). HTTP routes are in [docs/api.md](docs/api.md). Tables and constraints are in [docs/database.md](docs/database.md).

## Key design decisions and tradeoffs

The full record is [docs/decisions.md](docs/decisions.md). The choices that affect how the app behaves:

- **One API process and one web app.** Booking, accounts, and the assistant share one Express process. A slow model call holds that request until it finishes or times out. There is no worker or queue.
- **The database rejects overlapping active visits.** An exclusion constraint blocks two `requested` or `confirmed` visits for the same staff member. The booking transaction also locks the staff row. Reschedule cancels the old row and inserts the new one in that transaction. Back-to-back visits are allowed because ranges are half-open.
- **Hand-written SQL sits beside Prisma.** Composite tenant foreign keys, checks, triggers, and the exclusion constraint are in the migrations. `prisma migrate diff` wants to drop those foreign keys. That diff is not applied.
- **The model cannot write appointments.** Mistral returns an intent. The API writes the patient-facing sentence from clinic data and calls the booking service only after the patient confirms a real slot.
- **Sessions are HTTP-only cookies.** The database stores a SHA-256 digest. The cookie is host-only and `SameSite=Lax`. `Secure` is added when `NODE_ENV` is `production`. State-changing `/api` requests need `X-CareFlow-Request: 1`. Authenticated mutations also need `X-CSRF-Token`.
- **Idempotency is optional.** A valid `Idempotency-Key` replays the same booking. A request without that header can create another visit when the times do not overlap.

## Assumptions and known limitations

Assumptions the local app and tests rely on:

- Node.js 22.12 or newer and npm 11 or newer.
- PostgreSQL accepts the connection string in `DATABASE_URL`. Docker Compose provides PostgreSQL 16. Automated tests use PGlite and do not start Docker.
- Registration needs an existing clinic slug. The seeded slug is `harbor-light`.
- The browser and the API are opened on the same host, such as `127.0.0.1`, so the host-only session cookie is sent.
- `CSRF_SECRET` is at least 32 characters. The example file has a local placeholder. Replace it before any shared environment.
- Demo accounts use the password `DemoCareflow!2026`. Ali Subhan is the clinic administrator, Hamza Qureshi is staff, and Fatima Noor is a patient.

Known limitations:

- Notifications are not implemented.
- There is no HTTP action to mark a visit completed or as a no-show. Those statuses exist on the appointment enum and do not block staff time.
- Login and signup are limited to 10 attempts per 15 minutes per socket address, in memory, in one process. A restart clears the counters. Booking and chat are not rate-limited.
- The emergency check is a phrase list, not clinical triage.
- A missing `MISTRAL_API_KEY`, a timeout, a rate limit, or an intent that fails the schema leaves appointments unchanged and points the patient to the booking form.
- Passing the tests in this repository is not a penetration test. Controls and remaining gaps are in [docs/security.md](docs/security.md).
- The dated verification notes in [docs/assessment.md](docs/assessment.md) and [docs/implementation-audit.md](docs/implementation-audit.md) describe one machine on 15 October 2026. They are not the current deploy procedure.

## Project map

```text
apps/web            React, Vite, Tailwind, React Router
apps/api            Express, Zod, Prisma
packages/shared     Shared response schemas
database            SQL schema and seed for review
tests               Playwright, a public id list, and notes
docs                Architecture, database, API, security, decisions
```
