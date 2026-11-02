// scripts/_classnote/math-class-boards-sync.mjs — 수학 반 보드 **매일 동기화**(연동 PC 워커, KST 05시 이후 하루 1회).
//
// 원장 2026-09-29: aywa 반 구성이 바뀌면(새 반·신입·반이동·반 이름 변경·담임 변경) ClassNote 반 보드도 따라가게.
// 하는 일 = 새 반 보드 만들기 · 반 이름 바꾸기(연결표 기준) · 원아 추가 배정(가드 통과분만) · 담임 연결 · 0302a 기록 갱신 ·
//   **원아·담임 해제**(원장 2026-10-02 *"반 이름 변경, 학생 배정 및 해제, 강사 배정 및 해제만 에이와와 통일시켜"* ·
//   *"동기화 할때도 자동 해제되게 해줘야해"*) — 그 반 수강이 끝난 학생의 원아를 내보내고, 지금 담당이 아닌 선생님 연결을 푼다.
//   판정 = class-board-release.mjs(가드 9겹 — 이 반 학생의 원아일 수 있으면·누구 원아인지 모르면·수강이 끝난 기록이 없으면 보류).
//   보류한 원아는 지금처럼 '해제 필요'로 반 보드 행에 남는다(0329a 해제 리스트 — 사람이 확인).
// 🔴 반 보드만 손댄다 — 1인 보드 `(수학)이름`·`(영어)이름`의 원아·선생님은 해제하지 않는다. 보드 삭제도 하지 않는다(원장 *"반 삭제는 됐고"*).
// 🔑 끄는 법 = 연동 PC 환경변수 `CLASSNOTE_BOARD_AUTO_RELEASE=off`(해제만 멈추고 나머지 동기화는 그대로).
// 🔴 반 보드를 한 번도 안 만든 지점(연결표가 비어 있음)에선 아무것도 안 한다 — 이 기능을 켠 적 없는 곳에 반을 만들지 않는다.
// 🔴 이상하면 멈춘다(ClassBoardStop) — 기록(0302a)도 갱신하지 않아 초록불이 거짓으로 켜지지 않는다. 다음 날 다시 본다.
import fs from "node:fs";
import { fetchCenterId, loginClassnote } from "./classnote-admin-core.mjs";
import { stateFile } from "./classnote-paths.mjs";
import { loadAywa, loadClosedLinked, loadLinkedBoards, loadPlan, loadVerifiedChildren } from "./math-class-boards-load.mjs";
import { closedClassesToKeep } from "./class-board-plan.mjs";
import { applyClassBoardPlans } from "./math-class-boards-apply.mjs";
import { writeClassBoardSnapshot, writeReleaseNames } from "./math-class-boards-db.mjs";
import { TEACHER_MAP, connectTeachers, fetchEmployments, planTeacherLinks } from "./math-class-teachers.mjs";
import { dropReleasedExtras, planChildReleases, planTeacherReleases } from "./class-board-release.mjs";
import { loadChildLinks, loadClassEnrollments, loadClassTeachers } from "./class-board-release-load.mjs";
import { releaseChildren, releaseTeachers } from "./class-board-release-apply.mjs";
import {
  appliedEvents,
  auditDailyRun,
  auditEnrollments,
  auditReleases,
  childReleaseEvents,
  planEvents,
  releaseEvents,
  teacherReleaseEvents,
  stoppedEvents,
  summarizeEvents,
  teacherEvents,
  writeSyncRun,
} from "./class-board-sync-report.mjs";
import { syncErrorLabel } from "./sync-request-plan.mjs";

const RUN_AFTER_HOUR_KST = 5;
const STATE_FILE = stateFile("class-board-sync-last-run.txt");
let memoryLastRun = "";

