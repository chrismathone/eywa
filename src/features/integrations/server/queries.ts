import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { sheetsProvider } from "@/features/integrations/sheets-provider";

export type IntegrationStatus = {
  /** 내보낼 대상 시트가 설정돼 있는가(연동/폴백 googleSheetId). */
  connected: boolean;
  /** 구글 시트 내보내기 연동 ON/OFF(시간표 '시트' 버튼 노출 게이트). */
  enabled: boolean;
  spreadsheetId: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

/**
 * 과목별 구글 시트 연동 상태 — `sheetsProvider(subject)` 행 조회. subject 기본값 math(레거시 호환).
 * math는 대상 시트가 전용 행에 없으면 학원 설정 콘솔의 `notifications.googleSheetId`로 폴백(기존 운영 설정 보존).
 * 그 외 과목(영어 등)은 폴백 없음 — 전용 시트 ID를 등록해야 한다.
 */
export async function getGoogleSheetsStatus(subject: string = "math"): Promise<IntegrationStatus> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_integrations")
    .select("spreadsheet_id, last_synced_at, last_error, sync_enabled")
    .eq("provider", sheetsProvider(subject))
    .maybeSingle();

  let fallbackId: string | null = null;
  if (subject === "math") {
    const settings = await getTenantSettings();
    fallbackId = settings.notifications.googleSheetId.trim() || null;
  }
  const spreadsheetId = data?.spreadsheet_id || fallbackId;

  return {
    connected: !!spreadsheetId,
    enabled: data?.sync_enabled === true,
    spreadsheetId,
    lastSyncedAt: data?.last_synced_at ?? null,
    lastError: data?.last_error ?? null,
  };
}
