import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 시간표 X 겹침(석 달 퇴원·수강종료)이 **퇴원관리와 같은 줄**을 세는지 잠근다 — 원장 2026-10-14 권장안
 * *"퇴원관리와 같은 숫자가 나와야 헷갈리지 않는다"*. 겹침이 제 조회를 따로 만들면 '퇴원 8 vs 9'(2026-09-28)가 되풀이된다.
 */
const REPO = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");
const SERVER = read("src/features/withdrawals/server/exit-overlay.ts");
const ACTION = read("src/features/withdrawals/server/exit-overlay-actions.ts");
const QUERIES = read("src/features/withdrawals/server/queries.ts");
const PAGE = read("src/app/(shell)/timetable/page.tsx");
const WINDOW = read("src/features/withdrawals/server/window.ts");

describe("시간표 X 겹침 배선", () => {
  it("🔴 줄의 출처 = 운영실 '퇴원생' 기간 조회 + 퇴원관리 수강종료 판정 · 달 창 = 퇴원관리 '이번 달'과 같은 함수", () => {
    expect(SERVER).toContain("getWithdrawalsInWindow(from, to)");
    expect(SERVER).toContain("getSubjectEndedStudents({ endedWithin: { from, to } })");
    expect(SERVER).toContain("withdrawalMonthWindow(m, today)");
    // 묶음 = 그때 담임 — 지금 담임으로 메우지 않는다(학생 상세 '지난 수업'과 같은 판정). 반이동은 전날까지.
    expect(SERVER).toContain("getPastClassTeachers(");
    expect(SERVER).toContain("{ history, evidenceFrom:");
    expect(SERVER.match(/enrollmentLastDate\(/g)).toHaveLength(2);
    // 묶음의 반 = 함께 끝난 수강 중 정규 반 첫째(같은 날 끝난 특강이 가로채지 않게).
    expect(SERVER).toContain("ended.find((x) => !specialIds.has(x.classId)) ?? ended[0]");
  });

  it("🔴 '퇴원 0'은 묶음 이름이 아니라 반·날짜 판정으로 가린다(적대 리뷰 2026-10-14 — 담임 미상 퇴원의 담임이 0에 서던 모순)", () => {
    expect(SERVER).toContain("zeroCandidateIds({");
    // 함께 끝난 반 전부(요일 나눠 두 반) — 퇴원·수강종료 둘 다 같은 규칙(`endedTogether`)에서 온다.
    expect(SERVER).toContain("e.ended.map((r) => ({ reasonRaw: e.reasonRaw, classId: r.classId, lastDate: enrollmentLastDate(r.endDate, r.isTransferred) }))");
    expect(WINDOW).toContain("endedTogether: endedTogether(rows).map(");
    expect(QUERIES).toContain("endedTogether: endedTogether(subjectRows).map(");
    // 색 기준 = 오늘 담임(석 달 묶음의 기준 달이 아니다).
    expect(SERVER).toContain("currentHomeroomIds(classes, history, today)");
  });

  it("퇴원 사유 = 메타데이터, 없으면 마지막 종료 수강 사유 — 퇴원관리 목록과 같은 폴백", () => {
    expect(WINDOW).toContain("exitReasonOf(s.withdrawal_metadata, klass.reason)");
    expect(QUERIES).toContain("withdrawalReason: md?.reason ? REASON_LABEL[md.reason] : last.reason");
  });

  it("🔴 수강종료 판정은 한 벌 — 기간을 좁혀도 같은 함수로 거른다(후보만 좁힌다)", () => {
    expect(QUERIES.match(/getEndedSubjects\(enr, today\)/g)).toHaveLength(1);
    expect(QUERIES).toContain("loadEndedWithinStudents(supabase, within)");
  });

  it("🔴 권한 = 퇴원관리를 볼 수 있는 사람 — 화면(페이지)과 액션이 같은 판정을 지난다(#77)", () => {
    expect(ACTION).toContain('canAccessTenant(user.systemRole, "withdrawals")');
    expect(PAGE).toContain('const showExitOverlay = !teacherId && (await canAccessTenant(user.systemRole, "withdrawals"));');
  });

  it("데이터는 키를 누를 때만 읽는다 — 페이지는 겹침 부품만 싣고 조회하지 않는다", () => {
    expect(PAGE).not.toContain("getExitOverlay(");
    expect(PAGE).toContain("<TimetableExitOverlay subject={subject} />");
  });
});
