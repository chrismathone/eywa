import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { isEdutrixDummyStudent } from "../edutrix-match";

export type EywaCandidate = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  status: string;
  alreadyMapped: boolean;
  label: string; // 선택 드롭다운용
};

export type UnmappedEdutrixRow = {
  edutrixId: string;
  name: string;
  school: string | null;
  grade: string | null;
  reportCount: number;
  candidates: EywaCandidate[];
  /** 테스트/더미 휴리스틱 — UI 기본 숨김 */
  likelyDummy: boolean;
};

export type EdutrixMapView = {
  ok: boolean;
  error?: string;
  /** eywa에 edutrix_student_id 가 있는 학생 수 */
  mappedCount: number;
  /** Edutrix 학생 중 보고서 1건+ 이면서 미매핑 */
  unmapped: UnmappedEdutrixRow[];
  /** Edutrix 학생 전체(테이블) */
  edutrixStudentCount: number;
};

type EduStudent = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
};

/**
 * Edutrix 미매핑 목록 — 수업보고서 탭 오버사이트용.
 * 보고서 1건 이상 있는 Edutrix 학생 중 students.edutrix_student_id 미연결.
 * 후보 = 같은 이름(exact) eywa 학생(연결 안내).
 */
export async function getEdutrixUnmapped(): Promise<EdutrixMapView> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다", mappedCount: 0, unmapped: [], edutrixStudentCount: 0 };

  const eduUrl = process.env.EDUTRIX_SUPABASE_URL;
  const eduKey = process.env.EDUTRIX_SUPABASE_ANON_KEY;
  if (!eduUrl || !eduKey) {
    return {
      ok: false,
      error: "EDUTRIX_SUPABASE_URL / ANON_KEY 미설정 — 미매핑 목록을 불러올 수 없습니다",
      mappedCount: 0,
      unmapped: [],
      edutrixStudentCount: 0,
    };
  }

  const edu = createSupabaseClient(eduUrl, eduKey);
  const supabase = await createClient();

  const [eduStudents, reportRows, eywaStudents] = await Promise.all([
    fetchAllPaged<EduStudent>((from, to) =>
      edu.from("students").select("id, name, school, grade").range(from, to),
    ),
    fetchAllPaged<{ student_id: string }>((from, to) =>
      edu.from("reports").select("student_id").range(from, to),
    ),
    fetchAllPaged<{
      id: string;
      name: string;
      school: string | null;
      grade: string | null;
      status: string;
      edutrix_student_id: string | null;
    }>((from, to) =>
      supabase
        .from("students")
        .select("id, name, school, grade, status, edutrix_student_id")
        .range(from, to),
    ),
  ]);

  const reportCount = new Map<string, number>();
  for (const r of reportRows) {
    if (!r.student_id) continue;
    reportCount.set(r.student_id, (reportCount.get(r.student_id) ?? 0) + 1);
  }

  const mappedEduIds = new Set(
    eywaStudents.map((s) => s.edutrix_student_id).filter((x): x is string => !!x),
  );
  const byName = new Map<string, typeof eywaStudents>();
  for (const s of eywaStudents) {
    const arr = byName.get(s.name) ?? [];
    arr.push(s);
    byName.set(s.name, arr);
  }

  const unmapped: UnmappedEdutrixRow[] = [];
  for (const es of eduStudents) {
    if (mappedEduIds.has(es.id)) continue;
    const rc = reportCount.get(es.id) ?? 0;
    if (rc === 0) continue; // 보고서 없는 학생은 목록에서 제외(노이즈)
    const peers = byName.get(es.name) ?? [];
    const candidates: EywaCandidate[] = peers.map((p) => ({
      id: p.id,
      name: p.name,
      school: p.school,
      grade: p.grade,
      status: p.status,
      alreadyMapped: !!p.edutrix_student_id,
      label: [
        p.name,
        schoolGradeLabel(p.school, p.grade) || null,
        p.status,
        p.edutrix_student_id ? "이미매핑" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }));
    unmapped.push({
      edutrixId: es.id,
      name: es.name,
      school: es.school,
      grade: es.grade,
      reportCount: rc,
      candidates,
      likelyDummy: isEdutrixDummyStudent({ name: es.name, school: es.school, grade: es.grade }),
    });
  }

  unmapped.sort((a, b) => b.reportCount - a.reportCount || a.name.localeCompare(b.name, "ko"));

  return {
    ok: true,
    mappedCount: mappedEduIds.size,
    unmapped,
    edutrixStudentCount: eduStudents.length,
  };
}
