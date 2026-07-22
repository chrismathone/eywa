import "server-only";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import type { createClient } from "@/lib/supabase/server";
import {
  findOverlaps,
  type ExistingSlot,
  type OverlapCandidate,
  type OverlapItem,
} from "../overlap";

type Db = Awaited<ReturnType<typeof createClient>>;

type Named = { display_name?: string | null } | { display_name?: string | null }[] | null;
type RoomRef = { name?: string | null } | { name?: string | null }[] | null;
type ClassRef = {
  class_name?: string | null;
  is_active?: boolean | null;
  closed_at?: string | null;
  teacher_id?: string | null;
  classroom_id?: string | null;
  teacher?: Named;
  classroom?: RoomRef;
};
type Row = {
  id: string;
  class_id: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  valid_from: string | null;
  valid_to: string | null;
  teacher_id: string | null;
  classroom_id: string | null;
  slot_teacher_label: string | null;
  slot_room_label: string | null;
  slotTeacher?: Named;
  slotRoom?: RoomRef;
  class?: ClassRef | ClassRef[];
};

function one<T>(v: T | T[] | null | undefined): T | undefined {
  return Array.isArray(v) ? v[0] : (v ?? undefined);
}

const SELECT = `id, class_id, day_of_week, start_time, end_time, valid_from, valid_to,
  teacher_id, classroom_id, slot_teacher_label, slot_room_label,
  slotTeacher:teacher_id ( display_name ),
  slotRoom:classroom_id ( name ),
  class:class_id!inner (
    class_name, is_active, closed_at, teacher_id, classroom_id,
    teacher:teacher_id ( display_name ),
    classroom:classroom_id ( name )
  )`;

/**
 * 저장하려는 슬롯이 **어떤 반과 언제 무엇 때문에** 겹치는지 전부 찾는다(차단 아님 — 경고용).
 *
 * ⚠️ 저장을 막지 않는다. 결과는 화면이 "몇 개 반이 몇 건 겹치는지" 상세히 알리는 데만 쓴다.
 * 성능(B2·B4): 후보 요일의 활성 반 슬롯만 한 번에 읽고(`!inner` + is_active) **fetchAllPaged**로
 * 페이지네이션한다 — class_schedules 실측 939행이라 무페이징 select는 곧 1000행 절단 사정권이다.
 * 이름(강사·교실)은 같은 쿼리의 embed로 따라와 추가 왕복이 없다.
 */
export async function detectOverlaps(
  supabase: Db,
  args: {
    candidates: OverlapCandidate[];
    /** 수정 시 자기 자신(자기 슬롯끼리는 겹침이 아니다). */
    excludeClassId?: string;
  },
): Promise<OverlapItem[]> {
  // 강의실·강사 어느 축도 없으면 비교할 게 없다(요일만으론 겹침이 아니다).
  const usable = args.candidates.filter((c) => c.classroomId || c.teacherId);
  if (usable.length === 0) return [];

  const days = [...new Set(usable.map((c) => c.dayOfWeek))];
  const rows = await fetchAllPaged<Row>((from, to) =>
    supabase
      .from("class_schedules")
      .select(SELECT)
      .in("day_of_week", days)
      .eq("class.is_active", true)
      .order("id")
      .range(from, to),
  );

  const existing: ExistingSlot[] = rows.map((r) => {
    const k = one(r.class);
    return {
      classId: r.class_id,
      className: k?.class_name ?? "이름 없는 반",
      dayOfWeek: r.day_of_week,
      startTime: r.start_time,
      endTime: r.end_time,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      // 실효값 = 슬롯 override ?? 반 기본. (교시별 강사/강의실 override가 있는 반이 실재한다.)
      teacherId: r.teacher_id ?? k?.teacher_id ?? null,
      classroomId: r.classroom_id ?? k?.classroom_id ?? null,
      teacherName:
        one(r.slotTeacher)?.display_name ??
        one(k?.teacher)?.display_name ??
        r.slot_teacher_label ??
        null,
      roomName: one(r.slotRoom)?.name ?? one(k?.classroom)?.name ?? r.slot_room_label ?? null,
      isActive: k?.is_active ?? true,
      closedAt: k?.closed_at ?? null,
    };
  });

  return findOverlaps({
    candidates: usable,
    existing,
    today: kstToday(),
    ...(args.excludeClassId ? { excludeClassId: args.excludeClassId } : {}),
  });
}
