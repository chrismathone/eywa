import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";

export type IntegrationStatus = {
  /** 내보낼 대상 시트가 설정돼 있는가(연동/폴백 googleSheetId). */
  connected: boolean;
  /** 구글 시트 내보내기 연동 ON/OFF(시간표 '시트' 버튼 노출 게이트). */
  enabled: boolean;
  spreadsheetId: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export async function getGoogleSheetsStatus(): Promise<IntegrationStatus> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_integrations")
    .select("spreadsheet_id, last_synced_at, last_error, sync_enabled")
    .eq("provider", "google_sheets")
    .maybeSingle();

  // 대상 시트가 전용 연동에 없으면 학원 설정 콘솔의 googleSheetId로 폴백(운영자가 설정).
  const settings = await getTenantSettings();
  const fallbackId = settings.notifications.googleSheetId.trim() || null;
  const spreadsheetId = data?.spreadsheet_id || fallbackId;

  return {
    connected: !!spreadsheetId,
    enabled: data?.sync_enabled === true,
    spreadsheetId,
    lastSyncedAt: data?.last_synced_at ?? null,
    lastError: data?.last_error ?? null,
  };
}

/** 시간표 '시트' 버튼 노출 게이트 — 구글 시트 내보내기 연동이 켜져 있는가(경량 조회). */
export async function isGoogleSheetsExportEnabled(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_integrations")
    .select("sync_enabled")
    .eq("provider", "google_sheets")
    .maybeSingle();
  return data?.sync_enabled === true;
}
