import "server-only";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { sectionResult } from "@/features/students/ontology/live-contract";
import { canSeeStudentEnrollment } from "@/features/students/server/enrollment-gate";
import { saveJourneySchema, validateJourneyDates, summarizeJourney, kinds, statuses, eventDay, inquiryDay, type JourneyConsultation, type JourneyRecord } from "./model";

/**
 * 신규 콜&상담 여정 — 전화·방문·등록 확인 기록(aywa-next 인계 이식 · s2_0062 · 서버 전용 표).
 * 🔴 상담은 **사용자 클라이언트(RLS)** 로 먼저 읽어 열람 범위를 정하고, 기록 표는 admin + tenant_id로 읽되 그 상담에 걸린 것만 남긴다.
 * 쓰기는 `save_enrollment_journey` 한 함수(기록 + 이력 한 트랜잭션 · version 비교).
 * '다른 강사 뷰'면 그 강사로 판정하고 기록 명의도 그 강사다(#154 — 신규생 관리와 같은 규칙).
 */
export async function journeyAccess(write = false) {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !await canAccessTenant(user.systemRole, "enrollment")) throw Error("신규 콜&상담 열람 권한이 필요합니다");
  if (write && (user.tenantView || await readonlyTeacherViewError() || !await canWriteTenant(user.systemRole, "enrollment")))
    throw Error("이 화면에서는 기록을 수정할 수 없습니다");
  return user;
}

const consultColumns = "id,prospect_name,prospect_school,prospect_grade,parent_phone,student_id,consulted_at,received_date,consultation_date,consultation_path,outcome,counselor,consultant_id,legacy_source";
const recordColumns = "id,consultation_id,version,document,voided,updated_at,actor_id";

export async function loadJourney(consultationId?: string, year?: number) {
  const user = await journeyAccess(), db = await createClient(), admin = createAdminClient(), today = kstToday();
  if (consultationId && !z.uuid().safeParse(consultationId).success) throw Error("상담을 확인해 주세요");
  const thisYear = Number(today.slice(0, 4));
  const selectedYear = year && year >= 2021 && year <= thisYear ? year : thisYear;
  // 상담·기록·직원은 서로 독립 — 함께 읽는다(B4). 기록은 아래에서 열람 가능한 상담 것만 남긴다.
  const [rows, records, staff] = await Promise.all([
    fetchAllPaged<JourneyConsultation>((a, b) => {
      let q = db.from("enrollment_consultations").select(consultColumns).eq("tenant_id", user.tenantId).order("id");
      if (consultationId) q = q.eq("id", consultationId);
      return q.range(a, b);
    }),
    fetchAllPaged<JourneyRecord>((a, b) => {
      let q = admin.from("enrollment_journey_records").select(recordColumns).eq("tenant_id", user.tenantId).order("id");
      if (consultationId) q = q.eq("consultation_id", consultationId);
      return q.range(a, b);
    }),
    db.from("users").select("id,display_name,status,system_role").eq("tenant_id", user.tenantId)
      .in("system_role", ["master", "admin", "manager", "teacher", "counselor"]).order("display_name"),
  ]);
  if (consultationId && !rows.length) throw Error("상담을 찾을 수 없거나 열람 권한이 없습니다");
  if (staff.error) throw Error("담당자 목록을 불러오지 못했습니다");
  const visible = new Set(rows.map((r) => r.id)), safe = records.filter((r) => visible.has(r.consultation_id));
  const through = selectedYear === thisYear ? today : `${selectedYear}-12-31`;
  const summary = summarizeJourney(rows, safe, `${selectedYear}-01-01`, through);
  const choices = rows.map((r) => ({ id: r.id, name: r.prospect_name, label: `${r.prospect_name} · ${r.prospect_school ?? "학교 미기재"} ${r.prospect_grade ?? ""} · ${inquiryDay(r)}`, studentId: r.student_id ?? null, legacyDate: r.consultation_date, path: r.consultation_path }));
  const canWrite = !user.tenantView && !await readonlyTeacherViewError() && await canWriteTenant(user.systemRole, "enrollment");
  // 연락처는 서버의 같은 사람 판정에만 쓴다 — 화면으로 보내는 값에 싣지 않는다.
  return { today, year: selectedYear, through, summary, records: safe, choices, staff: staff.data, currentUser: user.id, canWrite, consultationId: consultationId ?? null };
}
export type JourneyData = Awaited<ReturnType<typeof loadJourney>>;

