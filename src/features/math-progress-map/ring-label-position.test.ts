import { describe, expect, it } from "vitest";
import { ringLabelAngle } from "./ring-label-position";
import { normAngle } from "./geometry";

describe("월에 따른 링 이름표 위치", () => {
  it("10~3월은 6시, 4~9월은 12시에 놓는다", () => {
    for (let month = 1; month <= 12; month++) {
      expect(normAngle(ringLabelAngle(0, month))).toBe(month >= 4 && month <= 9 ? 0 : 180);
    }
  });
  it("같은 반년 구간에서는 연도가 넘어가도 움직이지 않는다", () => {
    expect(ringLabelAngle(180, 12)).toBe(180);
    expect(ringLabelAngle(180, 1)).toBe(180);
    expect(ringLabelAngle(0, 4)).toBe(0);
    expect(ringLabelAngle(0, 9)).toBe(0);
  });
  it("이전·다음 월 탐색 모두 경계에서 시계방향으로 반 바퀴 이동한다", () => {
    const april = ringLabelAngle(180, 4);
    expect(april).toBe(360);
    const october = ringLabelAngle(april, 10);
    expect(october).toBe(540);
    expect(ringLabelAngle(october, 9)).toBe(720);
  });
  it("연속 지도는 과거로 돌아갈 때 반시계방향으로 이동하고 같은 구간에서는 유지한다", () => {
    const october = ringLabelAngle(0, 10, "clockwise");
    expect(october).toBe(180);
    const september = ringLabelAngle(october, 9, "counterclockwise");
    expect(september).toBe(0);
    const march = ringLabelAngle(september, 3, "counterclockwise");
    expect(march).toBe(-180);
    expect(ringLabelAngle(march, 2, "counterclockwise")).toBe(-180);
    expect(ringLabelAngle(march, 4, "clockwise")).toBe(0);
  });
});
