import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import type { ClassUpdate } from "@/features/timetable/due-class-updates";
import {
  buildClassNameAsOfIndex,
  type ClassNameAsOfIndex,
  type PendingRename,
} from "../class-name-as-of";

/**
 * **예약된 반 이름 변경**(가져오기가 미뤄 둔 것)을 색인으로. 미래 주 시간표가 그 주의 이름을 그리는 재료다.
 *
 * 진실은 [`getScheduledClassChanges`](../../timetable/server/scheduled-class-change.ts)와 **같은 자리**
 * (`timetable_snapshots.payload.apply.classUpdates`)에서 온다 — 반 상세 배너와 시간표가 갈리지 않게.
 * 다만 저쪽은 반 하나를 묻고 이쪽은 **테넌트 전체**를 한 번에 가져온다(시간표는 수십 반을 동시에 그린다).
 *
 * ⚠️ 되돌린 스냅샷(`restored_at`)은 뺀다 — 취소한 예약의 이름을 미래 주에 그리면 오지 않을 미래다.
 * ⚠️ 예약은 보통 0~3건이라 가볍다. 상한을 둬 무한 스캔을 막는다(B2).
 * ⚠️ React `cache` — 한 요청에서 여러 뷰가 물어도 왕복 1회.
 */
async function loadIndex(
  supabase: Awaited<ReturnType<typeof createClient>>,
  /**
   * 🔴 **admin 클라이언트면 반드시 준다** — RLS를 우회하므로 필터가 없으면 남의 학원 예약을 읽는다.
   * 세션 클라이언트(=화면)는 RLS가 걸러 주므로 undefined.
   */
  tenantId?: string,
): Promise<ClassNameAsOfIndex> {
  let query = supabase
    .from("timetable_snapshots")
    .select("id, reference_date, updates:payload->apply->classUpdates")
    .gt("reference_date", kstToday())
    .order("reference_date")
    .limit(50);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { data, error } = await query;
  if (error || !data || data.length === 0) return new Map();

  const rows = data as unknown as {
    id: string;
    reference_date: string | null;
    updates: ClassUpdate[] | null;
  }[];

  let logQuery = supabase
    .from("timetable_import_logs")
    .select("snapshot_id")
    .in(
      "snapshot_id",
      rows.map((r) => r.id),
    )
    .not("restored_at", "is", null);
  if (tenantId) logQuery = logQuery.eq("tenant_id", tenantId);
  const { data: logs } = await logQuery;
  const restored = new Set((logs ?? []).map((l) => (l as { snapshot_id: string }).snapshot_id));

  const renames: PendingRename[] = [];
  for (const r of rows) {
    if (!r.reference_date || restored.has(r.id)) continue;
    const date = String(r.reference_date).slice(0, 10);
    for (const u of Array.isArray(r.updates) ? r.updates : []) {
      // 담임·강의실만 바뀌는 항목엔 className이 없다 — 이름 축만 본다.
      if (!u?.classId || !u.className) continue;
      renames.push({ classId: u.classId, from: u.prevClassName ?? null, to: u.className, date });
    }
  }
  return buildClassNameAsOfIndex(renames);
}

/**
 * 화면 경로(세션 클라이언트). ⚠️ React `cache` — 한 요청에서 여러 뷰가 물어도 왕복 1회.
 * 🔴 인자를 받지 않는다 — `cache`는 인자로 키를 잡는데 클라이언트 객체는 매번 새 참조라 캐시가 안 먹는다.
 *    주입 경로는 아래 `getClassNameAsOfIndexWith`로 따로 연다(cron·admin).
 */
export const getClassNameAsOfIndex = cache(async (): Promise<ClassNameAsOfIndex> =>
  loadIndex(await createClient()),
);

/**
 * cron·admin 경로 — `fetchSlots(db)`가 주입한 클라이언트를 그대로 쓴다.
 * 🔴 이걸 안 만들고 세션 클라이언트를 고정으로 쓰면, cron에는 세션이 없어 RLS가 **0행**을 돌려주고
 *    (에러도 안 난다) 시트 동기화만 조용히 옛 이름으로 나간다 — 화면과 갈린다([[#104]]와 같은 결).
 */
export async function getClassNameAsOfIndexWith(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
): Promise<ClassNameAsOfIndex> {
  return loadIndex(supabase, tenantId);
}
