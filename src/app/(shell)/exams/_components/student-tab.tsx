import Link from "next/link";
import { BigStat } from "@/components/atoms/big-stat";
import { aggregateBy, averagePercent, schoolGradeLabel, scorePercent, type UnifiedRow } from "@/features/grades/unified/model";
import { percentTone } from "@/features/grades/unified/kind-color";
import { DeltaBadge, KindPill, Panel, ScoreLine } from "./tab-parts";
import { TrendChart } from "./trend-chart";

type Href = (patch: Record<string, string>) => string;
const pt = (v: number | null) => (v == null ? "—" : `${v}점`);

/** 학생 고르기 — 위 툴바의 `검색`(이름)으로 좁히고 카드를 눌러 연다. 처음엔 아무도 안 골라져 있다(원장 2026-09-23). */
function StudentPicker({ students, rows, href }: { students: UnifiedRow[]; rows: UnifiedRow[]; href: Href }) {
  const byStudent = new Map<string, UnifiedRow[]>();
  for (const row of rows) byStudent.set(row.studentId, [...(byStudent.get(row.studentId) ?? []), row]);
  return <Panel title="학생을 고르세요" sub={`${students.length}명 · 위 툴바의 '검색'으로 이름을 찾을 수 있습니다`}>
    {students.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">{students.map((s) => {
      const list = byStudent.get(s.studentId) ?? [];
      const avg = averagePercent(list);
      return <Link key={s.studentId} href={href({ tab: "student", student: s.studentId })}
        className="border-line hover:border-primary hover:bg-primary-soft/30 flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm transition">
        <span className="min-w-0"><b className="block truncate">{s.name}</b><small className="text-text-dim">{schoolGradeLabel(s.school, s.grade)} · {list.length}건</small></span>
        <b className={`num shrink-0 ${percentTone(avg)}`}>{pt(avg)}</b>
      </Link>;
    })}</div> : <p className="text-text-dim py-10 text-center text-sm">검색어에 맞는 학생이 없습니다.</p>}
  </Panel>;
}

/** 학생 추이 — 고른 학생의 지표 4칸 · 추이 · 전체 기록. 점수는 전부 100점 환산 '점'. */
export function StudentTab({ students, selected, rows, allRows, href }: {
  students: UnifiedRow[]; selected: UnifiedRow | undefined; rows: UnifiedRow[]; allRows: UnifiedRow[]; href: Href;
}) {
  if (!selected) return <StudentPicker students={students} rows={allRows} href={href} />;
  const latest = rows[0];
  const latestPct = latest ? scorePercent(latest) : null;
  const avg = averagePercent(rows);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-3">
      <Link href={href({ tab: "student", student: "" })} className="text-primary text-sm font-semibold hover:underline">← 학생 목록</Link>
      <h2 className="text-xl font-bold">{selected.name} <small className="text-text-dim text-sm font-normal">{schoolGradeLabel(selected.school, selected.grade)}</small></h2>
      <Link href={`/students/${selected.studentId}?tab=grades`} className="text-primary ml-auto text-sm font-semibold hover:underline">학생 상세 열기 →</Link>
    </div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <BigStat label="시험 기록" value={rows.length} unit="건" tone="blue" sub={`점수 있는 기록 ${rows.filter((r) => scorePercent(r) != null).length}건`} />
      <BigStat label="기간 평균" value={avg ?? "—"} unit={avg == null ? undefined : "점"} tone="primary" sub="100점 환산" />
      <BigStat label="최근 시험" value={latestPct == null ? "—" : Math.round(latestPct * 10) / 10} unit={latestPct == null ? undefined : "점"} tone="purple"
        sub={latest ? `${latest.date} · 100점 환산` : "기록 없음"} />
      <BigStat label="최근 변화" value={latest?.delta == null ? "—" : `${latest.delta > 0 ? "+" : ""}${latest.delta}`}
        unit={latest?.delta == null ? undefined : latest.deltaUnit === "%p" ? "%p" : "점"} tone={latest?.delta == null ? "neutral" : latest.delta >= 0 ? "green" : "danger"} sub="직전 같은 시험 대비" />
    </div>
    <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
      <Panel title="성적 흐름" sub="월별 평균 · 100점 환산"><TrendChart points={aggregateBy(rows, "academy")[0]?.points ?? []} /></Panel>
      <Panel title="시험 기록" sub={`${rows.length}건 · 최신순`}>
        <ul className="divide-line-faint max-h-96 divide-y overflow-auto pr-1">{rows.map((row) => <li key={row.key} className="flex items-center justify-between gap-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2"><span className="num text-text-dim w-12 shrink-0">{row.date.slice(5).replace("-", "/")}</span><KindPill kind={row.kind} /></span>
          <span className="flex shrink-0 items-center gap-2"><ScoreLine row={row} /><DeltaBadge row={row} /></span>
        </li>)}</ul>
      </Panel>
    </div>
  </div>;
}
