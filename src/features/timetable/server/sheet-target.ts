import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { sheetsProvider } from "@/features/integrations/sheets-provider";

/**
 * 과목에 연결된 구글 시트 — '시트에서 가져오기'의 두 읽기(수강편집 탭·시간표 격자 탭)가 같은 시트를 보게 하는 한 곳.
 * provider는 과목별(`sheetsProvider`)이고, `notifications.googleSheetId` 폴백은 **수학 전용**(옛 단일 연동)이다.
 */
export async function resolveImportSheet(
  subject: string,
): Promise<{ error: string } | { spreadsheetId: string; lastSyncedAt: string | null }> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("user_integrations")
    .select("spreadsheet_id, sync_enabled, last_synced_at")
    .eq("provider", sheetsProvider(subject))
    .maybeSingle();
  if (data?.sync_enabled !== true) {
    return { error: "구글 시트 연동이 꺼져 있습니다(학원 설정 › 연동에서 켜세요)" };
  }
  const legacyFallback =
    subject === "math" ? (await getTenantSettings()).notifications.googleSheetId.trim() : "";
  const spreadsheetId = data?.spreadsheet_id?.trim() || legacyFallback;
  if (!spreadsheetId) return { error: "대상 구글 시트가 설정되지 않았습니다(관리자에게 문의)" };
  return { spreadsheetId, lastSyncedAt: data?.last_synced_at ?? null };
}
