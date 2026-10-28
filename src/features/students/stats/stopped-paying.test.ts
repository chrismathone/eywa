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

  it("🔴 건너뛴 달(청구가 비정상으로 적어 비운 달 · 원장 2026-10-28)은 셈하지 않고, '다음 두 달'도 그 달을 넘어 자료가 있는 달로 본다", () => {
    const p = new Map<string, Set<string>>([
      ["a", new Set(["2025-03", "2025-05"])], // 4월이 비었을 뿐 이어 다님 — 3월에 끊긴 것이 아니다
      ["b", new Set(["2025-02", "2025-05"])], // 3월을 쉬고(진짜 빈 달) 4월은 자료 없음 → 다음 두 달 = 3월·5월 → 2월에 끊기지 않음
      ["c", new Set(["2025-03"])], // 3월 뒤로 없음 → 3월에 끊김
    ]);
    const ms = ["2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07"];
    const out = stoppedPayingByMonth(p, ms, "2025-07", new Set(["2025-04"]));
    expect(out.has("2025-04")).toBe(false);
    expect(Object.fromEntries(out)).toMatchObject({ "2025-02": 0, "2025-03": 1, "2025-05": 2 });
    // 건너뛰지 않으면 a는 3월에 끊긴 것으로 잘못 센다(4·5월 중 5월만 봐서 아니다 — 4월 없음·5월 있음 = 안 끊김) · b는 2월에 끊김(3·4월 없음)
    expect(Object.fromEntries(stoppedPayingByMonth(p, ms, "2025-07"))).toMatchObject({ "2025-02": 1, "2025-03": 1 });
  });

  it("마지막으로 판정할 수 있는 달 = 다음 두 달이 다 끝난 달 = 이번 달의 세 달 전(해가 바뀌어도)", () => {
    expect(lastJudgedMonth("2026-10")).toBe("2026-07");
    expect(lastJudgedMonth("2026-01")).toBe("2025-10");
  });
});
