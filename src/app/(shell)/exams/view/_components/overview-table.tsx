
import { SheetText } from "@/features/teacher-view/interface-label";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
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
      {/* 🔴 최소 폭 — 없으면 좁은 창에서 열이 서로를 찌그러뜨린다(입력 격자와 같은 이유).
          시험이 늘면 가로로 스크롤한다(잡고 끌기도 된다). */}
      <table className="w-full min-w-[880px] text-sm [&_td]:whitespace-nowrap">
        <caption className="sr-only"><SheetText value={"학기 성적 확인표 — 학생별 시험 점수와 평균"} /></caption>
        <thead className="bg-card sticky top-0 z-10 [&_th]:shadow-[0_1px_0_0_var(--color-line)] [&_th]:whitespace-nowrap">
          <tr>
            <th scope="col" className="micro px-4 py-3 text-left">
              <SheetText value={"이름"} /></th>
            <th scope="col" className="micro px-4 py-3 text-left">
              <SheetText value={"학교"} /></th>
            <th scope="col" className="micro px-2 py-3 text-center">
              <SheetText value={"학년"} /></th>
            <th scope="col" className="micro px-3 py-3 text-left">
              <SheetText value={"반"} /></th>
            {columns.map((c) => (
              <th key={c.key} scope="col" className="micro px-3 py-3 text-center">
                {/* 🔴 달 열은 시험 이름을 **글자로** 함께 적는다 — `title` 툴팁은 모바일에서 없는 것과
                    같은데(디자인 규약), 수학은 `내신`과 `월말평가`가 나란히 서서 `10월`만으론 구분이 안 된다. */}
                {c.month > 0 ? (
                  <span className="block leading-tight">
                    <span className="text-text-faint block font-normal">{c.exam}</span>
                    {c.label}
                  </span>
                ) : (
                  c.label
                )}
              </th>
            ))}
            <th
              scope="col"
              className="micro px-3 py-3 text-center"
              title="적힌 시험만의 평균입니다 — 학생마다 친 시험 수가 다를 수 있습니다"
            >
              <SheetText value={"평균"} /></th>
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
                // 🔴 제도상 안 치는 칸은 `—`(미기입)와 다르게 그린다 — 안 그러면 초등이 절반인 반에서
                //    거짓 공백 수백 칸이 "안 적음"으로 읽힌다(입력 격자는 그 줄을 아예 안 세운다).
                const skipped = r.skipKeys.includes(c.key);
                return (
                  <td
                    key={c.key}
                    className={`num px-3 py-1.5 text-center ${skipped ? "bg-bg-soft/60" : ""}`}
                  >
                    {cell?.score != null ? (
                      <span className="text-foreground font-medium">{cell.score}</span>
                    ) : cell?.noExam ? (
                      <span className="text-text-faint" title="시험없음으로 표시된 칸입니다">
                        <SheetText value={"없음"} /></span>
                    ) : skipped ? (
                      <span className="text-text-faint" title="이 학년은 이 시험을 치지 않습니다">
                        ·
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
