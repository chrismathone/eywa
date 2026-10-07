
import { SheetText } from "@/features/teacher-view/interface-label";
import Link from "next/link";
import { BigStat } from "@/components/atoms/big-stat";
import { averagePercent, KIND_LABEL, schoolGradeLabel, type Aggregate, type UnifiedKind, type UnifiedRow } from "@/features/grades/unified/model";
import { KIND_SOLID } from "@/features/grades/unified/kind-color";
import { BarRow, DeltaBadge, KindPill, Panel, ScoreLine } from "./tab-parts";
import { TrendChart } from "./trend-chart";

type Href = (patch: Record<string, string>) => string;

function MoverList({ rows, href, empty }: { rows: UnifiedRow[]; href: Href; empty: string }) {
  if (!rows.length) return <p className="text-text-dim py-8 text-center text-sm">{empty}</p>;
  return <ul className="divide-line-faint divide-y">{rows.map((row) => <li key={row.key}>
    <Link href={href({ tab: "student", student: row.studentId })} className="hover:bg-bg-soft -mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm">
      <span className="min-w-0"><b className="block truncate">{row.name} <small className="text-text-dim font-normal">{schoolGradeLabel(row.school, row.grade)}</small></b>
        <span className="text-text-dim flex items-center gap-1.5 text-xs"><KindPill kind={row.kind} />{row.date.slice(5).replace("-", "/")}</span></span>
      <span className="flex shrink-0 flex-col items-end gap-1"><ScoreLine row={row} /><DeltaBadge row={row} /></span>
    </Link></li>)}</ul>;
}

/** 전체 현황 — 지표 5칸 · 학원 추이 · 시험 종류별 평균 · 하락/상승 학생. 숫자는 전부 대시보드와 같은 rows에서. */
export function OverviewTab({ rows, studentCount, academy, missingCount, href, scoped }: {
  rows: UnifiedRow[]; studentCount: number; academy: Aggregate | undefined; missingCount: number; href: Href; scoped: boolean;
}) {
  const ups = rows.filter((r) => (r.delta ?? 0) > 0);
  const downs = rows.filter((r) => (r.delta ?? 0) < 0);
  const kinds = (Object.keys(KIND_LABEL) as UnifiedKind[]).map((kind) => {
    const list = rows.filter((r) => r.kind === kind);
    return { kind, count: list.length, average: averagePercent(list) };
  }).filter((k) => k.count > 0);
  return <div className="space-y-4">
    <p className="text-text-dim text-xs"><SheetText value={scoped ? "담당 반 · " : ""} /><SheetText value={"선택한 기간·과목·시험의 기록이 있는 학생 기준입니다."} /></p>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <BigStat label="응시 학생" value={studentCount} unit="명" tone="blue" sub={`기록 ${rows.length}건`} />
      <BigStat label="평균 정답률" value={academy?.average ?? "—"} unit={academy?.average == null ? undefined : "%"} tone="primary" sub="만점 대비 맞힌 비율" />
      <BigStat label="상승" value={ups.length} unit="건" tone="green" sub="직전 같은 시험 대비" />
      <BigStat label="하락" value={downs.length} unit="건" tone="danger" sub="직전 같은 시험 대비" />
      <BigStat label="미입력" value={missingCount} unit="건" tone="amber"
        sub={missingCount ? <Link href={href({ tab: "records", missing: "1", page: "1" })} className="text-primary hover:underline"><SheetText value={"성적 현황에서 채우기 →"} /></Link> : "모두 입력됨"} />
    </div>
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <Panel title={scoped ? "담당 반 통합 추이" : "학원 통합 추이"} sub="월별 평균 정답률"><TrendChart points={academy?.points ?? []} /></Panel>
      <Panel title="시험 종류별 평균" sub="기록 수와 평균 정답률">
        {kinds.length ? <div className="space-y-1">{kinds.map((k) => <Link key={k.kind} href={href({ tab: "records", kind: k.kind, page: "1" })} className="block">
          <BarRow label={KIND_LABEL[k.kind]} sub={`${k.count}건`} value={k.average} bar={KIND_SOLID[k.kind]} /></Link>)}</div>
          : <p className="text-text-dim py-8 text-center text-sm"><SheetText value={"기록이 없습니다."} /></p>}
      </Panel>
    </div>
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="최근 성적 감소한 학생">
        <MoverList href={href} empty="하락 기록이 없습니다." rows={[...downs].sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 6)} />
      </Panel>
      <Panel title="최근 성적 증가한 학생">
        <MoverList href={href} empty="상승 기록이 없습니다." rows={[...ups].sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).slice(0, 6)} />
      </Panel>
    </div>
  </div>;
}
