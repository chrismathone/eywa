import { EmbedLink as Link } from "@/components/embed-link";
import { kstMonth, shiftMonth } from "@/lib/date-kst";
import { getContributionStudent } from "../server/student-query";
import { sumRaws, scoreRaws } from "../model/calc";
import { contributionTrend, rawsBetween, scoreBetween } from "../model/score-trend";
import { ScoreTrend } from "./score-trend";
import { ScoreBreakdown } from "./score-breakdown";
import { StudentDetailTabs } from "./student-detail-tabs";
import { ContributionEvidence } from "./contribution-evidence";
import { numberText, monthText, signedText } from "./presentation";

export async function ContributionStudentPanel({ studentId, month }: { studentId: string; month?: string }) {
  const data = await getContributionStudent(studentId, month);
  if (!data) return <p>기여도 기록을 열람할 수 없습니다.</p>;
  if (!data.ready || !data.months.length) return <div className="w-full space-y-5">
    <div className="rounded-xl border border-line p-12 text-center"><p className="font-semibold">아직 집계된 기록이 없습니다.</p><p className="mt-2 text-sm">첫 집계가 끝나면 점수와 계산 근거가 표시됩니다.</p><Link href="/student-contribution" className="mt-5 inline-block text-sm text-primary underline">원생 기여도 목록으로</Link></div></div>;
  const config = data.settings.config, current = kstMonth(), since = shiftMonth(current, -11);
  const total = sumRaws(data.months.flatMap((m) => [m.raws, m.correction])), scored = scoreRaws(total, config);
  const selected = data.months.find((m) => m.month === month) ?? data.months.at(-1)!;
  const trend = contributionTrend(data.months, config, current), point = trend.find((p) => p.month === selected.month)!;
  const recent = scoreBetween(data.months, config, since, "9999-12").total;
  const through = rawsBetween(data.months, "0000-01", selected.month);
  const pending = data.months.at(-1)!.unavailable.length;
  const cells: [string, string, string][] = [["운영 기여", numberText(scored.operations), "소개 · 수업료 · 수강 기간"],
    ["학습·참여", numberText(scored.participation), "출결 · 영상 숙제 · 평가 · 긍정 신호"],
    ["최근 12개월", signedText(recent), `${monthText(since)}부터의 증감 · 이번 달 집계분 포함`]];
  return <div className="@container w-full min-w-0 space-y-5">
    <h2 className="sr-only">월별 기여도</h2>
    {(data.withheld > 0 || data.identityIssues > 0) && <p role="status" className="rounded-lg bg-primary-softer px-4 py-3 text-sm">현재 원문이나 학생 연결을 확인할 수 없는 근거는 표시하지 않습니다. 마감한 실적과 점수는 그대로 보존됩니다.</p>}
    {/* 좁으면 세 칸을 '이름 … 값' 한 줄씩(긴 값도 잘리지 않게), 넓으면 3열 → 누적과 한 줄 4칸. */}
    <section className="grid grid-cols-1 overflow-hidden rounded-xl border border-line @2xl:grid-cols-3 @4xl:grid-cols-[1.3fr_1fr_1fr_1fr]" aria-label="누적 기여도 요약">
      <div className="bg-primary px-5 py-4 text-primary-foreground @2xl:col-span-3 @4xl:col-span-1 @4xl:px-6 @4xl:py-5"><h3 className="text-sm font-medium">누적 기여도</h3><p className="mt-1 text-4xl font-bold tracking-tight tabular-nums @4xl:mt-2">{numberText(scored.total)}<span className="ml-2 text-base font-normal">점</span></p><p className="mt-2 text-xs @4xl:mt-3">현재 배점 기준 · 점수 상한 없음</p></div>
      {cells.map(([label, value, note], i) => <div key={label} className={`flex min-w-0 items-baseline justify-between gap-3 border-t border-line px-5 py-2.5 @2xl:block @2xl:py-4 @4xl:border-t-0 @4xl:px-6 @4xl:py-5 ${i ? "@2xl:border-l" : "@4xl:border-l"}`}>
        <h3 className="text-sm font-medium">{label}</h3><p className="whitespace-nowrap text-lg font-bold tabular-nums @2xl:mt-1 @2xl:text-xl @4xl:mt-2 @4xl:text-2xl">{value}<span className="ml-1 text-xs font-normal @4xl:text-sm">점</span></p><p className="mt-2 hidden text-xs @2xl:block">{note}</p></div>)}
    </section>
    <StudentDetailTabs evidenceNote={`${monthText(selected.month)}의 원수치·현재 배점·계산식과 근거 기록입니다. 달을 바꾸면 추이 탭의 선택도 같이 바뀝니다.`}
      summary={<>
        {!!pending && <p className="rounded-lg bg-primary-softer px-4 py-3 text-sm">{pending}개 항목은 확인하지 못한 자료가 있어 현재 확인된 실적만 반영했습니다. 가장 최근 달의 계산 근거에서 항목별 이유를 확인할 수 있습니다.</p>}
        <ScoreTrend key={studentId} points={trend} studentId={studentId} selectedMonth={selected.month} />
        <ScoreBreakdown raws={total} config={config} />
      </>}
      evidence={<ContributionEvidence selected={selected} months={data.months.map((m) => m.month)} through={through} point={point} config={config}
        withheld={data.withheld} signals={data.signals} canWrite={data.gate.canWrite} studentId={studentId} />} />
  </div>;
}
