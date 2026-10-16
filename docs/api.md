# API

The API listens on port `4000` by default. Routes are mounted under `/api`. The Express app is created in `apps/api/src/app.ts` and started from `apps/api/src/server.ts`.

Base URL for local development: `http://127.0.0.1:4000`

## GET /api/health

Liveness. This does not contact PostgreSQL.

```json
{
  "status": "ok",
  "service": "careflow-api",
  "timestamp": "2026-10-14T12:00:00.000Z"
}
```

`200` means the process can serve HTTP. Unexpected query parameters return `400`.

## GET /api/health/ready

Readiness. The handler asks the database probe to run `SELECT 1`.

Database reachable:

```json
{
  "status": "ok",
  "database": "up",
  "timestamp": "2026-10-14T12:00:00.000Z"
}
```

Database unreachable:

```json
{
  "status": "unavailable",
  "database": "down",
  "timestamp": "2026-10-14T12:00:00.000Z"
}
```

The unreachable case uses HTTP `503`. The body is the readiness contract, not a stack trace.

## GET /api/ready

Same readiness check and response as `GET /api/health/ready`. Both paths stay available.

## Authentication

Sessions are opaque tokens stored as SHA-256 digests in `auth_sessions`. The browser receives the raw token only in the `careflow_session` cookie: `HttpOnly`, `Path=/`, and a 12-hour `Max-Age`. Local development uses `SameSite=Lax`. Production uses `SameSite=None`, `Partitioned`, and `Secure`, because a split site and API on `onrender.com` are cross-site. The cookie is host-only. Use one host, such as `127.0.0.1`, for both the web app and the API in local development.

Responses never include `passwordHash`, `tokenHash`, or the raw session token. Login, signup, and `GET /api/auth/me` return:

```json
{
  "user": {
    "id": "00000000-0000-4000-8000-000000000001",
    "email": "ali.subhan@harbor-light.example",
    "displayName": "Ali Subhan",
    "memberships": [
      {
        "businessId": "00000000-0000-4000-8000-000000000002",
        "businessName": "Harbor Light Family Clinic",
        "businessSlug": "harbor-light",
        "role": "owner"
      }
    ]
  },
  "csrfToken": "base64url-hmac"
}
```

The database role `owner` is the clinic administrator. Public signup always creates a `patient` membership.

Every non-safe `/api` request must send `X-CareFlow-Request: 1`. Logout, and any later cookie-authenticated mutation, must also send `X-CSRF-Token` equal to the `csrfToken` from the latest session response. That token is an HMAC of the session token and is not a second cookie.

Login and signup replace any presented session with a new one.

| Method | Path                           | Success | Notes                                                           |
| ------ | ------------------------------ | ------- | --------------------------------------------------------------- |
| POST   | `/api/auth/signup`             | 201     | Patient membership at an existing clinic slug                   |
| POST   | `/api/auth/login`              | 200     | Sets a new session cookie                                       |
| POST   | `/api/auth/logout`             | 204     | Requires the session cookie and `X-CSRF-Token`, then revokes it |
| GET    | `/api/auth/me`                 | 200     | Current user and a fresh CSRF token                             |
| GET    | `/api/clinics/:clinicId`       | 200     | Any member of that clinic                                       |
| GET    | `/api/clinics/:clinicId/staff` | 200     | `staff` or `owner`                                              |
| GET    | `/api/clinics/:clinicId/admin` | 200     | `owner` only                                                    |

Signup and login are limited to 10 attempts per 15 minutes per client address, counted separately. A limited response is `429` with `Retry-After`. The API does not trust `X-Forwarded-For`.

## Who is signed in, and who is allowed

`401` means the request has no usable session. A missing cookie, a revoked session, and an expired session all return the same body: `UNAUTHENTICATED` / `Sign in to continue.` The cookie is cleared when the presented session is no longer active.

`403` means a session is valid and the user still may not do that. The wrong clinic role, and a clinic the user does not belong to, return `FORBIDDEN` / `You do not have permission to do that.` A non-member asking for an unknown clinic id gets that same `403`, so the response does not reveal whether the clinic exists. A malformed clinic id is `400`.

Login uses one message for an unknown email and a wrong password: `401` `AUTHENTICATION_FAILED` / `The email or password is incorrect.`

| Status | Code                     | When                                           |
| ------ | ------------------------ | ---------------------------------------------- |
| 400    | `VALIDATION_ERROR`       | Zod rejected the body or parameters            |
| 400    | `UNKNOWN_CLINIC`         | Signup named a clinic slug that does not exist |
| 401    | `UNAUTHENTICATED`        | No active session                              |
| 401    | `AUTHENTICATION_FAILED`  | Email or password did not match                |
| 403    | `CSRF_REJECTED`          | Missing browser header or CSRF token           |
| 403    | `FORBIDDEN`              | Signed in, without permission for this clinic  |
| 409    | `ACCOUNT_EXISTS`         | Signup email is already registered             |
| 429    | `RATE_LIMITED`           | Too many signup or login attempts              |
| 409    | `SLOT_TAKEN`             | The chosen time overlaps an active visit       |
| 409    | `SLOT_UNAVAILABLE`       | The time is outside hours, time off, or notice |
| 409    | `NOT_ELIGIBLE`           | The visit can no longer be changed             |
| 409    | `IDEMPOTENCY_MISMATCH`   | The key was already used for a different visit |
| 409    | `SERVICE_EXISTS`         | That clinic already has this service name      |
| 400    | `OUTSIDE_BOOKING_WINDOW` | The date is outside the booking horizon        |

