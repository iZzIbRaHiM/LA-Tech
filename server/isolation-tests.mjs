// PRD §10 gate: attempts every forbidden cross-boundary access defined by the
// permission matrix (§5) and data-model invariants (§6) against the live API.
// Every "DENY" case must be rejected server-side. Run with the API up:
//   node server/isolation-tests.mjs
//
// Assumes the seed scenario: dept 1 = Technical (head tara, member tom),
// dept 2 = Marketing (head mark), project 1 visible to Technical only,
// finance entries on project 1. Recreate with the curl script in the PR
// description, or adapt the credentials below.

const BASE = process.env.API_BASE || 'http://localhost:5184/api';

const sessions = {};

async function login(name, email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  sessions[name] = cookie;
}

async function req(as, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: sessions[as] },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON (e.g. CSV) */
  }
  return { status: res.status, json };
}

let pass = 0;
let fail = 0;
const failures = [];

function check(label, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  FAIL  ${label} — ${detail}`);
  }
}

const denied = (r) => r.status === 401 || r.status === 403 || r.status === 404;

async function main() {
  await login('ceo', 'ceo@latechs.org', 'ChangeMe123!');
  await login('tara', 'tara@latechs.org', 'Password1!'); // Technical head
  await login('tom', 'tom@latechs.org', 'Password1!'); // Technical member
  await login('mark', 'mark@latechs.org', 'Password1!'); // Marketing head

  console.log('\n== Finance is CEO-only (§4.4, §6 invariant) ==');
  for (const who of ['tara', 'tom', 'mark']) {
    const r1 = await req(who, 'GET', '/finance/overview');
    check(`${who} DENIED finance overview`, denied(r1), `got ${r1.status}`);
    const r2 = await req(who, 'GET', '/finance/projects/1');
    check(`${who} DENIED project finance ledger`, denied(r2), `got ${r2.status}`);
    const r3 = await req(who, 'POST', '/finance/projects/1/entries', { type: 'expense', amount: 1 });
    check(`${who} DENIED creating finance entry`, denied(r3), `got ${r3.status}`);
    const r4 = await req(who, 'GET', '/finance/projects/1/export.csv');
    check(`${who} DENIED finance CSV export`, denied(r4), `got ${r4.status}`);
  }
  // tara heads a department that CAN see project 1 — finance must still be denied.
  const taraProject = await req('tara', 'GET', '/projects/1');
  check('tara (granted dept) CAN see project 1', taraProject.status === 200, `got ${taraProject.status}`);

  console.log('\n== Project visibility allow-list (§4.3) ==');
  const markList = await req('mark', 'GET', '/projects');
  check(
    'mark (Marketing, not granted) sees empty project list',
    markList.status === 200 && markList.json.projects.length === 0,
    `got ${JSON.stringify(markList.json?.projects?.map((p) => p.id))}`
  );
  const markDetail = await req('mark', 'GET', '/projects/1');
  check('mark DENIED project 1 detail (404 — existence hidden)', markDetail.status === 404, `got ${markDetail.status}`);
  const markSearch = await req('mark', 'GET', '/search?q=Hospital');
  check(
    'search does not leak hidden project to mark',
    markSearch.status === 200 && markSearch.json.projects.length === 0,
    `got ${JSON.stringify(markSearch.json?.projects)}`
  );

  console.log('\n== Only CEO creates projects/departments (§5) ==');
  const taraProj = await req('tara', 'POST', '/projects', { name: 'Rogue project' });
  check('tara DENIED creating project', denied(taraProj), `got ${taraProj.status}`);
  const taraDept = await req('tara', 'POST', '/departments', { name: 'Rogue dept' });
  check('tara DENIED creating department', denied(taraDept), `got ${taraDept.status}`);
  const markVis = await req('mark', 'PATCH', '/projects/1', { departmentIds: [1, 2] });
  check('mark DENIED granting himself visibility', denied(markVis), `got ${markVis.status}`);

  console.log('\n== Task boundaries (§4.2, §5) ==');
  // tara (Technical head) tries to assign a task to mark (Marketing member)
  const crossAssign = await req('tara', 'POST', '/tasks', { title: 'Cross-dept task', assignedTo: 4 });
  check('tara DENIED assigning task outside her department', denied(crossAssign), `got ${crossAssign.status}`);
  // tom (member) tries to create a task at all
  const tomCreate = await req('tom', 'POST', '/tasks', { title: 'Member task', assignedTo: 3 });
  check('tom (member) DENIED creating tasks', denied(tomCreate), `got ${tomCreate.status}`);
  // mark must not see Technical's task list
  const markTasks = await req('mark', 'GET', '/tasks');
  const leaked = markTasks.json.tasks.filter((t) => t.department_id === 1);
  check('mark sees no Technical-department tasks', leaked.length === 0, `leaked ${leaked.length}`);
  // tom must not see the dept task assigned to tara
  const tomTasks = await req('tom', 'GET', '/tasks');
  const notHis = tomTasks.json.tasks.filter((t) => t.assigned_to !== 3);
  check('tom sees only his own assigned tasks', notHis.length === 0, `leaked ${notHis.length}`);
  const tomTask1 = await req('tom', 'GET', '/tasks/1');
  check("tom DENIED tara's task detail", denied(tomTask1), `got ${tomTask1.status}`);

  console.log('\n== Org management is CEO-only (§5) ==');
  const taraAdd = await req('tara', 'POST', '/departments/1/members', {
    name: 'X',
    email: 'x@latechs.org',
    password: 'Password1!',
  });
  check('tara DENIED adding members', denied(taraAdd), `got ${taraAdd.status}`);
  const taraHead = await req('tara', 'POST', '/departments/1/head', { userId: 3 });
  check('tara DENIED reassigning head', denied(taraHead), `got ${taraHead.status}`);
  const usersList = await req('mark', 'GET', '/users');
  check('mark DENIED full user directory', denied(usersList), `got ${usersList.status}`);

  console.log('\n== Non-finance routes stay reachable for non-CEOs ==');
  const markNotif = await req('mark', 'GET', '/notifications');
  check('mark CAN read own notifications', markNotif.status === 200, `got ${markNotif.status}`);
  const markActivity = await req('mark', 'GET', '/activity');
  check('mark CAN read scoped activity feed', markActivity.status === 200, `got ${markActivity.status}`);
  const finLeak = (markActivity.json?.activity ?? []).filter((a) => a.entity_type === 'finance');
  check('activity feed leaks no finance entries to mark', finLeak.length === 0, `leaked ${finLeak.length}`);

  console.log('\n== Positive controls (grants that SHOULD work) ==');
  const taraSub = await req('tara', 'POST', '/tasks', {
    title: 'Implement auth module',
    assignedTo: 3,
    parentTaskId: 1,
  });
  check('tara CAN assign sub-task to tom (own dept)', taraSub.status === 200, `got ${taraSub.status}`);
  const ceoFin = await req('ceo', 'GET', '/finance/overview');
  check('CEO CAN read finance', ceoFin.status === 200, `got ${ceoFin.status}`);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) {
    console.log('FAILED:', failures.join(' | '));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
