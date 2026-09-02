import "server-only";

/**
 * 출석부 '보강' 임시 반의 **재료 조회** — 규약·판정은 순수부([`makeup-group.ts`](../makeup-group.ts)).
 *
 * 🔴 **쓰기 0.** 그 달 이 강사의 보강 보고서를 읽어 학생×날짜 격자를 만들 뿐이다(원장 2026-09-02:
 *    *"그냥 출석부에 '보강' 반을 임시로 만들어서 그 아래에 학생이 있으면 돼"*).
 * 🔴 **대상 = 반 없는 보강 보고서**(`makeup=true` ∧ `class_id IS NULL`) — 반이 붙은 보강은 그 반
 *    출석부에 이미 `status='makeup'` 칸으로 서 있어서, 여기 또 담으면 같은 사실이 두 줄이 된다.
 * ⚠️ 소유 판정은 원스크린과 **같은 규약**([`ownsMakeupReport`](@/features/onescreen/makeup-owner)) —
 *    계정 id가 먼저고 옛 행만 이름 폴백이다. 사무실(강사 아님)은 이 덩어리를 안 본다(볼 축이 없다).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { ownsMakeupReport } from "@/features/onescreen/makeup-owner";
import { foldMakeupRows, type MakeupReportRow } from "../makeup-group";

export type MakeupGroupStudent = {
  id: string;
  name: string;
  grade: string | null;
  school: string | null;
  dates: Record<string, true>;
};

/**
 * 그 달 · 그 강사의 '보강' 학생들(이름순).
 * @param teacherName 옛 행 폴백용 표시 이름 — 없으면 계정 id로만 판정한다.
 */
export async function getMakeupGroupStudents(input: {
  tenantId: string;
  teacherId: string;
  teacherName: string | null;
  from: string;
  to: string;
}): Promise<MakeupGroupStudent[]> {
  const admin = createAdminClient();
  // ⚠️ admin은 RLS 우회라 tenant 필터가 필수다([[#104]]).
  const rows = await fetchAllPaged<{
    student_id: string;
    report_date: string;
    created_by: string | null;
    teacher_name: string | null;
  }>((from, to) =>
    admin
      .from("lesson_reports")
      .select("student_id, report_date, created_by, teacher_name")
      .eq("tenant_id", input.tenantId)
      .eq("makeup", true)
      .is("class_id", null)
      .gte("report_date", input.from)
      .lte("report_date", input.to)
      .order("report_date")
      .range(from, to),
  );
  const mine: MakeupReportRow[] = rows
    .filter((r) =>
      ownsMakeupReport(
        { createdBy: r.created_by, teacherName: r.teacher_name },
        input.teacherId,
        input.teacherName ?? "",
      ),
    )
    .map((r) => ({ studentId: r.student_id, date: String(r.report_date) }));
  const folded = foldMakeupRows(mine);
  if (folded.studentIds.length === 0) return [];

  const { data: students } = await admin
    .from("students")
    .select("id, name, grade, school")
    .eq("tenant_id", input.tenantId)
    .in("id", folded.studentIds);
  const byId = new Map((students ?? []).map((s) => [s.id as string, s]));
  return folded.studentIds
    .map((id) => {
      const s = byId.get(id);
      if (!s) return null; // 학생이 지워졌으면 줄을 세우지 않는다(이름 없는 행은 아무 뜻이 없다).
      return {
        id,
        name: (s.name as string) ?? "",
        grade: (s.grade as string | null) ?? null,
        school: (s.school as string | null) ?? null,
        dates: folded.datesByStudent[id] ?? {},
      };
    })
    .filter((x): x is MakeupGroupStudent => x !== null)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
