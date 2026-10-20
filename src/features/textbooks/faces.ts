import type { Face } from "@/components/face-tabs";

/** 교재목록의 라우트 — 면은 `?tab=`으로 가른다(재고관리·수납관리와 같은 메커니즘). */
export const TEXTBOOKS_PATH = "/textbooks";

export const TEXTBOOK_TABS = ["books", "plans"] as const;
export type TextbookTab = (typeof TEXTBOOK_TABS)[number];

/**
 * 면 정의 **단일 소스** — 화면 안 FaceTabs가 이걸 그린다.
 *
 * 🔴 사이드바 하부탭(`SUBTABS_BY_MENU`)엔 **넣지 않는다** — 면이 둘뿐이고 둘 다 같은 화면의 다른 보기라
 *    사이드바에 줄을 두 개 더 세울 값이 없다(재고관리 선례). 폰엔 사이드바가 없어서 어차피 화면 안 탭바가
 *    유일한 길이다 — 그래서 여기가 정본이다.
 */
export const TEXTBOOK_FACE_DEFS: ReadonlyArray<{ key: TextbookTab; label: string; href: string }> = [
  { key: "books", label: "교재", href: TEXTBOOKS_PATH },
  { key: "plans", label: "반 배정", href: `${TEXTBOOKS_PATH}?tab=plans` },
];

export function isTextbookTab(v: unknown): v is TextbookTab {
  return typeof v === "string" && (TEXTBOOK_TABS as readonly string[]).includes(v);
}

/** `?tab=` 값 → 면. 모르는 값·없음은 교재(기본 착지). */
export function resolveTextbookTab(v: unknown): TextbookTab {
  return isTextbookTab(v) ? v : "books";
}

/**
 * 면 전환 탭. 건수를 **모르면 숫자를 안 붙인다** — 0을 적으면 "하나도 없다"는 거짓말이 된다
 * (조회 실패·0266a 미적용이 그 경우다).
 */
export function textbookFaces(counts?: Partial<Record<TextbookTab, number | null>>, subject?: TextbookSubject): Face[] {
  return TEXTBOOK_FACE_DEFS.map((f) => {
    const n = counts?.[f.key];
    // 과목을 고른 채 면을 옮겨도 과목이 유지되게 — 영어는 기본값이라 주소에 안 적는다.
    const href = subject === "math" ? `${f.href}${f.href.includes("?") ? "&" : "?"}subject=math` : f.href;
    return { key: f.key, label: typeof n === "number" ? `${f.label} ${n}` : f.label, href };
  });
}

/**
 * 교재목록이 다루는 과목 — 영어(ECS 배정)와 수학(반·학생 교재 배정, 원장 2026-10-19).
 * ⚠️ 라벨은 여기 적지 않는다 — 화면이 학원설정(`labelOf`)에서 읽는다.
 */
export const TEXTBOOK_SUBJECTS = ["english", "math"] as const;
export type TextbookSubject = (typeof TEXTBOOK_SUBJECTS)[number];

/** `?subject=` 값 → 과목. 모르는 값·없음은 영어(기존 착지 그대로). */
export function resolveTextbookSubject(v: unknown): TextbookSubject {
  return v === "math" ? "math" : "english";
}
