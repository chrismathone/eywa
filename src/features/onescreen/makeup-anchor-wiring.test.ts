import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 🔴 **보고서 반 = 출석부 반 = 발송 반** 배선 가드(원장 2026-09-30 — *"모든 기록에 동일한 반이 매핑되어야함"*).
 * 반을 정하거나 바꾸거나 지우는 **모든 쓰기 경로**가 한 벌의 함수(`prepareMakeupAnchor`·`finishMakeupAnchor`·`changeMakeupAnchor`·
 * `makeupAnchorDeleteBlock`)를 지나는지 코드 모양으로 잠근다. 불변식 자체는 `makeup-anchor.test.ts`가 순수 시뮬레이션으로 잠근다.
 */
const ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const strip = (s: string) => s.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const ONESCREEN = strip(read("src/features/onescreen/server/actions.ts"));
const COMPOSE = strip(read("src/features/report-admin/server/compose-actions.ts"));
const SYNC = strip(read("src/features/onescreen/server/makeup-anchor-sync.ts"));
const ACTION = strip(read("src/features/onescreen/server/makeup-class-actions.ts"));
const CLIENT = strip(read("src/features/onescreen/components/onescreen-client.tsx"));

describe("경로 ① 원스크린 저장(saveLessonReport)", () => {
  it("저장 전 앵커 확정 → 저장 → 같은 앵커로 칸 맞추기 — 칸이 실패하면 저장 오류(발송도 멈춘다)", () => {
    const fn = ONESCREEN.slice(ONESCREEN.indexOf("export async function saveLessonReport"), ONESCREEN.indexOf("export async function saveAndQueueClassnote"));
    const prep = fn.indexOf("prepareMakeupAnchor(supabase, {");
    const upsert = fn.indexOf(".upsert(");
    const fin = fn.indexOf("await finishMakeupAnchor(supabase, {");
    expect(prep).toBeGreaterThan(-1);
    expect(upsert).toBeGreaterThan(prep);
    expect(fin).toBeGreaterThan(upsert);
    expect(fn.slice(fin, fin + 900)).toMatch(/if \(!fin\.ok\)\s*return \{\s*ok: false/);
    // '보낼 반'은 앵커의 복사본 — 게시된 행은 다시 적지 않는다(회수가 옛 기록을 본다)
    expect(fn).toContain("...(isMakeupRow && makeupAnchor && !priorRow?.classnote_sent_at ? { classnote_class_id: makeupAnchor } : {}),");
  });
  it("🔴 발송은 보강 반으로만 — 따로 고른 '보낼 반'을 적는 길이 없다(C1·C9)", () => {
    const fn = ONESCREEN.slice(ONESCREEN.indexOf("export async function saveAndQueueClassnote"));
    expect(fn).not.toMatch(/update\(\{ classnote_class_id:/);
    expect(fn).toContain("resolveMakeupSendClass(");
  });
});

describe("경로 ② 보강 반 바꾸기(setMakeupClass · 발송 다이얼로그 · 반 미정 고르기)", () => {
  it("액션은 같은 수용 판정(acceptMakeupAnchor) → 단일 문(changeMakeupAnchor) → 감사로그", () => {
    expect(ACTION).toContain("acceptMakeupAnchor(cands, input.classId, input.subject, input.date)");
    expect(ACTION).toContain("await changeMakeupAnchor({");
    expect(ACTION).toContain('action: "makeup_class_change"');
  });
  it("🔴 단일 문은 보고서의 보강 반·보낼 반을 **한 문장에** 함께 바꾸고, 칸을 못 옮기면 보고서를 되돌린다", () => {
    const fn = SYNC.slice(SYNC.indexOf("export async function changeMakeupAnchor"));
    expect(fn).toContain(".update({ makeup_class_id: input.toClassId, classnote_class_id: input.toClassId })");
    expect(fn).toContain('.is("classnote_sent_at", null)');
    expect(fn).toContain(".update({ makeup_class_id: r.makeupClassId, classnote_class_id: r.makeupClassId })");
    // 막힐 일(칸 이동 계획)은 보고서를 바꾸기 **전에** 본다
    expect(fn.indexOf("planReportAnchorMove(")).toBeLessThan(fn.indexOf(".update({ makeup_class_id: input.toClassId"));
  });
  it("발송 다이얼로그에서 고른 반은 보강 반으로 실어 다시 저장한다(보낼 반만 적지 않는다)", () => {
    expect(CLIENT).toContain("saveAndQueueClassnote({ ...built.input, makeupClassId: picked })");
    expect(CLIENT).not.toContain("classnoteClassId: picked");
    expect(CLIENT).toContain("await setMakeupClass({ studentId: student.id, date: activeDate, subject: subjectKey, classId: picked })");
  });
});

describe("경로 ③ 관리자 직접 작성(compose-actions)", () => {
  it("원스크린과 같은 함수로 앵커를 정하고 칸을 맞춘다(예전엔 관리자 작성 보강이 출결을 안 남겼다 — C8)", () => {
    expect(COMPOSE).toContain("prepareMakeupAnchor(supabase, {");
    expect(COMPOSE).toContain("await finishMakeupAnchor(supabase, {");
    expect(COMPOSE).not.toMatch(/update\(\{ classnote_class_id: pick\.classId \}\)/);
  });
});

describe("경로 ④ 출석부 쪽 지우기(월별·반별·강사 보기·ECS)", () => {
  it("🔴 보강 보고서가 가리키는 반의 칸은 지우지 않는다 — 셀·범위·ECS 보강 빼기 모두 같은 게이트", () => {
    const att = strip(read("src/features/attendance/server/actions.ts"));
    const cell = att.slice(att.indexOf("export async function setAttendanceCell"), att.indexOf("export async function linkMakeupToAbsence"));
    const range = att.slice(att.indexOf("export async function setAttendanceRange"));
    // 출석부(셀·범위)는 발송된 보고서의 칸만 지운다(원장 2026-11-05 — 보고서는 그대로) · 보내기 전은 종전대로 막는다.
    expect(cell).toContain("makeupAnchorDeleteCheck(user.tenantId, [{ studentId, classId, date: sessionDate }], { allowSent: true })");
    expect(cell).toContain("if (anchorCheck.block) return { error: anchorCheck.block };");
    expect(range).toMatch(/makeupAnchorDeleteCheck\([\s\S]*?\{ allowSent: true \},?\s*\)/);
    expect(range).toContain("if (anchorCheck.block) return { error: anchorCheck.block };");
    // ECS 보강 빼기는 발송분도 막는다(출석부만 푼다).
    const ecs = strip(read("src/features/class-sheets/server/actions.ts"));
    expect(ecs.slice(ecs.indexOf("export async function removeMakeupAttendee"))).toContain("makeupAnchorDeleteBlock(tenantId,");
  });
  it("게이트는 조회 실패를 **막는다**(fail-closed — 지우기는 되돌릴 수 없다)", () => {
    const cells = strip(read("src/features/attendance/server/makeup-anchor-cells.ts"));
    const fn = cells.slice(cells.indexOf("export async function makeupAnchorDeleteCheck"));
    expect(fn).toMatch(/if \(error\) return \{ block: "보강 보고서를 확인하지 못해/);
  });
  it("발송된 보고서의 칸을 지우면 감사로그에 '보고서는 그대로 둔 칸'을 남긴다(셀·범위 — 실제로 행을 지운 칸만)", () => {
    const att = strip(read("src/features/attendance/server/actions.ts"));
    const cell = att.slice(att.indexOf("export async function setAttendanceCell"), att.indexOf("export async function linkMakeupToAbsence"));
    const range = att.slice(att.indexOf("export async function setAttendanceRange"));
    expect(cell).toContain("keptSentCell && clearedRows ? { keptSentMakeupReports: 1 }");
    expect(range).toContain("keptSentCleared > 0 ? { keptSentMakeupReports: keptSentCleared }");
    expect(range).toMatch(/if \(write\.length > 0\) clearedCells\.add\(anchorKeyOf\(c\)\)/);
  });
  it("🔴 발송된 보고서의 칸을 지운 뒤에는 보강 예약을 되돌리지 않는다 — 되돌리면 '보강 진행 여부 확인'으로 칸이 되살아난다(적대 리뷰 2026-11-05)", () => {
    const att = strip(read("src/features/attendance/server/actions.ts"));
    const cell = att.slice(att.indexOf("export async function setAttendanceCell"), att.indexOf("export async function linkMakeupToAbsence"));
    const range = att.slice(att.indexOf("export async function setAttendanceRange"));
    // 셀: 발송분 칸이면 예약 맞춤을 부르지 않는다.
    expect(cell).toMatch(/if \(!keptSentCell\) \{\s*await completeMakeupReservations\(\{ tenantId: user\.tenantId \}, \[\{ studentId, classId, date: sessionDate, status: null \}\]\);/);
    // 범위: 발송분 칸을 빼고 부른다.
    expect(range).toMatch(/completeMakeupReservations\(\s*\{ tenantId: user\.tenantId \},\s*allowed\s*\.filter\(\(c\) => !anchorCheck\.keptCells\.has\(anchorKeyOf\(c\)\)\)/);
  });
  it("점검 스크립트는 발송 '성공' 보고서의 칸 없음을 되살리지 않는다(목록만)", () => {
    const drift = read("scripts/_reports/makeup-class-drift.mts");
    expect(drift).toContain('const noCellsToCreate = noCellsAnywhere.filter((x) => x.r.classnote_status !== "success");');
    expect(drift).toContain("for (const x of noCellsToCreate) {");
    expect(drift).not.toContain("for (const x of noCellsAnywhere) {");
  });
});

describe("경로 ⑤ 워커·일괄 게이트", () => {
  it("워커는 막힌 행을 1인 보드로 흘리지 않는다(failed + 한국어 사유)", () => {
    const core = read("scripts/_classnote/classnote-core.mjs");
    expect(core).toContain('if (pick.route === "blocked") {');
    expect(core).toContain("classnote_status='failed', classnote_error=${msg}");
  });
});

describe("원장 결정 3 — 대신 보강 칸의 귀속(taught_by, 0316a)", () => {
  it("칸을 세울 때·옮길 때 보강한 강사가 그 반을 담당하지 않으면 귀속을 적는다(칸이 없는 스키마면 귀속만 뺀다)", () => {
    expect(SYNC).toContain("const taughtBy = substituteTaughtBy(input.ownerId, mine);");
    const cells = read("src/features/attendance/server/makeup-anchor-cells.ts");
    expect(cells).toContain("...(withTaughtBy ? { taught_by: input.taughtBy } : {}),");
  });
  it("🔴 원스크린 로스터(핫패스)는 taught_by를 읽지 않는다([[#95]])", () => {
    expect(read("src/features/onescreen/server/roster.ts")).not.toContain("taught_by");
  });
  it("정산(명세서·출석부 정산액·수납 정산 면)이 같은 귀속 함수를 쓴다", () => {
    expect(read("src/features/payroll/server/tuition.ts")).toContain("tierRowsOwnedBy(collected.rows, args.teacherId, new Set(args.classIds))");
    expect(read("src/features/attendance/server/teacher-money.ts")).toContain("tierRowsOwnedBy(collected.rows, teacherId, new Set(classIds))");
    expect(read("src/features/payroll/server/tuition-view.ts")).toContain("const t = row.taughtBy ?? teacherOfClass.get(row.classId);");
    expect(read("src/features/payroll/server/payslip-queries.ts")).toMatch(/computeTeacherTuition\(admin, \{\s*teacherId,/);
  });
  it("월별 출석부 강사 보기·저장 판정도 귀속을 본다(화면과 저장이 같은 재료)", () => {
    expect(read("src/features/attendance/server/queries.ts")).toContain("ownsSlot(r.session_date, slot, r.seat_label, r.recorded_via, r.taught_by ?? null)");
    expect(read("src/features/attendance/scope-ownership.ts")).toContain("taughtBy: row.taught_by ?? null,");
  });
});

describe("적대 리뷰 2026-09-30 수리 — 보강 시수 유실·정산 표시·경합", () => {
  it("🔴 확인창 등록 문은 정규 수업에 기록하지 않는 보강이면 **확인 즉시** 앵커 반에 칸을 세운다(보고서 저장 훅과 같은 함수)", () => {
    const reg = strip(read("src/features/onescreen/server/makeup-register-actions.ts"));
    expect(reg).toContain("await syncAnchorCells({");
    expect(reg).toContain("if (recordCell && anchor) cellWanted.set(");
    // 세션에 새로 들어간 줄만(이미 있던 줄의 칸은 처음 등록 때 섰다) · 칸 실패는 등록을 되돌리지 않고 알린다
    expect(reg).toContain("if (!added.has(subject)) continue;");
    expect(reg).toContain("cellError: errors[0]");
    // 화면은 옛 persistAnchorMakeup과 같은 조건으로 recordCell을 켜고, 실패를 알린다
    expect(CLIENT).toContain("recordCell: !choice.candidate && !!su.makeupClassId && !existing?.subjects.some((x) => x.classId === su.makeupClassId && !x.makeup)");
    expect(CLIENT).toContain('if (result.cellError) toast.error(tf("os.c.anchorFail", { error: result.cellError }));');
  });
  it("🔴 보고서 전인 보강의 반 바꾸기도 확인 때 선 칸을 같은 함수로 함께 옮긴다(시수 두 번 방지)", () => {
    expect(ACTION).toContain("reportlessMove = await planReportAnchorMove({");
    expect(ACTION).toContain("move: reportlessMove,");
    // 반이 없던 보강은 옮길 칸이 없다 — 보이지 않는 보강 반(다른 보강의 칸)을 원천으로 잡지 않는다
    expect(ACTION).toContain('reportlessMove = { plan: { kind: "none" }, fromClassId: null };');
    // 칸을 못 맞추면 세션(반)도 되돌린다
    expect(ACTION).toContain("await setSessionAnchor(prevEntry.makeupClassId ?? null, prevEntry.makeupClassName ?? null)");
  });
  it("🔴 칸 이동이 일부만 되면 옮긴 행을 옛 반으로 되돌리고, 옮긴 뒤엔 '세우기' 실패로 보고서만 되돌리지 않는다", () => {
    const cells = strip(read("src/features/attendance/server/makeup-anchor-cells.ts"));
    const fn = cells.slice(cells.indexOf("export async function applyAnchorMove"), cells.indexOf("export async function makeupAnchorDeleteBlock"));
    expect(fn).toContain(".update({ class_id: input.fromClassId,");
    expect(fn).toContain('.eq("class_id", input.toClassId)');
    expect(SYNC).toContain("if (moved > 0) return { ok: true, moved, created: false };");
  });
  it("🔴 저장이 옛 행의 반을 바꿀 땐 upsert 전에 조건부로 먼저 바꾼다(워커 claim과 둘 중 하나만) — 원스크린·관리자 작성 둘 다", () => {
    for (const src of [ONESCREEN, COMPOSE]) {
      const claim = src.indexOf("await claimMakeupAnchorChange({");
      expect(claim).toBeGreaterThan(-1);
      expect(claim).toBeLessThan(src.indexOf(".upsert("));
    }
    const fn = SYNC.slice(SYNC.indexOf("export async function claimMakeupAnchorChange"));
    expect(fn).toContain('.or("classnote_status.is.null,classnote_status.not.in.(processing,success,recall_requested,recalling)")');
  });
  it("🔴 A 강사 보기: 정산에 든 다른 반 대신 보강 칸을 읽기 전용 목록으로 보이고, 정산 주석이 그 시수를 밝힌다", () => {
    const page = strip(read("src/app/(shell)/attendance/page.tsx"));
    expect(page).toContain("loadSubstituteCells({ tenantId: user.tenantId, teacherId: effectiveTeacher, month, excludeClassIds: teacherClasses.map((c) => c.id) })");
    expect(page).toContain("<SubstituteCellsNote cells={substituteCells} lang={lang} />");
    expect(page).toContain('"att.moneyNote.substitute"');
    const sub = strip(read("src/features/attendance/server/substitute-cells.ts"));
    expect(sub).toContain('.eq("taught_by", input.teacherId)');
    expect(sub).toContain("effectiveAttendanceRecords(rows)");
    expect(read("src/features/attendance/server/teacher-money.ts")).toContain("unitsByClass: result.lines.reduce");
  });
  it("쓰는 곳은 taught_by 칸 확인을 새로 한다(없음 캐시 60초를 건너뛴다 — 귀속을 빼고 쓰는 창을 줄인다)", () => {
    const cells = read("src/features/attendance/server/makeup-anchor-cells.ts");
    expect(cells.split("taughtByColumnReady(admin, { fresh: true })").length - 1).toBe(2);
    expect(cells).not.toMatch(/taughtByColumnReady\(admin\)/);
  });
});
