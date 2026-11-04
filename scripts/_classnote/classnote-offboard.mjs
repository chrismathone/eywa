// scripts/_classnote/classnote-offboard.mjs — **전 과목 퇴원 45일 뒤 ClassNote 명부 퇴원처리(퇴소)** 흐름(연동 PC 워커). 판정 = classnote-offboard-plan.mjs ·
// ClassNote 읽기·쓰기와 백업 올리기 = classnote-offboard-io.mjs.
//
// 원장 2026-11-03 *"남은 수강과목이 1개도 없는 경우에는 45일 뒤 자동으로 퇴원처리"* · 학원이 옛 글을 못 보게 돼도 그대로 · **퇴원처리 직전 그 원아의 글·댓글 백업**.
// 매일 정기 동기화(05시) 뒤 하루 1회(math-class-boards-sync.mjs `syncMathClassBoardsDaily`) · 하루 상한 기본 10명(`CLASSNOTE_OFFBOARD_DAILY_LIMIT`).
// 🔴 스위치 기본 = 꺼짐(관찰 모드 · 리뷰 B1) — `CLASSNOTE_OFFBOARD=on`일 때만 실제로 내린다. 꺼져 있으면 판정 + 글·댓글 확인까지만 하고(GET만) 보고서에
//    **상한 없이 전원**의 '퇴원처리 예정(자동 퇴원처리 꺼짐)' 줄(켰을 때 첫날 처리될 앞 N명엔 '켜면 첫날')과 회차 요약 `offboardPlanned`만 남긴다(쓰기 0).
// 멈춤 표식 `classnote-offboard-halt.txt`(퇴소 뒤 확인이 예상과 다르면 남는다 — 지우면 재개).
// 백업 = 비공개 버킷 `classnote-backups/{지점}/offboard/{날짜}/{원아}.json`(내부 라우트가 서명된 올리기 주소를 준다 — 새 SQL 없음).
// 🔴 보호자 전화·주소·병력은 로그·백업·보고서에 싣지 않는다(판정 입력으로만).

import { fetchBoards, fetchChildDetail, fetchChildren } from "./classnote-admin-core.mjs";
import { fetchAdmissions, loadLinkedBoards } from "./math-class-boards-load.mjs";
import { loadChildLinks, loadEnglishRooms } from "./class-board-release-load.mjs";
import { haltMarker } from "./halt-marker.mjs";
import {
  activityUnreadable, backupRestorable, buildOffboardBackup, checkChildPosts, commentsComplete, isPermissionDenied, offboardDailyLimit, offboardEnabled,
  partialFamilyText, planOffboard, rosterConsistency, verifyOffboard,
} from "./classnote-offboard-plan.mjs";
import { fetchChildPosts, fetchPostComments, leftIds, postOffboard, uploadOffboardBackup } from "./classnote-offboard-io.mjs";

export { fetchChildPosts, uploadOffboardBackup } from "./classnote-offboard-io.mjs";

const kstToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
/** 감사로그 머리 — 🔴 `action: "…"` 리터럴(감사로그 레지스트리 가드가 audit_logs를 쓰는 scripts/를 이 모양으로 스캔한다). */
const OFFBOARD_AUDIT = { action: "classnote_offboard", actor_name: "system:classnote-offboard" };
/** 퇴소를 요청했는데 명부로 확인하지 못한 원아(재원 명부엔 없는데 퇴소 명부에 없음 · 확인 조회 실패 · 그대로 남음) — 결과와 무관하게 남긴다(B2). */
const OFFBOARD_UNCONFIRMED_AUDIT = { action: "classnote_offboard_unconfirmed", actor_name: "system:classnote-offboard" };
/** 같은 묶음 앞 계정의 퇴소 요청이 실패해 남은 계정을 요청하지 않을 때의 사유(G1). */
const SIBLING_REQUEST_FAILED = "같은 학생의 다른 원아 계정 요청이 실패해 함께 둡니다(오늘은 요청하지 않았습니다)";

