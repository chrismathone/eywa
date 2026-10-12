import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { tenantViewState } from "@/lib/auth/tenant-view";
import { closeTenantView } from "@/lib/auth/tenant-view-session";
import { expectedTenantFromMark, isUuid, parseTenantViewMark, TENANT_VIEW_CLIENT_EXTRA_CUTOFF_MS, TENANT_VIEW_MARK_COOKIE } from "@/lib/auth/tenant-view-shared";

/**
 * 운영 콘솔의 '지점 보기'(읽기 전용) 끝내기 — 보기 기록을 닫고 쿠키를 지운 뒤 운영 콘솔의 그 학원으로 돌아간다.
 *
 * GET인 이유: 보기 중에는 쓰기 요청이 전부 막히므로(읽기 전용) 끝내기는 주소 이동이어야 한다. 하는 일이 "보기를 끝낸다"뿐이라
 * 남이 이 주소로 보내도 잃는 것이 없다. 링크는 미리 불러오지 않게 `<a>`로 건다(미리 불러오면 보기가 저절로 끝난다).
 * 토큰은 쿠키에서만 읽는다 — 주소로 받지 않는다.
 *
 * 보기가 이미 끝난 뒤(만료 · 다른 탭에서 끝냄)에 와도 같다: 남은 쿠키를 지우고 콘솔로 보낸다. 콘솔에 들어갈 수 없는 사람이면
 * 콘솔의 문지기가 그 사람의 첫 화면으로 돌려보낸다.
 *
 * 저절로 끝난 보기를 정리하러 온 요청(`?why=ended` — 화면 감시나 서버가 보낸다)이면 그 학원 화면에 "보기가 끝났다"는 안내를 띄운다.
 *
 * 🔴 그런 요청은 **한 번 더 확인하고** 닫는다 — "끝났다"는 판정은 그 요청이 떠날 때의 옛 쿠키를 두고 한 것인데, 여기 닿을 때의
 *    쿠키는 그사이 다른 탭에서 **새로 연 보기**의 것일 수 있다(그대로 닫으면 "열었는데 바로 끝남"). 서버가 살아 있는 보기라 하고
 *    이 브라우저의 표식도 그렇게 말하면(화면 감시와 같은 기준) 닫지 않고 그 지점의 첫 화면으로 보낸다.
 *    사람이 누른 '보기 끝내기'(`why` 없음)는 묻지 않고 닫는다.
 *
 * 돌아갈 학원: 쿠키의 보기 기록에서 읽는다. 쿠키가 이미 없으면(같은 순간에 온 다른 끝내기 요청이 먼저 지웠다 — 화면 이동과 화면
 * 감시가 함께 올 수 있다) 화면 감시가 실어 준 보던 지점(`t=`)으로 간다. 그 값은 **돌아갈 곳의 힌트일 뿐**이다 — 그 화면을
 * 볼 수 있는지는 운영 콘솔의 문지기가 따로 본다.
 */
export async function GET(request: NextRequest) {
  const ended = request.nextUrl.searchParams.get("why") === "ended";
  if (ended) {
    const tv = await tenantViewState();
    if (tv.state === "live") {
      const mark = parseTenantViewMark((await cookies()).get(TENANT_VIEW_MARK_COOKIE)?.value);
      // 화면 감시가 지금 이 표식을 보면 '보는 중'이라 할 것인가 — 그렇지 않으면(표식이 없다 · 끝나 간다) 보내 봐야 다시 이리로 온다.
      const tabWouldAgree = expectedTenantFromMark(mark, tv.view.operatorId, Date.now() + 2 * TENANT_VIEW_CLIENT_EXTRA_CUTOFF_MS) === tv.view.tenantId;
      if (tabWouldAgree) redirect("/home");
    }
  }
  const hint = request.nextUrl.searchParams.get("t");
  const tenantId = (await closeTenantView()) ?? (isUuid(hint) ? hint.toLowerCase() : null);
  if (!tenantId) redirect("/super-admin/tenants");
  redirect(`/super-admin/tenants/${tenantId}${ended ? "?view=ended" : ""}`);
}
