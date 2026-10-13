import type { Face } from "@/components/face-tabs";

/** 직원 평가의 라우트 — 면은 `?tab=`으로 가른다(재고관리·수납관리와 같은 메커니즘). */
export const CLASS_REVIEW_PATH = "/class-review";

export const CLASS_REVIEW_TABS = ["review", "portfolio"] as const;
export type ClassReviewTab = (typeof CLASS_REVIEW_TABS)[number];

/**
 * 면 정의 **단일 소스** — 화면 안 FaceTabs가 이걸 그린다(원장 2026-10-13: *"내부탭을 2개로 분리해서
 * 직원 평가/직원 포트폴리오"*). 종전 화면이 '직원 평가', 강사별 월간 점수가 '직원 포트폴리오'다.
 *
 * 🔴 메뉴 판·사이드바 하부탭(`SUBTABS_BY_MENU`)엔 넣지 않는다 — 포트폴리오는 원장 역할만 보는 면이라,
 *    직원 평가를 여는 모든 사람에게 보이는 목적지로 올리면 눌러도 못 들어가는 줄이 된다(#77).
 */
const FACE_DEFS: ReadonlyArray<{ key: ClassReviewTab; label: string; href: string }> = [
  { key: "review", label: "직원 평가", href: CLASS_REVIEW_PATH },
  { key: "portfolio", label: "직원 포트폴리오", href: `${CLASS_REVIEW_PATH}?tab=portfolio` },
];

/**
 * 직원 포트폴리오를 볼 수 있는가 — 원장 역할(또는 운영 계정)이 **자기 눈으로** 볼 때만.
 *
 * 🔴 '다른 강사 뷰'는 대상의 역할을 빌린다. 원장을 대상으로 고르면 역할이 master로 보이므로,
 *    역할보다 먼저 `viewAs`를 막아야 한다(적대적 리뷰 2026-10-13: 강사뷰 권한만 있으면 원장을 골라
 *    전 강사 점수·매출을 읽을 수 있었다). 직원 평가 개인 예외로는 열리지 않는다.
 */
export function canSeePortfolio(viewer: { role: string; viewAs: boolean; selfOnly: boolean }, superAdmin: boolean): boolean {
  if (viewer.viewAs || viewer.selfOnly) return false;
  return viewer.role === "master" || superAdmin;
}

/** 이 사람이 열 수 있는 면만. 포트폴리오를 못 보면 면이 하나라 탭 줄 자체를 그리지 않는다. */
export function classReviewFaces(opts: { portfolio: boolean }): Face[] {
  return FACE_DEFS.filter((face) => face.key !== "portfolio" || opts.portfolio);
}

/** `?tab=` 값 → 면. 주소를 믿지 않는다 — 열 수 없는 면·모르는 값은 직원 평가로. */
export function resolveClassReviewTab(raw: unknown, opts: { portfolio: boolean }): ClassReviewTab {
  return raw === "portfolio" && opts.portfolio ? "portfolio" : "review";
}
