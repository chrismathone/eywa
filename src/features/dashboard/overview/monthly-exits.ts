import type { OverviewData } from "./model";
import type { SubjectEndedRow } from "@/features/withdrawals/server/queries";
import { inWithdrawalWindow, withdrawalProgram } from "@/features/withdrawals/window";
import type { ProgramSubject } from "@/features/students/program";

/** 과목 전체 종료만 더하며 반이동은 제외한다. 한 학생은 퇴원 여부를 우선해 한 번만 센다. */
export function includeSubjectEnds(
  withdrawn: OverviewData["withdrawals"]["rows"],
  subjectEnded: readonly SubjectEndedRow[],
  window: { from: string; to: string },
  subjects: readonly ProgramSubject[],
  schoolGrade: (school: string | null, grade: string | null) => string | null,
): OverviewData["withdrawals"]["rows"] {
  const byStudent = new Map(withdrawn.map(row => [row.id, { ...row, kind: "withdrawn" as const }]));
  const extra: OverviewData["withdrawals"]["rows"] = [];
  for (const s of subjectEnded) {
    if (byStudent.has(s.id)) continue;
    const ended = s.endedDetail.filter(d => !d.isTransferred && inWithdrawalWindow({ withdrawnAt: d.endedAt, systemBulk: false }, window.from, window.to))
      .sort((a, b) => (b.endedAt ?? "").localeCompare(a.endedAt ?? "") || a.subject.localeCompare(b.subject));
    const latest = ended[0];
    if (!latest?.endedAt) continue;
    extra.push({ id: s.id, name: s.name, schoolGrade: schoolGrade(s.school, s.grade), withdrawnAt: latest.endedAt,
      program: withdrawalProgram({ lastClassSubject: latest.subject, lastClassEnglishTrack: latest.englishTrack }, subjects),
      kind: "subject-ended", className: ended.map(d => d.className).filter(Boolean).join(" · ") });
  }
  return [...byStudent.values(), ...extra].sort((a, b) => b.withdrawnAt.localeCompare(a.withdrawnAt) || a.name.localeCompare(b.name, "ko"));
}
