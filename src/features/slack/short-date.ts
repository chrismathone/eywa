const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** `2026-09-28` → `9/28(월)` — 모양이 틀리거나 없는 날짜면 null(원문을 흘리지 않는다). 슬랙 문구 공용. */
export function shortDate(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null; // 2/31 같은 없는 날짜
  return `${+m[2]}/${+m[3]}(${WEEK[d.getUTCDay()]})`;
}
