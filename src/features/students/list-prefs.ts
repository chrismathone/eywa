import type { SearchField, StudentSort } from "./server/queries";
import { joinMulti, parseMulti } from "./list-filter-values";

/**
 * 학생목록 **보기 설정**(`users.ui_prefs.students`) — 과목·학년·담임·검색 필드·정렬·미수강 제외.
 *
 * 원장 2026-08-04 *"모든 뷰 세팅은 계정 귀속 — 당연하지만 항상"*: 종전 필터바는 localStorage에 남겨 두어 다른 PC에서
 * 열면 사라지고, 같은 PC라도 포트가 다르면 리셋으로 위장했다([[#90]]). 2026-09-03 열 머리 필터로 바꾸며 DB로 옮겼다.
 *
 * 🔴 **상태(status)와 검색어(q)는 저장하지 않는다** — "필터 디폴트는 항상 재원"(열 때마다 재원에서 시작, URL로만 바꾼다).
 * 서버·클라 양쪽이 쓰는 순수 모듈 — `"use client"`도 `server-only`도 붙이지 말 것([[#61]]·[[#81]]).
 * `import type`뿐이라 서버 모듈(queries.ts)의 런타임은 딸려 오지 않는다.
 *
 * 과목·학년·담임은 **다중 선택**(원장 2026-09-28) — 저장 형식은 URL과 같은 쉼표 문자열(`math,english`, 없으면 `all`)이다.
 * 옛 저장값(`math` 한 값)은 그대로 원소 하나짜리 목록으로 읽힌다(호환). 배열로 저장된 값이 와도 같은 문자열로 접는다.
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

const SORTS: readonly StudentSort[] = ["grade", "grade_desc", "name", "name_desc"];
const FIELDS: readonly SearchField[] = ["all", "name", "school", "phone", "address", "email", "memo"];

/** 정렬 값 — 모르는 값은 기본(학년 오름차순). URL·저장값 둘 다 이 한 곳을 지난다. 없앤 등록일순(`recent`)도 여기서 학년으로 돌아간다. */
export function parseStudentSort(raw: unknown): StudentSort {
  return typeof raw === "string" && (SORTS as readonly string[]).includes(raw) ? (raw as StudentSort) : "grade";
}

/** 검색 필드 — 모르는 값은 전체. */
export function parseSearchField(raw: unknown): SearchField {
  return typeof raw === "string" && (FIELDS as readonly string[]).includes(raw) ? (raw as SearchField) : "all";
}

/** 다중 값 축(과목·학년·담임) — 쉼표 문자열·배열 어느 쪽이 와도 정규화한 쉼표 문자열(없으면 `all`). */
function multi(raw: unknown): string {
  return joinMulti(parseMulti(raw));
}

/** 저장된 jsonb 조각 → 완전한 보기 설정(모르는 키·깨진 값은 기본값). 클라가 보낸 값도 이걸 한 번 태운다. */
export function parseStudentListPrefs(raw: unknown): StudentListPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    subject: multi(o.subject),
    grade: multi(o.grade),
    teacher: multi(o.teacher),
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

/**
 * 운영실 KPI ↗가 **명시값**으로 적는 보기 설정 축 — `dashboard/overview/kpi-links.ts`의 STUDENT_AXES와 같은 목록(가드가 잠근다).
 * 이 축들을 URL에 박아야 카드와 같은 집합이 서지만, 그 값(전체)은 사용자가 고른 게 아니다.
 */
export const DASHBOARD_PREF_PARAMS = ["subject", "grade", "teacher", "noenr"] as const;

/**
 * `from=dashboard`로 들어온 화면에서 **필터 하나를 바꿀 때 함께 지울 파라미터** — 방문 표식(`from`)과, 바꾸지 않은
 * 운영실 명시 축. 지운 축은 다음 렌더에서 **저장값**으로 돌아가므로 RememberPrefs가 **사용자가 바꾼 축만** 저장한다
 * (운영실의 '전체'가 저장된 학년·과목 필터를 덮지 않는다). 운영실에서 온 화면이 아니면 아무것도 안 지운다(종전 동작 그대로).
 */
export function dashboardExitParams(fromDashboard: boolean, changed: string): string[] {
  if (!fromDashboard) return [];
  return ["from", ...DASHBOARD_PREF_PARAMS.filter((param) => param !== changed)];
}

/**
 * 지금 화면의 보기 설정(저장 비교용) — URL(명시값) → 저장값 → 기본값. 원생목록 화면과 테스트가 같은 계산을 쓴다.
 * 🔑 저장값과 **같은 파서**를 지난다(파서가 접는 값을 원문 그대로 두면 저장값과 영영 달라 렌더마다 저장한다).
 *    URL 값이 선택지 밖(옛 링크의 모르는 정렬·검색 범위)이면 보여 주기만 하고 저장값은 유지한다.
 */
export function studentListPrefsFromUrl(
  sp: Partial<Record<"subject" | "grade" | "teacher" | "field" | "sort" | "noenr", string>>,
  saved: StudentListPrefs,
): StudentListPrefs {
  const field = parseSearchField(sp.field ?? saved.field);
  const sort = parseStudentSort(sp.sort ?? saved.sort);
  return parseStudentListPrefs({
    subject: sp.subject ?? saved.subject,
    grade: sp.grade ?? saved.grade,
    teacher: sp.teacher ?? saved.teacher,
    field: sp.field === undefined || parseSearchField(sp.field) === sp.field ? field : saved.field,
    sort: sp.sort === undefined || parseStudentSort(sp.sort) === sp.sort ? sort : saved.sort,
    noenr: (sp.noenr ?? (saved.noenr ? "1" : "0")) === "1",
  });
}
