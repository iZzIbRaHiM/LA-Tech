import pg from 'pg';
import bcrypt from 'bcryptjs';
import { sendEmail } from './email.js';

const { Pool } = pg;

// Prevent pg from converting datetime strings to JS Date objects automatically,
// preserving pure string operations matching SQLite.
// OIDs: 1114 is TIMESTAMP, 1184 is TIMESTAMPTZ, 1082 is DATE
pg.types.setTypeParser(1114, (val) => val);
pg.types.setTypeParser(1184, (val) => val);
pg.types.setTypeParser(1082, (val) => val);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('[DATABASE] DATABASE_URL environment variable is not set!');
}

export const pool = new Pool({
  connectionString,
  // On Vercel each warm lambda instance holds its own pool; several
  // concurrent instances × a big pool can exhaust the Supabase free-tier
  // pooler's client limit. Two per instance is plenty for the short
  // sequential queries these handlers run. Locally one process serves
  // everything, so a larger pool helps there.
  max: process.env.VERCEL ? 2 : 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // All "datetime now" columns are plain TEXT (SQLite-compat), so the client
  // (attendance duration math, etc.) treats every stored timestamp as UTC.
  // Force the session timezone rather than relying on the database's default
  // staying UTC forever. Set via the connection startup packet (not a
  // follow-up query on 'connect') — a fire-and-forget query fired from a
  // 'connect' listener isn't awaited by pg-pool before the client is handed
  // out, so under a burst of concurrent new connections (e.g. boot-time
  // reminder/absence-sweep jobs racing an incoming request) it could leave a
  // client mid-query when reused, corrupting that connection's protocol
  // stream — this avoids the extra query entirely.
  options: '-c TimeZone=UTC',
});

export function translateQuery(sql: string): string {
  let translated = sql;
  let isInsertOrIgnore = false;
  
  if (/INSERT OR IGNORE INTO/gi.test(translated)) {
    isInsertOrIgnore = true;
    translated = translated.replace(/INSERT OR IGNORE INTO/gi, 'INSERT INTO');
  }

  let index = 1;
  translated = translated.replace(/\?/g, () => `$${index++}`);
  
  if (isInsertOrIgnore) {
    if (translated.toUpperCase().includes('PROJECT_VISIBILITY')) {
      translated += ' ON CONFLICT (project_id, department_id) DO NOTHING';
    } else {
      translated += ' ON CONFLICT DO NOTHING';
    }
  }

  const trimmed = translated.trim().toUpperCase();
  if (trimmed.startsWith('INSERT ')) {
    // Tables with composite primary keys and no `id` column must be excluded
    // from the automatic RETURNING id.
    if (!trimmed.includes(' RETURNING ') &&
        !trimmed.includes('INTO MEMBERSHIPS') &&
        !trimmed.includes('CHAT_GROUP_MEMBERS') &&
        !trimmed.includes('MEETING_PARTICIPANTS') &&
        !trimmed.includes('SCHEDULE_ASSIGNMENTS') &&
        !translated.toUpperCase().includes('PROJECT_VISIBILITY')) {
      translated += ' RETURNING id';
    }
  }
  return translated;
}

export const db = {
  prepare(sql: string) {
    const pgSql = translateQuery(sql);
    return {
      async all(...params: any[]): Promise<any[]> {
        const res = await pool.query(pgSql, params);
        return res.rows;
      },
      async get(...params: any[]): Promise<any | undefined> {
        const res = await pool.query(pgSql, params);
        return res.rows[0];
      },
      async run(...params: any[]): Promise<{ lastInsertRowid?: number; changes: number }> {
        const res = await pool.query(pgSql, params);
        const lastInsertRowid = res.rows[0]?.id ? Number(res.rows[0].id) : undefined;
        return { lastInsertRowid, changes: res.rowCount ?? 0 };
      }
    };
  },
  async exec(sql: string): Promise<void> {
    await pool.query(sql);
  }
};

