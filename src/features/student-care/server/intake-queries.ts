import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstDateOf, kstToday } from "@/lib/date-kst";
import { careStorageMessage, careStudent } from "./access";
import { intakeCareAccess } from "./intake-access";
import { careRow, CARE_COLUMNS, type StudentCareView } from "./queries";
import { careReferences } from "./records";

export async function getIntakeCare(intakeId: string, page = 0): Promise<StudentCareView> {
  z.string().uuid().parse(intakeId);
  z.number().int().min(0).max(9999).parse(page);
  const access = await intakeCareAccess(intakeId);
  const admin = createAdminClient();
  let query = admin.from("student_care_commitments").select(CARE_COLUMNS).eq("tenant_id", access.user.tenantId).eq("intake_id", intakeId);
  query = access.intake.studentId ? query.eq("student_id", access.intake.studentId) : query.is("student_id", null);
  if (!access.readAll) query = query.eq("owner_id", access.user.id);
  const [rows, student, references, source, staff] = await Promise.all([
    query.order("updated_at", { ascending: false }).order("id").range(page * 100, page * 100 + 100),
    access.intake.studentId ? careStudent(access.intake.studentId, access.user.tenantId) : null,
    access.intake.studentId ? careReferences(access.user, access.intake.studentId, access.actor.canManage, access.readAll) : null,
    access.actor.canManage ? admin.from("enrollment_consultations").select("id,parent_request,created_at").eq("tenant_id", access.user.tenantId).eq("id", intakeId).maybeSingle() : null,
    access.actor.canManage ? admin.from("users").select("id,display_name").eq("tenant_id", access.user.tenantId).eq("status", "active").in("system_role", ["master", "admin", "manager", "teacher", "counselor"]).order("display_name").limit(500) : null,
  ]);
  let records: StudentCareView["records"] = [];
  let error = rows.error ? careStorageMessage(rows.error) : null;
  try { if (!error) records = (rows.data ?? []).slice(0, 100).map((r) => ({ ...careRow(r), intakeId })); } catch { error = "약속 기록 형식을 확인하지 못했습니다"; }
  return { student, intake: access.intake, records, actor: access.actor, today: kstToday(), page, more: (rows.data?.length ?? 0) > 100, error,
    references: { sources: source?.data ? [{ id: intakeId, need: String(source.data.parent_request ?? ""), date: kstDateOf(source.data.created_at) ?? "날짜 미정" }] : [],
      evidence: references?.evidence ?? [], evidenceKinds: references?.evidenceKinds ?? [], warning: source?.error ? "입학상담 원본을 불러오지 못했습니다" : references?.warning ?? null },
    staff: (staff?.data ?? []).map((r) => ({ id: String(r.id), name: String(r.display_name ?? "이름 미정") })), staffError: !!staff?.error };
}
