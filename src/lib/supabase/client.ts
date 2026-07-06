import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

export function createClient() {
  // env는 trim된 값(env.ts) — anon 키 끝 개행이 Realtime apikey를 오염시키던 이슈 방어.
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
