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
// 담당 선생님 판정 한 벌 — 시간표 X와 퇴원관리 '강사별'이 함께 부른다(2026-10-15).
const JUDGE = read("src/features/withdrawals/server/exit-teacher-judge.ts");
const WD_PAGE = read("src/app/(shell)/withdrawals/page.tsx");
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
    // 시간표 X는 강사평가 퇴원율과 같은 달(퇴원일) — 퇴원월(수강료 기준)이 아니다.
    expect(SERVER).toContain('getWithdrawalsInWindow(from, to, { basis: "date" })');
    expect(SERVER).toContain(`getSubjectEndedStudents({ endedWithin: { from, to }, basis: "date" })`);
    expect(SERVER).toContain("withdrawalMonthWindow(m, today)");
  });

  it("🔴 재료 = 강사평가 퇴원율과 같은 조회 · 보이는 담당 = 그만둘 때 다니던 반의 그날 담임(퇴원생 관리 차트 기준 2026-11-11)", () => {
    // 재료 — 강사평가 스냅샷과 같은 조회 정의(churn-source.ts 한 곳을 두 쪽이 쓴다).
    expect(JUDGE).toContain("loadChurnSource(admin, tenantId, range)");
    expect(SERVER).toContain("judge.homeroomOf(e.studentId, subject, e.row.date)");
    expect(SERVER).toContain("loadExitTeacherJudge(tenantId, { from: monthRange(shiftMonth(anchor, -7)).from, end: monthRange(thisMonth).to }, { today, thisMonth })");
    expect(CHURN_SOURCE).toContain("export async function loadChurnSource(");
    for (const src of [SNAPSHOT, CHURN_SOURCE]) {
      expect(src).toContain('paged<SnapshotClass>((a, b) => inTenant("classes", CLASS_COLUMNS)');
      expect(src).toContain("transitionRows(admin, tenantId)");
      expect(src).toContain("nonRealStudents(admin, tenantId)");
      expect(src).toContain("transitions: toTransitions(transitions)");
      expect(src).toContain("studentReasonRows(admin, tenantId)");
      // 담임 이력 보강(activity_log)·재직 기간도 같은 함수로 읽는다(2026-11-11).
      expect(src).toContain("loadTeacherChanges(admin, tenantId)");
      expect(src).toContain("loadTenure(admin, tenantId)");
      expect(src).toContain("loadTeacherAliases(admin, tenantId)");
    }
    expect(SNAPSHOT).toContain('inTenant("enrollments", ENROLLMENT_COLUMNS).lte("start_date", billingEnd).order("id")');
    expect(CHURN_SOURCE).toContain('inTenant("enrollments", ENROLLMENT_COLUMNS).lte("start_date", end).or(`end_date.is.null,end_date.gte.${from}`).order("id")');
    expect(SNAPSHOT).toContain("futureEnrollmentRows(admin, tenantId, billingEnd)");
    expect(CHURN_SOURCE).toContain("futureEnrollmentRows(admin, tenantId, end)");
    // 원장이 고른 세는 법(뺄 사유·수강종료)도 강사평가 설정 그대로.
    expect(CHURN_SOURCE).toContain("loadEvaluationConfig(admin, tenantId)");
    expect(CHURN_SOURCE).toContain("options: evaluation.config.metrics.churn.churn ?? DEFAULT_CHURN_OPTIONS");
    // 그날 담임 — 강사평가 전 지표와 한 함수.
    expect(CONTEXT).toContain("const owner = buildHomeroomOwner(d.classes, d.transitions, { teacherChanges: d.teacherChanges, tenure, aliases: aliasesOf(d.teacherAliases) });");
    expect(JUDGE).toContain("const owner = buildHomeroomOwner(source.classes, source.transitions, { teacherChanges: source.teacherChanges, tenure: source.tenure, aliases: source.aliases });");
    // 계산 — 강사평가가 부르는 것과 같은 명단(`buildStudentTracking`) · 같은 계산기(`buildChurnModel`) · 같은 입력 모양.
    // 강사평가는 배정·유지 감점에 쓰는 사유를 더 넘긴다(명단·수강 끝은 그대로 — 겹침은 명단만 읽는다).
    expect(BUILD).toContain("from: d.from, end: d.end, classes: d.classes, schedules: d.schedules, enrollments: d.enrollments, owner: ctx.owner, employed: ctx.employed,");
    expect(BUILD).toContain("reasons: { studentReasons: d.studentReasons, excludeReasons: churnOptions.excludeReasons, futureEnrollments: d.futureEnrollments },");
    // 사유 없이 끝난 줄의 학생 퇴원 사유 = 그 퇴원과 함께 끝난 수강인가 — 겹침과 같은 `endedWithExit` · 같은 폭.
    expect(read("src/features/teacher-portfolio/model/exit-reason.ts")).toContain("endedWithExit(rows, withdrawnDay, ref, OVERLAY_LOOKBACK_DAYS)");
    expect(JUDGE).toContain("buildStudentTracking({ from: source.from, end: source.end, classes: source.classes, schedules: source.schedules, enrollments: source.enrollments, owner, employed })");
    expect(BUILD).toContain("const churnOptions = config.metrics.churn.churn ?? DEFAULT_CHURN_OPTIONS;");
    expect(BUILD).toContain("buildChurnModel({ source: students.churnSource, classes: d.classes, options: churnOptions, futureEnrollments: d.futureEnrollments, studentReasons: d.studentReasons })");
    expect(JUDGE).toContain("buildChurnModel({ source: tracking.churnSource, classes: source.classes, options: source.options, futureEnrollments: source.futureEnrollments, studentReasons: source.studentReasons })");
    expect(BUILD).toContain("...churn.period(teacherId, w)");
    expect(JUDGE).toContain("churn.exits(id, w)");
    expect(JUDGE).toContain("churn.eligibleSubjects(w)");
    expect(JUDGE).toContain("churnZeroIds(view, subject, month)");
    expect(SERVER).toContain("judge.zeroIdsOf(subject, m)");
    expect(SERVER).toContain("judge.teachersOf(e.studentId, subject, e.endMonth)");
    // 🔴 재료의 끝 = 이번 달 말일 고정 · 달별 퇴원율은 물어본 달만 — 기준 달을 넘겨도 같은 줄은 같은 선생님(적대 리뷰 2026-10-14).
    expect(SERVER).toContain("end: monthRange(thisMonth).to }, { today, thisMonth })");
    expect(SERVER).not.toContain("end: to })");
    // 퇴원율은 수강이 끝난 달로 세서 줄의 달과 어긋난다 — 달은 물어볼 때 계산한다(오지 않은 달은 없다).
    expect(JUDGE).toContain("if (m > clock.thisMonth) return undefined;");
    // 퇴원관리 '강사별'도 같은 판정 · 끝은 이번 달 말일로 고정(같은 줄은 화면마다 같은 선생님).
    expect(WD_PAGE).toContain("loadExitTeacherJudge(");
    expect(WD_PAGE).toContain("end: monthRange(thisMonth).to }");
    // 추정(보고서 작성자·출결)은 쓰지 않는다.
    expect(SERVER).not.toContain("getPastClassTeachers");
    expect(SERVER).not.toContain("getHomeroomHistoryIndex");
  });

  it("퇴원율이 세는 달·함께 끝난 수강 사유 = 강사평가와 같은 재료에서 같은 규칙(`endedWithExit` · `churnMonthOf`) — 퇴원·수강종료 둘 다", () => {
    expect(SERVER.match(/= endedOf\(/g)).toHaveLength(2);
    expect(SERVER).toContain("judge.endedOf(studentId, subject, date)");
    expect(JUDGE).toContain("for (const e of source.enrollments) {");
    expect(JUDGE).toContain("const ended = endedWithExit(endedRows.get(subject)?.get(studentId) ?? [], date, classOf, OVERLAY_LOOKBACK_DAYS);");
    expect(SERVER).toContain("from: monthRange(shiftMonth(anchor, -7)).from,");
    expect(JUDGE).toContain("endMonth: churnMonthOf(ended, date, classOf), endReasons: ended.map((r) => r.reason)");
    // 긋는 사유·수강종료 셈 = 강사평가와 같은 원장 설정 · 퇴원율이 셌는지는 선생님 id로.
    expect(SERVER).toContain("rules: source.options,");
    expect(SERVER).toContain("rulesNote: exclusionNote(source.options),");
    // '수강종료는 세지 않음'은 퇴원율이 셌는지로(보이는 담당과 따로).
    expect(SERVER).toContain("counted: countedIds[i]!.length > 0");
  });

  it("🔴 '데이터 정리 일괄 퇴원'은 줄에서 뺀다 — 일괄 퇴원 액션이 적는 글과 판정이 한 상수", () => {
    expect(SERVER).toContain("if (isCleanupWithdrawal(w.memo)) continue;");
    // 일괄 퇴원은 2026-10-23부터 학생마다 바로 처리 보고서로 남긴다(사유 '기타' + 이 메모 — 처리 함수가 학생 퇴원 메모로 옮긴다).
    expect(ADMIN).toContain('reason: "other", reasonDetail: "", memo: CLEANUP_WITHDRAWAL_MEMO');
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

  it("🔴 강사 탓이 아닌 사유 판정 = 한 벌(`reason-key.ts`) — 강사평가 퇴원율·배정·유지 · 겹침 · 급여명세서 퇴원생률(원장 2026-10-14 '모든 곳에서')", () => {
    // 강사평가 둘(퇴원율 · 학생 배정·유지)은 `exit-reason.ts`(학생 퇴원 사유를 언제 쓰나)를 거쳐 같은 판정으로.
    expect(read("src/features/teacher-portfolio/model/exit-reason.ts")).toContain('import { endedWithExit, excludedReasonOf } from "@/features/withdrawals/reason-key";');
    expect(read("src/features/teacher-portfolio/model/churn.ts")).toContain('import { AUTO_END_TEXT, SOON_DAYS, endedWithWithdrawal, excusedReasonOf, reasonsOf, stillAttending, studentReasonAt } from "./exit-reason";');
    expect(read("src/features/teacher-portfolio/model/students.ts")).toContain('import { excusedExitOf, reasonsOf, type StudentReason } from "./exit-reason";');
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
