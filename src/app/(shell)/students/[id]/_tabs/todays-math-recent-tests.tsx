import { SheetText } from "@/features/teacher-view/interface-label";
import { recentTestKindLabel, type StudentMathRecentTest } from "@/features/integrations/todays-math/student-status";

// 점수는 오늘 수학이 채점한 값 그대로다(배점 합). 결시 · 채점 전은 점수 칸을 비우지 않고 말로 적는다 — 0점과 섞이면 안 된다.
function ResultCell({ test }: { test: StudentMathRecentTest }) {
  const r = test.result;
  if (!r) return <span className="text-text-dim"><SheetText value={"채점 전"} /></span>;
  if (r.absent) return <span className="text-text-dim"><SheetText value={"결시"} /></span>;
  const score = r.score === null ? null : `${Number.isInteger(r.score) ? r.score : r.score.toFixed(1)}점`;
  const correct = r.correctCount !== null && test.questionCount > 0 ? `${test.questionCount}문제 중 ${r.correctCount}개 맞음` : null;
  if (!score && !correct) return <span className="text-text-dim"><SheetText value={"점수 없음"} /></span>;
  return <span className="whitespace-nowrap">
    {score ? <span className="font-semibold">{score}</span> : null}
    {score && correct ? <span className="text-text-dim"> · </span> : null}
    {correct ? <span className="text-text-dim">{correct}</span> : null}
  </span>;
}

export function TodaysMathRecentTests({ tests }: { tests: StudentMathRecentTest[] }) {
  return <section className="bg-card border-line rounded-xl border">
    <h3 className="border-line border-b px-5 py-3 text-sm font-semibold"><SheetText value={"최근 시험"} /></h3>
    {tests.length === 0
      ? <p className="text-text-dim px-5 py-4 text-sm"><SheetText value={"아직 배정된 시험이 없어요."} /></p>
      : <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-line bg-bg-soft/40 border-b [&_th]:whitespace-nowrap">
            <tr>
              <th className="micro px-4 py-2 text-center"><SheetText value={"날짜"} /></th>
              <th className="micro px-4 py-2 text-left"><SheetText value={"시험"} /></th>
              <th className="micro px-4 py-2 text-left"><SheetText value={"반"} /></th>
              <th className="micro px-4 py-2 text-left"><SheetText value={"결과"} /></th>
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {tests.map((t) => <tr key={t.testId} className="align-top">
              <td className="num text-muted-foreground px-4 py-2 text-center text-xs whitespace-nowrap">{t.testDate}</td>
              <td className="px-4 py-2 text-xs break-keep">
                <span className="text-text-dim"><SheetText value={recentTestKindLabel(t.kind)} /></span>
                {t.title || t.unitName ? <span className="ml-1.5">{t.title ?? t.unitName}</span> : null}
              </td>
              <td className="px-4 py-2 text-xs break-keep">{t.className || "—"}</td>
              <td className="px-4 py-2 text-xs"><ResultCell test={t} /></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
  </section>;
}
