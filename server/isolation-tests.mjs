// PRD §10 gate: attempts every forbidden cross-boundary access defined by the
// permission matrix (§5) and data-model invariants (§6) against the live API.
// Every "DENY" case must be rejected server-side.
//
// Self-contained: creates its own fixtures (timestamped, so re-runnable
// against any database that has the seeded CEO). Run with the API up:
//   node server/isolation-tests.mjs
//
// Env overrides: API_BASE, CEO_EMAIL, CEO_PASSWORD.

const BASE = process.env.API_BASE || 'http://localhost:5184/api';
const CEO_EMAIL = process.env.CEO_EMAIL || 'ceo@latechs.org';
const CEO_PASSWORD = process.env.CEO_PASSWORD || 'ChangeMe123!';
const TS = Date.now();
const PW = 'IsoTest123!';

const sessions = {};

async function login(name, email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  sessions[name] = res.headers.get('set-cookie')?.split(';')[0];
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

async function must(as, method, path, body) {
  const r = await req(as, method, path, body);
  if (r.status !== 200) {
    throw new Error(`Fixture setup failed: ${method} ${path} → ${r.status} ${JSON.stringify(r.json)}`);
  }
  return r.json;
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
  await login('ceo', CEO_EMAIL, CEO_PASSWORD);

  // ---- Fixtures: users created via People (POST /users), then assigned ----
  console.log(`Setting up fixtures (run ${TS})…`);
  const deptA = (await must('ceo', 'POST', '/departments', { name: `IsoTest Tech ${TS}` })).id;
  const deptB = (await must('ceo', 'POST', '/departments', { name: `IsoTest Mkt ${TS}` })).id;

  const mkUser = async (name, email) => (await must('ceo', 'POST', '/users', { name, email, password: PW })).id;
  const aHead = await mkUser('Iso A-Head', `iso.ahead.${TS}@latechs.org`);
  const aMember = await mkUser('Iso A-Member', `iso.amember.${TS}@latechs.org`);
  const bHead = await mkUser('Iso B-Head', `iso.bhead.${TS}@latechs.org`);

  await must('ceo', 'POST', `/departments/${deptA}/members`, { userId: aHead });
  await must('ceo', 'POST', `/departments/${deptA}/members`, { userId: aMember });
  await must('ceo', 'POST', `/departments/${deptB}/members`, { userId: bHead });
  await must('ceo', 'POST', `/departments/${deptA}/head`, { userId: aHead });
  await must('ceo', 'POST', `/departments/${deptB}/head`, { userId: bHead });

  const deptTask = (
    await must('ceo', 'POST', '/tasks', { title: `Iso dept task ${TS}`, departmentId: deptA })
  ).id;

  const project = (
    await must('ceo', 'POST', '/projects', {
      name: `Iso Hidden Project ${TS}`,
      description: 'visible to dept A only',
      departmentIds: [deptA],
    })
  ).id;

  await must('ceo', 'POST', `/finance/projects/${project}/entries`, { type: 'budget', amount: 1000 });

  await login('ahead', `iso.ahead.${TS}@latechs.org`, PW);
  await login('amember', `iso.amember.${TS}@latechs.org`, PW);
  await login('bhead', `iso.bhead.${TS}@latechs.org`, PW);

  // ---- Assertions ----
  console.log('\n== Finance is CEO-only (§4.4, §6 invariant) ==');
  for (const who of ['ahead', 'amember', 'bhead']) {
    const r1 = await req(who, 'GET', '/finance/overview');
    check(`${who} DENIED finance overview`, denied(r1), `got ${r1.status}`);
    const r2 = await req(who, 'GET', `/finance/projects/${project}`);
    check(`${who} DENIED project finance ledger`, denied(r2), `got ${r2.status}`);
    const r3 = await req(who, 'POST', `/finance/projects/${project}/entries`, { type: 'expense', amount: 1 });
    check(`${who} DENIED creating finance entry`, denied(r3), `got ${r3.status}`);
    const r4 = await req(who, 'GET', `/finance/projects/${project}/export.csv`);
    check(`${who} DENIED finance CSV export`, denied(r4), `got ${r4.status}`);
  }
  const aheadProject = await req('ahead', 'GET', `/projects/${project}`);
  check('ahead (granted dept) CAN see the project', aheadProject.status === 200, `got ${aheadProject.status}`);

  console.log('\n== Project visibility allow-list (§4.3) ==');
  const bList = await req('bhead', 'GET', '/projects');
  const bSeesIt = (bList.json?.projects ?? []).some((p) => p.id === project);
  check('bhead (not granted) does not see project in list', bList.status === 200 && !bSeesIt, `leak=${bSeesIt}`);
  const bDetail = await req('bhead', 'GET', `/projects/${project}`);
  check('bhead DENIED project detail (404 — existence hidden)', bDetail.status === 404, `got ${bDetail.status}`);
  const bSearch = await req('bhead', 'GET', `/search?q=${encodeURIComponent(`Iso Hidden Project ${TS}`)}`);
  const searchLeak = (bSearch.json?.projects ?? []).some((p) => p.id === project);
  check('search does not leak hidden project to bhead', bSearch.status === 200 && !searchLeak, `leak=${searchLeak}`);

  console.log('\n== Only CEO creates projects/departments (§5) ==');
  const aheadProj = await req('ahead', 'POST', '/projects', { name: 'Rogue project' });
  check('ahead DENIED creating project', denied(aheadProj), `got ${aheadProj.status}`);
  const aheadDept = await req('ahead', 'POST', '/departments', { name: 'Rogue dept' });
  check('ahead DENIED creating department', denied(aheadDept), `got ${aheadDept.status}`);
  const bVis = await req('bhead', 'PATCH', `/projects/${project}`, { departmentIds: [deptA, deptB] });
  check('bhead DENIED granting himself visibility', denied(bVis), `got ${bVis.status}`);

  console.log('\n== Task boundaries (§4.2, §5) ==');
  const crossAssign = await req('ahead', 'POST', '/tasks', { title: 'Cross-dept task', assignedTo: bHead });
  check('ahead DENIED assigning task outside own department', denied(crossAssign), `got ${crossAssign.status}`);
  const memberCreate = await req('amember', 'POST', '/tasks', { title: 'Member task', assignedTo: aMember });
  check('amember (member) DENIED creating tasks', denied(memberCreate), `got ${memberCreate.status}`);
  const bTasks = await req('bhead', 'GET', '/tasks');
  const bLeak = (bTasks.json?.tasks ?? []).filter((t) => t.department_id === deptA);
  check('bhead sees no dept-A tasks', bLeak.length === 0, `leaked ${bLeak.length}`);
  const aMemberTasks = await req('amember', 'GET', '/tasks');
  const notHis = (aMemberTasks.json?.tasks ?? []).filter((t) => t.assigned_to !== aMember);
  check('amember sees only own assigned tasks', notHis.length === 0, `leaked ${notHis.length}`);
  const aMemberTaskDetail = await req('amember', 'GET', `/tasks/${deptTask}`);
  check("amember DENIED the head's task detail", denied(aMemberTaskDetail), `got ${aMemberTaskDetail.status}`);

  console.log('\n== Org management is CEO-only (§5) ==');
  const aheadAdd = await req('ahead', 'POST', `/departments/${deptA}/members`, {
    name: 'X',
    email: `iso.x.${TS}@latechs.org`,
    password: PW,
  });
  check('ahead DENIED adding members', denied(aheadAdd), `got ${aheadAdd.status}`);
  const aheadHead = await req('ahead', 'POST', `/departments/${deptA}/head`, { userId: aMember });
  check('ahead DENIED reassigning head', denied(aheadHead), `got ${aheadHead.status}`);
  const usersList = await req('bhead', 'GET', '/users');
  check('bhead DENIED full user directory', denied(usersList), `got ${usersList.status}`);

  console.log('\n== Non-finance routes stay reachable for non-CEOs ==');
  const bNotif = await req('bhead', 'GET', '/notifications');
  check('bhead CAN read own notifications', bNotif.status === 200, `got ${bNotif.status}`);
  const bActivity = await req('bhead', 'GET', '/activity');
  check('bhead CAN read scoped activity feed', bActivity.status === 200, `got ${bActivity.status}`);
  const finLeak = (bActivity.json?.activity ?? []).filter((a) => a.entity_type === 'finance');
  check('activity feed leaks no finance entries to bhead', finLeak.length === 0, `leaked ${finLeak.length}`);

  console.log('\n== Attendance validation boundaries ==');
  // amember checks in and out; the record must be validatable only by aHead/CEO.
  await must('amember', 'POST', '/attendance/check-in', {});
  const doubleIn = await req('amember', 'POST', '/attendance/check-in', {});
  check('amember DENIED double check-in', doubleIn.status === 409, `got ${doubleIn.status}`);
  await must('amember', 'POST', '/attendance/check-out', {});
  const att = await req('amember', 'GET', '/attendance');
  const rec = att.json.own[0];
  const selfValidate = await req('amember', 'POST', `/attendance/${rec.id}/validate`, { status: 'approved' });
  check('amember DENIED validating own record', denied(selfValidate), `got ${selfValidate.status}`);
  const crossValidate = await req('bhead', 'POST', `/attendance/${rec.id}/validate`, { status: 'approved' });
  check("bhead DENIED validating another department's record", denied(crossValidate), `got ${crossValidate.status}`);
  const bTeam = await req('bhead', 'GET', '/attendance');
  const bTeamLeak = (bTeam.json?.team ?? []).some((r) => r.user_id === aMember);
  check("bhead's team view does not include dept-A records", !bTeamLeak, `leak=${bTeamLeak}`);
  const headValidate = await req('ahead', 'POST', `/attendance/${rec.id}/validate`, { status: 'approved' });
  check('ahead CAN validate own-dept member record', headValidate.status === 200, `got ${headValidate.status}`);
  // Head's own record: only the CEO may validate it.
  await must('ahead', 'POST', '/attendance/check-in', {});
  await must('ahead', 'POST', '/attendance/check-out', {});
  const attHead = await req('ahead', 'GET', '/attendance');
  const headRec = attHead.json.own[0];
  const headSelf = await req('ahead', 'POST', `/attendance/${headRec.id}/validate`, { status: 'approved' });
  check('ahead DENIED validating own record', denied(headSelf), `got ${headSelf.status}`);
  const ceoValidates = await req('ceo', 'POST', `/attendance/${headRec.id}/validate`, { status: 'approved' });
  check("CEO CAN validate a head's record", ceoValidates.status === 200, `got ${ceoValidates.status}`);

  console.log('\n== Leave decision boundaries ==');
  const leaveId = (
    await must('amember', 'POST', '/leave', { type: 'vacation', startDate: '2026-08-01', endDate: '2026-08-05' })
  ).id;
  const leaveSelf = await req('amember', 'POST', `/leave/${leaveId}/decide`, { status: 'approved' });
  check('amember DENIED deciding own leave', denied(leaveSelf), `got ${leaveSelf.status}`);
  const leaveCross = await req('bhead', 'POST', `/leave/${leaveId}/decide`, { status: 'approved' });
  check("bhead DENIED deciding another department's leave", denied(leaveCross), `got ${leaveCross.status}`);
  const leaveOk = await req('ahead', 'POST', `/leave/${leaveId}/decide`, { status: 'approved' });
  check('ahead CAN decide own-dept member leave', leaveOk.status === 200, `got ${leaveOk.status}`);
  const bLeave = await req('bhead', 'GET', '/leave');
  const bLeaveLeak = (bLeave.json?.team ?? []).some((l) => l.user_id === aMember);
  check("bhead's leave view excludes dept-A requests", !bLeaveLeak, `leak=${bLeaveLeak}`);

  console.log('\n== Attachment ACLs follow the owning entity ==');
  const finEntry = (
    await must('ceo', 'POST', `/finance/projects/${project}/entries`, { type: 'expense', amount: 42 })
  ).id;
  const finAttach = await fetch(`${BASE}/attachments?entity_type=finance&entity_id=${finEntry}&filename=receipt.txt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', Cookie: sessions.ceo },
    body: 'receipt-data',
  });
  check('CEO CAN attach to finance entry', finAttach.status === 200, `got ${finAttach.status}`);
  const finAttachId = (await finAttach.json()).id;
  const memberFinList = await req('amember', 'GET', `/attachments?entity_type=finance&entity_id=${finEntry}`);
  check('amember DENIED listing finance attachments', denied(memberFinList), `got ${memberFinList.status}`);
  const memberFinDl = await req('amember', 'GET', `/attachments/${finAttachId}/download`);
  check('amember DENIED downloading finance attachment', denied(memberFinDl), `got ${memberFinDl.status}`);
  const bheadTaskAttach = await fetch(
    `${BASE}/attachments?entity_type=task&entity_id=${deptTask}&filename=x.txt`,
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Cookie: sessions.bhead }, body: 'x' }
  );
  check("bhead DENIED attaching to dept-A task", bheadTaskAttach.status === 404, `got ${bheadTaskAttach.status}`);

  console.log('\n== Reports and audit are CEO-only ==');
  for (const [who, path] of [
    ['ahead', '/reports/attendance'],
    ['bhead', '/reports/attendance.csv'],
    ['amember', '/audit'],
    ['ahead', '/audit'],
  ]) {
    const r = await req(who, 'GET', path);
    check(`${who} DENIED ${path}`, denied(r), `got ${r.status}`);
  }
  const ceoReport = await req('ceo', 'GET', '/reports/attendance');
  check('CEO CAN read attendance report', ceoReport.status === 200, `got ${ceoReport.status}`);
  const ceoAudit = await req('ceo', 'GET', '/audit');
  check('CEO CAN read audit log', ceoAudit.status === 200, `got ${ceoAudit.status}`);

  console.log('\n== Milestones follow project visibility ==');
  const msId = (await must('ceo', 'POST', `/projects/${project}/milestones`, { title: `Iso milestone ${TS}` })).id;
  const bheadMs = await req('bhead', 'GET', `/projects/${project}/milestones`);
  check('bhead DENIED milestones of hidden project', denied(bheadMs), `got ${bheadMs.status}`);
  const aheadMsCreate = await req('ahead', 'POST', `/projects/${project}/milestones`, { title: 'rogue' });
  check('ahead DENIED creating milestones (CEO-only)', denied(aheadMsCreate), `got ${aheadMsCreate.status}`);
  const aheadMsToggle = await req('ahead', 'PATCH', `/milestones/${msId}`, { completed: true });
  check('ahead (granted dept head) CAN complete milestone', aheadMsToggle.status === 200, `got ${aheadMsToggle.status}`);
  const bheadMsToggle = await req('bhead', 'PATCH', `/milestones/${msId}`, { completed: false });
  check('bhead DENIED toggling hidden-project milestone', denied(bheadMsToggle), `got ${bheadMsToggle.status}`);

  console.log('\n== Finance delegate grant/revoke ==');
  const memberGrant = await req('ahead', 'POST', `/users/${bHead}/finance-access`, { grant: true });
  check('ahead DENIED granting finance access', denied(memberGrant), `got ${memberGrant.status}`);
  await must('ceo', 'POST', `/users/${bHead}/finance-access`, { grant: true });
  const delegateRead = await req('bhead', 'GET', '/finance/overview');
  check('bhead (delegate) CAN read finance after grant', delegateRead.status === 200, `got ${delegateRead.status}`);
  const delegateWrite = await req('bhead', 'POST', `/finance/projects/${project}/entries`, {
    type: 'income',
    amount: 5,
  });
  check('bhead (delegate) CAN write finance after grant', delegateWrite.status === 200, `got ${delegateWrite.status}`);
  await must('ceo', 'POST', `/users/${bHead}/finance-access`, { grant: false });
  const revokedRead = await req('bhead', 'GET', '/finance/overview');
  check('bhead DENIED finance after revoke', denied(revokedRead), `got ${revokedRead.status}`);

  console.log('\n== User lifecycle security ==');
  // Only the CEO manages accounts.
  const headCreate = await req('ahead', 'POST', '/users', { name: 'X', email: `iso.x.${TS}@latechs.org`, password: PW });
  check('ahead DENIED creating users', denied(headCreate), `got ${headCreate.status}`);
  const headReset = await req('ahead', 'POST', `/users/${aMember}/reset-password`, { password: PW });
  check('ahead DENIED resetting passwords', denied(headReset), `got ${headReset.status}`);
  const headDeact = await req('ahead', 'POST', `/users/${aMember}/active`, { active: false });
  check('ahead DENIED deactivating users', denied(headDeact), `got ${headDeact.status}`);
  // Assigning an already-assigned user is rejected (one department per user).
  const doubleAssign = await req('ceo', 'POST', `/departments/${deptB}/members`, { userId: aMember });
  check('CEO DENIED assigning already-assigned user', doubleAssign.status === 409, `got ${doubleAssign.status}`);
  // Weak temp passwords rejected.
  const weakPw = await req('ceo', 'POST', '/users', { name: 'Weak', email: `iso.weak.${TS}@latechs.org`, password: 'short' });
  check('CEO DENIED creating user with weak password', weakPw.status === 400, `got ${weakPw.status}`);
  // Duplicate email rejected.
  const dupEmail = await req('ceo', 'POST', '/users', { name: 'Dup', email: `iso.ahead.${TS}@latechs.org`, password: PW });
  check('CEO DENIED duplicate email', dupEmail.status === 409, `got ${dupEmail.status}`);
  // Deactivation kills login AND the live session.
  const victim = (await must('ceo', 'POST', '/users', { name: 'Iso Victim', email: `iso.victim.${TS}@latechs.org`, password: PW })).id;
  await login('victim', `iso.victim.${TS}@latechs.org`, PW);
  const victimBefore = await req('victim', 'GET', '/auth/me');
  check('victim session works before deactivation', victimBefore.status === 200, `got ${victimBefore.status}`);
  await must('ceo', 'POST', `/users/${victim}/active`, { active: false });
  const victimAfter = await req('victim', 'GET', '/auth/me');
  check('victim session dead after deactivation', victimAfter.status === 401, `got ${victimAfter.status}`);
  const victimLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `iso.victim.${TS}@latechs.org`, password: PW }),
  });
  check('deactivated user DENIED login', victimLogin.status === 401, `got ${victimLogin.status}`);
  const assignInactive = await req('ceo', 'POST', `/departments/${deptA}/members`, { userId: victim });
  check('CEO DENIED assigning deactivated user', assignInactive.status === 400, `got ${assignInactive.status}`);
  // Archiving a department with members is blocked.
  const archiveWithMembers = await req('ceo', 'PATCH', `/departments/${deptA}`, { archive: true });
  check('CEO DENIED archiving department with members', archiveWithMembers.status === 409, `got ${archiveWithMembers.status}`);
  // Login rate limiting: 10 bad attempts → 429.
  for (let i = 0; i < 10; i++) {
    await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `iso.brute.${TS}@latechs.org`, password: 'wrong' }),
    });
  }
  const brute = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `iso.brute.${TS}@latechs.org`, password: 'wrong' }),
  });
  check('login rate-limited after repeated failures', brute.status === 429, `got ${brute.status}`);

  console.log('\n== Sub-task scoping (§5) ==');
  // A parent task assigned to amember, with one sub for amember and one sub
  // for aHead: amember opening the parent must see only their own sub.
  const parent2 = (await must('ahead', 'POST', '/tasks', { title: `Iso parent2 ${TS}`, assignedTo: aMember })).id;
  await must('ahead', 'POST', '/tasks', { title: `Iso sub mine ${TS}`, assignedTo: aMember, parentTaskId: parent2 });
  const otherSub = (
    await must('ahead', 'POST', '/tasks', { title: `Iso sub other ${TS}`, assignedTo: aHead, parentTaskId: parent2 })
  ).id;
  const parentView = await req('amember', 'GET', `/tasks/${parent2}`);
  const subLeak = (parentView.json?.subtasks ?? []).some((s) => s.id === otherSub);
  check("amember's parent view hides teammates' sub-tasks", parentView.status === 200 && !subLeak, `leak=${subLeak}`);
  const crossParent = await req('ahead', 'POST', '/tasks', {
    title: 'bad parent',
    assignedTo: aMember,
    parentTaskId: 999999,
  });
  check('sub-task with nonexistent parent rejected', crossParent.status === 404, `got ${crossParent.status}`);

  console.log('\n== Positive controls (grants that SHOULD work) ==');
  const sub = await req('ahead', 'POST', '/tasks', {
    title: `Iso sub-task ${TS}`,
    assignedTo: aMember,
    parentTaskId: deptTask,
  });
  check('ahead CAN assign sub-task to own-dept member', sub.status === 200, `got ${sub.status}`);
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
