"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "@/components/icons/eywa-icon-compat";
import { EyIcon } from "@/components/icons/eywa-icons";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  DAY_FILTERS,
  DAY_KEYS,
  SORT_OPTIONS,
  teacherTeaches,
  buildClassHref,
  type ClassFilterState,
} from "./filter-shared";
import type { ClassSort } from "@/features/classes/server/queries";

type Teacher = { id: string; name: string; subjects: string[] };

const STORAGE_KEY = "eywa-classes-filters";

type Saved = {
  subject?: string;
  teacher?: string;
  days?: string[];
  sort?: ClassSort;
  view?: "cards" | "table";
};

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function saveCurrent(c: ClassFilterState): void {
  try {
    // 검색어(q)는 일시적이라 저장하지 않음 — 필터/뷰 설정만 다음 방문에 이어진다.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ subject: c.subject, teacher: c.teacher, days: c.days, sort: c.sort, view: c.view }),
    );
  } catch {
    /* 저장 불가(프라이빗 모드 등) — 무시 */
  }
}

// 저장값 → 완전한 필터 상태(검색어 제외). 알 수 없는 값은 기본값으로 안전화.
function savedToState(s: Saved): ClassFilterState {
  return {
    subject: typeof s.subject === "string" ? s.subject : "all",
    teacher: typeof s.teacher === "string" ? s.teacher : "all",
    days: Array.isArray(s.days) ? s.days.filter((d) => DAY_KEYS.has(d)) : [],
    q: "",
    view: s.view === "cards" ? "cards" : "table",
    sort: s.sort === "students" || s.sort === "teacher" ? s.sort : "name",
  };
}

function isDefault(c: ClassFilterState): boolean {
  return (
    c.subject === "all" &&
    c.teacher === "all" &&
    c.days.length === 0 &&
    c.sort === "name" &&
    c.view === "table" &&
    !c.q
  );
}

const triggerCls =
  "border-border bg-card text-foreground flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm";

// 요일 칩(팝오버 내부). 활성 = ink 솔리드. Editorial 문법 ⑦ — 알약(rounded-full).
const chipCls = (active: boolean) =>
  `shrink-0 rounded-full border px-2.5 py-0.5 text-xs transition ${
    active
      ? "border-primary bg-primary text-primary-foreground font-medium"
      : "border-line text-text-dim hover:text-foreground hover:bg-bg-soft"
  }`;

// 뷰 토글. 활성 = primary. 알약(rounded-full).
const viewCls = (active: boolean) =>
  `shrink-0 rounded-full border px-2.5 py-1 text-xs transition ${
    active
      ? "border-primary bg-primary text-primary-foreground font-medium"
      : "border-line text-text-dim hover:bg-bg-soft"
  }`;

