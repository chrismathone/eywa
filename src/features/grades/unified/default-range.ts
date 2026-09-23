/**
 * 통합 성적관리의 **기본 기간 = 오늘 기준 최근 한 달**(원장 2026-09-24) — 한 달 전 같은 날부터 오늘까지.
 * 한 달 전 달에 그날이 없으면(3/31 → 2/31) 그 달 말일로 당긴다. 기간을 고르면 이 값은 안 쓴다.
 * 화면과 엑셀 내보내기가 같은 함수를 부른다(한쪽만 6개월이면 "화면 12건 · 엑셀 80건"이 된다).
 * 기간을 좁혀도 증감의 '직전 시험'은 조회(`getUnifiedGrades`)가 기간 앞 180일까지 따로 본다.
 */
export function defaultRangeFrom(to: string): string {
  const [y, m, d] = to.split("-").map(Number) as [number, number, number];
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const lastDay = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
  return `${prevY}-${String(prevM).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

