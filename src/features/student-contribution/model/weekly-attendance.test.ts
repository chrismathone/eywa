import { expect, it } from "vitest";
import { completedAttendanceWeeks, weekOf } from "./weekly-attendance";
import type { ContributionAttendance } from "./participation";
function fixture(days: string[]) {
  const targets = days.map(session_date => ({ student_id: "s", class_id: "c", session_date }));
  const attendance: ContributionAttendance[] = targets.map((t, i) => ({ ...t, id: `${i}`, status: "present", recorded_at: `${t.session_date}T10:00:00Z` }));
  return { studentId: "s", month: "2026-09", today: "2026-10-10", allowLate: true, targets, attendance };
}
it("월요일~일요일을 같은 주로 보고 여러 수업·중복 행을 한 번만 센다", () => {
  expect(weekOf("2026-09-13")).toEqual({ from: "2026-09-07", through: "2026-09-13" });
  const input = fixture(["2026-09-07", "2026-09-10", "2026-09-14", "2026-09-17"]);
  input.targets.push({ ...input.targets[0]! });
  input.targets.push({ ...input.targets[0]!, class_id: "other" });
  expect(completedAttendanceWeeks(input)).toHaveLength(1);
  input.attendance.push({ ...input.attendance[0]!, id: "other", class_id: "other" });
  expect(completedAttendanceWeeks(input)).toHaveLength(2);
});
it("월을 걸치는 주는 전체 주 출결을 확인해 일요일의 달에만 인정한다", () => {
  const input = fixture(["2026-09-28", "2026-10-01"]);
  expect(completedAttendanceWeeks(input)).toHaveLength(0);
  expect(completedAttendanceWeeks({ ...input, month: "2026-10" })).toHaveLength(1);
  input.attendance[0]!.status = "absent";
  expect(completedAttendanceWeeks({ ...input, month: "2026-10" })).toHaveLength(0);
});
it("일요일이 끝나야 확정하고, 자료 범위 밖인 연초의 일부 주는 추정하지 않는다", () => {
  const input = fixture(["2026-09-07"]);
  expect(completedAttendanceWeeks({ ...input, today: "2026-09-13" })).toHaveLength(0);
  expect(completedAttendanceWeeks({ ...input, today: "2026-09-14" })).toHaveLength(1);
  expect(completedAttendanceWeeks({ ...fixture(["2026-01-01", "2026-01-05"]), month: "2026-01" })).toHaveLength(1);
});
it("다른 학생·보강 좌석·미입력은 예정된 정규 출석을 대신하지 않는다", () => {
  const input = fixture(["2026-09-07"]);
  input.attendance[0]!.student_id = "other";
  expect(completedAttendanceWeeks(input)).toHaveLength(0);
  input.attendance[0]!.student_id = "s"; input.attendance[0]!.seat_label = "보강";
  expect(completedAttendanceWeeks(input)).toHaveLength(0);
  expect(completedAttendanceWeeks({ ...input, targets: [] })).toHaveLength(0);
});
