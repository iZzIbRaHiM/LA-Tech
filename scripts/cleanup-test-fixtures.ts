// Removes the data the isolation-test suite (server/isolation-tests.mjs)
// creates: users named "Iso *" with iso.*@latechs.org emails, "IsoTest *"
// departments, "Iso *" tasks/projects/meetings, and their attendance/leave.
//
// Users are deactivated, not deleted — activity_log.actor_id references
// them, and erasing audit history is worse than a few inactive rows. The
// org tree only shows active users, so they disappear from every surface
// except the People page's inactive section.
//
// Safe to re-run any time:  pnpm run cleanup:fixtures
import { db, pool } from '../server/db';

async function run() {
  console.log('[cleanup] Removing isolation-test fixtures…');

  const isoUsers = (await db
    .prepare("SELECT id, name FROM users WHERE email LIKE 'iso.%@latechs.org' OR name LIKE 'Iso %'")
    .all()) as Array<{ id: number; name: string }>;
  const isoIds = isoUsers.map((u) => u.id);
  console.log(`[cleanup] ${isoUsers.length} fixture user(s) found`);

  const del = async (label: string, sql: string, params: unknown[] = []) => {
    const r = await db.prepare(sql).run(...params);
    if (r.changes > 0) console.log(`[cleanup] ${label}: ${r.changes}`);
  };

  // Fixture tasks (subtasks included by the same title convention; comments cascade).
  await del('tasks', "DELETE FROM tasks WHERE title LIKE 'Iso %' OR title = 'bad parent'");

  if (isoIds.length > 0) {
    const ph = isoIds.map(() => '?').join(',');
    await del('leave requests', `DELETE FROM leave_requests WHERE user_id IN (${ph})`, isoIds);
    await del('attendance records', `DELETE FROM attendance WHERE user_id IN (${ph})`, isoIds);
    await del('notifications', `DELETE FROM notifications WHERE user_id IN (${ph})`, isoIds);
    await del('memberships', `DELETE FROM memberships WHERE user_id IN (${ph})`, isoIds);
    await del('schedule assignments', `DELETE FROM schedule_assignments WHERE target_type = 'user' AND target_id IN (${ph})`, isoIds);
    // Anyone real who ended up reporting to a fixture user moves to the CEO.
    await del(
      'reports re-parented to CEO',
      `UPDATE users SET manager_id = (SELECT id FROM users WHERE is_ceo = 1 LIMIT 1)
       WHERE manager_id IN (${ph}) AND active = 1 AND NOT (email LIKE 'iso.%@latechs.org' OR name LIKE 'Iso %')`,
      isoIds
    );
  }

  // Fixture meetings (participants/signals cascade).
  await del(
    'meetings',
    "DELETE FROM meetings WHERE title LIKE 'Iso meeting %' OR title IN ('RTC verification', 'Verification call', 'UI check')"
  );

  // Fixture projects (visibility/finance/milestones cascade).
  await del('projects', "DELETE FROM projects WHERE name LIKE 'Iso Hidden Project %'");

  // Attachment rows whose owning entity is gone (polymorphic — no FK cascade).
  await del(
    'orphaned finance attachments',
    "DELETE FROM attachments WHERE entity_type = 'finance' AND entity_id NOT IN (SELECT id FROM finance_entries)"
  );
  await del(
    'orphaned task attachments',
    "DELETE FROM attachments WHERE entity_type = 'task' AND entity_id NOT IN (SELECT id FROM tasks)"
  );

  // Fixture departments: un-head, then archive (already emptied above).
  await del('department heads cleared', "UPDATE departments SET head_user_id = NULL WHERE name LIKE 'IsoTest %' AND head_user_id IS NOT NULL");
  await del(
    'departments archived',
    "UPDATE departments SET archived_at = datetime('now') WHERE name LIKE 'IsoTest %' AND archived_at IS NULL"
  );

  // Fixture work schedules.
  await del('work schedules', "DELETE FROM work_schedules WHERE name LIKE 'Iso Shift %' OR name LIKE 'Verify %'");

  // Finally the users themselves: deactivate + detach, keep for audit FKs.
  await del(
    'users deactivated',
    "UPDATE users SET active = 0, manager_id = NULL, finance_access = 0, token_version = token_version + 1 WHERE (email LIKE 'iso.%@latechs.org' OR name LIKE 'Iso %') AND active = 1"
  );

  console.log('[cleanup] Done.');
  await pool.end();
}

run().catch(async (err) => {
  console.error('[cleanup] Failed:', err);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
