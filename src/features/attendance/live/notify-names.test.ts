import { describe, expect, it } from "vitest";
import { collectStudentNames, formatAttendanceNotifyNames } from "./notify-names";

describe("formatAttendanceNotifyNames", () => {
  it("한 명이면 이름만", () => {
    expect(formatAttendanceNotifyNames(["김철수"], 1)).toEqual({
      who: "김철수",
      listedLabel: "김철수",
    });
  });

  it("여러 명이면 건수는 expected — 이름 배열 길이가 아니다(#89)", () => {
    expect(formatAttendanceNotifyNames(["김철수", "이영희"], 3)).toEqual({
      who: "김철수 외 2명",
      listedLabel: "김철수, 이영희 외 1명",
    });
  });

  it("일괄 150명인데 이름이 100개만 오면 외 149명이지 외 99명이 아니다", () => {
    const names = Array.from({ length: 100 }, (_, i) => `학생${i}`);
    const { who } = formatAttendanceNotifyNames(names, 150);
    expect(who).toBe("학생0 외 149명");
    expect(who).not.toMatch(/외 99명/);
  });

  it("이름을 하나도 못 찾아도 건수는 남긴다 — 벨을 안 보내면 일괄이 조용히 사라진다", () => {
    expect(formatAttendanceNotifyNames([], 5)).toEqual({ who: "학생 외 4명", listedLabel: "5명" });
  });
});

describe("collectStudentNames", () => {
  it("못 찾은 id를 missing으로 센다", () => {
    const map = new Map([["a", "김철수"]]);
    expect(collectStudentNames(["a", "b", "c"], map)).toEqual({ names: ["김철수"], missing: 2 });
  });
});
