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

// All mutating requests must carry the CSRF custom header (see index.ts).
const CSRF = { 'X-Requested-With': 'latech-portal' };

async function login(name, email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...CSRF },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  sessions[name] = res.headers.get('set-cookie')?.split(';')[0];
}

async function req(as, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: sessions[as], ...CSRF },
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

  // manager_id is fully decoupled from departments now (policy.ts's
  // decidesFor walks the manager chain, not memberships) — wire it
  // explicitly so the attendance/leave-validation assertions below keep
  // testing the same shape of boundary against the new authority source.
  // aMember reports to aHead; bHead (and aHead) default to the CEO from the
  // POST /users backfill, so cross-department/self assertions still hold
  // with zero other changes.
  await must('ceo', 'PATCH', `/org-tree/users/${aMember}`, { managerId: aHead });

  const deptTask = (
    await must('ceo', 'POST', '/tasks', { title: `Iso dept task ${TS}`, departmentId: deptA })
  ).id;

  const project = (
    await must('ceo', 'POST', '/projects', {
      name: `Iso Hidden Project ${TS}`,
      description: 'visible to dept A only',
      departmentIds: [deptA],
      // routes-projects.ts requires both dates on create — this fixture
      // was stale (pre-existing, unrelated to the org-hierarchy work).
      startDate: '2026-01-01',
      endDate: '2026-12-31',
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

  const ceoTaskWrongDept = await req('ceo', 'POST', '/tasks', {
    title: `Iso mismatched-project task ${TS}`,
    departmentId: deptB,
    projectId: project,
  });
  check(
    "CEO DENIED linking a project the task's department can't see",
    ceoTaskWrongDept.status === 400,
    `got ${ceoTaskWrongDept.status}`
  );
  const ceoTaskRightDept = await req('ceo', 'POST', '/tasks', {
    title: `Iso matched-project task ${TS}`,
    departmentId: deptA,
    projectId: project,
  });
  check('CEO CAN link a project the task department is granted', ceoTaskRightDept.status === 200, `got ${ceoTaskRightDept.status}`);

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
  // Correcting a decision: the same authority that approved it can flip it.
  const leaveRedecide = await req('ahead', 'POST', `/leave/${leaveId}/decide`, { status: 'rejected' });
  check('ahead CAN correct an already-decided leave request', leaveRedecide.status === 200, `got ${leaveRedecide.status}`);
  // Withdrawing a request: requester-only, pending-only.
  const leaveId2 = (
    await must('amember', 'POST', '/leave', { type: 'sick', startDate: '2026-09-01', endDate: '2026-09-02' })
  ).id;
  const cancelByOther = await req('ahead', 'DELETE', `/leave/${leaveId2}`);
  check("head DENIED cancelling someone else's leave request", cancelByOther.status === 403, `got ${cancelByOther.status}`);
  const cancelDecided = await req('amember', 'DELETE', `/leave/${leaveId}`);
  check('amember DENIED withdrawing an already-decided request', cancelDecided.status === 409, `got ${cancelDecided.status}`);
  const cancelOwn = await req('amember', 'DELETE', `/leave/${leaveId2}`);
  check('amember CAN withdraw their own pending request', cancelOwn.status === 200, `got ${cancelOwn.status}`);
  const afterCancel = await must('amember', 'GET', '/leave');
  check('withdrawn request no longer appears', !afterCancel.own.some((l) => l.id === leaveId2), 'still present');

  console.log('\n== Org hierarchy & manager-chain authority ==');
  // grandchild reports to aMember, who reports to aHead — a 3-level chain
  // (CEO -> aHead -> aMember -> grandchild) to prove skip-level ancestors,
  // not just direct managers, can decide.
  const grandchild = await mkUser('Iso Grandchild', `iso.grandchild.${TS}@latechs.org`);
  await must('ceo', 'PATCH', `/org-tree/users/${grandchild}`, { managerId: aMember });
  await login('grandchild', `iso.grandchild.${TS}@latechs.org`, PW);

  const nonCeoTree = await req('amember', 'GET', '/org-tree');
  check('non-CEO DENIED reading the org tree', denied(nonCeoTree), `got ${nonCeoTree.status}`);
  const nonCeoPatch = await req('amember', 'PATCH', `/org-tree/users/${grandchild}`, { title: 'hack' });
  check('non-CEO DENIED patching the org tree', denied(nonCeoPatch), `got ${nonCeoPatch.status}`);

  const ceoMe = await req('ceo', 'GET', '/auth/me');
  const ceoSelfPatch = await req('ceo', 'PATCH', `/org-tree/users/${ceoMe.json.user.id}`, { managerId: aHead });
  check("CEO's own manager cannot be changed", ceoSelfPatch.status === 400, `got ${ceoSelfPatch.status}`);

  const cyclePatch = await req('ceo', 'PATCH', `/org-tree/users/${aHead}`, { managerId: grandchild });
  check('reassigning a manager onto their own descendant is rejected (cycle)', cyclePatch.status === 409, `got ${cyclePatch.status}`);

  await must('grandchild', 'POST', '/attendance/check-in', {});
  await must('grandchild', 'POST', '/attendance/check-out', {});
  const gcAtt = await req('grandchild', 'GET', '/attendance');
  const gcRec = gcAtt.json.own[0];
  const unrelatedDenied = await req('bhead', 'POST', `/attendance/${gcRec.id}/validate`, { status: 'approved' });
  check('unrelated manager DENIED validating a non-report', denied(unrelatedDenied), `got ${unrelatedDenied.status}`);
  const skipLevel = await req('ahead', 'POST', `/attendance/${gcRec.id}/validate`, { status: 'approved' });
  check('skip-level ancestor (grandmanager) CAN validate', skipLevel.status === 200, `got ${skipLevel.status}`);

  // Deactivating a manager bubbles their direct reports up one level rather
  // than orphaning them — dedicated fixtures so this doesn't disturb
  // aMember/grandchild, which later sections still depend on.
  const bubbleManager = await mkUser('Iso Bubble Manager', `iso.bubblemgr.${TS}@latechs.org`);
  await must('ceo', 'PATCH', `/org-tree/users/${bubbleManager}`, { managerId: aHead });
  const bubbleReport = await mkUser('Iso Bubble Report', `iso.bubblerpt.${TS}@latechs.org`);
  await must('ceo', 'PATCH', `/org-tree/users/${bubbleReport}`, { managerId: bubbleManager });
  await must('ceo', 'POST', `/users/${bubbleManager}/active`, { active: false });
  const treeAfterBubble = await must('ceo', 'GET', '/org-tree');
  const bubbled = treeAfterBubble.users.find((u) => u.id === bubbleReport);
  check(
    'deactivating a manager bubbles direct reports to the manager above them',
    bubbled?.manager_id === aHead,
    `manager_id=${bubbled?.manager_id}`
  );

  // Intern is a label, not a new restriction — task visibility must be
  // identical to a plain member.
  await must('ceo', 'POST', `/departments/${deptB}/members`, { userId: grandchild, role: 'intern' });
  const internTask = await must('bhead', 'POST', '/tasks', { title: `Iso intern task ${TS}`, assignedTo: grandchild });
  const gcOwnTasks = await req('grandchild', 'GET', '/tasks');
  const seesOwn = (gcOwnTasks.json?.tasks ?? []).some((t) => t.id === internTask.id);
  check('intern sees their own assigned task (behaves like member)', seesOwn, `seesOwn=${seesOwn}`);
  const amemberTasks = await req('amember', 'GET', '/tasks');
  const internLeak = (amemberTasks.json?.tasks ?? []).some((t) => t.id === internTask.id);
  check("intern's task does not leak to an unrelated department member", !internLeak, `leak=${internLeak}`);

  console.log('\n== Self profile: read own, change contact info only ==');
  const myProfile = await req('amember', 'GET', '/me/profile');
  check('member CAN read own profile', myProfile.status === 200 && myProfile.json?.profile != null, `got ${myProfile.status}`);
  check(
    "profile shows the member's manager from the chain",
    myProfile.json?.profile?.manager_id === aHead,
    `manager_id=${myProfile.json?.profile?.manager_id}`
  );
  // Escalation attempt: smuggle privileged fields alongside phone — only
  // the phone may change.
  const smuggle = await req('amember', 'PATCH', '/me/profile', {
    phone: '+92 300 0000000',
    title: 'Chief Hacker',
    managerId: null,
    financeAccess: true,
    is_ceo: 1,
  });
  check('own-profile PATCH accepted for phone', smuggle.status === 200, `got ${smuggle.status}`);
  const afterSmuggle = await must('amember', 'GET', '/me/profile');
  const meAfter = await must('amember', 'GET', '/auth/me');
  check('phone updated via self-service', afterSmuggle.profile.phone === '+92 300 0000000', `got ${afterSmuggle.profile.phone}`);
  check('smuggled title ignored', afterSmuggle.profile.title !== 'Chief Hacker', `got ${afterSmuggle.profile.title}`);
  check('smuggled manager change ignored', afterSmuggle.profile.manager_id === aHead, `got ${afterSmuggle.profile.manager_id}`);
  check('smuggled finance access ignored', meAfter.user.financeAccess === false, `got ${meAfter.user.financeAccess}`);
  const badPhone = await req('amember', 'PATCH', '/me/profile', { phone: 12345 });
  check('non-string phone rejected', badPhone.status === 400, `got ${badPhone.status}`);

  console.log('\n== One-dialog onboarding (POST /users with departmentId) ==');
  const onboarded = (
    await must('ceo', 'POST', '/users', {
      name: 'Iso Onboarded',
      email: `iso.onboarded.${TS}@latechs.org`,
      password: PW,
      title: 'Junior Dev',
      departmentId: deptB,
    })
  ).id;
  await login('onboarded', `iso.onboarded.${TS}@latechs.org`, PW);
  const onboardedProfile = await must('onboarded', 'GET', '/me/profile');
  check(
    'new user lands with department + title + CEO manager in one call',
    onboardedProfile.profile.department_name?.startsWith('IsoTest Mkt') &&
      onboardedProfile.profile.title === 'Junior Dev' &&
      onboardedProfile.profile.manager_name != null,
    JSON.stringify({ d: onboardedProfile.profile.department_name, t: onboardedProfile.profile.title })
  );
  const badDept = await req('ceo', 'POST', '/users', {
    name: 'Iso BadDept',
    email: `iso.baddept.${TS}@latechs.org`,
    password: PW,
    departmentId: 999999,
  });
  check('creating a user into a nonexistent department rejected', badDept.status === 400, `got ${badDept.status}`);
  const onboardedSched = await req('onboarded', 'GET', '/schedules/mine');
  check(
    'brand-new user resolves a valid (default) office timing',
    onboardedSched.status === 200 && onboardedSched.json?.schedule?.office_start_time != null,
    `got ${onboardedSched.status}`
  );
  void onboarded;

  console.log('\n== Meetings: participant-only access ==');
  const meetingId = (await must('ceo', 'POST', '/meetings', { title: `Iso meeting ${TS}`, participantIds: [aMember] })).id;
  const nonCeoCreate = await req('ahead', 'POST', '/meetings', { title: 'x', participantIds: [aMember] });
  check('non-CEO DENIED creating meetings', denied(nonCeoCreate), `got ${nonCeoCreate.status}`);
  const outsiderDetail = await req('bhead', 'GET', `/meetings/${meetingId}`);
  check('non-participant DENIED meeting detail (404 — existence hidden)', denied(outsiderDetail), `got ${outsiderDetail.status}`);
  const outsiderJoin = await req('bhead', 'POST', `/meetings/${meetingId}/join`, {});
  check('non-participant DENIED joining', denied(outsiderJoin), `got ${outsiderJoin.status}`);
  const outsiderPoll = await req('bhead', 'GET', `/meetings/${meetingId}/signals?after=0`);
  check('non-participant DENIED reading signals', denied(outsiderPoll), `got ${outsiderPoll.status}`);
  await must('amember', 'POST', `/meetings/${meetingId}/join`, {});
  const signalToOutsider = await req('amember', 'POST', `/meetings/${meetingId}/signals`, {
    toUser: bHead,
    type: 'offer',
    payload: {},
  });
  check('signaling to a non-participant rejected', signalToOutsider.status === 400, `got ${signalToOutsider.status}`);
  const badType = await req('amember', 'POST', `/meetings/${meetingId}/signals`, {
    toUser: aMember,
    type: 'evil-type',
    payload: {},
  });
  check('invalid signal type rejected', badType.status === 400, `got ${badType.status}`);
  const nonCreatorEnd = await req('amember', 'POST', `/meetings/${meetingId}/end`, {});
  check('non-creator DENIED ending the meeting', denied(nonCreatorEnd), `got ${nonCreatorEnd.status}`);
  const creatorEnd = await req('ceo', 'POST', `/meetings/${meetingId}/end`, {});
  check('creator CAN end the meeting', creatorEnd.status === 200, `got ${creatorEnd.status}`);

  console.log('\n== Office timings (schedules) ==');
  const nonCeoSched = await req('ahead', 'POST', '/schedules', { name: 'x', officeStartTime: '09:00', officeEndTime: '17:00' });
  check('non-CEO DENIED creating schedules', denied(nonCeoSched), `got ${nonCeoSched.status}`);
  const schedId = (
    await must('ceo', 'POST', '/schedules', {
      name: `Iso Shift ${TS}`,
      officeStartTime: '10:00',
      officeEndTime: '19:00',
      lateThresholdMinutes: 20,
      halfDayThresholdMinutes: 100,
    })
  ).id;
  const nonCeoAssign = await req('ahead', 'POST', `/schedules/${schedId}/assign`, { targetType: 'user', targetId: aMember });
  check('non-CEO DENIED assigning schedules', denied(nonCeoAssign), `got ${nonCeoAssign.status}`);
  const badThreshold = await req('ceo', 'PATCH', `/schedules/${schedId}`, { lateThresholdMinutes: 'garbage' });
  check('non-numeric threshold rejected with 400', badThreshold.status === 400, `got ${badThreshold.status}`);
  await must('ceo', 'POST', `/schedules/${schedId}/assign`, { targetType: 'user', targetId: aMember });
  const mine = await req('amember', 'GET', '/schedules/mine');
  check(
    'assigned user resolves their own timing',
    mine.status === 200 && mine.json?.schedule?.schedule_name === `Iso Shift ${TS}`,
    `got ${mine.status} / ${mine.json?.schedule?.schedule_name}`
  );
  await must('ceo', 'DELETE', `/schedules/${schedId}`);
  const mineAfter = await req('amember', 'GET', '/schedules/mine');
  check(
    'deleted timing falls back to the company default',
    mineAfter.status === 200 && mineAfter.json?.schedule?.schedule_name === null,
    `got ${mineAfter.status} / ${mineAfter.json?.schedule?.schedule_name}`
  );

  console.log('\n== Manual attendance entry (backfill a missed day) ==');
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const crossDeptLog = await req('bhead', 'POST', '/attendance/manual', {
    userId: aMember,
    checkIn: `${yesterday} 09:00:00`,
    checkOut: `${yesterday} 18:00:00`,
  });
  check('bhead DENIED logging attendance for someone outside their authority', denied(crossDeptLog), `got ${crossDeptLog.status}`);
  const selfLog = await req('ahead', 'POST', '/attendance/manual', {
    userId: aHead,
    checkIn: `${yesterday} 09:00:00`,
    checkOut: `${yesterday} 18:00:00`,
  });
  check('ahead DENIED logging their own attendance manually', denied(selfLog), `got ${selfLog.status}`);
  const goodLog = await req('ahead', 'POST', '/attendance/manual', {
    userId: aMember,
    checkIn: `${yesterday} 09:00:00`,
    checkOut: `${yesterday} 18:00:00`,
    note: 'Backfilled — confirmed with employee',
  });
  check('ahead CAN log attendance for their own report', goodLog.status === 200, `got ${goodLog.status}`);
  const dupeLog = await req('ahead', 'POST', '/attendance/manual', {
    userId: aMember,
    checkIn: `${yesterday} 09:00:00`,
    checkOut: `${yesterday} 18:00:00`,
  });
  check('CEO/head DENIED logging a second record for the same day', dupeLog.status === 409, `got ${dupeLog.status}`);
  const loggedRecord = (await must('amember', 'GET', '/attendance')).own.find((r) => r.record_date === yesterday);
  check(
    'manually-logged record is auto-approved with a computed category',
    loggedRecord?.validation_status === 'approved' && !!loggedRecord?.category,
    `got ${JSON.stringify(loggedRecord)}`
  );
  // Post-validation correction: a validator can still re-decide an
  // already-approved record (not just ones sitting in the pending queue).
  const reReject = await req('ahead', 'POST', `/attendance/${loggedRecord.id}/validate`, { status: 'rejected' });
  check('ahead CAN re-decide an already-approved record', reReject.status === 200, `got ${reReject.status}`);

  console.log('\n== Attachment ACLs follow the owning entity ==');
  const finEntry = (
    await must('ceo', 'POST', `/finance/projects/${project}/entries`, { type: 'expense', amount: 42 })
  ).id;
  const finAttach = await fetch(`${BASE}/attachments?entity_type=finance&entity_id=${finEntry}&filename=receipt.txt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', Cookie: sessions.ceo, ...CSRF },
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
    { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Cookie: sessions.bhead, ...CSRF }, body: 'x' }
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
  // Editing title/dueDate is CEO-only, even for a head granted completion rights.
  const aheadMsEdit = await req('ahead', 'PATCH', `/milestones/${msId}`, { title: 'renamed by head' });
  const msAfterHeadEdit = (await must('ceo', 'GET', `/projects/${project}/milestones`)).milestones.find((m) => m.id === msId);
  check(
    'ahead (granted dept head) CANNOT rename milestone (CEO-only field)',
    aheadMsEdit.status === 200 && msAfterHeadEdit.title === `Iso milestone ${TS}`,
    `got title=${msAfterHeadEdit.title}`
  );
  const ceoMsEdit = await must('ceo', 'PATCH', `/milestones/${msId}`, { title: 'Renamed by CEO', dueDate: '2026-12-31' });
  const msAfterCeoEdit = (await must('ceo', 'GET', `/projects/${project}/milestones`)).milestones.find((m) => m.id === msId);
  check(
    'CEO CAN rename milestone and set due date',
    msAfterCeoEdit.title === 'Renamed by CEO' && msAfterCeoEdit.due_date === '2026-12-31',
    `got title=${msAfterCeoEdit.title} due=${msAfterCeoEdit.due_date}`
  );
  void ceoMsEdit;

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

  console.log('\n== Finance entry editing ==');
  const finEditEntry = (await must('ceo', 'POST', `/finance/projects/${project}/entries`, { type: 'expense', amount: 100, category: 'iso-test' })).id;
  const headEditEntry = await req('ahead', 'PATCH', `/finance/entries/${finEditEntry}`, { amount: 1 });
  check('non-finance user DENIED editing entries', denied(headEditEntry), `got ${headEditEntry.status}`);
  const badAmount = await req('ceo', 'PATCH', `/finance/entries/${finEditEntry}`, { amount: -5 });
  check('negative amount rejected', badAmount.status === 400, `got ${badAmount.status}`);
  const emptyPatch = await req('ceo', 'PATCH', `/finance/entries/${finEditEntry}`, {});
  check('empty patch rejected', emptyPatch.status === 400, `got ${emptyPatch.status}`);
  await must('ceo', 'PATCH', `/finance/entries/${finEditEntry}`, { amount: 250, category: 'corrected', note: 'fixed' });
  const ledger = await must('ceo', 'GET', `/finance/projects/${project}`);
  const editedEntry = ledger.entries.find((e) => e.id === finEditEntry);
  check(
    'CEO edit persisted (amount + category + note)',
    Number(editedEntry.amount) === 250 && editedEntry.category === 'corrected' && editedEntry.note === 'fixed',
    `got ${JSON.stringify({ amount: editedEntry.amount, category: editedEntry.category, note: editedEntry.note })}`
  );
  await must('ceo', 'DELETE', `/finance/entries/${finEditEntry}`);

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
    headers: { 'Content-Type': 'application/json', ...CSRF },
    body: JSON.stringify({ email: `iso.victim.${TS}@latechs.org`, password: PW }),
  });
  check('deactivated user DENIED login', victimLogin.status === 401, `got ${victimLogin.status}`);
  const assignInactive = await req('ceo', 'POST', `/departments/${deptA}/members`, { userId: victim });
  check('CEO DENIED assigning deactivated user', assignInactive.status === 400, `got ${assignInactive.status}`);

  console.log('\n== Permanent deletion (PII erasure, not a row DELETE) ==');
  const activeDelete = await req('ceo', 'POST', `/users/${aMember}/permanent-delete`);
  check('CEO DENIED permanent-delete of a still-active user', activeDelete.status === 409, `got ${activeDelete.status}`);
  const headDelete = await req('ahead', 'POST', `/users/${victim}/permanent-delete`);
  check('ahead DENIED permanent-delete', denied(headDelete), `got ${headDelete.status}`);
  const ceoData = await must('ceo', 'GET', '/auth/me');
  const ceoDeleteSelf = await req('ceo', 'POST', `/users/${ceoData.user.id}/permanent-delete`);
  check('CEO DENIED deleting the CEO account', ceoDeleteSelf.status === 400, `got ${ceoDeleteSelf.status}`);
  const deleteOk = await req('ceo', 'POST', `/users/${victim}/permanent-delete`);
  check('CEO CAN permanently delete a deactivated user', deleteOk.status === 200, `got ${deleteOk.status}`);
  const usersAfterDelete = await must('ceo', 'GET', '/users');
  const deletedRow = usersAfterDelete.users.find((u) => u.id === victim);
  check(
    'deleted user shows anonymized name + deleted_at set',
    deletedRow?.name === 'Deleted User' && !!deletedRow?.deleted_at,
    `got name=${deletedRow?.name} deleted_at=${deletedRow?.deleted_at}`
  );
  const redeleteBlocked = await req('ceo', 'POST', `/users/${victim}/permanent-delete`);
  check('CEO DENIED deleting an already-deleted user', redeleteBlocked.status === 409, `got ${redeleteBlocked.status}`);
  const deletedLogin = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...CSRF },
    body: JSON.stringify({ email: `iso.victim.${TS}@latechs.org`, password: PW }),
  });
  check('permanently-deleted user still DENIED login', deletedLogin.status === 401, `got ${deletedLogin.status}`);
  // Archiving a department with members is blocked.
  const archiveWithMembers = await req('ceo', 'PATCH', `/departments/${deptA}`, { archive: true });
  check('CEO DENIED archiving department with members', archiveWithMembers.status === 409, `got ${archiveWithMembers.status}`);
  // Login rate limiting: 10 bad attempts → 429.
  for (let i = 0; i < 10; i++) {
    await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...CSRF },
      body: JSON.stringify({ email: `iso.brute.${TS}@latechs.org`, password: 'wrong' }),
    });
  }
  const brute = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...CSRF },
    body: JSON.stringify({ email: `iso.brute.${TS}@latechs.org`, password: 'wrong' }),
  });
  check('login rate-limited after repeated failures', brute.status === 429, `got ${brute.status}`);

  console.log('\n== Salary payments: draft/paid lifecycle ==');
  await must('ceo', 'POST', `/salary/${aMember}/assign`, { amount: 50000 });
  const payDenied = await req('ahead', 'POST', `/salary/${aMember}/payments`, { period: '2026-01' });
  check('ahead DENIED creating salary payments', denied(payDenied), `got ${payDenied.status}`);
  const pay = await must('ceo', 'POST', `/salary/${aMember}/payments`, { period: '2026-01' });
  const markPaidDenied = await req('ahead', 'POST', `/salary/payments/${pay.id}/mark-paid`);
  check('ahead DENIED marking a payment paid', denied(markPaidDenied), `got ${markPaidDenied.status}`);
  const deleteDeniedNonCeo = await req('ahead', 'DELETE', `/salary/payments/${pay.id}`);
  check('ahead DENIED deleting a payment', denied(deleteDeniedNonCeo), `got ${deleteDeniedNonCeo.status}`);
  const markPaidOk = await req('ceo', 'POST', `/salary/payments/${pay.id}/mark-paid`);
  check('CEO CAN mark a draft payment paid', markPaidOk.status === 200, `got ${markPaidOk.status}`);
  const remarkPaid = await req('ceo', 'POST', `/salary/payments/${pay.id}/mark-paid`);
  check('CEO DENIED re-marking an already-paid payment', remarkPaid.status === 409, `got ${remarkPaid.status}`);
  const deletePaidBlocked = await req('ceo', 'DELETE', `/salary/payments/${pay.id}`);
  check('CEO DENIED deleting a paid payment', deletePaidBlocked.status === 409, `got ${deletePaidBlocked.status}`);
  const pay2 = await must('ceo', 'POST', `/salary/${aMember}/payments`, { period: '2026-02' });
  const deleteDraftOk = await req('ceo', 'DELETE', `/salary/payments/${pay2.id}`);
  check('CEO CAN delete a draft payment', deleteDraftOk.status === 200, `got ${deleteDraftOk.status}`);
  const historyAfterDelete = await must('ceo', 'GET', `/salary/${aMember}/payments`);
  check(
    'deleted draft payment removed from history',
    !historyAfterDelete.payments.some((p) => p.id === pay2.id),
    'still present'
  );

  console.log('\n== Chat: membership + message ownership ==');
  const chatGroup = (
    await must('ceo', 'POST', '/chat/groups', { name: `Iso Chat ${TS}`, memberIds: [aHead, aMember] })
  ).id;
  const outsiderMsgs = await req('bhead', 'GET', `/chat/groups/${chatGroup}/messages`);
  check('non-member DENIED reading group messages', denied(outsiderMsgs), `got ${outsiderMsgs.status}`);
  const outsiderPost = await req('bhead', 'POST', `/chat/groups/${chatGroup}/messages`, { body: 'intruder' });
  check('non-member DENIED posting', denied(outsiderPost), `got ${outsiderPost.status}`);
  const msg = await must('ahead', 'POST', `/chat/groups/${chatGroup}/messages`, { body: 'original text' });
  const otherEdit = await req('amember', 'PATCH', `/chat/groups/${chatGroup}/messages/${msg.id}`, { body: 'hijacked' });
  check("member DENIED editing someone else's message", otherEdit.status === 403, `got ${otherEdit.status}`);
  const otherDelete = await req('amember', 'DELETE', `/chat/groups/${chatGroup}/messages/${msg.id}`);
  check("member DENIED deleting someone else's message", otherDelete.status === 403, `got ${otherDelete.status}`);
  const ceoEditOther = await req('ceo', 'PATCH', `/chat/groups/${chatGroup}/messages/${msg.id}`, { body: 'ceo rewrite' });
  check("even the CEO DENIED editing someone else's message", ceoEditOther.status === 403, `got ${ceoEditOther.status}`);
  const ownEdit = await req('ahead', 'PATCH', `/chat/groups/${chatGroup}/messages/${msg.id}`, { body: 'corrected text' });
  check('author CAN edit their own message', ownEdit.status === 200, `got ${ownEdit.status}`);
  const msgsAfterEdit = await must('ahead', 'GET', `/chat/groups/${chatGroup}/messages`);
  const editedMsg = msgsAfterEdit.messages.find((m) => m.id === msg.id);
  check(
    'edit persisted with edited_at stamp',
    editedMsg.body === 'corrected text' && !!editedMsg.edited_at,
    `got body=${editedMsg.body} edited_at=${editedMsg.edited_at}`
  );
  const ownDelete = await req('ahead', 'DELETE', `/chat/groups/${chatGroup}/messages/${msg.id}`);
  check('author CAN delete their own message', ownDelete.status === 200, `got ${ownDelete.status}`);
  const msgsAfterDelete = await must('ahead', 'GET', `/chat/groups/${chatGroup}/messages`);
  check(
    'deleted message gone from the stream',
    !msgsAfterDelete.messages.some((m) => m.id === msg.id),
    'still present'
  );
  await must('ceo', 'DELETE', `/chat/groups/${chatGroup}`);

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

  console.log('\n== Destructive CRUD is CEO-only ==');
  const headDelTask = await req('ahead', 'DELETE', `/tasks/${deptTask}`);
  check('head DENIED deleting a task (even own-dept)', denied(headDelTask), `got ${headDelTask.status}`);
  const memberDelTask = await req('amember', 'DELETE', `/tasks/${deptTask}`);
  check('member DENIED deleting a task', denied(memberDelTask), `got ${memberDelTask.status}`);
  const headDelProject = await req('ahead', 'DELETE', `/projects/${project}`);
  check('head DENIED deleting a project (even granted)', denied(headDelProject), `got ${headDelProject.status}`);
  const throwawayTask = (await must('ceo', 'POST', '/tasks', { title: `Iso throwaway ${TS}`, departmentId: deptA })).id;
  const ceoDelTask = await req('ceo', 'DELETE', `/tasks/${throwawayTask}`);
  check('CEO CAN delete a task', ceoDelTask.status === 200, `got ${ceoDelTask.status}`);
  const throwawayProject = (
    await must('ceo', 'POST', '/projects', { name: `Iso throwaway proj ${TS}`, departmentIds: [], startDate: '2026-01-01', endDate: '2026-12-31' })
  ).id;
  const ceoDelProject = await req('ceo', 'DELETE', `/projects/${throwawayProject}`);
  check('CEO CAN delete a project', ceoDelProject.status === 200, `got ${ceoDelProject.status}`);

  console.log('\n== Security layer: CSRF + session revocation + headers ==');
  // Mutations without the custom header are rejected before any handler runs.
  const noCsrf = await fetch(`${BASE}/departments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessions.ceo },
    body: JSON.stringify({ name: 'csrf-test' }),
  });
  check('mutation without CSRF header rejected (even authenticated)', noCsrf.status === 403, `got ${noCsrf.status}`);
  const getOk = await req('ceo', 'GET', '/departments');
  check('GETs work without CSRF header requirements breaking them', getOk.status === 200, `got ${getOk.status}`);
  // Security headers present on API responses.
  const headerProbe = await fetch(`${BASE}/auth/me`, { headers: { Cookie: sessions.ceo } });
  check(
    'security headers present (nosniff + frame deny)',
    headerProbe.headers.get('x-content-type-options') === 'nosniff' &&
      headerProbe.headers.get('x-frame-options') === 'DENY',
    `got ${headerProbe.headers.get('x-content-type-options')}/${headerProbe.headers.get('x-frame-options')}`
  );
  // Password change revokes other sessions (token versioning).
  const rotator = (
    await must('ceo', 'POST', '/users', { name: 'Iso Rotator', email: `iso.rotator.${TS}@latechs.org`, password: PW })
  ).id;
  void rotator;
  await login('rotator1', `iso.rotator.${TS}@latechs.org`, PW);
  await login('rotator2', `iso.rotator.${TS}@latechs.org`, PW); // second device
  const r1Before = await req('rotator1', 'GET', '/auth/me');
  check('first session valid before password change', r1Before.status === 200, `got ${r1Before.status}`);
  const changeRes = await fetch(`${BASE}/auth/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessions.rotator2, ...CSRF },
    body: JSON.stringify({ currentPassword: PW, newPassword: `${PW}-new` }),
  });
  check('password change succeeds', changeRes.status === 200, `got ${changeRes.status}`);
  // The changing device gets a fresh cookie and stays signed in.
  sessions.rotator2 = changeRes.headers.get('set-cookie')?.split(';')[0] ?? sessions.rotator2;
  const r1After = await req('rotator1', 'GET', '/auth/me');
  check('other session revoked after password change', r1After.status === 401, `got ${r1After.status}`);
  const r2After = await req('rotator2', 'GET', '/auth/me');
  check('changing device stays signed in', r2After.status === 200, `got ${r2After.status}`);

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
