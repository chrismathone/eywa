import type { FlowRow } from "@/features/students/stats/model";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const signed = (n: number) => `${n > 0 ? "+" : ""}${fmt(n)}`;
const monthLabel = (m: string) => `${m.slice(0, 4)}년 ${Number(m.slice(5, 7))}월`;

/**
 * 월별 기록 표 — 최근 달이 위. 말일 재원생과 그 증감은 재원생 추이와 같은 값(강사 범위면 칸이 없다).
 * ⚠️ '재원생 증감'은 말일 재원생의 차이라 '순증(등록 − 퇴원)'과 다를 수 있다(수업 시작 전 학생·휴원 · 장부 정리 — 퇴원 칸엔 없고
 *    재원생엔 청구가 살아 있는 달에만 든다, 원장 2026-10-20) — 표 아래에 적는다.
 */
export function FlowTable({ rows, monthEnd, started }: { rows: readonly FlowRow[]; monthEnd: Record<string, number> | null; started: string | null }) {
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
      {started || monthEnd ? (
        <p className="text-muted-foreground mt-1 text-xs break-keep">
          {started ? `${started} 셉니다(등록한 뒤 수업료 청구·출석이 있거나 반 수업을 일주일 넘게 다닌 학생 — 상담만 하고 자료로 등록된 사람, 직전 두 달에 청구가 있던(등록일만 고쳐진) 재원생은 뺍니다). ` : ""}
          {monthEnd
            ? "재원생 증감은 말일 재원생의 차이라 순증(등록 − 퇴원)과 다를 수 있습니다 — 등록했지만 아직 수업을 시작하지 않은 학생, 휴원생은 재원생에서 빠집니다. 사유 없이 한꺼번에 정리한 퇴원(장부 정리)은 퇴원 칸에 넣지 않고, 재원생에는 수강료 청구가 살아 있는 달에만 셉니다(청구 기록이 시작되기 전 달은 퇴원일까지)."
            : ""}
        </p>
      ) : null}
    </details>
  );
}
