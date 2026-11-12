"use server";

/**
 * 학교별 내신기간 저장(원장 2026-10-20 *"학교마다 내신기간이 다름 학교별로 내신기간 반영되게"*).
 *
 * 🔴 게이트 = 수학 강사 시트 쓰기(`requireMcsClassAccess(write)`, [[#77]]) + **그 반 학생의 학교**만(남의 반 학교를 못 고친다).
 * 🔴 시험 줄마다 날짜 둘이 다 있으면 저장, 둘 다 비면 삭제(= 기본표로 되돌림). 하나만 있으면 거절.
 * 🔴 admin(RLS 우회)이라 모든 쿼리에 `tenant_id` 명시 필터. ⚠️ `"use server"` 파일은 async 함수만 export([[#119]]).
 */
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { requireMcsClassAccess } from "@/features/math-sheets/server/access";
import { isModuleOnForTenant } from "@/features/owner/server/modules";
import { normalizeSchoolName } from "@/features/schools/school-name";

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const inputSchema = z.object({
  classId: z.string().uuid(),
  school: z.string().min(1).max(60),
  schoolYear: z.number().int().min(2020).max(2100),
  rows: z.array(z.object({
    term: z.enum(["1-mid", "1-final", "2-mid", "2-final", "2-final-3"]),
    from: DATE.nullable(),
    to: DATE.nullable(),
  })).max(5).refine((rows) => new Set(rows.map((r) => r.term)).size === rows.length),
});

const NOT_READY = "학교별 내신기간 표가 아직 없습니다 — 마이그레이션(school_exam_periods)을 적용해 주세요";

export async function saveSchoolExamPeriods(input: z.input<typeof inputSchema>): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "날짜를 다시 확인해 주세요." };
  const { classId, school, schoolYear, rows } = parsed.data;
  const key = normalizeSchoolName(school);
  if (!key) return { ok: false, error: "학교를 다시 골라 주세요." };
  // 학년도 = 그해 3월 ~ 다음 해 2월.
  const yFrom = `${schoolYear}-03-01`, yTo = `${schoolYear + 1}-02-29`;
  for (const r of rows) {
    if (!!r.from !== !!r.to) return { ok: false, error: "시작일과 끝일을 함께 적거나 둘 다 비워 주세요." };
    if (r.from && r.to && (r.from > r.to || r.from < yFrom || r.to > yTo)) return { ok: false, error: `${schoolYear}학년도(3월~다음 해 2월) 안의 날짜로, 시작일이 끝일보다 앞서게 적어 주세요.` };
  }
  const gate = await requireMcsClassAccess(classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const { tenantId, user, className } = gate.access;
  if (!(await isModuleOnForTenant(tenantId, "textbooks"))) {
    return { ok: false, error: "이 학원은 교재목록 기능이 꺼져 있습니다" };
  }
  const admin = createAdminClient();

  // 그 반 학생의 학교인지 — 수강 학생들의 학교 매칭 키 안에 있어야 한다.
  // 지금 수강 중인 학생만(끝난 수강의 학교로는 못 고친다).
  // 오늘 = KST 날짜(서버는 UTC라 한국 새벽엔 하루 전이 된다 — 어제 끝난 수강이 '수강 중'으로 남는다).
  const today = kstToday();
  const enr = await admin.from("enrollments").select("student_id").eq("tenant_id", tenantId).eq("class_id", classId)
    .or(`end_date.is.null,end_date.gte.${today}`).limit(500);
  if (enr.error) return { ok: false, error: "수강 정보를 확인하지 못했습니다. 다시 시도해 주세요." };
  const ids = [...new Set((enr.data ?? []).map((e) => String(e.student_id)))];
  let schools: { school: string | null }[];
  try {
    schools = await fetchInChunks<{ school: string | null }>(ids, (chunk) => admin.from("students").select("school").eq("tenant_id", tenantId).in("id", chunk));
  } catch {
    return { ok: false, error: "학생 정보를 확인하지 못했습니다. 다시 시도해 주세요." };
  }
  if (!schools.some((s) => normalizeSchoolName(s.school) === key)) {
    return { ok: false, error: "이 반 학생의 학교가 아닙니다. 새로고침해 주세요." };
  }

  const keep = rows.filter((r) => r.from && r.to);
  const drop = rows.filter((r) => !r.from && !r.to).map((r) => r.term);
  if (keep.length) {
    const res = await admin.from("school_exam_periods").upsert(
      keep.map((r) => ({ tenant_id: tenantId, school_key: key, school_label: school.trim(), school_year: schoolYear, term: r.term, from_date: r.from, to_date: r.to, updated_by: user.id })),
      { onConflict: "tenant_id,school_key,school_year,term" },
    );
    if (res.error) return { ok: false, error: res.error.code === "42P01" || res.error.code === "PGRST205" ? NOT_READY : "내신기간을 저장하지 못했습니다. 다시 시도해 주세요." };
  }
  if (drop.length) {
    const res = await admin.from("school_exam_periods").delete().eq("tenant_id", tenantId).eq("school_key", key).eq("school_year", schoolYear).in("term", drop);
    if (res.error) return { ok: false, error: res.error.code === "42P01" || res.error.code === "PGRST205" ? NOT_READY : "내신기간을 저장하지 못했습니다. 다시 시도해 주세요." };
  }

  await logAction({ action: "school_exam_periods", targetType: "class", targetLabel: className, metadata: { classId, school, schoolYear, rows } });
  revalidatePath(`/mcs/${classId}/month`);
  revalidatePath("/mcs/teachers");
  return { ok: true };
}
