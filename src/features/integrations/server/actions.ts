"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import {
  createTenantSpreadsheet,
  pushMathTimetableTabs,
} from "@/features/integrations/google-sheets";
import { buildMathTimetableBuffer } from "@/features/exports/math-timetable/build-buffer";

export type ConnectState = { error?: string; url?: string } | undefined;

export async function connectGoogleSheets(
  _prev: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "공유할 Google 이메일을 입력해주세요" };

  try {
    const { spreadsheetId, url } = await createTenantSpreadsheet(
      user.tenantId.slice(0, 8),
      email,
    );

    const supabase = await createClient();
    await supabase.from("user_integrations").upsert(
      {
        tenant_id: user.tenantId,
        provider: "google_sheets",
        spreadsheet_id: spreadsheetId,
        spreadsheet_url: url,
        shared_with_email: email,
        last_error: null,
      },
      { onConflict: "tenant_id,provider" },
    );

    revalidatePath("/admin/integrations/sheets");
    return { url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export type SyncState = { error?: string; ok?: boolean } | undefined;

export async function syncSheetsNow(
  _prev: SyncState,
  _formData: FormData,
): Promise<SyncState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // ⚠️ 게이트는 페이지가 아니라 액션에서(CLAUDE.md #58). 이 동기화는 **테넌트 전체 수학 시간표**(전
  // 강사·전 학생 명단)를 외부 공유 시트로 내보내므로 master 전용이다. 액션이 owner 콘솔(master 게이트)
  // 외에 /timetable 툴바에서도 호출돼, 게이트가 없으면 강사·readonly가 전체 로스터를 외부로 push할 수
  // 있었다(intra-tenant PII 누수 + 권한 위반). UI 버튼 숨김(toolbar-actions canSync)과 이중 방어.
  if (user.systemRole !== "master") {
    return { error: "구글 시트 동기화는 원장(master)만 할 수 있습니다" };
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("user_integrations")
    .select("spreadsheet_id")
    .eq("provider", "google_sheets")
    .maybeSingle();

  // 전용 연동(connect 플로우)이 없으면 학원 설정 콘솔의 googleSheetId로 폴백.
  // (수동 입력한 시트는 서비스계정과 공유돼 있어야 push 성공 — 실패 시 last_error로 노출.)
  const settings = await getTenantSettings();
  const spreadsheetId = data?.spreadsheet_id || settings.notifications.googleSheetId.trim();
  if (!spreadsheetId)
    return { error: "먼저 Google Sheets를 연결하거나 학원 설정에서 시트 ID를 입력해주세요" };

  try {
    // 수학 시간표 = ijw 충실 익스포터 → 공유 시트에 eywa·{tenant}· 접두 탭으로 비파괴 추가(기존 탭
    // 보존). master 전용이라 전체(unscoped) 내보내기가 정당(전 강사·전 학생). 토큰=테넌트별 탭 격리.
    const buffer = await buildMathTimetableBuffer();
    await pushMathTimetableTabs(spreadsheetId, buffer, user.tenantId.slice(0, 8));
    // upsert(.update 아님) — 학원 설정 googleSheetId 폴백 테넌트는 user_integrations 행이 없어
    // .update가 0행 no-op 되어 동기 시각/오류가 화면에 안 떴다(#피드백 손실). connectGoogleSheets와 동일 패턴.
    // spreadsheet_url/shared_with_email은 넣지 않아 폴백 의미(연결흐름 아님)를 보존.
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

    revalidatePath("/admin/integrations/sheets");
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

export type DisconnectState = { error?: string } | undefined;

export async function disconnectSheets(
  _prev: DisconnectState,
  _formData: FormData,
): Promise<DisconnectState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("user_integrations")
    .delete()
    .eq("tenant_id", user.tenantId)
    .eq("provider", "google_sheets");

  if (error) return { error: error.message };

  revalidatePath("/admin/integrations/sheets");
  return undefined;
}
