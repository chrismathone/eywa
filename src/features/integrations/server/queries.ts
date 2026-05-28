import "server-only";
import { createClient } from "@/lib/supabase/server";

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

  if (!data) {
    return {
      connected: false,
      spreadsheetId: null,
      spreadsheetUrl: null,
      sharedWithEmail: null,
      lastSyncedAt: null,
      lastError: null,
    };
  }

  return {
    connected: !!data.spreadsheet_id,
    spreadsheetId: data.spreadsheet_id,
    spreadsheetUrl: data.spreadsheet_url,
    sharedWithEmail: data.shared_with_email,
    lastSyncedAt: data.last_synced_at,
    lastError: data.last_error,
  };
}
