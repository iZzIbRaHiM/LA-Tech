import { initDb, pool } from '../server/db';

async function run() {
  console.log('[MIGRATION] Starting database migration...');
  try {
    await initDb();
    console.log('[MIGRATION] Database migration and seeding completed successfully.');
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error('[MIGRATION] Database migration failed:', err);
    try {
      await pool.end();
    } catch {
      // ignore
    }
    process.exit(1);
  }
}

run();