/** 요일 다중선택 드롭다운 — 트리거는 요약 라벨, 팝오버에서 토글. */
function DayMultiSelect({ days, onGo }: { days: string[]; onGo: (patch: Partial<ClassFilterState>) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const summary =
    days.length === 0
      ? "전체"
      : DAY_FILTERS.filter((d) => days.includes(d.key))
          .map((d) => d.label)
          .join("·");
  const toggle = (key: string) =>
    onGo({ days: days.includes(key) ? days.filter((d) => d !== key) : [...days, key] });

  return (
    <div ref={ref} className="relative w-28">
      <button type="button" aria-label="요일 필터" onClick={() => setOpen((o) => !o)} className={triggerCls}>
        <span className="truncate">{summary}</span>
        <ChevronDown className="size-4 shrink-0 opacity-50" />
      </button>
      {open ? (
        <div className="border-border bg-card absolute z-50 mt-1 w-44 rounded-md border p-2 shadow-lg">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => onGo({ days: [] })} className={chipCls(days.length === 0)}>
              전체
            </button>
            {DAY_FILTERS.map((f) => (
              <button key={f.key} type="button" onClick={() => toggle(f.key)} className={chipCls(days.includes(f.key))}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 수업목록 필터바(클라이언트). 과목·요일·강사·정렬을 드롭다운으로(나열 X), 선택값을 localStorage에 저장해
 * 다음 방문에 복원. 좌측=과목/요일, 우측(ml-auto)=강사·정렬·검색·뷰(한 단위로 줄바꿈 → 넓은창 1줄/좁은창 2줄).
 */
export function ClassFilterBar({
  current,
  teachers,
  subjectFilters,
  hideTeacherFilter = false,
}: {
  current: ClassFilterState;
  teachers: Teacher[];
  subjectFilters: { value: string; label: string }[];
  /**
   * 강사 스코프(내 수업)면 서버가 켠다 — `getClassesPage`가 teacher_id를 본인으로 **강제**하므로
   * 남을 골라도 결과는 항상 0개다(원장 2026-08-20 "강사가 당연히 나일텐데 다른 강사 선택도 보임").
   * 본인만 담은 드롭다운을 남기는 것도 같은 이유로 무의미해서 통째로 감춘다.
   */
  hideTeacherFilter?: boolean;
}) {
  const router = useRouter();
  const didInit = useRef(false);

  // 최초 마운트만: URL에 필터가 없으면 저장값 복원, 있으면 그 값을 저장(직접 링크도 다음에 이어지게).
  // didInit 가드로 StrictMode 이중 실행·재렌더에도 1회만 동작(복원 후 무한 replace 방지).
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (!isDefault(current)) {
      saveCurrent(current);
      return;
    }
    const saved = loadSaved();
    if (!saved) return;
    const restored = savedToState(saved);
    if (isDefault(restored)) return;
    router.replace(buildClassHref(restored, {}));
  }, [current, router]);

  // 모든 필터 변경은 go를 거치므로 여기서 저장 — effect 순서/이중실행에 휘둘리지 않고 변경값만 정확히 영속.
  const go = (patch: Partial<ClassFilterState>) => {
    saveCurrent({ ...current, ...patch });
    router.push(buildClassHref(current, patch));
  };

  // 과목 변경 — 선택 강사가 새 과목 비담당이면 강사 초기화.
  const onSubject = (key: string) => {
    const selected = current.teacher === "all" ? null : teachers.find((t) => t.id === current.teacher);
    const resetTeacher = key !== "all" && selected && !teacherTeaches(selected.subjects, key);
    go({ subject: key, ...(resetTeacher ? { teacher: "all" } : {}) });
  };

  // 강사 옵션 — 현재 과목 담당만(전체면 전부). 선택 강사가 목록 밖이면(직접 URL) 앞에 보강해 라벨 유지.
  const visibleTeachers =
    current.subject === "all" ? teachers : teachers.filter((t) => teacherTeaches(t.subjects, current.subject));
  const selected = current.teacher === "all" ? null : teachers.find((t) => t.id === current.teacher);
  const teacherOpts = visibleTeachers.map((t) => ({ value: t.id, label: t.name }));
  if (selected && !visibleTeachers.some((t) => t.id === selected.id)) {
    teacherOpts.unshift({ value: selected.id, label: selected.name });
  }

  return (
    <div className="bg-card border-line shadow-card rounded-2xl border px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        {/* 과목 */}
        <div className="flex items-center gap-1.5">
          <span className="micro mr-1">과목</span>
          <SearchableSelect
            className="w-32"
            value={current.subject}
            onValueChange={onSubject}
            options={subjectFilters}
            ariaLabel="과목 필터"
          />
        </div>

        {/* 요일 (다중) */}
        <div className="flex items-center gap-1.5">
          <span className="micro mr-1">요일</span>
          <DayMultiSelect days={current.days} onGo={go} />
        </div>

        {/* 우측: 강사·정렬·검색·뷰 (ml-auto로 함께 우측, 좁아지면 한 단위로 줄바꿈) */}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          {hideTeacherFilter ? null : (
            <div className="flex items-center gap-1.5">
              <span className="micro mr-1">강사</span>
              <SearchableSelect
                className="w-36"
                value={current.teacher}
                onValueChange={(v) => go({ teacher: v })}
                options={[{ value: "all", label: "전체" }, ...teacherOpts]}
                ariaLabel="강사 필터"
              />
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <span className="micro mr-1">정렬</span>
            <SearchableSelect
              className="w-28"
              value={current.sort}
              onValueChange={(v) => go({ sort: v as ClassSort })}
              // '강사명순'도 같은 축이라 스코프에선 뺀다(전 행이 같은 담임 = 수업명순과 동일한 결과).
              // ⚠️ 이미 그 값이 걸려 있으면 남긴다 — 지우면 드롭다운이 빈 값으로 굳는다.
              options={
                hideTeacherFilter && current.sort !== "teacher"
                  ? SORT_OPTIONS.filter((o) => o.value !== "teacher")
                  : SORT_OPTIONS
              }
              ariaLabel="정렬 기준"
            />
          </div>

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
                placeholder="수업명, 강사, 강의실 검색"
                title="수업명 · 강사명 · 강의실명으로 찾습니다(예: 본원602)"
                className="text-foreground placeholder:text-text-faint w-44 bg-transparent text-xs focus:outline-none"
              />
            </div>
          </form>

          <div className="flex items-center gap-1">
            <button type="button" onClick={() => go({ view: "table" })} className={viewCls(current.view === "table")}>
              테이블
            </button>
            <button type="button" onClick={() => go({ view: "cards" })} className={viewCls(current.view === "cards")}>
              카드
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
