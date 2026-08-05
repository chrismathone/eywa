import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";

export type ClassroomRow = {
  id: string;
  name: string;
  capacity: number | null;
  /** 보관(숨김) 시각 — 0182a. null이면 사용 중. */
  archivedAt: string | null;
  /**
   * 이 강의실에서 **실제로 수업하는** 활성 반 수.
   * 🔴 판정은 **실효 강의실**(슬롯 override ?? 반 기본값) + **살아있는 배치**만이다 — 교실뷰와 같은 규약.
   *    옛 구현은 `classes.classroom_id`(기본값)만 세서, 시간표가 다른 방으로 옮겨간 반까지 "이 방 사용"으로
   *    보고했다(원장 제보 2026-08-05 바른602: 표시는 "2개 반"인데 실제 수업은 0개. 실측 40개 반이 이 상태).
   */
  classCount: number;
  /**
   * **기본 강의실만** 이 방인 활성 반 수(실제 수업은 다른 방이거나 배치가 없음) = 쓰이지 않는 찌꺼기.
   * 위 classCount와 겹치지 않는다. 화면이 둘을 갈라 보여야 "안 쓰는데 왜 잡히지"가 안 생긴다.
   */
  staleDefaultCount: number;
  /** 이 강의실을 가리키는 **살아있는** 시간표 슬롯 수(만료 배치 제외 — class_schedules는 이력을 함께 담는다, #88). */
  slotCount: number;
};

type ClassRow = { id: string; classroom_id: string | null };
type SlotRow = { class_id: string; classroom_id: string | null; valid_to: string | null };

/**
 * 운영 체계 "강의실" 관리용 — 강의실 목록 + 사용 현황.
 *
 * ⚠️ `class_schedules`는 학원당 1,000행을 넘는다(실측 1,068) → 무페이징 select는 **조용히 잘린다**(B2/#54).
 *    `fetchAllPaged`로 전건을 받는다. classes는 활성만이라 소량.
 * ⚠️ 만료 배치(`valid_to < 오늘`)는 지금 쓰는 게 아니다(#88) — 세면 끝난 수업이 방을 점유한 것처럼 보인다.
 */
export async function getClassroomsWithUsage(): Promise<ClassroomRow[]> {
  const supabase = await createClient();
  const today = kstToday();
  const [roomsRes, classes, slots] = await Promise.all([
    supabase.from("classrooms").select("id, name, capacity, archived_at").order("name"),
    fetchAllPaged<ClassRow>((from, to) =>
      supabase.from("classes").select("id, classroom_id").eq("is_active", true).range(from, to),
    ),
    fetchAllPaged<SlotRow>((from, to) =>
      supabase
        .from("class_schedules")
        .select("class_id, classroom_id, valid_to, class:class_id!inner ( is_active )")
        .eq("class.is_active", true)
        .range(from, to),
    ),
  ]);

  const defaultRoomOf = new Map(classes.map((c) => [c.id, c.classroom_id]));
  // 실효 강의실 = 슬롯 override ?? 반 기본값(교실뷰와 같은 판정). 만료 배치는 제외.
  const liveSlotCount = new Map<string, number>();
  const usingClasses = new Map<string, Set<string>>();
  for (const s of slots) {
    if (s.valid_to && s.valid_to < today) continue; // 끝난 배치 — 지금 이 방을 쓰는 게 아니다
    const room = s.classroom_id ?? defaultRoomOf.get(s.class_id) ?? null;
    if (!room) continue;
    liveSlotCount.set(room, (liveSlotCount.get(room) ?? 0) + 1);
    const set = usingClasses.get(room) ?? new Set<string>();
    set.add(s.class_id);
    usingClasses.set(room, set);
  }
  // 기본값만 이 방인 반 = 기본 강의실이 R인데 위 '실제 사용' 집합엔 없는 반.
  const staleCount = new Map<string, number>();
  for (const c of classes) {
    const room = c.classroom_id;
    if (!room || usingClasses.get(room)?.has(c.id)) continue;
    staleCount.set(room, (staleCount.get(room) ?? 0) + 1);
  }

  return (roomsRes.data ?? []).map((r) => {
    const id = r.id as string;
    return {
      id,
      name: r.name as string,
      capacity: (r.capacity as number | null) ?? null,
      archivedAt: (r.archived_at as string | null) ?? null,
      classCount: usingClasses.get(id)?.size ?? 0,
      staleDefaultCount: staleCount.get(id) ?? 0,
      slotCount: liveSlotCount.get(id) ?? 0,
    };
  });
}
