import "server-only";
import { createClient } from "@/lib/supabase/server";
import { type SystemRole } from "@/lib/permissions";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";

export type PaletteHit = {
  kind: "student" | "class" | "consultation" | "enrollment";
  id: string;
  title: string;
  subtitle: string | null;
};

/** PostgREST .or()/ilike 안전화 — 구분자·와일드카드 문자 제거(한글/공백은 보존). */
function sanitize(q: string): string {
  return q.replace(/[%,()*\\]/g, " ").trim();
}

const LIMIT = 8;

async function searchStudents(term: string): Promise<PaletteHit[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("students")
    .select("id, name, school, grade")
    .or(
      `name.ilike.%${term}%,school.ilike.%${term}%,parent_name.ilike.%${term}%,parent_phone.ilike.%${term}%`,
    )
    .order("name", { ascending: true })
    .limit(LIMIT);
  return (data ?? []).map(
    (r): PaletteHit => ({
      kind: "student",
      id: r.id,
      title: r.name,
      subtitle: [r.school, r.grade].filter(Boolean).join(" · ") || null,
    }),
  );
}

async function searchClasses(term: string): Promise<PaletteHit[]> {
  const supabase = await createClient();
  const [{ data }, settings] = await Promise.all([
    supabase
      .from("classes")
      .select("id, class_name, subject")
      .or(`class_name.ilike.%${term}%,subject.ilike.%${term}%`)
      .limit(LIMIT),
    getTenantSettings(),
  ]);
  // 과목 코드 → 한글 라벨(설정 기반). 원시 영문 코드("highmath")가 팰릿에 노출되지 않게.
  const subjects = buildSubjectMaps(settings.operations.subjects);
  return (data ?? []).map(
    (r): PaletteHit => ({
      kind: "class",
      id: r.id,
      title: r.class_name,
      subtitle: r.subject ? subjects.labelOf(r.subject) : null,
    }),
  );
}

async function searchConsultations(term: string): Promise<PaletteHit[]> {
  const supabase = await createClient();
  // 강사 스코프: 강사는 **본인이 등록한 상담(counselor_id=나)** 만 검색 — 목록/상세와 동일 불변식(남의 상담 미노출).
  const user = await getCurrentUser();
  // ⚠️ filter(.eq)는 transform(.order/.limit)보다 먼저 — supabase-js는 transform 뒤 filter 불가.
  let qb = supabase
    .from("student_consultations")
    .select("id, summary, consulted_at, student:student_id ( name )")
    .ilike("summary", `%${term}%`);
  if (user?.systemRole === "teacher") qb = qb.eq("counselor_id", user.id);
  const { data } = await qb.order("consulted_at", { ascending: false }).limit(LIMIT);
  return (data ?? []).map((r): PaletteHit => {
    const s = (Array.isArray(r.student) ? r.student[0] : r.student) as { name?: string } | undefined;
    return {
      kind: "consultation",
      id: r.id,
      title: s?.name ? `${s.name} 상담` : "상담",
      subtitle: r.summary ? String(r.summary).slice(0, 40) : null,
    };
  });
}

async function searchEnrollment(term: string): Promise<PaletteHit[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("enrollment_consultations")
    .select("id, prospect_name, prospect_school")
    .or(`prospect_name.ilike.%${term}%,parent_name.ilike.%${term}%,parent_request.ilike.%${term}%`)
    .limit(LIMIT);
  return (data ?? []).map(
    (r): PaletteHit => ({
      kind: "enrollment",
      id: r.id,
      title: r.prospect_name ?? "등록상담",
      subtitle: r.prospect_school ?? "등록상담",
    }),
  );
}

/**
 * 커맨드 팰릿 데이터 검색 — 접근 권한 있는 메뉴만 병렬 검색. 결과는 학생→수업→상담→등록상담 순.
 * RLS(auth_tenant_id())가 테넌트 자동 격리, pg_trgm GIN이 ILIKE 가속(0024a 마이그레이션).
 */
export async function searchPalette(q: string, role: SystemRole): Promise<PaletteHit[]> {
  const term = sanitize(q);
  if (term.length < 2) return [];
  const tasks: Promise<PaletteHit[]>[] = [];
  if (await canAccessTenant(role, "students")) tasks.push(searchStudents(term));
  if (await canAccessTenant(role, "classes")) tasks.push(searchClasses(term));
  if (await canAccessTenant(role, "consultations")) tasks.push(searchConsultations(term));
  if (await canAccessTenant(role, "enrollment")) tasks.push(searchEnrollment(term));
  const groups = await Promise.all(tasks);
  return groups.flat();
}
