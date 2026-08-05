import { describe, expect, it } from "vitest";
import { bucketTrend, pickGranularity } from "./trend-buckets";

describe("pickGranularity — 점 개수를 상한에 묶는다", () => {
  it("한 해(12개월)는 월별 그대로", () => {
    expect(pickGranularity(12)).toBe("month");
  });

  it("전체 기간이 길어지면 분기 → 연으로 굵어진다", () => {
    expect(pickGranularity(26)).toBe("month");
    expect(pickGranularity(44)).toBe("quarter"); // 지금(2023-01~2026-08)
    expect(pickGranularity(78)).toBe("quarter");
    expect(pickGranularity(79)).toBe("year"); // 6년 반이 넘으면 연별
  });

  it("🔴 몇 년이 쌓여도 점 개수가 상한 근처에 머문다 — 그게 이 함수의 목적이다", () => {
    for (const months of [12, 44, 60, 120, 240]) {
      const g = pickGranularity(months);
      const points = g === "month" ? months : g === "quarter" ? Math.ceil(months / 3) : Math.ceil(months / 12);
      expect(points, `${months}개월 → ${g} = ${points}점`).toBeLessThanOrEqual(30);
    }
  });
});

describe("bucketTrend", () => {
  const months = [
    { month: "2025-01", total: 10, enrolled: 5 },
    { month: "2025-02", total: 20, enrolled: 10 },
    { month: "2025-03", total: 30, enrolled: 3 },
    { month: "2025-04", total: 40, enrolled: 20 },
  ];

  it("분기로 묶으면 합산된다", () => {
    const out = bucketTrend(months, "quarter");
    expect(out).toHaveLength(2);
    expect(out[0]!.total).toBe(60); // 1~3월
    expect(out[0]!.enrolled).toBe(18);
    expect(out[1]!.total).toBe(40);
  });

  it("🔴 비율은 **합을 먼저 내고** 나눈다 — 월별 비율의 평균이 아니다", () => {
    const out = bucketTrend(months, "quarter");
    // 합 기준: 18/60 = 30%. 월별 비율(50%·50%·10%) 평균이면 37%로 부풀어 오른다.
    expect(out[0]!.rate).toBe(30);
    expect(out[0]!.rate).not.toBe(37);
  });

  it("연으로 묶으면 한 점", () => {
    const out = bucketTrend(months, "year");
    expect(out).toHaveLength(1);
    expect(out[0]!.total).toBe(100);
    expect(out[0]!.label).toBe("25년");
  });

  it("월 단위 라벨 — 전체 기간에선 1월에만 연도를 보여 해 경계를 알린다", () => {
    const plain = bucketTrend(months, "month");
    expect(plain.map((p) => p.label)).toEqual(["1월", "2월", "3월", "4월"]);
    const yearly = bucketTrend(months, "month", true);
    expect(yearly.map((p) => p.label)).toEqual(["25년", "", "", ""]);
  });

  it("상담이 0인 구간의 비율은 null — 0%로 그리면 '다 놓쳤다'로 읽힌다", () => {
    const out = bucketTrend([{ month: "2025-05", total: 0, enrolled: 0 }], "month");
    expect(out[0]!.rate).toBeNull();
  });

  it("정렬은 시간순 — 입력이 뒤섞여 있어도", () => {
    const out = bucketTrend([...months].reverse(), "quarter");
    expect(out.map((p) => p.key)).toEqual(["2025-Q1", "2025-Q2"]);
  });
});
