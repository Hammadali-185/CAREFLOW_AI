# Security

## Secrets stay on the server

`apps/web/.env.example` contains only `VITE_API_BASE_URL`. Vite exposes variables prefixed with `VITE_` to the browser, so database credentials, `CSRF_SECRET`, and AI provider keys must never be added there. A unit test reads the example file and fails if those names appear.

The API reads `DATABASE_URL`, `CSRF_SECRET`, and the optional `MISTRAL_API_KEY` in Node only. Startup validation rejects a non-PostgreSQL URL and a CSRF secret shorter than 32 characters without echoing the values. Logs replace `postgresql://...` connection strings with `postgresql://[redacted]`. Request logs record method, path, status, and duration. Assistant logs record model, latency, token counts, and an error code. They do not record bodies, cookies, passwords, tokens, prompts, or message text.

Real `.env` files, keys, and credential dumps are gitignored. The committed examples use the local Docker username and password `careflow`. Replace those before any shared or deployed environment.

## Passwords and sessions

Passwords are hashed with Argon2id (`memoryCost` 19456 KiB, `timeCost` 2, `parallelism` 1). The API stores only the hash. Login compares with Argon2id and, when the email is unknown, still runs a verify against a fixed dummy hash so the two failures take a similar amount of work. Both failures return the same `401` body.

A session is 32 random bytes, encoded as base64url. PostgreSQL stores the SHA-256 hex digest in `auth_sessions.token_hash`. The browser receives the raw token in the `careflow_session` cookie:

- `HttpOnly`
- `SameSite=Lax`
- `Path=/`
- `Max-Age` of 12 hours
- `Secure` when `NODE_ENV` is `production`

There is no `Domain` attribute, so the cookie is host-only. `127.0.0.1` and `localhost` do not share it. Open the web app and the API on the same host.

`GET /api/auth/me` accepts a session only when `revoked_at` is null and `expires_at` is still in the future. Logout sets `revoked_at`. An expired, revoked, or unknown cookie is cleared and answered with `401`. Login and signup revoke a presented session and issue a new token, so a session id from before authentication cannot be kept.

## CSRF and CORS

Cookie authentication needs a CSRF check on state-changing requests. Every non-safe `/api` method requires `X-CareFlow-Request: 1`. Browsers will not add that header on a cross-site form post without a CORS preflight, and the API allows the header only for origins in `CORS_ORIGIN`.

Authenticated mutations, including logout and booking changes, also require `X-CSRF-Token`. The value is `HMAC-SHA256` of the raw session token, keyed with `CSRF_SECRET`, compared in constant time. Login, signup, and `GET /api/auth/me` return it in JSON. It is not placed in a cookie, because script on the web origin cannot read an HTTP-only cookie set by the API origin. The web client keeps the token in memory and sends it on those mutations. Booking creation may also send `Idempotency-Key`.

CORS uses an explicit origin list, `credentials: true`, and no wildcard. A credentialed request from an unlisted origin is rejected.

## Unauthenticated and forbidden

Hiding a React route is not an access control. Every protected API route checks the session and, where a clinic is involved, the membership role.

- `401 UNAUTHENTICATED` — the cookie is missing, expired, or revoked. The message is `Sign in to continue.`
- `403 FORBIDDEN` — the session is valid, and this user does not have the required role at that clinic. The message is `You do not have permission to do that.` A clinic id that is not one of the user's memberships uses this same response.

`GET /api/clinics/:clinicId` allows `patient`, `staff`, and `owner`. `GET /api/clinics/:clinicId/staff` allows `staff` and `owner`. `GET /api/clinics/:clinicId/admin` allows `owner` only. In the product, `owner` is the clinic administrator. Signup cannot choose a role. It creates a patient membership.

Signup and login are rate-limited separately to 10 requests per 15 minutes per client address. The limiter uses the socket address. `trust proxy` is off, so `X-Forwarded-For` is ignored.

## Browser access

Helmet sets baseline response headers, including `X-Content-Type-Options: nosniff`. The JSON parser accepts at most 100 KB. The web client sends `credentials: 'include'` and the two headers above. A `401` from a later mutation clears the in-memory session and asks the person to sign in again. A `401` from login, signup, or the current-user check does not do that.

## Errors

Request handlers return a small error object. Production responses for unexpected failures use a generic message. Validation errors describe the request. The readiness check catches database failures and returns `database: "down"`. It does not forward the driver error to the browser.

## Local database

Docker publishes PostgreSQL on port `5432` with a well-known development password. That is acceptable only on a trusted local machine. Do not expose that port or reuse that password outside local development.

## Limits of these controls

Passing the tests in this repository does not prove the application is safe to deploy. The controls above are what the code does today. These gaps remain:

- Login and signup are limited to 10 attempts per 15 minutes per socket address, in memory, in one process. A restart clears the counters. Booking, chat, and other routes are not rate-limited. `trust proxy` is off, so a reverse proxy must be configured before the socket address is treated as the client.
- The session cookie is `Secure` only when `NODE_ENV` is `production`. Local HTTP development would drop a `Secure` cookie.
- Helmet supplies baseline headers. There is no application-specific Content-Security-Policy beyond Helmet's defaults, and there is no separate audit of third-party script supply.
- Authorization is enforced in services by membership and ownership checks. A guessed appointment id returns `403` or `404`. That is not a substitute for a penetration test.
- The assistant rejects model output that fails the intent schema, and it books only through the booking transaction after confirmation. The model can still produce misleading questions. Those questions are not shown; the API writes the reply from catalog data. The emergency check is a phrase list, not clinical triage.
- Logs scrub PostgreSQL URLs. They do not have a general secret scanner. A future log field that copies a request body would leak data.
- `apps/api/.env.example` contains the local Docker password and a placeholder CSRF secret. Those values are not production secrets, and they must be replaced before any shared environment.
