import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { kstToday } from "@/lib/date-kst";
import { fetchInChunks } from "@/lib/supabase/batch";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 퇴사한 강사의 퇴사일 — `users`에 퇴사일 칸이 없어 학원 비서와 같은 순서로 찾는다(`assistant/server/prompt.ts` '재직 기간 끝'):
 * ① 계약 이력의 퇴사 메모(`staff_contracts` kind='note' · terms에 '퇴사' · start_date — 직원관리 퇴사 처리가 남기는 줄) 중 가장 늦은 날
 * ② 없으면 퇴사 처리 감사 기록(`audit_logs` staff_status_change → inactive)의 날(한국 날짜 — 실제보다 늦게 처리했을 수 있다)
 * ③ 둘 다 없으면 모른다(null — 자르지 않는다: 근무한 달을 지우는 쪽이 더 나쁘다).
 * 🔴 admin으로 읽는다 → tenant_id 필수(#104). 대상은 재직 중이 아닌 사람만 넘긴다(복직한 사람의 옛 퇴사 줄로 자르지 않게).
 */
export async function loadResignDates(admin: SupabaseClient, tenantId: string, userIds: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!userIds.length) return out;
  const notes = await fetchInChunks<{ user_id: string; start_date: string | null }>([...userIds], (chunk) =>
    admin.from("staff_contracts").select("user_id, start_date").eq("tenant_id", tenantId).eq("kind", "note")
      .ilike("terms", "%퇴사%").in("user_id", chunk));
  for (const n of notes) {
    if (!n.start_date || !YMD.test(n.start_date)) continue;
    if (!out.has(n.user_id) || out.get(n.user_id)! < n.start_date) out.set(n.user_id, n.start_date);
  }
  const rest = userIds.filter((id) => !out.has(id));
  if (!rest.length) return out;
  const audits = await fetchInChunks<{ created_at: string; user_id: string | null }>(rest, (chunk) =>
    admin.from("audit_logs").select("created_at, user_id:metadata->>userId").eq("tenant_id", tenantId)
      .eq("action", "staff_status_change").eq("metadata->>to", "inactive").in("metadata->>userId", chunk));
  for (const a of audits) {
    if (!a.user_id) continue;
    const day = kstToday(new Date(a.created_at));
    if (!out.has(a.user_id) || out.get(a.user_id)! < day) out.set(a.user_id, day);
  }
  return out;
}
