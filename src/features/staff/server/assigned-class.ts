import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";

/**
 * 이 직원이 **맡은 반이 하나라도 있는가** — 담임(`classes.teacher_id`) ∪ 시간표 교시 담당(`class_schedules.teacher_id`).
 * 성적관리 강사 스코프([`gradeTeacherClassScope`](@/features/grades/server/teacher-classes))와 같은 두 갈래를 본다
 * (지난 학기 반·지난 슬롯도 센다 — 이미 보낸 보고서의 이름이 걸린 사람을 '반 없음'으로 보지 않게).
 *
 * 쓰임: 내 정보의 '수업보고서 이름' 카드 — 원장 2026-11-05 *"수업이 없는 일반 아르바이트 (소속 반이 없음) 필요없음"*.
 *
 * 🔑 service-role로 읽는다 — 아르바이트는 기본 메뉴가 없어 반·시간표 읽기 권한이 없을 수 있다. RLS에 막혀 0건이 나오면
 *    반을 맡은 사람의 카드까지 사라진다. 대신 **본인 id + 지점**으로만 좁히고 건수만 센다(행 내용은 읽지 않는다).
 * ⚠️ 조회 실패는 **있음(true)으로** 본다 — 카드가 하나 더 보이는 건 무해하지만, 반을 맡은 사람의 카드가 사라지면 기능을 잃는다.
 */
export async function hasAssignedClass(userId: string, tenantId: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const [own, slots] = await Promise.all([
      admin
        .from("classes")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("teacher_id", userId),
      admin
        .from("class_schedules")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("teacher_id", userId),
    ]);
    if (own.error || slots.error) {
      reportError(own.error ?? slots.error, { scope: "staff.hasAssignedClass", userId });
      return true;
    }
    return (own.count ?? 0) + (slots.count ?? 0) > 0;
  } catch (e) {
    reportError(e, { scope: "staff.hasAssignedClass", userId });
    return true;
  }
}
