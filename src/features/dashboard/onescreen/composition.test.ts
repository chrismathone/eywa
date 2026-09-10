import { describe, it, expect } from "vitest";
import { countByLabel, toCompositionBars, UNSET_LABEL } from "./composition";

describe("toCompositionBars", () => {
  it("🔴 최댓값을 100%로 잡는다 — 합계 대비면 학년이 많을 때 막대가 전부 똑같아 보인다", () => {
    const { bars } = toCompositionBars([
      { label: "초4", value: 40 },
      { label: "초5", value: 20 },
      { label: "초6", value: 10 },
    ]);
    expect(bars.map((b) => b.pct)).toEqual([100, 50, 25]);
  });

  it("값이 큰 순, 동률이면 한글 이름순", () => {
    const { bars } = toCompositionBars([
      { label: "중2", value: 5 },
      { label: "중1", value: 5 },
      { label: "초6", value: 9 },
    ]);
    expect(bars.map((b) => b.label)).toEqual(["초6", "중1", "중2"]);
  });

  it("🔴 0인 줄도 남긴다 — 감추면 그 학년이 사라진 것처럼 보인다", () => {
    const { bars } = toCompositionBars([
      { label: "초4", value: 3 },
      { label: "고3", value: 0 },
    ]);
    expect(bars.map((b) => b.label)).toContain("고3");
    expect(bars.find((b) => b.label === "고3")?.pct).toBe(0);
  });

  it("전부 0이면 폭도 0 — 0으로 나누지 않는다", () => {
    const { bars, total } = toCompositionBars([{ label: "초4", value: 0 }]);
    expect(bars[0]!.pct).toBe(0);
    expect(total).toBe(0);
  });

  it("🔴 상한을 걸어도 전체 수를 함께 돌려준다 — 잘린 배열 길이를 건수로 쓰면 거짓말이 된다", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ label: `학년${i}`, value: 12 - i }));
    const { bars, total, hiddenCount, hiddenValue } = toCompositionBars(rows, 8);
    expect(bars).toHaveLength(8);
    expect(hiddenCount).toBe(4);
    expect(total).toBe(rows.reduce((n, r) => n + r.value, 0));
    expect(hiddenValue).toBe(4 + 3 + 2 + 1);
  });

  it("빈 입력은 빈 결과", () => {
    expect(toCompositionBars([])).toEqual({ bars: [], total: 0, hiddenCount: 0, hiddenValue: 0 });
  });
});

describe("countByLabel", () => {
  it("라벨별로 센다", () => {
    const rows = countByLabel(["초4", "초5", "초4"]);
    expect(rows.find((r) => r.label === "초4")?.value).toBe(2);
  });

  it("🔴 빈 값을 버리지 않고 '미지정'으로 모은다 — 버리면 합계가 재원생 수와 안 맞는다", () => {
    const rows = countByLabel(["초4", null, "", "   ", undefined]);
    expect(rows.find((r) => r.label === UNSET_LABEL)?.value).toBe(4);
    expect(rows.reduce((n, r) => n + r.value, 0)).toBe(5);
  });
});
