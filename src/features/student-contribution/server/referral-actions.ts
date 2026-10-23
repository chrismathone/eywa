"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { samePersonGroups } from "@/features/enrollment/same-person";
import { isMergedStudent } from "@/features/students/status/merged";
import { requireContributionWrite } from "./access";
import { getContributionIdentity } from "./identity-query";

export async function searchReviewedReferrers(search: string) {
  try {
    const gate = await requireContributionWrite();
    const name = z.string().trim().min(2).max(40).parse(search);
    // 명시 검색에서만 30명. SQL LIKE 와일드카드를 이름의 문자로 취급한다.
    const literal = name.replace(/[\\%_]/g, "\\$&");
    const { data, error } = await createAdminClient().from("students").select("id, name, school, grade, status, notes")
      .eq("tenant_id", gate.tenantId).eq("is_test", false).ilike("name", `%${literal}%`).order("name").order("id").limit(30);
    if (error) throw new Error("원생을 검색하지 못했습니다");
    return { options: (data ?? []).filter((s) => !isMergedStudent(s.notes)).map((s) => ({ id: s.id,
      label: `${s.name} · ${s.school ?? ""} ${s.grade ?? ""}${s.status === "withdrawn" ? " · 퇴원" : ""}` })) };
  } catch (error) { return { error: error instanceof Error ? error.message : "원생을 검색하지 못했습니다" }; }
}

/** 확인 목록의 명시 선택. 자동 백필과 별개이며 기존 연결은 덮지 않는다. */
export async function linkReviewedReferral(input: { consultationId: string; studentId: string; reason: string }) {
  try {
    const gate = await requireContributionWrite();
    const v = z.object({ consultationId: z.string().uuid(), studentId: z.string().uuid(), reason: z.string().trim().min(2).max(500) }).parse(input);
    const db = createAdminClient();
    const [consultation, student] = await Promise.all([
      db.from("enrollment_consultations").select("id, student_id, prospect_name, prospect_school, prospect_grade, parent_phone, referrer_student_id, referrer_staff_id, referrer_name, updated_at")
        .eq("tenant_id", gate.tenantId).eq("id", v.consultationId).maybeSingle(),
      db.from("students").select("id, name, school, grade, parent_phone, is_test, notes").eq("tenant_id", gate.tenantId).eq("id", v.studentId).maybeSingle(),
    ]);
    if (consultation.error || student.error || !consultation.data || !student.data) throw new Error("상담과 원생 정보를 확인해 주세요");
    const c = consultation.data, s = student.data;
    if (s.is_test || isMergedStudent(s.notes) || c.referrer_student_id || c.referrer_staff_id) throw new Error("이미 연결되었거나 연결할 수 없는 원생입니다");
    const self = { id: `selected:${s.id}`, student_id: s.id, prospect_name: s.name, prospect_school: s.school, prospect_grade: s.grade, parent_phone: s.parent_phone };
    const identity = await getContributionIdentity();
    const groups = samePersonGroups([{ ...c, student_id: c.student_id ? identity.canonical(c.student_id) : null }, self]);
    if (groups.get(c.id) === groups.get(self.id)) throw new Error("본인을 소개자로 연결할 수 없습니다");
    const { data, error } = await db.from("enrollment_consultations").update({ referrer_student_id: s.id })
      .eq("tenant_id", gate.tenantId).eq("id", c.id).eq("updated_at", c.updated_at).is("referrer_student_id", null).is("referrer_staff_id", null).select("id").maybeSingle();
    if (error || !data) throw new Error("상담이 바뀌었습니다. 원본을 확인한 뒤 다시 연결해 주세요");
    await logAction({ action: "student_contribution_referral_link", targetType: "student_contribution", targetLabel: s.name,
      metadata: { consultationId: c.id, studentId: s.id, source: "review", evidence: v.reason, before: { referrerStudentId: null, referrerStaffId: null } } });
    revalidatePath("/student-contribution"); revalidatePath(`/enrollment/${c.id}`); revalidatePath("/class-review");
    return { ok: true, message: "연결했습니다. 다음 집계에 반영됩니다. 현재 달 직원 소개 평가에도 반영될 수 있습니다." };
  } catch (error) { return { error: error instanceof Error ? error.message : "소개자를 연결하지 못했습니다" }; }
}
