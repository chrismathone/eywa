/**
 * 추이 차트의 계열(series) 구성 — **가로축은 언제나 1월~12월**, 연도는 막대 색으로 가른다.
 *
 * 🔴 원장 2026-08-05: *"가로축은 몇월인지만 적어놓고 그 아래 라벨 색상을 연도로 구분해서 놔두면 될듯."*
 * 이전엔 기간(2·3개년)을 **하나의 긴 타임라인**으로 그려서 x축이 `1월…12월 1월…12월`로 반복됐고,
 * 어느 해인지 몰라 눈금을 분기·연으로 뭉개야 했다(그러면 이번엔 달이 사라진다). 축을 12칸으로 접고
 * 연도를 계열로 세우면 **같은 달끼리 위아래로 견줄 수 있고** 막대 수도 12칸 안에서 안 늘어난다.
 *
 * 🔑 이 모듈은 순수 함수다 — 인덱스로 짝짓다 어긋나는 실수(2월 값이 3월 칸에 서는)를 테스트로 잠근다.
 */
import type { MonthStat } from "./server/stats-queries";

export const MONTH_LABELS = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);

export type TrendRow = { label: string } & Record<string, string | number | null | undefined>;

/** 계열 하나 = 범례 한 줄. `key`가 곧 범례 이름이라 사람이 읽는 말이어야 한다. */
export type TrendSeries = { key: string; color: string; kind: "count" | "rate" };

/**
 * 연도별 색. **최신이 가장 진하다** — 지난해가 눈에 먼저 들어오면 "올해 어떤가"를 읽는 데 방해가 된다.
 * 3개년까지만 쓰므로(MAX_STATS_YEARS) 색 세 개면 충분하다.
 */
const YEAR_COLORS = ["var(--color-neutral-fill)", "var(--color-blue)", "var(--color-primary)"];

export function yearColor(index: number, count: number): string {
  // 뒤에서부터 채운다 — 2개년이면 [faint, primary], 3개년이면 [faint, blue, primary].
  const offset = YEAR_COLORS.length - count;
  return YEAR_COLORS[Math.max(0, offset + index)] ?? "var(--color-primary)";
}

const monthIndex = (m: string) => Number(m.slice(5, 7)) - 1;

/**
 * 기간(2·3개년) 보기 — 12칸 × 연도별 **상담 건수** 막대.
 * 🔴 계열 이름에 '상담'을 박는다(원장 2026-09-12 *"막대그래프가 상담건수인지 등록건수인지 표시가 안되어있는데"*) —
 *    범례·툴팁이 곧 계열 이름이라, 연도만 적으면 그 숫자가 무엇인지 화면 어디에도 없다(연도 보기는 이미 '…년 상담'이다).
 * 값이 없는 달은 **undefined로 남긴다**(0으로 채우면 "그달 0건이었다"는 거짓말이 된다 — 올해 9~12월처럼
 * 아직 오지 않은 달이 바닥에 붙은 막대로 보인다).
 */
export function buildYearSeries(months: MonthStat[]): { rows: TrendRow[]; series: TrendSeries[]; rateSeries: TrendSeries[] } {
  const years = [...new Set(months.map((m) => m.month.slice(0, 4)))].sort();
  const rows: TrendRow[] = MONTH_LABELS.map((label) => ({ label }));
  for (const m of months) {
    const i = monthIndex(m.month);
    if (i < 0 || i > 11) continue;
    const y = m.month.slice(0, 4);
    const row = rows[i]!;
    // 그 달에 상담이 0건인 것과 "그 달 자체가 조회 범위 밖"인 것은 다르다 — 후자는 아예 키를 안 만든다.
    row[`${y}년 상담`] = m.total;
    row[`${y}년 전환율`] = m.rate;
  }
  const series = years.map((y, i) => ({ key: `${y}년 상담`, color: yearColor(i, years.length), kind: "count" as const }));
  const rateSeries = years.map((y, i) => ({
    key: `${y}년 전환율`,
    color: yearColor(i, years.length),
    kind: "rate" as const,
  }));
  return { rows, series, rateSeries };
}

/**
 * 연도 보기 — 12칸 × (작년 상담 · 올해 상담 · 올해 등록).
 * 🔴 작년을 **선이 아니라 막대**로 세운다(원장 2026-08-05). 선이던 때는 같은 달을 견주려면 눈이
 * 선을 따라가야 해서 "작년 3월보다 늘었나"가 한눈에 안 왔다.
 */
export function buildSingleYearSeries(
  months: MonthStat[],
  prevYearMonths: MonthStat[],
  year: number,
): { rows: TrendRow[]; series: TrendSeries[]; rateSeries: TrendSeries[] } {
  const prevKey = `${year - 1}년 상담`;
  const curKey = `${year}년 상담`;
  const enrolledKey = `${year}년 등록`;
  const rows: TrendRow[] = MONTH_LABELS.map((label) => ({ label }));
  for (const m of months) {
    const i = monthIndex(m.month);
    if (i < 0 || i > 11) continue;
    rows[i]![curKey] = m.total;
    rows[i]![enrolledKey] = m.enrolled;
    rows[i]!["전환율"] = m.rate;
  }
  // ⚠️ 전년은 **월 번호로** 맞춘다. 배열 인덱스로 짝지으면 조회 시작 달이 1월이 아닐 때 통째로 밀린다.
  for (const m of prevYearMonths) {
    const i = monthIndex(m.month);
    if (i < 0 || i > 11) continue;
    rows[i]![prevKey] = m.total;
  }
  const hasPrev = prevYearMonths.some((m) => m.total > 0);
  const series: TrendSeries[] = [
    ...(hasPrev ? [{ key: prevKey, color: "var(--color-neutral-fill)", kind: "count" as const }] : []),
    { key: curKey, color: "var(--color-primary)", kind: "count" as const },
    { key: enrolledKey, color: "var(--color-chart-2)", kind: "count" as const },
  ];
  return { rows, series, rateSeries: [{ key: "전환율", color: "var(--color-gold)", kind: "rate" }] };
}
