import { describe, expect, it } from "vitest";
import { planSplitRows, rowLockNotice, SPLIT_REPORT_NOTICE } from "./split-rows";
import { isRowActionable, isRowInputEditable } from "./grid";
import type { ClassSplit } from "@/features/class-splits/rules";
import type { Subject } from "./types";

const split = (o: Partial<ClassSplit> = {}): ClassSplit => ({
  id: "s1",
  studentId: "stu",
  sourceClassId: "A",
  targetClassId: "B",
  dayOfWeek: "tue",
  startTime: "17:20",
  endTime: "18:20",
  validFrom: "2026-10-06",
  validTo: null,
  periodKind: "forever",
  note: null,
  ...o,
});
const names = new Map([
  ["A", { name: "중1 수학", teacherName: "이성우" }],
  ["B", { name: "중1 개별", teacherName: "유형숙" }],
]);
const TUE = "2026-10-06";

describe("원스크린 × 수업 나누기 — 행 계획", () => {
  it("받는 반엔 그 학생 행, 원래 반엔 표식", () => {
    const p = planSplitRows(["A", "B"], TUE, [split()], names, new Set());
    expect(p.incoming).toEqual([{ studentId: "stu", classId: "B", note: "나눔 17:20~18:20 ← 이성우(중1 수학)" }]);
    expect(p.outgoing.get("stu|A")).toBe("17:20~18:20 → 유형숙(중1 개별)");
  });
  it("오늘 도는 반이 아니면 안 세운다 · 다른 요일엔 없다", () => {
    expect(planSplitRows(["A"], TUE, [split()], names, new Set()).incoming).toEqual([]);
    expect(planSplitRows(["A", "B"], "2026-10-07", [split()], names, new Set()).incoming).toEqual([]);
  });
  it("이미 받는 반 수강생이면 따로 세우지 않는다(정규 행이 있다)", () => {
    expect(planSplitRows(["B"], TUE, [split()], names, new Set(["stu|B"])).incoming).toEqual([]);
  });
  it("이름을 모르면 '다른 반'(raw id 노출 금지)", () => {
    const p = planSplitRows(["B"], TUE, [split()], new Map(), new Set());
    expect(p.incoming[0]?.note).toBe("나눔 17:20~18:20 ← 다른 반");
  });
});

describe("나눔 행 = 보고서 잠금 · 문구", () => {
  const row = { name: "수학", prev: "", today: "1단원", classId: "B", reportOptout: true, splitIn: "나눔 …" } as Subject;
  it("저장·발송·자동작성 전부 대상 아님, 입력도 잠김", () => {
    expect(isRowActionable(row, "save")).toBe(false);
    expect(isRowActionable(row, "send")).toBe(false);
    expect(isRowInputEditable(row)).toBe(false);
  });
  it("잠긴 이유 문구", () => {
    expect(rowLockNotice(row, "미발송")).toBe(`${SPLIT_REPORT_NOTICE} · 나눔 …`);
    expect(rowLockNotice({}, "미발송")).toBe("미발송");
  });
});
