import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ClassroomRow = {
  id: string;
  name: string;
  capacity: number | null;
  /** 이 강의실을 기본 강의실로 쓰는 활성 반 수(삭제 시 미지정으로 바뀜 안내용). */
  classCount: number;
  /** 이 강의실을 슬롯 단위(요일/교시 override)로 쓰는 활성 반의 스케줄 슬롯 수. */
  slotCount: number;
};

/**
 * 운영 체계 "강의실" 관리용 — 강의실 목록 + 사용 현황(반 기본 강의실 + 시간표 슬롯 override).
 * classes(현 ~129)·class_schedules(현 ~628) 모두 학원당 <1000이라 classroom_id만 받아 JS 집계(B2 안전 범위).
 * 강의실 FK는 onDelete:set null이라 삭제 시 둘 다 미지정으로 바뀐다 → 영향 범위를 정확히 안내하려면 둘 다 집계.
 */
export async function getClassroomsWithUsage(): Promise<ClassroomRow[]> {
  const supabase = await createClient();
  const [roomsRes, classesRes, slotsRes] = await Promise.all([
    supabase.from("classrooms").select("id, name, capacity").order("name"),
    supabase.from("classes").select("classroom_id").eq("is_active", true).not("classroom_id", "is", null),
    supabase
      .from("class_schedules")
      .select("classroom_id, class:class_id!inner ( is_active )")
      .eq("class.is_active", true)
      .not("classroom_id", "is", null),
  ]);

  const classCounts = new Map<string, number>();
  for (const c of classesRes.data ?? []) {
    const id = c.classroom_id as string | null;
    if (id) classCounts.set(id, (classCounts.get(id) ?? 0) + 1);
  }
  const slotCounts = new Map<string, number>();
  for (const s of slotsRes.data ?? []) {
    const id = s.classroom_id as string | null;
    if (id) slotCounts.set(id, (slotCounts.get(id) ?? 0) + 1);
  }

  return (roomsRes.data ?? []).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    capacity: (r.capacity as number | null) ?? null,
    classCount: classCounts.get(r.id as string) ?? 0,
    slotCount: slotCounts.get(r.id as string) ?? 0,
  }));
}
