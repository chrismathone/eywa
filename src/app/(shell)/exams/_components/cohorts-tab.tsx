import Link from "next/link";
import { aggregateBy, averagePercent, type Aggregate, type UnifiedRow } from "@/features/grades/unified/model";
import { percentTone } from "@/features/grades/unified/kind-color";
import { BarRow, Panel } from "./tab-parts";
import { TrendChart } from "./trend-chart";

type Href = (patch: Record<string, string>) => string;
type Cohort = { school: string; grade: string; rows: UnifiedRow[] };

function Picker({ items, selected, param, href }: { items: Aggregate[]; selected: Aggregate | undefined; param: string; href: Href }) {
  return <div className="max-h-56 space-y-0.5 overflow-auto pr-1">{items.map((item) => <Link key={item.key} href={href({ tab: "cohorts", [param]: item.key })} className="block">
    <BarRow label={item.label} sub={`${item.count}건`} value={item.average} active={item.key === selected?.key} /></Link>)}</div>;
}

/** 학교·학년 — 학교별·학년별 평균 막대 + 고른 것의 추이 + 학교×학년 표. */
export function CohortsTab({ rows, schools, grades, selectedSchool, selectedGrade, href }: {
  rows: UnifiedRow[]; schools: Aggregate[]; grades: Aggregate[];
  selectedSchool: Aggregate | undefined; selectedGrade: Aggregate | undefined; href: Href;
}) {
  const cohort = new Map<string, Cohort>();
  for (const row of rows) {
    if (row.score == null || row.maxScore == null) continue;
    const school = row.school ?? "학교 미입력";
    const grade = row.grade ?? "학년 미입력";
    const entry = cohort.get(`${school}|${grade}`) ?? { school, grade, rows: [] };
    entry.rows.push(row);
    cohort.set(`${school}|${grade}`, entry);
  }
  const cohortRows = [...cohort.values()].sort((a, b) => a.school.localeCompare(b.school, "ko") || a.grade.localeCompare(b.grade, "ko"));
  return <div className="space-y-4">
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={`학교 · ${selectedSchool?.label ?? "—"}`} sub={`${schools.length}개 학교 · 평균 높은 순`}>
        <Picker items={schools} selected={selectedSchool} param="schoolGroup" href={href} />
        <div className="border-line-faint mt-3 border-t pt-2"><TrendChart points={selectedSchool?.points ?? []} /></div>
      </Panel>
      <Panel title={`학년 · ${selectedGrade?.label ?? "—"}`} sub={`${grades.length}개 학년 · 평균 높은 순`}>
        <Picker items={grades} selected={selectedGrade} param="gradeGroup" href={href} />
        <div className="border-line-faint mt-3 border-t pt-2"><TrendChart points={selectedGrade?.points ?? []} /></div>
      </Panel>
    </div>
    <Panel title="학교 × 학년" sub="한 학교의 학년별 평균과 월별 흐름">
      {cohortRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left text-sm">
        <thead className="bg-bg-soft"><tr>{["학교", "학년", "평균", "기록", "월별 흐름"].map((h) => <th key={h} className="px-3 py-2 font-bold">{h}</th>)}</tr></thead>
        <tbody>{cohortRows.map((entry) => { const avg = averagePercent(entry.rows); const points = aggregateBy(entry.rows, "academy")[0]?.points ?? [];
          return <tr key={`${entry.school}:${entry.grade}`} className="border-line-faint border-t">
            <td className="px-3 py-2 font-semibold">{entry.school}</td><td className="px-3 py-2">{entry.grade}</td>
            <td className={`num px-3 py-2 font-bold ${percentTone(avg)}`}>{avg ?? "—"}</td><td className="num px-3 py-2">{entry.rows.length}건</td>
            <td className="text-text-dim px-3 py-2">{points.map((p) => `${Number(p.month.slice(5))}월 ${p.average}`).join(" → ") || "—"}</td>
          </tr>; })}</tbody></table></div>
        : <p className="text-text-dim py-8 text-center text-sm">비교할 점수 기록이 없습니다.</p>}
    </Panel>
  </div>;
}
