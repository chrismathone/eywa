
import { SheetText } from "@/features/teacher-view/interface-label";
/**
 * 시험 결과 창의 **반별 결과** — 반(aywa 영어 반)마다 응시·평균·최고·최저(2026-09-11 "학생별 반별 유기적으로").
 * 인재원과 같은 반올림(summarizeScores). 반 이름을 누르면 같은 창이 그 반만 보여 준다. 서버 컴포넌트.
 */
import { Pill } from "@/components/atoms/pill";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { EmbedAnchor } from "@/components/embed-link";
import { ENGLISH_TRACK_LABEL } from "@/features/classes/english-track";
import type { JjTrack } from "@/features/ijw/class-groups";

export type JjDeckBreakdownItem = {
  key: string;
  /** aywa 반 id — 없으면 '영어 반 없음'·'연결 필요' 줄. */
  classId: string | null;
  label: string;
  track: JjTrack;
  stats: { count: number; avg: number | null; max: number | null; min: number | null };
};

const NUM = "num text-text-dim px-4 py-2.5 text-right text-xs";

export function JjDeckBreakdown({
  items,
  hrefFor,
  multi,
}: {
  items: JjDeckBreakdownItem[];
  /** 그 반으로 좁히는 주소 — 보는 사람이 고를 수 없는 반이면 null(이름만 적는다). */
  hrefFor: (classId: string) => string | null;
  /** 두 반을 다니는 학생이 있다 — 두 반 모두에 센다고 적는다. */
  multi: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className="bg-card shadow-card rounded-2xl">
      <header className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
        <h2 className="text-foreground text-base font-bold"><SheetText value={"반별 결과"} /></h2>
        <p className="text-text-faint text-xs">
          <SheetText value={"반 이름을 누르면 그 반만 봅니다"} /><SheetText value={multi ? " · 영어 반 두 곳을 다니는 학생은 두 반 모두에 셉니다" : ""} />
        </p>
      </header>
      <DragScrollArea className="mt-2 pb-2">
        <table className="w-full text-sm [&_td]:whitespace-nowrap [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
          <thead className="border-line border-b [&_th]:whitespace-nowrap">
            <tr>
              {/* 열 제목과 값은 같은 축(원장 2026-09-18) — 반 이름은 왼쪽, 숫자는 오른쪽(성적관리 시험 목록 표와 같은 규약). */}
              {["반", "응시", "평균", "최고", "최저"].map((h, i) => (
                <th key={h} className={`micro px-4 py-2.5 ${i === 0 ? "text-left" : "text-right"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {items.map((it) => {
              const href = it.classId ? hrefFor(it.classId) : null;
              return (
              <tr key={it.key} className="hover:bg-bg-soft/50">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-1.5 whitespace-nowrap">
                    {href ? (
                      <EmbedAnchor href={href} className="text-foreground text-sm font-bold hover:underline">
                        {it.label}
                      </EmbedAnchor>
                    ) : (
                      <span className={`text-sm font-bold ${it.classId ? "text-foreground" : "text-text-dim"}`}>{it.label}</span>
                    )}
                    {it.track ? <Pill color="neutral">{ENGLISH_TRACK_LABEL[it.track]}</Pill> : null}
                  </span>
                </td>
                <td className="num text-foreground px-4 py-2.5 text-right text-xs font-bold">{it.stats.count}<SheetText value={"명"} /></td>
                <td className={NUM}>{it.stats.avg ?? "—"}</td>
                <td className={NUM}>{it.stats.max ?? "—"}</td>
                <td className={NUM}>{it.stats.min ?? "—"}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </DragScrollArea>
    </section>
  );
}
