import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { tenantViewState } from "@/lib/auth/tenant-view";
import { closeTenantView } from "@/lib/auth/tenant-view-session";
import { safeLoginNext } from "@/lib/auth/login-next";

/**
 * 운영 콘솔의 '지점 보기'(읽기 전용) — **화면 맞추기**. 탭에 그려진 화면과 이 브라우저의 실제 상태가 어긋났을 때
 * 탭이 스스로 이 주소로 온다(tenant-view-sync.tsx). 여기서 서버가 지금 상태를 확인한다.
 *
 * - 보는 중이다 → 그 지점의 첫 화면으로(`/home`). 원래 주소로 돌려보내지 않는다 — 그 주소의 id는 다른 지점 것이다.
 * - 보는 중이 아니다(쿠키가 없거나 · 남의 것이거나 · 끝난 보기다) → 남은 쿠키를 지우고 돌려보낸다. 쿠키가 지워져 탭이 다시
 *   어긋났다고 보지 않는다. 돌아갈 곳: 그 탭이 본인 화면이었으면 원래 주소로, **보는 화면이었으면**(`from=view`) 운영 콘솔로 —
 *   보던 주소는 다른 지점 것이라 본인 화면에서는 뜻이 없다.
 * - 확인하지 못했다 → 아무것도 지우지 않고 원래 화면으로(그 화면이 오류로 멈춘다 — 잠시 뒤 다시 열면 다시 확인한다).
 *
 * 하는 일이 "확인하고 보낸다"뿐이라 GET이다. 돌아갈 주소는 같은 사이트의 경로만 받는다.
 */
export async function GET(request: NextRequest) {
  const next = safeLoginNext(request.nextUrl.searchParams.get("next")) ?? "/home";
  const fromView = request.nextUrl.searchParams.get("from") === "view";
  const state = (await tenantViewState()).state;
  if (state === "live") redirect("/home");
  if (state === "unknown") redirect(next);
  const tenantId = await closeTenantView();
  if (fromView) redirect(tenantId ? `/super-admin/tenants/${tenantId}` : "/super-admin/tenants");
  redirect(next);
}
