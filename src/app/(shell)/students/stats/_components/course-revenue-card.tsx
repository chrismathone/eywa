import { correlationWord, type CourseRevenueSummary } from "@/features/students/stats/course-revenue";
import { StatCard } from "./stat-card";

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
const ym = (k: string) => `${k.slice(0, 4)}년 ${Number(k.slice(5))}월`;

/**
 * 원생 통계 '과목 수와 매출'(원장 2026-10-30 *"과목이 늘어나면 매출이 느는지 상관관계를 알아볼 필요있음"*) — 계산은 `course-revenue.ts`.
 * 첫 줄 = 학생당 강좌 수가 늘 때 학생당 수업료가 얼마나 느는가(학생 수 효과를 뺀 값) · 총량 상관은 참고로 아래에. 수납 권한이 있을 때만 선다.
 */
export function CourseRevenueCard({ summary }: { summary: CourseRevenueSummary }) {
  const { perStudent, total } = summary;
  const range = summary.from && summary.to ? ` · ${ym(summary.from)}~${ym(summary.to)} · ${summary.months}개월` : "";
  return (
    <StatCard id="course-revenue" title="과목 수와 매출" note={`지난 기록 월별 집계${range} · 학생 = 그달 수업료가 청구된 학생 · 매출 = 수업료 수납`}>
      {summary.months < 3 ? (
        <p className="text-muted-foreground text-sm">견줄 달이 부족합니다.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm break-keep">
            학생당 강좌 수가 <b>0.1개</b> 늘 때 학생당 수업료가{" "}
            <b className="num">{perStudent.per01 === null ? "—" : `월 약 ${won(Math.abs(perStudent.per01))} 함께 ${perStudent.per01 >= 0 ? "늘었습니다" : "줄었습니다"}`}</b>.
            <span className="text-muted-foreground ml-1">
              상관계수 <span className="num">{perStudent.r === null ? "—" : perStudent.r.toFixed(2)}</span> · {correlationWord(perStudent.r)}
            </span>
          </p>
          <p className="text-muted-foreground text-xs break-keep">
            참고 — 강좌 수 합계와 수업료 합계의 상관은 <span className="num">{total.r === null ? "—" : total.r.toFixed(2)}</span>입니다. 이 값은 학생 수가 늘고 준
            효과가 섞여 늘 높게 나오므로, 위의 학생당 값으로 판단합니다.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-line border-b text-xs">
                <th className="py-1.5 text-left font-medium">연도</th>
                <th className="py-1.5 text-right font-medium">학생당 강좌</th>
                <th className="py-1.5 text-right font-medium">학생당 수업료(월)</th>
                <th className="py-1.5 text-right font-medium">강좌당 수업료(월)</th>
              </tr>
            </thead>
            <tbody className="num">
              {summary.yearly.map((y) => (
                <tr key={y.year} className="border-line-faint border-b last:border-0">
                  <td className="py-1.5">{y.year}년<span className="text-muted-foreground ml-1 text-xs">{y.months}개월</span></td>
                  <td className="py-1.5 text-right">{y.coursesPerStudent.toFixed(2)}개</td>
                  <td className="py-1.5 text-right">{won(y.revenuePerStudent)}</td>
                  <td className="py-1.5 text-right">{won(y.revenuePerCourse)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-muted-foreground text-xs break-keep">
            강좌 = 그달 과목마다 수업료가 청구된 학생 수의 합(영어를 가른 지점은 인재원 영어 · EiE 따로) · 이번 달은 수납이 끝나지 않아 뺍니다. 수업료는 해마다 단가가 바뀌어
            상관만으로 원인을 단정할 수 없습니다.
            {summary.excluded.length ? ` 청구 방식이 바뀌었거나 수업료가 몰린 달(${summary.excluded.map(ym).join(" · ")})은 뺐습니다.` : ""}
          </p>
        </div>
      )}
    </StatCard>
  );
}
