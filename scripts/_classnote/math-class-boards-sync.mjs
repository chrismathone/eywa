// scripts/_classnote/math-class-boards-sync.mjs — 수학 반 보드 **매일 동기화**(연동 PC 워커, KST 05시 이후 하루 1회).
//
// 원장 2026-09-29: aywa 반 구성이 바뀌면(새 반·신입·반이동·반 이름 변경·담임 변경) ClassNote 반 보드도 따라가게.
// 하는 일 = 새 반 보드 만들기 · 반 이름 바꾸기(연결표 기준) · 원아 추가 배정(가드 통과분만) · 담임 연결 · 0302a 기록 갱신.
// 🔴 하지 않는 일 = 원아·선생님 **해제**(ClassNote API가 막았다 — 화면에서 손으로). 반을 옮긴 학생이 옛 반에 남은 것은
//    '해제 필요'로 로그·결과에 남긴다(반 단체 공지는 그 반을 알아서 막는다 — class-notice-guard.mjs).
// 🔴 반 보드를 한 번도 안 만든 지점(연결표가 비어 있음)에선 아무것도 안 한다 — 이 기능을 켠 적 없는 곳에 반을 만들지 않는다.
// 🔴 이상하면 멈춘다(ClassBoardStop) — 기록(0302a)도 갱신하지 않아 초록불이 거짓으로 켜지지 않는다. 다음 날 다시 본다.
import fs from "node:fs";
import { fetchCenterId, loginClassnote } from "./classnote-admin-core.mjs";
import { stateFile } from "./classnote-paths.mjs";
import { loadAywa, loadClosedLinked, loadLinkedBoards, loadPlan } from "./math-class-boards-load.mjs";
import { closedClassesToKeep } from "./class-board-plan.mjs";
import { applyClassBoardPlans } from "./math-class-boards-apply.mjs";
import { writeClassBoardSnapshot } from "./math-class-boards-db.mjs";
import { connectTeachers, fetchEmployments, planTeacherLinks } from "./math-class-teachers.mjs";

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
 * @returns {Promise<{classes:number, created:number, renamed:number, enrolled:number, teachers:number, held:number, release:string[], skippedTeachers:string[]}>}
 */
export async function syncMathClassBoards(sql, page, { tenant, apply = false, log = console.log, onlyClassIds = null }) {
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

  const done = await applyClassBoardPlans({ page, centerId, targets, boards, membersByBoard, students: aywa.students, log });

  // 담임 — 동기화 뒤 보드 번호로(새로 만든 반 포함).
  // 방금 만든 보드는 아직 연결표에 없다 — 번호로 얹어 준다(ClassNote가 이름을 다르게 적었어도 다음 날 또 만들지 않게, G8).
  const linkedAfter = await loadLinkedBoards(sql, tenant, { strict: true });
  for (const d of done) if (d.created && d.boardId != null) linkedAfter.set(d.classId, Number(d.boardId));
  const fresh = await loadPlan(page, centerId, aywa, { linkedBoardByClass: linkedAfter });
  if (fresh.failed) throw new Error(`원아 재조회 실패 ${fresh.failed}건 — 기록 갱신을 건너뛴다`);
  const homeroom = new Map(
    (await sql`select c.id, u.display_name, u.status from classes c left join users u on u.id = c.teacher_id
      where c.tenant_id = ${tenant} and c.id in ${sql(aywa.classes.map((c) => c.classId))}`).map((r) => [r.id, r]),
  );
  const teacherTargets = fresh.plans
    .filter((p) => p.board.action === "exists")
    .map((p) => ({ className: p.className, boardId: p.board.id, teacher: homeroom.get(p.classId)?.display_name ?? null, teacherStatus: homeroom.get(p.classId)?.status ?? null }));
  const { todo, skipped } = planTeacherLinks({ targets: teacherTargets, emps: await fetchEmployments(page, centerId) });
  const teachers = await connectTeachers(page, centerId, todo, log);

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
  try {
    await loginClassnote(page);
    const r = await syncMathClassBoards(sql, page, { tenant, apply: true, log });
    log(
      `[class-board] 동기화 — 반 생성 ${r.created} · 이름 변경 ${r.renamed} · 원아 배정 ${r.enrolled} · 담임 연결 ${r.teachers} · 보류 ${r.held}` +
        (r.release.length ? ` · 해제 필요 ${r.release.length}개 반` : ""),
    );
    for (const x of r.release) log(`[class-board]   해제 필요(ClassNote 화면에서): ${x}`);
    for (const x of r.skipped ?? []) log(`[class-board]   보류(내일 다시): ${x}`);
    return { ran: true, ...r };
  } finally {
    await page.close().catch(() => {});
  }
}
