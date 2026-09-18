/**
 * JJ실 표 — 반 묶음마다 **반 줄(합계·평균) + 학생 줄**. 한 표라서 반 줄 숫자가 학생 줄 숫자와 같은 열에 선다.
 * 반 정보가 없으면(조회 실패) 묶지 않고 학생 줄만. 서버 컴포넌트(표만 그린다 — 데이터는 jj-study-view.tsx).
 *
 * 🔑 학생 줄 → 학생 상세 성적 탭을 **같은 기간**으로 연다(`jjFrom`·`jjTo`) — 표에서 본 숫자와 상세의 숫자가 같은 창이다.
 * 🔑 정답률 반 줄은 푼 문제 수로 가중한다(class-groups.ts `summarizeStudyRows`).
 */
import { Pill } from "@/components/atoms/pill";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { WindowLink } from "@/components/workspace/window-link";
import { EmbedAnchor } from "@/components/embed-link";
import { ENGLISH_TRACK_LABEL } from "@/features/classes/english-track";
import { summarizeStudyRows, type JjGroup } from "@/features/ijw/class-groups";
import { formatStudyTime } from "@/features/ijw/contract";
import type { JjStudyRow } from "@/features/ijw/server/queries";

const HEAD = ["학생", "인재원 반", "학습한 날", "푼 문제", "정답률", "새 단어", "장기기억", "본 단어", "학습 시간"];
const fmt = (n: number) => n.toLocaleString("ko-KR");
const NUM = "num text-text-dim px-4 py-2.5 text-right text-xs";
const SUM = "num text-foreground px-4 py-2 text-right text-xs font-bold";

export function JjStudyTable({
  groups,
  rows,
  from,
  to,
  classHref,
  allowedClassIds,
}: {
  groups: JjGroup<JjStudyRow>[] | null;
  rows: JjStudyRow[];
  from: string;
  to: string;
  /** '이 반만' 링크 — 이미 반을 골랐으면 null. */
  classHref: ((classId: string | null) => string) | null;
  /**
   * 반 칩으로 고를 수 있는 반(보는 사람의 선택지). '이 반만'은 여기 있는 반에만 단다 — 강사는 자기 학생이 다니는
   * 남의 반 줄도 보지만, 그 반으로는 좁힐 수 없다(누르면 "찾을 수 없음"으로 떨어진다, 적대 리뷰 2026-09-11).
   */
  allowedClassIds: ReadonlySet<string> | null;
}) {
  const studentHref = (id: string) =>
    `/students/${id}?tab=grades&jjFrom=${encodeURIComponent(from)}&jjTo=${encodeURIComponent(to)}`;
  return (
    <DragScrollArea className="bg-card shadow-card rounded-2xl">
      <table className="w-full text-sm [&_td]:whitespace-nowrap [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
        <thead className="border-line border-b [&_th]:whitespace-nowrap">
          <tr>
            {/* 열 제목과 값은 같은 축(원장 2026-09-18) — 학생·인재원 반은 왼쪽, 숫자는 오른쪽(반 줄 숫자와 같은 열). */}
            {HEAD.map((h, i) => (
              <th key={h} className={`micro px-4 py-3 ${i < 2 ? "text-left" : "text-right"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        {groups ? (
          groups.map((g) => (
            <tbody key={g.key} className="divide-line border-line divide-y border-b last:border-b-0">
              <GroupRow
                group={g}
                classHref={g.classRef && allowedClassIds?.has(g.classRef.id) ? classHref : null}
              />
              {g.rows.map((r) => (
                <StudentRow key={`${g.key}:${r.ijwId}`} row={r} href={studentHref} />
              ))}
            </tbody>
          ))
        ) : (
          <tbody className="divide-line divide-y">
            {rows.map((r) => (
              <StudentRow key={r.ijwId} row={r} href={studentHref} />
            ))}
          </tbody>
        )}
      </table>
    </DragScrollArea>
  );
}

function GroupRow({
  group: g,
  classHref,
}: {
  group: JjGroup<JjStudyRow>;
  classHref: ((classId: string | null) => string) | null;
}) {
  const s = summarizeStudyRows(g.rows);
  const ref = g.classRef;
  return (
    <tr className="bg-bg-soft">
      <th scope="rowgroup" className="px-4 py-2 text-left font-normal">
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          {ref ? (
            <WindowLink href={`/classes/${ref.id}`} title={ref.name} className="text-foreground text-sm font-bold hover:underline">
              {ref.name}
            </WindowLink>
          ) : (
            <span className="text-foreground text-sm font-bold">{g.kind === "none" ? "영어 반 없음" : "연결 필요"}</span>
          )}
          {ref?.track ? <Pill color="neutral">{ENGLISH_TRACK_LABEL[ref.track]}</Pill> : null}
          {ref && classHref ? (
            <EmbedAnchor href={classHref(ref.id)} className="text-text-faint hover:text-foreground text-xs underline">
              이 반만
            </EmbedAnchor>
          ) : null}
        </span>
      </th>
      <td className="text-text-dim px-4 py-2 text-xs">
        학생 {s.students}명 · 학습 {s.activeStudents}명
      </td>
      <td className={SUM}>평균 {s.avgActiveDays ?? "—"}일</td>
      <td className={SUM}>{fmt(s.answers)}</td>
      <td className={SUM} title="푼 문제 수로 가중한 정답률">
        {s.accuracy != null ? `${s.accuracy}%` : "—"}
      </td>
      <td className={SUM}>{fmt(s.newWords)}</td>
      <td className={SUM}>평균 {s.avgLongTermWords != null ? fmt(s.avgLongTermWords) : "—"}</td>
      <td className={SUM}>평균 {s.avgSeenWords != null ? fmt(s.avgSeenWords) : "—"}</td>
      <td className={SUM} title={`합계 ${formatStudyTime(s.studyMs)}`}>
        평균 {s.avgStudyMs != null ? formatStudyTime(s.avgStudyMs) : "—"}
      </td>
    </tr>
  );
}

function StudentRow({ row: r, href }: { row: JjStudyRow; href: (studentId: string) => string }) {
  return (
    <tr className="hover:bg-bg-soft/50">
      <td className="px-4 py-2.5">
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          {r.eywa ? (
            <WindowLink href={href(r.eywa.studentId)} title={r.eywa.name} className="text-foreground text-sm font-bold hover:underline">
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
      <td className="text-text-dim px-4 py-2.5 text-xs">{r.className ?? "—"}</td>
      <td className="num text-foreground px-4 py-2.5 text-right text-xs font-bold">{r.activeDays}일</td>
      <td className={NUM}>{fmt(r.answers)}</td>
      <td className={NUM}>{r.answers ? `${r.accuracy}%` : "—"}</td>
      <td className={NUM}>{fmt(r.newWords)}</td>
      <td className={NUM}>{fmt(r.longTermWords)}</td>
      <td className={NUM}>{fmt(r.seenWords)}</td>
      <td className={NUM}>{formatStudyTime(r.studyMs)}</td>
    </tr>
  );
}
