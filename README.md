# LA Tech Solutions — Website + Company Portal

Marketing site (React 19 + Vite + Tailwind + shadcn/Radix, 3D hero via react-three-fiber) with an internal **company portal** at `/portal`.

## Portal features

- **Roles**: CEO (super admin) → Department Heads → Employees. Roles derive from org placement, not a standalone field.
- **People** (CEO): create user accounts (email + one-time temp password), reset passwords, deactivate/reactivate (deactivation ends live sessions immediately), grant finance access. Users see a banner until they replace their temp password.
- **Org management** (CEO): create departments, assign users from the unassigned pool, assign one head per department. Account lifecycle (People) and org placement (Departments) are separate steps.
- **Auth hardening**: bcrypt password hashes, httpOnly session cookies (secure flag in production), login rate limiting (10 attempts / 15 min per email+IP), deactivated accounts indistinguishable from bad credentials at login.
- **Tasks**: CEO assigns to departments (auto-assigns the head); heads split work into sub-tasks for their own team only; employees see only their assigned tasks. Board / list / table views, comments, notifications.
- **Projects** (CEO-only creation): per-department visibility allow-list — departments not granted access cannot see a project exists.
- **Finance** (CEO + explicitly granted delegates): per-project ledger (budget / expense / income), portfolio dashboard, CSV export, audit-logged mutations. Payroll figures on this page are CEO-only, never shown to delegates.
- **Attendance**: employees check in/out (the CEO is excluded — tracking applies to everyone else); check-ins auto-categorize as on-time / late / half-day from the configured office hours and thresholds; validators (dept head, or CEO for heads/unassigned) approve, reject, or approve with a corrected time; a rejected check-in blocks re-check-in that day; a daily sweep marks weekday absences (no record, no approved leave).
- **Settings** (CEO): office start/end time, late and half-day thresholds, free-absence allowance, and per-category deduction amounts (fixed or % of salary) that feed payroll.
- **Salary** (CEO-only, stricter than finance delegation): assign per-employee salaries (history-preserving), record monthly payments that pull the employee's confirmed late/half-day/billable-absence counts and suggest deductions from Settings — with full CEO control to toggle or override every deduction. Absences beyond the free allowance are the only ones billed.
- **Leave**: request with dates/type/reason + file attachments; dept head or CEO decides; approved leave shows on a shared month calendar and suppresses absence marking.
- **Chat**: CEO-created groups with explicit member lists; group existence and messages are invisible to non-members; text + file messages.
- **Dashboard**: role-scoped overview; the CEO additionally gets company KPIs (net profit including payroll, revenue, expenses, payroll) and charts (revenue vs expenses by project, payroll trend, task status, monthly attendance mix).
- **Attachments**: on tasks, finance entries, leave requests, and chat messages — stored in Cloudflare R2, permission-checked through the owning record on every access.
- **Search** (Ctrl+K): permission-scoped — never returns results the viewer isn't authorized to see.

## Run

Database is PostgreSQL (Supabase). Set `DATABASE_URL` (Supabase connection pooler, port 6543 — required for serverless) in `.env` before running anything.

```bash
pnpm install
pnpm run server   # API on :5184 (creates tables + seeds CEO account on first run)
pnpm run dev      # site + portal on :3000 (proxies /api to :5184)
```

First login: `ceo@latechs.org` / `ChangeMe123!` — you'll be prompted to change it (temp-password banner). Override the seed with `CEO_EMAIL` / `CEO_PASSWORD` env vars; set `JWT_SECRET` in production.

### Production (Vercel + Supabase + Cloudflare R2)

- Deployed as static frontend (Vite build) + a single Vercel serverless function (`api/index.ts`, wraps the Express app) via `vercel.json` rewrites (`/api/*` → the function, everything else → `index.html` for the client-side router).
- `pnpm run build` runs `scripts/migrate.ts` (creates/updates tables, seeds the CEO) before building — this means `DATABASE_URL` must be reachable and the Supabase project must not be paused at **build** time, or the Vercel deployment fails.
- Required env vars in the Vercel project (Production + Preview): `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `JWT_SECRET`, `CEO_EMAIL`, `CEO_PASSWORD`, `CRON_SECRET`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Optional: `RESEND_API_KEY`, `EMAIL_FROM`, `APP_URL`.
- Attachments are stored in Cloudflare R2 (S3-compatible object storage), not local disk (Vercel functions have a read-only filesystem) and not Supabase Storage (free-tier storage quota is small). Create the bucket in the Cloudflare dashboard (Storage & Databases → R2) and generate an API token (Access Key ID + Secret) under "Manage API tokens" — R2 has no bucket-level public/private toggle to worry about since every read/write in this app goes through `server/r2.ts` using those credentials, never a public URL.
- The due-date reminder cron (`vercel.json` → `/api/cron/reminders`) runs once daily on Vercel's Hobby tier; `CRON_SECRET` must match what's configured so Vercel's automatic `Authorization: Bearer` header is accepted.

## Security tests

The permission matrix is enforced server-side and verified by an isolation suite that attempts every forbidden cross-boundary access (non-CEO fetching finance, ungranted department fetching a project, head assigning outside their department, cross-department attendance validation, search leaks):

```bash
pnpm run server                     # in one terminal
node server/isolation-tests.mjs    # in another — self-contained, re-runnable
```

All checks must pass before shipping changes that touch authorization.

## Structure

```
server/            Express API (auth, org, tasks, projects, finance, attendance)
src/portal/        Portal frontend (React Router at /portal/*)
src/sections/      Marketing site sections (Hero has the 3D particle network)
src/components/ui/ shadcn component library (shared by site + portal)
```
