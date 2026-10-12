import type { OverviewData } from "./model";
import type { SubjectEndedRow } from "@/features/withdrawals/server/queries";
import { inWithdrawalWindow, withdrawalProgram } from "@/features/withdrawals/window";
import type { ProgramSubject } from "@/features/students/program";

/** 과목 전체 종료만 더하며 반이동은 제외한다. 퇴원한 학생의 수강종료는 별도로 중복 계산하지 않는다. */
export function includeSubjectEnds(
  withdrawn: OverviewData["withdrawals"]["rows"],
  subjectEnded: readonly SubjectEndedRow[],
  window: { from: string; to: string },
  subjects: readonly ProgramSubject[],
  schoolGrade: (school: string | null, grade: string | null) => string | null,
): OverviewData["withdrawals"]["rows"] {
  const withdrawnIds = new Set(withdrawn.map(row => row.id));
  const extra: OverviewData["withdrawals"]["rows"] = [];
  for (const s of subjectEnded) {
    if (withdrawnIds.has(s.id)) continue;
    const ended = s.endedDetail.filter(d => !d.isTransferred && inWithdrawalWindow({ withdrawnAt: d.endedAt, systemBulk: false }, window.from, window.to))
      .sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? "") || a.subject.localeCompare(b.subject));
    for (const detail of ended) {
      if (!detail.endedAt) continue;
      extra.push({ id: s.id, eventKey: `${s.id}|${detail.subject}`, name: s.name,
        subject: detail.subject,
        schoolGrade: schoolGrade(s.school, s.grade), withdrawnAt: detail.endedAt,
        program: withdrawalProgram({ lastClassSubject: detail.subject, lastClassEnglishTrack: detail.englishTrack }, subjects),
        kind: "subject-ended", className: detail.className ?? undefined });
    }
  }
  return [...withdrawn.map(row => ({ ...row, kind: "withdrawn" as const })), ...extra]
    .sort((a, b) => b.withdrawnAt.localeCompare(a.withdrawnAt) || a.name.localeCompare(b.name, "ko") || (a.eventKey ?? a.id).localeCompare(b.eventKey ?? b.id));
}
