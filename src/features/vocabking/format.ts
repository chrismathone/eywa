/** 걸린 시간 → "29분 37초". 0 이하·3시간 초과(브라우저를 열어 둔 채 둔 응시)는 "—"(결과지와 같은 규약). */
export function fmtDuration(ms: number): string {
  if (!(ms > 0) || ms > 3 * 3_600_000) return "—";
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}분 ${s % 60}초` : `${s}초`;
}

/** 학습 시간 → "6시간 0분" / "45분". */
export function fmtStudy(ms: number): string {
  const m = Math.round(Math.max(0, ms) / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
}
