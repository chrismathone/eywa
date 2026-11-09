import { expect, it } from "vitest";
import { studentContributionHref } from "./student-route";
it("내부 메뉴·월·필터를 학생 상세 안에 유지한다", () => {
  const link = new URL(studentContributionHref("/student-contribution/ontology?month=2026-09&view=current&kind=class&entity=c&embed=1", "s", "/students?q=김"), "https://test.local");
  expect(link.pathname).toBe("/students/s");
  expect(Object.fromEntries(link.searchParams)).toEqual({ month: "2026-09", view: "current", kind: "class", entity: "c", embed: "1", tab: "contribution", contribution: "ontology", back: "/students?q=김" });
  const month = new URL(studentContributionHref("/student-contribution/s?month=2026-08&view=evidence&contribution=list", "s"), link.origin);
  expect(month.searchParams.get("contribution")).toBeNull(); expect(month.searchParams.get("view")).toBe("evidence");
});
it("다른 학생 선택은 그 학생의 상세로, 외부·원본 링크는 원래 경로로 간다", () => {
  expect(studentContributionHref("/student-contribution/ranking", "s")).toBe("/student-contribution/ranking");
  expect(studentContributionHref("/student-contribution/other", "s")).toBe("/students/other?tab=contribution");
  expect(studentContributionHref("/student-contribution/settings", "s")).toBe("/students/s?tab=contribution&contribution=settings");
  expect(studentContributionHref("/student-contribution", "s")).toBe("/students/s?tab=contribution&contribution=list");
  for (const href of ["/students/s?tab=homework-videos", "https://example.com/student-contribution", "/student-contribution-other", "#summary"]) expect(studentContributionHref(href, "s")).toBe(href);
});
