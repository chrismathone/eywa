import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { fetchAllPaged, fetchAllPagedInChunks } from '@/lib/supabase/batch';
import { kstToday } from '@/lib/date-kst';
import { readScheduledGroupPlan, type DatedGroupPlan } from '@/features/timetable/scheduled-groups';

/** Strict, tenant scoped variant for imports: a failed read must not silently use today's layout. */
export async function readSourceGroupPlans(db: Awaited<ReturnType<typeof createClient>>, tenantId: string, end: string): Promise<DatedGroupPlan[]> {
  const today = kstToday();
  if (end < today) return [];
  const rows = await fetchAllPaged<{ id: string; reference_date: string; groups: unknown }>((from, to) =>
    db.from('timetable_snapshots').select('id, reference_date, groups:payload->apply->integrationGroups')
      .eq('tenant_id', tenantId).gt('reference_date', today).lte('reference_date', end).order('reference_date').order('id').range(from, to));
  const planned = rows.flatMap(r => { const plan = readScheduledGroupPlan(r.groups); return plan ? [{ id: r.id, date: r.reference_date, plan }] : []; });
  const logs = await fetchAllPagedInChunks<{ snapshot_id: string }>(planned.map(r => r.id), (ids, from, to) =>
    db.from('timetable_import_logs').select('snapshot_id').eq('tenant_id', tenantId).in('snapshot_id', ids)
      .not('restored_at', 'is', null).order('id').range(from, to));
  const restored = new Set(logs.map(r => r.snapshot_id));
  return planned.filter(r => !restored.has(r.id)).map(({ date, plan }) => ({ date, plan }));
}
