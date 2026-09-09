import { describe, expect, it } from "vitest";

import { classesWithFinishedPeriod, hhmmToMinutes } from "./day-recording";

describe("hhmmToMinutes", () => {
  it("HH:MM·HH:MM:SS 둘 다 읽는다", () => {
    expect(hhmmToMinutes("16:20")).toBe(980);
    expect(hhmmToMinutes("16:20:00")).toBe(980);
  });

  it("모르는 값은 null(추측하지 않는다)", () => {
    expect(hhmmToMinutes(null)).toBeNull();
    expect(hhmmToMinutes("")).toBeNull();
    expect(hhmmToMinutes("점심")).toBeNull();
    expect(hhmmToMinutes("99:99")).toBeNull();
  });
});

describe("교시가 끝난 반만 재촉 후보", () => {
  const at = (h: number, m = 0) => h * 60 + m;

  it("종료 시각이 지난 교시의 반만 담는다", () => {
    const finished = classesWithFinishedPeriod(
      [
        { classId: "c1", startTime: "16:20:00", endTime: "17:00:00" },
        { classId: "c2", startTime: "18:00:00", endTime: "19:00:00" },
      ],
      at(17, 30),
    );
    expect([...finished]).toEqual(["c1"]);
  });

  it("종료 시각 정각이면 끝난 것으로 본다", () => {
    const finished = classesWithFinishedPeriod(
      [{ classId: "c1", startTime: "16:20:00", endTime: "17:00:00" }],
      at(17, 0),
    );
    expect(finished.has("c1")).toBe(true);
  });

  it("수업 중인 반은 후보가 아니다(재촉이 아니라 소음)", () => {
    const finished = classesWithFinishedPeriod(
      [{ classId: "c1", startTime: "16:20:00", endTime: "17:00:00" }],
      at(16, 40),
    );
    expect(finished.size).toBe(0);
  });

  it("한 교시라도 끝났으면 그 반은 후보(하루 여러 교시)", () => {
    const finished = classesWithFinishedPeriod(
      [
        { classId: "c1", startTime: "16:20:00", endTime: "17:00:00" },
        { classId: "c1", startTime: "19:00:00", endTime: "20:00:00" },
      ],
      at(17, 30),
    );
    expect([...finished]).toEqual(["c1"]);
  });

  it("종료 시각이 없으면 시작 시각으로 폴백한다", () => {
    const finished = classesWithFinishedPeriod(
      [{ classId: "c1", startTime: "16:20:00", endTime: null }],
      at(16, 30),
    );
    expect(finished.has("c1")).toBe(true);
  });

  it("시각을 통째로 모르면 후보에서 뺀다", () => {
    const finished = classesWithFinishedPeriod(
      [{ classId: "c1", startTime: null, endTime: null }],
      at(23, 0),
    );
    expect(finished.size).toBe(0);
  });

  it("자정 직후(0분)엔 아무 교시도 끝나지 않았다", () => {
    const finished = classesWithFinishedPeriod(
      [{ classId: "c1", startTime: "16:20:00", endTime: "17:00:00" }],
      0,
    );
    expect(finished.size).toBe(0);
  });
});
