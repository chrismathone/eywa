// 비서 의견 결과 판정(제안 → 결과 → 학습 2단계 · 2026-11-09) — 순수 함수.
import { describe, expect, it } from "vitest";
import { askedOnOf, closedDaysIn, judgeOutcome, remeasureWindow } from "./advice-outcome";

describe("재측정 기간 — 기준일(완료한 날 또는 질문일)에 고정", () => {
  it("질문일 = 기준값 기간 끝 + 2일 · [기준일 + checkAfterDays − 기간, 기준일 + checkAfterDays)", () => {
    expect(askedOnOf("2026-11-07")).toBe("2026-11-09");
    expect(remeasureWindow("2026-11-09", 14, 28)).toEqual({ from: "2026-11-23", to: "2026-12-07" });
    // 재측정 기간은 기준일 뒤에서 시작한다(checkAfterDays ≥ 기간)
    expect(remeasureWindow("2026-11-09", 28, 28).from).toBe("2026-11-09");
    // 완료한 날로 다시 잡으면 그 날부터
    expect(remeasureWindow("2026-11-20", 14, 14)).toEqual({ from: "2026-11-20", to: "2026-12-04" });
  });
  it("휴원일 수 — [from, to)", () => {
    const h = new Set(["2026-11-25", "2026-12-07", "2026-10-30"]);
    expect(closedDaysIn(h, "2026-11-23", "2026-12-07")).toBe(1);
  });
});

describe("판정 — 저장된 기준값과 견준다", () => {
  const pct = (base: number, now: number, nb = 100, nc = 100, better: "up" | "down" = "up") => judgeOutcome({ unit: "percent", better, base, baseSample: nb, now, nowSample: nc });
  it("비율 — 3%p와 표본 오차(칸들이 묶여 있어 √2배) 중 큰 문턱 · 좋아지는 쪽으로", () => {
    expect(pct(80, 95).verdict).toBe("improved");
    expect(pct(80, 81).verdict).toBe("flat");
    // 표본 100씩이면 문턱 ≈ 17.6%p — 80→68(−12)은 오차 안 · 80→60은 악화
    expect(pct(80, 68).verdict).toBe("flat");
    expect(pct(80, 60).verdict).toBe("worse");
    // 결석률처럼 내리면 좋은 지표 · 장기 결석생 하나로 나올 만한 5%p는 판정하지 않는다
    expect(pct(18, 2, 300, 300, "down").verdict).toBe("improved");
    expect(pct(10, 5, 280, 280, "down").verdict).toBe("flat");
    expect(pct(80, 90, 7, 20)).toMatchObject({ verdict: "unknown", threshold: null, reason: expect.stringMatching(/8 미만/) });
  });
  it("건수 — 2건·20%·푸아송 오차(√2배) 중 큰 문턱 · 합 4 미만은 보류", () => {
    expect(judgeOutcome({ unit: "count", better: "up", base: 10, baseSample: null, now: 25, nowSample: null }).verdict).toBe("flat");
    expect(judgeOutcome({ unit: "count", better: "up", base: 10, baseSample: null, now: 30, nowSample: null }).verdict).toBe("improved");
    expect(judgeOutcome({ unit: "count", better: "down", base: 1, baseSample: null, now: 2, nowSample: null })).toMatchObject({ verdict: "unknown" });
  });
  it("금액·숫자 — 표본(건수) 8 미만이면 보류(한두 건이 판정을 뒤집지 않게)", () => {
    expect(judgeOutcome({ unit: "won", better: "down", base: 300_000, baseSample: 1, now: 0, nowSample: 0 })).toMatchObject({ verdict: "unknown", reason: expect.stringMatching(/표본\(건수\)/) });
    expect(judgeOutcome({ unit: "won", better: "down", base: 500_000, baseSample: 20, now: 420_000, nowSample: 20 }).verdict).toBe("improved");
    expect(judgeOutcome({ unit: "won", better: "down", base: 500_000, baseSample: 20, now: 470_000, nowSample: 20 }).verdict).toBe("flat");
    expect(judgeOutcome({ unit: "number", better: "up", base: 3.2, baseSample: 3, now: 3.9, nowSample: 3 }).verdict).toBe("unknown");
    // 표본 칸이 아예 없는 지표(옛 의견)는 '적다'가 아니라 '없다'
    expect(judgeOutcome({ unit: "won", better: "down", base: 500_000, baseSample: null, now: 0, nowSample: null })).toMatchObject({ verdict: "unknown", reason: "표본(건수) 칸이 없어 판정하지 않습니다" });
    expect(judgeOutcome({ unit: "number", better: "up", base: 3.2, baseSample: 12, now: 3.5, nowSample: 12 }).verdict).toBe("improved");
  });
  it("같은 날 다시 잰 기준이 문턱 이상 바뀌었으면(늦은 입력) 보류 · 조금이면 그대로 판정", () => {
    const base = { unit: "count" as const, better: "up" as const, base: 100, baseSample: null, now: 150, nowSample: null };
    expect(judgeOutcome({ ...base, rebase: 150 })).toMatchObject({ verdict: "unknown", reason: "늦게 들어온 기록으로 기준값이 바뀌어(100 → 150) 판정하지 않습니다" });
    expect(judgeOutcome({ ...base, rebase: 104 }).verdict).toBe("improved");
    expect(judgeOutcome({ ...base, rebase: null }).verdict).toBe("improved");
  });
  it("두 기간의 휴원일 수가 다르면 보류", () => {
    expect(judgeOutcome({ unit: "count", better: "up", base: 100, baseSample: null, now: 60, nowSample: null, closed: { base: 0, now: 3 } })).toMatchObject({
      verdict: "unknown",
      reason: "휴원일 수가 달라(기준 기간 0일 · 재측정 기간 3일) 판정하지 않습니다",
    });
  });
});
