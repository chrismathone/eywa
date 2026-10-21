import { axisLabel, withDeltas, type Point, type TrendRange } from "@/features/students/stats/model";

const fmt = (n: number) => n.toLocaleString("ko-KR");
const signed = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${fmt(n)}`);

/**
 * 재원생 추이 수치 표 — 최근이 위. 그래프에 켜 둔 선(과목·수강 구성)이 칸으로 붙는다(`values`는 학원 전체 점과 같은 순서 ·
 * 셀 수 없는 칸은 null = '—'). 기본은 접혀 있다(그래프가 먼저). 정렬 = 날짜는 가운데, 숫자는 오른쪽(제목도 같은 쪽).
 */
export function TrendTable({
  range,
  total,
  lines,
  totalLabel,
}: {
  range: TrendRange;
  total: readonly Point[];
  lines: { label: string; values: readonly (number | null)[] }[];
  totalLabel: string;
}) {
  const rows = withDeltas(total)
    .map((p, i) => ({ p, i }))
    .reverse();
  const cell = "px-2 py-1.5";
  return (
    <details>
      <summary className="text-primary cursor-pointer text-sm font-medium select-none">수치 표 보기</summary>
      <div className="mt-2 overflow-x-auto px-1">
        <table className="w-full min-w-[320px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
          <thead>
            <tr className="border-line text-muted-foreground border-b text-xs">
              <th className={`${cell} text-center font-medium`}>{range === "w26" ? "주" : range === "y" ? "연도" : "달"}</th>
              <th className={`${cell} text-right font-medium`}>{totalLabel}</th>
              <th className={`${cell} text-right font-medium`}>직전 대비</th>
              {lines.map((l) => (
                <th key={l.label} className={`${cell} text-right font-medium`}>{l.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="num">
            {rows.map(({ p, i }) => (
              <tr key={p.key} className="border-line-faint border-b">
                <td className={`${cell} text-center`}>{axisLabel(p, range)}</td>
                <td className={`${cell} text-right font-bold`}>{fmt(p.count)}</td>
                <td className={`${cell} text-right ${p.delta !== null && p.delta < 0 ? "text-danger" : ""}`}>{signed(p.delta)}</td>
                {lines.map((l) => {
                  const v = l.values[i];
                  return (
                    <td key={l.label} className={`${cell} text-right`}>
                      {v === null || v === undefined ? "—" : fmt(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
