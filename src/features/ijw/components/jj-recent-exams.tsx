import { WindowLink } from "@/components/workspace/window-link";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { examTypeLabel, type IjwExamListItem } from "../contract";
import { kstStamp } from "../sheet-model";

/**
 * 학생 상세 — **최근 본 시험**(인재원 2번: 시험마다 마지막 제출, 기간과 무관). 시험 이름 → 그 시험 전체 결과,
 * '결과지' → 이 응시의 시험 결과지(3번). 링크는 성적관리 창으로 연다(창 규약, WindowLink).
 * 🔑 학습 분석지 안의 '기간 중 시험' 목록은 링크가 없다(학부모 카드와 같은 조각) — 여는 곳은 이 표 하나다.
 * 🔴 링크는 **열 수 있는 사람에게만** 단다(`links`) — 학생 상세는 학생 열람 게이트, 시험 창은 성적관리 + 영어 담당
 *    게이트라 둘이 다르다. 수학 담당 강사·회계가 누르면 404나 첫 화면으로 떨어졌다(적대 리뷰 2026-09-11).
 */
export function JjRecentExams({
  exams,
  links,
}: {
  exams: IjwExamListItem[];
  /** deck = 시험 전체 결과 창을 열 수 있다 · attempt = 이 학생의 응시 결과지를 열 수 있다. */
  links: { deck: boolean; attempt: boolean };
}) {
  return (
    <DragScrollArea className="bg-card shadow-card rounded-2xl">
      <table className="w-full text-sm">
        <thead className="border-line bg-bg-soft border-b [&_th]:whitespace-nowrap">
          <tr>
            <th className="micro px-4 py-2 text-left">제출</th>
            <th className="micro px-4 py-2 text-left">시험</th>
            <th className="micro px-4 py-2 text-left">구분</th>
            <th className="micro px-4 py-2 text-right">점수</th>
            <th className="micro px-4 py-2 text-right">맞은 문항</th>
            {links.attempt ? <th className="micro px-4 py-2 text-right">결과지</th> : null}
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {exams.map((e) => (
            <tr key={e.attemptId} className="hover:bg-bg-soft">
              <td className="num text-text-dim px-4 py-2 text-xs whitespace-nowrap">{kstStamp(e.submittedAt)}</td>
              <td className="px-4 py-2">
                {links.deck ? (
                  <WindowLink
                    href={`/exams/jj/${encodeURIComponent(e.deckId)}`}
                    title={`${e.deck} — 이 시험 전체 결과`}
                    className="text-foreground text-sm font-bold hover:underline"
                  >
                    {e.deck}
                  </WindowLink>
                ) : (
                  <span className="text-foreground text-sm font-bold">{e.deck}</span>
                )}
              </td>
              <td className="text-text-dim px-4 py-2 text-xs whitespace-nowrap">{examTypeLabel(e.examType)}</td>
              <td className="num text-foreground px-4 py-2 text-right text-sm font-bold">{e.score}</td>
              <td className="num text-text-dim px-4 py-2 text-right text-xs whitespace-nowrap">
                {e.correct} / {e.total}
              </td>
              {links.attempt ? (
                <td className="px-4 py-2 text-right">
                  <WindowLink
                    href={`/exams/jj/attempt/${encodeURIComponent(e.attemptId)}`}
                    title="이 응시의 시험 결과지"
                    className="text-primary text-xs font-bold whitespace-nowrap hover:underline"
                  >
                    결과지
                  </WindowLink>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
