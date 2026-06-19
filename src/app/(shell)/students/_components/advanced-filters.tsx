"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { SlidersHorizontal, ChevronDown, RotateCcw, XCircle } from "lucide-react";
import { FilterSelect, type FilterSelectOption } from "@/components/filter-select";

// 학년 — 표준 학제(eywa students.grade 문자열과 동일 표기). 데이터에 없는 학년은 그냥 결과 0.
const GRADE_OPTIONS: FilterSelectOption[] = [
  ...["초1", "초2", "초3", "초4", "초5", "초6"],
  ...["중1", "중2", "중3"],
  ...["고1", "고2", "고3"],
].map((g) => ({ value: g, label: g }));

const FIELD_OPTIONS: FilterSelectOption[] = [
  { value: "name", label: "이름" },
  { value: "school", label: "학교" },
  { value: "phone", label: "전화번호" },
  { value: "address", label: "주소" },
  { value: "email", label: "이메일" },
  { value: "memo", label: "메모" },
];

const SORT_OPTIONS: FilterSelectOption[] = [
  { value: "name", label: "이름순" },
  { value: "recent", label: "등록일순" },
];

export type StudentTeacherOption = { value: string; label: string };

export function StudentAdvancedFilters({
  grade,
  teacherId,
  field,
  sort,
  excludeNoEnrollment,
  teachers,
}: {
  grade: string;
  teacherId: string;
  field: string;
  sort: string;
  excludeNoEnrollment: boolean;
  teachers: StudentTeacherOption[];
}) {
  const params = useSearchParams();
  const pathname = usePathname() ?? "/students";

  const activeCount =
    (grade !== "all" ? 1 : 0) +
    (teacherId !== "all" ? 1 : 0) +
    (field !== "all" ? 1 : 0) +
    (sort !== "grade" ? 1 : 0) +
    (excludeNoEnrollment ? 1 : 0);

  const [open, setOpen] = useState(activeCount > 0);

  // 현재 URL 파라미터 유지하며 일부만 교체(null=삭제). page는 항상 리셋.
  const hrefWith = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    p.delete("page");
    const s = p.toString();
    return `${pathname}${s ? `?${s}` : ""}`;
  };

  return (
    <div className="bg-card border-line shadow-card rounded-md border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="text-text-dim hover:text-foreground flex w-full items-center gap-2 px-4 py-2.5 text-xs transition"
      >
        <SlidersHorizontal size={13} />
        <span className="font-medium">고급 필터</span>
        {activeCount > 0 ? (
          <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none">
            {activeCount}
          </span>
        ) : null}
        <ChevronDown
          size={14}
          className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="border-line flex flex-wrap items-end gap-x-4 gap-y-3 border-t px-4 py-3">
          <Field label="학년">
            <FilterSelect
              paramName="grade"
              value={grade === "all" ? "" : grade}
              options={GRADE_OPTIONS}
              allLabel="전체"
              ariaLabel="학년 필터"
              className="w-28"
            />
          </Field>

          <Field label="담임">
            <FilterSelect
              paramName="teacher"
              value={teacherId === "all" ? "" : teacherId}
              options={teachers}
              allLabel="전체"
              ariaLabel="담임 필터"
              className="w-40"
            />
          </Field>

          <Field label="검색 필드">
            <FilterSelect
              paramName="field"
              value={field === "all" ? "" : field}
              options={FIELD_OPTIONS}
              allLabel="전체 필드"
              ariaLabel="검색 필드"
              className="w-32"
            />
          </Field>

          <Field label="정렬">
            <FilterSelect
              paramName="sort"
              value={sort === "grade" ? "" : sort}
              options={SORT_OPTIONS}
              allValue="grade"
              allLabel="학년순"
              ariaLabel="정렬"
              className="w-32"
            />
          </Field>

          <div className="flex flex-col gap-1">
            <span className="micro">수강</span>
            <Link
              href={hrefWith({ noenr: excludeNoEnrollment ? null : "1" })}
              className={`flex h-[38px] items-center gap-1.5 rounded-md border px-3 text-xs transition ${
                excludeNoEnrollment
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              <XCircle size={13} />
              미수강 제외
            </Link>
          </div>

          {activeCount > 0 ? (
            <div className="ml-auto flex flex-col gap-1">
              <span className="micro">&nbsp;</span>
              <Link
                href={hrefWith({ grade: null, teacher: null, field: null, sort: null, noenr: null })}
                className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft flex h-[38px] items-center gap-1.5 rounded-md border px-3 text-xs transition"
              >
                <RotateCcw size={13} />
                고급 초기화
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="micro">{label}</span>
      {children}
    </div>
  );
}