const OFFBOARD_HALT = haltMarker("classnote-offboard-halt.txt");
/** 멈춤 표식 사유(파일 || 메모리 — 파일을 못 썼어도 이 프로세스는 막힌다 · halt-marker.mjs). 없으면 빈 글. */
export function offboardHaltReason() {
  return OFFBOARD_HALT.reason();
}
function haltOffboard(reason) {
  OFFBOARD_HALT.set(reason);
}
/** 테스트용 — 메모리 표식을 지운다. */
export function resetOffboardHaltForTest() {
  OFFBOARD_HALT.resetForTest();
}

/**
 * aywa 쪽 사실(DB 읽기만) — 학생·전 과목 수강 요약·원아 연결·반 보드 확인 기록·퇴원 뒤 돈 흔적·퇴원생의 마지막 출결·수업보고서(B10) ·
 * 에이와 반에 이어진 보드 번호(⑧ 전체방 판정 — 영어 반 방 표를 못 읽으면 null: 전체방을 정하지 않아 아무도 내리지 않는다).
 */
export async function loadOffboardFacts(sql, tenant, today = kstToday()) {
  // 퇴원 뒤 활동 가드(B10)를 믿을 수 있나 먼저 본다 — 그 지점의 가장 최근 출결·수업보고서가 읽혀야 한다. 연동 PC 역할에 권한이 없으면(42501)
  // 또는 정책이 빠져 0행이면 '보류'로 돌리고 나머지는 읽지 않는다(R9 · s2_0021). 그 밖의 오류는 그대로 던진다.
  const latest = async (q) => {
    try {
      const [r] = await q;
      return { date: r?.last_date ?? null, denied: false };
    } catch (e) {
      if (isPermissionDenied(e)) return { date: null, denied: true };
      throw e;
    }
  };
  // 오늘(KST)까지만 — 미래 날짜 줄(미리 찍은 출결 등 · 실측 최대 출결일이 내일)이 '최근에 읽힘'으로 보여 방어를 끄지 않게(2차 리뷰 F8).
  const lastAttendance = await latest(sql`select max(a.session_date)::text as last_date from attendance_records a where a.tenant_id = ${tenant} and a.session_date <= ${today}`);
  const lastReport = await latest(sql`select max(r.report_date)::text as last_date from lesson_reports r where r.tenant_id = ${tenant} and r.report_date <= ${today}`);
  const unreadable = activityUnreadable({ lastAttendance, lastReport, today });
  if (unreadable) return { unreadable };
  const students = await sql`select id, name, classnote_name, status::text as status, withdrawn_at::text as withdrawn_at, coalesce(is_test, false) as is_test, notes,
      parent_phone, student_phone, home_phone, other_phone
    from students where tenant_id = ${tenant}`;
  const enr = await sql`select student_id, bool_or(end_date is null or end_date >= ${today}) as open, max(end_date)::text as last_end
    from enrollments where tenant_id = ${tenant} and student_id is not null group by student_id`;
  const verified = await sql`select child_id, student_id from classnote_class_board_members where tenant_id = ${tenant} and status = 'ok' and child_id is not null`;
  const billing = await sql`select student_id, max(period) as last_period, max((paid_at at time zone 'Asia/Seoul')::date)::text as last_paid
    from invoices where tenant_id = ${tenant} and student_id is not null and status::text <> 'void' group by student_id`;
  // 퇴원생만 — 수강 행 없이 자리·보강으로 다닌 흔적(퇴원일 뒤 출결·수업보고서)을 본다(리뷰 B10).
  const attended = await sql`select a.student_id, max(a.session_date)::text as last_date from attendance_records a
    where a.tenant_id = ${tenant} and a.student_id in (select s.id from students s where s.tenant_id = ${tenant} and s.status = 'withdrawn')
    group by a.student_id`;
  const reported = await sql`select r.student_id, max(r.report_date)::text as last_date from lesson_reports r
    where r.tenant_id = ${tenant} and r.student_id in (select s.id from students s where s.tenant_id = ${tenant} and s.status = 'withdrawn')
    group by r.student_id`;
  const childLinks = await loadChildLinks(sql, tenant);
  const mathLinks = await loadLinkedBoards(sql, tenant);
  const rooms = await loadEnglishRooms(sql, tenant);
  const verifiedOwners = new Map();
  for (const r of verified) {
    const id = Number(r.child_id);
    verifiedOwners.set(id, new Set([...(verifiedOwners.get(id) ?? []), r.student_id]));
  }
  const activity = new Map();
  for (const r of attended) activity.set(r.student_id, { ...(activity.get(r.student_id) ?? {}), lastAttendance: r.last_date ?? null });
  for (const r of reported) activity.set(r.student_id, { ...(activity.get(r.student_id) ?? {}), lastReport: r.last_date ?? null });
  return {
    // 이름 두 벌 — 같은 이름·1인 보드·원아 이름 판정은 에이와 이름과 ClassNote 이름을 다 본다(리뷰 2026-11-03).
    students: new Map(students.map((s) => [s.id, {
      id: s.id, name: (s.name || s.classnote_name || "").trim(), names: [s.name, s.classnote_name].map((x) => String(x ?? "").trim()).filter(Boolean),
      status: s.status, withdrawnAt: s.withdrawn_at ?? null, isTest: s.is_test === true, notes: s.notes ?? null,
      phones: [s.parent_phone, s.student_phone, s.home_phone, s.other_phone],
    }])),
    linkedBoardIds: rooms ? [...mathLinks.values(), ...rooms.map((r) => r.boardId)] : null,
    enrollment: new Map(enr.map((r) => [r.student_id, { open: !!r.open, lastEnd: r.last_end ?? null }])),
    childLinks,
    verifiedOwners,
    billing: new Map(billing.map((r) => [r.student_id, { lastPeriod: r.last_period ?? null, lastPaidAt: r.last_paid ?? null }])),
    activity,
  };
}

