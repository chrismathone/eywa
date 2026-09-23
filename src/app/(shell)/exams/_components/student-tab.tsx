import Link from "next/link";
import { BigStat } from "@/components/atoms/big-stat";
import { FilterSelect } from "@/components/filter-select";
import { ToolbarButton } from "@/components/toolbar";
import { aggregateBy, averagePercent, schoolGradeLabel, scorePercent, type UnifiedRow } from "@/features/grades/unified/model";
import { DeltaBadge, KindPill, Panel, ScoreLine } from "./tab-parts";
import { TrendChart } from "./trend-chart";

type Href = (patch: Record<string, string>) => string;

/**
 * 학생 추이 — 학생 고르기(검색형) + 이전·다음 학생 + 지표 4칸 + 추이 + 전체 기록.
 * 옛 화면은 기본 select + [보기] 버튼이고 최근 6건만 보여 "나머지 기록은 어디 있지?"가 됐다.
 */
export function StudentTab({ students, selected, rows, href }: {
  students: UnifiedRow[]; selected: UnifiedRow | undefined; rows: UnifiedRow[]; href: Href;
}) {
  if (!selected) return <Panel title="학생 추이"><p className="text-text-dim py-10 text-center text-sm">조건에 맞는 학생이 없습니다.</p></Panel>;
  const index = students.findIndex((s) => s.studentId === selected.studentId);
  const prev = students[index - 1];
  const next = students[index + 1];
  const latest = rows[0];
  const scored = rows.filter((r) => scorePercent(r) != null);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <FilterSelect paramName="student" axisLabel="학생" value={selected.studentId} cap={2000}
        options={students.map((s) => ({ value: s.studentId, label: s.name, hint: schoolGradeLabel(s.school, s.grade) }))} />
      {prev ? <ToolbarButton href={href({ tab: "student", student: prev.studentId })}>‹ {prev.name}</ToolbarButton> : null}
      {next ? <ToolbarButton href={href({ tab: "student", student: next.studentId })}>{next.name} ›</ToolbarButton> : null}
      <span className="text-text-dim text-sm">{index + 1} / {students.length}명</span>
      <Link href={`/students/${selected.studentId}?tab=grades`} className="text-primary ml-auto text-sm font-semibold hover:underline">학생 상세 열기 →</Link>
    </div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <BigStat label="시험 기록" value={rows.length} unit="건" tone="blue" sub={`점수 있는 기록 ${scored.length}건`} />
      <BigStat label="기간 평균" value={averagePercent(rows) ?? "—"} unit={averagePercent(rows) == null ? undefined : "점"} tone="primary" sub="100점 환산" />
      <BigStat label="최근 시험" value={latest && scorePercent(latest) != null ? Math.round(scorePercent(latest)!) : "—"}
        unit={latest && scorePercent(latest) != null ? "%" : undefined} tone="purple" sub={latest ? `${latest.date} · ${latest.name}` : "기록 없음"} />
      <BigStat label="최근 변화" value={latest?.delta == null ? "—" : `${latest.delta > 0 ? "+" : ""}${latest.delta}`}
        unit={latest?.delta == null ? undefined : latest.deltaUnit === "%p" ? "%p" : "점"} tone={latest?.delta == null ? "neutral" : latest.delta >= 0 ? "green" : "danger"} sub="직전 같은 시험 대비" />
    </div>
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Panel title={`${selected.name} 성적 흐름`} sub={`${schoolGradeLabel(selected.school, selected.grade)} · 월별 평균`}>
        <TrendChart points={aggregateBy(rows, "academy")[0]?.points ?? []} />
      </Panel>
      <Panel title="시험 기록" sub={`${rows.length}건 · 최신순`}>
        <ul className="divide-line-faint max-h-96 divide-y overflow-auto pr-1">{rows.map((row) => <li key={row.key} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2"><span className="num text-text-dim w-12 shrink-0">{row.date.slice(5).replace("-", "/")}</span><KindPill kind={row.kind} /></span>
          <span className="flex shrink-0 items-center gap-2"><ScoreLine row={row} /><DeltaBadge row={row} /></span>
        </li>)}</ul>
      </Panel>
    </div>
  </div>;
}
