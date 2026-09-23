import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageSalary } from "./salary-access";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { autoSalaryGroup, type SalaryGroup } from "../salary-group";

export type ClassSalaryRow = {
  classId: string;
  className: string;
  subject: string;
  teacherName: string | null;
  /** 반 이름으로 자동 판정된 과정(근거 없으면 null). */
  autoGroup: SalaryGroup | null;
  /** 수동 지정 과정(있으면 자동을 이긴다). */
  manualGroup: SalaryGroup | null;
  /** 반별 수동 배분율 %. null = 과정별/기본 사용. */
  commissionRate: number | null;
  /** 비율제가 적용되는 요일(sun~sat). null = 전 요일(안분 없음). */
  appliesDows: string[] | null;
};

/**
 * 반별 급여 설정 목록 — **활성 반 전체**(설정 화면이라 splits가 없어도 미리 지정할 수 있어야 한다).
 * 정렬은 **지정이 필요한 것부터**: 과정 미분류(영어 코드명 반 등) → 그다음 반 이름.
 * ⚠️ class_salary_settings는 master 전용 RLS라 비-master가 부르면 설정이 전부 비어 보인다(값 누출 없음).
 */
export async function getClassSalaryRows(): Promise<ClassSalaryRow[]> {
  const supabase = await createClient();

  // 활성 반(종강 제외) — 108개 규모라 전건이지만 페이지네이션으로 절단 방어(B2).
  const classes = await fetchAllPaged<{
    id: string;
    class_name: string;
    subject: string;
    closed_at: string | null;
    teacher: { display_name?: string } | { display_name?: string }[] | null;
  }>((from, to) =>
    supabase
      .from("classes")
      .select("id, class_name, subject, closed_at, teacher:teacher_id ( display_name )")
      .eq("is_active", true)
      .order("class_name")
      .order("id")
      .range(from, to),
  );

  const ids = classes.map((c) => c.id);
  // 급여 값은 원장·총괄만(canManageSalary) — 통과하면 admin + 명시 tenant_id(RLS가 총괄을 0행으로 만들지 않게, [[#104]]).
  // 통과 못 하면 종전처럼 빈 설정(값 누출 없음).
  const viewer = await getCurrentUser();
  const salaryDb = viewer && (await canManageSalary()) ? createAdminClient() : null;
  const settings =
    ids.length > 0 && salaryDb && viewer
      ? await fetchInChunks<{
          class_id: string;
          salary_group: string | null;
          commission_rate: number | string | null;
          applies_dows: string[] | null;
        }>(
          ids,
          (chunk) =>
            salaryDb
              .from("class_salary_settings")
              .select("class_id, salary_group, commission_rate, applies_dows")
              .eq("tenant_id", viewer.tenantId)
              .in("class_id", chunk),
        )
      : [];
  const byClass = new Map(settings.map((s) => [s.class_id, s]));

  const rows: ClassSalaryRow[] = classes.map((c) => {
    const t = (Array.isArray(c.teacher) ? c.teacher[0] : c.teacher) as { display_name?: string } | undefined;
    const s = byClass.get(c.id);
    const manual = s?.salary_group ?? null;
    return {
      classId: c.id,
      className: c.class_name,
      subject: c.subject,
      teacherName: t?.display_name ?? null,
      autoGroup: autoSalaryGroup(c.class_name),
      manualGroup: (manual as SalaryGroup | null) ?? null,
      commissionRate:
        s?.commission_rate === null || s?.commission_rate === undefined ? null : Number(s.commission_rate),
      appliesDows: s?.applies_dows ?? null,
    };
  });

  // 미분류(자동·수동 둘 다 없음) 먼저 — 원장이 손대야 할 반이 위로 온다.
  return rows.sort((a, b) => {
    const au = a.manualGroup ?? a.autoGroup ? 1 : 0;
    const bu = b.manualGroup ?? b.autoGroup ? 1 : 0;
    return au - bu || a.className.localeCompare(b.className, "ko");
  });
}
