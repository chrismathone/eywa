
import { SheetText } from "@/features/teacher-view/interface-label";
/**
 * 성적관리 › 영어 › **JJ실(시험)** — 인재원 단어시험별 응시·평균·최고·최저(설명서 6번). 서버 컴포넌트.
 *
 * 점수는 0~100(정답률). 학생마다 **마지막 제출**로 센다(재응시는 나중 결과 — 인재원 순위표와 같은 규칙).
 * 학원 전체 집계다 — 🔴 강사는 담당(세 갈래) 반에 영어가 있을 때만 이 칩이 서고(page.tsx), 없으면 조회도 비운다(queries.ts).
 * 강사가 보는 숫자가 학원 전체라는 사실을 적는다 — 결과 창 머리는 '내 학생 기준'이라 둘이 다를 수 있다.
 * 🔑 반 칩(2026-09-11): 목록 숫자는 그대로 학원 전체이고, 고른 반은 **시험 결과 창**을 그 반으로 연다(주소 `jjClass`).
 */
import { SearchX } from "@/components/icons/aywa-icon-compat";
import { EmptyState } from "@/components/empty-state";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { WindowLink } from "@/components/workspace/window-link";
import { examTypeLabel } from "@/features/ijw/contract";
import type { JjRange } from "@/features/ijw/range";
import { getJjClassOptions, getJjExamSummary, type JjViewer } from "@/features/ijw/server/queries";
import { JjClassFilter } from "./jj-class-filter";
import { JJ_SCOPE_FAILED, JjFailBanner, JjNote, JjPeriodLine, kstDateTime, rangeNote } from "./jj-shared";

const TH = "micro px-4 py-3";
const NUM = "num text-text-dim px-4 py-2.5 text-right text-xs";
/**
 * 열 제목 + 정렬 — 열 제목과 값은 같은 축(원장 2026-09-18): 글·날짜는 왼쪽, 숫자는 오른쪽
 * (성적관리 시험 목록 표와 같은 규약). 아래 본문 칸과 같은 정렬이어야 한다.
 */
const HEAD: ReadonlyArray<readonly [string, string]> = [
  ["시험", "text-left"],
  ["구분", "text-left"],
  ["응시", "text-right"],
  ["평균", "text-right"],
  ["최고", "text-right"],
  ["최저", "text-right"],
  ["최근 제출", "text-left"],
];

export async function JjExamView({
  viewer,
  range,
  classFilter,
  classHref,
}: {
  viewer: JjViewer;
  range: JjRange;
  classFilter: string | null;
  classHref: (classId: string | null) => string;
}) {
  if (viewer.scopeFailed) return <JjFailBanner message={JJ_SCOPE_FAILED} />;
  const [res, options] = await Promise.all([getJjExamSummary(viewer, range.from, range.to), getJjClassOptions(viewer)]);
  if (!res.ok) return <JjFailBanner message={res.message} detail={res.detail} />;
  const filter = classFilter && options?.some((c) => c.id === classFilter) ? classFilter : null;
  const filterName = filter ? options?.find((c) => c.id === filter)?.name : null;
  const deckHref = (deckId: string) =>
    `/exams/jj/${encodeURIComponent(deckId)}${filter ? `?jjClass=${encodeURIComponent(filter)}` : ""}`;
  const scope = viewer.teacherStudentIds ? " · 응시·평균은 학원 전체 기준" : "";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <JjPeriodLine
          from={range.from}
          to={range.to}
          basis="exam"
          note={rangeNote(range, "기본: 최근 30일")}
          extra={`시험 ${res.exams.length}개${scope}`}
        />
        {options ? <JjClassFilter classes={options} value={filter} hrefFor={classHref} /> : null}
      </div>
      {filterName ? (
        <JjNote>
          <SheetText value={"목록 숫자는 학원 전체 기준입니다 — 시험을 열면 "} />{filterName} <SheetText value={"반 결과로 봅니다."} /></JjNote>
      ) : classFilter && options ? (
        <JjNote><SheetText value={"고른 반을 찾을 수 없어(담당 반이 아니거나 운영이 끝난 반) 반 없이 엽니다."} /></JjNote>
      ) : classFilter ? (
        <JjNote><SheetText value={"반 목록을 불러오지 못해 반 없이 엽니다."} /></JjNote>
      ) : null}
      {res.exams.length === 0 ? (
        <EmptyState
          image="exams"
          icon={() => <SearchX size={32} strokeWidth={1.8} />}
          title="이 기간에 본 인재원 시험이 없습니다"
          description="기간을 넓혀 다시 찾아보세요."
        />
      ) : (
        <DragScrollArea className="bg-card shadow-card rounded-2xl">
          <table className="w-full text-sm [&_td]:whitespace-nowrap [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
            <thead className="border-line border-b [&_th]:whitespace-nowrap">
              <tr>
                {HEAD.map(([h, align]) => (
                  <th key={h} className={`${TH} ${align}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {res.exams.map((e) => (
                <tr key={e.deckId} className="hover:bg-bg-soft/50">
                  <td className="px-4 py-2.5">
                    <WindowLink
                      href={deckHref(e.deckId)}
                      title={e.name}
                      className="text-foreground text-sm font-bold hover:underline"
                    >
                      {e.name}
                    </WindowLink>
                  </td>
                  <td className="text-text-dim px-4 py-2.5 text-xs">{examTypeLabel(e.examType)}</td>
                  <td className="num text-foreground px-4 py-2.5 text-right text-xs font-bold">{e.takers}<SheetText value={"명"} /></td>
                  <td className={NUM}>{e.avg ?? "—"}</td>
                  <td className={NUM}>{e.max ?? "—"}</td>
                  <td className={NUM}>{e.min ?? "—"}</td>
                  <td className="num text-text-dim px-4 py-2.5 text-xs">
                    {e.lastSubmittedAt ? kstDateTime(e.lastSubmittedAt) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DragScrollArea>
      )}
    </div>
  );
}