## Errors

Handled failures use one JSON shape:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "No route matches GET /missing."
  }
}
```

| Status | Code               | When                          |
| ------ | ------------------ | ----------------------------- |
| 400    | `VALIDATION_ERROR` | Request validation failed     |
| 400    | `INVALID_JSON`     | Body is not JSON              |
| 401    | `UNAUTHENTICATED`  | No active session             |
| 403    | `FORBIDDEN`        | Signed in, without permission |
| 404    | `NOT_FOUND`        | No matching route             |
| 500    | `INTERNAL_ERROR`   | Unexpected failure            |

In production, unexpected errors return the message `Something went wrong.` The server log records the method, path, and status. Connection strings are scrubbed before logging.

## CORS

`CORS_ORIGIN` is a comma-separated list of absolute frontend origins. `http://127.0.0.1:5173` and `http://localhost:5173` are both listed in the example because browsers treat them as different origins. A `*` wildcard is rejected at startup. Requests from other origins do not receive `Access-Control-Allow-Origin`. Credentialed requests are allowed only for those origins. Allowed request headers include `Content-Type`, `Accept`, `X-CareFlow-Request`, `X-CSRF-Token`, and `Idempotency-Key`.

## Configuration

| Variable             | Required | Purpose                                                                                                             |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | yes      | PostgreSQL connection string                                                                                        |
| `CORS_ORIGIN`        | yes      | Allowed browser origins                                                                                             |
| `CSRF_SECRET`        | yes      | HMAC key for CSRF tokens, 32+ characters                                                                            |
| `PORT`               | no       | HTTP port, default `4000`                                                                                           |
| `NODE_ENV`           | no       | `development`, `test`, or `production`                                                                              |
| `LOG_LEVEL`          | no       | `debug`, `info`, `warn`, or `error`                                                                                 |
| `PG_POOL_MAX`        | no       | Positive integer pool size. The local PGlite socket used for tests needs `1` because it serves one query at a time. |
| `MISTRAL_API_KEY`    | no       | Mistral key for the scheduling assistant. The API starts without it.                                                |
| `MISTRAL_MODEL`      | no       | Model name, default `mistral-small-latest`                                                                          |
| `MISTRAL_TIMEOUT_MS` | no       | Provider timeout, default `20000`                                                                                   |

Missing or invalid required values stop the process before it listens. The validation error names the variable and does not print the database URL.

## Booking

Availability is calculated from the service duration, weekly hours, time off, existing `requested` and `confirmed` appointments, the clinic IANA timezone, and these rules in `apps/api/src/modules/scheduling/rules.ts`:

- Slot starts are every 15 minutes.
- A slot must fit inside one weekly window.
- The start must be at least 60 minutes from now.
- The date must be from the clinic's today through 60 days ahead.

A day is `closed` when time off or a missing window removes every candidate before appointments are applied. If appointments alone fill the day, `closed` is false and `slots` is empty. `2026-02-31` is `400` `VALIDATION_ERROR`. A real date outside the horizon is `400` `OUTSIDE_BOOKING_WINDOW`.

A patient creates a visit with the browser headers `X-CareFlow-Request: 1` and `X-CSRF-Token`, plus an optional `Idempotency-Key`:

```http
POST /api/clinics/11111111-1111-4111-8111-111111111111/appointments
Content-Type: application/json

{"serviceId":"33333333-3333-4333-8333-333333333332","staffUserId":"22222222-2222-4222-8222-222222222222","startsAt":"2026-10-22T14:00:00.000Z"}
```

A committed booking returns `201`:

```json
{
  "appointment": {
    "id": "55555555-5555-4555-8555-555555555555",
    "status": "confirmed",
    "startsAt": "2026-10-22T14:00:00.000Z"
  },
  "replayed": false
}
```

The live response includes the clinic, service, and staff fields from the appointment schema. It does not include a password hash, session token, or idempotency key. The same key and the same body later return `200` with `replayed: true`.

Creating or rescheduling a visit runs in one transaction. The transaction locks the staff user row with `SELECT id FROM users WHERE id = $1 FOR UPDATE`, reloads that day's hours, busy visits, and time off, and accepts the start only if it is still an open slot. The GiST exclusion `appointments_no_active_staff_overlap` is the backstop for a race the lock did not cover. An overlapping active visit returns `409` `SLOT_TAKEN` / `That time was just booked. Choose another.` A start outside the rebuilt slots returns `409` `SLOT_UNAVAILABLE`. Reschedule cancels the original row and inserts the new row in that same transaction. If the insert fails, the transaction rolls back and the original visit stays as it was.

