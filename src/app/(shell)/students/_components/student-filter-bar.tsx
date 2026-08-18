"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { SearchableSelect } from "@/components/ui/searchable-select";

export type StudentFilterState = {
  status: string; // enrolled(디폴트) | all | consulted | on_hold | withdrawn — 무param=재원
  subject: string; // all | math | highmath | english | korean | science | arts
  grade: string; // all | 초1 … 고3
  teacher: string; // all | uuid
  field: string; // all | name | school | phone | address | email | memo
  sort: string; // grade | name | recent
  noenr: boolean; // 미수강 제외
  q: string;
};

type Teacher = { value: string; label: string };

// 디폴트(재원)를 맨 앞에 — "전체"는 명시적으로 골라야 나온다.
const STATUS_FILTERS = [
  { value: "enrolled", label: "재원" },
  { value: "all", label: "전체" },
  { value: "consulted", label: "예비·상담" },
  { value: "on_hold", label: "휴원" },
  { value: "withdrawn", label: "퇴원" },
];
// 과목·학년 옵션은 학원설정(operations.subjects/gradeLevels)에서 서버가 만들어 prop으로 주입 —
// 하드코딩 금지(설정에 없는 과목/학년 누출 + 설정 변경 미반영 방지).
const FIELD_FILTERS = [
  { value: "all", label: "전체 필드" },
  { value: "name", label: "이름" },
  { value: "school", label: "학교" },
  { value: "phone", label: "전화번호" },
  { value: "address", label: "주소" },
  { value: "email", label: "이메일" },
  { value: "memo", label: "메모" },
];
const SORT_FILTERS = [
  { value: "grade", label: "학년순" },
  { value: "name", label: "이름순" },
  { value: "recent", label: "등록일순" },
];

function buildHref(c: StudentFilterState, patch: Partial<StudentFilterState>): string {
  const n = { ...c, ...patch };
  const p = new URLSearchParams();
  // 디폴트(재원)만 생략 — "전체"는 status=all 명시(서버가 무param을 재원으로 해석).
  if (n.status !== "enrolled") p.set("status", n.status);
  if (n.subject !== "all") p.set("subject", n.subject);
  if (n.grade !== "all") p.set("grade", n.grade);
  if (n.teacher !== "all") p.set("teacher", n.teacher);
  if (n.field !== "all") p.set("field", n.field);
  if (n.sort !== "grade") p.set("sort", n.sort);
  if (n.noenr) p.set("noenr", "1");
  if (n.q) p.set("q", n.q);
  // 필터 변경은 page 미포함 → 항상 1페이지로 리셋
  const s = p.toString();
  return s ? `/students?${s}` : "/students";
}

const STORAGE_KEY = "eywa-students-filters";

function isDefault(c: StudentFilterState): boolean {
  return (
    c.status === "enrolled" &&
    c.subject === "all" &&
    c.grade === "all" &&
    c.teacher === "all" &&
    c.field === "all" &&
    c.sort === "grade" &&
    !c.noenr &&
    !c.q
  );
}

/**
 * 학생목록 필터바(클라이언트) — 수업목록 ClassFilterBar와 동일 패러다임. 상태·과목·학년·담임·검색필드·정렬을
 * 칩 나열이 아닌 드롭다운(SearchableSelect)으로, 미수강 제외 토글 + 검색을 한 줄에. 넓은 창=1줄, 좁은 창=2줄(flex-wrap).
 * 선택값(검색어 제외)은 localStorage에 저장해 다음 방문에 복원.
 */
