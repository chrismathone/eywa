import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { EXAM_SLOT_LABEL } from "@/features/grades/exam-slots";
import type { OverviewColumn, OverviewRow } from "@/features/grades/overview";

/**
 * 성적 확인 표 — 학생 한 줄 × 시험 여러 열(읽기 전용).
 *
 * 🔑 입력 격자와 **같은 껍데기**를 쓴다(창 높이를 채우는 스크롤 영역 + 머리줄 고정) — 두 화면을
 *    오갈 때 표가 다른 물건처럼 보이지 않게.
 * 🔴 열 수가 데이터에 따라 달라서 `table-fixed`를 쓰지 않는다 — 시험이 하나뿐인 학기에 폭을
 *    비율로 나누면 점수 칸 하나가 화면 절반을 먹는다. 대신 왼쪽 신원 열만 최소 폭을 잡는다.
 * ⚠️ 빈 칸은 `—`다(안 친 것과 안 적은 것을 여기서 가르지 않는다 — 그 판정은 입력 화면 몫).
 */
export function OverviewTable({ columns, rows }: { columns: OverviewColumn[]; rows: OverviewRow[] }) {
  return (
    <DragScrollArea scrollY className="bg-card shadow-card min-h-[14rem] flex-1 rounded-2xl">
      <table className="w-full text-sm [&_td]:whitespace-nowrap">
        <caption className="sr-only">학기 성적 확인표 — 학생별 시험 점수와 평균</caption>
        <thead className="bg-card sticky top-0 z-10 [&_th]:shadow-[0_1px_0_0_var(--color-line)] [&_th]:whitespace-nowrap">
          <tr>
            <th scope="col" className="micro px-4 py-3 text-left">
              이름
            </th>
            <th scope="col" className="micro px-4 py-3 text-left">
              학교
            </th>
            <th scope="col" className="micro px-2 py-3 text-center">
              학년
            </th>
            <th scope="col" className="micro px-3 py-3 text-left">
              반
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className="micro px-3 py-3 text-center">
                {/* 월말평가는 열 이름이 `10월`이라, 무슨 시험인지는 마우스 오버로 말한다. */}
                <span title={c.month > 0 ? `${EXAM_SLOT_LABEL[c.slot]} ${c.month}월` : EXAM_SLOT_LABEL[c.slot]}>
                  {c.label}
                </span>
              </th>
            ))}
            <th scope="col" className="micro px-3 py-3 text-center">
              평균
            </th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {rows.map((r) => (
            <tr key={r.studentId} className="hover:bg-bg-soft/50">
              <td className="text-foreground px-4 py-1.5 text-left font-medium">{r.name}</td>
              <td className="text-text-dim px-4 py-1.5 text-left text-sm">{r.school ?? "—"}</td>
              <td className="text-text-dim num px-2 py-1.5 text-center text-sm">{r.grade ?? "—"}</td>
              <td className="text-text-dim px-3 py-1.5 text-left text-sm">
                {r.classNames.length > 0 ? r.classNames.join(" · ") : "—"}
              </td>
              {columns.map((c) => {
                const cell = r.cells[c.key];
                return (
                  <td key={c.key} className="num px-3 py-1.5 text-center">
                    {cell?.score != null ? (
                      <span className="text-foreground font-medium">{cell.score}</span>
                    ) : cell?.noExam ? (
                      <span className="text-text-faint" title="시험없음으로 표시된 칸입니다">
                        없음
                      </span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                );
              })}
              <td className="num px-3 py-1.5 text-center">
                {r.avgPct != null ? (
                  <span className="text-foreground font-bold">{r.avgPct}%</span>
                ) : (
                  <span className="text-text-faint">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