export async function seedCeo() {
  const existing = await db.prepare('SELECT id FROM users WHERE is_ceo = 1').get();
  if (existing) return;
  
  const CEO_EMAIL = process.env.CEO_EMAIL || 'ceo@latechs.org';
  const CEO_PASSWORD = process.env.CEO_PASSWORD || 'ChangeMe123!';
  
  await db
    .prepare('INSERT INTO users (name, email, password_hash, is_ceo, must_change_password) VALUES (?, ?, ?, 1, 1)')
    .run('CEO', CEO_EMAIL, bcrypt.hashSync(CEO_PASSWORD, 12));
  console.log(`[seed] CEO account created: ${CEO_EMAIL} (must-change-password enforced on first login)`);
}

export async function logActivity(
  actorId: number,
  entityType: string,
  entityId: number,
  action: string,
  metadata: Record<string, unknown> = {}
) {
  await db.prepare(
    'INSERT INTO activity_log (actor_id, entity_type, entity_id, action, metadata) VALUES (?, ?, ?, ?, ?)'
  ).run(actorId, entityType, entityId, action, JSON.stringify(metadata));
}

export async function notify(userId: number, type: string, message: string, link = '') {
  await db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)').run(
    userId,
    type,
    message,
    link
  );
  // Opportunistic retention (same pattern as login_attempts): read
  // notifications older than 30 days add nothing and the free-tier
  // database is capped at 500MB — keep the table from growing forever.
  await db
    .prepare("DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < to_char(now() - INTERVAL '30 days', 'YYYY-MM-DD HH24:MI:SS')")
    .run();

  const user = await db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined;
  if (user) {
    sendEmail(user.email, `LA Tech Portal — ${message}`, message, link);
  }
}

