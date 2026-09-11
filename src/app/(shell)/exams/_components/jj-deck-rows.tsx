/**
 * 시험 결과 창의 **학생별 결과 표** — 점수 높은 순(인재원 순서 그대로). 서버 컴포넌트.
 * 학생 이름 → 학생 상세 성적 탭 · '결과지' → 그 응시 한 장(`/exams/jj/attempt/{attemptId}`) · 반 = 지금 다니는 eywa 영어 반.
 * 짝이 없는 행엔 '연결 필요'(짝 잇기는 JJ실 아래 구역에서 관리자가 한다).
 */
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { WindowLink } from "@/components/workspace/window-link";
import { formatElapsed } from "@/features/ijw/contract";
import type { JjDeckRow } from "@/features/ijw/server/queries";
import { kstDateTime } from "./jj-shared";

export type JjDeckTableRow = JjDeckRow & { classNames: string[] };

const NUM = "num text-text-dim px-4 py-2.5 text-right text-xs";

export function JjDeckRows({ rows }: { rows: JjDeckTableRow[] }) {
  return (
    <DragScrollArea className="bg-card shadow-card rounded-2xl">
      <table className="w-full text-sm [&_td]:whitespace-nowrap [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
        <thead className="border-line border-b [&_th]:whitespace-nowrap">
          <tr>
            {["학생", "반", "인재원 반", "점수", "맞은 문항", "제출", "걸린 시간", "결과지"].map((h) => (
              <th key={h} className="micro px-4 py-3 text-center">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {rows.map((r) => (
            <tr key={r.attemptId} className="hover:bg-bg-soft/50">
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-1.5 whitespace-nowrap">
                  {r.eywa ? (
                    <WindowLink
                      href={`/students/${r.eywa.studentId}?tab=grades`}
                      title={r.eywa.name}
                      className="text-foreground text-sm font-bold hover:underline"
                    >
                      {r.eywa.name}
                    </WindowLink>
                  ) : (
                    <span className="text-foreground text-sm font-bold">{r.name || r.ijwId}</span>
                  )}
                  {!r.eywa ? (
                    <span className="border-amber/40 bg-amber-soft text-amber rounded-pill border px-1.5 py-px text-xs font-bold">
                      연결 필요
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="text-text-dim px-4 py-2.5 text-xs">{r.classNames.length ? r.classNames.join(" · ") : "—"}</td>
              <td className="text-text-dim px-4 py-2.5 text-xs">{r.className ?? "—"}</td>
              <td className="num text-foreground px-4 py-2.5 text-right text-sm font-bold">{r.score}</td>
              <td className={NUM}>
                {r.correct} / {r.total}
              </td>
              <td className="num text-text-dim px-4 py-2.5 text-xs">{kstDateTime(r.submittedAt)}</td>
              <td className={NUM}>{formatElapsed(r.elapsedMs)}</td>
              <td className="px-4 py-2.5 text-center">
                <WindowLink
                  href={`/exams/jj/attempt/${encodeURIComponent(r.attemptId)}`}
                  title="시험 결과지"
                  className="text-primary text-xs font-bold hover:underline"
                >
                  결과지
                </WindowLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