export async function saveJourney(raw: unknown) {
  const input = saveJourneySchema.parse(raw), user = await journeyAccess(true), db = await createClient();
  const dateError = validateJourneyDates(input.document, kstToday());
  if (dateError) throw Error(dateError);
  const target = await db.from("enrollment_consultations").select("id").eq("tenant_id", user.tenantId).eq("id", input.consultationId).maybeSingle();
  if (target.error || !target.data) throw Error("상담을 찾을 수 없거나 기록 권한이 없습니다");
  const { data, error } = await createAdminClient().rpc("save_enrollment_journey", {
    p_tenant: user.tenantId, p_actor: user.id, p_consultation: input.consultationId, p_id: input.id,
    p_expected: input.expectedVersion, p_document: input.document, p_voided: input.voided, p_reason: input.reason,
  });
  if (error) {
    if (error.code !== "40001") console.error("[enrollment.journey.save]", error.code, error.message);
    throw Error(error.code === "40001" ? "다른 담당자가 변경했습니다. 새로고침 후 다시 확인해 주세요" : "저장하지 못했습니다. 날짜와 담당자를 확인해 주세요");
  }
  return data;
}

export async function journeyHistory(id: string) {
  if (!z.uuid().safeParse(id).success) throw Error("기록을 확인해 주세요");
  const user = await journeyAccess(), admin = createAdminClient();
  const r = await admin.from("enrollment_journey_records").select("consultation_id").eq("tenant_id", user.tenantId).eq("id", id).maybeSingle();
  if (r.error || !r.data) throw Error("기록을 확인해 주세요");
  // 상담 열람 범위(RLS)를 다시 본다 — 기록 id만 알아도 이력이 열리지 않게.
  const check = await (await createClient()).from("enrollment_consultations").select("id").eq("tenant_id", user.tenantId).eq("id", r.data.consultation_id).maybeSingle();
  if (check.error || !check.data) throw Error("기록 열람 권한을 확인해 주세요");
  const history = await admin.from("enrollment_journey_revisions").select("version,document,voided,actor_id,reason,recorded_at")
    .eq("tenant_id", user.tenantId).eq("record_id", id).order("version", { ascending: false });
  if (history.error) throw Error("변경 이력을 불러오지 못했습니다");
  return history.data;
}

/** 학생 통합 기록의 '전화·방문·등록 확인 기록' 칸 — 그 학생에게 이어진 상담의 기록(집계 제외 기록은 뺀다). */
export async function studentJourneySection(studentId: string) {
  const user = await journeyAccess();
  if (!await canSeeStudentEnrollment(user.systemRole, studentId)) throw Error("학생 입학상담 열람 권한이 필요합니다");
  const db = await createClient(), admin = createAdminClient();
  const c = await db.from("enrollment_consultations").select("id").eq("tenant_id", user.tenantId).eq("student_id", studentId);
  if (c.error) throw Error("연결 상담을 확인하지 못했습니다");
  const ids = (c.data ?? []).map((r) => r.id);
  const records = await fetchAllPagedInChunks<JourneyRecord>(ids, (chunk, a, b) => admin.from("enrollment_journey_records").select(recordColumns)
    .eq("tenant_id", user.tenantId).in("consultation_id", chunk).eq("voided", false).order("id").range(a, b));
  return sectionResult("admissionJourney", "전화·방문·등록 확인 기록", "/enrollment/visits", records.map((r) => ({
    id: r.id, title: `${kinds[r.document.kind]} · ${statuses[r.document.status]}`, date: eventDay(r),
    detail: `${r.document.evidence}${r.document.nextAction ? ` / 후속: ${r.document.nextAction} (${r.document.nextDoneOn ? "완료" : "진행 중"})` : ""}`,
    evidence: [{ source: "enrollment_journey_records", id: r.id, studentId, href: `/enrollment/${r.consultation_id}#journey` }],
  })), records.length);
}
