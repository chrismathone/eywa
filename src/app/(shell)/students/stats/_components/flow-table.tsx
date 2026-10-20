import type { FlowRow } from "@/features/students/stats/model";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const signed = (n: number) => `${n > 0 ? "+" : ""}${fmt(n)}`;
const monthLabel = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;

/**
 * 월별 기록 표 — 최근 달이 위. 말일 재원생과 그 증감은 재원생 추이와 같은 값(강사 범위면 칸이 없다).
 * ⚠️ '재원생 증감'은 말일 재원생의 차이라 '순증(등록 − 퇴원)'과 다를 수 있다(수업 시작 전 학생·휴원 등) — 표 아래에 적는다.
 */
export function FlowTable({ rows, monthEnd }: { rows: readonly FlowRow[]; monthEnd: Record<string, number> | null }) {
  const cell = "px-2 py-1.5";
  const ordered = [...rows].reverse();
  return (
    <details open>
      <summary className="text-primary cursor-pointer text-sm font-medium select-none">월별 표</summary>
      <div className="mt-2 overflow-x-auto px-1">
        <table className="w-full min-w-[360px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
          <thead>
            <tr className="border-line text-muted-foreground border-b text-xs">
              <th className={`${cell} text-center font-medium`}>달</th>
              <th className={`${cell} text-right font-medium`}>등록</th>
              <th className={`${cell} text-right font-medium`}>퇴원</th>
              <th className={`${cell} text-right font-medium`}>순증</th>
              {monthEnd ? <th className={`${cell} text-right font-medium`}>말일 재원생</th> : null}
              {monthEnd ? <th className={`${cell} text-right font-medium`}>재원생 증감</th> : null}
            </tr>
          </thead>
          <tbody className="num">
            {ordered.map((r, i) => {
              const net = r.enrolled - r.withdrawn;
              const end = monthEnd?.[r.month];
              const prevMonth = ordered[i + 1]?.month;
              const prev = prevMonth ? monthEnd?.[prevMonth] : undefined;
              const change = end !== undefined && prev !== undefined ? end - prev : null;
              return (
                <tr key={r.month} className="border-line-faint border-b">
                  <td className={`${cell} text-center whitespace-nowrap`}>{monthLabel(r.month)}</td>
                  <td className={`${cell} text-right`}>{fmt(r.enrolled)}</td>
                  <td className={`${cell} text-right`}>{fmt(r.withdrawn)}</td>
                  <td className={`${cell} text-right font-bold ${net < 0 ? "text-danger" : ""}`}>{signed(net)}</td>
                  {monthEnd ? <td className={`${cell} text-right`}>{end === undefined ? "—" : fmt(end)}</td> : null}
                  {monthEnd ? <td className={`${cell} text-right ${change !== null && change < 0 ? "text-danger" : ""}`}>{change === null ? "—" : signed(change)}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {monthEnd ? (
        <p className="text-muted-foreground mt-1 text-xs break-keep">
          재원생 증감은 말일 재원생의 차이라 순증(등록 − 퇴원)과 다를 수 있습니다 — 등록했지만 아직 수업을 시작하지 않은 학생, 휴원생은 재원생에서 빠집니다.
        </p>
      ) : null}
    </details>
  );
}
