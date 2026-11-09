"use client";
import { ContributionLink as Link } from "./student-contribution-scope";
import { DEFAULT_STUDENT_FILTERS, writeStudentFilters, type StudentFilters } from "../model/student-filters";
import { useSearchParams } from "next/navigation";

export function OntologyViewMode({ current, month, filters = DEFAULT_STUDENT_FILTERS, scope }: { current: boolean; month?: string; filters?: StudentFilters; scope?: { kind: string; id: string } }) {
  const search = useSearchParams();
  const shared = writeStudentFilters(new URLSearchParams(), filters);
  const selectedMonth = month ?? search.get("month");
  if (selectedMonth) shared.set("month", selectedMonth);
  if (scope) { shared.set("kind", scope.kind); shared.set("entity", scope.id); }
  if (search.get("embed") === "1") shared.set("embed", "1");
  const currentParams = new URLSearchParams(shared); currentParams.set("view", "current");
  const monthParams = shared;
  return <nav aria-label="연결 기록의 기준" className="flex flex-wrap gap-2">
    {[[true, "현재 수강 연결", `/student-contribution/ontology?${currentParams}`],
      [false, "월별 충성도 근거", `/student-contribution/ontology?${monthParams}`]].map(([isCurrent, label, href]) =>
      <Link key={String(isCurrent)} href={String(href)} prefetch={false} aria-current={current === isCurrent ? "page" : undefined}
        className={`rounded-lg border px-4 py-2 text-sm ${current === isCurrent ? "border-primary bg-primary-softer font-semibold text-primary" : "border-line hover:bg-secondary"}`}>{label}</Link>)}
  </nav>;
}
