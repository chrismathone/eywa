/** 계기판 토큰 순서 — 차콜 · 노랑 · 회색 3단 · 짙은 회색. 붉은색(#b44832)은 경고·음수 전용이라 여기 넣지 않는다. */
export const palette = ["#363c41", "#fdb811", "#7a8388", "#a3abae", "#c6ccce", "#485055"];
export type ChartDatum = { label: string; value: number; color?: string };
export function composition(data: ChartDatum[]) {
  if (!data.length || data.some(d => !Number.isFinite(d.value) || d.value < 0)) return null;
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total <= 0) return null;
  let start = 0;
  return data.map((d, i) => { const percent = d.value / total * 100; const item = { ...d, percent, start, color: d.color ?? palette[i % palette.length] }; start += percent; return item; });
}
export function chartScale(values: (number | null)[]) {
  const finite = values.filter((n): n is number => n !== null && Number.isFinite(n));
  if (!finite.length) return null;
  const min = Math.min(0, ...finite), max = Math.max(0, ...finite);
  return { min, max: max === min ? min + 1 : max, range: max === min ? 1 : max - min };
}
export function chartNumber(n: number, unit = "") {
  if (unit === "원" && Math.abs(n) >= 1e8) return `${(n / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: 2 })}억`;
  if (unit === "원" && Math.abs(n) >= 1e4) return `${(n / 1e4).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만`;
  return n.toLocaleString("ko-KR", { maximumFractionDigits: 1 });
}
