# Tests

Unit and API tests live next to the code they cover:

- `apps/api/tests` checks booking rules, availability, authentication, authorization, validation, appointments, chat, database constraints, and environment failure.
- `apps/web/src` component tests use Vitest and jsdom.

`tests/e2e` is Playwright. It starts a temporary database, the API on port 4010, and the web app on port 5174. Specs cover signup, sign-in, manual booking, the assistant fallback, cancellation, rescheduling, and phone through desktop viewports.

`tests/fixtures` holds public demo identifiers used by those flows. It does not contain passwords, password hashes, or provider keys.

Run everything from the repository root:

```powershell
npm test
npm run test:e2e
```
