import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isCleanupWithdrawal } from "./system-bulk";

/**
 * 시간표 X 겹침(석 달 퇴원)이 **다른 화면과 같은 값**을 내는지 잠근다 — 원장 2026-10-14 *"모든 데이터가 일치해야함.
 * 이쪽만 다른 출력이 되면 안됨"*. 줄은 퇴원관리와 같은 조회, 담당 선생님은 강사평가 퇴원율과 같은 계산이다.
 * 겹침이 제 판정을 따로 만들면 '퇴원 8 vs 9'(2026-09-28)·'추정 담임'(2026-10-14)이 되풀이된다.
 */
const REPO = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");
const SERVER = read("src/features/withdrawals/server/exit-overlay.ts");
const ACTION = read("src/features/withdrawals/server/exit-overlay-actions.ts");
const QUERIES = read("src/features/withdrawals/server/queries.ts");
const PAGE = read("src/app/(shell)/timetable/page.tsx");
const WINDOW = read("src/features/withdrawals/server/window.ts");
const CONTEXT = read("src/features/teacher-portfolio/model/context.ts");
const BUILD = read("src/features/teacher-portfolio/model/build.ts");
const SNAPSHOT = read("src/features/teacher-portfolio/server/snapshot.ts");
const CHURN_SOURCE = read("src/features/teacher-portfolio/server/churn-source.ts");
const ADMIN = read("src/features/admin/server/actions.ts");
const CARD = read("src/app/(shell)/timetable/_components/exit-overlay/exit-overlay-card.tsx");
const HINT = read("src/app/(shell)/timetable/_components/exit-overlay/exit-overlay-hint.tsx");

