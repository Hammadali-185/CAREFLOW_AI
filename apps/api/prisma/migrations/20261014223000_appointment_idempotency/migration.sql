-- Optional client key so a repeated booking create returns the original row.
-- PostgreSQL unique indexes treat NULL as distinct, so bookings without a key are unaffected.

ALTER TABLE "appointments" ADD COLUMN "idempotency_key" TEXT;

CREATE UNIQUE INDEX "appointments_patient_idempotency_key" ON "appointments"("patient_user_id", "idempotency_key");
