import "server-only";
import { logAction } from "@/features/audit/server/log";
import { protectionRefusal, protectionStatus } from "@/lib/auth/protected-accounts";

/**
 * 직원 역할·재직 상태·삭제 경로의 **보호 계정 문**(원장 2026-09-30 "강력 가드") — 대상이 보호 계정이면 거절 문구를
 * 돌려주고 **시도 자체를 감사로그에 남긴다**. 명단 조회가 실패하면 재시도 문구로 막되 **감사로그는 남기지 않는다**
 * (보호 대상이 아닌 사람 이름으로 거짓 '거절' 기록이 생긴다). 통과면 null. 행위자가 원장·총괄이어도 막는다.
 */
export async function refuseIfProtectedStaff(
  targetId: string,
  attempt: "role" | "status" | "delete",
  targetLabel?: string | null,
): Promise<string | null> {
  const status = await protectionStatus(targetId);
  if (status === "protected") {
    await logAction({
      action: "staff_protected_refused",
      targetType: "staff",
      targetLabel: targetLabel ?? null,
      metadata: { userId: targetId, attempt },
    });
  }
  return protectionRefusal(status);
}
