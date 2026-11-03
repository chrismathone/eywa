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
  { key: "print_homework", label: "과제 미흡", short: "과제" },
  { key: "main_solve", label: "본교재 문제풀이 미흡", short: "본교재 풀이" },
  { key: "main_review", label: "본교재 오답정리 미흡", short: "본교재 오답" },
  { key: "sub_solve", label: "부교재 문제풀이 미흡", short: "부교재 풀이" },
  { key: "sub_review", label: "부교재 오답정리 미흡", short: "부교재 오답" },
  { key: "materials", label: "교재 미지참", short: "교재" },
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

/**
 * 체크 제외 사유(원장 2026-11-02) — 키는 DB(`before_class_checks.excuse_reason`, s2_0016 check 제약)에 저장된다. 라벨만 바꾼다.
 * '기타'는 글(`excuseNote`)을 함께 받는다.
 */
export const EXCUSE_REASONS = [
  { key: "prev_absent", label: "지난 수업 결석" },
  { key: "first_lesson", label: "첫 수업(신규·반이동)" },
  { key: "other", label: "기타" },
] as const;
export type ExcuseReason = (typeof EXCUSE_REASONS)[number]["key"];
const EXCUSE_KEYS = new Set<string>(EXCUSE_REASONS.map((r) => r.key));
export const EXCUSE_NOTE_MAX = 1000;

/**
 * 한 칸(학생 × 반 × 수업일). `excused` = 선생님이 정한 제외(null = 자동 판정을 따른다).
 * `autoExcused` = 지난 수업 결석이라 자동 제외 대상(서버가 판정해 붙이는 값 — **저장하지 않는다**).
 */
export type BeforeClassCheck = {
  missed: string[];
  absent: boolean;
  card: BeforeClassCard | null;
  excused?: boolean | null;
  excuseReason?: ExcuseReason | null;
  excuseNote?: string | null;
  autoExcused?: boolean;
};

export function normalizeExcuseReason(raw: unknown): ExcuseReason | null {
  return typeof raw === "string" && EXCUSE_KEYS.has(raw) ? (raw as ExcuseReason) : null;
}

export function excuseReasonLabel(reason: ExcuseReason | null): string {
  return EXCUSE_REASONS.find((r) => r.key === reason)?.label ?? "";
}

/**
 * 체크 제외인가 — 결석이면 아니다(결석이 이긴다). 선생님이 정한 값이 있으면 그 값, 없으면 자동(지난 수업 결석).
 * 제외인 날은 완료율·보충 필요·미흡 항목에서 빠지고 카드는 '카드 X', 보고서엔 체크리스트 줄이 없다.
 */
export function isExcused(check: BeforeClassCheck): boolean {
  if (check.absent) return false;
  return check.excused ?? !!check.autoExcused;
}

/** 제외 사유 — 자동 제외인데 아직 고르지 않았으면 '지난 수업 결석'. 직접 켠 제외는 고를 때까지 null. */
export function excuseReasonOf(check: BeforeClassCheck): ExcuseReason | null {
  if (!isExcused(check)) return null;
  return check.excuseReason ?? (check.excused == null && check.autoExcused ? "prev_absent" : null);
}

/** 저장된 행 → 칸 — 화면·통계·보고서가 같은 변환을 쓴다. 제외 칸(s2_0016)이 아직 없는 DB에서 읽은 행도 그대로 된다. */
export function checkFromRow(row: {
  missed: unknown; absent: boolean | null; card: unknown;
  excused?: boolean | null; excuse_reason?: unknown; excuse_note?: string | null;
}): BeforeClassCheck {
  return {
    missed: normalizeMissed(row.missed as string[] | null),
    absent: !!row.absent,
    card: normalizeCard(row.card),
    excused: typeof row.excused === "boolean" ? row.excused : null,
    excuseReason: normalizeExcuseReason(row.excuse_reason),
    excuseNote: row.excuse_note ?? null,
  };
}

/** 화면·툴팁 문구 — '기타'는 적은 글. */
export function excuseText(check: BeforeClassCheck): string {
  const reason = excuseReasonOf(check);
  if (reason === "other") return check.excuseNote?.trim() || "기타";
  return excuseReasonLabel(reason);
}

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

/** 완료율(0~1) — 미흡이 아닌 항목 ÷ 전체. 결석·체크 제외면 null(시트는 결석 칸을 따로 빨갛게 칠한다). */
export function completionRate(check: BeforeClassCheck): number | null {
  if (check.absent || isExcused(check)) return null;
  const missed = normalizeMissed(check.missed).length;
  return (BEFORE_CLASS_ITEMS.length - missed) / BEFORE_CLASS_ITEMS.length;
}

/**
 * 완료율로 정하는 자동 카드(원장 2026-11-02 *"완료률 25 퍼센트 단위로 100퍼부터 골드 블루 옐로우 레드 카드 자동배정"*).
 * 100% 위에서부터 25%씩 — 75% 이상 골드 · 50% 이상 블루 · 25% 이상 옐로우 · 그 아래 레드(경계는 위 칸에 넣는다).
 * 결석이면 null(카드는 사람이 따로 고른다).
 */
export const AUTO_CARD_BANDS = [
  { min: 0.75, card: "gold" },
  { min: 0.5, card: "blue" },
  { min: 0.25, card: "yellow" },
  { min: 0, card: "red" },
] as const satisfies readonly { min: number; card: BeforeClassCard }[];