`Idempotency-Key` on create is optional. When present it must match `^[A-Za-z0-9_-]{8,80}$`. The same patient, key, clinic, service, staff member, and start returns the original appointment with `replayed: true` and HTTP `200`. The same key with a different payload returns `409` `IDEMPOTENCY_MISMATCH`. A missing key still books.

Patients can cancel or reschedule only their own future `requested` or `confirmed` visits. Staff and the clinic administrator at that clinic can read any visit there. A patient from another clinic who knows the id receives `403`. An unknown id is `404`. A staff member can read and edit only their own schedule and hours. The administrator can read and edit any practitioner at that clinic.

| Method | Path                                                         | Who                                     | Success                                           |
| ------ | ------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------- |
| GET    | `/api/clinics/:clinicId/services`                            | member                                  | 200. Patients see active services. Staff see all. |
| POST   | `/api/clinics/:clinicId/services`                            | staff or owner                          | 201 `{ service }`                                 |
| PATCH  | `/api/clinics/:clinicId/services/:serviceId`                 | staff or owner                          | 200 `{ service }`                                 |
| GET    | `/api/clinics/:clinicId/staff-members`                       | member                                  | 200 `{ staff }`                                   |
| GET    | `/api/clinics/:clinicId/slots?serviceId&date&staffUserId`    | member                                  | 200 `{ date, timezone, closed, slots }`           |
| POST   | `/api/clinics/:clinicId/appointments`                        | patient                                 | 201, or 200 when the idempotency key replays      |
| GET    | `/api/appointments`                                          | signed in                               | 200, that patient's visits, `startsAt` ascending  |
| GET    | `/api/appointments/:appointmentId`                           | patient owner, or staff at that clinic  | 200 `{ appointment }`                             |
| POST   | `/api/appointments/:appointmentId/cancel`                    | same, and the visit is still changeable | 200 `{ appointment }`                             |
| POST   | `/api/appointments/:appointmentId/reschedule`                | same                                    | 200 `{ appointment }`                             |
| GET    | `/api/clinics/:clinicId/staff/:staffUserId/schedule?from&to` | that staff member, or the owner         | 200                                               |
| GET    | `/api/clinics/:clinicId/staff/:staffUserId/availability`     | that staff member, or the owner         | 200                                               |
| PUT    | `/api/clinics/:clinicId/staff/:staffUserId/availability`     | that staff member, or the owner         | 204                                               |
| POST   | `/api/clinics/:clinicId/staff/:staffUserId/time-off`         | that staff member, or the owner         | 201 `{ id }`                                      |
| DELETE | `/api/clinics/:clinicId/time-off/:timeOffId`                 | that staff member, or the owner         | 204                                               |

Appointment JSON includes the clinic, service, staff, status, and instants. It does not include `passwordHash`, the session token, or `idempotencyKey`. Mutations use the CSRF headers described above. The browser shows a booked visit only after this response says the transaction committed.

## Scheduling assistant

The browser never calls Mistral. `POST /api/assistant/sessions/:sessionId/messages` stores the patient message, sends a bounded history to Mistral, and validates the JSON with a strict Zod schema. Extra keys, SQL, or tool fields are rejected. The model cannot create an appointment. Slot search, cancellation, and rescheduling go through the booking service, and only after the patient sends `POST /api/assistant/sessions/:sessionId/slots` and then `POST .../confirm` with `{ "confirmed": true }`.

A missing key, timeout, rate limit, or invalid model reply is stored as assistant text with `outcome` `unavailable` or `invalid_output`. The visit count does not change. Logs record purpose, model, latency, token counts, and an error code. They do not record the message, the prompt, or the API key.

Possible emergencies get a direction to emergency care and are not booked. The assistant does not diagnose.

`chat_sessions.workflow_state` keeps the phase (`collecting`, `awaiting_slot`, `awaiting_confirmation`, and the cancel and reschedule equivalents). A correction replaces one preference and keeps the others. The model sees at most the latest 12 user and assistant messages. The client polls `GET /api/assistant/sessions/:sessionId` about every four seconds.

| Method | Path                                          | Who                    | Success                            |
| ------ | --------------------------------------------- | ---------------------- | ---------------------------------- |
| GET    | `/api/clinics/:clinicId/assistant/sessions`   | patient at that clinic | 200 `{ sessions }`                 |
| POST   | `/api/clinics/:clinicId/assistant/sessions`   | patient                | 201 conversation                   |
| GET    | `/api/assistant/sessions/:sessionId`          | that patient           | 200 conversation                   |
| POST   | `/api/assistant/sessions/:sessionId/messages` | that patient           | 200, including slots or a question |
| POST   | `/api/assistant/sessions/:sessionId/slots`    | that patient           | 200 review, no new visit           |
| POST   | `/api/assistant/sessions/:sessionId/confirm`  | that patient           | 200 with the saved appointment     |

Another patient, or a staff member opening the patient routes, receives `403`. A missing conversation is `404`. Confirming before a slot is chosen is `409` `CONFIRMATION_REQUIRED`. A slot that was not offered is `409` `SLOT_UNAVAILABLE`.
