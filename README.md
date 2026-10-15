# CareFlow AI

CareFlow AI is a mobile-friendly clinic app for appointment booking. Sign-in creates a session. Patients book from a form or ask the scheduling assistant. A visit is saved only after they confirm a real open time.

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

## Project map

```text
apps/web            React, Vite, Tailwind, React Router
apps/api            Express, Zod, Prisma
packages/shared     Shared response schemas
database            SQL schema and seed for review
tests               Playwright, fixtures, and notes
docs                Architecture, database, API, security, decisions
```

Further detail is in [docs/architecture.md](docs/architecture.md), [docs/database.md](docs/database.md), [docs/api.md](docs/api.md), [docs/security.md](docs/security.md), and [docs/decisions.md](docs/decisions.md). The assessment record is [docs/assessment.md](docs/assessment.md).

## Current limits

Included now: registration, login, logout, server-side sessions, role checks for patient, staff, and clinic administrator (`owner`), appointment booking, the clinic desk, and a scheduling assistant that calls Mistral from the API.

Not included: notifications. The assistant starts without `MISTRAL_API_KEY` and points patients to the booking form. The browser never receives the provider key.
