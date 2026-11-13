import "server-only";
/**
 * 학원 비서를 쓸 수 있는 사람 — 학원 설정 → 역할·권한의 **'학원 비서' 권한**(`assistant` · 기본 = 원장만, 원장 2026-11-09
 * *"역할에 '비서 추가' 권한은 없네. 기본 디폴트로 원장하고 나머지 비활성화"*) · 운영 계정은 늘 통과(결정 로그 2026-08-13).
 * - 강사뷰 중에는 막는다(업무 비서와 같은 까닭 — 대상 명의로 AI를 부르게 된다 · 2026-11-05 강사뷰 적대 리뷰).
 * - 운영 콘솔 '지점 보기'(읽기 전용) 중에도 막는다 — 보기 중에는 어떤 AI 호출도 내보내지 않는다(`requireAiLicense`와 같은 규칙).
 * 신원 = 로그인한 본인(`getCurrentUser()` — 강사뷰 X가 아니다). 판정은 세션 GET만 쓴다.
 * 🔴 화면도 이 함수로 단추를 세운다(셸 레이아웃 — 사이드바·폰 위쪽 줄 단추 · 오버레이 · 창 안 단축키) — 화면엔 보이는데 서버가 막거나
 *    그 반대가 되지 않게 판정은 여기 한 곳이다([[#77]]). 권한은 `canAccessTenant`(학원 설정·개인별 권한 반영 — [[#58]]).
 * 비서가 읽는 자료는 묻는 사람의 권한 범위 안뿐이다(`scopedViewer` → 증표의 묶음 키 · s2_0096). 권한 칸 자체는 전체·없음만 쓴다(`isOnOffMenu` — 쓰나 마나).
 */
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { viewAsTeacher } from "@/lib/auth/view-as";
import { AssistantError } from "./agent";
import { viewerScopeKeys } from "./scope";
import type { Owner } from "./store";

export type AssistantViewer = { user: CurrentUser; owner: Owner };
export type GateFailure = { error: string; status: number };

export async function assistantViewer(): Promise<AssistantViewer | GateFailure> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다", status: 401 };
  if (user.tenantView) return { error: "지점 보기 중에는 학원 비서를 쓸 수 없습니다", status: 403 };
  if (await viewAsTeacher()) return { error: "강사뷰에서는 학원 비서를 쓸 수 없습니다. 강사뷰를 끝내고 본인 화면에서 써 주세요", status: 403 };
  const allowed = (await canAccessTenant(user.systemRole, "assistant")) || (await isCurrentUserSuperAdmin());
  if (!allowed) return { error: "학원 비서를 쓸 권한이 없습니다", status: 403 };
  return { user, owner: { tenantId: user.tenantId, userId: user.id } };
}

export const isGateFailure = (v: AssistantViewer | GateFailure): v is GateFailure => "error" in v;

/**
 * 문 + 지금 권한 범위(묶음 키) — 자료를 읽거나 저장된 답을 내보내는 모든 자리가 쓴다(질문 · 대화 다시 열기 · 의견 · 추천 질문).
 * 🔴 권한을 읽지 못하면 기본값으로 넓히지 않고 멈춘다(Codex 합의 9).
 */
export async function scopedViewer(): Promise<(AssistantViewer & { scope: string[] }) | GateFailure> {
  const viewer = await assistantViewer();
  if (isGateFailure(viewer)) return viewer;
  try {
    return { ...viewer, scope: await viewerScopeKeys(viewer.user) };
  } catch (error) {
    return { error: error instanceof AssistantError ? error.message : "권한을 확인하지 못했습니다. 잠시 뒤 다시 물어봐 주세요", status: 503 };
  }
}
