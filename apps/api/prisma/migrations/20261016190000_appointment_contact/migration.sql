-- Contact details collected for a visit (assistant or booking form). Nullable for rows created before this change.
ALTER TABLE "appointments" ADD COLUMN "patient_contact_name" TEXT;
ALTER TABLE "appointments" ADD COLUMN "patient_phone" TEXT;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_contact_name_chk" CHECK (
  "patient_contact_name" IS NULL
  OR char_length(btrim("patient_contact_name")) BETWEEN 1 AND 120
);

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_phone_chk" CHECK (
  "patient_phone" IS NULL
  OR char_length(btrim("patient_phone")) BETWEEN 7 AND 32
);
