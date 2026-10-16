import "server-only";
import { getReviewPrivileges } from "@/features/class-review/server/queries";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { addDays, kstToday } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { PORTFOLIO_MONTHS } from "../model/build";
import { monthWindows } from "../model/dates";
import type { StoredPeriod } from "../model/types";
import { loadPortfolioIndex, loadTeacherPeriods } from "./store";

/**
 * 직원 포트폴리오 화면 조회 — 저장된 달만 읽는다(무거운 집계는 cron·[지금 집계]가 한다).
 *
 * 🔴 게이트는 `getPortfolioGate()` 하나다 — 화면·조회·집계 액션이 모두 이 함수를 지난다(#77).
 *    전 강사의 점수와 담당 매출이 한 화면에 실리므로 **원장 역할만** 본다(직원 평가 개인 예외로는 열리지 않는다).
 * 🔴 표의 정책이 0개라 admin으로 읽는다 → tenant_id 명시.
 */
export type PortfolioTeacherEntry = {
  id: string;
  name: string;
  /** 직원 정보에 등록한 과목 키 — 그 달 수업이 없을 때의 분류에 쓴다. */
  subjects: string[];
  months: Record<string, { knownCount: number; classCount: number; subjects: string[] }>;
};
export type PortfolioView =
  | { state: "tableMissing" | "empty" }
  | {
    state: "ready";
    teachers: PortfolioTeacherEntry[];
    selected: { id: string; name: string; periods: StoredPeriod[] };
    studentNames: Record<string, string>;
    /** 학생 → 학교·학년(지금 값 · `schoolGradeLabel`). */
    studentSchools: Record<string, string>;
  };

export async function getPortfolioGate(): Promise<{ tenantId: string; userId: string } | null> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canAccessTenant(user.systemRole, "class_review"))) return null;
  return (await getReviewPrivileges()).seePortfolio ? { tenantId: user.tenantId, userId: user.id } : null;
}

/** 화면에 쓰는 달 — 한국 시간 어제가 속한 달부터 6개월 + 전월 비교용 1개월. */
export function portfolioMonthKeys(now: Date = new Date()): string[] {
  return monthWindows(addDays(kstToday(now), -1), PORTFOLIO_MONTHS).map((w) => w.month);
}

function studentIdsIn(periods: readonly StoredPeriod[]): string[] {
  const ids = new Set<string>();
  for (const w of periods) for (const m of w.items) {
    for (const row of m.detail as { studentId?: string; referrerStudentId?: string | null }[]) {
      if (row.studentId) ids.add(row.studentId);
      if (row.referrerStudentId) ids.add(row.referrerStudentId); // 원생 소개 — 소개한 원생 이름
    }
  }
  return [...ids];
}

export async function getPortfolioView(opts: { teacherId?: string | null }): Promise<PortfolioView | null> {
  const gate = await getPortfolioGate();
  if (!gate) return null;
  const admin = createAdminClient();
  const months = portfolioMonthKeys();
  const shown = months.slice(0, PORTFOLIO_MONTHS - 1);
  const index = await loadPortfolioIndex(admin, gate.tenantId, shown);
  if (index.tableMissing) return { state: "tableMissing" };
  if (!index.rows.length) return { state: "empty" };

  const ids = [...new Set(index.rows.map((r) => r.teacherId))];
  const users = await fetchInChunks<{ id: string; display_name: string | null; subjects: string[] | null }>(ids, (chunk) =>
    admin.from("users").select("id, display_name, subjects").eq("tenant_id", gate.tenantId).in("id", chunk));
  const userOf = new Map(users.map((u) => [u.id, u]));
  const teachers: PortfolioTeacherEntry[] = ids.flatMap((id) => {
    const user = userOf.get(id);
    if (!user) return [];
    return [{
      id, name: user.display_name ?? "", subjects: user.subjects ?? [],
      months: Object.fromEntries(index.rows.filter((r) => r.teacherId === id)
        .map((r) => [r.month, { knownCount: r.knownCount, classCount: r.classCount, subjects: r.subjects }])),
    }];
  }).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  if (!teachers.length) return { state: "empty" };

  const selected = teachers.find((t) => t.id === opts.teacherId) ?? teachers[0];
  const periods = await loadTeacherPeriods(admin, gate.tenantId, selected.id, months);
  const studentIds = studentIdsIn(periods);
  const students = await fetchInChunks<{ id: string; name: string | null; school: string | null; grade: string | null }>(studentIds, (chunk) =>
    admin.from("students").select("id, name, school, grade").eq("tenant_id", gate.tenantId).in("id", chunk));
  return {
    state: "ready", teachers, selected: { id: selected.id, name: selected.name, periods },
    studentNames: Object.fromEntries(students.map((s) => [s.id, s.name ?? ""])),
    studentSchools: Object.fromEntries(students.map((s) => [s.id, schoolGradeLabel(s.school, s.grade)])),
  };
}
