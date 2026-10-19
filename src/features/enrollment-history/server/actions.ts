"use server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isModuleEnabled } from "@/lib/modules";
import { kstToday } from "@/lib/date-kst";
import { historyEvidence, registrationEvidence, type StudentEvidence } from "../evidence";
import { cachedGoogleHistory, HISTORY_START } from "./google";

const inputSchema = z.object({ name: z.string().trim().min(2).max(50),
  phones: z.array(z.string().max(30)).max(2) });

export async function checkEnrollmentHistory(input: unknown) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { error: "학생 이름을 두 글자 이상 입력하고 연락처를 확인해 주세요." };
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !["full", "readonly"].includes(await accessLevelTenant(user.systemRole, "enrollment")))
    return { error: "상담 이력을 조회할 권한이 없습니다." };
  if (!isModuleEnabled((await getTenantSettings()).modules.disabled, "calendar"))
    return { error: "이 학원의 캘린더 연결이 꺼져 있습니다." };
  const today = kstToday();
  const identity = { ...parsed.data, name: parsed.data.name.normalize("NFC") };
  const db = await createClient();
  // Session client + RLS + explicit academy filter. No administrator bypass for student history.
  const [calendar, students] = await Promise.all([
    cachedGoogleHistory(user.tenantId, identity.name, today),
    fetchAllPaged<StudentEvidence>((from,to) => db.from("students")
      .select("name,parent_phone,student_phone,status,enrolled_at").eq("tenant_id",user.tenantId)
      .eq("name",identity.name).order("id").range(from,to)).then(rows => ({ rows, ok: true }))
      .catch(() => ({ rows: [] as StudentEvidence[], ok: false })),
  ]);
  const evidence = historyEvidence(calendar.events, identity, today);
  const registration = students.ok ? registrationEvidence(students.rows,identity) : "unavailable";
  return { evidence, registration, complete: calendar.complete, message: calendar.message,
    from: HISTORY_START, through: today, repeated: evidence.priorRecords >= 2,
    checkedAt: new Date().toISOString() };
}
