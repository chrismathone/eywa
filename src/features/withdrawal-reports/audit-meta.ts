import type { WithdrawalReport } from "./model";

/**
 * 퇴원보고서 감사로그의 **처리 결과** 칸(2026-10-23) — 이 동작으로 퇴원·수강 종료가 실제로 끝났는지, 처리일로 예약됐는지.
 * 마지막 승인은 DB 트랜잭션 안에서 수강 종료·퇴원까지 하는데 기록에는 '승인'만 남아, 누가 퇴원시켰는지 보려면 보고서를 열어야 했다.
 * 승인 화면(즉시 처리, actions.ts)과 처리일 cron(scheduled.ts)이 같은 모양을 남긴다.
 * `endedIds` = 끝낸 수강(`completedEnrollmentIds` — 수학 퇴원 시트 기록과 같은 값). 못 읽었으면 null — 결과만 남긴다.
 */
export function appliedAuditMeta(
  r: Pick<WithdrawalReport, "status" | "exit_kind" | "student_id" | "snapshot">,
  endedIds: string[] | null,
): Record<string, unknown> {
  if (r.status === "scheduled") return { result: "처리 예약" };
  if (r.status !== "completed") return {};
  const classes = (endedIds ?? []).flatMap((id) => r.snapshot.courses.find((c) => c.id === id)?.className ?? []);
  return {
    result: r.exit_kind === "withdrawal" ? "학생 퇴원" : "수강 종료",
    studentId: r.student_id,
    ...(endedIds ? { enrollmentIds: endedIds, endedClasses: classes } : {}),
  };
}
