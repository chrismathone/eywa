import { comparison, counts, type MonthHistory } from "@/features/visitor-history/model";

export function MonthTable({ year, today, history, errors, selected, onSelect }: {
  year: number; today: string; history: Record<string, MonthHistory>; errors: Record<string, string>;
  selected: string; onSelect: (month: string) => void;
}) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const full = months.flatMap(m => history[m]?.complete && m < today.slice(0, 7) ? [history[m]] : []);
  const peak = full.length === 12 && new Set(full.map(m => m.scope)).size === 1
    ? [...full].sort((a, b) => counts(b).active - counts(a).active)[0] : null;
  const max = Math.max(1, ...months.flatMap(m => [history[m], history[`${year - 1}${m.slice(4)}`]])
    .filter((v): v is MonthHistory => !!v?.complete).map(m => counts(m).active));
  return <section className="space-y-2" aria-label="월별 예약 추이">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="font-semibold">{year}년 월별 기록 <span className="text-sm font-normal text-muted-foreground">/ 전년 같은 달</span></h2>
      <p className="text-sm text-muted-foreground">{peak && counts(peak).active > 0
        ? `기록이 가장 많은 달: ${Number(peak.month.slice(5))}월 (${counts(peak).active}건, 동률이면 먼저 온 달)`
        : "연중 최다 월은 지난 연도의 12개월 조회 후 표시합니다."}</p>
    </div>
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[820px] text-sm">
        <thead className="bg-muted/50 text-left"><tr>
          {["월", "집계 예약", "전년 예약", "전년 대비", "상담", "입테·입학테스트", "테스트", "취소", "확인 대기", "조회 상태"].map(h =>
            <th key={h} className="whitespace-nowrap px-3 py-3 font-medium">{h}</th>)}
        </tr></thead>
        <tbody>{months.map(month => {
          const data = history[month], prior = history[`${year - 1}${month.slice(4)}`], c = data && counts(data);
          const closed = month < today.slice(0, 7);
          return <tr key={month} className={`border-t ${selected === month ? "bg-primary/5" : ""}`}>
            <td className="whitespace-nowrap px-3 py-3"><button className="text-primary underline underline-offset-4" aria-pressed={selected === month}
              onClick={() => onSelect(month)}>{Number(month.slice(5))}월{!closed ? (month === today.slice(0, 7) ? " (진행)" : " (예정)") : ""}</button></td>
            <td className="px-3 py-3"><div className="flex items-center gap-2">
              <span className="min-w-6 font-semibold tabular-nums">{data?.complete ? c?.active : "—"}</span>
              {data?.complete && <span className="h-1.5 bg-primary/70" style={{ width: `${counts(data).active / max * 64}px` }} aria-hidden="true" />}
            </div></td>
            <td className="px-3 py-3 tabular-nums">{prior?.complete ? counts(prior).active : "—"}</td>
            <td className="px-3 py-3">{comparison(data, prior, today)}</td>
            {(["consultation", "entrance", "test", "cancelled", "review"] as const).map(k =>
              <td key={k} className="px-3 py-3 tabular-nums">{data?.complete ? c?.[k] : "—"}</td>)}
            <td className="px-3 py-3 text-muted-foreground">{errors[month] ? "조회 실패" : !data ? "미조회" : data.complete ? "조회 완료" : "일부 조회"}
              {!!data?.sources.some(s => s.unclassified) && <span className="block text-xs">제목·날짜 확인 불가 {data.sources.reduce((n, s) => n + s.unclassified, 0)}건</span>}
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    <p className="text-xs text-muted-foreground">월을 누르면 아래에서 원본 예약을 확인할 수 있습니다. 비교는 같은 조사 캘린더 기준입니다.</p>
  </section>;
}
