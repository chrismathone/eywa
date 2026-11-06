import "server-only";
/**
 * 학원 비서를 쓸 수 있는 사람 — 원장(`master`) · 슈퍼관리자(원장 2026-11-06 *"원장이상급"*).
 * - 강사뷰 중에는 막는다(업무 비서와 같은 까닭 — 대상 명의로 AI를 부르게 된다 · 2026-11-05 강사뷰 적대 리뷰).
 * - 운영 콘솔 '지점 보기'(읽기 전용) 중에도 막는다 — 보기 중에는 어떤 AI 호출도 내보내지 않는다(`requireAiLicense`와 같은 규칙).
 * 신원 = 로그인한 본인(`getCurrentUser()` — 강사뷰 X가 아니다). 판정은 세션 GET만 쓴다.
 */
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { viewAsTeacher } from "@/lib/auth/view-as";
import type { Owner } from "./store";

export type AssistantViewer = { user: CurrentUser; owner: Owner };
export type GateFailure = { error: string; status: number };

export async function assistantViewer(): Promise<AssistantViewer | GateFailure> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다", status: 401 };
  if (user.tenantView) return { error: "지점 보기 중에는 학원 비서를 쓸 수 없습니다", status: 403 };
  if (await viewAsTeacher()) return { error: "강사뷰에서는 학원 비서를 쓸 수 없습니다. 강사뷰를 끝내고 본인 화면에서 써 주세요", status: 403 };
  const allowed = user.systemRole === "master" || (await isCurrentUserSuperAdmin());
  if (!allowed) return { error: "학원 비서는 원장만 쓸 수 있습니다", status: 403 };
  return { user, owner: { tenantId: user.tenantId, userId: user.id } };
}

export const isGateFailure = (v: AssistantViewer | GateFailure): v is GateFailure => "error" in v;
