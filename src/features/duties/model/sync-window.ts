import { addDays } from "@/lib/date-kst";

/** 다시 맞추는 지난 날의 폭 — 크론의 '기한 지났는데 열린 날'(`duty_open_cycles` 7일)과 같다. */
export const SYNC_BACK_DAYS = 7;

/**
 * 변경 기록이 가리킨 날 가운데 **다시 맞출 날** — 오늘과 최근 7일만.
 * 🔴 맞춤(`syncDailyDuties`)은 날짜와 상관없이 **지금** 반·재직·설정으로 판정한다. 몇 달 전 날이나 앞날을 그대로 태우면
 * 장부 시작 전 날에 없던 의무가 생기고, 지금은 닫힌 반의 옛 의무가 지워진다(옛 보고서의 발송 상태 갱신 · 지난달 출결 정정 · 엑셀 가져오기가 그런 날을 적는다).
 * 창 밖의 날은 맞추지 않고 버린다(종전 크론도 보지 않던 날).
 */
export function syncDays(changed: readonly string[], today: string, extra: readonly string[] = []): string[] {
  const from = addDays(today, -SYNC_BACK_DAYS);
  return [...new Set([...changed, ...extra])].filter((d) => d >= from && d <= today).sort();
}
