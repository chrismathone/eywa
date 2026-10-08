import { Fragment } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { dayLabel, DIRECTION_LABEL, RUN_STOP_KIND_LABEL, runShortTitle, runTimeRange, type DayCode, type ShuttleRun } from "@/features/shuttle/types";
import { visibleRows, type RunWeek } from "@/features/shuttle/week-grid";

/**
 * 셔틀 주간 시간표의 **회차 표 하나** — 구글 시트 '7,8시하원' 탭 모양(원장 2026-10-08).
 * 줄 = 정류장(노선 순서·시각) · 칸 = 요일 · 칸 안 = 학생 이름 · 맨 아래 = 요일별 인원.
 *
 * 📌 촘촘하게(원장 *"스크롤이 너무 많이"*): 이름은 한 줄에 하나가 아니라 **이어 쓰고 넘치면 접는다**,
 *    시각은 별도 열 대신 정류장 이름 옆, 학생 없는 정류장 줄은 뺀다(`visibleRows`).
 * 🔴 열 폭은 `table-fixed` + colgroup — 칸 내용 길이로 열이 흔들리면 훑어 읽을 수 없다([[#97]]의 사촌).
 * ⚠️ 서버 컴포넌트(순수 프레젠테이션) — 편집은 '노선 편성' 화면에서 한다.
 */
export function WeekRunTable({ run, days, week }: { run: ShuttleRun; days: DayCode[]; week: RunWeek }) {
  const range = runTimeRange(run.stops);
  const { rows, hidden } = visibleRows(week, days);
  return (
    <section className="bg-card shadow-card overflow-hidden rounded-2xl">
      <header className="border-line flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${run.direction === "in" ? "bg-blue-soft text-blue" : "bg-amber-soft text-amber"}`}>
          {DIRECTION_LABEL[run.direction]}
        </span>
        <h3 className="text-foreground text-base font-bold">{runShortTitle(run)}</h3>
        {range ? <span className="num text-text-dim text-sm">{range}</span> : null}
        <span className="text-text-dim ml-auto text-sm">
          배정 <b className="num text-foreground">{week.total}</b>명
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] table-fixed border-collapse text-sm">
          <colgroup>
            <col className="w-[8.5rem]" />
            {days.map((d) => (
              <col key={d} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-bg-soft">
              <th className="border-line border-b px-2 py-1.5 text-left font-bold">정류장</th>
              {days.map((d) => (
                <th key={d} className="border-line border-b border-l px-1 py-1.5 text-center font-bold">
                  {dayLabel(d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const fixed = row.kind !== "stop";
              return (
                <tr key={row.key} className={fixed ? "bg-bg-soft/60" : undefined}>
                  <th scope="row" className={`border-line border-b px-2 py-1 text-left align-top break-keep ${fixed ? "text-text-dim font-medium" : "text-foreground font-semibold"}`}>
                    <span className="leading-snug">{fixed ? RUN_STOP_KIND_LABEL[row.kind] : row.name}</span>
                    {row.time ? <span className="num text-text-dim ml-1 text-xs font-medium">{row.time}</span> : null}
                  </th>
                  {days.map((d) => (
                    <td key={d} className="border-line border-b border-l px-1.5 py-1 align-top leading-snug">
                      {row.cells[d].map((r, i) => (
                        // 쉼표는 이름 덩어리 **밖**에 둔다 — 안에 넣으면 줄을 꺾을 틈이 없어 칸 밖으로 넘친다.
                        <Fragment key={r.id}>
                          {i > 0 ? <span className="text-text-faint">, </span> : null}
                          <span className={`whitespace-nowrap ${r.inactive ? "opacity-50" : ""}`}>
                          <WindowLink href={`/students/${r.studentId}`} title={r.inactive ? `${r.name} · 재원 아님` : r.name} className="text-foreground hover:underline">
                            {r.name}
                          </WindowLink>
                          {r.crossTag ? <span className="text-amber ml-0.5 text-xs font-bold">{r.crossTag}</span> : null}
                          </span>
                        </Fragment>
                      ))}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-bg-soft">
              <th className="px-2 py-1.5 text-left font-bold">인원</th>
              {days.map((d) => (
                <td key={d} className="num border-line border-l px-1 py-1.5 text-center font-bold">
                  {week.counts[d]}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      {hidden > 0 ? <p className="text-text-faint border-line border-t px-3 py-1.5 text-xs">학생 없는 정류장 {hidden}곳은 줄였습니다 — 전체 노선은 &lsquo;노선 편성&rsquo;에서.</p> : null}
    </section>
  );
}
