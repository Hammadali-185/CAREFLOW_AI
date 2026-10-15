-- Fictional CareFlow demo data. Safe to run more than once.
-- There is no real patient information in this file.
--
-- Demo clinic: Harbor Light Family Clinic (America/New_York)
-- Every demo account uses the same password: DemoCareflow!2026
-- The database stores only this Argon2id hash (memory 19456 KiB, time 2, parallelism 1):
--   $argon2id$v=19$m=19456,p=1,t=2$ZTqawhdarmYR60yMsP679A$SI5bmMCG56gePMlU12P6F9CxIRG/AoIaoj1HJPcS5SY
--
-- Ali Subhan, owner:    ali.subhan@harbor-light.example
-- Hamza Qureshi, staff: hamza.qureshi@harbor-light.example
-- Fatima Noor, patient: fatima.noor@patient.example
--
-- A demo server session for Ali stores the SHA-256 digest of "demo-session-harbor-light".
-- The raw token is not inserted.

BEGIN;

INSERT INTO "schema_meta" ("id", "version")
VALUES (1, '2.0.0')
ON CONFLICT ("id") DO UPDATE
SET "version" = EXCLUDED."version";

INSERT INTO "businesses" ("id", "name", "slug", "timezone", "created_at", "updated_at")
VALUES (
  '11111111-1111-4111-8111-111111111111',
  'Harbor Light Family Clinic',
  'harbor-light',
  'America/New_York',
  '2026-08-01 12:00:00+00',
  '2026-08-01 12:00:00+00'
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "users" ("id", "email", "password_hash", "display_name", "created_at", "updated_at")
VALUES
  (
    '22222222-2222-4222-8222-222222222221',
    'ali.subhan@harbor-light.example',
    '$argon2id$v=19$m=19456,p=1,t=2$ZTqawhdarmYR60yMsP679A$SI5bmMCG56gePMlU12P6F9CxIRG/AoIaoj1HJPcS5SY',
    'Ali Subhan',
    '2026-08-01 12:00:00+00',
    '2026-08-01 12:00:00+00'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'hamza.qureshi@harbor-light.example',
    '$argon2id$v=19$m=19456,p=1,t=2$ZTqawhdarmYR60yMsP679A$SI5bmMCG56gePMlU12P6F9CxIRG/AoIaoj1HJPcS5SY',
    'Hamza Qureshi',
    '2026-08-01 12:00:00+00',
    '2026-08-01 12:00:00+00'
  ),
  (
    '22222222-2222-4222-8222-222222222223',
    'fatima.noor@patient.example',
    '$argon2id$v=19$m=19456,p=1,t=2$ZTqawhdarmYR60yMsP679A$SI5bmMCG56gePMlU12P6F9CxIRG/AoIaoj1HJPcS5SY',
    'Fatima Noor',
    '2026-08-01 12:00:00+00',
    '2026-08-01 12:00:00+00'
  )
ON CONFLICT ("id") DO UPDATE
SET
  "email" = EXCLUDED."email",
  "display_name" = EXCLUDED."display_name",
  "updated_at" = EXCLUDED."updated_at";

INSERT INTO "business_memberships" ("business_id", "user_id", "role", "created_at")
VALUES
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', 'owner', '2026-08-01 12:00:00+00'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'staff', '2026-08-01 12:00:00+00'),
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222223', 'patient', '2026-08-01 12:00:00+00')
ON CONFLICT ("business_id", "user_id") DO NOTHING;

INSERT INTO "services" ("id", "business_id", "name", "duration_minutes", "created_at", "updated_at")
VALUES
  ('33333333-3333-4333-8333-333333333331', '11111111-1111-4111-8111-111111111111', 'New patient visit', 45, '2026-08-01 12:00:00+00', '2026-08-01 12:00:00+00'),
  ('33333333-3333-4333-8333-333333333332', '11111111-1111-4111-8111-111111111111', 'Follow-up visit', 20, '2026-08-01 12:00:00+00', '2026-08-01 12:00:00+00'),
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Annual physical', 40, '2026-08-01 12:00:00+00', '2026-08-01 12:00:00+00')
ON CONFLICT ("id") DO NOTHING;

-- Ali Subhan, Monday-Thursday, 09:00-12:00 and 13:00-17:00 local time.
INSERT INTO "staff_availability" ("id", "business_id", "staff_user_id", "staff_role", "weekday", "starts_minute", "ends_minute")
VALUES
  ('99999999-9999-4999-8999-999999999901', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', 'owner', 1, 540, 720),
  ('99999999-9999-4999-8999-999999999902', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', 'owner', 1, 780, 1020),
  ('99999999-9999-4999-8999-999999999903', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', 'owner', 2, 540, 720),
  ('99999999-9999-4999-8999-999999999904', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', 'owner', 2, 780, 1020),
  ('99999999-9999-4999-8999-999999999905', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', 'owner', 3, 540, 720),
  ('99999999-9999-4999-8999-999999999906', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', 'owner', 3, 780, 1020),
  ('99999999-9999-4999-8999-999999999907', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', 'owner', 4, 540, 720),
  ('99999999-9999-4999-8999-999999999908', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222221', 'owner', 4, 780, 1020),
  ('99999999-9999-4999-8999-999999999909', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'staff', 2, 600, 1080),
  ('99999999-9999-4999-8999-999999999910', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'staff', 3, 600, 1080),
  ('99999999-9999-4999-8999-999999999911', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'staff', 4, 600, 1080),
  ('99999999-9999-4999-8999-999999999912', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'staff', 5, 600, 1080),
  ('99999999-9999-4999-8999-999999999913', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'staff', 6, 600, 1080)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "staff_time_off" ("id", "business_id", "staff_user_id", "staff_role", "starts_at", "ends_at", "reason")
VALUES (
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'staff',
  '2026-11-26 00:00:00-05',
  '2026-11-27 00:00:00-05',
  'Clinic holiday'
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "appointments" (
  "id",
  "business_id",
  "patient_user_id",
  "patient_role",
  "staff_user_id",
  "staff_role",
  "service_id",
  "status",
  "starts_at",
  "ends_at",
  "cancelled_at",
  "rescheduled_from_appointment_id",
  "created_at",
  "updated_at"
)
VALUES
  (
    '44444444-4444-4444-8444-444444444441',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222223',
    'patient',
    '22222222-2222-4222-8222-222222222221',
    'owner',
    '33333333-3333-4333-8333-333333333331',
    'completed',
    '2026-09-15 09:00:00-04',
    '2026-09-15 09:45:00-04',
    NULL,
    NULL,
    '2026-09-01 15:00:00+00',
    '2026-09-15 13:45:00+00'
  ),
  (
    '44444444-4444-4444-8444-444444444442',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222223',
    'patient',
    '22222222-2222-4222-8222-222222222222',
    'staff',
    '33333333-3333-4333-8333-333333333332',
    'cancelled',
    '2026-09-22 10:00:00-04',
    '2026-09-22 10:20:00-04',
    '2026-09-20 16:00:00-04',
    NULL,
    '2026-09-10 15:00:00+00',
    '2026-09-20 20:00:00+00'
  )
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "appointments" (
  "id",
  "business_id",
  "patient_user_id",
  "patient_role",
  "staff_user_id",
  "staff_role",
  "service_id",
  "status",
  "starts_at",
  "ends_at",
  "cancelled_at",
  "rescheduled_from_appointment_id",
  "created_at",
  "updated_at"
)
VALUES
  (
    '44444444-4444-4444-8444-444444444443',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222223',
    'patient',
    '22222222-2222-4222-8222-222222222221',
    'owner',
    '33333333-3333-4333-8333-333333333333',
    'confirmed',
    '2026-10-20 14:00:00-04',
    '2026-10-20 14:40:00-04',
    NULL,
    NULL,
    '2026-10-01 15:00:00+00',
    '2026-10-01 15:00:00+00'
  ),
  (
    '44444444-4444-4444-8444-444444444444',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222223',
    'patient',
    '22222222-2222-4222-8222-222222222222',
    'staff',
    '33333333-3333-4333-8333-333333333332',
    'requested',
    '2026-10-21 11:00:00-04',
    '2026-10-21 11:20:00-04',
    NULL,
    '44444444-4444-4444-8444-444444444442',
    '2026-09-20 20:05:00+00',
    '2026-09-20 20:05:00+00'
  )
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "chat_sessions" (
  "id",
  "business_id",
  "participant_user_id",
  "appointment_id",
  "opened_at",
  "created_at",
  "updated_at"
)
VALUES (
  '55555555-5555-4555-8555-555555555551',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222223',
  '44444444-4444-4444-8444-444444444443',
  '2026-10-14 15:00:00-04',
  '2026-10-14 15:00:00-04',
  '2026-10-14 15:00:00-04'
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "chat_messages" ("id", "business_id", "session_id", "sender_kind", "sender_user_id", "body", "created_at")
VALUES
  (
    '55555555-5555-4555-8555-555555555561',
    '11111111-1111-4111-8111-111111111111',
    '55555555-5555-4555-8555-555555555551',
    'user',
    '22222222-2222-4222-8222-222222222223',
    'Is the October 20 physical still with Dr. Subhan?',
    '2026-10-14 15:00:00-04'
  ),
  (
    '55555555-5555-4555-8555-555555555562',
    '11111111-1111-4111-8111-111111111111',
    '55555555-5555-4555-8555-555555555551',
    'assistant',
    NULL,
    'Yes. It is confirmed for October 20 at 2:00 PM Eastern.',
    '2026-10-14 15:00:05-04'
  ),
  (
    '55555555-5555-4555-8555-555555555563',
    '11111111-1111-4111-8111-111111111111',
    '55555555-5555-4555-8555-555555555551',
    'user',
    '22222222-2222-4222-8222-222222222223',
    'Thank you.',
    '2026-10-14 15:00:20-04'
  )
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "auth_sessions" ("id", "user_id", "token_hash", "expires_at", "created_at")
VALUES (
  '66666666-6666-4666-8666-666666666661',
  '22222222-2222-4222-8222-222222222221',
  'e0d1d95e35b43ddb34b8f1dcc5e9d3c43e6ad6e7a4a935b161b88c6aa818487c',
  '2027-01-01 00:00:00+00',
  '2026-10-01 12:00:00+00'
)
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "audit_events" ("id", "business_id", "actor_user_id", "action", "entity_type", "entity_id", "metadata", "created_at")
VALUES
  (
    '77777777-7777-4777-8777-777777777771',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222221',
    'appointment_completed',
    'appointment',
    '44444444-4444-4444-8444-444444444441',
    '{"status":"completed"}',
    '2026-09-15 13:45:00+00'
  ),
  (
    '77777777-7777-4777-8777-777777777772',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'appointment_cancelled',
    'appointment',
    '44444444-4444-4444-8444-444444444442',
    '{"status":"cancelled"}',
    '2026-09-20 20:00:00+00'
  ),
  (
    '77777777-7777-4777-8777-777777777773',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    'appointment_rescheduled',
    'appointment',
    '44444444-4444-4444-8444-444444444444',
    '{"from":"2026-09-22T14:00:00Z","to":"2026-10-21T15:00:00Z"}',
    '2026-09-20 20:05:00+00'
  ),
  (
    '77777777-7777-4777-8777-777777777774',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222221',
    'staff_availability_changed',
    'staff_availability',
    '99999999-9999-4999-8999-999999999901',
    '{"weekday":1,"startsMinute":540,"endsMinute":720}',
    '2026-08-01 12:00:00+00'
  )
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "ai_interactions" (
  "id",
  "business_id",
  "actor_user_id",
  "chat_session_id",
  "purpose",
  "model",
  "prompt_tokens",
  "completion_tokens",
  "latency_ms",
  "status",
  "created_at"
)
VALUES (
  '88888888-8888-4888-8888-888888888881',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222223',
  '55555555-5555-4555-8555-555555555551',
  'appointment_status',
  'careflow-demo',
  120,
  40,
  180,
  'succeeded',
  '2026-10-14 15:00:06-04'
)
ON CONFLICT ("id") DO NOTHING;

UPDATE "chat_messages"
SET "body" = 'Is the October 20 physical still with Dr. Subhan?'
WHERE "id" = '55555555-5555-4555-8555-555555555561';

COMMIT;
