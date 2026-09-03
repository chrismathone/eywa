import type { SearchField, StudentSort } from "./server/queries";

/**
 * 학생목록 **보기 설정**(`users.ui_prefs.students`) — 과목·학년·담임·검색 필드·정렬·미수강 제외.
 *
 * 원장 2026-08-04 *"모든 뷰 세팅은 계정 귀속 — 당연하지만 항상"*: 종전 필터바는 localStorage에 남겨 두어 다른 PC에서
 * 열면 사라지고, 같은 PC라도 포트가 다르면 리셋으로 위장했다([[#90]]). 2026-09-03 열 머리 필터로 바꾸며 DB로 옮겼다.
 *
 * 🔴 **상태(status)와 검색어(q)는 저장하지 않는다** — "필터 디폴트는 항상 재원"(열 때마다 재원에서 시작, URL로만 바꾼다).
 * 서버·클라 양쪽이 쓰는 순수 모듈 — `"use client"`도 `server-only`도 붙이지 말 것([[#61]]·[[#81]]).
 * `import type`뿐이라 서버 모듈(queries.ts)의 런타임은 딸려 오지 않는다.
 */
export type StudentListPrefs = {
  subject: string;
  grade: string;
  teacher: string;
  field: SearchField;
  sort: StudentSort;
  noenr: boolean;
};

export const DEFAULT_STUDENT_LIST_PREFS: StudentListPrefs = {
  subject: "all",
  grade: "all",
  teacher: "all",
  field: "all",
  sort: "grade",
  noenr: false,
};

const SORTS: readonly StudentSort[] = ["grade", "name", "recent"];
const FIELDS: readonly SearchField[] = ["all", "name", "school", "phone", "address", "email", "memo"];

/** 정렬 값 — 모르는 값은 기본(학년순). URL·저장값 둘 다 이 한 곳을 지난다. */
export function parseStudentSort(raw: unknown): StudentSort {
  return typeof raw === "string" && (SORTS as readonly string[]).includes(raw) ? (raw as StudentSort) : "grade";
}

/** 검색 필드 — 모르는 값은 전체. */
export function parseSearchField(raw: unknown): SearchField {
  return typeof raw === "string" && (FIELDS as readonly string[]).includes(raw) ? (raw as SearchField) : "all";
}

function str(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw.trim() ? raw : fallback;
}

/** 저장된 jsonb 조각 → 완전한 보기 설정(모르는 키·깨진 값은 기본값). 클라가 보낸 값도 이걸 한 번 태운다. */
export function parseStudentListPrefs(raw: unknown): StudentListPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    subject: str(o.subject, "all"),
    grade: str(o.grade, "all"),
    teacher: str(o.teacher, "all"),
    field: parseSearchField(o.field),
    sort: parseStudentSort(o.sort),
    noenr: o.noenr === true,
  };
}

export function sameStudentListPrefs(a: StudentListPrefs, b: StudentListPrefs): boolean {
  return (
    a.subject === b.subject &&
    a.grade === b.grade &&
    a.teacher === b.teacher &&
    a.field === b.field &&
    a.sort === b.sort &&
    a.noenr === b.noenr
  );
}
