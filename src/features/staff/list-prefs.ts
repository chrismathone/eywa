import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { EMPLOYMENT_TYPES } from "./resume";
import { STAFF_COLUMNS } from "./columns";

/**
 * 직원목록 **보기 설정**(`users.ui_prefs.staff`) — 역할·과목·계약구분·정렬·표시 수 + 볼 열(순서·숨김)·표 글자 크기.
 *
 * 원장 2026-08-04 *"모든 뷰 세팅은 계정 귀속 — 당연하지만 항상"*: 종전 열·글자 크기는 zustand persist(localStorage `eywa-prefs`)에만
 * 있었고 필터는 URL뿐이었다. 2026-09-04 디자인 v5 10단계에서 DB로 옮겼다. 열·글자 크기는 `StaffViewPrefsProvider`
 * (app/(shell)/staff/_components/staff-view-prefs.tsx)가 서버 시드를 useState 초기값으로 받아 **첫 렌더부터** 그린다 — zustand 스토어 없음.
 * 시간표 글씨 크기(`TimetableFontPrefSync`, 스토어 주입형)와는 구조가 **다르다**(persist는 SSR과 첫 클라 렌더를 가르고, 렌더마다 주입은
 * 뒤로 가기 캐시가 클릭을 되돌린다 — 적대적 리뷰 2026-09-04). 저장은 `staff-prefs-queue.ts` 단일 큐.
 *
 * 🔴 **상태(status)와 검색어(q)는 저장하지 않는다** — 일상 화면은 늘 재직에서 시작(원장 2026-08-07). URL로만 바꾼다.
 * 서버·클라 양쪽이 쓰는 순수 모듈 — `"use client"`도 `server-only`도 붙이지 말 것([[#61]]·[[#81]]).
 */
export type StaffRoleKey = "all" | "master" | "admin" | "manager" | "teacher" | "counselor" | "accountant";
export type StaffStatusKey = "all" | "active" | "inactive" | "pending";
export type StaffSortKey = "role" | "name" | "dept" | "emp" | "hire";

/** 역할 라벨은 `ROLE_LABEL` 단일 소스(role-hierarchy.ts) — 표의 역할 알약과 같은 글자여야 한다(옛 "상담" ≠ 알약 "상담사"). */
const STAFF_ROLE_KEYS = ["master", "admin", "manager", "teacher", "counselor", "accountant"] as const satisfies readonly Exclude<StaffRoleKey, "all">[];
export const STAFF_ROLE_OPTIONS: { value: StaffRoleKey; label: string }[] = STAFF_ROLE_KEYS.map((value) => ({ value, label: ROLE_LABEL[value] }));
/** 상태 — 기본값은 '재직'(FilterSelect의 allValue). '전체'는 `status=all`로만. */
export const STAFF_STATUS_DEFAULT: StaffStatusKey = "active";
export const STAFF_STATUS_OPTIONS: { value: StaffStatusKey; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "inactive", label: "퇴사" },
  { value: "pending", label: "대기" },
];
export const STAFF_SORT_OPTIONS: { value: StaffSortKey; label: string }[] = [
  { value: "role", label: "역할순" },
  { value: "name", label: "이름순" },
  { value: "dept", label: "부서순" },
  { value: "emp", label: "근무형태순" },
  { value: "hire", label: "입사일순" },
];
/** 한 쪽에 보일 직원 수(원장 2026-07-28: 기본 10, 창에서 10/30/50). */
export const STAFF_PER_OPTIONS = [10, 30, 50] as const;
export const STAFF_PER_DEFAULT = 10;

/** 표 글자 크기 허용 범위(%) — 기본 100 = 16px(v5 본문). 90은 14.4px로 xs 바닥(14) 위, 150은 열이 깨지기 직전. */
export const TABLE_SCALE_MIN = 90;
export const TABLE_SCALE_MAX = 150;
export const TABLE_SCALE_STEP = 10;

export type StaffListPrefs = {
  role: StaffRoleKey;
  /** "all" 또는 과목 key(학원설정) — 선택지 검증은 화면이 한다(설정 단일 소스). */
  subject: string;
  /** "all" 또는 근무형태(정규직/아르바이트/프리랜서). */
  emp: string;
  sort: StaffSortKey;
  per: number;
  /** 볼 열 순서(빈 배열 = 시트 기본 순서) · 숨긴 열 — columns.ts 주석(순서와 숨김을 따로 두는 이유). */
  columnOrder: string[];
  columnHidden: string[];
  tableScale: number;
  /**
   * 저장 세대(저장할 때마다 +1, 서버만 올린다). 뒤로 가기가 되살린 옛 페이로드와 "다른 창·PC가 그 사이 바꾼" 새 페이로드를 가르는
   * 유일한 단서 — 내용만 보면 둘을 구분할 수 없다(`seedStaffView`).
   */
  rev: number;
};

export const DEFAULT_STAFF_LIST_PREFS: StaffListPrefs = {
  role: "all",
  subject: "all",
  emp: "all",
  sort: "role",
  per: STAFF_PER_DEFAULT,
  columnOrder: [],
  columnHidden: [],
  tableScale: 100,
  rev: 0,
};

/**
 * 저장 주체가 둘이라 조각도 둘이다(적대적 리뷰 2026-09-04) —
 * · **필터 5축**(`StaffFilterPrefs`) = URL이 진실, 서버 렌더 뒤 `RememberPrefs`가 차이 나면 저장.
 * · **표 보기 3키**(`StaffViewPrefs`) = 클릭 자리(−/+·열 고르기)가 진실, `StaffViewPrefsProvider`가 즉시 반영 + 저장.
 * 🔴 RememberPrefs에 `StaffListPrefs` 전체를 넘기지 말 것 — 서버 렌더 시점의 열·글자 사본이 방금 클릭한 값을 되돌려 쓴다
 *    (뒤로 가기 캐시·클릭 직후 필터 전환에서 실제로 난다). 두 조각은 키가 겹치지 않아 서버의 필드 단위 머지가 보호막이 된다.
 */
