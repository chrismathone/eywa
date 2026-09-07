import { describe, expect, it } from "vitest";
import { applyTodayOrder, mergeTodayOrder, normalizeTodayOrder, TODAY_ORDER_MAX } from "./today-order";

const c = (classId: string) => ({ classId });

describe("오늘 면 개인 순서", () => {
  it("저장이 없으면 기본 순서 그대로", () => {
    expect(applyTodayOrder([c("a"), c("b")], []).map((x) => x.classId)).toEqual(["a", "b"]);
  });

  it("저장된 순서가 이긴다", () => {
    expect(applyTodayOrder([c("a"), c("b"), c("d")], ["d", "a"]).map((x) => x.classId)).toEqual(["d", "a", "b"]);
  });

  it("🔴 저장에 없는 반은 사라지지 않는다 — 기본 순서 그대로 뒤에", () => {
    // 새로 배정된 반이 증발하면 그날 그 반을 통째로 놓친다.
    const out = applyTodayOrder([c("x"), c("y"), c("a")], ["a"]).map((v) => v.classId);
    expect(out).toEqual(["a", "x", "y"]);
  });

  it("저장에만 있고 오늘 없는 반은 목록을 늘리지 않는다", () => {
    expect(applyTodayOrder([c("a")], ["zzz", "a"]).map((x) => x.classId)).toEqual(["a"]);
  });

  it("정규화 — 문자열만·중복 제거·상한", () => {
    expect(normalizeTodayOrder(["a", "a", " ", 1, null, "b"])).toEqual(["a", "b"]);
    expect(normalizeTodayOrder("nope")).toEqual([]);
    expect(normalizeTodayOrder(Array.from({ length: TODAY_ORDER_MAX + 20 }, (_, i) => `c${i}`))).toHaveLength(
      TODAY_ORDER_MAX,
    );
  });

  it("🔴 저장 합치기 — 오늘 안 보인 옛 저장분을 버리지 않는다", () => {
    // 버리면 다른 요일 반의 순서가 하루 만에 초기화된다.
    expect(mergeTodayOrder(["p", "a", "q"], ["b", "a"])).toEqual(["b", "a", "p", "q"]);
  });

  it("합친 결과도 중복이 없다", () => {
    expect(mergeTodayOrder(["a", "a"], ["a"])).toEqual(["a"]);
  });
});
