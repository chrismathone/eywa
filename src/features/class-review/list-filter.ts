// 수업 평가 목록 보기 필터 — 원장 지시 2026-08-05: "모두 볼 수 있는 / 내가 평가해야 하는 / 선착순 등
// 여러 방식으로 정제해서 볼 수 있게". 선택값은 계정 귀속(users.ui_prefs.classReview.listFilter).
// ⚠️ 서버(초기값 읽기·저장 검증)와 클라(칩 UI)가 함께 쓰는 상수라 **일반 모듈**로 둔다
//    ("use client" 모듈의 상수를 서버가 import하면 런타임 undefined — gotcha #81).

// 구성은 평가지(건) 기준(원장 2026-08-05 확정): "완료된 평가지 / 끝나지 않은 평가지 / 내가 평가해야
// 하는 평가지". '내 평가 완료(내가 채점 마친 것)' 보기는 필요 없다고 해서 제거 — 키 "done"은 재사용
// 금지(저장된 옛 값은 normalize가 '전체'로 흡수).
export const CLASS_REVIEW_FILTERS = ["all", "todo", "complete", "incomplete", "open"] as const;
export type ClassReviewFilter = (typeof CLASS_REVIEW_FILTERS)[number];

export const CLASS_REVIEW_FILTER_LABEL: Record<ClassReviewFilter, string> = {
  all: "전체",
  todo: "내 평가 대기",
  complete: "완료",
  incomplete: "미완료",
  open: "선착순",
};

export const DEFAULT_CLASS_REVIEW_FILTER: ClassReviewFilter = "all";

export function normalizeClassReviewFilter(v: unknown): ClassReviewFilter {
  return (CLASS_REVIEW_FILTERS as readonly unknown[]).includes(v)
    ? (v as ClassReviewFilter)
    : DEFAULT_CLASS_REVIEW_FILTER;
}
