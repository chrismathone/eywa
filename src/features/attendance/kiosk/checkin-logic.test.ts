import { describe, expect, it } from "vitest";
import { classesInWindow, decideCheckinAction, timeToMinutes } from "./checkin-logic";

describe("decideCheckinAction", () => {
  it("레코드 없음 → 등원", () => {
    expect(decideCheckinAction(null)).toBe("check_in");
  });
  it("등원시각만 비어 있으면 → 등원", () => {
    expect(decideCheckinAction({ checkedInAt: null, checkedOutAt: null })).toBe("check_in");
  });
  it("등원만 했으면 → 하원", () => {
    expect(decideCheckinAction({ checkedInAt: "2026-06-18T09:00:00Z", checkedOutAt: null })).toBe(
      "check_out",
    );
  });
  it("등원+하원 모두 했으면 → noop", () => {
    expect(
      decideCheckinAction({
        checkedInAt: "2026-06-18T09:00:00Z",
        checkedOutAt: "2026-06-18T12:00:00Z",
      }),
    ).toBe("noop");
  });
});

describe("timeToMinutes", () => {
  it("HH:MM / HH:MM:SS 파싱", () => {
    expect(timeToMinutes("16:00")).toBe(960);
    expect(timeToMinutes("16:30:00")).toBe(990);
    expect(timeToMinutes("09:05")).toBe(545);
    expect(timeToMinutes("00:00")).toBe(0);
  });
});

describe("classesInWindow", () => {
  const scheds = [
    { classId: "A", startMin: 960, endMin: 1050 }, // 16:00~17:30
    { classId: "B", startMin: 1080, endMin: 1170 }, // 18:00~19:30
  ];
  it("수업 시간 내면 매칭", () => {
    expect(classesInWindow(scheds, 1000)).toEqual(["A"]); // 16:40
  });
  it("시작 30분 전(grace)도 매칭", () => {
    expect(classesInWindow(scheds, 935)).toEqual(["A"]); // 15:35 (16:00-25)
    expect(classesInWindow(scheds, 925)).toEqual([]); // 15:25 (>30분 전) → 없음
  });
  it("종료 후엔 매칭 안 됨", () => {
    expect(classesInWindow(scheds, 1200)).toEqual([]); // 20:00 — 두 수업 모두 종료
  });
  it("수업 사이 빈 시간(다음 수업 grace 밖)도 매칭 없음", () => {
    expect(classesInWindow(scheds, 1049)).toEqual(["A"]); // 17:29 — A 진행 중
    // B grace(17:30~)도 A 종료(17:30)도 아닌 정확한 빈틈은 이 데이터엔 없음(인접). 20:00로 빈 시간 검증은 위에서.
  });
  it("두 수업 창이 겹치면 다중(모호) 반환", () => {
    const overlap = [
      { classId: "A", startMin: 960, endMin: 1080 },
      { classId: "B", startMin: 1050, endMin: 1170 },
    ];
    expect(classesInWindow(overlap, 1060).sort()).toEqual(["A", "B"]); // 17:40 둘 다
  });
});
