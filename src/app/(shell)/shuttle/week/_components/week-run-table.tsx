import { WindowLink } from "@/components/workspace/window-link";
import { dayLabel, DIRECTION_LABEL, RUN_STOP_KIND_LABEL, runTimeRange, runTitle, type DayCode, type ShuttleRun } from "@/features/shuttle/types";
import type { RunWeek } from "@/features/shuttle/week-grid";

/**
 * 셔틀 주간 시간표의 **회차 표 하나** — 구글 시트 '7,8시하원' 탭 모양(원장 2026-10-08).
 * 줄 = 정류장(노선 순서·시각) · 칸 = 요일 · 칸 안 = 학생 이름 · 맨 아래 = 요일별 인원.
 *
 * 🔴 열 폭은 표마다 같게(`table-fixed` + colgroup) — 회차 표가 여러 개라 열이 어긋나면 훑어 읽을 수 없다
 *    (인쇄 노선표와 같은 이유, [[#97]]의 사촌).
 * 📱 폰에선 표가 넓으니 표만 가로로 밀린다(정류장 열은 왼쪽에 고정) — 화면 전체가 가로로 밀리지 않게.
 * ⚠️ 서버 컴포넌트(순수 프레젠테이션) — 편집은 '노선 편성' 화면에서 한다.
 */
export function WeekRunTable({ run, vehicleName, days, week }: { run: ShuttleRun; vehicleName: string; days: DayCode[]; week: RunWeek }) {
  const range = runTimeRange(run.stops);
  return (
    <section className="bg-card shadow-card overflow-hidden rounded-2xl">
      <header className="border-line flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${run.direction === "in" ? "bg-blue-soft text-blue" : "bg-amber-soft text-amber"}`}>
          {DIRECTION_LABEL[run.direction]}
        </span>
        <h3 className="text-foreground text-base font-bold">
          {vehicleName} · {runTitle(run)}
        </h3>
        {range ? <span className="num text-text-dim text-sm">{range}</span> : null}
        <span className="text-text-dim ml-auto text-sm">
          배정 <b className="num text-foreground">{week.total}</b>명
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[11rem]" />
            <col className="w-[4.5rem]" />
            {days.map((d) => (
              <col key={d} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-bg-soft">
              <th className="bg-bg-soft border-line sticky left-0 z-10 border-b px-3 py-2 text-left font-bold">정류장</th>
              <th className="border-line border-b px-2 py-2 text-center font-bold">시각</th>
              {days.map((d) => (
                <th key={d} className="border-line border-b border-l px-2 py-2 text-center font-bold">
                  {dayLabel(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {week.rows.map((row) => {
              const fixed = row.kind !== "stop";
              return (
                <tr key={row.key} className={fixed ? "bg-bg-soft/60" : undefined}>
                  <th
                    scope="row"
                    className={`border-line sticky left-0 z-10 border-b px-3 py-2 text-left align-top font-medium break-keep ${fixed ? "bg-bg-soft text-text-dim" : "bg-card text-foreground"}`}
                  >
                    {fixed ? RUN_STOP_KIND_LABEL[row.kind] : row.name}
                  </th>
                  <td className="num text-text-dim border-line border-b px-2 py-2 text-center align-top">{row.time ?? "—"}</td>
                  {days.map((d) => (
                    <td key={d} className="border-line border-b border-l px-2 py-1.5 align-top">
                      <ul className="flex flex-col gap-0.5">
                        {row.cells[d].map((r) => (
                          <li key={r.id} className={r.inactive ? "opacity-50" : undefined}>
                            <WindowLink href={`/students/${r.studentId}`} title={r.name} className="text-foreground font-medium hover:underline">
                              {r.name}
                            </WindowLink>
                            {r.crossTag ? <span className="text-amber ml-1 text-xs font-bold">{r.crossTag}</span> : null}
                            {r.inactive ? <span className="text-text-faint ml-1 text-xs">재원 아님</span> : null}
                          </li>
                        ))}
                      </ul>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-bg-soft">
              <th className="bg-bg-soft sticky left-0 z-10 px-3 py-2 text-left font-bold">인원</th>
              <td />
              {days.map((d) => (
                <td key={d} className="num border-line border-l px-2 py-2 text-center font-bold">
                  {week.counts[d]}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
