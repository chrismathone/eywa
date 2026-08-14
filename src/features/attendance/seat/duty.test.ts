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

  it("JJ실만 켜져 있어도 1차에선 착지하지 않는다(아직 안 연 자리)", () => {
    expect(landingPathFromDuties({ lab: false, jj: true })).toBeNull();
    expect(dutyAllowsSeat({ lab: false, jj: true }, "jj")).toBe(false);
  });

  it("둘 다 켜면 열린 자리(랩실)가 이긴다", () => {
    expect(landingPathFromDuties({ lab: true, jj: true })).toBe("/attendance/seat/lab");
  });

  it("랩실 담당만 그 자리 쓰기를 연다", () => {
    expect(dutyAllowsSeat({ lab: true, jj: false }, "lab")).toBe(true);
    expect(dutyAllowsSeat({ lab: true, jj: false }, "jj")).toBe(false);
    expect(dutyAllowsSeat(EMPTY_SEAT_DUTIES, "lab")).toBe(false);
  });
});