/** 재원 명부 원아 번호(캐시 없이 — fetchAdmissions가 no-store). */
async function rosterIds(page, centerId) {
  return new Set([...(await fetchAdmissions(page, centerId)).keys()].map(Number));
}

const line = (group, text, name = null) => ({ group, className: "명부 퇴원처리", text: String(text).slice(0, 500), ...(name ? { name } : {}) });
const who = (c) => `${c.childName}${c.studentName && c.studentName !== c.childName ? `(${c.studentName})` : ""}`;

/**
 * 퇴소 요청 뒤 확인 — 2초 간격으로 최대 5번 명부를 다시 읽는다(반영이 늦은 것을 '처리 안 됨'으로 오판하지 않게 · B2).
 * 다른 원아가 사라졌으면 곧바로 멈춤(halt). 확인 조회가 실패하면 throw — 호출자가 멈춤 표식을 남긴다.
 */
async function confirmOffboard(page, { centerId, before, childId, year, waitMs, times }) {
  let v = null;
  let after = new Set();
  for (let i = 0; i < times; i++) {
    await page.waitForTimeout(waitMs);
    after = await rosterIds(page, centerId);
    const left = await leftIds(page, centerId, year);
    v = verifyOffboard({ before, after, left, childId });
    if (v.ok || v.halt) break;
  }
  return { ...v, stillListed: after.has(Number(childId)) };
}

/**
 * 하루 1회 — 판정 → (원아마다) 글 목록 → ⑦ → 학부모 정보 → (켜졌을 때만) 댓글 → 백업 → 퇴소 → 명부 재조회 확인.
 * `apply` = 정기 동기화가 부를 때 true. 그래도 스위치가 꺼져 있으면(기본) **관찰 모드** — 상한 없이 전원을 '퇴원처리 예정' 줄로 남긴다(쓰기 0 · 첫날 몫은 표식).
 * `apply=false`(드라이런)는 상한 없이 전원을 확인하고 줄은 남기지 않는다.
 * `events` = 동기화 보고서 줄 · `done` = 실제로 내린 원아 · `attempted` = 퇴소를 요청한 원아 전부(결과 `outcome` — 감사로그용, 멈춰도 남는다).
 * @returns {Promise<{ skipped?:string, mode:"live"|"observe"|"dry", plan:object|null, checked:object[], done:object[], failed:object[], planned:object[] }>}
 */
