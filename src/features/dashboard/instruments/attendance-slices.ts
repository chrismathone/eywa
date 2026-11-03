/** 출결 상세의 과목 탭 — 탭마다 그 과목의 14일 등원율과 수치, '비교'는 과목을 한 그래프에. */
import { attendance14 } from "./derive";
import { courseName } from "./details-shared";
import type { DetailContext, DetailSlice, DetailTable, DetailTrend } from "./details-types";
import type { AttendanceBySubject } from "./extras-types";
import { monthDay, num, subjectStyle } from "./labels";

type Overview = AttendanceBySubject[string];
const rounded = (o: Overview) => o.trend.map((p) => (p.rate === null ? null : Math.round(p.rate)));

function linesOf(ctx: DetailContext) {
  return Object.entries(ctx.extras.attendance ?? {})
    .filter(([, o]) => o.trend.some((p) => p.total > 0))
    .map(([key, o]) => ({ key, label: courseName(key, ctx), o }))
    .sort((a, b) => a.label.localeCompare(b.label, "ko"));
}

const trendOf = (o: Overview, key: string): DetailTrend => ({
  title: "최근 14일 등원율", labels: o.trend.map((p) => monthDay(p.date)),
  series: [{ name: "등원율", values: rounded(o), ...subjectStyle(key) }], unit: "%", kind: "bar", noRange: true,
});

/** 값이 있는 과목이 둘 이상일 때만 탭이 선다. */
export function attendanceTabs(ctx: DetailContext, stats: (o: Overview) => [string, string][], tables?: (o: Overview) => DetailTable[]): Record<string, DetailSlice> | undefined {
  const lines = linesOf(ctx);
  if (lines.length < 2) return undefined;
  return Object.fromEntries(lines.map(({ key, label, o }) => [label, { stats: stats(o), trend: trendOf(o, key), ...(tables ? { tables: tables(o) } : {}) }]));
}

export function attendanceCompare(ctx: DetailContext): DetailSlice | undefined {
  const lines = linesOf(ctx);
  if (lines.length < 2) return undefined;
  const days = lines[0]!.o.trend.map((p) => p.date);
  return {
    stats: lines.map(({ label, o }): [string, string] => [label, `${attendance14(o.trend).value}%`]),
    trend: { title: "과목별 등원율", labels: days.map(monthDay), series: lines.map(({ key, label, o }, i) => ({ name: label, values: rounded(o), ...subjectStyle(key, i) })), unit: "%", kind: "line", noRange: true, zero: true },
    tables: [{
      title: "날마다", cols: ["날짜", ...lines.map((l) => l.label)],
      rows: days.map((date, i) => ({ cells: [monthDay(date), ...lines.map(({ o }) => { const rate = o.trend[i]!.rate; return rate === null ? "—" : `${Math.round(rate)}%`; })] })).reverse(),
    }],
  };
}

export const dayRows = (o: Overview) => [...o.trend].reverse().map((p) => ({ cells: [monthDay(p.date), p.rate === null ? "—" : `${Math.round(p.rate)}%`, `${num(p.total)}칸`] }));