export function StudentFilterBar({
  current,
  teachers,
  subjectFilters,
  gradeFilters,
}: {
  current: StudentFilterState;
  teachers: Teacher[];
  subjectFilters: { value: string; label: string }[];
  gradeFilters: { value: string; label: string }[];
}) {
  const router = useRouter();
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    try {
      if (!isDefault(current)) {
        localStorage.setItem(STORAGE_KEY, serialize(current));
        return;
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const restored = deserialize(raw);
      if (restored && !isDefault(restored)) router.replace(buildHref(restored, {}));
    } catch {
      /* localStorage 불가 — 무시 */
    }
  }, [current, router]);

  const go = (patch: Partial<StudentFilterState>) => {
    try {
      localStorage.setItem(STORAGE_KEY, serialize({ ...current, ...patch }));
    } catch {
      /* 무시 */
    }
    router.push(buildHref(current, patch));
  };

  return (
    <div className="bg-card border-line shadow-card rounded-2xl border px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <FilterGroup label="상태">
          <SearchableSelect
            className="w-28"
            value={current.status}
            onValueChange={(v) => go({ status: v })}
            options={STATUS_FILTERS}
            ariaLabel="상태 필터"
          />
        </FilterGroup>
        <FilterGroup label="과목">
          <SearchableSelect
            className="w-32"
            value={current.subject}
            onValueChange={(v) => go({ subject: v })}
            options={subjectFilters}
            ariaLabel="과목 필터"
          />
        </FilterGroup>
        <FilterGroup label="학년">
          <SearchableSelect
            className="w-24"
            value={current.grade}
            onValueChange={(v) => go({ grade: v })}
            options={gradeFilters}
            ariaLabel="학년 필터"
          />
        </FilterGroup>
        <FilterGroup label="담임">
          <SearchableSelect
            className="w-32"
            value={current.teacher}
            onValueChange={(v) => go({ teacher: v })}
            options={[{ value: "all", label: "전체" }, ...teachers]}
            ariaLabel="담임 필터"
          />
        </FilterGroup>

        {/* 우측: 검색필드·정렬·미수강·검색 (ml-auto로 함께 우측, 좁아지면 한 단위로 줄바꿈) */}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <FilterGroup label="검색 필드">
            <SearchableSelect
              className="w-28"
              value={current.field}
              onValueChange={(v) => go({ field: v })}
              options={FIELD_FILTERS}
              ariaLabel="검색 필드"
            />
          </FilterGroup>
          <FilterGroup label="정렬">
            <SearchableSelect
              className="w-28"
              value={current.sort}
              onValueChange={(v) => go({ sort: v })}
              options={SORT_FILTERS}
              ariaLabel="정렬 기준"
            />
          </FilterGroup>
          {/* 상태=퇴원에선 숨김 — 퇴원생은 활성 수강이 없어 이 토글이 켜져 있으면 전원이 걸러져
              "검색해도 항상 0명"이 된다(2026-08-18 실사고). 서버(getStudentsPage)도 같은 조건에서 무시. */}
          {current.status !== "withdrawn" ? (
            <button
              type="button"
              onClick={() => go({ noenr: !current.noenr })}
              aria-pressed={current.noenr}
              className={`shrink-0 rounded-full border px-2.5 py-2 text-xs transition ${
                current.noenr
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
              }`}
            >
              미수강 제외
            </button>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              go({ q: String(fd.get("q") ?? "").trim() });
            }}
            className="flex items-center gap-2"
          >
            <div className="border-line bg-bg-soft text-text-dim flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
              <EyIcon name="search" size={13} />
              <input
                type="search"
                name="q"
                defaultValue={current.q}
                placeholder="이름·학교·연락처"
                className="text-foreground placeholder:text-text-faint w-36 bg-transparent text-xs focus:outline-none"
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="micro mr-1 shrink-0">{label}</span>
      {children}
    </div>
  );
}

// ⚠️ status는 저장·복원 대상이 아님 — "필터 디폴트는 항상 재원"(열 때마다 재원 시작, URL로만 변경).
function serialize(c: StudentFilterState): string {
  return JSON.stringify({
    subject: c.subject,
    grade: c.grade,
    teacher: c.teacher,
    field: c.field,
    sort: c.sort,
    noenr: c.noenr,
  });
}

function deserialize(raw: string): StudentFilterState | null {
  try {
    const s = JSON.parse(raw) as Partial<StudentFilterState>;
    return {
      status: "enrolled", // 복원 대상 아님 — 항상 재원 디폴트
      subject: typeof s.subject === "string" ? s.subject : "all",
      grade: typeof s.grade === "string" ? s.grade : "all",
      teacher: typeof s.teacher === "string" ? s.teacher : "all",
      field: typeof s.field === "string" ? s.field : "all",
      sort: s.sort === "name" || s.sort === "recent" ? s.sort : "grade",
      noenr: s.noenr === true,
      q: "",
    };
  } catch {
    return null;
  }
}
