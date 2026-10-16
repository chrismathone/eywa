// 표시 하나(기호·색)는 학부모 월별과 직원 '학부모 등하원 → 월별'이 함께 쓴다 — features 쪽 한 벌(중복 금지).
export { MARK } from "@/features/shuttle/parent/month-mark";

/**
 * 달력 칸 안 글자 크기(px) — 폰 폭에서 한 칸이 70px 남짓이라 앱 기본 최소 글자(14px)로는 "대체공휴일"이 잘리고
 * 등·하 두 줄이 칸을 꽉 채워 읽기 어렵다(사용자 2026-10-01 *"글자가 너무 커서 무슨 내용인지 알 수가 없어"*).
 * 이 달력 칸 한정 값이다 — 다른 화면으로 가져가지 말 것.
 */
export const CELL_TEXT = { fontSize: 9, lineHeight: 1.25 } as const;

/** 한 번에 고를 수 있는 날짜 수(서버 `MAX_RIDE_DATES`와 같은 값). */
export const MAX_PICK_DATES = 31;

/** "10/6" — 고른 날짜를 짧게. */
export const shortDate = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

/** "10/6, 10/7, 10/8 외 2일" — 고른 날짜 목록 한 줄. */
export function pickedLabel(dates: readonly string[], show = 3): string {
  const head = dates.slice(0, show).map(shortDate).join(", ");
  return dates.length > show ? `${head} 외 ${dates.length - show}일` : head;
}
