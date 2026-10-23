import { STUDENT_STATUS_LABEL } from "../status/status-labels";
import { isBookkeepingOnlyExit, isSystemBulkWithdrawal } from "@/features/withdrawals/system-bulk";

type Profile = { status: string; enrolled_at: string | null; withdrawn_at: string | null; withdrawal_metadata: unknown };
/** These are profile fields, not a complete status-transition ledger. */
export function describeStudentStatus(profile: Profile, hasEndedEnrollment: boolean, today: string) {
  const parts = [profile.enrolled_at ? `기록된 재원 시작일 ${profile.enrolled_at.slice(0, 10)}` : "재원 시작일 기록 없음"];
  if (profile.withdrawn_at) {
    const date = profile.withdrawn_at.slice(0, 10);
    if (isBookkeepingOnlyExit({ withdrawalMetadata: profile.withdrawal_metadata, hasEnrollmentHistory: hasEndedEnrollment })
      || isSystemBulkWithdrawal({ withdrawnAt: date, hasEnrollmentHistory: hasEndedEnrollment })) parts.push("장부 정리 기록 · 실제 퇴원일 확인 전");
    else if (date > today) parts.push(`퇴원 예정일 ${date}`);
    else if (profile.status === "withdrawn") parts.push(`기록된 퇴원일 ${date}`);
    else parts.push(`퇴원일 필드 ${date} · 현재 상태와 대조 필요`);
  } else if (profile.status === "withdrawn") parts.push("퇴원일 기록 없음");
  if (profile.status === "on_hold") parts.push("휴원 시작일은 이 자료로 확인할 수 없습니다");
  return { title: `현재 상태 · ${STUDENT_STATUS_LABEL[profile.status] ?? "확인 필요"}`, detail: parts.join(" · ") };
}
