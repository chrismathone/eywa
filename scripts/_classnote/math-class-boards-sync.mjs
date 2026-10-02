// scripts/_classnote/math-class-boards-sync.mjs — 수학 반 보드 **매일 동기화**(연동 PC 워커, KST 05시 이후 하루 1회).
//
// 원장 2026-09-29: aywa 반 구성이 바뀌면(새 반·신입·반이동·반 이름 변경·담임 변경) ClassNote 반 보드도 따라가게.
// 하는 일 = 새 반 보드 만들기 · 반 이름 바꾸기(연결표 기준) · 원아 추가 배정(가드 통과분만) · 담임 연결 · 0302a 기록 갱신.
// 🔴 하지 않는 일 = 원아·선생님 **해제**(지금은 사람이 ClassNote 화면에서 한다). 반을 옮긴 학생이 옛 반에 남은 것은
//    '해제 필요'로 로그에 남기고 반 보드 행에 적는다(0329a 해제 리스트 — 앱에서 txt로 내려받는다).
//    반 단체 공지는 그 반을 알아서 막는다(class-notice-guard.mjs).
//    🔑 2026-10-02 실측: 해제 API는 **있다**(`POST kapi…/v1/enrollments/{배정번호}/out` — 예전 판정 "405"는 DELETE·PATCH였다).
//    자동 해제를 켜는 것은 원장 결정 뒤(누구의 원아인지 모르는 원아까지 내보내면 정상 학생이 빠질 수 있다).
// 🔴 반 보드를 한 번도 안 만든 지점(연결표가 비어 있음)에선 아무것도 안 한다 — 이 기능을 켠 적 없는 곳에 반을 만들지 않는다.
// 🔴 이상하면 멈춘다(ClassBoardStop) — 기록(0302a)도 갱신하지 않아 초록불이 거짓으로 켜지지 않는다. 다음 날 다시 본다.
import fs from "node:fs";
import { fetchCenterId, loginClassnote } from "./classnote-admin-core.mjs";
import { stateFile } from "./classnote-paths.mjs";
import { loadAywa, loadClosedLinked, loadLinkedBoards, loadPlan } from "./math-class-boards-load.mjs";
import { closedClassesToKeep } from "./class-board-plan.mjs";
import { applyClassBoardPlans } from "./math-class-boards-apply.mjs";
import { writeClassBoardSnapshot, writeReleaseNames } from "./math-class-boards-db.mjs";
import { connectTeachers, fetchEmployments, planTeacherLinks } from "./math-class-teachers.mjs";
import {
  appliedEvents,
  auditDailyRun,
  auditEnrollments,
  planEvents,
  releaseEvents,
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

/** 이 반 보드에서 '해제 필요'인 원아(계획 밖) — 반을 옮긴 학생 등. */
function releaseNeeded(plans) {
  return plans.filter((p) => p.board.action === "exists" && p.extras.length).map((p) => `${p.className}: ${p.extras.join(", ")}`);
}

/**
 * 동기화 1회. `apply=false`면 계획만 돌려준다(ClassNote·DB 쓰기 0).
 * `onlyClassIds`(Set) = **이 반들만** 본다(지금 동기화, 0313a) — 그 반 학생의 1인 보드·그 반 보드만 읽고, 0302a는 그 반들만 다시
 * 적는다(계획 밖 반의 연결은 건드리지 않는다 — `writeClassBoardSnapshot` scoped). 종강 반 연결 지키기는 전체 실행의 몫이라 건너뛴다.
 * `events`·`applied` = 호출자가 넘기는 **빈 배열**(동기화 보고서, 0329a) — 변동·실패·보류 줄과 반별 실행 결과를 여기에 담는다.
 *   도중에 멈춰(throw) 반환값이 없어도 그때까지 한 일이 호출자 손에 남는다(멈춘 회차도 보고서·감사로그에 적는다).
 * @returns {Promise<{classes:number, created:number, renamed:number, enrolled:number, teachers:number, held:number, release:string[], skippedTeachers:string[]}>}
 */
export async function syncMathClassBoards(sql, page, { tenant, apply = false, log = console.log, onlyClassIds = null, events = [], applied = [] }) {
  const all = await loadAywa(sql, tenant);
  const aywa = onlyClassIds ? { ...all, classes: all.classes.filter((c) => onlyClassIds.has(c.classId)) } : all;
  // 범위 안 반이 대상 밖(종강·수학 아님·미발송 반)이면 할 일이 없다 — ClassNote를 읽지 않는다.
  if (onlyClassIds && !aywa.classes.length)
    return { classes: 0, created: 0, renamed: 0, enrolled: 0, teachers: 0, held: 0, release: [], skippedTeachers: [], skipped: [] };
  const centerId = await fetchCenterId(page);
  // strict(개명 감사 G9) — 연결표 조회 실패를 빈 지도로 삼키면 계획이 **이름으로 후퇴**해 개명한 반은 새 보드를 만들고
  // 같은 이름 보드를 채택하면서 다른 반 연결을 빼앗는다. 실패 = 오늘 동기화를 건너뛴다.
  const linkedBoardByClass = await loadLinkedBoards(sql, tenant, { strict: true });
  const { plans, boards, membersByBoard, failed } = await loadPlan(page, centerId, aywa, { linkedBoardByClass });
  if (failed) throw new Error(`원아 조회 실패 ${failed}건 — 오늘 동기화를 건너뛴다`);
  const targets = plans.filter(
    (p) => p.board.action !== "block" && (p.board.action === "create" || p.board.rename || p.assign.some((a) => a.children.some((c) => !c.already))),
  );
  const held = plans.reduce((n, p) => n + p.hold.length, 0);
  for (const p of plans) if (p.board.action === "block") log(`  ⛔ ${p.className}: ${p.board.reason}`);
  for (const p of plans) if (p.board.renameBlocked) log(`  ⚠️ ${p.className}: ${p.board.renameBlocked}`);
  if (!apply) {
    log(`[class-board] 계획 — 바꿀 반 ${targets.length}개 · 보류 학생×반 ${held}건`);
    return { classes: plans.length, created: 0, renamed: 0, enrolled: 0, teachers: 0, held, release: releaseNeeded(plans), skippedTeachers: [] };
  }

  // 보고서 줄 — 어디서 멈추든 그때까지의 사실을 남긴다: 반별 실행 결과(applied) + 그 시점의 계획(보류·특정 불가·해제 대상).
  // 끝까지 가면 다시 읽은 계획(reported = fresh.plans)으로 바꿔 적는다(방금 배정한 원아가 '배정 전 보류'로 남지 않게).
  const done = applied;
  let reported = plans;
  let teacherLines = [];
  let stopped = null;
  try {
    return await run();
  } catch (e) {
    stopped = e;
    throw e;
  } finally {
    // 줄 만들기가 던져 성공한 동기화를 실패로 바꾸면 안 된다 — 보고서는 부가 기록이다.
    try {
      events.push(...appliedEvents(done), ...teacherLines, ...planEvents(reported), ...releaseEvents(reported));
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
    const fresh = await loadPlan(page, centerId, aywa, { linkedBoardByClass: linkedAfter });
    if (fresh.failed) throw new Error(`원아 재조회 실패 ${fresh.failed}건 — 기록 갱신을 건너뛴다`);
    reported = fresh.plans;
    const homeroom = new Map(
      (await sql`select c.id, u.display_name, u.status from classes c left join users u on u.id = c.teacher_id
        where c.tenant_id = ${tenant} and c.id in ${sql(aywa.classes.map((c) => c.classId))}`).map((r) => [r.id, r]),
    );
    const teacherTargets = fresh.plans
      .filter((p) => p.board.action === "exists")
      .map((p) => ({ className: p.className, boardId: p.board.id, teacher: homeroom.get(p.classId)?.display_name ?? null, teacherStatus: homeroom.get(p.classId)?.status ?? null }));
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
    // 해제 리스트(0329a) — 이번에 본 반들의 "보드엔 있는데 그 반 명단엔 없는 원아"를 반 보드 행에 적는다(앱이 txt로 내려받는다).
    // 연결 기록(위) 뒤에 적는다 — 방금 만든 반의 행이 있어야 한다. 실패해도 동기화 결과는 그대로다.
    await writeReleaseNames(sql, tenant, fresh.plans, log);
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
  try {
    await loginClassnote(page);
    const r = await syncMathClassBoards(sql, page, { tenant, apply: true, log, events, applied });
    log(
      `[class-board] 동기화 — 반 생성 ${r.created} · 이름 변경 ${r.renamed} · 원아 배정 ${r.enrolled} · 담임 연결 ${r.teachers} · 보류 ${r.held}` +
        (r.release.length ? ` · 해제 필요 ${r.release.length}개 반` : ""),
    );
    for (const x of r.release) log(`[class-board]   해제 필요(ClassNote 화면에서): ${x}`);
    for (const x of r.skipped ?? []) log(`[class-board]   보류(내일 다시): ${x}`);
    const summary = { classes: r.classes, created: r.created, renamed: r.renamed, enrolled: r.enrolled, teachers: r.teachers };
    await writeSyncRun(sql, { tenant, kind: "daily", startedAt, ok: true, events, summary, log });
    await auditEnrollments(sql, tenant, applied, { kind: "daily" });
    await auditDailyRun(sql, tenant, { ok: true, summary: summarizeEvents(events, summary) });
    return { ran: true, ...r };
  } catch (e) {
    const error = syncErrorLabel(String(e?.message ?? e));
    await writeSyncRun(sql, { tenant, kind: "daily", startedAt, ok: false, error, events, log });
    await auditEnrollments(sql, tenant, applied, { kind: "daily" }); // 멈추기 전에 이미 배정한 원아도 기록에 남긴다
    await auditDailyRun(sql, tenant, { ok: false, error, summary: summarizeEvents(events) });
    throw e;
  } finally {
    await page.close().catch(() => {});
  }
}
