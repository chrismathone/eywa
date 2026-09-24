import Link from "next/link";
import { FaceTabs } from "@/components/face-tabs";
import { aggregateBy, averagePercent, type Aggregate, type UnifiedRow } from "@/features/grades/unified/model";
import { percentTone } from "@/features/grades/unified/kind-color";
import { BarRow, Panel } from "./tab-parts";
import { TrendChart } from "./trend-chart";

type Href = (patch: Record<string, string>) => string;
type Cohort = { school: string; grade: string; rows: UnifiedRow[] };
type Level = "all" | "초" | "중" | "고";
const LEVELS: { key: Level; label: string }[] = [{ key: "all", label: "전체" }, { key: "초", label: "초" }, { key: "중", label: "중" }, { key: "고", label: "고" }];
const asLevel = (v: string | undefined): Level => (v === "초" || v === "중" || v === "고" ? v : "all");

/**
 * 학교급 판정 — 학년 표기(`초3`·`중1`)가 먼저, 없으면 학교 이름 끝(`칠성초`·`경명여중`·`대구고`).
 * 모르면 null(초·중·고 어디에도 안 들어가고 '전체'에서만 보인다 — 억지로 끼워 넣지 않는다).
 */
export function levelOf(school: string | null, grade: string | null): Exclude<Level, "all"> | null {
  const g = grade?.trim().charAt(0);
  if (g === "초" || g === "중" || g === "고") return g;
  const s = school?.replace(/\s+/g, "") ?? "";
  if (/초(등학교)?$/.test(s)) return "초";
  if (/중(학교)?$/.test(s)) return "중";
  if (/고(등학교)?$/.test(s)) return "고";
  return null;
}

function LevelTabs({ param, level, href, label }: { param: string; level: Level; href: Href; label: string }) {
  return <FaceTabs level="secondary" ariaLabel={label} active={level} faces={LEVELS.map((l) => ({ key: l.key, label: l.label, href: href({ tab: "cohorts", [param]: l.key }) }))} />;
}

function Picker({ items, selected, param, href }: { items: Aggregate[]; selected: Aggregate | undefined; param: string; href: Href }) {
  if (!items.length) return <p className="text-text-dim py-6 text-center text-sm">해당하는 기록이 없습니다.</p>;
  return <div className="max-h-56 space-y-0.5 overflow-auto pr-1">{items.map((item) => <Link key={item.key} href={href({ tab: "cohorts", [param]: item.key })} scroll={false} className="block">
    <BarRow label={item.label} sub={`${item.count}건`} value={item.average} active={item.key === selected?.key} /></Link>)}</div>;
}

/** 학교·학년 — 위 두 카드(학교별·학년별)와 아래 표가 **각자** 전체/초/중/고를 고른다(원장 2026-09-23). */
export function CohortsTab({ rows, schools, grades, schoolKey, gradeKey, level: levelRaw, tableLevel: tableRaw, href }: {
  rows: UnifiedRow[]; schools: Aggregate[]; grades: Aggregate[];
  schoolKey?: string; gradeKey?: string; level?: string; tableLevel?: string; href: Href;
}) {
  const level = asLevel(levelRaw);
  const tableLevel = asLevel(tableRaw);
  // 학교 하나가 여러 학년 기록을 가져도 학교급은 이름에서 — 학년 카드는 학년 표기에서.
  const keep = (l: Level, school: string | null, grade: string | null) => l === "all" || levelOf(school, grade) === l;
  const shownSchools = schools.filter((s) => keep(level, s.key === "미입력" ? null : s.key, null));
  const shownGrades = grades.filter((g) => keep(level, null, g.key === "미입력" ? null : g.key));
  const selectedSchool = shownSchools.find((s) => s.key === schoolKey) ?? shownSchools[0];
  const selectedGrade = shownGrades.find((g) => g.key === gradeKey) ?? shownGrades[0];

  const cohort = new Map<string, Cohort>();
  for (const row of rows) {
    if (row.score == null || row.maxScore == null || !keep(tableLevel, row.school, row.grade)) continue;
    const school = row.school ?? "학교 미입력";
    const grade = row.grade ?? "학년 미입력";
    const entry = cohort.get(`${school}|${grade}`) ?? { school, grade, rows: [] };
    entry.rows.push(row);
    cohort.set(`${school}|${grade}`, entry);
  }
  const cohortRows = [...cohort.values()].sort((a, b) => a.school.localeCompare(b.school, "ko") || a.grade.localeCompare(b.grade, "ko"));
  return <div className="space-y-4">
    <LevelTabs param="level" level={level} href={href} label="학교급(학교·학년 카드)" />
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={`학교 · ${selectedSchool?.label ?? "—"}`} sub={`${shownSchools.length}개 학교 · 평균 높은 순`}>
        <Picker items={shownSchools} selected={selectedSchool} param="schoolGroup" href={href} />
        <div className="border-line-faint mt-3 border-t pt-2"><TrendChart points={selectedSchool?.points ?? []} /></div>
      </Panel>
      <Panel title={`학년 · ${selectedGrade?.label ?? "—"}`} sub={`${shownGrades.length}개 학년 · 평균 높은 순`}>
        <Picker items={shownGrades} selected={selectedGrade} param="gradeGroup" href={href} />
        <div className="border-line-faint mt-3 border-t pt-2"><TrendChart points={selectedGrade?.points ?? []} /></div>
      </Panel>
    </div>
    <Panel title="학교 × 학년" sub="한 학교의 학년별 평균과 월별 흐름" right={<LevelTabs param="tlevel" level={tableLevel} href={href} label="학교급(표)" />}>
      {cohortRows.length ? <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-sm">
        <thead className="bg-bg-soft"><tr>{["학교", "학년", "평균", "기록", "월별 흐름"].map((h, i) => <th key={h} className={`px-3 py-2 font-bold ${i === 4 ? "text-left" : "text-center"}`}>{h}</th>)}</tr></thead>
        <tbody>{cohortRows.map((entry) => { const avg = averagePercent(entry.rows); const points = aggregateBy(entry.rows, "academy")[0]?.points ?? [];
          return <tr key={`${entry.school}:${entry.grade}`} className="border-line-faint border-t">
            <td className="px-3 py-2 text-center font-semibold">{entry.school}</td><td className="px-3 py-2 text-center">{entry.grade}</td>
            <td className={`num px-3 py-2 text-center font-bold ${percentTone(avg)}`}>{avg == null ? "—" : `${avg}%`}</td><td className="num px-3 py-2 text-center">{entry.rows.length}건</td>
            <td className="text-text-dim px-3 py-2">{points.map((p) => `${Number(p.month.slice(5))}월 ${p.average}%`).join(" → ") || "—"}</td>
          </tr>; })}</tbody></table></div>
        : <p className="text-text-dim py-8 text-center text-sm">비교할 점수 기록이 없습니다.</p>}
    </Panel>
  </div>;
}
