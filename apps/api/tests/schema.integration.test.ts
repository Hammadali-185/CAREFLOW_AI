import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const initSql = readFileSync(
  resolve(repoRoot, 'apps/api/prisma/migrations/20261014120000_init/migration.sql'),
  'utf8',
);
const domainSql = readFileSync(
  resolve(repoRoot, 'apps/api/prisma/migrations/20261014210000_domain_model/migration.sql'),
  'utf8',
);
const bookingSql = readFileSync(
  resolve(
    repoRoot,
    'apps/api/prisma/migrations/20261014223000_appointment_idempotency/migration.sql',
  ),
  'utf8',
);
const workflowSql = readFileSync(
  resolve(repoRoot, 'apps/api/prisma/migrations/20261015010000_chat_workflow_state/migration.sql'),
  'utf8',
);
const schemaSql = readFileSync(resolve(repoRoot, 'database/schema.sql'), 'utf8');
const seedSql = readFileSync(resolve(repoRoot, 'database/seed.sql'), 'utf8');

const passwordHash = 'scrypt$test-hash-not-a-secret-value';

const clinicA = '10000000-0000-4000-8000-0000000000a1';
const clinicB = '10000000-0000-4000-8000-0000000000b2';
const patientA = '20000000-0000-4000-8000-0000000000a1';
const patientB = '20000000-0000-4000-8000-0000000000b2';
const staffA = '20000000-0000-4000-8000-0000000000a2';
const staffB = '20000000-0000-4000-8000-0000000000a3';
const serviceA = '30000000-0000-4000-8000-0000000000a1';
const serviceB = '30000000-0000-4000-8000-0000000000b2';

type SqlError = {
  code?: string;
  constraint?: string;
};

function readSqlError(error: unknown): SqlError {
  if (typeof error !== 'object' || error === null) {
    return {};
  }
  const record = error as { code?: unknown; constraint?: unknown };
  return {
    code: typeof record.code === 'string' ? record.code : undefined,
    constraint: typeof record.constraint === 'string' ? record.constraint : undefined,
  };
}

async function expectSqlState(run: () => Promise<unknown>, code: string, constraint?: string) {
  try {
    await run();
  } catch (error) {
    const sqlError = readSqlError(error);
    expect(sqlError.code).toBe(code);
    if (constraint) {
      expect(sqlError.constraint).toBe(constraint);
    }
    return;
  }
  throw new Error(`Expected SQLSTATE ${code}`);
}

async function openDatabase() {
  return new PGlite({ extensions: { btree_gist } });
}

async function applyMigrations(db: PGlite) {
  await db.exec(initSql);
  await db.exec(domainSql);
  await db.exec(bookingSql);
  await db.exec(workflowSql);
}

async function catalog(db: PGlite) {
  const columns = await db.query<{ signature: string }>(`
    SELECT table_name || '.' || column_name || ':' || udt_name || ':' || COALESCE(datetime_precision::text, '') || ':' || is_nullable AS signature
    FROM information_schema.columns
    WHERE table_schema = 'public'
    ORDER BY table_name, ordinal_position
  `);
  const constraints = await db.query<{ signature: string }>(`
    SELECT conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) AS signature
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
    ORDER BY 1
  `);
  const indexes = await db.query<{ signature: string }>(`
    SELECT indexdef AS signature
    FROM pg_indexes
    WHERE schemaname = 'public'
    ORDER BY indexname
  `);
  const triggers = await db.query<{ signature: string }>(`
    SELECT pg_get_triggerdef(oid) AS signature
    FROM pg_trigger
    WHERE NOT tgisinternal
      AND tgrelid IN (SELECT oid FROM pg_class WHERE relnamespace = 'public'::regnamespace)
    ORDER BY 1
  `);
  const functions = await db.query<{ signature: string }>(`
    SELECT pg_get_functiondef(p.oid) AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    ORDER BY p.proname
  `);
  return {
    columns: columns.rows.map((row) => row.signature),
    constraints: constraints.rows.map((row) => row.signature),
    indexes: indexes.rows.map((row) => row.signature),
    triggers: triggers.rows.map((row) => row.signature),
    functions: functions.rows.map((row) => row.signature),
  };
}

