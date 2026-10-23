"use client";
import type { ReactNode } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { STUDENT_STATUS_LABELS, type StudentFilters, type StudentFilterOptions } from "../model/student-filters";
import { fieldClass } from "./presentation";

export function StudentFilterFields({ filters, options, onChange, onReset, children }: {
  filters: StudentFilters; options: StudentFilterOptions; onChange: (patch: Partial<StudentFilters>) => void;
  onReset: () => void; children?: ReactNode;
}) {
  return <>
    <label className="relative min-w-48 flex-1"><span className="pointer-events-none absolute inset-y-0 left-3 flex items-center"><EyIcon name="search" size={16} /></span>
      <input aria-label="학생 이름·학교 검색" placeholder="이름 또는 학교로 찾기" maxLength={100} value={filters.search}
        onChange={(e) => onChange({ search: e.target.value })} className={`${fieldClass} w-full pl-9`} /></label>
    <select aria-label="재원 상태" value={filters.status} onChange={(e) => onChange({ status: e.target.value as StudentFilters["status"] })} className={fieldClass}>
      {Object.entries(STUDENT_STATUS_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
    <select aria-label="학년" value={filters.grade} onChange={(e) => onChange({ grade: e.target.value })} className={fieldClass}>
      <option value="">모든 학년</option>{[...new Set([...options.grades, ...(filters.grade ? [filters.grade] : [])])].map((g) => <option key={g} value={g}>{g}</option>)}</select>
    <select aria-label="과목" value={filters.subject} onChange={(e) => onChange({ subject: e.target.value })} className={fieldClass}>
      <option value="">모든 수강 과목</option>{options.subjects.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
      {filters.subject && !options.subjects.some((s) => s.key === filters.subject) && <option value={filters.subject}>등록되지 않은 과목</option>}</select>
    {children}
    <Button type="button" variant="ghost" size="sm" onClick={onReset}>초기화</Button>
  </>;
}
