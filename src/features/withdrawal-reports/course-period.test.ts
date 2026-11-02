import { describe, it, expect } from "vitest";
import { courseDuration, subjectPeriodGroups, subjectPeriods } from "./course-period";
describe("calendar course duration", () => {
  it.each([
    ["2026-10-07", "2026-10-22", "0개월, 15일"],
    ["2026-01-31", "2026-02-28", "1개월, 0일"],
    ["2024-01-31", "2024-02-29", "1개월, 0일"],
    ["2026-01-31", "2026-03-01", "1개월, 1일"],
    ["2025-03-01", "2026-10-22", "19개월, 21일"],
    ["2026-10-22", "2026-10-22", "0개월, 0일"],
    ["2026-10-23", "2026-10-22", "기간 확인 필요"],
    ["2026-02-30", "2026-10-22", "기간 확인 필요"],
  ])("%s to %s → %s", (from, to, expected) => expect(courseDuration(from, to)).toBe(expected));
});

describe("수강기간 = 그 과목의 전체 수강 이력(원장 2026-10-29)", () => {
  const label = (s: string) => ({ english: "영어", math: "수학" })[s] ?? s;
  it("지난 반 포함 — 과목 처음 시작일부터, 반마다 한 줄", () => {
    const text = subjectPeriods([{ subject: "english", className: "중등E_중2 심화", startDate: "2026-03-02" }], [
      { subject: "english", className: "중등E_중1 기본", startDate: "2025-03-03", endDate: "2026-02-28" },
      { subject: "english", className: "중등E_중2 심화", startDate: "2026-03-02", endDate: null },
    ], "2026-10-28", label);
    expect(text).toBe("2025-03-03 ~ 2026-10-28 (19개월, 25일)\n· 중등E_중1 기본 2025-03-03 ~ 2026-02-28\n· 중등E_중2 심화 2026-03-02 ~ 2026-10-28");
  });
  it("같은 과목의 계속 다니는 반은 빼고 · 쉬었다 다시 다니면 중단 N회(리뷰)", () => {
    const text = subjectPeriods([{ id: "a", subject: "math", className: "A반", startDate: "2026-03-01" }], [
      { enrollmentId: "old", subject: "math", className: "옛반", startDate: "2024-03-01", endDate: "2024-06-30" },
      { enrollmentId: "a", subject: "math", className: "A반", startDate: "2026-03-01", endDate: null },
      { enrollmentId: "b", subject: "math", className: "B반(계속)", startDate: "2025-01-01", endDate: null },
    ], "2026-10-01", label);
    expect(text).not.toContain("B반");
    expect(text.split("\n")[0]).toBe("2024-03-01 ~ 2026-10-01 (31개월, 0일 · 중단 1회)");
    expect(text).toContain("· 옛반 2024-03-01 ~ 2024-06-30");
    expect(text).toContain("· A반 2026-03-01 ~ 2026-10-01");
  });
  it("반 하나면 한 줄 · 이력이 없으면 지금 반 시작일 · 과목이 둘이면 과목 이름", () => {
    expect(subjectPeriods([{ subject: "math", className: "M", startDate: "2026-09-01" }], [], "2026-10-01", label)).toBe("2026-09-01 ~ 2026-10-01 (1개월, 0일)");
    expect(subjectPeriods([
      { subject: "math", className: "M", startDate: "2026-09-01" },
      { subject: "english", className: "E", startDate: "2026-08-01" },
    ], [], "2026-10-01", label)).toBe("수학: 2026-09-01 ~ 2026-10-01 (1개월, 0일)\n영어: 2026-08-01 ~ 2026-10-01 (2개월, 0일)");
  });
});

