// 수업 평가 목록 보기 필터 — 원장 지시 2026-08-05: "모두 볼 수 있는 / 내가 평가해야 하는 / 선착순 등
// 여러 방식으로 정제해서 볼 수 있게". 선택값은 계정 귀속(users.ui_prefs.classReview.listFilter).
// ⚠️ 서버(초기값 읽기·저장 검증)와 클라(칩 UI)가 함께 쓰는 상수라 **일반 모듈**로 둔다
//    ("use client" 모듈의 상수를 서버가 import하면 런타임 undefined — gotcha #81).

export const CLASS_REVIEW_FILTERS = ["all", "todo", "done", "incomplete", "open"] as const;
export type ClassReviewFilter = (typeof CLASS_REVIEW_FILTERS)[number];

// 라벨은 인사평가 표준 어휘 "평가 대기/평가 완료"(원장 2026-08-05 — "내가 평가할 것/함"이 어색하다) +
// 문서 전체 상태(제출 N/M)와 혼동되지 않게 '내'를 붙인다. 키(todo/done)는 저장값이라 불변.
// incomplete = 건 단위 미완료(제출이 다 안 모인 참관, 원장 2026-08-05 "정렬에 미완료도 있어야겠다").
export const CLASS_REVIEW_FILTER_LABEL: Record<ClassReviewFilter, string> = {
  all: "전체",
  todo: "내 평가 대기",
  done: "내 평가 완료",
  incomplete: "미완료",
  open: "선착순",
};

export const DEFAULT_CLASS_REVIEW_FILTER: ClassReviewFilter = "all";

export function normalizeClassReviewFilter(v: unknown): ClassReviewFilter {
  return (CLASS_REVIEW_FILTERS as readonly unknown[]).includes(v)
    ? (v as ClassReviewFilter)
    : DEFAULT_CLASS_REVIEW_FILTER;
}
