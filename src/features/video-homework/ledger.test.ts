import { describe, expect, it } from "vitest";
import { DEFAULT_LEDGER_FILTERS, filterLedgerRows, groupLedgerRows, ledgerCounts, ledgerCsv, ledgerSummary } from "./ledger";
import { keepLedgerRounds, ownRoundKey } from "./ledger";
import { buildLedgerRounds } from "./rounds";
import type { VideoArrival, VideoHomeworkLedgerRow, VideoHomeworkMark } from "./types";

const base: VideoHomeworkLedgerRow = { classId: "a", className: "수학 A", subject: "수학", studentId: "1", studentName: "김민준",
  school: "한빛중", grade: "중1", assignedDates: ["2026-09-01", "2026-09-03", "2026-09-08"], tracked: true, editable: true };
const rows: VideoHomeworkLedgerRow[] = [base,
  { ...base, studentId: "2", studentName: "이서연", school: "새봄중", assignedDates: ["2026-09-03", "2026-09-10"] },
  { ...base, classId: "b", className: "영어 B", subject: "영어", grade: "중2", assignedDates: ["2026-09-02"] },
];
const records: VideoHomeworkMark[] = [
  { classId: "a", studentId: "1", checkDate: "2026-09-03", homeworkDate: "2026-09-01", status: "submitted", submittedDate: "2026-09-02" },
  { classId: "a", studentId: "1", checkDate: "2026-09-08", homeworkDate: "2026-09-03", status: "missing" },
  { classId: "b", studentId: "1", checkDate: "2026-09-04", homeworkDate: "2026-09-02", status: "missing" },
];
const videos: VideoArrival[] = [{ id: "v1", studentId: "2", classId: "a", postedAt: "2026-09-04T10:00:00+09:00" }];
const rounds = buildLedgerRounds({ rows, marks: records, videos, fromDate: "2026-09-01", toDate: "2026-09-30" });

