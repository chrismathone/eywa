import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { mondayOf, shiftDays } from "@/features/timetable/lib/week";
import { getDelegatedClassIdsInRange } from "@/features/classes/server/delegation";
import type { TeacherScope } from "./teacher-scope";

type Slot = { class_id: string; day_of_week: string; valid_from: string | null; valid_to: string | null };
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Lists include every class taught this week, even a single period. Labels never establish ownership. */
export function liveTeachingClassIds(slots: readonly Slot[], monday: string): string[] {
  return [...new Set(slots.filter((slot) => {
    const day = DAYS.indexOf(slot.day_of_week);
    if (day < 0) return false;
    const date = shiftDays(monday, day);
    return (!slot.valid_from || slot.valid_from <= date) && (!slot.valid_to || slot.valid_to >= date);
  }).map((slot) => slot.class_id))];
}

/** Read scope only. Existing mutation gates keep their own assignment checks. */
export const getTeacherReadScope = cache(async (teacherId: string): Promise<TeacherScope> => {
  const db = await createClient();
  const today = kstToday();
  const monday = mondayOf(today);
  const [own, slots, delegated] = await Promise.all([
    fetchAllPaged<{ id: string; subject: string }>((from, to) => db.from("classes")
      .select("id, subject").eq("teacher_id", teacherId).order("id").range(from, to)),
    fetchAllPaged<Slot>((from, to) => db.from("class_schedules")
      .select("class_id, day_of_week, valid_from, valid_to").eq("teacher_id", teacherId)
      .order("id").range(from, to)),
    getDelegatedClassIdsInRange(teacherId, monday, shiftDays(monday, 6)),
  ]);
  const classIds = [...new Set([...own.map((c) => c.id), ...liveTeachingClassIds(slots, monday), ...delegated])];
  if (classIds.length === 0) return { classIds: [], studentIds: [], subjects: [] };
  const [classes, enrollments] = await Promise.all([
    fetchAllPagedInChunks<{ id: string; subject: string }>(classIds, (chunk, from, to) => db.from("classes")
      .select("id, subject").in("id", chunk).order("id").range(from, to)),
    fetchAllPagedInChunks<{ student_id: string }>(classIds, (chunk, from, to) => db.from("enrollments")
      .select("student_id").in("class_id", chunk).lte("start_date", today)
      .or(`end_date.is.null,end_date.gte.${today}`).order("id").range(from, to)),
  ]);
  return {
    classIds: classes.map((c) => c.id),
    studentIds: [...new Set(enrollments.map((e) => e.student_id))],
    subjects: [...new Set(classes.map((c) => c.subject).filter(Boolean))],
  };
});
