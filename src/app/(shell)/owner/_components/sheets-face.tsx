import { getGoogleSheetsStatus } from "@/features/integrations/server/queries";
import { SheetsClient } from "@/app/(shell)/admin/integrations/sheets/_client";

/**
 * 연동 면 (owner ?tab=sheets) — Google Sheets 동기화(서비스 계정). 시간표를 시트로 내보낸다.
 * 구 /admin/integrations/sheets 본문을 owner FaceTabs 면으로 흡수. SheetsClient(클라)는 그대로 재사용.
 */
export async function SheetsFace() {
  const status = await getGoogleSheetsStatus();
  return (
    <div className="max-w-2xl space-y-4">
      <header className="border-border border-b pb-3">
        <p className="eyebrow">관리 · 외부 연동</p>
        <h2 className="text-foreground text-lg font-semibold">Google Sheets 동기화</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          시간표를 Google Sheets로 내보냅니다. eywa 서비스 계정이 시트를 소유하고, 입력한 이메일에
          편집 권한을 부여합니다.
        </p>
      </header>
      <SheetsClient status={status} />
    </div>
  );
}
