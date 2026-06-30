"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { overwriteMathTimetableSheet } from "@/features/integrations/google-sheets";
import { buildMathTimetableBuffer } from "@/features/exports/math-timetable/build-buffer";

export type ToggleState = { error?: string; enabled?: boolean } | undefined;

/**
 * 구글 시트 내보내기 연동 ON/OFF (master 전용). `user_integrations.sync_enabled`를 토글.
 * 켜면 **시간표 화면에 '시트' 버튼**이 노출되고(원장), 그 버튼이 `syncSheetsNow`를 호출한다.
 * 대상 스프레드시트·서비스 계정(`GOOGLE_SERVICE_ACCOUNT_KEY`)은 운영자가 설정 — 학원장은 ON/OFF만.
 */
export async function setSheetsExportEnabled(enabled: boolean): Promise<ToggleState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (user.systemRole !== "master") {
    return { error: "구글 시트 연동은 원장(master)만 변경할 수 있습니다" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("user_integrations").upsert(
    {
      tenant_id: user.tenantId,
      provider: "google_sheets",
      sync_enabled: enabled,
    },
    { onConflict: "tenant_id,provider" },
  );
  if (error) return { error: error.message };

  // 시간표 '시트' 버튼 노출이 이 값에 달려 있으므로 둘 다 재검증.
  revalidatePath("/owner");
  revalidatePath("/timetable");
  return { enabled };
}

/**
 * makeedu 자동 동기화(GitHub Actions cron) ON/OFF (master 전용). `user_integrations(provider=makeedu).sync_enabled` 토글.
 * cron 오케스트레이터(sync-all.cjs)가 매 실행 시작에 이 값을 읽어 false면 스킵한다(행 없으면 기본 ON).
 */
export async function setMakeeduSyncEnabled(enabled: boolean): Promise<ToggleState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (user.systemRole !== "master") {
    return { error: "makeedu 자동 동기화는 원장(master)만 변경할 수 있습니다" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("user_integrations").upsert(
    {
      tenant_id: user.tenantId,
      provider: "makeedu",
      sync_enabled: enabled,
    },
    { onConflict: "tenant_id,provider" },
  );
  if (error) return { error: error.message };

  revalidatePath("/owner");
  return { enabled };
}

export type SyncState = { error?: string; ok?: boolean } | undefined;

export async function syncSheetsNow(
  _prev: SyncState,
  _formData: FormData,
): Promise<SyncState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // ⚠️ master 전용 (CLAUDE.md #58: 페이지가 아니라 액션을 게이트). 이 동기화는 **테넌트 전체 수학
  // 시간표**(전 강사·전 학생 명단)를 외부 공유 시트로 내보내므로 원장만. 버튼 숨김과 이중 방어.
  if (user.systemRole !== "master") {
    return { error: "구글 시트 동기화는 원장(master)만 할 수 있습니다" };
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("user_integrations")
    .select("spreadsheet_id, sync_enabled")
    .eq("provider", "google_sheets")
    .maybeSingle();

  // 연동이 꺼져 있으면 거부(시간표 '시트' 버튼도 같은 조건으로 숨김 — 이중 방어).
  if (data?.sync_enabled !== true) {
    return { error: "구글 시트 내보내기 연동이 꺼져 있습니다(학원 설정 › 연동에서 켜세요)" };
  }

  // 대상 시트: 전용 연동 spreadsheet_id 또는 학원 설정 googleSheetId(운영자 설정) 폴백.
  const settings = await getTenantSettings();
  const spreadsheetId = data?.spreadsheet_id || settings.notifications.googleSheetId.trim();
  if (!spreadsheetId)
    return { error: "내보낼 구글 시트가 설정되지 않았습니다(관리자에게 문의)" };

  try {
    // 수학 시간표 = ijw 충실 익스포터 → 운영자가 미리 만들어 서비스계정에 공유한 기존 구글 시트에
    // 통째 덮어쓰기(ijw updateSheetContent 방식). 서비스계정 용량 0이라 '생성'은 불가 → '갱신'만.
    // master 전용이라 전체(unscoped) 내보내기가 정당(전 강사·전 학생). 대상 시트=테넌트 전용 1개 가정.
    const buffer = await buildMathTimetableBuffer();
    await overwriteMathTimetableSheet(spreadsheetId, buffer);
    await supabase.from("user_integrations").upsert(
      {
        tenant_id: user.tenantId,
        provider: "google_sheets",
        spreadsheet_id: spreadsheetId,
        last_synced_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "tenant_id,provider" },
    );

    revalidatePath("/owner");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // best-effort: 즉시 토스트(return)가 1차 피드백 채널이고, 이 upsert는 다음 로드 때 보일 durable
    // last_error 보존용. 이 쓰기 자체가 실패해도(RLS 엣지·일시) 토스트는 떠 사용자에게 오류가 전달된다.
    await supabase.from("user_integrations").upsert(
      {
        tenant_id: user.tenantId,
        provider: "google_sheets",
        spreadsheet_id: spreadsheetId,
        last_error: msg,
      },
      { onConflict: "tenant_id,provider" },
    );
    return { error: msg };
  }
}
