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

/**
 * 이 달(YYYY-MM)부터의 점만 — 점의 **날짜**로 판정(월 = 말일 · 주 = 일요일 · 연 = 연말/오늘). 에이와 수강 기록이 갖춰진 달(`trustFrom`,
 * 원장 2026-10-20 '2026년 4월부터') 전 점을 빼는 데 쓴다. null이면 그대로.
 */
export function pointsFrom<T extends { date: string }>(points: readonly T[], from: string | null): T[] {
  return from ? points.filter((p) => p.date >= `${from}-01`) : [...points];
}

/**
 * 월별·연도별 점을 시작 달부터 자른다 — **뺀 점이 없으면 시작 달도 null**(창 안에 그 전 달이 없는데 '그 달부터 보입니다'라고 하면
 * 거짓이다 · 적대 리뷰 2026-10-20). `trustFrom` = 월별·연도별 어느 쪽이든 뺐을 때(각주) · `monthlyFrom` = **월별**을 뺐을 때만(카드 머리
 * '최근 12개월' 대신 'N월부터' — 연도별 옛 해는 해마다 빠지므로 머리가 영영 틀리지 않게, 적대 재리뷰 2026-10-20).
 * 운영실 '재원생 추이' 카드(학원 전체 · 과목 관리자)가 쓴다.
 */
export function clipTrend<T extends { date: string }>(
  monthly: readonly T[],
  yearly: readonly T[],
  from: string | null,
): { monthly: T[]; yearly: T[]; trustFrom: string | null; monthlyFrom: string | null } {
  const m = pointsFrom(monthly, from);
  const y = pointsFrom(yearly, from);
  return { monthly: m, yearly: y, trustFrom: m.length < monthly.length || y.length < yearly.length ? from : null, monthlyFrom: m.length < monthly.length ? from : null };
}
