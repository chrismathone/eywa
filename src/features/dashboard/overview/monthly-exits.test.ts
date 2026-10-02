import { expect, it } from "vitest";
import { includeSubjectEnds } from "./monthly-exits";
import type { SubjectEndedRow } from "@/features/withdrawals/server/queries";
const win = { from: "2026-10-01", to: "2026-10-02" };
const detail = (subject: string, endedAt = "2026-10-01", isTransferred = false) => ({ subject, endedAt, isTransferred, className: subject, englishTrack: null, reason: null });
const student = (id: string, endedDetail = [detail("math")]): SubjectEndedRow => ({ id, name: id, school: null, grade: null, status: "enrolled", endedSubjects: endedDetail.map(d => d.subject), activeSubjects: [], lastEndedAt: "2026-10-01", endedDetail });
const merge = (ended: SubjectEndedRow[]) => includeSubjectEnds([], ended, win, [], () => null);
it("과목 종료를 추가하되 반이동·기간 밖·예정 종료는 포함하지 않는다", () => {
  expect(merge([student("end"), student("move", [detail("math", "2026-10-01", true)]), student("old", [detail("math", "2026-09-30")]), student("future", [detail("math", "2026-10-03")])]).map(r => r.id)).toEqual(["end"]);
});
it("여러 과목을 종료한 학생도 1명이고 종료된 과목·수업을 확인할 수 있다", () => {
  const result = merge([student("s", [detail("english"), detail("math", "2026-10-02")])]);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ kind: "subject-ended", program: "math", className: "math · english", withdrawnAt: "2026-10-02" });
});
it("퇴원과 종료에 겹친 학생은 퇴원 1명으로 센다", () => {
  const result = includeSubjectEnds([{ id: "s", name: "s", schoolGrade: null, withdrawnAt: "2026-10-02", program: "math" }], [student("s")], win, [], () => null);
  expect(result).toHaveLength(1);
  expect(result[0]?.kind).toBe("withdrawn");
});
