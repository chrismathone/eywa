"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import {
  createTenantSpreadsheet,
  pushTimetableToSheets,
} from "@/features/integrations/google-sheets";

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

  const supabase = await createClient();
  const { data } = await supabase
    .from("user_integrations")
    .select("spreadsheet_id")
    .eq("provider", "google_sheets")
    .maybeSingle();

  if (!data?.spreadsheet_id) return { error: "먼저 Google Sheets를 연결해주세요" };

  try {
    await pushTimetableToSheets(data.spreadsheet_id);
    await supabase
      .from("user_integrations")
      .update({
        last_synced_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("tenant_id", user.tenantId)
      .eq("provider", "google_sheets");

    revalidatePath("/admin/integrations/sheets");
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from("user_integrations")
      .update({ last_error: msg })
      .eq("tenant_id", user.tenantId)
      .eq("provider", "google_sheets");
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
