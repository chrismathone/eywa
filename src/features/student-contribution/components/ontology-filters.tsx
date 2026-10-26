"use client";
import { useId, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DEFAULT_STUDENT_FILTERS, STUDENT_STATUS_LABELS, writeStudentFilters, type StudentFilters, type StudentFilterOptions } from "../model/student-filters";
import { StudentFilterFields } from "./student-filter-fields";
import { useOntologyNavigation } from "./ontology-navigation";

export function OntologyFilters({ filters, options, scope }: {
  filters: StudentFilters; options: StudentFilterOptions; scope: { kind: string; id: string };
}) {
  const [draft, setDraft] = useState(filters), { pending, navigate } = useOntologyNavigation();
  const params = useSearchParams();
  const [expanded, setExpanded] = useState(params.get("filters") === "open"), fieldsId = useId();
  const summary = [STUDENT_STATUS_LABELS[filters.status], filters.grade || "모든 학년",
    options.subjects.find((s) => s.key === filters.subject)?.label ?? (filters.subject ? "선택 과목" : "모든 수강 과목"),
    filters.search ? `검색: ${filters.search}` : null].filter(Boolean).join(" · ");
  const apply = (next: StudentFilters) => {
    setDraft(next);
    const query = writeStudentFilters(new URLSearchParams(params.toString()), next);
    if (expanded) query.set("filters", "open"); else query.delete("filters");
    query.set("kind", scope.kind); query.set("entity", scope.id); query.delete("page");
    navigate(`/student-contribution/ontology?${query}`);
  };
  return <form aria-label="학생 조회 필터" aria-busy={pending} onSubmit={(event) => { event.preventDefault(); apply(draft); }}>
    <div className="hidden items-center justify-between gap-2 phone:flex"><p className="min-w-0 break-words text-xs">{summary}</p><button type="button" aria-expanded={expanded} aria-controls={fieldsId} onClick={() => setExpanded(!expanded)} className="shrink-0 rounded-md border border-line px-2 py-1 text-xs">{expanded ? "필터 접기" : "필터 펼치기"}</button></div>
    <fieldset id={fieldsId} disabled={pending} className={`flex min-w-0 flex-wrap items-center gap-3 ${expanded ? "phone:mt-3" : "phone:hidden"}`}>
      <StudentFilterFields filters={draft} options={options} onChange={(patch) => {
        const next = { ...draft, ...patch };
        if (patch.search !== undefined) setDraft(next); else apply(next);
      }} onReset={() => apply({ ...DEFAULT_STUDENT_FILTERS })}>
        <Button type="submit" size="sm" variant="outline">{pending ? "조회 중…" : "검색"}</Button>
      </StudentFilterFields>
      <p className="w-full text-xs">이름·학교는 입력 후 검색하세요. 선택 조건은 바로 적용됩니다.</p>
    </fieldset>
    <p className="mt-2 text-xs" role="status">{pending ? "선택한 조건으로 학생과 연결 기록을 조회하고 있습니다." : "현재 재원 상태·학년 기준 · 과목은 수강 이력 기준 · 모든 관점에 적용"}</p>
  </form>;
}