export type StaffFilterPrefs = Pick<StaffListPrefs, "role" | "subject" | "emp" | "sort" | "per">;
export type StaffViewPrefs = Pick<StaffListPrefs, "columnOrder" | "columnHidden" | "tableScale" | "rev">;

/** 필터 조각 — 키 순서를 여기서 고정한다(RememberPrefs가 JSON 문자열로 같음을 판정한다). */
export function pickStaffFilterPrefs(p: StaffListPrefs): StaffFilterPrefs {
  return { role: p.role, subject: p.subject, emp: p.emp, sort: p.sort, per: p.per };
}
export function pickStaffViewPrefs(p: StaffListPrefs): StaffViewPrefs {
  return { columnOrder: p.columnOrder, columnHidden: p.columnHidden, tableScale: p.tableScale, rev: p.rev };
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/**
 * 표 보기 저장 = **이 창이 바꾼 차이**만 저장값 위에 얹는다(적대적 리뷰 2026-09-04). 창(iframe)·탭·PC마다 Provider 상태가 따로라
 * 통째 배열을 보내면 다른 창이 그 사이 숨긴 열을 되살린다 — 시간이 겹치지 않아도 난다(큐가 못 막는 종류).
 * `base` = 그 창이 "저장돼 있다고 믿는" 값(직전 저장 결과 또는 서버 시드). `stored` = 지금 DB 값.
 * · 숨김 열: (stored ∪ (next − base)) − (base − next) — 이 창이 새로 숨긴 것은 더하고 새로 켠 것은 빼고, 나머지는 DB 그대로.
 * · 순서: 이 창이 안 건드렸으면(next = base) DB 값 유지, 건드렸으면 이 창 순서(순서는 부분 병합이 뜻이 없다).
 * · 글자 크기: 마지막 저장이 이긴다.
 * 돌려주는 값은 stored 위에 얹을 **패치**(없는 키는 손대지 않는다). rev는 서버가 올린다.
 */
export function mergeStaffView(stored: StaffViewPrefs, base: StaffViewPrefs, next: Partial<StaffViewPrefs>): Partial<StaffViewPrefs> {
  const patch: Partial<StaffViewPrefs> = {};
  if (next.columnHidden) {
    const baseHidden = new Set(base.columnHidden);
    const nextHidden = new Set(next.columnHidden);
    const added = next.columnHidden.filter((k) => !baseHidden.has(k));
    const removed = new Set(base.columnHidden.filter((k) => !nextHidden.has(k)));
    const kept = stored.columnHidden.filter((k) => !removed.has(k));
    patch.columnHidden = [...kept, ...added.filter((k) => !kept.includes(k))];
  }
  if (next.columnOrder && !sameList(next.columnOrder, base.columnOrder)) patch.columnOrder = next.columnOrder;
  if (next.tableScale !== undefined) patch.tableScale = next.tableScale;
  return patch;
}

export function parseStaffRole(raw: unknown): StaffRoleKey {
  return raw === "all" || STAFF_ROLE_OPTIONS.some((o) => o.value === raw) ? (raw as StaffRoleKey) : "all";
}
export function parseStaffStatus(raw: unknown): StaffStatusKey {
  return raw === STAFF_STATUS_DEFAULT || STAFF_STATUS_OPTIONS.some((o) => o.value === raw)
    ? (raw as StaffStatusKey)
    : STAFF_STATUS_DEFAULT;
}
export function parseStaffSort(raw: unknown): StaffSortKey {
  return STAFF_SORT_OPTIONS.some((o) => o.value === raw) ? (raw as StaffSortKey) : "role";
}
export function parseStaffEmp(raw: unknown): string {
  return typeof raw === "string" && (EMPLOYMENT_TYPES as readonly string[]).includes(raw) ? raw : "all";
}
export function parseStaffPer(raw: unknown): number {
  const n = Number(raw);
  return (STAFF_PER_OPTIONS as readonly number[]).includes(n) ? n : STAFF_PER_DEFAULT;
}
/** 글자 크기 — 범위 안으로, 10 단위로 접는다. */
export function clampTableScale(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 100;
  return Math.min(TABLE_SCALE_MAX, Math.max(TABLE_SCALE_MIN, Math.round(n / TABLE_SCALE_STEP) * TABLE_SCALE_STEP));
}
function strList(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : [];
}
function str(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw.trim() ? raw : fallback;
}

/** 저장된 jsonb 조각 → 완전한 보기 설정(모르는 키·깨진 값은 기본값). 클라가 보낸 값도 이걸 한 번 태운다. */
export function parseStaffListPrefs(raw: unknown): StaffListPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const known = new Set<string>(STAFF_COLUMNS.map((c) => c.key));
  return {
    role: parseStaffRole(o.role),
    subject: str(o.subject, "all"),
    emp: parseStaffEmp(o.emp),
    sort: parseStaffSort(o.sort),
    per: parseStaffPer(o.per),
    // 모르는 키(지운 열)만 버린다 — 빠진 새 열은 그릴 때 normalizeOrder가 뒤에 붙인다(columns.ts 주석).
    columnOrder: strList(o.columnOrder).filter((k) => known.has(k)),
    columnHidden: strList(o.columnHidden).filter((k) => known.has(k)),
    tableScale: clampTableScale(o.tableScale ?? 100),
    rev: Number.isFinite(Number(o.rev)) ? Math.max(0, Math.floor(Number(o.rev))) : 0,
  };
}