async function installFixture(db: PGlite) {
  await db.query(
    `INSERT INTO businesses (id, name, slug, timezone)
     VALUES ($1, 'North Clinic', 'north-clinic', 'America/New_York'),
            ($2, 'South Clinic', 'south-clinic', 'America/Chicago')`,
    [clinicA, clinicB],
  );
  await db.query(
    `INSERT INTO users (id, email, password_hash, display_name)
     VALUES ($1, 'patient.a@north.example', $5, 'Patient A'),
            ($2, 'patient.b@south.example', $5, 'Patient B'),
            ($3, 'staff.a@north.example', $5, 'Staff A'),
            ($4, 'staff.b@north.example', $5, 'Staff B')`,
    [patientA, patientB, staffA, staffB, passwordHash],
  );
  await db.query(
    `INSERT INTO business_memberships (business_id, user_id, role)
     VALUES ($1, $3, 'patient'),
            ($2, $4, 'patient'),
            ($1, $5, 'staff'),
            ($2, $5, 'staff'),
            ($1, $6, 'staff')`,
    [clinicA, clinicB, patientA, patientB, staffA, staffB],
  );
  await db.query(
    `INSERT INTO services (id, business_id, name, duration_minutes)
     VALUES ($1, $2, 'Consultation', 30),
            ($3, $4, 'Consultation', 30)`,
    [serviceA, clinicA, serviceB, clinicB],
  );
}

type Booking = {
  businessId?: string;
  patientId?: string;
  staffId?: string | null;
  staffRole?: string | null;
  serviceId?: string;
  status?: string;
  startsAt: string;
  endsAt: string;
  cancelledAt?: string | null;
  rescheduledFrom?: string | null;
};

