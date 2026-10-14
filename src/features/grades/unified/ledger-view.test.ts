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
  it("엑셀식 값 필터 — 여러 값 · 뺀다 · (공백) · 시험·시험정보(원장 2026-10-14)", () => {
    const rows = [
      row({ key: "a", kind: "monthly", date: "2026-09-21", classes: [{ id: "c1", name: "A반", teacher: "김", days: 1 }] }),
      row({ key: "b", kind: "school", date: "2026-07-01", schoolYear: 2026, term: 1, slot: "final", classes: [{ id: "c2", name: "B반", teacher: "이", days: 1 }] }),
      row({ key: "c", kind: "daily", date: "2026-10-02", classes: [] }),
      row({ key: "d", kind: "monthly", date: "2026-10-20", classes: [{ id: "c1", name: "A반", teacher: "김", days: 1 }] }),
    ];
    const keys = (q: Record<string, string>) => applyLedgerView(rows, parseLedgerView(q)).map((r) => r.key).sort();
    expect(keys({ fClass: "c1,c2" })).toEqual(["a", "b", "d"]);
    expect(keys({ fClass: "!c1" })).toEqual(["b", "c"]);
    expect(keys({ fClass: "__blank" })).toEqual(["c"]);
    expect(keys({ fTeacher: "!__blank" })).toEqual(["a", "b", "d"]);
    expect(keys({ fKind: "monthly" })).toEqual(["a", "d"]);
    expect(keys({ fInfo: "26-1-기말,__blank" })).toEqual(["b", "c"]);
    const opts = ledgerOptions(rows);
    expect(opts.classes.at(-1)).toEqual({ value: "__blank", label: "(공백)" });
    expect(opts.kinds.map((k) => k.label)).toEqual(["일일테스트", "내신", "월말평가"]);
    // 시험정보는 최근 시험이 위로(글자순이면 10월이 9월 앞에 선다)
    expect(opts.infos.map((i) => i.value)).toEqual(["2026년 10월", "2026년 9월", "26-1-기말", "__blank"]);
  });
  it("시험정보 — 월말은 몇 월, 학교 시험은 `26-2-중간`(원장 2026-10-14, 영어·수학 공통)", () => {
    const { examInfoOf } = helpers;
    expect(examInfoOf({ kind: "monthly", date: "2026-09-21" })).toBe("2026년 9월");
    expect(examInfoOf({ kind: "school", date: "2026-07-01", schoolYear: 2026, term: 1, slot: "final" })).toBe("26-1-기말");
    expect(examInfoOf({ kind: "school", date: "2026-09-21", schoolYear: 2026, term: 2, slot: "midterm" })).toBe("26-2-중간");
    expect(examInfoOf({ kind: "school", date: "2026-09-08", schoolYear: 2026, term: 2, slot: "listening" })).toBe("26-2-듣기");
    expect(examInfoOf({ kind: "daily", date: "2026-09-21" })).toBeNull();
  });
  it("시험정보 정렬 — 년도 → 월말평가(월) → 학교 시험(학기 · 듣기 → 중간 → 기말), 같은 시험은 한데 모인다", () => {
    const rows = [
      row({ key: "fin2", kind: "school", schoolYear: 2026, term: 2, slot: "final" }),
      row({ key: "mon9", kind: "monthly", date: "2026-09-21" }),
      row({ key: "mid2a", kind: "school", schoolYear: 2026, term: 2, slot: "midterm", date: "2026-10-02" }),
      row({ key: "lis2", kind: "school", schoolYear: 2026, term: 2, slot: "listening" }),
      row({ key: "fin1-25", kind: "school", schoolYear: 2025, term: 1, slot: "final" }),
      row({ key: "daily", kind: "daily" }),
      row({ key: "mid2b", kind: "school", schoolYear: 2026, term: 2, slot: "midterm", date: "2026-10-08" }),
    ];
    expect(applyLedgerView(rows, parseLedgerView({ sort: "info", dir: "asc" })).map((r) => r.key))
      .toEqual(["fin1-25", "mon9", "lis2", "mid2a", "mid2b", "fin2", "daily"]);
    expect(applyLedgerView(rows, parseLedgerView({ sort: "info", dir: "desc" })).map((r) => r.key))
      .toEqual(["fin2", "mid2a", "mid2b", "lis2", "mon9", "fin1-25", "daily"]);
  });
  it("모르는 값은 무시한다(주소를 손으로 고쳐도 빈 화면이 안 된다)", () => {
    expect(parseLedgerView({ sort: "zzz", fScore: "nope" })).toMatchObject({ sort: "date", score: undefined });
  });
});
