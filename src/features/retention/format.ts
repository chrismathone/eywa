// 리텐션 표시용 포매터(순수).

/** 1,234,000 → "123만", 1.2억 등 KPI용 축약. 부원장 formatWonShort 포팅. */
export function formatWonShort(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1).replace(".0", "")}억`;
  if (value >= 10_000) return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만`;
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

/** ISO 날짜 → 오늘 기준 D-day 라벨. 과거면 "n일 지남", 오늘이면 "오늘". */
export function ddayLabel(iso: string, todayIso: string): string {
  if (iso < todayIso) return `${iso} 지남`;
  if (iso === todayIso) return "오늘";
  const days = Math.round((new Date(iso).getTime() - new Date(todayIso).getTime()) / 86_400_000);
  return `D-${days}`;
}