const kstDate = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const kstHour = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(new Date()));
function lastRun() {
  if (memoryLastRun) return memoryLastRun;
  try {
    return STATE_FILE ? fs.readFileSync(STATE_FILE, "utf8").trim() : "";
  } catch {
    return "";
  }
}
function markRun(d) {
  memoryLastRun = d;
  try {
    if (STATE_FILE) fs.writeFileSync(STATE_FILE, d);
  } catch {
    /* 파일이 안 써져도 메모리 표식이 당일 반복을 막는다 */
  }
}

/** 자동 해제 스위치 — 기본 켜짐. 연동 PC에서 `CLASSNOTE_BOARD_AUTO_RELEASE=off`(또는 false·0·no)면 해제만 건너뛴다. */
export const autoReleaseEnabled = () => !["off", "false", "0", "no"].includes(String(process.env.CLASSNOTE_BOARD_AUTO_RELEASE ?? "").trim().toLowerCase());

/**
 * 자동 해제 **멈춤 표식** — 해제 뒤 "다른 배정·다른 연결이 함께 사라졌다"가 나오면 남긴다(ClassNote 동작이 실측과 달라졌다는 뜻).
 * 표식이 있는 동안 해제는 건너뛰고(나머지 동기화는 그대로) 보고서에 그 사실을 적는다. 사람이 확인한 뒤 파일을 지우면 다시 시작한다.
 * 파일을 못 쓰는 환경(경로 없음)은 프로세스 메모리로 대신한다.
 */
const HALT_FILE = stateFile("class-board-release-halt.txt");
let memoryHalt = "";
export function releaseHaltReason() {
  if (!HALT_FILE) return memoryHalt;
  try {
    return fs.existsSync(HALT_FILE) ? fs.readFileSync(HALT_FILE, "utf8").trim() || "사유 미기록" : "";
  } catch {
    return memoryHalt;
  }
}
function haltRelease(reason) {
  memoryHalt = String(reason ?? "").slice(0, 300) || "사유 미기록";
  try {
    if (HALT_FILE) fs.writeFileSync(HALT_FILE, `${new Date().toISOString()} ${memoryHalt}`);
  } catch {
    /* 파일이 안 써져도 메모리 표식이 이 프로세스의 다음 회차를 막는다 */
  }
}
/** 테스트용 — 메모리 표식을 지운다. */
export function resetReleaseHaltForTest() {
  memoryHalt = "";
}

/** 반 보드별 담임(aywa) — 담임 연결 계획의 입력. */
async function homeroomTargets(sql, tenant, aywa, plans) {
  const homeroom = new Map(
    (await sql`select c.id, u.display_name, u.status from classes c left join users u on u.id = c.teacher_id
      where c.tenant_id = ${tenant} and c.id in ${sql(aywa.classes.map((c) => c.classId))}`).map((r) => [r.id, r]),
  );
  return plans
    .filter((p) => p.board.action === "exists")
    .map((p) => ({ className: p.className, boardId: p.board.id, teacher: homeroom.get(p.classId)?.display_name ?? null, teacherStatus: homeroom.get(p.classId)?.status ?? null }));
}

/** 해제 리스트에 붙일 사유 — 보류한 원아 + 그 건만 실패한 원아 + 멈춰서 손대지 못한 원아(이름만 남기지 않는다). */
function releaseListReasons(childRelease, done, failed) {
  if (!childRelease) return [];
  const key = (r) => `${r.boardId}|${r.childId}`;
  const settled = new Set([...done, ...failed].map(key));
  return [
    ...childRelease.held,
    ...failed.map((f) => ({ className: f.className, childName: f.childName, why: `이번 동기화에서 해제하지 못했습니다(${f.why})` })),
    ...childRelease.releases.filter((r) => !settled.has(key(r))).map((r) => ({ className: r.className, childName: r.childName, why: "이번 동기화가 멈춰 해제하지 못했습니다 — 다음 동기화에서 합니다" })),
  ];
}

