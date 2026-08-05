// 수업 평가 목록 보기 필터 — 원장 지시 2026-08-05: "모두 볼 수 있는 / 내가 평가해야 하는 / 선착순 등
// 여러 방식으로 정제해서 볼 수 있게". 선택값은 계정 귀속(users.ui_prefs.classReview.listFilter).
// ⚠️ 서버(초기값 읽기·저장 검증)와 클라(칩 UI)가 함께 쓰는 상수라 **일반 모듈**로 둔다
//    ("use client" 모듈의 상수를 서버가 import하면 런타임 undefined — gotcha #81).

export const CLASS_REVIEW_FILTERS = ["all", "todo", "done", "open"] as const;
export type ClassReviewFilter = (typeof CLASS_REVIEW_FILTERS)[number];

export const CLASS_REVIEW_FILTER_LABEL: Record<ClassReviewFilter, string> = {
  all: "전체",
  todo: "내가 평가할 것",
  done: "내가 평가함",
  open: "선착순",
};

export const DEFAULT_CLASS_REVIEW_FILTER: ClassReviewFilter = "all";

export function normalizeClassReviewFilter(v: unknown): ClassReviewFilter {
  return (CLASS_REVIEW_FILTERS as readonly unknown[]).includes(v)
    ? (v as ClassReviewFilter)
    : DEFAULT_CLASS_REVIEW_FILTER;
}
