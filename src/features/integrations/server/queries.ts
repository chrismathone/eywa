import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";

export type IntegrationStatus = {
  connected: boolean;
  spreadsheetId: string | null;
  spreadsheetUrl: string | null;
  sharedWithEmail: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export async function getGoogleSheetsStatus(): Promise<IntegrationStatus> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_integrations")
    .select("spreadsheet_id, spreadsheet_url, shared_with_email, last_synced_at, last_error")
    .eq("provider", "google_sheets")
    .maybeSingle();

  // 전용 연동이 없으면 학원 설정 콘솔의 googleSheetId로 폴백(연결됨으로 표시).
  const settings = await getTenantSettings();
  const fallbackId = settings.notifications.googleSheetId.trim() || null;
  const spreadsheetId = data?.spreadsheet_id || fallbackId;

  return {
    connected: !!spreadsheetId,
    spreadsheetId,
    spreadsheetUrl: data?.spreadsheet_url ?? null,
    sharedWithEmail: data?.shared_with_email ?? null,
    lastSyncedAt: data?.last_synced_at ?? null,
    lastError: data?.last_error ?? null,
  };
}
