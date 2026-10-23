import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { contributionLessonNames, type LessonTeacher } from "../model/subject-evidence";
import { contributionSubjectOf } from "../model/subjects";
import type { CoreSources, RawHistoryBill } from "./source-types";
import type { ProgramSubject } from "@/features/students/enrollment/program";
import { isSingleTeacher, teacherKey } from "../model/historical-teacher-subjects";

async function boundedRows(ids: string[], run: Parameters<typeof fetchAllPagedInChunks<LessonTeacher>>[1]) {
  const rows: LessonTeacher[] = [];
  for (let start = 0; start < ids.length; start += 20) rows.push(...await fetchAllPagedInChunks<LessonTeacher>(ids.slice(start, start + 20), run, 5));
  return rows;
}

/** Batch refresh only. Fetch historical teachers for unresolved exact course names, not on tab navigation. */
export async function loadContributionLessonTeachers(db: SupabaseClient, tenant: string, core: CoreSources,
  history: readonly RawHistoryBill[], subjects: readonly ProgramSubject[]) {
  const names = contributionLessonNames(core.invoices, history);
  const classify = contributionSubjectOf({ subjects, classes: core.classes, names,
    staff: core.users.map(u => ({ names: [u.display_name, u.english_name], subjects: u.subjects ?? [] })) });
  const unknown = names.filter(n => !classify({ name: n.name })).map(n => n.name);
  const pattern = (value: string) => `"%${value.trim().split(/\s+/).map(part => part.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[%_*]/g, "\\$&")).join("%")}%"`;
  const matched = await boundedRows(unknown, (chunk, a, b) => db.from("makeedu_history_events")
    .select("class_name, teacher_name").eq("tenant_id", tenant).or(chunk.map(name => `class_name.ilike.${pattern(name)}`).join(",")).not("teacher_name", "is", null)
    .order("makeedu_no").order("processed_at").order("ord").range(a, b));
  const teachers = [...new Set(matched.map(row => row.teacher_name?.trim()).filter((name): name is string => !!name && isSingleTeacher(name)).map(teacherKey))];
  const keys = new Set(teachers);
  const context = await boundedRows(teachers, (chunk, a, b) => db.from("makeedu_history_events")
    .select("class_name, teacher_name").eq("tenant_id", tenant).or(chunk.map(name => `teacher_name.ilike.${pattern(name)}`).join(","))
    .order("makeedu_no").order("processed_at").order("ord").range(a, b));
  const sameTeachers = context.filter(row => !!row.teacher_name && isSingleTeacher(row.teacher_name.trim()) && keys.has(teacherKey(row.teacher_name)));
  return [...new Map([...matched, ...sameTeachers].map(row => [JSON.stringify([row.class_name, row.teacher_name]), row])).values()];
}