export function autoCard(check: BeforeClassCheck): BeforeClassCard | null {
  const rate = completionRate(check);
  if (rate === null) return null;
  // 10항목 비율(0.1 단위)의 부동소수 오차로 경계가 아래 칸으로 떨어지지 않게 백분율 정수로 비교한다.
  const pct = Math.round(rate * 100);
  return AUTO_CARD_BANDS.find((b) => pct >= Math.round(b.min * 100))?.card ?? "red";
}

/** 화면·통계가 보여 주는 카드 — 체크 제외면 '카드 X'(원장 2026-11-02), 그 밖은 사람이 고른 카드(저장값)가 이기고 안 골랐으면 자동 카드. */
export function effectiveCard(check: BeforeClassCheck): BeforeClassCard | null {
  if (isExcused(check)) return "none";
  return check.card ?? autoCard(check);
}

export function needsSupplement(check: BeforeClassCheck): boolean {
  return !check.absent && !isExcused(check) && normalizeMissed(check.missed).length >= SUPPLEMENT_THRESHOLD;
}

/** 아무것도 체크하지 않은 칸인가 — 저장하지 않은 칸과 같은 뜻(완료율은 100%로 보인다 · 자동 제외는 저장 없이 판정한다). */
export function isBlankCheck(check: BeforeClassCheck): boolean {
  return !check.absent && check.card === null && normalizeMissed(check.missed).length === 0
    && check.excused == null && !check.excuseReason && !check.excuseNote?.trim();
}

/** 한 학생의 달 요약 — 평균 완료율(결석 제외) · 보충 필요 횟수 · 결석 수 · 항목별 미흡 횟수. */
export function summarizeStudent(checks: readonly BeforeClassCheck[]) {
  const rates = checks.map(completionRate).filter((r): r is number => r !== null);
  const itemCounts = new Map<BeforeClassItemKey, number>();
  for (const c of checks) {
    if (c.absent || isExcused(c)) continue;
    for (const k of normalizeMissed(c.missed)) itemCounts.set(k, (itemCounts.get(k) ?? 0) + 1);
  }
  return {
    average: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    supplementCount: checks.filter(needsSupplement).length,
    absentCount: checks.filter((c) => c.absent).length,
    excusedCount: checks.filter(isExcused).length,
    itemCounts,
  };
}

/**
 * 수업보고서 '수업 평가' 표 시안(원장 2026-10-28)의 체크리스트 줄 — 다섯 눈금(하·중하·중·중상·상)으로 옮긴다.
 * 🔴 **시안용 임시 규칙**이다(원장 확정 전): 항목 하나짜리 줄은 해 옴 = 상 · 미흡 = 하, 본교재·부교재 둘을 묶은 줄은
 *    둘 다 해 옴 = 상 · 하나 미흡 = 중 · 둘 다 미흡 = 하. 결석이면 줄 값 없음. 기준이 바뀌면 이 표만 고친다.
 */
export const REPORT_CHECK_ROWS = [
  { label: "예습영상", keys: ["preview_video"] },
  { label: "개념정리", keys: ["concept_note"] },
  { label: "풀이노트정리", keys: ["solution_note"] },
  { label: "문제풀이", keys: ["main_solve", "sub_solve"] },
  { label: "오답정리", keys: ["main_review", "sub_review"] },
] as const satisfies readonly { label: string; keys: readonly BeforeClassItemKey[] }[];

export type ReportLevel = "하" | "중하" | "중" | "중상" | "상";

export function reportCheckLevels(check: BeforeClassCheck): { label: string; level: ReportLevel | null }[] {
  const missed = new Set<string>(normalizeMissed(check.missed));
  return REPORT_CHECK_ROWS.map((row) => {
    if (check.absent) return { label: row.label, level: null };
    const miss = row.keys.filter((k) => missed.has(k)).length;
    const level: ReportLevel = miss === 0 ? "상" : miss === row.keys.length ? "하" : "중";
    return { label: row.label, level };
  });
}

/** 수업 평가 표에 붙는 체크리스트 줄 — 값이 있는 줄(눈금) 또는 결석 한 줄. 화면 시안과 실제 보고서가 같은 함수를 쓴다. */
export type ReportCheckRow = { label: string; level: ReportLevel; none?: undefined } | { label: string; level: null; none: string };

/** 아무것도 체크하지 않은 칸 — 저장된 행이 없는 학생은 '모두 해 옴'이다(시트와 같은 뜻). */
export const DONE_CHECK: BeforeClassCheck = { missed: [], absent: false, card: null };

/**
 * 한 학생·한 수업일의 체크 → 보고서 '수업 평가' 표 줄(2026-10-30 실제 보고서에 적용).
 * 체크 없음(null) → 줄 없음 · **결석 → 줄 없음**(원장 2026-10-30 *"jj는 결석 1A는 출석이면 우리 비포클래스 양식 안들어가고"* —
 * 10-28의 '결석 한 줄'을 뒤집음: 체크하는 반(JJ)에 안 왔으면 보고서(MS)에 체크리스트가 없다) · 그 밖 → 다섯 줄(눈금 규칙 = reportCheckLevels).
 */
export function reportCheckRows(check: BeforeClassCheck | null): ReportCheckRow[] {
  // 체크 제외도 줄 없음(원장 2026-11-02 *"아무줄도 넣지마"*).
  if (!check || check.absent || isExcused(check)) return [];
  return reportCheckLevels(check).flatMap((r): ReportCheckRow[] => (r.level ? [{ label: r.label, level: r.level }] : []));
}

export function percentLabel(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}
