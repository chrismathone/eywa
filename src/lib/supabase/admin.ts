import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Admin (service-role) Supabase client. Bypasses RLS — only use from server
 * code that has already verified its own auth (e.g. AssemblyAI webhook after
 * shared-secret check, or internal cron jobs). Never expose to the browser.
 */
export function createAdminClient() {
  // trim — 배포 env 값에 실수로 섞인 앞뒤 공백/개행 방어(anon 키 개행이 Realtime을 깨뜨린 이슈와 동류).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Supabase admin env missing");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
