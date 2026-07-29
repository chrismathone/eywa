"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

/**
 * 등록상담 총건수만 돌려주는 **초경량 폴링용 액션** — 목록 자동 갱신의 신호원.
 *
 * ⚠️ 왜 Realtime이 아니라 폴링인가(2026-07-29 실측): `enrollment_consultations`를 supabase_realtime
 * 발행에 넣고 브라우저에서 구독하면 채널은 **SUBSCRIBED까지 가지만 이벤트가 한 건도 오지 않는다.**
 * service_role로 구독하면 정상 수신되므로 인프라 문제가 아니라 **postgres_changes의 RLS 인가**가
 * 막는 것 — 이 테이블 정책이 `tenant_id = auth_tenant_id()`이고, 그 함수가 `users` 테이블을 조회하는
 * 형태라 Realtime의 인가 평가 컨텍스트에서 통과하지 못한다(조용히 무전송이라 더 위험한 실패 모드).
 * → 확실히 동작하는 폴링으로 간다. 무거운 칸반 쿼리는 **건수가 실제로 늘었을 때만** 다시 돈다.
 *
 * `count: exact, head: true`라 행을 받지 않는다(B2). 테넌트 격리는 RLS가 건다.
 */
export async function getConsultationTotalCount(): Promise<number | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("enrollment_consultations")
    .select("*", { count: "exact", head: true });
  if (error) {
    console.error("[enrollment] 건수 폴링 실패", error);
    return null;
  }
  return count ?? 0;
}
