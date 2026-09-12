"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { isValidYmd, resolveReportDate } from "@/lib/date-kst";
import { getTeachingClasses } from "@/features/classes/server/delegation";
import { addMakeupSessionEntries, type MakeupSessionEntry } from "../makeup-session";
import { changeMakeupSession } from "./makeup-session-store";

/** 확인 버튼은 이 저장이 끝난 뒤에만 성공한다. 보고서 생성·발송은 하지 않는다. */
export async function registerMakeupEntries(input: {
  studentId: string; date: string; entries: MakeupSessionEntry[];
}): Promise<{ ok: true; updatedAt: string; previousUpdatedAt: string | null } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const readonly = await readonlyTeacherViewError();
  if (readonly) return { ok: false, error: readonly };
  if (!input.studentId || !isValidYmd(input.date) || resolveReportDate(input.date) !== input.date || !input.entries.length || input.entries.length > 20) {
    return { ok: false, error: "보강 날짜와 과목을 확인해 주세요" };
  }
  const supabase = await createClient();
  const [student, classes] = await Promise.all([
    supabase.from("students").select("id").eq("tenant_id", user.tenantId).eq("id", input.studentId).maybeSingle(),
    getTeachingClasses(supabase, user.id, input.date),
  ]);
  if (student.error || !student.data) return { ok: false, error: "학원 학생을 확인하지 못했습니다" };
  const entries: MakeupSessionEntry[] = [];
  for (const entry of input.entries) {
    const anchor = entry.makeupClassId ? classes.find(c => c.id === entry.makeupClassId && c.subject === entry.subject) : null;
    if (!classes.some(c => c.subject === entry.subject) || (entry.makeupClassId && !anchor)) {
      return { ok: false, error: "담당 과목과 보강 수업을 확인해 주세요" };
    }
    if (entry.units != null && (!Number.isFinite(entry.units) || entry.units <= 0 || entry.units > 24)) {
      return { ok: false, error: "보강 시수를 확인해 주세요" };
    }
    if (entry.absentDate && !isValidYmd(entry.absentDate)) {
      return { ok: false, error: "결석 날짜를 확인해 주세요" };
    }
    entries.push({ ...entry, makeupClassId: anchor?.id ?? null, makeupClassName: anchor?.className ?? null });
  }
  return changeMakeupSession(supabase, {
    tenantId: user.tenantId, teacherId: user.id, studentId: input.studentId, date: input.date,
  }, progress => addMakeupSessionEntries(progress, entries));
}
