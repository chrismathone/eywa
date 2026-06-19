"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { SearchableSelect } from "@/components/ui/searchable-select";

export type StudentFilterState = {
  status: string; // all | enrolled | consulted | on_hold | withdrawn
  subject: string; // all | math | highmath | english | korean | science | arts
  grade: string; // all | 초1 … 고3
  teacher: string; // all | uuid
  field: string; // all | name | school | phone | address | email | memo
  sort: string; // grade | name | recent
  noenr: boolean; // 미수강 제외
  q: string;
};

type Teacher = { value: string; label: string };

const STATUS_FILTERS = [
  { value: "all", label: "전체" },
  { value: "enrolled", label: "재원" },
  { value: "consulted", label: "예비·상담" },
  { value: "on_hold", label: "휴원" },
  { value: "withdrawn", label: "퇴원" },
];
const SUBJECT_FILTERS = [
  { value: "all", label: "전체" },
  { value: "math", label: "수학" },
  { value: "highmath", label: "수학(심화)" },
  { value: "english", label: "영어" },
  { value: "korean", label: "국어" },
  { value: "science", label: "과학" },
  { value: "arts", label: "예술" },
];
const GRADE_FILTERS = [
  { value: "all", label: "전체" },
  ...["초1", "초2", "초3", "초4", "초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"].map((g) => ({
    value: g,
    label: g,
  })),
];
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
  if (n.status !== "all") p.set("status", n.status);
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
    c.status === "all" &&
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
}: {
  current: StudentFilterState;
  teachers: Teacher[];
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
    <div className="bg-card border-line shadow-card rounded-md border px-4 py-3">
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
            options={SUBJECT_FILTERS}
            ariaLabel="과목 필터"
          />
        </FilterGroup>
        <FilterGroup label="학년">
          <SearchableSelect
            className="w-24"
            value={current.grade}
            onValueChange={(v) => go({ grade: v })}
            options={GRADE_FILTERS}
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
          <button
            type="button"
            onClick={() => go({ noenr: !current.noenr })}
            aria-pressed={current.noenr}
            className={`shrink-0 rounded-md border px-2.5 py-2 text-xs transition ${
              current.noenr
                ? "border-primary bg-primary text-primary-foreground font-medium"
                : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
            }`}
          >
            미수강 제외
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              go({ q: String(fd.get("q") ?? "").trim() });
            }}
            className="flex items-center gap-2"
          >
            <div className="border-line bg-bg-soft text-text-dim flex items-center gap-2 rounded-sm border px-2.5 py-1.5">
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

function serialize(c: StudentFilterState): string {
  return JSON.stringify({
    status: c.status,
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
      status: typeof s.status === "string" ? s.status : "all",
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
