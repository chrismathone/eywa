import { describe, expect, it } from "vitest";
import * as helpers from "./ledger-view";
import { applyLedgerView, ledgerOptions, parseLedgerView } from "./ledger-view";
import type { UnifiedRow } from "./model";

const row = (over: Partial<UnifiedRow>): UnifiedRow => ({
  key: over.key ?? Math.random().toString(), source: "grade", sourceId: "x", studentId: over.studentId ?? "s", name: "가", school: "칠성초", grade: "4",
  subject: "math", kind: "daily", date: "2026-09-01", score: 5, maxScore: 10, rawScore: null, classes: [], consultationDate: null,
  manualConsultationDate: null, editHref: "", previousScore: null, previousMaxScore: null, delta: null, deltaUnit: "점", ...over,
});

describe("성적 원장 정렬·필터", () => {
  it("기본은 시험일 내림차순, 점수 정렬은 빈 점수를 방향과 상관없이 맨 뒤로", () => {
    expect(parseLedgerView({})).toMatchObject({ sort: "date", dir: "desc" });
    const rows = [row({ key: "a", score: null }), row({ key: "b", score: 9 }), row({ key: "c", score: 2 })];
    expect(applyLedgerView(rows, parseLedgerView({ sort: "score", dir: "desc" })).map((r) => r.key)).toEqual(["b", "c", "a"]);
    expect(applyLedgerView(rows, parseLedgerView({ sort: "score", dir: "asc" })).map((r) => r.key)).toEqual(["c", "b", "a"]);
  });
  it("반·담임·증감·상담 필터", () => {
    const rows = [
      row({ key: "a", classes: [{ id: "c1", name: "A반", teacher: "김", days: 1 }], delta: 2, consultationDate: "2026-09-02" }),
      row({ key: "b", classes: [{ id: "c2", name: "B반", teacher: "이", days: 1 }], delta: -1 }),
    ];
    expect(applyLedgerView(rows, parseLedgerView({ fClass: "c2" })).map((r) => r.key)).toEqual(["b"]);
    expect(applyLedgerView(rows, parseLedgerView({ fTeacher: "김" })).map((r) => r.key)).toEqual(["a"]);
    expect(applyLedgerView(rows, parseLedgerView({ fDelta: "down" })).map((r) => r.key)).toEqual(["b"]);
    expect(applyLedgerView(rows, parseLedgerView({ fConsult: "none" })).map((r) => r.key)).toEqual(["b"]);
    expect(ledgerOptions(rows).teachers.map((t) => t.value)).toEqual(["김", "이"]);
  });
  it("시험정보 — 월말은 몇 월, 내신은 연도·학기·시험", () => {
    const { examInfoOf } = helpers;
    expect(examInfoOf({ kind: "monthly", date: "2026-09-21" })).toBe("2026년 9월");
    expect(examInfoOf({ kind: "school", date: "2026-07-01", schoolYear: 2026, term: 1, slot: "final" })).toBe("2026년 1학기 · 기말고사");
    expect(examInfoOf({ kind: "daily", date: "2026-09-21" })).toBeNull();
  });
  it("모르는 값은 무시한다(주소를 손으로 고쳐도 빈 화면이 안 된다)", () => {
    expect(parseLedgerView({ sort: "zzz", fScore: "nope" })).toMatchObject({ sort: "date", score: undefined });
  });
});
