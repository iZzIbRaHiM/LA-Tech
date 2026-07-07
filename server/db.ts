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
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// All "datetime now" columns are plain TEXT (SQLite-compat), so the client
// (attendance duration math, etc.) treats every stored timestamp as UTC.
// Force the session timezone rather than relying on the database's default
// staying UTC forever.
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'UTC'").catch((err) => console.error('[DATABASE] Failed to set session timezone:', err));
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
    if (!trimmed.includes(' RETURNING ') && 
        !trimmed.includes('INTO MEMBERSHIPS') && 
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
  console.log(`[seed] CEO account created: ${CEO_EMAIL} / ${CEO_PASSWORD} (change after first login)`);
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
      entity_type TEXT NOT NULL CHECK (entity_type IN ('task','finance')),
      entity_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      uploaded_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT to_char(CURRENT_TIMESTAMP, 'YYYY-MM-DD HH24:MI:SS')
    );

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
  `);

  await seedCeo();
}