async function book(db: PGlite, row: Booking) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO appointments (
       id, business_id, patient_user_id, patient_role, staff_user_id, staff_role,
       service_id, status, starts_at, ends_at, cancelled_at, rescheduled_from_appointment_id
     )
     VALUES ($1, $2, $3, 'patient', $4, $5, $6, $7::appointment_status, $8::timestamptz, $9::timestamptz, $10::timestamptz, $11)`,
    [
      id,
      row.businessId ?? clinicA,
      row.patientId ?? patientA,
      row.staffId === undefined ? staffA : row.staffId,
      row.staffRole === undefined ? 'staff' : row.staffRole,
      row.serviceId ?? serviceA,
      row.status ?? 'confirmed',
      row.startsAt,
      row.endsAt,
      row.cancelledAt ?? null,
      row.rescheduledFrom ?? null,
    ],
  );
  return id;
}

describe('migrated schema', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await openDatabase();
    await applyMigrations(db);
    await installFixture(db);
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates the assessment tables and stores timestamps with time zones', async () => {
    const tables = await db.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('users', 'appointments', 'chat_sessions')
      ORDER BY table_name
    `);
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'appointments',
      'chat_sessions',
      'users',
    ]);

    const timestamps = await db.query<{ udt_name: string }>(`
      SELECT DISTINCT udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND column_name IN ('created_at', 'starts_at', 'opened_at')
    `);
    expect(timestamps.rows.map((row) => row.udt_name)).toEqual(['timestamptz']);
  });

  it('stores a password hash and rejects a second casing of the same email', async () => {
    const columns = await db.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
    `);
    const names = columns.rows.map((row) => row.column_name);
    expect(names).toContain('password_hash');
    expect(names).not.toContain('password');

    await expectSqlState(
      () =>
        db.query(
          `INSERT INTO users (email, password_hash, display_name)
           VALUES ('Patient.A@north.example', $1, 'Duplicate')`,
          [passwordHash],
        ),
      '23514',
      'users_email_lowercase_chk',
    );
    await expectSqlState(
      () =>
        db.query(
          `INSERT INTO users (email, password_hash, display_name)
           VALUES ('patient.a@north.example', $1, 'Duplicate')`,
          [passwordHash],
        ),
      '23505',
    );
  });

  it('rejects an appointment that points at another clinic service, patient, or staff member', async () => {
    await expectSqlState(
      () =>
        book(db, {
          serviceId: serviceB,
          startsAt: '2026-05-04 09:00:00-04',
          endsAt: '2026-05-04 09:30:00-04',
        }),
      '23503',
      'appointments_service_business_fkey',
    );
    await expectSqlState(
      () =>
        book(db, {
          patientId: patientB,
          startsAt: '2026-05-04 10:00:00-04',
          endsAt: '2026-05-04 10:30:00-04',
        }),
      '23503',
      'appointments_patient_membership_fkey',
    );
    await expectSqlState(
      () =>
        book(db, {
          businessId: clinicB,
          patientId: patientB,
          serviceId: serviceB,
          staffId: staffB,
          startsAt: '2026-05-04 11:00:00-05',
          endsAt: '2026-05-04 11:30:00-05',
        }),
      '23503',
      'appointments_staff_membership_fkey',
    );
  });

  it('rejects overlapping active appointments for one staff member, including across clinics', async () => {
    await book(db, {
      startsAt: '2026-06-01 09:00:00-04',
      endsAt: '2026-06-01 09:45:00-04',
    });
    await expectSqlState(
      () =>
        book(db, {
          startsAt: '2026-06-01 09:30:00-04',
          endsAt: '2026-06-01 10:00:00-04',
          status: 'requested',
        }),
      '23P01',
      'appointments_no_active_staff_overlap',
    );
    await expectSqlState(
      () =>
        book(db, {
          businessId: clinicB,
          patientId: patientB,
          serviceId: serviceB,
          startsAt: '2026-06-01 09:15:00-04',
          endsAt: '2026-06-01 09:30:00-04',
        }),
      '23P01',
      'appointments_no_active_staff_overlap',
    );
  });

  it('allows a different staff member, a cancelled overlap, and a back-to-back booking', async () => {
    await book(db, {
      staffId: staffB,
      startsAt: '2026-06-01 09:00:00-04',
      endsAt: '2026-06-01 09:45:00-04',
    });
    await book(db, {
      startsAt: '2026-06-02 09:00:00-04',
      endsAt: '2026-06-02 09:30:00-04',
      status: 'cancelled',
      cancelledAt: '2026-06-01 12:00:00-04',
    });
    await book(db, {
      startsAt: '2026-06-02 09:00:00-04',
      endsAt: '2026-06-02 09:30:00-04',
    });
    await book(db, {
      startsAt: '2026-06-03 09:00:00-04',
      endsAt: '2026-06-03 09:30:00-04',
    });
    await book(db, {
      startsAt: '2026-06-03 09:30:00-04',
      endsAt: '2026-06-03 10:00:00-04',
    });
  });

  it('lets a cancelled booking be replaced without leaving two active rows', async () => {
    const original = await book(db, {
      startsAt: '2026-07-01 13:00:00-04',
      endsAt: '2026-07-01 13:30:00-04',
    });
    await book(db, {
      startsAt: '2026-07-01 14:00:00-04',
      endsAt: '2026-07-01 14:30:00-04',
    });
    await expectSqlState(
      () =>
        db.query(
          `UPDATE appointments
           SET starts_at = '2026-07-01 14:00:00-04', ends_at = '2026-07-01 14:30:00-04'
           WHERE id = $1`,
          [original],
        ),
      '23P01',
      'appointments_no_active_staff_overlap',
    );
    await db.query(
      `UPDATE appointments
       SET status = 'cancelled', cancelled_at = '2026-06-20 12:00:00-04'
       WHERE id = $1`,
      [original],
    );
    const replacement = await book(db, {
      startsAt: '2026-07-01 13:00:00-04',
      endsAt: '2026-07-01 13:30:00-04',
      rescheduledFrom: original,
    });
    const active = await db.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM appointments
       WHERE staff_user_id = $1
         AND status IN ('requested', 'confirmed')
         AND tstzrange(starts_at, ends_at, '[)') && tstzrange('2026-07-01 13:00:00-04', '2026-07-01 13:30:00-04', '[)')`,
      [staffA],
    );
    expect(active.rows[0]?.count).toBe('1');
    expect(replacement).toBeTruthy();
  });

  it('rejects a chat message attached to another clinic session', async () => {
    const session = await db.query<{ id: string }>(
      `INSERT INTO chat_sessions (business_id, participant_user_id)
       VALUES ($1, $2)
       RETURNING id`,
      [clinicA, patientA],
    );
    const sessionId = session.rows[0]?.id;
    expect(sessionId).toBeTruthy();
    await expectSqlState(
      () =>
        db.query(
          `INSERT INTO chat_messages (business_id, session_id, sender_kind, body)
           VALUES ($1, $2, 'assistant', 'Hello')`,
          [clinicB, sessionId],
        ),
      '23503',
      'chat_messages_session_business_fkey',
    );
  });

  it('keeps prompt text out of AI interaction metadata', async () => {
    const columns = await db.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ai_interactions'
    `);
    const names = columns.rows.map((row) => row.column_name);
    expect(names).not.toContain('prompt');
    expect(names).not.toContain('completion');
    expect(names).not.toContain('body');
  });

  it('rejects an unknown IANA timezone', async () => {
    await expectSqlState(
      () =>
        db.query(
          `INSERT INTO businesses (name, slug, timezone)
           VALUES ('Bad Zone Clinic', 'bad-zone', 'Not/AZone')`,
        ),
      '23514',
    );
  });

  it('rejects overlapping weekly availability and allows the next window to start immediately', async () => {
    await db.query(
      `INSERT INTO staff_availability (business_id, staff_user_id, staff_role, weekday, starts_minute, ends_minute)
       VALUES ($1, $2, 'staff', 1, 540, 720)`,
      [clinicA, staffB],
    );
    await expectSqlState(
      () =>
        db.query(
          `INSERT INTO staff_availability (business_id, staff_user_id, staff_role, weekday, starts_minute, ends_minute)
           VALUES ($1, $2, 'staff', 1, 600, 780)`,
          [clinicA, staffB],
        ),
      '23P01',
      'staff_availability_no_overlap',
    );
    await db.query(
      `INSERT INTO staff_availability (business_id, staff_user_id, staff_role, weekday, starts_minute, ends_minute)
       VALUES ($1, $2, 'staff', 1, 720, 780)`,
      [clinicA, staffB],
    );
  });
});

describe('review schema and seed', () => {
  it('matches the migrated catalog', async () => {
    const migrated = await openDatabase();
    const reviewed = await openDatabase();
    try {
      await applyMigrations(migrated);
      await reviewed.exec(schemaSql);
      expect(await catalog(reviewed)).toEqual(await catalog(migrated));
    } finally {
      await migrated.close();
      await reviewed.close();
    }
  }, 30_000);

  it('loads the fictional demo clinic twice without duplicating bookings', async () => {
    const db = await openDatabase();
    try {
      await applyMigrations(db);
      await db.exec(seedSql);
      await db.exec(seedSql);
      const counts = await db.query<{ table_name: string; count: string }>(`
        SELECT 'users' AS table_name, count(*)::text AS count FROM users
        UNION ALL SELECT 'appointments', count(*)::text FROM appointments
        UNION ALL SELECT 'chat_sessions', count(*)::text FROM chat_sessions
        UNION ALL SELECT 'chat_messages', count(*)::text FROM chat_messages
        UNION ALL SELECT 'services', count(*)::text FROM services
        UNION ALL SELECT 'staff_availability', count(*)::text FROM staff_availability
      `);
      const byTable = Object.fromEntries(counts.rows.map((row) => [row.table_name, row.count]));
      expect(byTable).toEqual({
        users: '3',
        appointments: '4',
        chat_sessions: '1',
        chat_messages: '3',
        services: '3',
        staff_availability: '13',
      });

      const version = await db.query<{ version: string }>(
        `SELECT version FROM schema_meta WHERE id = 1`,
      );
      expect(version.rows[0]?.version).toBe('2.0.0');

      const plaintext = await db.query<{ found: boolean }>(
        `SELECT bool_or(password_hash LIKE '%DemoCareflow!2026%') AS found FROM users`,
      );
      expect(plaintext.rows[0]?.found).toBe(false);

      const activeOverlap = await db.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM appointments a
        JOIN appointments b
          ON a.staff_user_id = b.staff_user_id
         AND a.id < b.id
         AND a.status IN ('requested', 'confirmed')
         AND b.status IN ('requested', 'confirmed')
         AND tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)')
      `);
      expect(activeOverlap.rows[0]?.count).toBe('0');
    } finally {
      await db.close();
    }
  }, 30_000);
});
