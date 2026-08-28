import "server-only";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import type { ClassUpdate } from "@/features/timetable/due-class-updates";

export type ScheduledClassChange = {
  effectiveDate: string;
  /** 그날부터의 담임 표시 이름. 해석 실패면 null(반 id만 아는 상태) — 그때는 날짜만 알린다. */
  teacherName: string | null;
};

/**
 * 이 반에 **예약된 담임 변경**(가져오기가 미뤄 둔 것) — 반 상세 배너용.
 *
 * 원장 2026-08-28: 예약된 담임 변경은 **반 상세 배너**에서 보이기로 했다. 그런데 이 예약은
 * `pending_teacher_*`를 쓰지 않는다(그 경로의 `applyHandover`가 슬롯 담당까지 옮겨 시트대로 넣어 둔
 * 배치를 뭉갠다 — 0234a 주석). 그래서 **스냅샷에서 읽어** 읽기 전용으로 보여준다.
 *
 * ⚠️ 이 배너엔 '적용'·'취소' 버튼을 붙이지 않는다 — 적용은 기한 cron이, 취소는 시간표 툴바의 배지 ×가
 *    한다(취소는 배치·반이동까지 **한 덩이**라 반 하나만 되돌리면 어긋난다).
 * ⚠️ 예약이 없으면 첫 쿼리 한 번으로 끝난다(보통 0행).
 */
export async function getScheduledClassChange(
  classId: string,
  /** 지금 담임 — **아직 예약 시점 그대로일 때만** 배너를 띄운다(아래 ⚠️). */
  currentTeacherId: string | null,
): Promise<ScheduledClassChange | null> {
  const today = kstToday();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("timetable_snapshots")
    .select("id, reference_date, updates:payload->apply->classUpdates")
    .gt("reference_date", today)
    .order("reference_date");
  if (error || !data || data.length === 0) return null;

  const rows = data as unknown as {
    id: string;
    reference_date: string | null;
    updates: ClassUpdate[] | null;
  }[];

  // 되돌린 스냅샷 제외 — 취소한 예약을 배너에 남기면 "왜 안 바뀌지"가 된다.
  const { data: logs } = await supabase
    .from("timetable_import_logs")
    .select("snapshot_id")
    .in("snapshot_id", rows.map((r) => r.id))
    .not("restored_at", "is", null);
  const restored = new Set((logs ?? []).map((l) => (l as { snapshot_id: string }).snapshot_id));

  for (const r of rows) {
    if (!r.reference_date || restored.has(r.id)) continue;
    const hit = (Array.isArray(r.updates) ? r.updates : []).find(
      (u) => u?.classId === classId && u.teacherId,
    );
    if (!hit) continue;
    // ⚠️ 이미 반영됐거나 사람이 손댔으면 "예정"이 아니다 — cron의 적용 조건과 **같은 판정**을 쓴다.
    //    (0234a 적용 전엔 담임이 즉시 바뀌므로 이 가드가 없으면 배너가 거짓말을 한다.)
    if (currentTeacherId !== hit.prevTeacherId) continue;
    const { data: teacher } = await supabase
      .from("users")
      .select("display_name")
      .eq("id", hit.teacherId!)
      .maybeSingle();
    return {
      effectiveDate: String(r.reference_date).slice(0, 10),
      teacherName: teacher?.display_name ?? null,
    };
  }
  return null;
}