export async function initDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.warn('[DATABASE] Skipping initialization: DATABASE_URL not set.');
    return;
  }
  
  try {
    const client = await pool.connect();
    client.release();
    console.log('[DATABASE] Connected to PostgreSQL/Supabase database successfully.');
  } catch (err) {
    console.error('[DATABASE] Connection error:', err);
    throw err;
  }

  // Create extensions, compatibility functions, and tables
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS citext;

    CREATE OR REPLACE FUNCTION datetime(val text DEFAULT 'now') 
    RETURNS text AS $$
    BEGIN
      IF val = 'now' THEN
        RETURN to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS');
      END IF;
      RETURN to_char(val::timestamp, 'YYYY-MM-DD HH24:MI:SS');
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION date(val text) 
    RETURNS date AS $$
    BEGIN
      IF val = 'now' THEN
        RETURN CURRENT_DATE;
      END IF;
      RETURN val::date;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION date(val text, modifier text) 
    RETURNS date AS $$
    BEGIN
      IF val = 'now' AND modifier = '+1 day' THEN
        RETURN CURRENT_DATE + INTERVAL '1 day';
      END IF;
      IF modifier LIKE '+% day' OR modifier LIKE '+% days' THEN
        RETURN (val::date + (substring(modifier from '\d+')::integer * INTERVAL '1 day'))::date;
      END IF;
      IF modifier LIKE '-% day' OR modifier LIKE '-% days' THEN
        RETURN (val::date - (substring(modifier from '\d+')::integer * INTERVAL '1 day'))::date;
      END IF;
      RETURN val::date;
    END;
    $$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION strftime(format text, val text) 
    RETURNS text AS $$
    BEGIN
      IF format = '%Y-%m' THEN
        RETURN to_char(val::timestamp, 'YYYY-MM');
      END IF;
      RETURN to_char(val::timestamp, format);
    END;
    $$ LANGUAGE plpgsql;

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email citext NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_ceo INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      finance_access INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      token_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS departments (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      head_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS memberships (
      user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('head','member')),
      PRIMARY KEY (user_id, department_id)
    );

    -- Reporting hierarchy: arbitrary-depth manager chain, decoupled from
    -- departments. Drives the org-tree UI and attendance/leave approval
    -- authority (policy.ts). Departments/memberships stay untouched by this.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '';
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TEXT;
    CREATE INDEX IF NOT EXISTS idx_users_manager ON users(manager_id);

    -- Permanent deletion is PII erasure + a lockout flag, not a row DELETE:
    -- finance entries, the audit log, chat messages, and attachments all
    -- INNER JOIN on their creator/actor user id, so nulling that FK would
    -- silently drop those rows from every list instead of just anonymizing
    -- who did it. Keeping the row (with name/email/password scrubbed) is
    -- what actually preserves financial and audit integrity.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TEXT;

    -- Backfill so the hierarchy is never invalid: everyone reports to the
    -- CEO until explicitly repositioned. No-op after the first deploy.
    UPDATE users SET manager_id = (SELECT id FROM users WHERE is_ceo = 1 LIMIT 1)
    WHERE manager_id IS NULL AND is_ceo = 0;

    -- Intern tier: widen the existing CHECK the same way
    -- attachments_entity_type_check is widened further down this file.
    ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
    ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('head','member','intern'));

    CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','completed','archived')),
      owner_id INTEGER NOT NULL REFERENCES users(id),
      start_date TEXT,
      end_date TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS project_visibility (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, department_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','blocked','done')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
      due_date TEXT,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      due_notified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'),
      updated_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS task_comments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS finance_entries (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('expense','income','budget')),
      amount REAL NOT NULL,
      category TEXT NOT NULL DEFAULT 'general',
      note TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER NOT NULL REFERENCES users(id),
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      link TEXT NOT NULL DEFAULT '',
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      check_in TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'),
      check_out TEXT,
      validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending','approved','rejected')),
      validated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      validated_at TEXT,
      note TEXT NOT NULL DEFAULT ''
    );

    -- check_in is nullable so system-generated absence rows (no one checked
    -- in) can exist; record_date is always set (from check_in for real
    -- records, explicitly for absences) so "one record per person per day"
    -- can be enforced regardless of which kind of row it is.
    ALTER TABLE attendance ALTER COLUMN check_in DROP NOT NULL;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS record_date TEXT;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS category TEXT CHECK (category IN ('on_time','late','half_day','absent'));
    UPDATE attendance SET record_date = date(check_in) WHERE record_date IS NULL AND check_in IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, record_date);

    CREATE TABLE IF NOT EXISTS leave_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'vacation' CHECK (type IN ('vacation','sick','personal','other')),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      decided_at TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS attachments (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('task','finance','leave')),
      entity_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      uploaded_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    -- CREATE TABLE IF NOT EXISTS above only applies the widened CHECK on a
    -- fresh database; the constraint on an already-existing table needs an
    -- explicit migration. Safe to run every deploy: drop-if-exists then
    -- recreate.
    ALTER TABLE attachments DROP CONSTRAINT IF EXISTS attachments_entity_type_check;
    ALTER TABLE attachments ADD CONSTRAINT attachments_entity_type_check CHECK (entity_type IN ('task','finance','leave'));

    CREATE TABLE IF NOT EXISTS login_attempts (
      id SERIAL PRIMARY KEY,
      attempt_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_login_attempts_key ON login_attempts(attempt_key, created_at);

    CREATE TABLE IF NOT EXISTS milestones (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      due_date TEXT,
      completed_at TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    -- Singleton company-wide attendance policy (id is always 1).
    CREATE TABLE IF NOT EXISTS attendance_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      office_start_time TEXT NOT NULL DEFAULT '09:00',
      office_end_time TEXT NOT NULL DEFAULT '18:00',
      late_threshold_minutes INTEGER NOT NULL DEFAULT 15,
      half_day_threshold_minutes INTEGER NOT NULL DEFAULT 90,
      max_absent_allowed INTEGER NOT NULL DEFAULT 2,
      late_deduction_type TEXT NOT NULL DEFAULT 'fixed' CHECK (late_deduction_type IN ('fixed','percentage')),
      late_deduction_amount REAL NOT NULL DEFAULT 0,
      half_day_deduction_type TEXT NOT NULL DEFAULT 'fixed' CHECK (half_day_deduction_type IN ('fixed','percentage')),
      half_day_deduction_amount REAL NOT NULL DEFAULT 0,
      absent_deduction_type TEXT NOT NULL DEFAULT 'fixed' CHECK (absent_deduction_type IN ('fixed','percentage')),
      absent_deduction_amount REAL NOT NULL DEFAULT 0,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    INSERT INTO attendance_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

    -- Salary history: current salary is just the latest row per user, so a
    -- past payment still reflects what was actually in effect that month
    -- even after a later raise.
    CREATE TABLE IF NOT EXISTS salaries (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      effective_from TEXT NOT NULL,
      set_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );
    CREATE INDEX IF NOT EXISTS idx_salaries_user ON salaries(user_id, effective_from DESC);

    CREATE TABLE IF NOT EXISTS salary_payments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period TEXT NOT NULL,
      base_amount REAL NOT NULL,
      late_count INTEGER NOT NULL DEFAULT 0,
      half_day_count INTEGER NOT NULL DEFAULT 0,
      billable_absent_count INTEGER NOT NULL DEFAULT 0,
      apply_late_deduction INTEGER NOT NULL DEFAULT 1,
      apply_half_day_deduction INTEGER NOT NULL DEFAULT 1,
      apply_absent_deduction INTEGER NOT NULL DEFAULT 1,
      late_deduction_total REAL NOT NULL DEFAULT 0,
      half_day_deduction_total REAL NOT NULL DEFAULT 0,
      absent_deduction_total REAL NOT NULL DEFAULT 0,
      net_amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','paid')),
      note TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'),
      UNIQUE (user_id, period)
    );

    -- Group chat: CEO-created, explicit member list, confidential to
    -- non-members (same posture as project_visibility).
    CREATE TABLE IF NOT EXISTS chat_groups (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS chat_group_members (
      group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS'),
      PRIMARY KEY (group_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
      sender_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      attachment_filename TEXT,
      attachment_stored_name TEXT,
      attachment_size INTEGER,
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_group ON chat_messages(group_id, created_at);

    -- Columns above only apply on a fresh database; add them explicitly for
    -- an already-existing table (safe/idempotent to run every deploy).
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_filename TEXT;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_stored_name TEXT;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_size INTEGER;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at TEXT;

    -- In-portal meetings (WebRTC mesh; the DB carries only the signaling
    -- handshake — offers/answers/ICE — never any media).
    CREATE TABLE IF NOT EXISTS meetings (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      created_by INTEGER NOT NULL REFERENCES users(id),
      ended_at TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS meeting_participants (
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT,
      left_at TEXT,
      PRIMARY KEY (meeting_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS meeting_signals (
      id SERIAL PRIMARY KEY,
      meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      from_user INTEGER NOT NULL REFERENCES users(id),
      to_user INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_meeting_signals ON meeting_signals(meeting_id, to_user, id);
    ALTER TABLE meeting_signals DROP CONSTRAINT IF EXISTS meeting_signals_type_check;
    ALTER TABLE meeting_signals ADD CONSTRAINT meeting_signals_type_check CHECK (type IN ('offer','answer','ice','peer-left'));

    -- Multiple office timings: named schedules assignable to a department or
    -- an individual (individual wins over department, department over the
    -- company-wide attendance_settings defaults).
    CREATE TABLE IF NOT EXISTS work_schedules (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      office_start_time TEXT NOT NULL DEFAULT '09:00',
      office_end_time TEXT NOT NULL DEFAULT '18:00',
      late_threshold_minutes INTEGER NOT NULL DEFAULT 15,
      half_day_threshold_minutes INTEGER NOT NULL DEFAULT 90,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

    CREATE TABLE IF NOT EXISTS schedule_assignments (
      schedule_id INTEGER NOT NULL REFERENCES work_schedules(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('department','user')),
      target_id INTEGER NOT NULL,
      PRIMARY KEY (target_type, target_id)
    );

    -- Session-tracked attendance: while checked in, the presence heartbeat
    -- accumulates online_minutes; check-out finalizes the day's total.
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS online_minutes REAL NOT NULL DEFAULT 0;
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS last_active_at TEXT;
  `);

  await seedCeo();
}
