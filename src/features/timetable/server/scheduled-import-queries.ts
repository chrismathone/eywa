import "server-only";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import {
  groupScheduledImports,
  type ScheduledImportGroup,
  type ScheduledSnapshot,
} from "@/features/timetable/scheduled-import";

/**
 * **예약된 가져오기** 조회 — 미래 날짜로 적용해 둔 시간표 변경.
 *
 * 판정 축은 `class_schedules`의 미래 행이 아니라 **스냅샷**이다. 취소가 곧 스냅샷 롤백이라 화면에 띄운
 * 것과 되돌릴 것이 같은 물건이어야 하고, 미래 행만 보면 어느 적용이 만든 건지 알 수 없다(가져오기와
 * 무관하게 미래에 시작하는 행도 있다 — 실측 7건이 전부 수학 특강이었다).
 *
 * ⚠️ `payload`는 **통째로 안 읽는다** — 배치 스냅샷의 payload엔 before/apply 전체가 들어 있어 무겁다.
 *    PostgREST JSON 화살표로 `payload->>kind`만 뽑는다(실측 동작 확인).
 * ⚠️ 임베드(`timetable_import_logs(...)`)를 쓰지 않고 두 번 나눠 읽는다 — FK가 하나뿐이라 지금은
 *    무해하지만, 남이 컬럼을 하나 더하는 날 임베드가 300으로 죽는 자리다([[#94]]). 예약이 없으면
 *    첫 쿼리에서 끝나 두 번째는 아예 안 돈다(평소 왕복 1회).
 */
export async function getScheduledImports(): Promise<ScheduledImportGroup[]> {
  const today = kstToday();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_snapshots")
    .select("id, reference_date, created_at, kind:payload->>kind")
    .gt("reference_date", today)
    .order("reference_date");
  // 조회 실패는 배지를 안 띄우는 쪽으로 — 시간표 화면 자체를 막지 않는다.
  if (error || !data || data.length === 0) return [];

  const snaps = data as unknown as {
    id: string;
    reference_date: string | null;
    created_at: string;
    kind: string | null;
  }[];

  // 이미 되돌린 것 제외. 미래 스냅샷은 보통 0~4건이라 단일 `.in()`으로 충분하다(청크 불요).
  const ids = snaps.map((s) => s.id);
  const { data: logs } = await supabase
    .from("timetable_import_logs")
    .select("snapshot_id")
    .in("snapshot_id", ids)
    .not("restored_at", "is", null);
  const restored = new Set((logs ?? []).map((l) => (l as { snapshot_id: string }).snapshot_id));

  const rows: ScheduledSnapshot[] = [];
  for (const s of snaps) {
    if (!s.reference_date || restored.has(s.id)) continue;
    rows.push({
      id: s.id,
      effectiveDate: String(s.reference_date).slice(0, 10),
      // 배치 스냅샷만 payload.kind를 갖는다(`english_structure`). 반이동은 diff라 kind가 없다.
      kind: s.kind ? "structure" : "enrollment",
      createdAt: s.created_at,
    });
  }
  return groupScheduledImports(rows, today);
}
