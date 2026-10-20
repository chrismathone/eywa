/* 재원생 추이의 날짜 칸 — 월말·주말·연말(이번 달·주·해는 오늘). 순수 함수(Vitest). `enrolled-trend.ts`가 다시 내보낸다. */

const lastDay = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
};
const shift = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1 + n, 1)).toISOString().slice(0, 7);
};

/** 최근 12개월 — 달마다 말일(이번 달은 오늘). */
export function monthlyPoints(today: string, count = 12): { key: string; label: string; date: string }[] {
  const month = today.slice(0, 7);
  return Array.from({ length: count }, (_, i) => {
    const key = shift(month, i - count + 1);
    const m = Number(key.slice(5));
    return { key, label: m === 1 || i === 0 ? `${key.slice(2, 4)}.${m}월` : `${m}월`, date: key === month ? today : lastDay(key) };
  });
}

/**
 * 최근 N주 — 주마다 일요일(이번 주는 오늘). 원생 통계 화면의 '주별' 보기. 라벨 = `M/D`(그 주 마지막 날).
 */
export function weeklyPoints(today: string, count = 26): { key: string; label: string; date: string }[] {
  const t = new Date(`${today}T00:00:00Z`);
  // 이번 주 일요일(KST 날짜 문자열 기준 — 요일은 UTC 자정으로 계산해도 같다).
  const sunday = new Date(t);
  sunday.setUTCDate(t.getUTCDate() + ((7 - t.getUTCDay()) % 7));
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(sunday);
    d.setUTCDate(sunday.getUTCDate() - (count - 1 - i) * 7);
    const iso = d.toISOString().slice(0, 10);
    const date = iso > today ? today : iso;
    return { key: iso, label: `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`, date };
  });
}

/** 연도별 — `fromYear`부터 올해까지 연말(올해는 오늘). */
export function yearlyPoints(today: string, fromYear: number): { key: string; label: string; date: string }[] {
  const year = Number(today.slice(0, 4));
  const out: { key: string; label: string; date: string }[] = [];
  for (let y = Math.min(fromYear, year); y <= year; y++) {
    out.push({ key: String(y), label: `${y}년`, date: y === year ? today : `${y}-12-31` });
  }
  return out;
}
