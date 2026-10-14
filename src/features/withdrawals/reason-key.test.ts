import { describe, expect, it } from "vitest";
import { endedWithExit, excludedReasonOf, exitDayOf, reasonKeyOf } from "./reason-key";

describe("사유 → 표준 키", () => {
  it("영문 코드는 대소문자 없이 · 별칭도 · 모르는 코드는 기타(옛 퇴원율 규칙과 같다) · 라벨 글은 키 · 자유 글은 null", () => {
    expect([reasonKeyOf("Relocation"), reasonKeyOf("MOVED"), reasonKeyOf("transfer"), reasonKeyOf("constructor")]).toEqual(["relocation", "relocation", "other", "other"]);
    expect([reasonKeyOf(" 이사 "), reasonKeyOf("권고퇴원"), reasonKeyOf("종강"), reasonKeyOf(""), reasonKeyOf(null)]).toEqual(["relocation", "advised", null, null, null]);
  });
  it("여러 칸 중 하나라도 고른 사유면 그 키", () => {
    expect(excludedReasonOf(["other", "졸업"], ["graduated"])).toBe("graduated");
    expect(excludedReasonOf(["other", null], ["graduated"])).toBeNull();
  });
});

describe("한 퇴원과 함께 끝난 수강(endedWithExit)", () => {
  const classes: Record<string, { closedAt: string | null; regular: boolean }> = {
    A: { closedAt: null, regular: true }, B: { closedAt: null, regular: true }, SP: { closedAt: null, regular: false }, C: { closedAt: "2026-02-05", regular: true },
  };
  const classOf = (id: string) => classes[id];
  const r = (classId: string, startDate: string, endDate: string) => ({ classId, startDate, endDate });
  it("그만둔 날 = 종료일·반 닫힌 날 중 이른 날 · 하루도 안 다닌 줄은 없음", () => {
    expect(exitDayOf(r("C", "2025-03-01", "2026-02-20"), classes.C)).toBe("2026-02-05");
    expect(exitDayOf(r("B", "2026-03-02", "2026-03-02"), classes.B)).toBeNull();
  });
  it("🔴 기준 = 정규 반의 마지막 그만둔 날 — 특강이 늦게 끝나도 · 미리 등록했다 닫힌 반은 빼고 · 한참 전 수강은 아님", () => {
    expect(endedWithExit([r("A", "2025-03-01", "2026-02-10"), r("SP", "2026-01-05", "2026-02-28")], "2026-02-28", classOf).map((x) => x.classId)).toEqual(["A", "SP"]);
    expect(endedWithExit([r("A", "2025-03-01", "2026-02-14"), r("B", "2026-03-02", "2026-03-02")], "2026-02-20", classOf).map((x) => x.classId)).toEqual(["A"]);
    expect(endedWithExit([r("A", "2025-03-01", "2026-02-28"), r("B", "2026-03-01", "2026-03-20")], "2026-03-20", classOf).map((x) => x.classId)).toEqual(["B"]);
    expect(endedWithExit([r("A", "2025-03-01", "2026-02-28")], "2026-07-15", classOf)).toEqual([]);
    expect(endedWithExit([r("SP", "2026-01-05", "2026-02-28")], "2026-02-28", classOf)).toEqual([]);
  });
  it("넓게 찾을 수도 — 수강종료로 남아 있다가 한 달 넘게 뒤에 퇴원 처리 · 기준 수강 전의 수강(졸업 뒤 다시 등록)은 묶지 않는다", () => {
    expect(endedWithExit([r("A", "2026-03-01", "2026-09-04")], "2026-10-25", classOf)).toEqual([]);
    expect(endedWithExit([r("A", "2026-03-01", "2026-09-04")], "2026-10-25", classOf, 120).map((x) => x.classId)).toEqual(["A"]);
    expect(endedWithExit([r("A", "2026-06-22", "2026-08-07"), r("B", "2026-08-08", "2026-08-19")], "2026-08-19", classOf).map((x) => x.classId)).toEqual(["B"]);
  });
});
