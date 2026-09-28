import { describe, expect, it } from "vitest";
import { inRange, parseType, resolveRange, sortExitRows, toExitRows, withdrawalSubjects } from "./exit-rows";

const month = { from: "2026-09-01", to: "2026-09-28" };
const today = "2026-09-28";

describe("withdrawalSubjects — 퇴원 무렵 끝난 과목 전부", () => {
  it("같은 날 수학·영어를 끊으면 둘 다(김도연 9/1 실측)", () => {
    expect(
      withdrawalSubjects([
        { endDate: "2026-09-01", subject: "math" },
        { endDate: "2026-09-01", subject: "english" },
        { endDate: "2026-09-01", subject: "math" },
      ]),
    ).toEqual(["english", "math"]);
  });
  it("몇 달 전에 끊은 과목은 빼고, 14일 안이면 넣는다", () => {
    expect(
      withdrawalSubjects([
        { endDate: "2026-05-01", subject: "english" },
        { endDate: "2026-09-01", subject: "math" },
        { endDate: "2026-08-20", subject: "science" },
      ]),
    ).toEqual(["math", "science"]);
  });
  it("종료일이 없으면 빈 목록", () => {
    expect(withdrawalSubjects([{ endDate: null, subject: "math" }])).toEqual([]);
  });
});

describe("resolveRange · inRange", () => {
  it("롤링은 시작만 막는다 — 퇴원 예정일도 보인다(옛 동작)", () => {
    const w = resolveRange("30d", { today, month });
    expect(inRange({ date: "2026-10-01", systemBulk: false }, w)).toBe(true);
    expect(inRange({ date: "2026-08-28", systemBulk: false }, w)).toBe(false);
    expect(inRange({ date: "2026-08-29", systemBulk: false }, w)).toBe(true);
  });
  it("이번 달·직접 지정은 양끝 포함, 시스템 정리는 뺀다", () => {
    const w = resolveRange("custom", { today, month, from: "2026-09-01", to: "2026-09-07" });
    expect(inRange({ date: "2026-09-07", systemBulk: false }, w)).toBe(true);
    expect(inRange({ date: "2026-09-08", systemBulk: false }, w)).toBe(false);
    expect(inRange({ date: "2026-09-03", systemBulk: true }, w)).toBe(false);
    expect(inRange({ date: "2026-09-10", systemBulk: false }, resolveRange("month", { today, month }))).toBe(true);
  });
  it("직접 지정 날짜가 비면 최근 30일~오늘, 뒤집히면 바로잡는다", () => {
    expect(resolveRange("custom", { today, month })).toMatchObject({ from: "2026-08-29", to: today });
    expect(resolveRange("custom", { today, month, from: "2026-09-10", to: "2026-09-01" })).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-10",
    });
  });
  it("날짜 없는 줄은 기간을 고르면 빠진다", () => {
    expect(inRange({ date: null, systemBulk: false }, resolveRange("90d", { today, month }))).toBe(false);
    expect(inRange({ date: null, systemBulk: false }, resolveRange("all", { today, month }))).toBe(true);
  });
});

describe("toExitRows — 한 목록", () => {
  const rows = toExitRows(
    [
      {
        id: "w1",
        name: "김도연",
        school: null,
        grade: null,
        withdrawnAt: "2026-09-01",
        lastClassName: "브릿지 D",
        lastClassSubject: "english",
        withdrawalReason: "경쟁 학원",
        metadata: { reason: "competitor", consultation: { adminCalledParent: false, teacherCalledParent: true, talkedWithStudent: false } },
        systemBulk: false,
        exitSubjects: ["english", "math"],
      },
    ],
    [
      {
        id: "s1",
        name: "장건욱",
        school: null,
        grade: null,
        status: "enrolled",
        activeSubjects: ["english"],
        endedDetail: [{ subject: "math", endedAt: "2026-09-02", className: "BS3E", englishTrack: null }],
      },
    ],
  );
  it("퇴원은 끊은 과목 전부, 수강종료는 학생 × 과목 한 줄", () => {
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "withdrawn", subjects: ["english", "math"], consulted: true, reasonKey: "competitor" });
    expect(rows[1]).toMatchObject({ kind: "subject-ended", key: "s1|math", subjects: ["math"], consulted: null, reasonKey: null });
  });
  it("날짜 늦은 순", () => {
    expect(sortExitRows([...rows]).map((r) => r.name)).toEqual(["장건욱", "김도연"]);
  });
});

describe("parseType", () => {
  it("모르는 값은 전체", () => {
    expect(parseType(undefined)).toBe("all");
    expect(parseType("subject-ended")).toBe("subject-ended");
    expect(parseType("x")).toBe("all");
  });
});