describe("시간표 X 겹침 배선", () => {
  it("🔴 줄의 출처 = 운영실 '퇴원생' 기간 조회 + 퇴원관리 수강종료 판정 · 달 창 = 퇴원관리 '이번 달'과 같은 함수", () => {
    expect(SERVER).toContain("getWithdrawalsInWindow(from, to)");
    expect(SERVER).toContain("getSubjectEndedStudents({ endedWithin: { from, to } })");
    expect(SERVER).toContain("withdrawalMonthWindow(m, today)");
  });

  it("🔴 담당 선생님 = 강사평가 퇴원율과 같은 재료 · 같은 담임 판정 · 같은 계산(새로 판정하지 않는다)", () => {
    // 재료 — 강사평가 스냅샷과 같은 조회 정의(churn-source.ts 한 곳을 두 쪽이 쓴다).
    expect(SERVER).toContain("loadChurnSource(createAdminClient(), tenantId,");
    expect(CHURN_SOURCE).toContain("export async function loadChurnSource(");
    for (const src of [SNAPSHOT, CHURN_SOURCE]) {
      expect(src).toContain('paged<SnapshotClass>((a, b) => inTenant("classes", CLASS_COLUMNS)');
      expect(src).toContain("transitionRows(admin, tenantId)");
      expect(src).toContain("nonRealStudents(admin, tenantId)");
      expect(src).toContain("transitions: toTransitions(transitions)");
      expect(src).toContain("studentReasonRows(admin, tenantId)");
    }
    expect(SNAPSHOT).toContain('inTenant("enrollments", ENROLLMENT_COLUMNS).lte("start_date", billingEnd).order("id")');
    expect(CHURN_SOURCE).toContain('inTenant("enrollments", ENROLLMENT_COLUMNS).lte("start_date", end).or(`end_date.is.null,end_date.gte.${from}`).order("id")');
    expect(SNAPSHOT).toContain("futureEnrollmentRows(admin, tenantId, billingEnd)");
    expect(CHURN_SOURCE).toContain("futureEnrollmentRows(admin, tenantId, end)");
    // 원장이 고른 세는 법(뺄 사유·수강종료)도 강사평가 설정 그대로.
    expect(CHURN_SOURCE).toContain("loadEvaluationConfig(admin, tenantId)");
    expect(CHURN_SOURCE).toContain("options: evaluation.config.metrics.churn.churn ?? DEFAULT_CHURN_OPTIONS");
    // 그날 담임 — 강사평가 전 지표와 한 함수.
    expect(CONTEXT).toContain("const owner = buildHomeroomOwner(d.classes, d.transitions);");
    expect(SERVER).toContain("const owner = buildHomeroomOwner(source.classes, source.transitions);");
    // 계산 — 강사평가가 부르는 것과 같은 명단(`buildStudentTracking`) · 같은 계산기(`buildChurnModel`) · 같은 입력 모양.
    expect(BUILD).toContain("buildStudentTracking({ from: d.from, end: d.end, classes: d.classes, schedules: d.schedules, enrollments: d.enrollments, owner: ctx.owner })");
    expect(SERVER).toContain("buildStudentTracking({ from: source.from, end: source.end, classes: source.classes, schedules: source.schedules, enrollments: source.enrollments, owner })");
    expect(BUILD).toContain("buildChurnModel({ source: students.churnSource, classes: d.classes, options: config.metrics.churn.churn ?? DEFAULT_CHURN_OPTIONS, futureEnrollments: d.futureEnrollments, studentReasons: d.studentReasons })");
    expect(SERVER).toContain("buildChurnModel({ source: tracking.churnSource, classes: source.classes, options: source.options, futureEnrollments: source.futureEnrollments, studentReasons: source.studentReasons })");
    expect(BUILD).toContain("...churn.period(teacherId, w)");
    expect(SERVER).toContain("churn.exits(id, w)");
    expect(SERVER).toContain("churn.eligibleSubjects(w)");
    expect(SERVER).toContain("churnZeroIds(view, subject, m)");
    // 🔴 재료의 끝 = 이번 달 말일 고정 · 계산 달 = 열 + 앞뒤 한 달 — 기준 달을 넘겨도 같은 줄은 같은 선생님(적대 리뷰 2026-10-14).
    expect(SERVER).toContain("end: monthRange(thisMonth).to })");
    expect(SERVER).not.toContain("end: to })");
    expect(SERVER).toContain("const churnMonths = churnMonthsFor(anchor, thisMonth);");
    // 추정(보고서 작성자·출결)은 쓰지 않는다.
    expect(SERVER).not.toContain("getPastClassTeachers");
    expect(SERVER).not.toContain("getHomeroomHistoryIndex");
  });

  it("퇴원율이 세는 달·함께 끝난 수강 사유 = 강사평가와 같은 재료에서 같은 규칙(`endedWithExit` · `churnMonthOf`) — 퇴원·수강종료 둘 다", () => {
    expect(SERVER.match(/endedOf\(/g)).toHaveLength(2);
    expect(SERVER).toContain("for (const e of source.enrollments) {");
    expect(SERVER).toContain("const ended = endedWithExit(subjectRows.get(studentId) ?? [], date, classOf, OVERLAY_LOOKBACK_DAYS);");
    expect(SERVER).toContain("from: monthRange(shiftMonth(anchor, -7)).from,");
    expect(SERVER).toContain("endMonth: churnMonthOf(ended, date, classOf), endReasons: ended.map((r) => r.reason)");
    // 긋는 사유·수강종료 셈 = 강사평가와 같은 원장 설정 · 퇴원율이 셌는지는 선생님 id로.
    expect(SERVER).toContain("rules: source.options,");
    expect(SERVER).toContain("rulesNote: exclusionNote(source.options),");
    expect(SERVER).toContain("counted: rowTeacherIds[i]!.length > 0");
  });

  it("🔴 '데이터 정리 일괄 퇴원'은 줄에서 뺀다 — 일괄 퇴원 액션이 적는 글과 판정이 한 상수", () => {
    expect(SERVER).toContain("if (isCleanupWithdrawal(w.memo)) continue;");
    expect(ADMIN).toContain("memo: CLEANUP_WITHDRAWAL_MEMO,");
    // 2026-07-10 스크립트의 '수강 반 없음 일괄 퇴원 처리 (날짜)'도 같은 장부 정리(원장 2026-10-14 "이것도 뺀다").
    expect(isCleanupWithdrawal("데이터 정리 일괄 퇴원")).toBe(true);
    expect(isCleanupWithdrawal(" 수강 반 없음 일괄 퇴원 처리 (2026-07-10)")).toBe(true);
    expect(isCleanupWithdrawal("타 학원으로 이동")).toBe(false);
    expect(isCleanupWithdrawal("일괄 퇴원")).toBe(false);
    expect(isCleanupWithdrawal(null)).toBe(false);
  });

  it("🔴 일반 화면 문구에 '강사평가'(실험실 메뉴)를 쓰지 않는다 — 꺼진 지점에선 있었는지도 모르게", () => {
    expect(CARD).not.toContain("강사평가");
    expect(HINT).not.toContain("강사평가");
  });

  it("퇴원 사유 = 메타데이터, 없으면 마지막 종료 수강 사유 — 퇴원관리 목록과 같은 폴백", () => {
    expect(WINDOW).toContain("exitReasonOf(s.withdrawal_metadata, klass.reason)");
    expect(QUERIES).toContain("withdrawalReason: md?.reason ? REASON_LABEL[md.reason] : last.reason");
  });

  it("🔴 수강종료 판정은 한 벌 — 기간을 좁혀도 같은 함수로 거른다(후보만 좁힌다)", () => {
    expect(QUERIES.match(/getEndedSubjects\(enr, today\)/g)).toHaveLength(1);
    expect(QUERIES).toContain("loadEndedWithinStudents(supabase, within)");
  });

  it("🔴 권한 = 퇴원관리를 볼 수 있는 사람 — 화면(페이지)과 액션이 같은 판정을 지난다(#77) · 지점은 액션이 넘긴다", () => {
    expect(ACTION).toContain('canAccessTenant(user.systemRole, "withdrawals")');
    expect(ACTION).toContain("getExitOverlay(input.subject, anchor, user.tenantId)");
    expect(PAGE).toContain('const showExitOverlay = !teacherId && (await canAccessTenant(user.systemRole, "withdrawals"));');
  });

  it("🔴 강사 탓이 아닌 사유 판정 = 한 벌(`reason-key.ts`) — 강사평가 퇴원율 · 겹침 · 급여명세서 퇴원생률(원장 2026-10-14 '모든 곳에서')", () => {
    expect(read("src/features/teacher-portfolio/model/churn.ts")).toContain('import { excludedReasonOf } from "@/features/withdrawals/reason-key";');
    expect(read("src/features/withdrawals/exit-overlay-model.ts")).toContain('import { excludedReasonOf } from "./reason-key";');
    expect(read("src/features/payroll/payslip-metrics.ts")).toContain('import { endedWithExit, excludedReasonOf, type EndedRowRef } from "@/features/withdrawals/reason-key";');
    // 사유 목록 = 강사평가 설정 한 곳(겹침·명세서 둘 다).
    expect(SERVER).toContain("rules: source.options,");
    const PAYSLIP = read("src/features/payroll/server/payslip-queries.ts");
    expect(PAYSLIP).toContain("loadEvaluationConfig(admin, user.tenantId)");
    expect(PAYSLIP).toContain("withoutExcludedExits(");
  });
  it("데이터는 키를 누를 때만 읽는다 — 페이지는 겹침 부품만 싣고 조회하지 않는다", () => {
    expect(PAGE).not.toContain("getExitOverlay(");
    expect(PAGE).toContain("<TimetableExitOverlay subject={subject} />");
  });
});
