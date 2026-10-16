-- CareFlow AI schema for review and for loading an empty PostgreSQL database.
-- This is the end state of the Prisma migrations, including constraints Prisma cannot model.
-- Do not run this script on a database that Prisma Migrate already manages.
-- Use prisma migrate deploy for that database, then database/seed.sql.

-- CreateTable
CREATE TABLE "schema_meta" (
    "id" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "applied_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schema_meta_pkey" PRIMARY KEY ("id")
);

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "membership_role" AS ENUM ('owner', 'staff', 'patient');

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('requested', 'confirmed', 'cancelled', 'completed', 'no_show');

-- CreateEnum
CREATE TYPE "chat_sender_kind" AS ENUM ('user', 'assistant', 'system');

-- CreateEnum
CREATE TYPE "audit_action" AS ENUM ('appointment_created', 'appointment_confirmed', 'appointment_cancelled', 'appointment_rescheduled', 'appointment_completed', 'appointment_no_show', 'staff_availability_changed', 'membership_changed');

-- CreateEnum
CREATE TYPE "ai_interaction_status" AS ENUM ('succeeded', 'failed', 'refused');

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_memberships" (
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "membership_role" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_memberships_pkey" PRIMARY KEY ("business_id","user_id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_availability" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "staff_role" "membership_role" NOT NULL,
    "weekday" INTEGER NOT NULL,
    "starts_minute" INTEGER NOT NULL,
    "ends_minute" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_time_off" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "staff_role" "membership_role" NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_time_off_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "patient_user_id" UUID NOT NULL,
    "patient_role" "membership_role" NOT NULL DEFAULT 'patient',
    "staff_user_id" UUID,
    "staff_role" "membership_role",
    "service_id" UUID NOT NULL,
    "status" "appointment_status" NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "rescheduled_from_appointment_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT,
    "patient_contact_name" TEXT,
    "patient_phone" TEXT,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "participant_user_id" UUID NOT NULL,
    "appointment_id" UUID,
    "opened_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workflow_state" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "sender_kind" "chat_sender_kind" NOT NULL,
    "sender_user_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" "audit_action" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_interactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "chat_session_id" UUID,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL,
    "completion_tokens" INTEGER NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "status" "ai_interaction_status" NOT NULL,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_interactions_pkey" PRIMARY KEY ("id")
);

-- Supports: open a clinic from its public slug.
CREATE UNIQUE INDEX "businesses_slug_key" ON "businesses"("slug");

-- Supports: sign in by email. Emails are stored lowercase, so this index is case-insensitive in practice.
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- Supports: list the clinics a user belongs to. The primary key already looks up membership by clinic.
CREATE INDEX "business_memberships_user_id_idx" ON "business_memberships"("user_id");

-- Foreign-key target for role-pinned references. Not a second lookup path.
CREATE UNIQUE INDEX "business_memberships_business_user_role_key" ON "business_memberships"("business_id", "user_id", "role");

-- Foreign-key target so an appointment can reference a service only inside its own clinic.
CREATE UNIQUE INDEX "services_business_id_id_key" ON "services"("business_id", "id");

-- Supports: list or find services offered by one clinic.
CREATE UNIQUE INDEX "services_business_id_name_key" ON "services"("business_id", "name");

-- Supports: load one staff member's weekly rules at one clinic.
CREATE INDEX "staff_availability_lookup_idx" ON "staff_availability"("business_id", "staff_user_id", "weekday");

-- Supports: list time off for a staff member in start-time order.
CREATE INDEX "staff_time_off_staff_idx" ON "staff_time_off"("staff_user_id", "starts_at");

-- Supports: a patient's appointment history, newest first.
CREATE INDEX "appointments_patient_history_idx" ON "appointments"("patient_user_id", "starts_at" DESC);

-- Supports: a staff member's schedule across a time range. The GiST exclusion index is not this listing index.
CREATE INDEX "appointments_staff_schedule_idx" ON "appointments"("staff_user_id", "starts_at");

-- Supports: a clinic calendar ordered by start time.
CREATE INDEX "appointments_clinic_calendar_idx" ON "appointments"("business_id", "starts_at");

-- Foreign-key target so chat sessions and reschedules stay inside the same clinic.
CREATE UNIQUE INDEX "appointments_business_id_id_key" ON "appointments"("business_id", "id");

CREATE UNIQUE INDEX "appointments_patient_idempotency_key" ON "appointments"("patient_user_id", "idempotency_key");

-- Supports: recent chats for a clinic.
CREATE INDEX "chat_sessions_clinic_recent_idx" ON "chat_sessions"("business_id", "opened_at" DESC);

-- Supports: chats for one person, newest first.
CREATE INDEX "chat_sessions_participant_idx" ON "chat_sessions"("participant_user_id", "opened_at" DESC);

-- Foreign-key target so messages and AI metadata stay inside the session's clinic.
CREATE UNIQUE INDEX "chat_sessions_business_id_id_key" ON "chat_sessions"("business_id", "id");

