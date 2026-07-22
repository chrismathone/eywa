import { describe, it, expect } from "vitest";
import { matchReportsToRows, reportUnitKey } from "./report-unit";

describe("reportUnitKey", () => {
  it("반이 있으면 반이 단위", () => {
    expect(reportUnitKey("c1", "math")).toBe("c1");
  });

  it("반이 없으면 과목이 단위(관리자 작성·구버전 행)", () => {
    expect(reportUnitKey(null, "math")).toBe("math");
    expect(reportUnitKey("  ", "math")).toBe("math");
  });

  it("둘 다 없으면 null — 이관분(제약 밖)", () => {
    expect(reportUnitKey(null, null)).toBeNull();
    expect(reportUnitKey(undefined, "")).toBeNull();
  });
});

describe("matchReportsToRows", () => {
  const row = (classId: string | null, subjectKey: string | null) => ({ classId, subjectKey });
  const rep = (classId: string | null, subject: string | null, tag = "") => ({ classId, subject, tag });

  it("정규·특강 두 행이 각자의 보고서를 가져간다", () => {
    const rows = [row("정규", "math"), row("특강", "math")];
    const reports = [rep("특강", "math", "T"), rep("정규", "math", "R")];
    expect(matchReportsToRows(rows, reports).map((r) => r?.tag)).toEqual(["R", "T"]);
  });

  it("반이 없는 보고서(관리자 작성·구버전)는 같은 과목 행에 붙는다", () => {
    const rows = [row("c1", "math")];
    expect(matchReportsToRows(rows, [rep(null, "math", "A")])?.[0]?.tag).toBe("A");
  });

  it("🔴 반 없는 보고서 1건을 같은 과목 두 행이 나눠 갖지 않는다 — 앞 행만", () => {
    const rows = [row("정규", "math"), row("특강", "math")];
    const got = matchReportsToRows(rows, [rep(null, "math", "A")]);
    expect(got.map((r) => r?.tag)).toEqual(["A", undefined]);
  });

  it("반 정확매칭이 과목 폴백을 이긴다(순서 무관)", () => {
    const rows = [row("정규", "math"), row("특강", "math")];
    // 반 없는 행이 먼저 와도 특강 행은 자기 반 보고서를 가져가야 한다.
    const got = matchReportsToRows(rows, [rep(null, "math", "A"), rep("특강", "math", "T")]);
    expect(got.map((r) => r?.tag)).toEqual(["A", "T"]);
  });

  it("과목도 반도 없는 이관분은 단일 과목 학생에게만 붙는다", () => {
    expect(matchReportsToRows([row("c1", "math")], [rep(null, null, "L")])?.[0]?.tag).toBe("L");
    // 다과목 학생 — 어느 과목인지 알 수 없어 붙이지 않는다.
    const multi = matchReportsToRows([row("c1", "math"), row("c2", "english")], [rep(null, null, "L")]);
    expect(multi).toEqual([undefined, undefined]);
  });

  it("다른 반 보고서는 안 붙는다(교차 주입 금지)", () => {
    expect(matchReportsToRows([row("정규", "math")], [rep("특강", "math")])?.[0]).toBeUndefined();
  });

  it("보고서가 없으면 전부 undefined", () => {
    expect(matchReportsToRows([row("c1", "math"), row("c2", "english")], [])).toEqual([undefined, undefined]);
  });
});
