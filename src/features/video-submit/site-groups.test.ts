import { describe, expect, it } from "vitest";
import type { SiteChoice } from "./site";
import { groupSiteChoices, siteStep } from "./site-groups";

const hw = (id: string, over: Partial<SiteChoice>): SiteChoice => ({ id, studentLabel: "김*현", className: "BS1K", homeworkLabel: "10/20 (화)", ...over });

// 김채현 건 — 남정화(BS1D) · 허주연(BS1K) 두 선생님, 같은 단원.
const CHOICES: SiteChoice[] = [
  hw("a", { className: "BS1D", homeworkLabel: "10/19 (월)", teacherKey: "t1", teacherLabel: "남정화 (수학)", classKey: "c1" }),
  hw("b", { sent: 1, teacherKey: "t2", teacherLabel: "허주연 (수학)", classKey: "c2" }),
  hw("c", { className: "BS1D", homeworkLabel: "", free: true, teacherKey: "t1", teacherLabel: "남정화 (수학)", classKey: "c1" }),
  hw("d", { homeworkLabel: "", free: true, teacherKey: "t2", teacherLabel: "허주연 (수학)", classKey: "c2" }),
];

describe("groupSiteChoices", () => {
  it("선생님 → 반으로 묶는다 · 서버 순서(안 낸 숙제 선생님 먼저) · 숙제/안 낸 숙제 수", () => {
    const g = groupSiteChoices(CHOICES);
    expect(g.map((t) => [t.label, t.homework, t.unsent])).toEqual([["남정화 (수학)", 1, 1], ["허주연 (수학)", 1, 0]]);
    expect(g[0]!.classes.map((k) => [k.className, k.choices.map((c) => c.id)])).toEqual([["BS1D", ["a", "c"]]]);
  });
  it("열쇠가 없는 옛 응답 = 선생님 하나 · 반은 이름으로", () => {
    const g = groupSiteChoices([hw("x", { className: "LT4" }), hw("y", { className: "LT4", free: true, homeworkLabel: "" }), hw("z", { className: "PS2", pastClass: true })]);
    expect(g).toHaveLength(1);
    expect(g[0]!.label).toBeNull();
    expect(g[0]!.classes.map((k) => [k.className, k.pastClass])).toEqual([["LT4", false], ["PS2", true]]);
  });
});

describe("siteStep", () => {
  const g = groupSiteChoices(CHOICES);
  it("선생님이 둘이면 선생님부터 고른다", () => {
    expect(siteStep(g, {}).step).toBe("teacher");
  });
  it("선생님을 고르면 반이 하나라 바로 숙제 단계", () => {
    const s = siteStep(g, { teacher: "t2" });
    expect(s.step === "homework" && s.klass.className).toBe("BS1K");
  });
  it("선생님이 하나 · 반이 둘이면 반 단계부터 · 목록에 없는 열쇠는 고르지 않은 것", () => {
    const one = groupSiteChoices([hw("x", { className: "LT4", classKey: "c1" }), hw("z", { className: "PS2", classKey: "c2" })]);
    expect(siteStep(one, {}).step).toBe("class");
    expect(siteStep(one, { klass: "c9" }).step).toBe("class");
    expect(siteStep(g, { teacher: "t9" }).step).toBe("teacher");
  });
});
