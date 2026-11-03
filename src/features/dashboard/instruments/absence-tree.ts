/**
 * 반복 결석 계층 — 카드의 학생 명단을 담임 → 반 → 학생으로 펼친다. 학생을 고르는 판정은 운영실 카드 그대로이고
 * 여기서는 그 학생들의 결석을 반마다 나눠 보여 줄 뿐이다. 순수 함수(Vitest).
 */
import type { OverviewData } from "@/features/dashboard/overview/model";
import { classSubject, rosterOf } from "./details-shared";
import type { Detail, DetailContext, DetailRow, DetailSlice, DetailTable, DetailTrend } from "./details-types";
import type { AbsenceLine } from "./extras-types";
import { monthDay, num } from "./labels";

const NOTE = "여러 반을 듣는 학생은 반마다 한 줄씩 나옵니다. 위 수치는 한 명으로 셉니다.";
const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const totals = (lines: readonly AbsenceLine[], recentFrom: string) => ({
  people: new Set(lines.map((l) => l.studentId)).size,
  plain: lines.reduce((n, l) => n + l.dates.length, 0),
  all: lines.reduce((n, l) => n + l.dates.length + l.notified, 0),
  recent: lines.reduce((n, l) => n + l.dates.filter((d) => d >= recentFrom).length, 0),
  classes: new Set(lines.map((l) => l.classId)).size,
  teachers: new Set(lines.map((l) => l.teacherId ?? "")).size,
});
type Totals = ReturnType<typeof totals>;

const cellsOf = (t: Totals, people: boolean) => [people ? `${num(t.people)}명` : "—", `${num(t.plain)}회`, `${num(t.all)}회`, `${num(t.recent)}회`];

function groupBy<T>(list: readonly T[], keyOf: (item: T) => string) {
  const out = new Map<string, T[]>();
  for (const item of list) out.set(keyOf(item), [...(out.get(keyOf(item)) ?? []), item]);
  return [...out.values()];
}

/** 사전 통보 제외 결석이 많은 쪽부터 — 챙길 곳이 위로. */
const byWeight = (recentFrom: string) => (a: readonly AbsenceLine[], b: readonly AbsenceLine[]) => totals(b, recentFrom).plain - totals(a, recentFrom).plain;

function treeTable(lines: readonly AbsenceLine[], recentFrom: string, ctx: DetailContext): DetailTable {
  const rows: DetailRow[] = [];
  for (const mine of groupBy(lines, (l) => l.teacherId ?? "").sort(byWeight(recentFrom))) {
    const teacherKey = `t:${mine[0]!.teacherId ?? ""}`;
    const tabs = [...new Set(mine.map((l) => classSubject(ctx, l.subject, l.classId)))].filter((t) => t !== "—");
    rows.push({ id: teacherKey, depth: 0, cells: [`${mine[0]!.teacher ?? "담임 없음"}${tabs.length ? ` · ${tabs.join("·")}` : ""}`, ...cellsOf(totals(mine, recentFrom), true)] });
    for (const cls of groupBy(mine, (l) => l.classId).sort(byWeight(recentFrom))) {
      const classKey = `${teacherKey}:${cls[0]!.classId}`;
      rows.push({ id: classKey, parent: teacherKey, depth: 1, href: `/classes/${cls[0]!.classId}`, linkTitle: cls[0]!.className, cells: [cls[0]!.className, ...cellsOf(totals(cls, recentFrom), true)] });
      for (const line of [...cls].sort((a, b) => b.dates.length - a.dates.length)) {
        rows.push({
          id: `${classKey}:${line.studentId}`, parent: classKey, depth: 2,
          cells: [`${line.name}${line.schoolGrade ? ` · ${line.schoolGrade}` : ""}`, ...cellsOf(totals([line], recentFrom), false)],
          ...(ctx.can("students") ? { href: `/students/${line.studentId}?tab=attendance`, linkTitle: `${line.name} 출결` } : {}),
        });
      }
    }
  }
  return { title: "담임 · 반 · 학생", unit: "줄", cols: ["담임 · 반 · 학생", "학생", "사전 통보 제외", "전체 결석", "최근 7일"], rows, note: NOTE };
}

function dailyTrend(lines: readonly AbsenceLine[], anchor: string): DetailTrend {
  const days = Array.from({ length: 14 }, (_, i) => shift(anchor, i - 13));
  const counts = new Map<string, number>();
  for (const line of lines) for (const d of line.dates) counts.set(d, (counts.get(d) ?? 0) + 1);
  return { title: "날마다 사전 통보 제외 결석", labels: days.map(monthDay), series: [{ name: "결석", values: days.map((d) => counts.get(d) ?? 0), tone: "m-red" }], unit: "회", kind: "bar", noRange: true };
}

const figures = (t: Totals): [string, string][] => [["사전 통보 제외", `${num(t.plain)}회`], ["최근 7일", `${num(t.recent)}회`], ["반", `${num(t.classes)}개`], ["담임", `${num(t.teachers)}명`]];

/** 값이 아직 안 왔거나 없는 화면은 학생 명단만 남는다. */
export function absenceDetail(data: OverviewData["absences"], repeat: [string, number][], ctx: DetailContext): Detail {
  const base: Detail = {
    title: "반복 결석 학생", period: data.anchor ? `${monthDay(data.anchor)}까지 14일 · 사전 통보 제외 3회 이상` : "최근 14일 · 사전 통보 제외",
    stats: [["확인 필요", `${num(data.rows.length)}명`], ...repeat.map(([k, n]): [string, string] => [k, `${num(n)}명`])],
    tables: [{ title: "명단", unit: "명", cols: ["학생", "반", "담임", "사전 통보 제외", "전체 결석"], rows: data.rows.map((r) => { const who = rosterOf(ctx, r.studentId); return { cells: [r.studentName, who.cls, who.teacher, `${num(r.unexplained)}회`, `${num(r.absences)}회`], href: `/students/${r.studentId}?tab=attendance`, linkTitle: `${r.studentName} 출결`, subject: who.subjects }; }) }],
  };
  const lines = ctx.extras.absenceLines;
  const anchor = data.anchor;
  if (!lines?.length || !anchor) return base;
  const recentFrom = shift(anchor, -6);
  const tabOf = (l: AbsenceLine) => classSubject(ctx, l.subject, l.classId);
  const tabs = [...new Set(lines.map(tabOf))].filter((t) => t !== "—").sort((a, b) => a.localeCompare(b, "ko"));
  const slice = (mine: readonly AbsenceLine[]): DetailSlice => ({ stats: [["확인 필요", `${num(totals(mine, recentFrom).people)}명`], ...figures(totals(mine, recentFrom))], trend: dailyTrend(mine, anchor), tables: [treeTable(mine, recentFrom, ctx)] });
  return {
    ...base,
    stats: [["확인 필요", `${num(data.rows.length)}명`], ...figures(totals(lines, recentFrom))],
    trend: dailyTrend(lines, anchor),
    tables: [treeTable(lines, recentFrom, ctx)],
    ...(tabs.length > 1 ? { bySubject: Object.fromEntries(tabs.map((tab) => [tab, slice(lines.filter((l) => tabOf(l) === tab))])) } : {}),
  };
}

/** '확인할 일' 한 줄의 근거. */
export function absenceBasis(lines: readonly AbsenceLine[] | null | undefined) {
  if (!lines?.length) return null;
  const t = totals(lines, "");
  return { plain: t.plain, classes: t.classes, teachers: t.teachers };
}
