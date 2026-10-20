import { describe, expect, it } from "vitest";
import { lastJudgedMonth, stoppedPayingByMonth } from "./stopped-paying";

describe("청구가 끊긴 학생(지난 기록)", () => {
  const paid = new Map<string, Set<string>>([
    ["a", new Set(["2026-01", "2026-02", "2026-03"])], // 3월을 끝으로 끊김
    ["b", new Set(["2026-01", "2026-03"])], // 2월 한 달 쉬고 돌아옴 — 1월은 끊긴 것이 아니다(3월을 끝으로는 끊김)
    ["c", new Set(["2026-01", "2026-04"])], // 두 달 넘게 쉼 — 1월을 끝으로 끊긴 것으로 센다(청구 기준의 한계)
    ["d", new Set(["2026-05", "2026-06"])], // 6월 = 판정 전(그 뒤 두 달이 안 지났다)
  ]);
  const months = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];

  it("그달 청구가 있고 다음 두 달 청구가 없는 학생 · 판정할 수 없는 달은 싣지 않는다", () => {
    const out = stoppedPayingByMonth(paid, months, "2026-05");
    expect(Object.fromEntries(out)).toEqual({ "2026-01": 1, "2026-02": 0, "2026-03": 2, "2026-04": 1, "2026-05": 0 });
    expect(out.has("2026-06")).toBe(false);
  });

  it("마지막으로 판정할 수 있는 달 = 다음 두 달이 다 끝난 달 = 이번 달의 세 달 전(해가 바뀌어도)", () => {
    expect(lastJudgedMonth("2026-10")).toBe("2026-07");
    expect(lastJudgedMonth("2026-01")).toBe("2025-10");
  });
});
