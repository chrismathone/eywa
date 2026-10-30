/**
 * 상담 **최근 추세** — 목록 위 요약 띠의 '최근 4주'(원장 2026-10-30 *"전체 건수는 숨기고 담임별 상담 건수 등 최근 추세에 대해서"*).
 * 누적 건수(전체 기간 2,011건)는 쌓이기만 해서 판단에 안 쓰인다 — 다 끝난 최근 n주와 그 앞 n주를 견준다(이번 주는 덜 찼으니 따로).
 * 담임별 줄도 같은 모양으로 이번 달·지난달을 견준다(homeroom-model.ts 달 열). 순수 · 서버/클라 공용([[#61]]).
 */
import type { HomeroomStats } from "./homeroom-model";
import type { StatsBucket } from "./stats-model";

const DAY = 86_400_000;
const toMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const toYmd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 그 날이 든 주의 월요일(주 버킷 시작일과 같은 기준). */
export function mondayOf(ymd: string): string {
  const ms = toMs(ymd);
  const dow = new Date(ms).getUTCDay(); // 0 = 일
  return toYmd(ms - ((dow + 6) % 7) * DAY);
}

export type RecentTrend = {
  /** 다 끝난 최근 n주 건수 · 그 앞 n주 건수 · 이번 주(진행 중) 건수. */
  recent: number;
  prior: number;
  thisWeek: number;
  /** 직전 대비 증감(%) — 앞 n주가 0이면 견줄 수 없어 null. */
  changePct: number | null;
  /** 최근 n주 첫날·마지막 날(일요일). */
  from: string;
  to: string;
};

/** 주 버킷이 빠진 주(0건)가 있어도 날짜로 센다 — 버킷 개수에 기대지 않는다. */
export function recentWeekTrend(weeks: readonly StatsBucket[], today: string, span = 4): RecentTrend {
  const thisMon = toMs(mondayOf(today));
  const recentFrom = thisMon - span * 7 * DAY;
  const priorFrom = thisMon - span * 14 * DAY;
  let recent = 0, prior = 0, thisWeek = 0;
  for (const w of weeks) {
    const b = toMs(w.b);
    if (b >= thisMon) thisWeek += w.n;
    else if (b >= recentFrom) recent += w.n;
    else if (b >= priorFrom) prior += w.n;
  }
  return {
    recent,
    prior,
    thisWeek,
    changePct: prior > 0 ? Math.round(((recent - prior) / prior) * 100) : null,
    from: toYmd(recentFrom),
    to: toYmd(thisMon - DAY),
  };
}

/** 증감 문구 — `+12%`·`-5%`·`변화 없음`, 견줄 수 없으면 null. */
export function changeText(p: number | null): string | null {
  if (p === null) return null;
  return p === 0 ? "변화 없음" : `${p > 0 ? "+" : ""}${p}%`;
}

export type HomeroomMonthCell = { ym: string; counseled: number; target: number; count: number };
export type HomeroomTrendRow = { id: string; name: string; subjects: string[]; months: HomeroomMonthCell[] };

/**
 * 담임별 달 요약 — 담임 본인이 상담한 학생 수 / 대상 학생 수 · 담임 본인 상담 건수(같은 학생 여러 번 포함).
 * 열은 homeroom 달 열 중 **끝 두 달**(지난달 · 이번 달 — 현황 시작 달 전이면 한 달만).
 */
export function homeroomTrendRows(data: HomeroomStats): { months: string[]; rows: HomeroomTrendRow[] } {
  const idx = data.months.map((_, i) => i).slice(-2);
  return {
    months: idx.map((i) => data.months[i]!),
    // 지금 맡은 반 없이 지난달 퇴원생만 남은 담임 줄(대상이 모든 달 0)은 뺀다 — '담임별 N명'·팝업에 0/0 줄이 끼지 않게(리뷰).
    rows: data.teachers.filter((t) => idx.some((i) => (t.months[i]?.target ?? 0) > 0)).map((t) => ({
      id: t.id,
      name: t.name,
      subjects: t.subjects,
      months: idx.map((i) => ({
        ym: data.months[i]!,
        counseled: t.months[i]?.self ?? 0,
        target: t.months[i]?.target ?? 0,
        // 반에 들어오기 전 달(before)의 상담은 분모(대상)에 없으니 건수에서도 뺀다.
        count: t.students.reduce((s, st) => s + (st.cells[i] === "before" ? 0 : (st.selfCounts[i] ?? 0)), 0),
      })),
    })),
  };
}

/** 이번 달(끝 열) 담임 상담률 — 담임 본인이 상담한 학생 ÷ 대상 학생, 학원 합계. 지난달이 있으면 함께. */
export function homeroomRate(rows: readonly HomeroomTrendRow[]): { now: number | null; prev: number | null } {
  const at = (back: number) => {
    let c = 0, t = 0;
    for (const r of rows) {
      const m = r.months[r.months.length - 1 - back];
      if (!m) return null;
      c += m.counseled;
      t += m.target;
    }
    return t > 0 ? Math.round((c / t) * 100) : null;
  };
  return { now: rows.length ? at(0) : null, prev: rows.length && rows[0]!.months.length > 1 ? at(1) : null };
}
