import { describe, expect, it } from "vitest";
import { summarizeReportMetrics } from "./report-metrics";

const R = (dailyTest: string | null, homework: string | null, examInfo: string | null = null) => ({
  dailyTest,
  checkTest: null,
  examInfo,
  homework,
});

describe("summarizeReportMetrics", () => {
  it("실데이터 표기 둘 다 읽는다 — '5문제 중 4개 맞음' · '5문제 중 4개'", () => {
    const m = summarizeReportMetrics([R("5문제 중 4개 맞음", "100%"), R("5문제 중 4개", "80%")]);
    expect(m.dtAvg).toBe(80);
    expect(m.dtCount).toBe(2);
    expect(m.hwAvg).toBe(90);
    expect(m.hwCount).toBe(2);
  });

  it("🔴 null은 0이 아니다 — 안 친 날은 분모에서 뺀다", () => {
    const m = summarizeReportMetrics([R("10문제 중 10개 맞음", null), R(null, null), R("", "없음")]);
    expect(m.dtAvg).toBe(100);
    expect(m.dtCount).toBe(1);
    expect(m.hwAvg).toBeNull();
    expect(m.hwCount).toBe(0);
  });

  it("옛 표기 — 완료=100 · 미제출=0 · 일부 미흡은 제외", () => {
    const m = summarizeReportMetrics([R(null, "완료"), R(null, "미제출"), R(null, "일부 미흡")]);
    expect(m.hwAvg).toBe(50);
    expect(m.hwCount).toBe(2);
  });

  it("옛 합본(edutrix 이관) — '일일 4/5'는 세고, 라벨 없는 '4/5'는 안 센다", () => {
    const m = summarizeReportMetrics([R(null, null, "일일 4/5"), R(null, null, "4/5")]);
    expect(m.dtAvg).toBe(80);
    expect(m.dtCount).toBe(1);
  });

  it("아무것도 없으면 전부 null/0", () => {
    expect(summarizeReportMetrics([])).toEqual({ dtAvg: null, dtCount: 0, hwAvg: null, hwCount: 0 });
  });
});
