import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export type PendingLabApply = { id: string; at: string; actorId: string };

/**
 * 적용을 기다리는 연습본 예약 — 시간표 툴바 배지의 재료.
 *
 * 연습본 예약은 실행 전까지 운영 자료에 아무것도 쓰지 않아 시간표에 흔적이 없다. 예약한 사람만이 아니라
 * 시간표를 고칠 수 있는 직원 모두가 봐야 하므로(모르고 운영을 고치면 예약과 어긋난다) 본인 행만 읽는 RLS 대신
 * 관리자 조회로 학원 범위를 직접 건다. 호출부(page.tsx)가 `canUseTimetableEditor`로 먼저 거른다.
 *
 * ⚠️ `payload`는 읽지 않는다 — 연습본 전체(수백 KB)가 들어 있다.
 */
export async function getPendingLabApplies(tenantId: string): Promise<PendingLabApply[]> {
  const { data, error } = await createAdminClient()
    .from('timetable_lab_apply_jobs')
    .select('id, apply_at, actor_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending')
    .order('apply_at');
  // 조회 실패는 배지를 안 띄우는 쪽으로 — 시간표 화면 자체를 막지 않는다.
  if (error || !data) return [];
  return data.map(row => ({ id: row.id, at: row.apply_at, actorId: row.actor_id }));
}