describe("특강은 수강기간에 적지 않는다(원장 2026-11-02)", () => {
  const label = (s: string) => s;
  const regular = { id: "m", subject: "math", className: "MS2A", startDate: "2026-02-19" };
  const row = (enrollmentId: string, className: string, startDate: string, endDate: string | null, isSpecial?: boolean) => ({ enrollmentId, subject: "math", className, startDate, endDate, isSpecial });

  it("특강 줄은 반 목록에서 빠지고 n회로 따로 나온다", () => {
    const [g] = subjectPeriodGroups([regular], [
      row("m", "MS2A", "2026-02-19", null),
      row("s1", "[특강]중2-2 문제 풀이반", "2026-07-23", "2026-08-27"),
      row("s2", "[특강]중3-2 개념 완성반", "2026-08-17", "2026-09-10"),
    ], "2026-10-30", label);
    expect(g.classes.map(c => c.className)).toEqual(["MS2A"]);
    expect(g.specials).toEqual([
      { className: "[특강]중2-2 문제 풀이반", startDate: "2026-07-23", endDate: "2026-08-27" },
      { className: "[특강]중3-2 개념 완성반", startDate: "2026-08-17", endDate: "2026-09-10" },
    ]);
    expect(subjectPeriods([regular], [row("m", "MS2A", "2026-02-19", null), row("s1", "[특강]A", "2026-07-23", "2026-08-27")], "2026-10-30", label))
      .toBe("2026-02-19 ~ 2026-10-30 (8개월, 11일)\n· 특강 수강 × 1회");
  });
  it("정규 반 앞의 특강은 첫날을 당기지 않고 · 공백 사이 특강은 중단을 가리지 않는다", () => {
    const [before] = subjectPeriodGroups([regular], [row("s", "겨울 특강", "2025-12-20", "2026-01-20"), row("m", "MS2A", "2026-02-19", null)], "2026-10-30", label);
    expect(before.first).toBe("2026-02-19");
    expect(before.gaps).toBe(0);
    const [gap] = subjectPeriodGroups([regular], [
      row("old", "옛반", "2025-03-01", "2025-06-30"), row("s", "여름 특강", "2025-08-01", "2025-08-20"), row("m", "MS2A", "2026-02-19", null),
    ], "2026-10-30", label);
    expect(gap.first).toBe("2025-03-01");
    expect(gap.gaps).toBe(1);
  });
  it("특강만 다닌 과목은 특강이 곧 수강기간 · 반 목록은 비고 n회만", () => {
    const [g] = subjectPeriodGroups([{ id: "s", subject: "math", className: "[특강] 개별", startDate: "2026-07-01" }],
      [row("s", "[특강] 개별", "2026-07-01", null)], "2026-08-01", label);
    expect([g.first, g.duration, g.gaps]).toEqual(["2026-07-01", "1개월, 0일", 0]);
    expect(g.classes).toEqual([]);
    expect(g.specials).toHaveLength(1);
  });
  it("판정 = 특강 토글 또는 이름 · 이력이 없어도, 고정된 옛 이력(칸 없음)도 이름으로", () => {
    const [toggled] = subjectPeriodGroups([regular], [row("m", "MS2A", "2026-02-19", null), row("t", "여름 집중반", "2026-07-01", "2026-07-30", true)], "2026-10-30", label);
    expect(toggled.specials.map(c => c.className)).toEqual(["여름 집중반"]);
    const [noHistory] = subjectPeriodGroups([regular, { subject: "math", className: "[특강] 개별", startDate: "2026-07-01" }], [], "2026-10-30", label);
    expect(noHistory.classes.map(c => c.className)).toEqual(["MS2A"]);
    expect(noHistory.specials.map(c => c.className)).toEqual(["[특강] 개별"]);
    expect(noHistory.first).toBe("2026-02-19");
  });
  it("토글만 켠 지금 반 = 이력의 판정을 따른다(스냅숏엔 토글이 없다 · 리뷰)", () => {
    const special = { id: "t", subject: "math", className: "여름 집중반", startDate: "2026-07-01" };
    const [only] = subjectPeriodGroups([special], [row("t", "여름 집중반", "2026-07-01", null, true)], "2026-08-01", label);
    expect(only.classes).toEqual([]);
    expect(only.specials.map(c => c.className)).toEqual(["여름 집중반"]);
    const [mixed] = subjectPeriodGroups([{ ...special, startDate: "2026-01-05" }, regular],
      [row("t", "여름 집중반", "2026-01-05", null, true), row("m", "MS2A", "2026-02-19", null)], "2026-10-30", label);
    expect(mixed.first).toBe("2026-02-19");
  });
  it("정규 반이 끝나고 뒤쪽 특강만 남아도 그 공백은 중단으로 남는다(리뷰)", () => {
    const [g] = subjectPeriodGroups([{ id: "s", subject: "math", className: "[특강] 개별", startDate: "2026-07-01" }],
      [row("r", "정규반", "2026-01-01", "2026-03-31"), row("s", "[특강] 개별", "2026-07-01", null)], "2026-08-30", label);
    expect(g.first).toBe("2026-01-01");
    expect(g.gaps).toBe(1);
    expect(g.classes.map(c => c.className)).toEqual(["정규반"]);
    expect(g.specials.map(c => c.className)).toEqual(["[특강] 개별"]);
  });
});