/** 원아 해제 계획 — 계획(방금 읽은 보드 원아) + aywa 수강 기록·원아 링크. DB 읽기만. */
async function childReleasePlan(sql, tenant, aywa, loaded) {
  const classIds = aywa.classes.map((c) => c.classId);
  const [enrollmentsByClass, childLinks] = await Promise.all([loadClassEnrollments(sql, tenant, classIds), loadChildLinks(sql, tenant)]);
  return planChildReleases(loaded.plans, { enrollmentsByClass, students: aywa.students, membersByBoard: loaded.membersByBoard, admissions: loaded.admissions, childLinks });
}

/** 담임 해제 계획 — 보드가 확인된 반의 선생님 연결 + aywa 담당(담임·교시 담당·위임). DB·ClassNote 읽기만. */
async function teacherReleasePlan(sql, page, centerId, tenant, aywa, plans, { pendingLinks = [] } = {}) {
  const teachersByClass = await loadClassTeachers(sql, tenant, aywa.classes.map((c) => c.classId));
  const boards = plans
    .filter((p) => p.board.action === "exists")
    .map((p) => ({ className: p.className, boardId: p.board.id, boardName: p.board.name, ...(teachersByClass.get(p.classId) ?? { homeroom: null, homeroomActive: false, keepNames: [] }) }));
  // pendingLinks = 계획만 볼 때: 실제 실행이라면 해제 **앞에** 붙을 담임 연결을 이미 붙은 것으로 얹는다(안 얹으면 담임이 바뀐 반이
  // "지금 담당이 아직 연결되지 않았다"로 보류돼, 사람이 확인한 명단과 실제 실행이 달라진다).
  const virtual = pendingLinks.map((t, i) => ({ id: -1 - i, teacher_id: t.tid, class_in_charge: t.boardId, is_approved: true }));
  return planTeacherReleases({ boards, emps: [...(await fetchEmployments(page, centerId)), ...virtual], teacherMap: TEACHER_MAP });
}

/** 이 반 보드에서 '해제 필요'인 원아(계획 밖) — 자동 해제가 보류했거나 꺼져 있어 남은 원아. */
function releaseNeeded(plans) {
  return plans.filter((p) => p.board.action === "exists" && p.extras.length).map((p) => `${p.className}: ${p.extras.join(", ")}`);
}

/**
 * 동기화 1회. `apply=false`면 계획만 돌려준다(ClassNote·DB 쓰기 0).
 * `onlyClassIds`(Set) = **이 반들만** 본다(지금 동기화, 0313a) — 그 반 학생의 1인 보드·그 반 보드만 읽고, 0302a는 그 반들만 다시
 * 적는다(계획 밖 반의 연결은 건드리지 않는다 — `writeClassBoardSnapshot` scoped). 종강 반 연결 지키기는 전체 실행의 몫이라 건너뛴다.
 * `events`·`applied` = 호출자가 넘기는 **빈 배열**(동기화 보고서, 0329a) — 변동·실패·보류 줄과 반별 실행 결과를 여기에 담는다.
 *   도중에 멈춰(throw) 반환값이 없어도 그때까지 한 일이 호출자 손에 남는다(멈춘 회차도 보고서·감사로그에 적는다).
 * `released` = 호출자가 넘기는 `{ children: [], teachers: [] }` — 실제로 해제한 원아·담임(멈춰도 남는다 — 감사로그용).
 * @returns {Promise<{classes:number, created:number, renamed:number, enrolled:number, teachers:number, held:number, release:string[], skippedTeachers:string[],
 *   releasedChildren:number, releasedTeachers:number, releasePlan?:object}>}
 */