export async function runOffboard(sql, page, {
  tenant, centerId, apply = false, log = console.log, events = [], done = [], attempted = [], env = process.env, today = kstToday(), fetchImpl = fetch,
  confirmWaitMs = 2000, confirmTimes = 5,
}) {
  const live = apply && offboardEnabled(env);
  const mode = live ? "live" : apply ? "observe" : "dry";
  const planned = [];
  const halted = offboardHaltReason();
  if (halted && live) {
    events.push(line("held", `명부 퇴원처리가 멈춰 있어 이번에는 하지 않았습니다 — 이전 실행에서 예상 밖 변화가 있었습니다(${halted}). ClassNote에서 확인한 뒤 연동 PC의 멈춤 표식 파일(classnote-offboard-halt.txt)을 지우면 다시 시작합니다`));
    return { skipped: "halted", mode, plan: null, checked: [], done, failed: [], planned };
  }
  // 관찰 모드도 멈춤 표식을 본다 — 표식이 있으면 켜도 0명이라 '켜면 첫날'을 붙이지 않는다(3차 리뷰 G2 · 첫날 몫의 상세·댓글 GET도 안 한다).
  const observeHalted = mode === "observe" && !!halted;
  if (observeHalted)
    events.push(line("held", `명부 퇴원처리 멈춤 표식이 있어 켜도 퇴원처리하지 않습니다(${halted}) — 연동 PC의 멈춤 표식 파일(classnote-offboard-halt.txt)을 지우면 다시 시작합니다`));
  const facts = await loadOffboardFacts(sql, tenant, today);
  if (facts.unreadable) {
    // 실패가 아니라 보류 — 권한·정책이 빠진 동안 매일 실패 수가 쌓이지 않게(R9).
    events.push(line("held", facts.unreadable));
    return { skipped: "activity_unreadable", mode, plan: null, checked: [], done, failed: [], planned };
  }
  const admissions = await fetchAdmissions(page, centerId);
  // 원아 목록 이름(학부모가 바꿀 수 있다 — 같은 이름 판정에 함께) · 센터 보드 전부(⑧ 전체방 판정). 못 읽으면 throw — 오늘은 하지 않는다.
  const childNames = new Map((await fetchChildren(page, centerId)).map((c) => [Number(c.id), c.name]));
  const centerBoards = await fetchBoards(page, centerId);
  const plan = planOffboard({ ...facts, admissions, today, childNames, centerBoards });
  // 회차 건전성(B3) — 명부의 전체방 배정 수와 전체방 보드 원아 수가 크게 다르면 그날은 하지 않는다(드라이런은 그 사실만 보여 준다).
  const inconsistent = rosterConsistency({ admissions, centerBoards, wideIds: new Set(plan.centerWideIds) });
  if (inconsistent && mode !== "dry") {
    events.push(line("held", inconsistent));
    return { skipped: "inconsistent", mode, plan, checked: [], done, failed: [], planned };
  }
  if (mode !== "dry") for (const x of plan.excluded) events.push(line("held", `퇴원처리 보류: ${who(x)} — ${x.why}`, x.studentName));
  const limit = offboardDailyLimit(env);
  const checked = [];
  const failed = [];
  let count = 0;
  // 한 학생의 원아(학부모·학생 두 계정 등)는 묶어서 본다 — 하나라도 ClassNote 확인·백업에서 걸리면 그 학생 원아는 모두 둔다 ·
  // 하루 상한이 한 집을 가르지 않게(묶음째 다음 날로).
  const groups = [];
  for (const c of plan.candidates) {
    const g = groups.find((x) => x.studentId === c.studentId);
    if (g) g.items.push(c);
    else groups.push({ studentId: c.studentId, studentName: c.studentName, items: [c] });
  }
  let deferred = 0;
  let softFails = 0; // 요청이 실패(200 아님)하고 명부에 남은 원아가 연달아 몇 명인가(F6 — 2명이면 그날 그만)
  const gets = { postPages: 0, details: 0, comments: 0 }; // ClassNote GET 수(글 목록 쪽 · 원아 상세 · 댓글 요청) — 비용 점검용
  // 관찰 모드는 상한 없이 전원을 적는다(아무것도 안 바꾸니 상한을 걸면 매일 같은 앞 N명만 보인다 · 리뷰 R1) — 대신 켰을 때 **첫날** 처리될
  // 앞 N명(묶음 경계 규칙 그대로)에 '켜면 첫날' 표식을 단다. `firstDayOpen` = 아직 첫날 몫을 채우는 중.
  let firstDayOpen = mode === "observe" && !observeHalted;
  nextGroup: for (const [gi, g] of groups.entries()) {
    if (mode === "live" && count > 0 && count + g.items.length > limit) { deferred = groups.slice(gi).reduce((n, x) => n + x.items.length, 0); break; }
    if (firstDayOpen && count > 0 && count + g.items.length > limit) firstDayOpen = false;
    // ⑦ 원아마다 글 목록 · 학부모 정보 · (실행 · 관찰 첫날 몫) 댓글 → 백업 본문.
    //   관찰 모드는 **'켜면 첫날' 몫만** 실행과 같은 확인(학부모 정보 · 댓글 · R7)을 하고, 그 밖은 글 목록(⑦)까지만(2차 리뷰 F5 — 대상 전원의 글·댓글을
    //   매일 다 받으면 05시 동기화를 붙든다). 첫날 몫 안에서 보류되면 실행처럼 다음 묶음이 첫날 몫으로 들어온다(count는 준비된 묶음만 센다).
    const full = mode === "live" || (mode === "observe" && firstDayOpen);
    const ready = [];
    let why = null;
    for (const c of g.items) {
      const got = await fetchChildPosts(page, centerId, c.childId).catch(() => ({ complete: false, posts: [], pages: 0 }));
      gets.postPages += got.pages ?? 0;
      const pc = checkChildPosts(got, today);
      if (!pc.ok) { why = { c, text: pc.why, posts: got.posts.length }; break; }
      if (mode === "observe" && !full) { ready.push({ c, backup: null, posts: got.posts.length, lastPostAt: pc.lastPostAt }); continue; }
      const detail = await fetchChildDetail(page, c.childId).catch(() => null);
      gets.details++;
      let comments = new Map();
      // 댓글은 실행과 관찰의 첫날 몫만 받는다(GET만). 드라이런은 안 받는다.
      if (full) {
        const ids = got.posts.filter((p) => Number(p.num_comments) > 0).map((p) => Number(p.id));
        const cm = ids.length ? await fetchPostComments(page, ids).catch(() => ({ complete: new Set(), byPost: new Map(), requests: 0 })) : { complete: new Set(), byPost: new Map(), requests: 0 };
        gets.comments += cm.requests ?? 0;
        if (!commentsComplete(got.posts, cm)) { why = { c, text: "댓글을 끝까지 받지 못했습니다 — 백업할 수 없어 내리지 않습니다", posts: got.posts.length }; break; }
        comments = cm.byPost;
      }
      const backup = buildOffboardBackup({
        child: { id: c.childId, name: c.childName }, student: { id: c.studentId, name: c.studentName }, detail, posts: got.posts, comments,
        baseDate: c.baseDate, days: c.days, at: new Date().toISOString(), tenant, centerId,
      });
      if (!detail || !backupRestorable(backup)) { why = { c, text: "되돌릴 때 필요한 학부모 정보를 읽지 못했습니다(재초대 대상을 모르면 내리지 않습니다)", posts: got.posts.length }; break; }
      ready.push({ c, backup, posts: got.posts.length, lastPostAt: pc.lastPostAt });
    }
    if (why) {
      for (const c of g.items) {
        const text = c === why.c ? why.text : "같은 학생의 다른 원아 계정이 보류돼 함께 둡니다";
        checked.push({ ...c, ok: false, why: text, posts: c === why.c ? why.posts : null });
        if (mode !== "dry") events.push(line("held", `퇴원처리 보류: ${who(c)} — ${text}`, c.studentName));
      }
      continue;
    }
    for (const r of ready) checked.push({ ...r.c, ok: true, posts: r.posts, lastPostAt: r.lastPostAt });
    if (mode === "dry") continue;
    if (mode === "observe") {
      const firstDay = firstDayOpen;
      if (firstDay) count += ready.length;
      for (const r of ready) {
        planned.push({ ...r.c, posts: r.posts, firstDay });
        events.push(line("held", `퇴원처리 예정(자동 퇴원처리 꺼짐): ${who(r.c)} — 퇴원 ${r.c.days}일 · 글 ${r.posts}건${firstDay ? " · 켜면 첫날" : ""}`, r.c.studentName));
      }
      continue;
    }
    count += ready.length;
    // 백업 — 묶음을 전부 올린 뒤에야 내린다(하나라도 실패하면 그 학생 원아는 하나도 내리지 않는다).
    const saved = new Map();
    let backupError = null;
    for (const r of ready) {
      try {
        saved.set(r.c.childId, await uploadOffboardBackup({ tenant, childId: r.c.childId, date: today, body: r.backup, env, fetchImpl }));
      } catch (e) {
        // 보고서·감사로그엔 한국어 요약만(R10) — 원문은 연동 PC 로그로만.
        backupError = `글 목록 백업 실패 — ${e?.korean ? e.message : "백업을 올리지 못했습니다"}`;
        log(`[offboard] 백업 실패 원문 — ${String(e?.raw ?? e?.message ?? e).slice(0, 200)}`);
        break;
      }
    }
    if (backupError) {
      for (const r of ready) { failed.push({ ...r.c, why: backupError }); events.push(line("failed", `퇴원처리 안 함: ${who(r.c)} — ${backupError}`, r.c.studentName)); }
      continue;
    }
    // 퇴소 — 원아마다 직전 명부 → 요청(한 원아씩) → 재조회 확인. 한 집 중 일부만 내리고 멈추면 그 사실을 따로 적는다(B12).
    let doneInGroup = 0;
    const familyLine = () => {
      const t = partialFamilyText({ studentName: g.studentName ?? g.items[0].studentName, total: g.items.length, done: doneInGroup });
      if (t) events.push(line("failed", t, g.studentName));
    };
    // 요청이 실패(200 아님)하면 같은 묶음의 남은 계정은 요청하지 않는다 — 한 집을 반만 내리지 않게(3차 리뷰 G1).
    const holdRest = (i) => {
      for (const rest of ready.slice(i + 1)) {
        failed.push({ ...rest.c, why: SIBLING_REQUEST_FAILED });
        events.push(line("failed", `퇴원처리 안 함: ${who(rest.c)} — ${SIBLING_REQUEST_FAILED}`, rest.c.studentName));
      }
    };
    for (const [i, r] of ready.entries()) {
      const c = r.c;
      const before = await rosterIds(page, centerId);
      if (!before.has(c.childId)) { failed.push({ ...c, why: "그 사이 재원 명부에서 이미 빠졌습니다" }); events.push(line("failed", `퇴원처리 안 함: ${who(c)} — 그 사이 재원 명부에서 이미 빠졌습니다`, c.studentName)); continue; }
      // 🔴 요청 **직전에** 시도 목록에 넣는다 — 그 뒤에 무슨 일이 나도 감사로그가 남는다(B2).
      const entry = { ...c, outcome: "pending", why: null, backupPath: saved.get(c.childId)?.path ?? null, posts: r.posts };
      attempted.push(entry);
      let status = 0;
      let v;
      try {
        status = await postOffboard(page, centerId, c.childId);
        v = await confirmOffboard(page, { centerId, before, childId: c.childId, year: Number(today.slice(0, 4)), waitMs: confirmWaitMs, times: confirmTimes });
      } catch (e) {
        // 요청·확인 단계의 **모든** 예외 = 멈춤 — 요청이 먹었는지 모르는 채로 다음 원아로 가지 않는다(B2).
        entry.outcome = "unconfirmed";
        // 보고서·감사로그 화면엔 한국어 요약만(R10) — 원문은 로그와 감사로그 메타데이터의 raw(화면에 안 쓰는 칸)로만.
        entry.why = "퇴원처리 요청 뒤 명부를 다시 읽지 못했습니다";
        entry.raw = String(e?.message ?? e).slice(0, 300);
        log(`[offboard] 퇴원처리 확인 실패 원문 — ${entry.raw}`);
        failed.push({ ...c, why: entry.why });
        events.push(line("failed", `퇴원처리 확인 실패: ${who(c)} — ${entry.why}`, c.studentName));
        familyLine();
        haltOffboard(`${c.childName}: ${entry.why}`);
        throw Object.assign(new Error(`명부 퇴원처리 멈춤 — ${c.childName}: ${entry.why}`), { haltOffboard: true });
      }
      if (!v.ok) {
        entry.outcome = "unconfirmed";
        entry.why = v.why;
        failed.push({ ...c, why: v.why });
        events.push(line("failed", `퇴원처리 실패: ${who(c)} — ${v.why}${status === 200 ? "" : ` (요청 응답 HTTP ${status})`}`, c.studentName));
        // 멈춤(표식 — 사람이 볼 때까지 다음 날도 안 한다):
        //   · 다른 원아가 함께 사라짐(v.halt)
        //   · 재원 명부에서는 빠졌는데 퇴소 명부에 없다 — 퇴소가 아닌 다른 동작(삭제 등)일 수 있다(R5 · 감사로그 '확인 실패'는 그대로)
        //   · 요청 응답은 200인데 재원 명부에 그대로 남았다 — 실측(200 = 처리)과 다르게 움직였다(R4)
        const stop = v.halt || !v.stillListed || status === 200;
        if (stop) {
          familyLine();
          haltOffboard(`${c.childName}: ${v.why}`);
          throw Object.assign(new Error(`명부 퇴원처리 멈춤 — ${c.childName}: ${v.why}`), { haltOffboard: true });
        }
        // 요청이 실패했고(200 아님 · 일시 오류) 명부에 그대로 남았다 — 그 원아만 오늘 실패(감사로그 '확인 실패')로 두고 다음 원아로 간다.
        //   맨 앞 원아에서 그날을 접으면 뒤 원아 전원이 영영 못 넘어간다(2차 리뷰 F6). 같은 회차에 이 꼴이 2명 연속이면 그날 그만(멈춤 표식 없음).
        //   같은 묶음의 남은 계정은 요청하지 않고(G1) 다음 묶음으로 간다 — 건너뛴 계정은 softFails를 올리지도 되돌리지도 않는다.
        softFails++;
        holdRest(i);
        familyLine();
        if (softFails >= 2) {
          events.push(line("failed", "퇴원처리 요청이 연달아 실패해 오늘은 여기서 그만둡니다 — 내일 다시 합니다"));
          return { mode, plan, checked, done, failed, planned, gets };
        }
        continue nextGroup;
      }
      softFails = 0;
      entry.outcome = "ok";
      doneInGroup++;
      done.push({ ...c, backupPath: entry.backupPath, posts: r.posts });
      events.push(line("changed", `퇴원처리: ${who(c)} — 퇴원 ${c.days}일 · 글 ${r.posts}건 백업`, c.studentName));
      log(`[offboard] 퇴원처리 ${c.childName} — 퇴원 ${c.days}일 · 글 ${r.posts}건 백업`);
    }
    familyLine();
  }
  if (mode === "live" && deferred) events.push(line("held", `오늘 상한(${limit}명)을 넘은 ${deferred}명은 다음 날 이어서 합니다`));
  if (mode === "observe" && planned.length)
    events.push(line("held", observeHalted
      ? `퇴원처리 예정 ${planned.length}명(자동 퇴원처리 꺼짐) — 멈춤 표식이 있어 켜도 오늘은 퇴원처리하지 않습니다`
      : `퇴원처리 예정 ${planned.length}명(자동 퇴원처리 꺼짐) — 켜면 첫날 ${planned.filter((p) => p.firstDay).length}명(하루 상한 ${limit}명 · 한 집은 나누지 않는다), 나머지는 다음 날부터 차례로`));
  return { mode, plan, checked, done, failed, planned, gets };
}

/** 퇴원처리 감사로그 — 요청한 원아마다 한 줄(성공 = 퇴원처리 · 그 밖 = 확인 실패, 사유 포함). best-effort. */
export async function auditOffboards(sql, tenant, attempted) {
  for (const r of attempted ?? []) {
    const head = r.outcome === "ok" ? OFFBOARD_AUDIT : OFFBOARD_UNCONFIRMED_AUDIT;
    // why = 한국어 요약(화면) · raw = 원문(화면에 안 쓰는 칸 — 조사용)
    const metadata = { studentId: r.studentId, childId: r.childId, childName: r.childName, baseDate: r.baseDate, days: r.days, posts: r.posts ?? null, backupPath: r.backupPath ?? null, outcome: r.outcome ?? null, why: r.why ?? null, ...(r.raw ? { raw: r.raw } : {}) };
    await sql`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
      values (${tenant}, null, ${head.actor_name}, ${head.action}, ${"student"}, ${r.studentName ?? r.childName ?? "학생"}, ${sql.json(metadata)})`.catch(() => {});
  }
}
