import { ContributionLink as Link } from "./student-contribution-scope";
import { FamilyLoyaltyCard } from "./family-loyalty-card";
import { familyBonus, loyaltyTotal } from "../model/family-loyalty";
import { Suspense } from "react";
import { RelativeScorePanel } from "./relative-score-panel";
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
  if (!data) return <p>충성도 기록을 열람할 수 없습니다.</p>;
  if (!data.ready || !data.months.length) return <div className="w-full space-y-5">
    <FamilyLoyaltyCard family={data.family} config={data.settings.config} studentId={studentId} />
    <div className="rounded-xl border border-line p-12 text-center"><p className="font-semibold">아직 집계된 기록이 없습니다.</p><p className="mt-2 text-sm">첫 집계가 끝나면 점수와 계산 근거가 표시됩니다.</p><Link href="/student-contribution" className="mt-5 inline-block text-sm text-primary underline">원생 충성도 목록으로</Link></div></div>;
  const config = data.settings.config, current = kstMonth(), since = shiftMonth(current, -11);
  const total = sumRaws(data.months.flatMap((m) => [m.raws, m.correction])), scored = scoreRaws(total, config);
  const loyalty = loyaltyTotal(scored.total, data.family, config), bonus = familyBonus(data.family, config);
  const selected = data.months.find((m) => m.month === month) ?? data.months.at(-1)!;
  const trend = contributionTrend(data.months, config, current), point = trend.find((p) => p.month === selected.month)!;
  const recent = scoreBetween(data.months, config, since, "9999-12").total;
  const through = rawsBetween(data.months, "0000-01", selected.month);
  const pending = data.months.at(-1)!.unavailable.length;
  const cells: [string, string, string][] = [["기존 활동 누적", numberText(scored.total), `운영 ${numberText(scored.operations)} · 학습·참여 ${numberText(scored.participation)}점`],
    ["가족 동시 재원 가점", bonus === null ? "확인 대기" : signedText(bonus), "현재 가족 상태에 한 번만 가산"],
    ["최근 12개월 활동", signedText(recent), `${monthText(since)}부터의 증감 · 이번 달 집계분 포함`]];
  return <div className="@container w-full min-w-0 space-y-5">
    <h2 className="sr-only">월별 충성도</h2>
    {(data.withheld > 0 || data.identityIssues > 0) && <p role="status" className="rounded-lg bg-primary-softer px-4 py-3 text-sm">현재 원문이나 학생 연결을 확인할 수 없는 근거는 표시하지 않습니다. 마감한 실적과 점수는 그대로 보존됩니다.</p>}
    {/* 좁으면 세 칸을 '이름 … 값' 한 줄씩(긴 값도 잘리지 않게), 넓으면 3열 → 누적과 한 줄 4칸. */}
    <section className="grid grid-cols-1 overflow-hidden rounded-xl border border-line @2xl:grid-cols-3 @4xl:grid-cols-[1.3fr_1fr_1fr_1fr]" aria-label="충성도 점수 요약">
      <div className="bg-primary px-5 py-4 text-primary-foreground @2xl:col-span-3 @4xl:col-span-1 @4xl:px-6 @4xl:py-5"><h3 className="text-sm font-medium">충성도 점수</h3><p className="mt-1 text-4xl font-bold tracking-tight tabular-nums @4xl:mt-2">{loyalty === null ? "확인 대기" : numberText(loyalty)}<span className="ml-2 text-base font-normal">점</span></p><p className="mt-2 text-xs @4xl:mt-3">활동 누적 + 현재 가족 가점 · 100점 만점 아님</p></div>
      {cells.map(([label, value, note], i) => <div key={label} className={`flex min-w-0 items-baseline justify-between gap-3 border-t border-line px-5 py-2.5 @2xl:block @2xl:py-4 @4xl:border-t-0 @4xl:px-6 @4xl:py-5 ${i ? "@2xl:border-l" : "@4xl:border-l"}`}>
        <h3 className="text-sm font-medium">{label}</h3><p className="whitespace-nowrap text-lg font-bold tabular-nums @2xl:mt-1 @2xl:text-xl @4xl:mt-2 @4xl:text-2xl">{value}<span className="ml-1 text-xs font-normal @4xl:text-sm">점</span></p><p className="mt-2 hidden text-xs @2xl:block">{note}</p></div>)}
    </section>
    <FamilyLoyaltyCard family={data.family} config={config} studentId={studentId} />
    <Suspense fallback={<p role="status" className="rounded-xl border border-line p-6 text-sm">다른 재원생과 비교한 위치를 불러오고 있습니다…</p>}>
      <RelativeScorePanel studentId={studentId} total={loyalty} recent={recent} revision={data.settings.revision} refreshedAt={data.settings.refreshedAt} />
    </Suspense>
    <details className="rounded-lg border border-line px-4 py-3 text-xs leading-relaxed">
      <summary className="cursor-pointer font-medium">학습·참여 점수는 언제 반영되나요?</summary>
      <div className="mt-2 space-y-1.5">
        <p>주간 개근은 월요일~일요일의 예정된 수업에 모두 출석했을 때 인정합니다. 끝난 주부터 집계하며, 일요일이 속한 달에 한 번 반영합니다.</p>
        <p>영상 숙제는 배정된 숙제에 제출 영상이 하나 이상 확인되면 숙제당 1회 인정합니다. 같은 숙제에 영상이 여러 개여도 한 번만 계산하며, 월말까지 기다리지 않고 다음 집계에 반영합니다.</p>
        <p>2026년부터 확인 가능한 기록으로 계산합니다. 이전 월 단위 실적은 새 실적과 중복 계산하지 않으며, 마감한 달의 새 기준 실적은 이번 달 정정에서 확인할 수 있습니다.</p>
        <p>월말평가와 긍정 신호도 항목별로 한 달에 1회 인정하며, 점수는 현재 배점을 적용합니다.</p>
        <Link href={`/students/${studentId}?tab=homework-videos`} className="inline-block text-primary underline underline-offset-4">숙제 영상 확인</Link>
      </div>
    </details>
    <StudentDetailTabs evidenceNote={`${monthText(selected.month)}의 원수치·현재 배점·계산식과 근거 기록입니다. 달을 바꾸면 추이 탭의 선택도 같이 바뀝니다.`}
      summary={<>
        {!!pending && <p className="rounded-lg bg-primary-softer px-4 py-3 text-sm">{pending}개 항목은 확인하지 못한 자료가 있어 현재 확인된 실적만 반영했습니다. 가장 최근 달의 계산 근거에서 항목별 이유를 확인할 수 있습니다.</p>}
        <p className="text-sm text-text-dim">아래 월별 추이와 계산 근거는 기존 활동 실적입니다. 현재 가족 가점은 상단 충성도 점수에만 적용하며 과거 달에 소급 누적하지 않습니다.</p>
        <ScoreTrend key={studentId} points={trend} studentId={studentId} selectedMonth={selected.month} />
        <ScoreBreakdown raws={total} config={config} />
      </>}
      evidence={<ContributionEvidence selected={selected} months={data.months.map((m) => m.month)} through={through} point={point} config={config}
        withheld={data.withheld} signals={data.signals} canWrite={data.gate.canWrite} studentId={studentId} />} />
  </div>;
}
