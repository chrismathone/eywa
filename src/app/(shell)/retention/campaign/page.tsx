import { requireAccess } from "@/lib/auth/require-access";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { RetentionTabs } from "@/features/retention/components/retention-tabs";
import { getCampaignBoard } from "@/features/retention/server/campaign-queries";
import { CampaignBoard } from "@/features/retention/components/campaign-board";

export const metadata = { title: "재등록 캠페인 — eywa" };

export default async function RetentionCampaignPage() {
  await requireAccess("retention");
  const tId = await effectiveTeacherId();
  const board = await getCampaignBoard(tId ? { teacherId: tId } : undefined);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RetentionTabs />
        <span className="text-text-faint text-[11px]">
          재등록 위험 학생을 대상→연락→재등록 퍼널로 관리합니다.
        </span>
      </div>
      <CampaignBoard board={board} />
    </div>
  );
}
