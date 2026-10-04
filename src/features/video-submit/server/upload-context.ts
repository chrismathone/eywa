import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { linkVideoRoute, type LinkVideoRoute, type VideoClassRow } from "../route";
import type { LinkRow } from "./links";

type Db = ReturnType<typeof createAdminClient>;

/**
 * 링크의 학생·반·지금 담임 → 담임 폴더 판정 재료. 🔴 전부 **링크 행의 지점**으로 좁힌다(admin 클라는 RLS를 우회한다 — #104).
 * 반·학생이 그 지점 것이 아니면 null(링크를 쓰지 않는다).
 */
export async function loadLinkRoute(db: Db, link: LinkRow, rootId: string, connectionId: string | null = null): Promise<LinkVideoRoute | null> {
  const [studentRes, classRes] = await Promise.all([
    db.from("students").select("id,name,school,grade").eq("tenant_id", link.tenant_id).eq("id", link.student_id).maybeSingle(),
    db.from("classes").select("id,class_name,subject,teacher_id").eq("tenant_id", link.tenant_id).eq("id", link.class_id).maybeSingle(),
  ]);
  if (studentRes.error || classRes.error) throw new Error("학생·반을 읽지 못했습니다.");
  if (!studentRes.data || !classRes.data) return null;
  const teacherId = (classRes.data.teacher_id as string | null) ?? null;
  type TeacherRow = { display_name: string | null; status: string | null };
  let teacher: TeacherRow | null = null;
  let sameNameCount = 0;
  if (teacherId) {
    const teacherRes = await db.from("users").select("display_name,status").eq("tenant_id", link.tenant_id).eq("id", teacherId).maybeSingle();
    if (teacherRes.error) throw new Error("담임을 읽지 못했습니다.");
    teacher = (teacherRes.data as TeacherRow | null) ?? null;
    if (teacher?.display_name) {
      // 워커와 같은 동명 판정 — 같은 지점 **재직** 직원 중 같은 표시 이름 수(행을 받지 않고 센다, B2).
      const same = await db.from("users").select("id", { count: "exact", head: true })
        .eq("tenant_id", link.tenant_id).eq("status", "active").eq("display_name", teacher.display_name);
      if (same.error) throw new Error("담임 이름을 확인하지 못했습니다.");
      sameNameCount = same.count ?? 0;
    }
  }
  const klass: VideoClassRow = {
    class_id: classRes.data.id as string, class_name: (classRes.data.class_name as string | null) ?? null,
    subject: (classRes.data.subject as string | null) ?? null, teacher_id: teacherId,
    teacher_name: teacher?.display_name ?? null, teacher_status: teacher?.status ?? null, same_name_count: sameNameCount,
  };
  const s = studentRes.data;
  return linkVideoRoute({
    tenantId: link.tenant_id, rootId, connectionId,
    student: { id: s.id as string, name: (s.name as string | null) ?? null, school: (s.school as string | null) ?? null, grade: (s.grade as string | null) ?? null },
    klass,
  });
}