-- Supports: messages in a session in chronological order.
CREATE INDEX "chat_messages_session_chronology_idx" ON "chat_messages"("session_id", "created_at");

-- Supports: resolve a server session from the token digest. The raw token is not stored.
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");

-- Supports: list sessions for a user.
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

-- Supports: audit history for one appointment or staff record.
CREATE INDEX "audit_events_entity_idx" ON "audit_events"("business_id", "entity_type", "entity_id", "created_at");

-- Supports: AI metadata for a clinic over time, without reading conversation text.
CREATE INDEX "ai_interactions_business_idx" ON "ai_interactions"("business_id", "created_at");

-- Supports: AI metadata attached to one chat session.
CREATE INDEX "ai_interactions_session_idx" ON "ai_interactions"("chat_session_id", "created_at");

-- AddForeignKey
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_user_id_fkey" FOREIGN KEY ("patient_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduled_from_appointment_id_fkey" FOREIGN KEY ("rescheduled_from_appointment_id") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_participant_user_id_fkey" FOREIGN KEY ("participant_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_chat_session_id_fkey" FOREIGN KEY ("chat_session_id") REFERENCES "chat_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Database-enforced integrity

ALTER TABLE "businesses" ADD CONSTRAINT "businesses_name_chk" CHECK (char_length(btrim("name")) BETWEEN 1 AND 160);
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_slug_chk" CHECK ("slug" = lower("slug") AND "slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

ALTER TABLE "users" ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email") AND "email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
ALTER TABLE "users" ADD CONSTRAINT "users_password_hash_chk" CHECK (char_length("password_hash") >= 20);
ALTER TABLE "users" ADD CONSTRAINT "users_display_name_chk" CHECK (char_length(btrim("display_name")) BETWEEN 1 AND 120);

ALTER TABLE "services" ADD CONSTRAINT "services_name_chk" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120);
ALTER TABLE "services" ADD CONSTRAINT "services_duration_chk" CHECK ("duration_minutes" BETWEEN 5 AND 480);

-- weekday uses ISO numbering: Monday = 1, Sunday = 7. Minutes are local civil time in the clinic timezone.
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_weekday_chk" CHECK ("weekday" BETWEEN 1 AND 7);
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_minutes_chk" CHECK ("starts_minute" >= 0 AND "ends_minute" <= 1440 AND "starts_minute" < "ends_minute");
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_role_chk" CHECK ("staff_role" IN ('owner', 'staff'));

ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_range_chk" CHECK ("ends_at" > "starts_at");
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_role_chk" CHECK ("staff_role" IN ('owner', 'staff'));

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_range_chk" CHECK ("ends_at" > "starts_at");
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_at_chk" CHECK (("status" = 'cancelled') = ("cancelled_at" IS NOT NULL));
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_contact_name_chk" CHECK (
  "patient_contact_name" IS NULL
  OR char_length(btrim("patient_contact_name")) BETWEEN 1 AND 120
);
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_phone_chk" CHECK (
  "patient_phone" IS NULL
  OR char_length(btrim("patient_phone")) BETWEEN 7 AND 32
);
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_role_chk" CHECK ("patient_role" = 'patient');
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staff_pair_chk" CHECK (("staff_user_id" IS NULL) = ("staff_role" IS NULL));
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staff_role_chk" CHECK ("staff_role" IS NULL OR "staff_role" IN ('owner', 'staff'));
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_distinct_participants_chk" CHECK ("patient_user_id" IS DISTINCT FROM "staff_user_id");
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_reschedule_chk" CHECK ("rescheduled_from_appointment_id" IS DISTINCT FROM "id");

ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_closed_at_chk" CHECK ("closed_at" IS NULL OR "closed_at" >= "opened_at");
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_workflow_object_chk" CHECK (jsonb_typeof("workflow_state") = 'object');
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_workflow_secrets_chk" CHECK (NOT ("workflow_state" ?| ARRAY['password', 'password_hash', 'token', 'token_hash', 'prompt', 'completion']));

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_chk" CHECK (("sender_kind" = 'user' AND "sender_user_id" IS NOT NULL) OR ("sender_kind" IN ('assistant', 'system') AND "sender_user_id" IS NULL));
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_body_chk" CHECK (char_length("body") BETWEEN 1 AND 4000);

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_expiry_chk" CHECK ("expires_at" > "created_at");
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_revoked_chk" CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at");
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_token_hash_chk" CHECK (char_length("token_hash") >= 32);

ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_entity_type_chk" CHECK ("entity_type" IN ('appointment', 'staff_availability', 'staff_time_off', 'business_membership'));
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_metadata_chk" CHECK (NOT ("metadata" ?| ARRAY['password', 'password_hash', 'body', 'prompt', 'completion', 'message', 'token', 'token_hash']));

ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_counts_chk" CHECK ("prompt_tokens" >= 0 AND "completion_tokens" >= 0 AND "latency_ms" >= 0);
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_error_chk" CHECK (("status" = 'succeeded' AND "error_code" IS NULL) OR ("status" = 'failed' AND "error_code" IS NOT NULL) OR ("status" = 'refused'));
ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_purpose_chk" CHECK (char_length("purpose") BETWEEN 1 AND 80 AND char_length("model") BETWEEN 1 AND 120);

