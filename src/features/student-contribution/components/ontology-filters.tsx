"use client";
import { useState } from "react";
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
  const apply = (next: StudentFilters) => {
    setDraft(next);
    const query = writeStudentFilters(new URLSearchParams(params.toString()), next);
    query.set("kind", scope.kind); query.set("entity", scope.id); query.delete("page");
    navigate(`/student-contribution/ontology?${query}`);
  };
  return <form aria-label="학생 조회 필터" aria-busy={pending} onSubmit={(event) => { event.preventDefault(); apply(draft); }}>
    <fieldset disabled={pending} className="flex min-w-0 flex-wrap items-center gap-3">
      <StudentFilterFields filters={draft} options={options} onChange={(patch) => {
        const next = { ...draft, ...patch };
        if (patch.search !== undefined) setDraft(next); else apply(next);
      }} onReset={() => apply({ ...DEFAULT_STUDENT_FILTERS })}>
        <Button type="submit" size="sm" variant="outline">{pending ? "조회 중…" : "검색"}</Button>
      </StudentFilterFields>
    </fieldset>
    <p className="mt-2 text-xs" role="status">{pending ? "선택한 조건으로 학생과 연결 기록을 조회하고 있습니다." : `${STUDENT_STATUS_LABELS[filters.status]} 기준 · 현재 재원 상태·학년, 과목은 수강 이력 기준 · 모든 관점에 같은 조건 적용`}</p>
  </form>;
}
