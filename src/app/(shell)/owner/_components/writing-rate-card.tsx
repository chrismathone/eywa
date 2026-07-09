// 원장 보고서 관리 > 강사별 주간 작성률(5단계-2 Part B) — 최근 7일 작성 건수 + 오늘 작성률·미작성.
// 순수 표시(상호작용 없음) → 서버 컴포넌트로 렌더 가능.
import type { WritingRatesView } from "@/features/report-admin/server/queries";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

function weekdayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return WEEKDAY[new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay()] ?? "";
}

function rateTone(rate: number | null): string {
  if (rate == null) return "text-text-faint";
  if (rate >= 90) return "text-primary";
  if (rate >= 60) return "text-amber";
  return "text-danger";
}

function nameList(names: string[], max = 4): string {
  const head = names.slice(0, max).join("·");
  return names.length > max ? `${head} 외 ${names.length - max}` : head;
}

export function WritingRateCard({ view }: { view: WritingRatesView }) {
  const { dates, rates } = view;
  return (
    <section className="bg-card border-line shadow-card rounded-lg border px-5 py-4">
      <div className="mb-3">
        <h2 className="text-foreground text-[15px] font-semibold">강사별 작성률</h2>
        <p className="text-text-faint text-[12px]">최근 7일 작성 건수 · 오늘 대상 대비 작성률(결석 제외)</p>
      </div>

      {rates.length === 0 ? (
        <p className="text-text-faint text-[13px]">최근 작성 기록이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-[12px]">
            <thead>
              <tr className="border-line text-text-faint border-b">
                <th className="px-3 py-2 font-semibold">강사</th>
                <th className="px-3 py-2 text-center font-semibold">오늘</th>
                {dates.map((d) => (
                  <th key={d} className="px-2 py-2 text-center font-semibold" title={d}>
                    {weekdayOf(d)}
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-semibold">주간</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.teacher} className="border-line border-b last:border-b-0 align-top">
                  <td className="px-3 py-2">
                    <span className="text-foreground font-semibold">{r.teacher}</span>
                    {r.todayMissing.length > 0 ? (
                      <p className="text-danger mt-0.5 text-[11px]">미작성: {nameList(r.todayMissing)}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.todayRate == null ? (
                      <span className="text-text-faint text-[11px]">수업 없음</span>
                    ) : (
                      <span className={`font-bold ${rateTone(r.todayRate)}`}>
                        {r.todayRate}%
                        <span className="text-text-faint ml-1 font-normal">
                          {r.todayWritten}/{r.todayTarget}
                        </span>
                      </span>
                    )}
                  </td>
                  {r.daily.map((d) => (
                    <td
                      key={d.date}
                      className={`px-2 py-2 text-center tabular ${d.count > 0 ? "text-text-dim" : "text-text-faint"}`}
                    >
                      {d.count > 0 ? d.count : "·"}
                    </td>
                  ))}
                  <td className="text-foreground px-3 py-2 text-center font-semibold tabular">{r.weekTotal}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
