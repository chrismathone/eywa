import { kstToday } from "@/lib/date-kst";

/**
 * 학부모 공개 보고서 링크(/r/[token]) 만료 가드 — 미성년 PII가 인증 없는 URL로 무기한 노출되는 것 방지(PIPA 최소보관).
 * 사용자 결정(2026-07-07): **보고서일 기준 90일 후 만료**. 만료는 컬럼 없이 report_date에서 파생한다.
 *
 * ⚠️ 날짜 산술 규약: "오늘(KST)"은 `kstToday()`(로케일 기준)지만, 이미 주어진 날짜(report_date)의 +90일 range 계산은
 * **UTC date 산술**이 정답(date-kst.ts 주석 — Vercel 자정/월초 경계 오류 없음). YYYY-MM-DD 사전순 비교(classnote-guard.ts 동형).
 */

/**
 * 학부모 보고서 링크가 열리는 기간(일) — **단일 소스**(원장 2026-07-07 결정, 2026-10-01 재확정).
 * 판정(아래 두 함수)과 '링크 만료' 페이지(`/expired?kind=report`) 안내 문구가 같이 이 값을 읽는다.
 */
export const REPORT_SHARE_LINK_DAYS = 90;

/** report_date(YYYY-MM-DD) + 90일을 YYYY-MM-DD로. UTC date 산술(경계 안전). */
export function shareExpiryDate(reportDate: string, days = REPORT_SHARE_LINK_DAYS): string {
  // `${date}T00:00:00Z`로 UTC 자정 고정 → +days일 → ISO 앞 10자. 로컬 타임존·DST 무관.
  const base = new Date(`${reportDate}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * 링크가 만료됐는가 — 오늘(KST)이 (report_date+90일)을 **지났으면** 만료.
 * 경계: 90일째 당일은 유효(`kstToday() === expiry` → false), 그 다음날부터 만료(`>` 비교).
 * `days`는 같은 산술을 다른 기간에 쓰는 자리(숙제 영상 제출 링크 7일 — video-submit/rules.ts)를 위한 것이다.
 * 보고서 링크의 90일은 기본값 그대로다(이 값을 바꾸지 말 것).
 */
export function isShareExpired(reportDate: string, todayKst: string = kstToday(), days = REPORT_SHARE_LINK_DAYS): boolean {
  if (!reportDate) return false;
  return todayKst > shareExpiryDate(reportDate, days);
}