describe("반별 장부 — 회차는 학생마다", () => {
  it("동일 학생의 다른 반 기록을 합치지 않고, 숙제가 나간 날만 분모에 넣는다(영상 자동 완료 포함)", () => {
    expect(ledgerCounts(rows[0], rounds)).toEqual({ submitted: 1, missing: 1, unchecked: 1, total: 3 });
    expect(ledgerCounts(rows[1], rounds)).toEqual({ submitted: 1, missing: 0, unchecked: 1, total: 2 });
    expect(ledgerCounts(rows[2], rounds)).toEqual({ submitted: 0, missing: 1, unchecked: 0, total: 1 });
  });
  it("열 수 = 그 반에서 회차가 가장 많은 학생", () => {
    const groups = groupLedgerRows(rows, rounds);
    expect(groups.map((g) => [g.className, g.roundCount, g.rows.length])).toEqual([["수학 A", 3, 2], ["영어 B", 1, 1]]);
  });
  it("여러 반을 함께 고르고 · 과목·학교·학년·상태·검색어를 함께 적용한다", () => {
    const filters = { ...DEFAULT_LEDGER_FILTERS, classIds: ["a"], subject: "수학", school: "한빛중", grade: "중1", status: "missing" as const, query: " 김민준   한빛 " };
    expect(filterLedgerRows(rows, rounds, filters)).toEqual([rows[0]]);
    expect(filterLedgerRows(rows, rounds, { ...filters, grade: "중2" })).toEqual([]);
    expect(filterLedgerRows(rows, rounds, { ...DEFAULT_LEDGER_FILTERS, classIds: ["a", "b"] })).toHaveLength(3);
    expect(filterLedgerRows(rows, rounds, { ...DEFAULT_LEDGER_FILTERS, classIds: ["b"] })).toEqual([rows[2]]);
    expect(filterLedgerRows(rows, rounds, { ...DEFAULT_LEDGER_FILTERS, status: "unchecked" })).toEqual([rows[0], rows[1]]);
  });
  it("요약은 보이는 줄만 · 표·CSV와 같은 판정", () => {
    expect(ledgerSummary(rows, rounds)).toEqual({ submitted: 2, missing: 2, unchecked: 2 });
    expect(ledgerSummary(filterLedgerRows(rows, rounds, { ...DEFAULT_LEDGER_FILTERS, classIds: ["b"] }), rounds)).toEqual({ submitted: 0, missing: 1, unchecked: 0 });
  });
  it("CSV는 학생마다 N번째 숙제의 숙제일·상태·제출일 — 영상 자동 완료는 '완료(영상)'", () => {
    const group = groupLedgerRows(rows, rounds).find((g) => g.classId === "a")!;
    const csv = ledgerCsv([group], rounds);
    expect(csv).toContain('"1회 숙제일","1회 상태","1회 제출일","2회 숙제일"');
    expect(csv).toContain('"김민준","한빛중","중1","1","1","1","2026-09-01","완료","2026-09-02","2026-09-03","미수행","","2026-09-08","미확인",""');
    expect(csv).toContain('"이서연","새봄중","중1","1","0","1","2026-09-03","완료(영상)","2026-09-04","2026-09-10","미확인","","","",""');
    expect(csv.startsWith("﻿")).toBe(true);
  });
  it("검색으로 학생이 가려져도 열 수는 그대로 · 수식으로 읽힐 이름은 이스케이프", () => {
    const group = groupLedgerRows(rows, rounds).find((g) => g.classId === "a")!;
    const filtered = { ...group, rows: filterLedgerRows(group.rows, rounds, { ...DEFAULT_LEDGER_FILTERS, query: "이서연" }) };
    expect(ledgerCsv([filtered], rounds)).toContain('"3회 숙제일"');
    const bad = [{ ...base, studentName: '=HYPERLINK("bad")' }];
    expect(ledgerCsv(groupLedgerRows(bad, rounds), rounds)).toContain("'=");
  });
  it("정렬은 조회 결과에만 적용하고 원본을 변경하지 않는다", () => {
    expect(filterLedgerRows(rows, rounds, { ...DEFAULT_LEDGER_FILTERS, classIds: ["a"], sort: "missing" }).map((r) => r.studentId)).toEqual(["1", "2"]);
    expect(rows.map((r) => r.studentId)).toEqual(["1", "2", "1"]);
  });
});

describe("강사뷰 — 보일 회차만 남긴다(keepLedgerRounds, 원장 2026-10-03 \"각 강사뷰에서는 내가 출제한것만\")", () => {
  const round = (homeworkDate: string | null, status: "submitted" | "missing" | "unchecked" = "unchecked") =>
    ({ key: homeworkDate ? `h:${homeworkDate}` : "c:2026-09-01", date: homeworkDate ?? "2026-09-01", homeworkDate, assigned: !!homeworkDate,
      mark: null, status, submittedDate: null, auto: false, videoDate: null, videoId: null });
  it("판정이 끝난 회차에서 내가 낸 숙제 칸만 남긴다 · 숙제일 없는 옛 기록·남이 낸 숙제·다른 반은 빠진다", () => {
    const all = new Map([
      ["A:s1", [round("2026-10-01", "submitted"), round("2026-10-06"), round(null, "missing")]],
      ["B:s1", [round("2026-10-02")]],
    ]);
    const kept = keepLedgerRounds(all, new Set([ownRoundKey({ classId: "A", studentId: "s1" }, "2026-10-06")]));
    expect(kept.get("A:s1")!.map((r) => [r.homeworkDate, r.status])).toEqual([["2026-10-06", "unchecked"]]);
    expect(kept.get("B:s1")).toEqual([]);
    // 원본은 그대로(관리자 화면과 같은 판정 결과를 거르기만 한다)
    expect(all.get("A:s1")).toHaveLength(3);
  });
});
