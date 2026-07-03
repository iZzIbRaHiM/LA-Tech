// node:sqlite (built into Node 22.5+) instead of better-sqlite3: same
// prepare/run/get/all API, but no native compilation step — this machine has
// no MSVC toolchain and Node 23 has no better-sqlite3 prebuilds.
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { sendEmail } from './email';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'portal.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  is_ceo INTEGER NOT NULL DEFAULT 0,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  head_user_id INTEGER REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One department per user (PRD §2 assumption 1): user_id is UNIQUE.
CREATE TABLE IF NOT EXISTS memberships (
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  role TEXT NOT NULL CHECK (role IN ('head','member')),
  PRIMARY KEY (user_id, department_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','completed','archived')),
  owner_id INTEGER NOT NULL REFERENCES users(id),
  start_date TEXT,
  end_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_visibility (
  project_id INTEGER NOT NULL REFERENCES projects(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  PRIMARY KEY (project_id, department_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','blocked','done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','urgent')),
  due_date TEXT,
  project_id INTEGER REFERENCES projects(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  parent_task_id INTEGER REFERENCES tasks(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS finance_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL CHECK (type IN ('expense','income','budget')),
  amount REAL NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT NOT NULL DEFAULT '',
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Attendance: one open record (check_out IS NULL) per user at a time.
-- validation_status is set by the user's department head (or the CEO).
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  check_in TEXT NOT NULL DEFAULT (datetime('now')),
  check_out TEXT,
  validation_status TEXT NOT NULL DEFAULT 'pending' CHECK (validation_status IN ('pending','approved','rejected')),
  validated_by INTEGER REFERENCES users(id),
  validated_at TEXT,
  note TEXT NOT NULL DEFAULT ''
);

-- Leave requests: decided by the requester's department head (or the CEO);
-- heads' own requests are decided by the CEO. Same authority model as attendance.
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL DEFAULT 'vacation' CHECK (type IN ('vacation','sick','personal','other')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Attachments live on disk (server/uploads); access is checked against the
-- owning entity's permissions on every download — no public static serving.
CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('task','finance')),
  entity_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  title TEXT NOT NULL,
  due_date TEXT,
  completed_at TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Column migrations for databases created before these features existed.
for (const stmt of [
  "ALTER TABLE users ADD COLUMN finance_access INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE tasks ADD COLUMN due_notified INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
]) {
  try {
    db.exec(stmt);
  } catch {
    /* column already exists */
  }
}

const CEO_EMAIL = process.env.CEO_EMAIL || 'ceo@latechs.org';
const CEO_PASSWORD = process.env.CEO_PASSWORD || 'ChangeMe123!';

export function seedCeo() {
  const existing = db.prepare('SELECT id FROM users WHERE is_ceo = 1').get();
  if (existing) return;
  db.prepare('INSERT INTO users (name, email, password_hash, is_ceo) VALUES (?, ?, ?, 1)').run(
    'CEO',
    CEO_EMAIL,
    bcrypt.hashSync(CEO_PASSWORD, 10)
  );
  console.log(`[seed] CEO account created: ${CEO_EMAIL} / ${CEO_PASSWORD} (change after first login)`);
}

export function logActivity(
  actorId: number,
  entityType: string,
  entityId: number,
  action: string,
  metadata: Record<string, unknown> = {}
) {
  db.prepare(
    'INSERT INTO activity_log (actor_id, entity_type, entity_id, action, metadata) VALUES (?, ?, ?, ?, ?)'
  ).run(actorId, entityType, entityId, action, JSON.stringify(metadata));
}

export function notify(userId: number, type: string, message: string, link = '') {
  db.prepare('INSERT INTO notifications (user_id, type, message, link) VALUES (?, ?, ?, ?)').run(
    userId,
    type,
    message,
    link
  );
  // Mirror every in-app notification to email (no-op until RESEND_API_KEY is set).
  const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId) as { email: string } | undefined;
  if (user) sendEmail(user.email, `LA Tech Portal — ${message}`, message, link);
}
