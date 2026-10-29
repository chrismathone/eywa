import { expect, it } from "vitest";
import { includeSubjectEnds } from "./monthly-exits";
import type { SubjectEndedRow } from "@/features/withdrawals/server/queries";
const win = { from: "2026-10-01", to: "2026-10-02" };
const detail = (subject: string, endedAt = "2026-10-01", isTransferred = false, countAt: string | null = endedAt) => ({ subject, endedAt, countAt, isTransferred, className: subject, englishTrack: null, reason: null });
const student = (id: string, endedDetail = [detail("math")]): SubjectEndedRow => ({ id, tenantId: "t", name: id, school: null, grade: null, status: "enrolled", endedSubjects: endedDetail.map(d => d.subject), activeSubjects: [], lastEndedAt: "2026-10-01", endedDetail });
const merge = (ended: SubjectEndedRow[]) => includeSubjectEnds([], ended, win, [], () => null);
it("과목 종료를 추가하되 반이동·기간 밖·예정 종료는 포함하지 않는다", () => {
  expect(merge([student("end"), student("move", [detail("math", "2026-10-01", true)]), student("old", [detail("math", "2026-09-30")]), student("future", [detail("math", "2026-10-03")])]).map(r => r.id)).toEqual(["end"]);
});
it("여러 과목을 종료한 학생은 과목마다 한 명씩 센다", () => {
  const result = merge([student("s", [detail("english"), detail("math", "2026-10-02")])]);
  expect(result).toHaveLength(2);
  expect(result).toMatchObject([
    { id: "s", eventKey: "s|math", kind: "subject-ended", program: "math", className: "math", withdrawnAt: "2026-10-02" },
    { id: "s", eventKey: "s|english", kind: "subject-ended", program: "injaewon", className: "english", withdrawnAt: "2026-10-01" },
  ]);
});
it("퇴원과 종료에 겹친 학생은 퇴원 과목만 센다", () => {
  const result = includeSubjectEnds([
    { id: "s", eventKey: "s|math", name: "s", schoolGrade: null, withdrawnAt: "2026-10-02", program: "math" },
    { id: "s", eventKey: "s|english", name: "s", schoolGrade: null, withdrawnAt: "2026-10-02", program: "injaewon" },
  ], [student("s")], win, [], () => null);
  expect(result).toHaveLength(2);
  expect(result.map(row => row.kind)).toEqual(["withdrawn", "withdrawn"]);
});
it("그 과목 수업료를 앞 달까지만 냈으면 이번 달에 세지 않는다(달 판정 = countAt · 원장 2026-10-29)", () => {
  expect(merge([student("sept", [detail("math", "2026-10-01", false, "2026-09-30")]), student("oct")]).map(r => r.id)).toEqual(["oct"]);
});
