"use server";
/**
 * 요약 AI 정리의 **폴링용 경량 상태** — 생성 중일 때만 5초마다 부른다.
 *
 * 🔴 `router.refresh()`를 무조건 반복하면 그때마다 보드 전체(교시 100여 개 × 수강 수백 행)를 다시
 *    적재한다 — 3분이면 36번이고, 월요일(금·토·일)이면 그 3배다. 그래서 당일 출결 폴링
 *    (`getLiveRecordedCount`)과 같은 규약으로 **한 행만 읽어 값이 바뀐 순간에만** 화면을 다시 그린다(B2·B6).
 * 🔴 클라이언트가 부르므로 `"use server"` 파일에 둔다 — `server-only`인 queries.ts에 두면 번들이 깨진다([[#61]]).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";

/** `상태|생성시각` 지문. 권한 없음·조회 실패는 null(폴링이 조용히 멈춘다). */
export async function getRecapStatus(from: string, to: string): Promise<string | null> {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (!ymd.test(from) || !ymd.test(to)) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  if ((await accessLevelTenant(user.systemRole, "attendance")) !== "full") return null;
  const admin = createAdminClient();
  // ⚠️ admin은 RLS 우회 — tenant_id 명시 필터 필수([[#104]]).
  const { data, error } = await admin
    .from("attendance_day_recaps")
    .select("status, generated_at")
    .eq("tenant_id", user.tenantId)
    .eq("from_date", from)
    .eq("recap_date", to)
    .maybeSingle();
  if (error) return null;
  return `${data?.status ?? "idle"}|${data?.generated_at ?? ""}`;
}
