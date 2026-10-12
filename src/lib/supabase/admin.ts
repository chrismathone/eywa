import "server-only";
import { createClient } from "@supabase/supabase-js";
import { unstable_rethrow } from "next/navigation";
import { guardTenantViewFetch } from "./tenant-view-guard";

function adminEnv(): { url: string; key: string } {
  // trim — 배포 env 값에 실수로 섞인 앞뒤 공백/개행 방어(anon 키 개행이 Realtime을 깨뜨린 이슈와 동류).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("Supabase admin env missing");
  return { url, key };
}

/**
 * 운영 콘솔의 '지점 보기'(읽기 전용) 중인 요청인가 — **쓰기 요청일 때만** 불린다.
 * 요청 밖(cron 본문 · 웹훅의 백그라운드 · 캐시 함수 · 스크립트)에서는 쿠키를 읽을 수 없어 false다.
 * 동적 import인 이유: 이 파일은 요청과 무관한 곳(cron · 웹훅)도 쓰므로, 보기 판정 모듈을 쓰기 직전에만 싣는다
 * (tenant-view.ts가 이 파일을 import하므로 순환도 함께 피한다).
 */
async function isViewingTenant(): Promise<boolean> {
  try {
    const { isTenantViewWriteBlocked } = await import("@/lib/auth/tenant-view");
    // 보는 중이거나, 보기 쿠키가 있는데 확인하지 못한 요청이면 막는다(사람 · 헤더와 같은 판정 — 한 요청에 한 번만 계산된다).
    return await isTenantViewWriteBlocked();
  } catch (e) {
    // Next가 흐름 제어에 쓰는 신호(정적 렌더 중단 등)는 삼키지 않는다.
    unstable_rethrow(e);
    return false;
  }
}

/**
 * Admin (service-role) Supabase client. Bypasses RLS — only use from server
 * code that has already verified its own auth (e.g. AssemblyAI webhook after
 * shared-secret check, or internal cron jobs). Never expose to the browser.
 *
 * 🔴 운영 콘솔의 '지점 보기'(읽기 전용) 중인 요청에서는 **쓰기가 막힌다**(tenant-view-guard.ts). 이 클라이언트는 RLS를
 *    우회하므로, 보는 지점의 데이터가 바뀌지 않게 하는 벽은 여기뿐이다. 읽기와, 보기와 무관한 요청은 종전 그대로다
 *    (쓰기 요청마다 쿠키 한 번 읽기가 더해질 뿐이다).
 */
export function createAdminClient() {
  const { url, key } = adminEnv();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: guardTenantViewFetch(isViewingTenant) },
  });
}

/**
 * 가드 없는 service-role 클라이언트 — **보기 자체를 다루는 코드 전용**(보기 기록 읽기 · 끝내기).
 * 🔴 지점 데이터를 쓰는 코드에서 쓰지 말 것. 보기 중 쓰기 차단이 통째로 빠진다(가드: tenant-view-wiring.test.ts가 사용처를 잠근다).
 */
export function createRawAdminClient() {
  const { url, key } = adminEnv();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