export async function syncMathClassBoards(sql, page, { tenant, apply = false, log = console.log, onlyClassIds = null, events = [], applied = [], released = { children: [], teachers: [] } }) {
  const all = await loadAywa(sql, tenant);
  const aywa = onlyClassIds ? { ...all, classes: all.classes.filter((c) => onlyClassIds.has(c.classId)) } : all;
  // 범위 안 반이 대상 밖(종강·수학 아님·미발송 반)이면 할 일이 없다 — ClassNote를 읽지 않는다.
  if (onlyClassIds && !aywa.classes.length)
    return { classes: 0, created: 0, renamed: 0, enrolled: 0, teachers: 0, held: 0, release: [], skippedTeachers: [], skipped: [], releasedChildren: 0, releasedTeachers: 0 };
  const centerId = await fetchCenterId(page);
  // strict(개명 감사 G9) — 연결표 조회 실패를 빈 지도로 삼키면 계획이 **이름으로 후퇴**해 개명한 반은 새 보드를 만들고
  // 같은 이름 보드를 채택하면서 다른 반 연결을 빼앗는다. 실패 = 오늘 동기화를 건너뛴다.
  const linkedBoardByClass = await loadLinkedBoards(sql, tenant, { strict: true });
  // 1인 보드가 없거나 빈 학생의 원아 출처(원장 2026-11-02) — 이번 기록(0302a)을 다시 쓰기 **전에** 한 번 읽어 두 계획에 같이 쓴다.
  // 🔴 못 읽으면 오늘 동기화를 건너뛴다 — 그대로 돌면 1인 보드가 빈 학생을 전부 보류로 적어 그 학생들의 확인 기록이 지워지고
  //    (다음 날도 못 되살린다) 발송이 막힌다. 연결표 strict와 같은 규칙.
  const verifiedChildren = await loadVerifiedChildren(sql, tenant);
  if (!verifiedChildren) throw new Error("반 보드 확인 기록을 읽지 못했다 — 오늘 동기화를 건너뛴다(그대로 돌면 확인 기록이 지워진다)");
  // ④(기록) 비교 상대 = **전체** 대상 반의 학생 — 일부 반만 보는 실행에서도 다른 반 학생에게 확인된 원아를 잡는다.
  const verifiedOwnerScope = new Set(all.classes.flatMap((c) => c.studentIds));
  const first = await loadPlan(page, centerId, aywa, { linkedBoardByClass, verifiedChildren, verifiedOwnerScope });
  const { plans, boards, membersByBoard, failed } = first;
  if (failed) throw new Error(`원아 조회 실패 ${failed}건 — 오늘 동기화를 건너뛴다`);
  // 자동 해제 — 스위치가 켜져 있고 멈춤 표식이 없을 때만.
  const halted = autoReleaseEnabled() ? releaseHaltReason() : "";
  const releaseOn = autoReleaseEnabled() && !halted;
  if (halted) log(`[class-board] ⚠️ 자동 해제가 멈춰 있습니다 — ${halted}`);
  const targets = plans.filter(
    (p) => p.board.action !== "block" && (p.board.action === "create" || p.board.rename || p.assign.some((a) => a.children.some((c) => !c.already))),
  );
  const held = plans.reduce((n, p) => n + p.hold.length, 0);
  for (const p of plans) if (p.board.action === "block") log(`  ⛔ ${p.className}: ${p.board.reason}`);
  for (const p of plans) if (p.board.renameBlocked) log(`  ⚠️ ${p.className}: ${p.board.renameBlocked}`);
  if (!apply) {
    // 계획만 — 해제 명단도 함께 돌려준다(실제 해제 전에 사람이 본다). 읽기만 한다.
    let releasePlan = null;
    if (releaseOn) {
      const pending = planTeacherLinks({ targets: await homeroomTargets(sql, tenant, aywa, plans), emps: await fetchEmployments(page, centerId) }).todo;
      releasePlan = {
        children: await childReleasePlan(sql, tenant, aywa, first),
        teachers: await teacherReleasePlan(sql, page, centerId, tenant, aywa, plans, { pendingLinks: pending }),
      };
    }
    log(
      `[class-board] 계획 — 바꿀 반 ${targets.length}개 · 보류 학생×반 ${held}건` +
        (releasePlan
          ? ` · 원아 해제 ${releasePlan.children.releases.length}명(보류 ${releasePlan.children.held.length}) · 담임 해제 ${releasePlan.teachers.releases.length}건(보류 ${releasePlan.teachers.held.length})`
          : halted ? " · 자동 해제 멈춤(사람 확인 필요)" : " · 자동 해제 꺼짐"),
    );
    return { classes: plans.length, created: 0, renamed: 0, enrolled: 0, teachers: 0, held, release: releaseNeeded(plans), skippedTeachers: [], releasedChildren: 0, releasedTeachers: 0, releasePlan, releaseHalted: halted || null };
  }

  // 보고서 줄 — 어디서 멈추든 그때까지의 사실을 남긴다: 반별 실행 결과(applied) + 그 시점의 계획(보류·특정 불가·해제 대상).
  // 끝까지 가면 다시 읽은 계획(reported = fresh.plans)으로 바꿔 적는다(방금 배정한 원아가 '배정 전 보류'로 남지 않게).
  const done = applied;
  let reported = plans;
  let teacherLines = [];
  // 해제 — 계획(보류 사유)과 그 건만 실패한 것. 실제로 해제한 것은 호출자가 넘긴 `released`에 쌓인다(멈춰도 남는다).
  let childRelease = null; // null = 해제 계획을 세우기 전에 멈췄거나 꺼져 있다(보류 사유 줄 없음)
  let teacherRelease = null;
  const releaseFailed = { children: [], teachers: [] };
  let stopped = null;
  try {
    return await run();
  } catch (e) {
    stopped = e;
    throw e;
  } finally {
    // 줄 만들기가 던져 성공한 동기화를 실패로 바꾸면 안 된다 — 보고서는 부가 기록이다.
    try {
      events.push(
        ...appliedEvents(done),
        ...teacherLines,
        ...childReleaseEvents(released.children, releaseFailed.children, childRelease?.held ?? []),
        ...teacherReleaseEvents(released.teachers, releaseFailed.teachers, teacherRelease?.held ?? []),
        ...planEvents(reported),
        ...releaseEvents(reported),
      );
      if (halted)
        events.push({ group: "held", className: "", text: `자동 해제가 멈춰 있어 이번에는 해제하지 않았습니다 — 이전 동기화에서 예상 밖 변화가 있었습니다(${halted}). ClassNote에서 확인한 뒤 연동 PC의 멈춤 표식 파일(class-board-release-halt.txt)을 지우면 다시 시작합니다` });
      // 멈춘 회차 — 왜 멈췄는지(반·학생이 적힌 원문)와, 멈추는 바람에 손대지 못한 반을 남긴다.
      // **맨 앞에** 둔다: 줄 상한(2,000)은 앞에서부터 자르므로 뒤에 붙이면 넘치는 회차에서 가장 중요한 줄이 먼저 사라진다.
      if (stopped) events.unshift(...stoppedEvents(stopped, targets, done));
    } catch (e) {
      log(`[class-board] 동기화 보고서 줄 만들기 실패(동기화 결과와 무관) — ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }

  async function run() {
    await applyClassBoardPlans({ page, centerId, targets, boards, membersByBoard, students: aywa.students, log, out: done });

    // 담임 — 동기화 뒤 보드 번호로(새로 만든 반 포함).
    // 방금 만든 보드는 아직 연결표에 없다 — 번호로 얹어 준다(ClassNote가 이름을 다르게 적었어도 다음 날 또 만들지 않게, G8).
    const linkedAfter = await loadLinkedBoards(sql, tenant, { strict: true });
    for (const d of done) if (d.created && d.boardId != null) linkedAfter.set(d.classId, Number(d.boardId));
    const fresh = await loadPlan(page, centerId, aywa, { linkedBoardByClass: linkedAfter, verifiedChildren, verifiedOwnerScope });
    if (fresh.failed) throw new Error(`원아 재조회 실패 ${fresh.failed}건 — 기록 갱신을 건너뛴다`);
    reported = fresh.plans;

    const teacherTargets = await homeroomTargets(sql, tenant, aywa, fresh.plans);
    const { todo, skipped } = planTeacherLinks({ targets: teacherTargets, emps: await fetchEmployments(page, centerId) });
    // 담임 연결은 한 명씩 한다 — 도중에 던져도 그때까지 연결한 담임이 보고서에 남게 `linked`에 받아 둔다.
    const linked = [];
    let teachers;
    try {
      teachers = await connectTeachers(page, centerId, todo, log, linked);
    } finally {
      teacherLines = teacherEvents(linked, skipped);
    }

    if (onlyClassIds) {
      // 일부 반만 본 실행 — 그 반들만 다시 적는다(계획 밖 반·종강 반 연결은 그대로 둔다).
      await writeClassBoardSnapshot(sql, tenant, fresh.plans, { scoped: true });
    } else {
      // 종강 반 연결 — ClassNote 보드가 살아 있으면 지킨다(원장 2026-09-30). 보드 목록은 방금 읽은 것(fresh.boards).
      // strict — 조회 실패를 빈 목록으로 삼키면 아래 기록이 종강 반 연결을 전부 지운다(throw = 오늘 기록을 건너뛴다).
      const linkedNow = await loadLinkedBoards(sql, tenant, { strict: true });
      const keepClassIds = closedClassesToKeep({
        closedIds: await loadClosedLinked(sql, tenant),
        planClassIds: fresh.plans.map((p) => p.classId),
        linkedBoardByClass: linkedNow,
        liveBoardIds: fresh.boards.map((b) => Number(b.id)),
      });
      await writeClassBoardSnapshot(sql, tenant, fresh.plans, { keepClassIds });
    }

    // 해제(원아 → 담임) — 🔴 **배정·담임 연결·0302a 기록 뒤**에 한다: 해제 쪽이 실패하거나 멈춰도 방금 배정한 원아의 기록
    //   (발송이 읽는 0302a)은 이미 적혀 있다. 해제는 그 기록(assign·hold 행)과 무관하다 — 명단 밖 원아만 다룬다.
    //   원아 근거 = 방금 다시 읽은 보드 원아(fresh). 담임은 연결 뒤라 새 담임이 먼저 붙고 옛 담임이 빠진다.
    try {
      if (releaseOn) {
        childRelease = await childReleasePlan(sql, tenant, aywa, fresh);
        await releaseChildren({ page, centerId, releases: childRelease.releases, log, done: released.children, failed: releaseFailed.children });
        teacherRelease = await teacherReleasePlan(sql, page, centerId, tenant, aywa, fresh.plans);
        await releaseTeachers({ page, centerId, releases: teacherRelease.releases, log, done: released.teachers, failed: releaseFailed.teachers });
      }
    } catch (e) {
      // ClassNote가 실측과 다르게 움직였다(다른 배정·연결이 함께 사라짐) — 사람이 볼 때까지 자동 해제를 세운다. 안 세우면 다음 회차가 또 한 명을 내보낸다.
      if (e?.haltRelease) haltRelease(String(e.message ?? e));
      throw e;
    } finally {
      // 해제한 원아는 계획의 '명단 밖 원아'에서 뺀다 — 뒤의 해제 리스트·보고서가 지금 상태를 말하게(해제하다 멈춰도).
      dropReleasedExtras(fresh.plans, released.children);
      // 해제 리스트(0329a) — 이번에 본 반들의 "보드엔 남았는데 자동으로 해제하지 않은 원아"를 사유와 함께 반 보드 행에 적는다
      // (앱이 txt로 내려받는다). 연결 기록(위) 뒤에 적는다 — 방금 만든 반의 행이 있어야 한다. 실패해도 동기화 결과는 그대로다.
      await writeReleaseNames(sql, tenant, fresh.plans, log, releaseListReasons(childRelease, released.children, releaseFailed.children));
    }
    return {
      classes: fresh.plans.length,
      created: done.filter((d) => d.created).length,
      skipped: done.filter((d) => d.skipped || d.renameFailed).map((d) => `${d.className}: ${d.skipped ?? `이름 변경 실패(${d.renameFailed})`}`),
      renamed: done.filter((d) => d.renamed).length,
      enrolled: done.reduce((n, d) => n + d.enrolled.length, 0),
      teachers,
      held,
      release: releaseNeeded(fresh.plans),
      skippedTeachers: skipped,
      releasedChildren: released.children.length,
      releasedTeachers: released.teachers.length,
      releaseHalted: halted || null,
    };
  }
}

/** 데몬용 — KST 05시 이후 하루 1회 · `--post`에서만 · 반 보드를 쓰는 지점에서만. */
export async function syncMathClassBoardsDaily(sql, browser, { tenant, post, log = console.log, force = false }) {
  const today = kstDate();
  if (!force) {
    if (!post) return { ran: false };
    if (kstHour() < RUN_AFTER_HOUR_KST) return { ran: false };
    if (lastRun() === today) return { ran: false };
  }
  const linked = await loadLinkedBoards(sql, tenant, { strict: true });
  if (!linked.size) {
    markRun(today);
    return { ran: false };
  }
  markRun(today); // 🔴 먼저 표식 — 실패해도 오늘 다시 돌지 않는다(로그인 폭풍·반복 쓰기 방지). 내일 다시 본다.
  const page = await browser.newPage();
  // 동기화 보고서(0329a) — 이 회차가 한 일·못 한 일을 이유와 함께 남긴다. 멈춘 회차도 적는다(그때까지 한 일 포함).
  const startedAt = new Date();
  const events = [];
  const applied = [];
  const released = { children: [], teachers: [] };
  try {
    await loginClassnote(page);
    const r = await syncMathClassBoards(sql, page, { tenant, apply: true, log, events, applied, released });
    log(
      `[class-board] 동기화 — 반 생성 ${r.created} · 이름 변경 ${r.renamed} · 원아 배정 ${r.enrolled} · 담임 연결 ${r.teachers} · 보류 ${r.held}` +
        ` · 원아 해제 ${r.releasedChildren} · 담임 해제 ${r.releasedTeachers}` +
        (r.release.length ? ` · 해제 필요 ${r.release.length}개 반` : ""),
    );
    for (const x of r.release) log(`[class-board]   해제 필요(사람 확인): ${x}`);
    for (const x of r.skipped ?? []) log(`[class-board]   보류(내일 다시): ${x}`);
    // autoRelease = 이 회차가 자동 해제를 했는가 — 앱 보고서가 '해제 확인' 목록의 안내 문구를 이 값으로 고른다(꺼졌거나 멈췄으면 옛 안내).
    const summary = { classes: r.classes, created: r.created, renamed: r.renamed, enrolled: r.enrolled, teachers: r.teachers, releasedChildren: r.releasedChildren, releasedTeachers: r.releasedTeachers, autoRelease: autoReleaseEnabled() && !r.releaseHalted };
    await writeSyncRun(sql, { tenant, kind: "daily", startedAt, ok: true, events, summary, log });
    await auditEnrollments(sql, tenant, applied, { kind: "daily" });
    await auditReleases(sql, tenant, released, { kind: "daily" });
    await auditDailyRun(sql, tenant, { ok: true, summary: summarizeEvents(events, summary) });
    return { ran: true, ...r };
  } catch (e) {
    const error = syncErrorLabel(String(e?.message ?? e));
    await writeSyncRun(sql, { tenant, kind: "daily", startedAt, ok: false, error, events, log });
    await auditEnrollments(sql, tenant, applied, { kind: "daily" }); // 멈추기 전에 이미 배정한 원아도 기록에 남긴다
    await auditReleases(sql, tenant, released, { kind: "daily" }); // 멈추기 전에 이미 해제한 원아·담임도
    await auditDailyRun(sql, tenant, { ok: false, error, summary: summarizeEvents(events, { releasedChildren: released.children.length, releasedTeachers: released.teachers.length }) });
    throw e;
  } finally {
    await page.close().catch(() => {});
  }
}
