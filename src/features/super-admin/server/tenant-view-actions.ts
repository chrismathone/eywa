"use server";

import { requireSuperAdmin } from "@/lib/auth/super-admin";
import { createRawAdminClient } from "@/lib/supabase/admin";
import { recordSuperAdminAction } from "./audit";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/auth/tenant-view-shared";
import { dbHonorsTenantView } from "@/lib/auth/tenant-view";
import { createTenantViewRow, endTenantViewRow, setTenantViewCookies } from "@/lib/auth/tenant-view-session";

/**
 * 운영 콘솔 → 그 지점의 화면을 **읽기 전용**으로 연다(원장 2026-10-12 *"admin 페이지에서 이어질때 '읽기 전용' 원장뷰"*).
 *
 * 하는 일: ① 보기 기록 한 줄(누가 · 어느 지점 · 언제까지) ② DB가 그 보기를 받아 주는지 확인 ③ 운영 감사 로그 ④ 이 브라우저에 쿠키.
 * 그 뒤의 읽기 전용은 DB(0356a)와 데이터 접근 층(tenant-view-guard.ts)이 지킨다 — 여기서는 문만 연다.
 *
 * 🔴 **이동하지 않고 결과만 돌려준다** — 그 지점의 첫 화면(`/home`)으로 가는 것은 버튼이 문서 이동으로 한다
 *    (`_open-view-button.tsx`). 여기서 `redirect()`하면 Next가 그 주소를 서버에서 대신 받아 와 화면만 갈아 끼우고
 *    (소프트 이동), 이 탭이 앞서 그려 둔 본인 지점 화면들이 캐시에 남는다. 지점이 바뀌는 순간에는 문서를 새로 연다([[#102]]).
 * 🔴 실패하면 **아무것도 남기지 않는다** — 쿠키는 마지막에 쓰고, 그 전에 그만두면 방금 만든 기록만 닫는다.
 *    이 브라우저의 앞선 보기(있다면)는 그대로다.
 * 🔴 **들어간 기록(운영 감사 로그)을 남기지 못하면 열지 않는다** — 기록 없이 남의 지점 화면에 들어간 일이 생기지 않게.
 * 🔴 운영 콘솔 주소에서는 보기가 적용되지 않으므로(`isOperatorConsolePath`) 이 액션의 쓰기는 평소대로 된다.
 */
export async function startTenantView(tenantId: string): Promise<{ ok: boolean }> {
  const sa = await requireSuperAdmin();
  if (!isUuid(tenantId)) return { ok: false };

  const { data: tenant } = await createRawAdminClient().from("tenants").select("id, name").eq("id", tenantId).maybeSingle();
  if (!tenant) return { ok: false };

  // 열지 못했으면(보기 기록 표가 아직 없는 등) 버튼이 학원 상세로 돌아가 사유를 보여 준다.
  const opened = await createTenantViewRow(sa.id, tenant.id as string);
  if (!opened) return { ok: false };

  // 🔴 문을 열기 전에 **DB가 실제로 그 지점으로 답하는지** 한 번 물어본다. 아니라면(헤더가 DB에 닿는 모양이 달라졌거나 DB 쪽 준비가
  //    안 됐거나) 여기서 닫는다 — 그대로 들여보내면 '읽기 전용 보기' 화면이 아니라 운영 콘솔로 되돌아온다.
  //    물어보지 못한 경우(통신 실패)는 들여보낸다 — 지점 화면 쪽 판정이 요청마다 같은 것을 다시 묻는다(tenant-view.ts).
  const { data: sessionData } = await (await createClient()).auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (accessToken && (await dbHonorsTenantView(accessToken, opened.token, tenant.id as string)) === false) {
    await endTenantViewRow(opened.token, sa.id);
    return { ok: false };
  }
  const logged = await recordSuperAdminAction({
    actorId: sa.id,
    actorEmail: sa.email,
    action: "impersonate_view",
    targetTenantId: tenant.id as string,
    targetLabel: tenant.name as string,
    metadata: { mode: "screen", expiresAt: opened.expiresAt },
  });
  if (!logged) {
    await endTenantViewRow(opened.token, sa.id);
    return { ok: false };
  }
  // 확인과 기록이 끝난 뒤에야 이 브라우저에 쿠키를 쓴다(이 브라우저의 앞선 보기는 이때 닫힌다).
  await setTenantViewCookies(opened, sa.id, tenant.id as string);

  return { ok: true };
}
