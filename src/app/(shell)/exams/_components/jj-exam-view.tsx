/**
 * 성적관리 › 영어 › **JJ실(시험)** — 인재원 단어시험별 응시·평균·최고·최저(설명서 6번). 서버 컴포넌트.
 *
 * 점수는 0~100(정답률). 학생마다 **마지막 제출**로 센다(재응시는 나중 결과 — 인재원 순위표와 같은 규칙).
 * 학원 전체 집계다 — 🔴 강사는 담당(세 갈래) 반에 영어가 있을 때만 이 칩이 서고(page.tsx), 없으면 조회도 비운다(queries.ts).
 * 강사가 보는 숫자가 학원 전체라는 사실을 적는다 — 결과 창 머리는 '내 학생 기준'이라 둘이 다를 수 있다.
 */
import { SearchX } from "@/components/icons/eywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { WindowLink } from "@/components/workspace/window-link";
import { examTypeLabel } from "@/features/ijw/contract";
import type { JjRange } from "@/features/ijw/range";
import { getJjExamSummary, type JjViewer } from "@/features/ijw/server/queries";
import { JJ_SCOPE_FAILED, JjFailBanner, JjPeriodLine, kstDateTime, rangeNote } from "./jj-shared";

export async function JjExamView({ viewer, range }: { viewer: JjViewer; range: JjRange }) {
  if (viewer.scopeFailed) return <JjFailBanner message={JJ_SCOPE_FAILED} />;
  const res = await getJjExamSummary(viewer, range.from, range.to);
  if (!res.ok) return <JjFailBanner message={res.message} detail={res.detail} />;
  const scope = viewer.teacherStudentIds ? " · 응시·평균은 학원 전체 기준" : "";
  return (
    <div className="space-y-3">
      <JjPeriodLine
        from={range.from}
        to={range.to}
        basis="exam"
        note={rangeNote(range, "기본: 최근 30일")}
        extra={`시험 ${res.exams.length}개${scope}`}
      />
      {res.exams.length === 0 ? (
        <EmptyState
          image="exams"
          icon={() => <SearchX size={32} strokeWidth={1.8} />}
          title="이 기간에 본 인재원 시험이 없습니다"
          description="기간을 넓혀 다시 찾아보세요."
        />
      ) : (
        <div className="bg-card shadow-card overflow-auto rounded-2xl">
          <table className="w-full text-sm [&_td]:whitespace-nowrap">
            <thead className="border-line border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-4 py-3 text-left">시험</th>
                <th className="micro px-4 py-3 text-left">구분</th>
                <th className="micro px-4 py-3 text-right">응시</th>
                <th className="micro px-4 py-3 text-right">평균</th>
                <th className="micro px-4 py-3 text-right">최고</th>
                <th className="micro px-4 py-3 text-right">최저</th>
                <th className="micro px-4 py-3 text-left">최근 제출</th>
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {res.exams.map((e) => (
                <tr key={e.deckId} className="hover:bg-bg-soft/50">
                  <td className="px-4 py-2.5">
                    <WindowLink
                      href={`/exams/jj/${encodeURIComponent(e.deckId)}`}
                      title={e.name}
                      className="text-foreground text-sm font-bold hover:underline"
                    >
                      {e.name}
                    </WindowLink>
                  </td>
                  <td className="text-text-dim px-4 py-2.5 text-xs">{examTypeLabel(e.examType)}</td>
                  <td className="num text-foreground px-4 py-2.5 text-right text-xs font-bold">{e.takers}명</td>
                  <td className="num text-text-dim px-4 py-2.5 text-right text-xs">{e.avg ?? "—"}</td>
                  <td className="num text-text-dim px-4 py-2.5 text-right text-xs">{e.max ?? "—"}</td>
                  <td className="num text-text-dim px-4 py-2.5 text-right text-xs">{e.min ?? "—"}</td>
                  <td className="num text-text-dim px-4 py-2.5 text-xs">{e.lastSubmittedAt ? kstDateTime(e.lastSubmittedAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
