import { requireAccess } from "@/lib/auth/require-access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { RetentionTabs } from "@/features/retention/components/retention-tabs";
import { getCampaignBoard } from "@/features/retention/server/campaign-queries";
import { CampaignBoard } from "@/features/retention/components/campaign-board";

export const metadata = { title: "재등록 캠페인 — 에이와" };

export default async function RetentionCampaignPage() {
  const user = await requireAccess("retention");
  const tId = await effectiveTeacherId();
  const [board, canWrite] = await Promise.all([
    getCampaignBoard(tId ? { teacherId: tId } : undefined),
    // 추가·상태 전환·제거 게이트와 같은 판정 — 읽기 권한이면 보드만 보인다(원장 2026-11-05).
    canWriteTenant(user.systemRole, "retention"),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RetentionTabs />
        <span className="text-text-faint text-xs">
          재등록 위험 학생을 대상→연락→재등록 퍼널로 관리합니다.
        </span>
      </div>
      <CampaignBoard board={board} canWrite={canWrite} />
    </div>
  );
}
