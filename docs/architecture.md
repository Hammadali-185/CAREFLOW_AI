# Architecture

CareFlow AI is a single npm workspace with a browser app, an HTTP API, and a small shared contract package. Accounts, booking, the clinic desk, and the scheduling assistant all use this shape.

## Layout

```text
apps/web          React application
apps/api          Express API
packages/shared   Zod schemas and response types used by both sides
database          SQL schema, seed, and reviewer notes
tests             Playwright, fixtures, and test notes
docs              Architecture, database, API, security, and decisions
```

The web app owns screens, forms, and server-state. The API owns configuration, HTTP, validation, persistence, and errors. Shared code is limited to contracts both sides must agree on. There is one API process and one web process. No extra services are introduced in this phase.

## Frontend

`apps/web` is a Vite + React + TypeScript application.

| Directory                        | Responsibility                                     |
| -------------------------------- | -------------------------------------------------- |
| `src/app`                        | Router, providers, and the root layout             |
| `src/assets`                     | Static files imported by the app                   |
| `src/components/ui`              | Buttons, inputs, labels, cards, badges             |
| `src/components/layout`          | Sidebar, header, footer, and mobile navigation     |
| `src/components/feedback`        | Loading, errors, and empty states                  |
| `src/components/shared`          | Brand mark and other shared application components |
| `src/features/auth`              | Sign-in, registration, and the account page        |
| `src/features/patient-dashboard` | Patient home                                       |
| `src/features/appointments`      | Manual booking and the visit list                  |
| `src/features/chat`              | Scheduling assistant                               |
| `src/features/services`          | Clinic service catalog                             |
| `src/features/staff-dashboard`   | Clinic desk                                        |
| `src/features/landing`           | Public home page                                   |
| `src/hooks`                      | Query, document title, and API access              |
| `src/lib`                        | API client, query client, and utilities            |
| `src/styles`                     | Tailwind setup and design tokens                   |
| `src/types`                      | UI types that are not API contracts                |

React Router renders the screen tree. TanStack Query loads health and the current session. React Hook Form and Zod validate sign-in and registration, then the API client sends those requests with credentials. The session cookie is HTTP-only. Authorization is enforced on the API.

The browser reads `VITE_API_BASE_URL` at startup and refuses to render the app when it is missing or not an absolute URL. Vite aliases `@careflow/shared` to the shared TypeScript source during development.

Signed-in routes use `DashboardFrame`: a sidebar from the `lg` breakpoint up, a menu drawer below it, and a bottom shortcut bar. Public pages keep the site header and footer. Navigation items live in `src/app/navigation.ts`. Patients land on `/dashboard`. Staff and clinic administrators land on `/clinic`.

## Backend

`apps/api` keeps the Express application separate from process startup.

- `src/app.ts` builds the Express app and accepts a database probe, logger, CORS origins, and environment name. Tests import this module and do not open a port.
- `src/server.ts` loads environment variables, creates the Prisma client, and calls `listen`.

A request passes through security headers, request logging, CORS, JSON parsing, `/api` routes, the not-found handler, and the error handler. Controllers call services. The health service depends on a `DatabaseProbe` port. `PrismaHealthProbe` is the only adapter that talks to PostgreSQL, and only `server.ts` constructs it.

| Directory      | Responsibility                             |
| -------------- | ------------------------------------------ |
| `config`       | Environment parsing and safe failure       |
| `routes`       | URL mapping                                |
| `controllers`  | HTTP in and out                            |
| `services`     | Use-case decisions                         |
| `repositories` | Database access                            |
| `middleware`   | Logging, sessions, CSRF, 404, and errors   |
| `validators`   | Parse a request with a schema              |
| `schemas`      | Zod shapes for params, query, and bodies   |
| `errors`       | HTTP error types                           |
| `utils`        | Logger and secret scrubbing                |
| `modules`      | Auth cookies, slot math, and the assistant |

## Shared contracts

`packages/shared` exports the health, readiness, and error schemas. The API builds responses in that shape. The web client parses responses with the same schemas before showing them. The package compiles to `dist` for the API runtime. The web type-checker and Vite read the TypeScript source through a path alias.

## Versions chosen for compatibility

- Prisma ORM 7.10 is the latest stable release. The 8.0 line is still a release candidate, so it is not used.
- TypeScript 5.9 is the newest 5.x release accepted by `typescript-eslint` (`<6.1`). TypeScript 7 is not wired in until the lint toolchain allows it.
- The web stack is React 19, Vite 8, Tailwind CSS 4, React Router 8, TanStack Query 5, React Hook Form 7, and Zod 4.
- The API is Express 5 on Node.js 22.12 or newer.

## Current boundary

Accounts, clinic membership, appointment booking, and the scheduling assistant are implemented. The assistant calls Mistral from the API only. A model reply does not create a visit. Notifications are not implemented.
