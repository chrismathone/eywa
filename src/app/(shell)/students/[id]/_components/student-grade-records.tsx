import Link from "next/link";
import { examInfoOf } from "@/features/grades/unified/ledger-view";
import { KIND_LABEL, type UnifiedRow } from "@/features/grades/unified/model";
import { DeltaBadge, KindPill, ScoreLine } from "@/app/(shell)/exams/_components/tab-parts";
import { DeleteGradeButton } from "./delete-grade-button";

/**
 * 학생 상세 성적 목록 — 통합 성적관리와 **같은 기록**(성적 입력 + 수업보고서 일일·확인테스트 + 레벨테스트)을 같은 표기로
 * (원장 2026-09-24). 점수는 기록할 때 정한 단위 그대로(개·점, 환산 없음)·왼쪽 정렬, 증감은 직전 같은 시험 대비.
 * 지우기는 **성적 입력 행만** — 수업보고서 점수는 보고서에서, 레벨테스트는 아래 레벨테스트 구역에서 고친다.
 */
export function StudentGradeRecords({ rows, studentId, notesById, subjectLabel }: {
  rows: readonly UnifiedRow[]; studentId: string; notesById: Record<string, string | null>; subjectLabel: Record<string, string>;
}) {
  if (!rows.length) return <p className="text-muted-foreground py-8 text-center text-sm">기록된 성적이 없습니다</p>;
  return <div className="bg-card border-border overflow-x-auto rounded-2xl border">
    <table className="w-full text-sm">
      <thead className="border-border bg-bg-soft/40 border-b [&_th]:whitespace-nowrap">
        <tr>
          <th className="micro px-4 py-2 text-left">시험일</th>
          <th className="micro px-4 py-2 text-left">과목</th>
          <th className="micro px-4 py-2 text-left">시험</th>
          <th className="micro px-4 py-2 text-left">점수</th>
          <th className="micro px-4 py-2 text-left">증감</th>
          <th className="micro px-4 py-2 text-left">메모</th>
          <th className="px-4 py-2" />
        </tr>
      </thead>
      <tbody className="divide-border divide-y">
        {rows.map((row) => {
          const info = examInfoOf(row);
          return <tr key={row.key} className="hover:bg-bg-soft/30">
            <td className="num text-muted-foreground px-4 py-2 text-xs whitespace-nowrap">{row.date}</td>
            <td className="text-foreground px-4 py-2 text-xs font-medium whitespace-nowrap">{subjectLabel[row.subject] ?? row.subject}</td>
            <td className="px-4 py-2 text-xs"><span className="flex flex-wrap items-center gap-1.5"><KindPill kind={row.kind} />{info ? <span className="text-muted-foreground">{info}</span> : null}</span></td>
            <td className="px-4 py-2 text-xs"><ScoreLine row={row} /></td>
            <td className="px-4 py-2 text-xs"><DeltaBadge row={row} /></td>
            <td className="text-muted-foreground px-4 py-2 text-xs">{(row.source === "grade" ? notesById[row.sourceId] : null) ?? "—"}</td>
            <td className="px-4 py-2 text-right whitespace-nowrap">
              {row.source === "grade" ? <DeleteGradeButton gradeId={row.sourceId} studentId={studentId} label={info ?? KIND_LABEL[row.kind]} />
                : row.source === "report" ? <Link href={`/students/${studentId}?tab=progress`} className="text-primary text-xs hover:underline" title="수업보고서 점수는 보고서에서 고칩니다">수업보고서</Link>
                : <span className="text-muted-foreground text-xs" title="아래 레벨테스트 구역에서 고칩니다">레벨테스트</span>}
            </td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}
