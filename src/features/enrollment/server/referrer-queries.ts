import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { findReferrerCandidates, referrerValueOf, type ReferrerColumns, type ReferrerOption } from "../referrer";

/**
 * 콜&상담 '소개한 사람' 고르기 목록(0362a) — 그 학원의 원생(퇴원생·시험용 학생 제외)과 직원(재직 중).
 * 🔴 호출부가 콜&상담 쓰기 권한을 먼저 확인한다(목록 = 학생 이름·학교라서). 지점 조건은 여기서 건다(관리 클라이언트로 불러도 새지 않게).
 * 학생이 1,000명을 넘을 수 있어 `fetchAllPaged`(B2).
 */
const STAFF_ROLES = ["master", "admin", "manager", "counselor", "teacher", "accountant"] as const;

export async function listReferrerOptions(db: SupabaseClient, tenantId: string): Promise<ReferrerOption[]> {
  const [students, staff] = await Promise.all([
    fetchAllPaged<{ id: string; name: string; school: string | null; grade: string | null }>((a, b) =>
      db.from("students").select("id, name, school, grade").eq("tenant_id", tenantId).neq("status", "withdrawn")
        .eq("is_test", false).order("name").order("id").range(a, b)),
    fetchAllPaged<{ id: string; display_name: string | null }>((a, b) =>
      db.from("users").select("id, display_name").eq("tenant_id", tenantId).eq("status", "active")
        .in("system_role", [...STAFF_ROLES]).order("display_name").order("id").range(a, b)),
  ]);
  return [
    ...students.map((s) => ({ value: referrerValueOf("student", s.id), label: s.name, hint: schoolGradeLabel(s.school, s.grade) || "원생" })),
    ...staff.filter((u) => u.display_name?.trim())
      .map((u) => ({ value: referrerValueOf("staff", u.id), label: (u.display_name as string).trim(), hint: "직원" })),
  ];
}

/**
 * 아직 소개한 사람을 잇지 않은 상담의 **후보** — 글 칸에 이름이 그대로 나오는 원생·직원. 화면이 '연결' 버튼으로만 잇는다.
 * 소개 흔적(글로 받은 이름 · 상담 경로의 소개·추천)이 없으면 목록을 읽지 않는다(수정 화면을 열 때마다 학생 전체를 읽지 않게).
 */
export async function referrerCandidatesFor(
  db: SupabaseClient, tenantId: string, input: { referrerName: string | null; path: string | null; texts: (string | null)[] },
): Promise<ReferrerOption[]> {
  const hinted = Boolean(input.referrerName?.trim()) || /소개|추천/.test(input.path ?? "");
  if (!hinted) return [];
  const options = await listReferrerOptions(db, tenantId);
  return findReferrerCandidates([input.referrerName, input.path, ...input.texts], options);
}

const REFERRER_COLUMNS = "referrer_student_id, referrer_staff_id, referrer_name";

/** 저장 전 소개 연결(감사로그용) — 실패하면 null(감사 요약만 빠지고 저장은 그대로). */
export async function readReferrerBefore(db: SupabaseClient, consultationId: string): Promise<Partial<ReferrerColumns> | null> {
  const { data, error } = await db.from("enrollment_consultations").select(REFERRER_COLUMNS).eq("id", consultationId).maybeSingle();
  if (error) { console.error("[enrollment/referrer] 저장 전 소개 연결 조회 실패", error.code, error.message); return null; }
  return (data as Partial<ReferrerColumns> | null) ?? null;
}

/**
 * 상세·수정 화면의 소개한 사람 — 🔴 기본 상세 조회와 **따로·실패해도 되게** 읽는다(#95: 0362a 전 DB에서 기본 조회까지 죽지 않게).
 * `ready=false`(칸이 없음·조회 실패)면 화면은 고르기 칸을 그리지 않는다 → 저장도 소개 칸을 건드리지 않는다.
 */
export async function loadConsultationReferrer(db: SupabaseClient, consultationId: string): Promise<{
  ready: boolean; referrer: ReferrerOption | null; referrerName: string | null;
}> {
  const { data, error } = await db.from("enrollment_consultations")
    .select(`${REFERRER_COLUMNS}, ref_student:referrer_student_id ( name, school, grade ), ref_staff:referrer_staff_id ( display_name )`)
    .eq("id", consultationId).maybeSingle();
  if (error || !data) {
    if (error) console.error("[enrollment/referrer] 소개한 사람 조회 실패", error.code, error.message);
    return { ready: !error, referrer: null, referrerName: null };
  }
  const row = data as unknown as ReferrerColumns & {
    ref_student: { name: string; school: string | null; grade: string | null } | null; ref_staff: { display_name: string | null } | null;
  };
  // 이름을 못 읽어도(권한·삭제) 연결은 그대로 싣는다 — 빈 칸으로 보이면 그대로 저장할 때 연결이 지워진다.
  const referrer: ReferrerOption | null = row.referrer_student_id
    ? {
      value: referrerValueOf("student", row.referrer_student_id), label: row.ref_student?.name ?? "원생(이름 확인 불가)",
      hint: row.ref_student ? schoolGradeLabel(row.ref_student.school, row.ref_student.grade) || "원생" : "원생",
    }
    : row.referrer_staff_id
      ? { value: referrerValueOf("staff", row.referrer_staff_id), label: row.ref_staff?.display_name?.trim() || "직원", hint: "직원" }
      : null;
  return { ready: true, referrer, referrerName: row.referrer_name ?? null };
}

/** 새 상담 화면 — 소개 칸(0362a)이 DB에 있는지(없으면 고르기 칸을 그리지 않는다, #95). 행을 받지 않는다. */
export async function referrerColumnsReady(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from("enrollment_consultations").select("referrer_name", { head: true, count: "exact" }).limit(1);
  if (error) console.error("[enrollment/referrer] 소개 칸 확인 실패", error.code, error.message);
  return !error;
}

/** 감사로그용 소개한 사람 이름 — 원생 = 이름, 직원 = '이름(직원)'. 못 읽으면 '원생'·'직원'(감사 요약만 흐려지고 저장은 그대로). */
export async function referrerLabelOf(db: SupabaseClient, cols: Partial<ReferrerColumns> | null): Promise<string | null> {
  if (cols?.referrer_student_id) {
    const { data } = await db.from("students").select("name").eq("id", cols.referrer_student_id).maybeSingle();
    return (data?.name as string | undefined) ?? "원생";
  }
  if (cols?.referrer_staff_id) {
    const { data } = await db.from("users").select("display_name").eq("id", cols.referrer_staff_id).maybeSingle();
    return `${(data?.display_name as string | null | undefined)?.trim() || "이름 없음"}(직원)`;
  }
  return null;
}
