"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { logAction } from "@/features/audit/server/log";
import { FLOW_KINDS, type FlowKind } from "../flow-insight";
import { refreshFlowInsight } from "./flow-insights";

export type FlowRefreshState = { ok: true; status: "updated" | "unchanged" | "empty" } | { ok: false; error: string };

/**
 * '다시 분석'(명시 버튼) — 원생상담 **쓰기** 권한(원장·관리자). 강사(scoped)는 자기 상담만 보는 사람이라 합산 분석을 돌리지 못한다.
 * 유료 호출이라 감사로그를 남긴다(결과 상태만 — 분석 본문은 담지 않는다).
 */
export async function requestFlowInsight(studentId: string, kind: FlowKind): Promise<FlowRefreshState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "consultations"))) return { ok: false, error: "원생상담 관리 권한이 있어야 분석을 돌릴 수 있습니다" };
  if (!studentId || !(FLOW_KINDS as readonly string[]).includes(kind)) return { ok: false, error: "대상이 올바르지 않습니다" };
  const result = await refreshFlowInsight({ tenantId: user.tenantId, studentId, kind, reason: "manual" });
  await logAction({
    action: "student_flow_insight_refresh",
    targetType: "student",
    metadata: { studentId, kind, status: result.status },
  });
  if (result.status === "failed") return { ok: false, error: result.error.includes("라이선스") || result.error.includes("license") ? "이 학원은 AI 분석을 쓸 수 없습니다" : `분석하지 못했습니다: ${result.error}` };
  revalidatePath(`/explore/student/${studentId}`);
  return { ok: true, status: result.status };
}
