import { describe, expect, it } from "vitest";
import { dutyAllowsSeat, EMPTY_SEAT_DUTIES, landingPathFromDuties } from "./duty";

describe("자리 담당 착지", () => {
  it("담당이 없으면 착지하지 않는다", () => {
    expect(landingPathFromDuties(EMPTY_SEAT_DUTIES)).toBeNull();
    expect(landingPathFromDuties({ lab: false, jj: false })).toBeNull();
  });

  it("랩실 담당이면 랩실 출석부로 착지한다", () => {
    expect(landingPathFromDuties({ lab: true, jj: false })).toBe("/attendance/seat/lab");
  });

  it("JJ실만 켜져 있으면 JJ실 출석부로 착지한다", () => {
    expect(landingPathFromDuties({ lab: false, jj: true })).toBe("/attendance/seat/jj");
    expect(dutyAllowsSeat({ lab: false, jj: true }, "jj")).toBe(true);
  });

  it("둘 다 켜면 목록 앞(랩실)이 이긴다", () => {
    expect(landingPathFromDuties({ lab: true, jj: true })).toBe("/attendance/seat/lab");
  });

  it("켜 둔 자리만 쓰기를 연다", () => {
    expect(dutyAllowsSeat({ lab: true, jj: false }, "lab")).toBe(true);
    expect(dutyAllowsSeat({ lab: true, jj: false }, "jj")).toBe(false);
    expect(dutyAllowsSeat(EMPTY_SEAT_DUTIES, "lab")).toBe(false);
  });
});
