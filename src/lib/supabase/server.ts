import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";
import { tenantViewState } from "@/lib/auth/tenant-view";
import { TENANT_VIEW_HEADER } from "@/lib/auth/tenant-view-shared";
import { guardTenantViewFetch } from "./tenant-view-guard";

// React cache() dedupes per-request — every query in a single page render
// reuses the same client instance (and the same parsed cookie store).
export const createClient = cache(async () => {
  const cookieStore = await cookies();
  // 운영 콘솔의 '지점 보기'(읽기 전용) — 살아 있는 보기일 때만 토큰 헤더를 싣고, 쓰기 요청을 막는다.
  // 보기 쿠키가 없는 요청(= 평소의 모든 요청)은 `none`이라 아래 옵션이 한 글자도 달라지지 않는다.
  // 이 사람의 보기 쿠키가 남아 있는데 보기가 아니거나(`ended`) 확인하지 못한 요청(`unknown`)은 헤더 없이(= 본인 지점 그대로)
  // 쓰기만 막는다 — tenant-view.ts.
  const tv = await tenantViewState();

  return createServerClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      ...(tv.state === "live"
        ? { global: { headers: { [TENANT_VIEW_HEADER]: tv.view.token }, fetch: guardTenantViewFetch(() => true) } }
        : tv.state !== "none"
          ? { global: { fetch: guardTenantViewFetch(() => true) } }
          : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies; the middleware handles refresh
          }
        },
      },
    },
  );
});