-- Composite foreign keys keep clinic references inside one business.
-- Nullable pairs use MATCH SIMPLE: the check is skipped only when a nullable column is null.

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_membership_fkey" FOREIGN KEY ("business_id", "patient_user_id", "patient_role") REFERENCES "business_memberships"("business_id", "user_id", "role") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staff_membership_fkey" FOREIGN KEY ("business_id", "staff_user_id", "staff_role") REFERENCES "business_memberships"("business_id", "user_id", "role") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_business_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_reschedule_business_fkey" FOREIGN KEY ("business_id", "rescheduled_from_appointment_id") REFERENCES "appointments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Availability and time off follow the membership. Appointment foreign keys still block membership deletion while bookings exist.
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_membership_fkey" FOREIGN KEY ("business_id", "staff_user_id", "staff_role") REFERENCES "business_memberships"("business_id", "user_id", "role") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_membership_fkey" FOREIGN KEY ("business_id", "staff_user_id", "staff_role") REFERENCES "business_memberships"("business_id", "user_id", "role") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_participant_membership_fkey" FOREIGN KEY ("business_id", "participant_user_id") REFERENCES "business_memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_appointment_business_fkey" FOREIGN KEY ("business_id", "appointment_id") REFERENCES "appointments"("business_id", "id") ON DELETE SET NULL ("appointment_id") ON UPDATE CASCADE;

ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_session_business_fkey" FOREIGN KEY ("business_id", "session_id") REFERENCES "chat_sessions"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_membership_fkey" FOREIGN KEY ("business_id", "sender_user_id") REFERENCES "business_memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ai_interactions" ADD CONSTRAINT "ai_interactions_session_business_fkey" FOREIGN KEY ("business_id", "chat_session_id") REFERENCES "chat_sessions"("business_id", "id") ON DELETE SET NULL ("chat_session_id") ON UPDATE CASCADE;

-- Active bookings for one staff member cannot overlap. Cancelled, completed, and no_show rows are excluded.
-- The range is half-open, so an appointment that starts when another ends is allowed.
-- The predicate is the person, not the clinic: one staff member cannot be booked at two clinics at once.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_active_staff_overlap" EXCLUDE USING gist ("staff_user_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&) WHERE ("status" IN ('requested', 'confirmed') AND "staff_user_id" IS NOT NULL);

-- Weekly windows for the same person at the same clinic cannot overlap. Back-to-back windows are allowed.
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_no_overlap" EXCLUDE USING gist ("business_id" WITH =, "staff_user_id" WITH =, "weekday" WITH =, int4range("starts_minute", "ends_minute", '[)') WITH &&);

-- Time off for the same person at the same clinic cannot overlap.
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_no_overlap" EXCLUDE USING gist ("business_id" WITH =, "staff_user_id" WITH =, tstzrange("starts_at", "ends_at", '[)') WITH &&);

CREATE FUNCTION "careflow_assert_iana_timezone"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE name = NEW.timezone
  ) THEN
    RAISE EXCEPTION 'Invalid IANA timezone: %', NEW.timezone
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "businesses_assert_iana_timezone"
BEFORE INSERT OR UPDATE OF "timezone" ON "businesses"
FOR EACH ROW
EXECUTE FUNCTION "careflow_assert_iana_timezone"();

CREATE FUNCTION "careflow_set_updated_at"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "businesses_set_updated_at"
BEFORE UPDATE ON "businesses"
FOR EACH ROW
EXECUTE FUNCTION "careflow_set_updated_at"();

CREATE TRIGGER "users_set_updated_at"
BEFORE UPDATE ON "users"
FOR EACH ROW
EXECUTE FUNCTION "careflow_set_updated_at"();

CREATE TRIGGER "services_set_updated_at"
BEFORE UPDATE ON "services"
FOR EACH ROW
EXECUTE FUNCTION "careflow_set_updated_at"();

CREATE TRIGGER "appointments_set_updated_at"
BEFORE UPDATE ON "appointments"
FOR EACH ROW
EXECUTE FUNCTION "careflow_set_updated_at"();

CREATE TRIGGER "chat_sessions_set_updated_at"
BEFORE UPDATE ON "chat_sessions"
FOR EACH ROW
EXECUTE FUNCTION "careflow_set_updated_at"();

COMMENT ON TABLE "users" IS 'Accounts. Email is unique and stored lowercase. password_hash is the only credential column.';
COMMENT ON TABLE "appointments" IS 'Bookings. Requested and confirmed rows for one staff member cannot overlap.';
COMMENT ON TABLE "chat_sessions" IS 'Conversations scoped to one clinic and one member.';
