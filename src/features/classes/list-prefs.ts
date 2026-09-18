import type { ClassSort } from "./server/queries";
import { DAY_KEYS, parseClassKind, parseClassSort, parseClassView, type ClassKindFilter, type ViewMode } from "./list-filters";

/**
 * 수업목록 **보기 설정**(`users.ui_prefs.classes`) — 구분(정규/특강)·과목·담임·요일(다중)·정렬·보기(표/카드).
 *
 * 원장 2026-08-04 *"모든 뷰 세팅은 계정 귀속 — 당연하지만 항상"*: 종전 필터바(`class-filter-bar.tsx`)는 localStorage
 * `eywa-classes-filters`에 남겨 다른 PC·다른 포트에서 조용히 리셋됐다([[#90]]). 2026-09-03 열 머리 필터로 바꾸며 DB로
 * 옮겼다(학생목록 `ui_prefs.students`와 같은 규약).
 *
 * 🔴 **상태(status)와 검색어(q)는 저장하지 않는다** — 원장 2026-08-27 *"기본 세팅은 운영"*: 폐지 반을 한 번 본 사람이
 * 다음에 열 때도 폐지 반이 섞인 목록을 받으면 안 된다. URL로만 바꾼다.
 * 서버·클라 양쪽이 쓰는 순수 모듈 — `"use client"`도 `server-only`도 붙이지 말 것([[#61]]·[[#81]]).
 */
export type ClassListPrefs = {
  /** 구분(정규/특강, 2026-09-18) — 과목과 같은 결의 보기 필터라 계정에 남긴다. */
  kind: ClassKindFilter;
  subject: string;
  teacher: string;
  /** 요일 키(mon…sun) — 하나라도 운영하는 반. 빈 배열 = 전체. */
  days: string[];
  sort: ClassSort;
  view: ViewMode;
};

export const DEFAULT_CLASS_LIST_PREFS: ClassListPrefs = {
  kind: "all",
  subject: "all",
  teacher: "all",
  days: [],
  sort: "name",
  view: "table",
};

function str(raw: unknown, fallback: string): string {
  return typeof raw === "string" && raw.trim() ? raw : fallback;
}

/** 요일 — URL(`days=mon,wed` · `days=all`)과 저장값(배열) 둘 다 이 한 곳을 지난다. 모르는 키는 버린다. */
export function parseClassDays(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const keys = list
    .map((d) => (typeof d === "string" ? d.trim() : ""))
    .filter((d) => DAY_KEYS.has(d));
  // 요일순으로 정규화 — 같은 집합이 `mon,wed`·`wed,mon` 두 URL로 갈리지 않게(저장 비교도 이 순서).
  return [...DAY_KEYS].filter((k) => keys.includes(k));
}

/** 저장된 jsonb 조각 → 완전한 보기 설정(모르는 키·깨진 값은 기본값). 클라가 보낸 값도 이걸 한 번 태운다. */
export function parseClassListPrefs(raw: unknown): ClassListPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    kind: parseClassKind(o.kind),
    subject: str(o.subject, "all"),
    teacher: str(o.teacher, "all"),
    days: parseClassDays(o.days),
    sort: parseClassSort(o.sort),
    view: parseClassView(o.view),
  };
}

