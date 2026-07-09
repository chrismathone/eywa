import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 수동 로그인 1건을 login_events(0082a)에 기록. **로그인 액션의 크리티컬 패스가 아니라 `after()`(응답 이후
 * 백그라운드)에서 호출**한다 — DB 지연/락이 로그인 응답을 절대 막지 않게(적대리뷰 HIGH, [[#10]] 로그인 흐름 보호).
 * 그래서 요청 쿠키에 의존하지 않는 **admin(service_role) 클라이언트**로 쓴다(after 콜백엔 세션 쿠키 컨텍스트가
 * 신선하지 않을 수 있음). 신원(userId)·ua·ip는 액션이 signInWithPassword 응답·headers에서 뽑아 넘긴다.
 * ⚠️ 모든 예외 삼킴 — 로그 실패가 로그인/이후 흐름에 영향 0.
 */
export async function recordLoginEvent(userId: string, userAgent: string | null, ip: string | null): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: u } = await admin
      .from("users")
      .select("tenant_id, display_name")
      .eq("id", userId)
      .single();
    if (!u) return;
    await admin.from("login_events").insert({
      tenant_id: u.tenant_id,
      user_id: userId,
      user_name: u.display_name,
      user_agent: userAgent,
      ip,
    });
  } catch {
    // 무시 — 감사 로그 실패가 인증 흐름을 막지 않음.
  }
}

/**
 * 신뢰 가능한 클라이언트 IP 선택 — 감사 참고용. x-forwarded-for의 좌측값은 **클라이언트가 위조 가능**하므로
 * 플랫폼(Vercel 등)이 강제 세팅하는 헤더를 우선한다(적대리뷰 LOW). 그래도 프록시 구성에 따라 비신뢰일 수 있어
 * "참고용"으로만 저장·표시.
 */
export function pickClientIp(h: Headers): string | null {
  const trusted = h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip");
  if (trusted) return trusted.split(",")[0]?.trim() || null;
  return (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || null;
}
