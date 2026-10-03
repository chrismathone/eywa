import { SALARY_GROUPS, type GroupRates } from "@/features/payroll/salary-group";
import type { SalaryType } from "@/features/payroll/settlement";

/** 목록에 보이는 급여 방식 한 줄. 계산은 바꾸지 않고, 비어 있는 기본 비율을 "?%"로 적지 않는다. */
export function teacherCompSummary(input: {
  salaryType: SalaryType | null;
  commissionRate: number | null;
  monthlyBase: number;
  groupRates?: GroupRates | null;
}): { text: string; groupSpan: string | null } {
  const rates = input.groupRates ?? {};
  const groupCount = SALARY_GROUPS.filter((group) => {
    const rate = rates[group];
    return typeof rate === "number" && Number.isFinite(rate);
  }).length;
  const groupSpan = groupCount > 0 ? `· 과정별 ${groupCount}` : null;
  const won = `${input.monthlyBase.toLocaleString("ko-KR")}원`;
  const rate = input.commissionRate;
  const hasRate = typeof rate === "number" && Number.isFinite(rate);
  const allGroups = groupCount === SALARY_GROUPS.length;

  if (input.salaryType === null) return { text: "미설정", groupSpan };
  if (input.salaryType === "fixed") return { text: `급여제 ${won}`, groupSpan };

  if (input.salaryType === "hybrid") {
    if (hasRate) return { text: `혼합 ${won}+${rate}%`, groupSpan };
    if (allGroups) return { text: `혼합 ${won} · 과정별 ${groupCount}`, groupSpan: null };
    return { text: `혼합 ${won} · 기본 비율 미설정`, groupSpan };
  }

  if (hasRate) return { text: `비율제 ${rate}%`, groupSpan };
  if (allGroups) return { text: `비율제 · 과정별 ${groupCount}`, groupSpan: null };
  return { text: `비율제 · 기본 비율 미설정`, groupSpan };
}
