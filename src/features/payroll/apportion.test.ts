import { describe, expect, it } from "vitest";
import { dowApportionRatio, dowKeyOf, formatDowKeys } from "./apportion";

// 2026-07: 04(토) 11(토) 18(토) 25(토) / 01(수) 08(수) 15(수) 22(수)
const SAT = ["2026-07-04", "2026-07-11", "2026-07-18", "2026-07-25"];
const WED = ["2026-07-01", "2026-07-08", "2026-07-15", "2026-07-22"];
const u = (dates: string[], units = 1) => dates.map((date) => ({ date, units }));

describe("dowKeyOf", () => {
  it("날짜를 요일 키로", () => {
    expect(dowKeyOf("2026-07-04")).toBe("sat");
    expect(dowKeyOf("2026-07-01")).toBe("wed");
    expect(dowKeyOf("2026-07-19")).toBe("sun");
  });
  it("이상한 날짜는 null", () => {
    expect(dowKeyOf("bad")).toBeNull();
  });
});

describe("dowApportionRatio — 적용 요일 시수 비중", () => {
  it("적용 요일이 없으면 안분하지 않는다(1)", () => {
    expect(dowApportionRatio(u([...SAT, ...WED]), null)).toBe(1);
    expect(dowApportionRatio(u([...SAT, ...WED]), [])).toBe(1);
  });
  it("토+수 반에서 토요일만 → 절반", () => {
    expect(dowApportionRatio(u([...SAT, ...WED]), ["sat"])).toBeCloseTo(0.5, 10);
  });
  it("횟수가 다르면 시수 비중대로 — 토 4회·수 2회면 2/3", () => {
    expect(dowApportionRatio(u([...SAT, ...WED.slice(0, 2)]), ["sat"])).toBeCloseTo(4 / 6, 10);
  });
  it("시수 배수(보강 2시수 등)를 반영한다", () => {
    const sessions = [...u(SAT.slice(0, 1), 2), ...u(WED.slice(0, 2), 1)]; // 토 2시수 + 수 2시수
    expect(dowApportionRatio(sessions, ["sat"])).toBeCloseTo(0.5, 10);
  });
  it("적용 요일에 수업이 하나도 없으면 0(그 달은 비율제 몫 없음)", () => {
    expect(dowApportionRatio(u(WED), ["sat"])).toBe(0);
  });
  it("전 요일을 다 지정하면 1", () => {
    expect(dowApportionRatio(u([...SAT, ...WED]), ["sat", "wed"])).toBe(1);
  });
  it("⚠️ 시수 기록이 없으면 null — 0이나 1로 지어내지 않는다", () => {
    expect(dowApportionRatio([], ["sat"])).toBeNull();
    expect(dowApportionRatio(u([...SAT], 0), ["sat"])).toBeNull();
  });

  describe("scheduledDows — 주말 반인데 주말 출석이 아직 없으면 보류(0 지어내기 금지)", () => {
    it("시간표에 토가 잡힌 반이 평일 시수만 있으면 → null(보류·출석 미입력)", () => {
      // 토·수 복합 반인데 이번 달 수요일 출석만 입력됨 → 토 시수 0 → 0 아니라 보류
      expect(dowApportionRatio(u(WED), ["sat"], { scheduledDows: ["wed", "sat"] })).toBeNull();
    });
    it("시간표가 순수 평일이면 → 0 유지(비율제 대상 아님, 원장 규칙)", () => {
      expect(dowApportionRatio(u(WED), ["sat"], { scheduledDows: ["wed", "fri"] })).toBe(0);
    });
    it("시간표 정보가 없으면(하위호환) 종전대로 0", () => {
      expect(dowApportionRatio(u(WED), ["sat"])).toBe(0);
      expect(dowApportionRatio(u(WED), ["sat"], {})).toBe(0);
    });
    it("주말 시수가 실제로 있으면 scheduledDows와 무관하게 정상 비중", () => {
      expect(dowApportionRatio(u([...SAT, ...WED]), ["sat"], { scheduledDows: ["wed", "sat"] })).toBeCloseTo(0.5, 10);
    });
  });
});

describe("formatDowKeys", () => {
  it("요일 순서대로 한글로", () => {
    expect(formatDowKeys(["sat", "wed"])).toBe("수·토");
    expect(formatDowKeys(null)).toBe("전체");
    expect(formatDowKeys([])).toBe("전체");
  });
});
