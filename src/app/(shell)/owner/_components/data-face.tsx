import { findOrphans } from "@/features/admin/server/queries";
import { CleanupClient } from "@/app/(shell)/admin/cleanup/_client";

/**
 * 데이터 정리 면 (owner ?tab=data) — 고아 데이터(수강 없는 재원생·스케줄 없는 반 등) 검출·정리.
 * 구 /admin/cleanup 본문을 owner FaceTabs 면으로 흡수. CleanupClient(클라)는 그대로 재사용.
 */
export async function DataFace() {
  const report = await findOrphans();
  return (
    <div className="space-y-4">
      <header className="border-border border-b pb-3">
        <p className="eyebrow">관리 · 데이터 정리</p>
        <h2 className="text-foreground text-lg font-bold">고아 데이터 점검</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          수강 없는 재원생·스케줄 없는 반 등 정합성이 깨진 데이터를 검출합니다.
        </p>
      </header>
      <CleanupClient report={report} />
    </div>
  );
}
