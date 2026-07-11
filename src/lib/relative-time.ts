/**
 * 상대시간 표시 문자열(KST 무관 — 절대 시각차 기반) 정본 헬퍼.
 *
 * 이전엔 파일마다 로컬 중복 구현이 있었고, 일부는 하루(86,400,000ms) 단위로만 나눠 24시간 미만을
 * "0일 전"으로 뭉갰다(원장 지적). 이 함수는 **24시간 미만은 시/분**으로, 24시간이 지나야 "1일 전"으로
 * 표시한다. 순수 함수(nowMs 주입 가능) — Vitest로 경계값 고정.
 *
 * 규칙: 1분 미만=방금 전 · 60분 미만=N분 전 · 24시간 미만=N시간 전 · 7일 미만=N일 전 · 그 이상=YYYY-MM-DD(ko).
 * (날짜/미래/파싱실패는 빈 문자열 — 호출부에서 조건 렌더.)
 */
import { kstToday } from "./date-kst";

export function relativeTimeKo(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = nowMs - t;
  if (diff < 60_000) return "방금 전"; // 미래(시계 오차)·1분 미만
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR"); // 7일 이상은 절대 날짜
}

/**
 * **날짜(YYYY-MM-DD)만** 있는 값의 상대 표시 — 시각 정보가 없어 시/분 단위가 무의미하므로 KST 달력 기준으로
 * 오늘/어제/N일 전. (예: 퇴원일 withdrawn_at = date 컬럼.) "0일 전" 대신 "오늘". 7일 이상은 원본 날짜.
 * 순수 함수(todayKst 주입 가능) — 달력 일수는 UTC 자정 파싱으로 계산(양쪽 date-only라 TZ 영향 없음).
 */
export function relativeDayKo(dateStr: string | null | undefined, todayKst: string = kstToday()): string {
  if (!dateStr) return "";
  const ymd = dateStr.slice(0, 10);
  const d = Date.parse(`${ymd}T00:00:00Z`);
  const today = Date.parse(`${todayKst}T00:00:00Z`);
  if (Number.isNaN(d) || Number.isNaN(today)) return "";
  const days = Math.round((today - d) / 86_400_000);
  if (days <= 0) return "오늘";
  if (days === 1) return "어제";
  if (days < 7) return `${days}일 전`;
  return ymd;
}
