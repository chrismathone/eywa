import { getCurrentUser } from "@/lib/auth/current-user";
import { canPushToMakeedu } from "@/features/integrations/server/makeedu-push-access";
import { getUnpushedIntakeConsultations } from "@/features/integrations/server/makeedu-sync";
import { MakeeduPushButton } from "./makeedu-push-button";

/**
 * 콜&상담 머리글 'makeedu 보내기' — 후보 조회를 첫 페인트에서 떼어 낸다(B7, 공개 접수 QR과 같은 Suspense 모양).
 * 페이지가 같은 게이트로 이미 걸렀지만 여기서도 한 번 더 본다 — 이 컴포넌트를 다른 곳에 꽂아도 조회가 새지 않게
 * (권한 매트릭스는 요청 캐시라 추가 왕복 0). 🔴 조회는 서버 렌더에서만 — 셸에서 저절로 도는 서버 액션 금지(#137).
 */
export async function MakeeduPushSection() {
  const user = await getCurrentUser();
  if (!user || !(await canPushToMakeedu(user.systemRole))) return null;
  const candidates = await getUnpushedIntakeConsultations();
  return <MakeeduPushButton candidates={candidates} />;
}
