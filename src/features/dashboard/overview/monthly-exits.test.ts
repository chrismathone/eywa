import { expect, it } from "vitest";
import { carriedSubjectEnds, includeSubjectEnds, monthWithdrawalRows } from "./monthly-exits";
import type { WindowWithdrawal } from "@/features/withdrawals/server/window";
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
it("이번 달에 처리했지만 앞 달로 센 과목 종료는 숫자 대신 '앞 달로 센' 줄로 — 센 달을 싣고, 반이동·이번 달로 센 줄·퇴원 쪽 학생은 뺀다(원장 2026-11-03)", () => {
  const ended = [
    student("sept", [detail("math", "2026-10-01", false, "2026-09-30")]),
    student("oct"),
    student("move", [detail("math", "2026-10-01", true, "2026-09-30")]),
    student("gone", [detail("math", "2026-10-02", false, "2026-09-30")]),
    student("earlier", [detail("math", "2026-09-29", false, "2026-08-31")]),
  ];
  const carried = carriedSubjectEnds(new Set(["gone"]), ended, win, [], () => null);
  expect(carried.map((r) => [r.id, r.countMonth, r.kind])).toEqual([["sept", "2026-09", "subject-ended"]]);
  // 숫자 쪽과 겹치지 않는다 — 앞 달로 센 줄은 숫자에 없고, 이번 달로 센 줄은 '앞 달로 센'에 없다.
  expect(merge(ended).map((r) => r.id)).toEqual(["oct"]);
});
it("KPI 조립 — 이번 달로 센 퇴원은 숫자에, 이번 달에 퇴원했지만 앞 달(6개월보다 앞 포함)로 센 퇴원은 과목마다 '앞 달로 센' 줄로, 오늘 뒤 예정은 어디에도(원장 2026-11-03)", () => {
  const nov = { from: "2026-11-01", to: "2026-11-03" };
  const exit = (id: string, withdrawnAt: string, exitDate: string, subjects = ["math"]): WindowWithdrawal => ({
    id, name: id, school: null, grade: null, enrolledAt: null, withdrawnAt, exitDate,
    lastClassName: null, lastClassSubject: subjects[0] ?? null, lastClassEnglishTrack: null,
    exitClasses: subjects.map((subject) => ({ subject, englishTrack: null, className: subject, endedTogether: [] })),
    reason: null, memo: null, cleanup: false,
  });
  const { rows, carried } = monthWithdrawalRows([
    exit("counted", "2026-11-02", "2026-11-02"),
    exit("oct", "2026-11-01", "2026-10-31", ["math", "english"]),
    exit("april", "2026-11-01", "2026-04-30"),
    exit("future", "2026-11-20", "2026-10-31"),
    exit("old", "2026-10-15", "2026-10-15"),
  ], [student("sub", [detail("math", "2026-11-01", false, "2026-10-31")])], nov, [], () => null);
  expect(rows.map((r) => r.eventKey)).toEqual(["counted|math"]);
  expect(carried?.map((r) => [r.eventKey, r.kind, r.countMonth])).toEqual([
    ["april|math", "withdrawn", "2026-04"],
    ["oct|english", "withdrawn", "2026-10"],
    ["oct|math", "withdrawn", "2026-10"],
    ["sub|math", "subject-ended", "2026-10"],
  ]);
});
