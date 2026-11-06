import "server-only";
import { z } from "zod";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { careDocumentSchema, type CareRecord } from "../model";
import { careAccess, careStorageMessage, careStudent } from "./access";
import { careReferences } from "./records";
import { visibleCareStudents } from "./student-scope";

export const CARE_COLUMNS = "id,student_id,version,document,updated_at,source_id";
type CareRow = { id: unknown; student_id: unknown; intake_id?: unknown; source_id?: unknown; version: unknown; document: unknown; updated_at: unknown };
export function careRow(row: CareRow): CareRecord {
  const document = careDocumentSchema.parse(row.document);
  // 출처 상담이 지워지면 칸만 비워진다(외래키 on delete set null) — 문서에 남은 옛 출처는 없는 것으로(내용 변경 폼이 옛 출처로 미리 채워 저장이 막히지 않게).
  if (row.source_id === null && document.content.sourceId) document.content = { ...document.content, sourceId: null };
  return { id: String(row.id), studentId: row.student_id ? String(row.student_id) : null, intakeId: row.intake_id ? String(row.intake_id) : null, version: Number(row.version), document, updatedAt: String(row.updated_at) };
}

type CareReader = { user: { id: string; tenantId: string }; readAll: boolean };
/**
 * 한 학생의 약속 행(최근 저장순 · 101행까지 — 100 넘으면 '다음 100건'). 담당 한정 사용자는 자기 담당만.
 * s2_0029(등록 전 약속 칸 `intake_id`)가 없는 DB면 옛 칸으로 다시 읽는다.
 */
export async function readStudentCareRows(access: CareReader, studentId: string, page: number) {
  const admin = createAdminClient();
  const build = (extended: boolean) => {
    let query = admin.from("student_care_commitments").select(extended ? "id,student_id,version,document,updated_at,source_id,intake_id" : CARE_COLUMNS).eq("tenant_id", access.user.tenantId).eq("student_id", studentId);
    if (!access.readAll) query = query.eq("owner_id", access.user.id);
    return query.order("updated_at", { ascending: false }).order("id").range(page * 100, page * 100 + 100).returns<CareRow[]>();
  };
  const result = await build(true);
  return ["42703", "PGRST204"].includes(result.error?.code ?? "") ? build(false) : result;
}

export async function getStudentCare(studentId: string, page = 0) {
  page = z.number().int().min(0).max(9999).parse(page);
  z.string().uuid().parse(studentId);
  const access = await careAccess(studentId);
  const student = await careStudent(studentId, access.user.tenantId);
  const admin = createAdminClient();
  const [rows, references, staff] = await Promise.all([
    readStudentCareRows(access, studentId, page),
    careReferences(access.user, studentId, access.actor.canManage, access.readAll),
    access.actor.canManage ? admin.from("users").select("id,display_name").eq("tenant_id", access.user.tenantId).eq("status", "active").in("system_role", ["master", "admin", "manager", "teacher", "counselor"]).order("display_name").limit(500) : null,
  ]);
  // 실패·미적용·빈 목록을 서로 다르게 표현한다. 역직렬화 실패도 빈 상태로 위장하지 않는다.
  let records: CareRecord[] = [];
  let error = rows.error ? careStorageMessage(rows.error) : null;
  try { if (!error) records = (rows.data ?? []).slice(0, 100).map(careRow); } catch { error = "약속 기록 형식을 확인하지 못했습니다. 관리자에게 확인해 주세요."; }
  return { student, records, actor: access.actor, today: kstToday(), error, more: (rows.data?.length ?? 0) > 100, page,
    references, staff: (staff?.data ?? []).map((r) => ({ id: String(r.id), name: String(r.display_name ?? "이름 미정") })),
    staffError: !!staff?.error };
}
export type StudentCareView = Omit<Awaited<ReturnType<typeof getStudentCare>>, "student"> & {
  student: Awaited<ReturnType<typeof careStudent>> | null;
  intake?: { id: string; name: string; studentId: string | null };
};

/** 미완료 약속은 신규생 기간과 무관하게 남는다. 강사는 자신에게 배정된 항목만 조회한다. */
export async function getOpenCare(page = 0) {
  page = z.number().int().min(0).max(9999).parse(page);
  const { user, readAll } = await careAccess();
  const admin = createAdminClient();
  const build = (extended: boolean) => {
    let query = admin.from("student_care_commitments").select(extended ? "id,student_id,version,document,updated_at,source_id,intake_id" : CARE_COLUMNS).eq("tenant_id", user.tenantId).eq("state", "open");
    if (!readAll) query = query.eq("owner_id", user.id);
    return query.order("due_on").order("id").range(page * 100, page * 100 + 100).returns<CareRow[]>();
  };
  let result = await build(true);
  if (["42703", "PGRST204"].includes(result.error?.code ?? "")) result = await build(false);
  if (result.error) return { records: [], students: [], intakes: [], error: careStorageMessage(result.error), more: false, today: kstToday() };
  let records: CareRecord[];
  try { records = (result.data ?? []).slice(0, 100).map(careRow); } catch { return { records: [], students: [], intakes: [], error: "약속 기록 형식을 확인하지 못했습니다. 관리자에게 확인해 주세요.", more: false, today: kstToday() }; }
  const ids = [...new Set(records.flatMap((r) => r.studentId ? [r.studentId] : []))];
  const visible = readAll ? await visibleCareStudents(ids) : new Set(ids);
  const studentIds = ids.filter((id) => visible.has(id));
  const readIntakes = await canAccessTenant(user.systemRole, "enrollment");
  // 신규생 전체 보기 권한만으로 상담 전 원문/잠재고객 전체를 공개하지 않는다.
  const intakeIds = [...new Set(records.filter((r) => !r.studentId && r.intakeId && (!readAll || readIntakes || r.document.content.ownerId === user.id)).map((r) => r.intakeId!))];
  const [students, intakes] = await Promise.all([
    studentIds.length ? admin.from("students").select("id,name,enrolled_at").eq("tenant_id", user.tenantId).in("id", studentIds) : null,
    intakeIds.length ? admin.from("enrollment_consultations").select("id,prospect_name").eq("tenant_id", user.tenantId).in("id", intakeIds).is("student_id", null) : null,
  ]);
  const allowedIntakes = new Set((intakes?.data ?? []).map((r) => String(r.id)));
  return { records: records.filter((r) => r.studentId ? visible.has(r.studentId) : !!r.intakeId && allowedIntakes.has(r.intakeId)), students: students?.data ?? [], intakes: intakes?.data ?? [], error: students?.error || intakes?.error ? "대상 정보를 불러오지 못했습니다" : null,
    more: (result.data?.length ?? 0) > 100, today: kstToday() };
}
