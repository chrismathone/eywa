"use client";

import { useEffect, useRef } from "react";
import { useSheetT } from "@/features/teacher-view/lang-context";
import type { SheetDictKey } from "@/features/teacher-view/i18n";
import { useRouter } from "next/navigation";
import { EyIcon } from "@/components/icons/eywa-icons";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  TOOLBAR_CHIP,
  TOOLBAR_CHIP_OFF,
  TOOLBAR_CHIP_ON,
  TOOLBAR_SEARCH_BOX,
  TOOLBAR_SELECT,
} from "@/components/toolbar-controls";

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

/** 사전 키가 붙은 선택지 → 화면 선택지. 값(enum)은 그대로, 라벨만 언어를 따른다. */
type KeyedOption = { value: string; key: SheetDictKey };

// 디폴트(재원)를 맨 앞에 — "전체"는 명시적으로 골라야 나온다.
// 🔴 라벨은 **사전 키**다 — 값(enum)은 URL 파라미터라 한 글자도 안 바뀐다.
const STATUS_FILTERS = [
  { value: "enrolled", key: "stu.filter.status.enrolled" },
  { value: "all", key: "stu.filter.all" },
  { value: "consulted", key: "stu.filter.status.consulted" },
  { value: "on_hold", key: "stu.filter.status.onHold" },
  { value: "withdrawn", key: "stu.filter.status.withdrawn" },
] as const;
// 과목·학년 옵션은 학원설정(operations.subjects/gradeLevels)에서 서버가 만들어 prop으로 주입 —
// 하드코딩 금지(설정에 없는 과목/학년 누출 + 설정 변경 미반영 방지).
const FIELD_FILTERS = [
  { value: "all", key: "stu.filter.field.all" },
  { value: "name", key: "stu.filter.field.name" },
  { value: "school", key: "stu.filter.field.school" },
  { value: "phone", key: "stu.filter.field.phone" },
  { value: "address", key: "stu.filter.field.address" },
  { value: "email", key: "stu.filter.field.email" },
  { value: "memo", key: "stu.filter.field.memo" },
] as const;
const SORT_FILTERS = [
  { value: "grade", key: "stu.filter.sort.grade" },
  { value: "name", key: "stu.filter.sort.name" },
  { value: "recent", key: "stu.filter.sort.recent" },
] as const;

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
  hideSubjectFilter = false,
  hideTeacherFilter = false,
}: {
  current: StudentFilterState;
  teachers: Teacher[];
  subjectFilters: { value: string; label: string }[];
  gradeFilters: { value: string; label: string }[];
  /** 강사 스코프에서 고를 과목이 1개뿐이면 서버가 켠다 — 선택지 하나인 드롭다운은 잡음(원장 2026-08-20). */
  hideSubjectFilter?: boolean;
  /** 강사 스코프에서 고를 담임이 나 하나뿐일 때(값이 안 걸려 있을 때만) 서버가 켠다. */
  hideTeacherFilter?: boolean;
}) {
  const t = useSheetT();
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
      if (!restored) return;
      // 과목 필터를 감춘 화면(강사 스코프)에선 옛 저장값이 선택지 밖일 수 있다 — 되돌릴 컨트롤이 없으니
      // 복원 단계에서 "전체"로 정리한다(서버도 같은 규칙으로 무시하므로 URL만 어긋나는 것을 막는다).
      if (hideSubjectFilter && !subjectFilters.some((f) => f.value === restored.subject)) {
        restored.subject = "all";
        localStorage.setItem(STORAGE_KEY, serialize(restored));
      }
      if (!isDefault(restored)) router.replace(buildHref(restored, {}));
    } catch {
      /* localStorage 불가 — 무시 */
    }
  }, [current, router, hideSubjectFilter, subjectFilters]);

  const go = (patch: Partial<StudentFilterState>) => {
    try {
      localStorage.setItem(STORAGE_KEY, serialize({ ...current, ...patch }));
    } catch {
      /* 무시 */
    }
    router.push(buildHref(current, patch));
  };

  // 선택지 라벨은 사전에서 — 값(enum)은 URL 파라미터라 그대로다.
  const opts = (list: readonly KeyedOption[]) =>
    list.map((o) => ({ value: o.value, label: t(o.key) }));

  return (
    // 🔴 툴바를 감싸던 카드 껍데기를 뺐다(원장 2026-09-01) — 아래 목록 카드가 자기 테두리를 갖고
    // 있어 선이 이중으로 겹쳐 보였다. 컨트롤 자체가 테두리를 가져 줄은 그대로 읽힌다.
    <div className="px-1 py-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
        <FilterGroup label={t("stu.filter.status")}>
          <SearchableSelect
            className="w-28"
            value={current.status}
            onValueChange={(v) => go({ status: v })}
            options={opts(STATUS_FILTERS)}
            ariaLabel={t("stu.filter.statusAria")}
            triggerClassName={TOOLBAR_SELECT}
          />
        </FilterGroup>
        {hideSubjectFilter ? null : (
          <FilterGroup label={t("stu.filter.subject")}>
            <SearchableSelect
              className="w-32"
              value={current.subject}
              onValueChange={(v) => go({ subject: v })}
              options={subjectFilters}
              ariaLabel={t("stu.filter.subjectAria")}
            triggerClassName={TOOLBAR_SELECT}
            />
          </FilterGroup>
        )}
        <FilterGroup label={t("stu.filter.grade")}>
          <SearchableSelect
            className="w-24"
            value={current.grade}
            onValueChange={(v) => go({ grade: v })}
            options={gradeFilters}
            ariaLabel={t("stu.filter.gradeAria")}
            triggerClassName={TOOLBAR_SELECT}
          />
        </FilterGroup>
        {hideTeacherFilter ? null : (
          <FilterGroup label={t("stu.filter.teacher")}>
            <SearchableSelect
              className="w-32"
              value={current.teacher}
              onValueChange={(v) => go({ teacher: v })}
              options={[{ value: "all", label: t("stu.filter.all") }, ...teachers]}
              ariaLabel={t("stu.filter.teacherAria")}
            triggerClassName={TOOLBAR_SELECT}
            />
          </FilterGroup>
        )}

        {/* 우측: 검색필드·정렬·미수강·검색 (ml-auto로 함께 우측, 좁아지면 한 단위로 줄바꿈) */}
        <div className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <FilterGroup label={t("stu.filter.field")}>
            <SearchableSelect
              className="w-28"
              value={current.field}
              onValueChange={(v) => go({ field: v })}
              options={opts(FIELD_FILTERS)}
              ariaLabel={t("stu.filter.field")}
              triggerClassName={TOOLBAR_SELECT}
            />
          </FilterGroup>
          <FilterGroup label={t("stu.filter.sort")}>
            <SearchableSelect
              className="w-28"
              value={current.sort}
              onValueChange={(v) => go({ sort: v })}
              options={opts(SORT_FILTERS)}
              ariaLabel={t("stu.filter.sortAria")}
              triggerClassName={TOOLBAR_SELECT}
            />
          </FilterGroup>
          {/* 상태=퇴원에선 숨김 — 퇴원생은 활성 수강이 없어 이 토글이 켜져 있으면 전원이 걸러져
              "검색해도 항상 0명"이 된다(2026-08-18 실사고). 서버(getStudentsPage)도 같은 조건에서 무시. */}
          {current.status !== "withdrawn" ? (
            <button
              type="button"
              onClick={() => go({ noenr: !current.noenr })}
              aria-pressed={current.noenr}
              className={`${TOOLBAR_CHIP} ${current.noenr ? TOOLBAR_CHIP_ON : TOOLBAR_CHIP_OFF}`}
            >
              {t("stu.filter.noEnrollment")}
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
            <div className={TOOLBAR_SEARCH_BOX}>
              <EyIcon name="search" size={13} />
              <input
                type="search"
                name="q"
                defaultValue={current.q}
                placeholder={t("stu.filter.searchPh")}
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
