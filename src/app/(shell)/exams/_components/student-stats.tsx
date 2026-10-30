import { BigStat } from "@/components/atoms/big-stat";
import { averagePercent, scorePercent, scoreUnit, type UnifiedRow } from "@/features/grades/unified/model";

/**
 * 한 학생의 성적 지표 4칸 — 통합 성적관리 '학생 추이'와 학생 상세 '성적' 탭이 **같은 부품**을 쓴다
 * (원장 2026-09-24 *"꼼꼼히 배선해서 모든 면에서 일치"* — 두 화면이 같은 학생을 다른 숫자로 말하지 않게).
 * 한 시험 점수는 기록할 때 정한 단위(개·점), 평균은 정답률(%). `rows`는 최신순.
 */
export function StudentGradeStats({ rows, subjectLabelOf }: {
  rows: readonly UnifiedRow[];
  /** 주면 '최근 시험' 칸에 과목을 붙인다(원장 2026-10-30 "영어인지, 수학인지 과목표시가 되지 않고 있음"). */
  subjectLabelOf?: (key: string) => string;
}) {
  const latest = rows[0];
  const avg = averagePercent(rows);
  const hasLatest = latest?.score != null && latest.maxScore != null;
  return <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
    <BigStat label="시험 기록" value={rows.length} unit="건" tone="blue" sub={`점수 있는 기록 ${rows.filter((r) => scorePercent(r) != null).length}건`} />
    <BigStat label="평균 정답률" value={avg ?? "—"} unit={avg == null ? undefined : "%"} tone="primary" sub="만점 대비 맞힌 비율" />
    <BigStat label="최근 시험" value={hasLatest ? `${latest.score} / ${latest.maxScore}` : "—"}
      unit={hasLatest ? scoreUnit(latest) : undefined} tone="purple" sub={latest ? `${latest.date}${subjectLabelOf ? ` · ${subjectLabelOf(latest.subject)}` : ""}` : "기록 없음"} />
    <BigStat label="최근 변화" value={latest?.delta == null ? "—" : `${latest.delta > 0 ? "+" : ""}${latest.delta}`}
      unit={latest?.delta == null ? undefined : latest.deltaUnit} tone={latest?.delta == null ? "neutral" : latest.delta >= 0 ? "green" : "danger"} sub="직전 같은 시험 대비" />
  </div>;
}
