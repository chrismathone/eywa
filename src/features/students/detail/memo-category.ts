/**
 * 학생 메모 **분류 단일 소스** — 값·라벨·색을 한 곳에서만 적는다.
 *
 * 🔴 종전엔 같은 표가 **두 파일에 복사**돼 있었고(작성 폼·목록 항목), 그러면서도 '최근 메모' 카드는
 *    아예 그 표를 안 거쳐 **저장값 `general`을 그대로** 화면에 뿌렸다(원장 제보 2026-09-08:
 *    *"드랍다운 목록과 실제 출력되는게 다름. 실제 출력이 영문으로 출력됨"*). raw enum 노출 금지 규약 위반.
 * 🔴 새 분류를 더할 땐 **여기만** 고친다 — 화면 파일에 라벨·색 맵을 다시 만들지 말 것.
 * ⚠️ 값은 **DB에 남는 문자열**이라 한 번 쓴 값을 바꾸지 말 것(옛 행이 라벨을 잃는다). 라벨만 바꾼다.
 */
export const MEMO_CATEGORIES = [
  // 원장 2026-11-10 *"일반 -> 중점사안 으로 이름 변경"* — 라벨만(값 general 그대로).
  { value: "general", label: "중점사안" },
  { value: "homework", label: "숙제/과제" },
  { value: "behavior", label: "행동" },
  { value: "parent", label: "학부모" },
  { value: "health", label: "건강" },
  // 원장 2026-09-08 *"분류에 '특별반' 추가해줘"*.
  { value: "special_class", label: "특별반" },
  { value: "other", label: "기타" },
] as const;

export type MemoCategory = (typeof MEMO_CATEGORIES)[number]["value"];

const LABELS: Record<string, string> = Object.fromEntries(
  MEMO_CATEGORIES.map((c) => [c.value, c.label]),
);

/**
 * 화면에 적을 분류 이름. **모르는 값은 '기타'로** — 저장값(`general`)이 화면에 그대로 새지 않게 한다.
 * ⚠️ 원문을 그대로 돌려주지 않는다(그게 이번에 고친 버그다).
 */
export function memoCategoryLabel(value: string | null | undefined): string {
  if (!value) return LABELS.general;
  return LABELS[value] ?? LABELS.other;
}

/** 분류 알약 색 — 의미색이 아니라 **구분용 팔레트**라 차트 색을 쓴다(상태 캐논 대상 아님). */
export const MEMO_CATEGORY_COLOR: Record<string, string> = {
  general: "bg-chart-1/10 text-chart-1 border-chart-1/20",
  homework: "bg-chart-2/10 text-chart-2 border-chart-2/20",
  behavior: "bg-chart-3/10 text-chart-3 border-chart-3/20",
  parent: "bg-chart-5/10 text-chart-5 border-chart-5/20",
  health: "bg-chart-4/10 text-chart-4 border-chart-4/20",
  special_class: "bg-purple-soft text-purple border-purple/25",
  other: "bg-muted text-muted-foreground border-border",
};

export function memoCategoryColor(value: string | null | undefined): string {
  return MEMO_CATEGORY_COLOR[value ?? "general"] ?? MEMO_CATEGORY_COLOR.other;
}
