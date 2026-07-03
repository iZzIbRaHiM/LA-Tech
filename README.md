# LA Tech Solutions — Website + Company Portal

Marketing site (React 19 + Vite + Tailwind + shadcn/Radix, 3D hero via react-three-fiber) with an internal **company portal** at `/portal`.

## Portal features

- **Roles**: CEO (super admin) → Department Heads → Employees. Roles derive from org placement, not a standalone field.
- **Org management** (CEO): create departments, add members (email + one-time temp password), assign one head per department.
- **Tasks**: CEO assigns to departments (auto-assigns the head); heads split work into sub-tasks for their own team only; employees see only their assigned tasks. Board / list / table views, comments, notifications.
- **Projects** (CEO-only creation): per-department visibility allow-list — departments not granted access cannot see a project exists.
- **Finance** (CEO-only, enforced at the API layer): per-project ledger (budget / expense / income), portfolio dashboard, CSV export, audit-logged mutations.
- **Attendance**: everyone checks in/out; department heads validate their team's records, the CEO validates heads.
- **Search** (Ctrl+K): permission-scoped — never returns results the viewer isn't authorized to see.

## Run

Requires Node 22.5+ (uses the built-in `node:sqlite` — no native builds).

```bash
pnpm install
pnpm run server   # API on :5184 (seeds CEO account on first run)
pnpm run dev      # site + portal on :3000 (proxies /api to :5184)
```

First login: `ceo@latechs.org` / `ChangeMe123!` — change it via the key icon in the portal sidebar. Override the seed with `CEO_EMAIL` / `CEO_PASSWORD` env vars; set `JWT_SECRET` in production.

### Production

```bash
pnpm run build    # outputs dist/
pnpm run server   # serves dist/ + API from one process (SPA fallback included)
```

The SQLite database lives at `server/data/portal.db` (gitignored).

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
