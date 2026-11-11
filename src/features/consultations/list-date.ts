import { formatKoreanDate, formatShortKoreanDate, kstDateOf, kstToday, monthDayLabel } from "@/lib/date-kst";

/**
 * 원생상담 목록 '날짜' 칸 — 실제 상담 날짜(원장 2026-11-11 *"날짜 칸은 실제 날짜로 보여줘"* — 그 전엔 '7시간 전' 같은 상대 시각).
 * 올해 상담 = "11/10 (화)"(좁은 자리용 공용 표기 `formatShortKoreanDate`) · 다른 해 = "2025/11/10"(같은 월/일이 해마다 겹치지 않게 연도를 붙인다).
 * 🔴 날짜는 **KST**로 자른다(`kstDateOf`) — `iso.slice(0, 10)`은 UTC라 00:00~08:59 KST 상담이 하루 전으로 적힌다. 못 읽으면 '—'(지어내지 않는다).
 */
export function consultDateLabel(iso: string | null | undefined, today: string = kstToday()): string {
  const ymd = kstDateOf(iso);
  if (!ymd) return "—";
  return ymd.slice(0, 4) === today.slice(0, 4) ? formatShortKoreanDate(ymd) : `${ymd.slice(0, 4)}/${monthDayLabel(ymd)}`;
}

/** 마우스 오버 전문의 상담일 — "2026년 11월 10일 (화)". 못 읽으면 null(그 줄을 뺀다). */
export function consultDateFull(iso: string | null | undefined): string | null {
  const ymd = kstDateOf(iso);
  return ymd ? formatKoreanDate(ymd) : null;
}
