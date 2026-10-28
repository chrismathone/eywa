/**
 * 비포클래스체크리스트(초안) — 항목·카드·판정의 **단일 소스**(순수 · Vitest).
 *
 * 원본 = 구글 시트 '강의하는 아이들 출석부'(원장 2026-10-28). 시트는 학생 × 수업일마다 미흡 10항목을 체크하고
 * (체크 = 미흡), 결석 체크와 카드(블루·골드·레드·옐로우·카드 X)를 고른다. 완료율 = 체크 안 된 항목 ÷ 10,
 * 미흡이 3개 이상이면 '보충 필요'(시트의 주황), 2개 이하면 파랑.
 * 🔴 항목 키는 DB(`before_class_checks.missed`)에 저장된다 — 키를 바꾸지 말 것(라벨만 바꾼다). 새 항목은 끝에 더한다.
 * ⚠️ 나중에 수업보고서에 실을 수 있다(원장) — 그때도 판정은 여기 함수를 쓴다.
 */

export const BEFORE_CLASS_ITEMS = [
  { key: "preview_video", label: "예습 영상 촬영 미흡", short: "예습 영상" },
  { key: "concept_note", label: "개념 노트 정리 미흡", short: "개념 노트" },
  { key: "solution_note", label: "풀이 노트 작성 미흡", short: "풀이 노트" },
  { key: "print_homework", label: "프린트 과제 미흡", short: "프린트 과제" },
  { key: "main_solve", label: "본교재 문제풀이 미흡", short: "본교재 풀이" },
  { key: "main_review", label: "본교재 오답정리 미흡", short: "본교재 오답" },
  { key: "sub_solve", label: "부교재 문제풀이 미흡", short: "부교재 풀이" },
  { key: "sub_review", label: "부교재 오답정리 미흡", short: "부교재 오답" },
  { key: "materials", label: "교재 / 패드 미지참", short: "교재·패드" },
  { key: "deadline", label: "제출 시간 미준수", short: "제출 시간" },
] as const;

export type BeforeClassItemKey = (typeof BEFORE_CLASS_ITEMS)[number]["key"];
const ITEM_KEYS = new Set<string>(BEFORE_CLASS_ITEMS.map((i) => i.key));

export const BEFORE_CLASS_CARDS = [
  { key: "blue", label: "블루카드" },
  { key: "gold", label: "골드카드" },
  { key: "red", label: "레드카드" },
  { key: "yellow", label: "옐로우카드" },
  { key: "none", label: "카드 X" },
] as const;

export type BeforeClassCard = (typeof BEFORE_CLASS_CARDS)[number]["key"];
const CARD_KEYS = new Set<string>(BEFORE_CLASS_CARDS.map((c) => c.key));

/** 보충 필요 기준 — 미흡 항목이 이 수 이상(시트 조건부 서식 `COUNTIF(..., TRUE)>=3`). */
export const SUPPLEMENT_THRESHOLD = 3;

export type BeforeClassCheck = { missed: string[]; absent: boolean; card: BeforeClassCard | null };

/** 저장된 배열에서 아는 항목만 남긴다(순서 = 항목 표 차례, 중복 제거). 모르는 키는 버린다. */
export function normalizeMissed(raw: readonly unknown[] | null | undefined): BeforeClassItemKey[] {
  const set = new Set((raw ?? []).filter((k): k is string => typeof k === "string" && ITEM_KEYS.has(k)));
  return BEFORE_CLASS_ITEMS.map((i) => i.key).filter((k) => set.has(k));
}

export function normalizeCard(raw: unknown): BeforeClassCard | null {
  return typeof raw === "string" && CARD_KEYS.has(raw) ? (raw as BeforeClassCard) : null;
}

export function cardLabel(card: BeforeClassCard | null): string {
  return BEFORE_CLASS_CARDS.find((c) => c.key === card)?.label ?? "";
}

/** 완료율(0~1) — 미흡이 아닌 항목 ÷ 전체. 결석이면 null(시트는 결석 칸을 따로 빨갛게 칠한다). */
export function completionRate(check: BeforeClassCheck): number | null {
  if (check.absent) return null;
  const missed = normalizeMissed(check.missed).length;
  return (BEFORE_CLASS_ITEMS.length - missed) / BEFORE_CLASS_ITEMS.length;
}

export function needsSupplement(check: BeforeClassCheck): boolean {
  return !check.absent && normalizeMissed(check.missed).length >= SUPPLEMENT_THRESHOLD;
}

/** 아무것도 체크하지 않은 칸인가 — 저장하지 않은 칸과 같은 뜻(완료율은 100%로 보인다). */
export function isBlankCheck(check: BeforeClassCheck): boolean {
  return !check.absent && check.card === null && normalizeMissed(check.missed).length === 0;
}

/** 한 학생의 달 요약 — 평균 완료율(결석 제외) · 보충 필요 횟수 · 결석 수 · 항목별 미흡 횟수. */
export function summarizeStudent(checks: readonly BeforeClassCheck[]) {
  const rates = checks.map(completionRate).filter((r): r is number => r !== null);
  const itemCounts = new Map<BeforeClassItemKey, number>();
  for (const c of checks) {
    if (c.absent) continue;
    for (const k of normalizeMissed(c.missed)) itemCounts.set(k, (itemCounts.get(k) ?? 0) + 1);
  }
  return {
    average: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    supplementCount: checks.filter(needsSupplement).length,
    absentCount: checks.filter((c) => c.absent).length,
    itemCounts,
  };
}

export function percentLabel(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}
