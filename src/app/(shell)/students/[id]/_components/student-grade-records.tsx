import Link from "next/link";
import { HeaderFilter } from "@/components/header-filter";
import type { FilterSelectOption } from "@/components/filter-select";
import { examInfoOf, type LedgerView } from "@/features/grades/unified/ledger-view";
import { KIND_LABEL, type UnifiedRow } from "@/features/grades/unified/model";
import { DeltaBadge, KindPill, ScoreLine } from "@/app/(shell)/exams/_components/tab-parts";
import { SortButton } from "@/app/(shell)/exams/_components/ledger-head";
import { DeleteGradeButton } from "./delete-grade-button";
import { GoalBadge } from "@/features/grades/components/goal-badge";
import type { GoalView } from "@/features/grades/goals";

type Href = (patch: Record<string, string>) => string;

/**
 * 학생 상세 성적 목록 — 통합 성적관리와 **같은 기록**(성적 입력 + 수업보고서 일일·확인테스트 + 레벨테스트)을 같은 표기로
 * (원장 2026-09-24). 점수는 기록할 때 정한 단위 그대로(개·점, 환산 없음)·왼쪽 정렬, 증감은 직전 같은 시험 대비.
 * 열 머리 = 필터·정렬(통합 성적관리 원장과 같은 부품·같은 판정 `applyLedgerView`). 결과가 0건이어도 머리는 남긴다
 * (치우면 걸린 필터를 못 되돌린다). 지우기는 **성적 입력 행만** — 보고서 점수는 보고서에서, 레벨테스트는 그 구역에서.
 */
export function StudentGradeRecords({ rows, studentId, notesById, subjectLabel, view, href, filters, goals, canWrite }: {
  rows: readonly UnifiedRow[]; studentId: string; notesById: Record<string, string | null>; subjectLabel: Record<string, string>;
  view: LedgerView; href: Href;
  filters: { subject: string; kind: string; subjects: FilterSelectOption[]; kinds: FilterSelectOption[] };
  /** 줄 key → 시험 목표 대비(`goalViewsForRows` — /exams와 같은 함수). */
  goals: Record<string, GoalView>;
  /** 성적 삭제 단추 — 서버 `deleteStudentGrade`(students full|scoped)와 같은 판정. 읽기 권한이면 그리지 않는다. */
  canWrite: boolean;
}) {
  const th = "micro px-4 py-2 font-bold whitespace-nowrap";
  // 🔴 overflow-x-auto로 싸지 말 것 — 열 머리 필터 팝업이 표 밖으로 못 나와 잘린다(원생목록 규약).
  return <div className="bg-card border-border rounded-2xl border">
    <table className="w-full text-sm">
      <thead className="border-border bg-bg-soft/40 border-b">
        <tr>
          <th className={`${th} text-left`}><SortButton sort="date" view={view} href={href} label="시험일" /></th>
          <th className={`${th} text-left`}><HeaderFilter paramName="subject" axisLabel="과목" value={filters.subject} options={filters.subjects} /></th>
          <th className={`${th} text-left`}><span className="inline-flex items-center gap-0.5">
            <HeaderFilter paramName="kind" axisLabel="시험" value={filters.kind} options={filters.kinds} /><SortButton sort="kind" view={view} href={href} /></span></th>
          <th className={`${th} text-left`}><span className="inline-flex items-center gap-0.5">
            <HeaderFilter paramName="fScore" axisLabel="점수" value={view.score}
              options={[{ value: "high", label: "90% 이상" }, { value: "mid", label: "60~89%" }, { value: "low", label: "60% 미만" }]} />
            <SortButton sort="score" view={view} href={href} /></span></th>
          <th className={`${th} text-left`}><span className="inline-flex items-center gap-0.5">
            <HeaderFilter paramName="fDelta" axisLabel="증감" value={view.delta}
              options={[{ value: "up", label: "상승" }, { value: "down", label: "하락" }, { value: "same", label: "변화 없음" }]} />
            <SortButton sort="delta" view={view} href={href} /></span></th>
          <th className={`${th} text-left`}>메모</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody className="divide-border divide-y">
        {rows.length ? rows.map((row) => {
          const info = examInfoOf(row);
          return <tr key={row.key} className="hover:bg-bg-soft/30">
            <td className="num text-muted-foreground px-4 py-2 text-xs whitespace-nowrap">{row.date}</td>
            <td className="text-foreground px-4 py-2 text-xs font-medium whitespace-nowrap">{subjectLabel[row.subject] ?? row.subject}</td>
            <td className="px-4 py-2 text-xs"><span className="flex flex-wrap items-center gap-1.5"><KindPill kind={row.kind} />{info ? <span className="text-muted-foreground">{info}</span> : null}</span></td>
            <td className="px-4 py-2 text-xs"><ScoreLine row={row} />{goals[row.key] ? <GoalBadge goal={goals[row.key]!} className="mt-0.5 flex" /> : null}</td>
            <td className="px-4 py-2 text-xs"><DeltaBadge row={row} /></td>
            <td className="text-muted-foreground px-4 py-2 text-xs">{(row.source === "grade" ? notesById[row.sourceId] : null) ?? "—"}</td>
            <td className="px-4 py-2 text-right whitespace-nowrap">
              {row.source === "grade" ? (canWrite ? <DeleteGradeButton gradeId={row.sourceId} studentId={studentId} label={info ?? KIND_LABEL[row.kind]} /> : null)
                : row.source === "report" ? <Link href={href({ tab: "progress", subject: "", kind: "", sort: "", dir: "", fScore: "", fDelta: "", page: "" })} className="text-primary text-xs hover:underline" title="수업보고서 점수는 보고서에서 고칩니다">수업보고서</Link>
                : <span className="text-muted-foreground text-xs" title="아래 레벨테스트 구역에서 고칩니다">레벨테스트</span>}
            </td>
          </tr>;
        }) : <tr><td colSpan={7} className="text-muted-foreground py-8 text-center text-sm">조건에 맞는 성적이 없습니다</td></tr>}
      </tbody>
    </table>
  </div>;
}
