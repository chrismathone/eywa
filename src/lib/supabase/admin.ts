import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Admin (service-role) Supabase client. Bypasses RLS — only use from server
 * code that has already verified its own auth (e.g. AssemblyAI webhook after
 * shared-secret check, or internal cron jobs). Never expose to the browser.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin env missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
