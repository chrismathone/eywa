import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { readScheduledGroupPlan, type DatedGroupPlan } from "../scheduled-groups";

/**
 * 아직 오지 않은 **통합뷰 그룹 배치 예약** 목록 — 미래 주 화면이 "그 주에 쓸 줄"을 그리는 재료.
 *
 * 근거는 추정이 아니라 사실 하나뿐이다 — 배치 스냅샷의 `apply.integrationGroups`(9/1 cron이 그대로
 * 재생할 바로 그 값). 되돌린 스냅샷(`restored_at`)은 뺀다(취소된 예약을 미리 보여 주면 거짓말).
 *
 * ⚠️ React `cache` — 한 요청에서 여러 뷰가 물어도 왕복 1회. 인자를 받지 않는 이유는
 *    `getClassNameAsOfIndex`와 같다(클라이언트 객체는 매번 새 참조라 캐시 키가 안 잡힌다).
 */
export const getScheduledGroupPlans = cache(async (): Promise<DatedGroupPlan[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_snapshots")
    .select("id, reference_date, groups:payload->apply->integrationGroups")
    .gt("reference_date", kstToday())
    .order("reference_date")
    .limit(50);
  if (error || !data || data.length === 0) return [];

  const rows = data as unknown as { id: string; reference_date: string | null; groups: unknown }[];
  const withPlan = rows
    .map((r) => ({ id: r.id, date: String(r.reference_date ?? "").slice(0, 10), plan: readScheduledGroupPlan(r.groups) }))
    .filter((r): r is { id: string; date: string; plan: NonNullable<ReturnType<typeof readScheduledGroupPlan>> } =>
      r.date !== "" && r.plan !== null,
    );
  if (withPlan.length === 0) return []; // 예약이 없으면 로그 조회도 하지 않는다(왕복 0)

  const { data: logs } = await supabase
    .from("timetable_import_logs")
    .select("snapshot_id")
    .in(
      "snapshot_id",
      withPlan.map((r) => r.id),
    )
    .not("restored_at", "is", null);
  const restored = new Set((logs ?? []).map((l) => (l as { snapshot_id: string }).snapshot_id));

  return withPlan.filter((r) => !restored.has(r.id)).map(({ date, plan }) => ({ date, plan }));
});
