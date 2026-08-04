import { describe, expect, it } from "vitest";
import {
  buildTeacherAsOfIndex,
  historyWindowStart,
  resolveTeacherAsOf,
  type MonthlyWriter,
  type TeacherTransition,
} from "./teacher-as-of";

const idx = (t: TeacherTransition[], w: MonthlyWriter[] = [], since = "2026-06-01") =>
  buildTeacherAsOfIndex({ transitions: t, writers: w, since });

describe("resolveTeacherAsOf — 인수인계 기록(사실)", () => {
  const i = idx([
    { classId: "c1", date: "2026-07-01", teacherName: "김강사" },
    { classId: "c1", date: "2026-08-04", teacherName: "허은진" },
  ]);

  it("그 날짜 이하의 마지막 인계가 그때 담임", () => {
    expect(resolveTeacherAsOf(i, "c1", "2026-07-15")).toEqual({ name: "김강사", inferred: false });
    expect(resolveTeacherAsOf(i, "c1", "2026-08-05")).toEqual({ name: "허은진", inferred: false });
  });

  it("인계 당일부터 새 담임", () => {
    expect(resolveTeacherAsOf(i, "c1", "2026-08-04")!.name).toBe("허은진");
    expect(resolveTeacherAsOf(i, "c1", "2026-08-03")!.name).toBe("김강사");
  });
});

describe("resolveTeacherAsOf — 보고서 작성자(추정)", () => {
  it("🔴 인계가 그 날짜보다 뒤에만 있으면 보고서로 메우고 **추정으로 표시**한다", () => {
    const i = idx(
      [{ classId: "c1", date: "2026-08-04", teacherName: "허은진" }],
      [{ classId: "c1", month: "2026-07", teacherName: "이유정", count: 7 }],
    );
    expect(resolveTeacherAsOf(i, "c1", "2026-07-15")).toEqual({ name: "이유정", inferred: true });
  });

  it("같은 달에 여러 명이면 건수 많은 쪽(동수면 이름 순 — 결정적)", () => {
    const i = idx(
      [],
      [
        { classId: "c1", month: "2026-07", teacherName: "나중", count: 2 },
        { classId: "c1", month: "2026-07", teacherName: "많이", count: 9 },
      ],
    );
    expect(resolveTeacherAsOf(i, "c1", "2026-07-10")).toEqual({ name: "많이", inferred: true });
  });

  it("근거가 없으면 null — 빈 이름을 지어내지 않는다(호출부가 현재 담임을 쓴다)", () => {
    expect(resolveTeacherAsOf(idx([]), "c1", "2026-07-10")).toBeNull();
  });

  it("창(2개월) 밖은 추정하지 않는다", () => {
    const i = idx([], [{ classId: "c1", month: "2026-03", teacherName: "옛사람", count: 5 }], "2026-06-01");
    expect(resolveTeacherAsOf(i, "c1", "2026-03-10")).toBeNull();
  });

  it("이름 없는 전이는 이력이 못 된다(빈 칸 방지)", () => {
    const i = idx([{ classId: "c1", date: "2026-07-01", teacherName: null }]);
    expect(resolveTeacherAsOf(i, "c1", "2026-07-15")).toBeNull();
  });
});

describe("historyWindowStart", () => {
  it("N개월 전 1일", () => {
    expect(historyWindowStart("2026-08-04", 2)).toBe("2026-06-01");
    expect(historyWindowStart("2026-01-15", 2)).toBe("2025-11-01");
  });
});
