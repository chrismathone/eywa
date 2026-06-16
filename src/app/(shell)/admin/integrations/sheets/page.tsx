import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { getGoogleSheetsStatus } from "@/features/integrations/server/queries";
import { SheetsClient } from "./_client";

export const metadata = { title: "Google Sheets 동기화 — eywa" };

export default async function SheetsIntegrationPage() {
  await requireAccess("admin");

  const status = await getGoogleSheetsStatus();

  return (
    <div className="space-y-6">
      <BackLink href="/dashboard" label="대시보드로" />

      <header className="border-border border-b pb-5">
        <p className="eyebrow">관리 · 외부 통합</p>
        <h1 className="display text-foreground text-2xl">Google Sheets 동기화</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          시간표를 Google Sheets로 내보냅니다. eywa의 서비스 계정이 시트를 소유하고,
          입력한 이메일에 편집 권한을 부여합니다.
        </p>
      </header>

      <SheetsClient status={status} />
    </div>
  );
}
