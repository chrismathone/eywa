import Link from "next/link";
import { averagePercent, schoolGradeLabel, type Aggregate, type UnifiedRow } from "@/features/grades/unified/model";
import { BarRow, DeltaBadge, Panel } from "./tab-parts";
import { TrendChart } from "./trend-chart";

type Href = (patch: Record<string, string>) => string;

/** 그 반 학생별 평균 — 두 반 수강생은 그 반 기록만(평가 당시 반 기준, aggregateBy와 같은 축). */
function studentsOf(rows: UnifiedRow[], classId: string) {
  const byStudent = new Map<string, UnifiedRow[]>();
  for (const row of rows) {
    if (!(row.trendClasses ?? row.classes).some((cls) => cls.id === classId)) continue;
    byStudent.set(row.studentId, [...(byStudent.get(row.studentId) ?? []), row]);
  }
  return [...byStudent.values()].map((list) => ({ row: list[0]!, count: list.length, average: averagePercent(list) }))
    .sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || a.row.name.localeCompare(b.row.name, "ko"));
}

/** 반별 분석 — 전 반 평균 막대(옛 30개 상한 제거) + 고른 반의 추이·학생 순위. */
export function ClassesTab({ classes, selected, rows, href }: {
  classes: Aggregate[]; selected: Aggregate | undefined; rows: UnifiedRow[]; href: Href;
}) {
  const ranked = selected ? studentsOf(rows, selected.key) : [];
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
    <Panel title="반별 평균" sub={`${classes.length}개 반 · 두 반 수강생은 각 반에 포함`}>
      {classes.length ? <div className="max-h-[36rem] space-y-0.5 overflow-auto pr-1">{classes.map((row) => <Link key={row.key} href={href({ tab: "classes", cohortClass: row.key })} scroll={false} className="block">
        <BarRow label={row.label} sub={`${row.count}건`} value={row.average} active={row.key === selected?.key} /></Link>)}</div>
        : <p className="text-text-dim py-8 text-center text-sm">반 기록이 없습니다.</p>}
    </Panel>
    <div className="min-w-0 space-y-4">
      <Panel title={selected?.label ?? "반을 선택해 주세요"} sub={selected ? `${selected.count}건 · 평균 ${selected.average ?? "—"}점 · 학생 ${ranked.length}명` : undefined}
        right={selected ? <Link href={`/classes/${selected.key}`} className="text-primary text-sm font-semibold hover:underline">반 상세 →</Link> : null}>
        <TrendChart points={selected?.points ?? []} />
      </Panel>
      {selected ? <Panel title="학생별 평균" sub="이 반 기록만 · 높은 순">
        <ol className="divide-line-faint max-h-96 divide-y overflow-auto pr-1">{ranked.map((entry, i) => <li key={entry.row.studentId}>
          <Link href={href({ tab: "student", student: entry.row.studentId })} className="hover:bg-bg-soft -mx-2 grid grid-cols-[2rem_minmax(0,1fr)_auto_4.5rem] items-center gap-2 rounded-lg px-2 py-2 text-sm">
            <span className="num text-text-dim">{i + 1}</span>
            <span className="min-w-0 truncate"><b>{entry.row.name}</b> <small className="text-text-dim">{schoolGradeLabel(entry.row.school, entry.row.grade)} · {entry.count}건</small></span>
            <DeltaBadge row={entry.row} />
            <b className="num text-right">{entry.average == null ? "—" : `${entry.average}점`}</b>
          </Link></li>)}</ol>
      </Panel> : null}
    </div>
  </div>;
}
