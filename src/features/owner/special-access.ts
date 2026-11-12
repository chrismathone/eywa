import { SPECIAL_ACCESS_ID_LISTS, type PermissionsSettings } from "./settings-types";
import { effectivePayslipManagerIds } from "./payslip-permissions";
import { isRecord } from "@/lib/guards";

type SpecialAccess = PermissionsSettings["specialAccess"];

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
const scopeKey = (userId: string, subjects: readonly string[]) => `${userId}:${[...subjects].sort().join("|")}`;

/**
 * 이 저장이 **새로 지정하는** 사람과 과목 — 저장 액션이 "지금 이 학원의 재직 직원인가 · 학원 설정에 있는 과목인가"를 볼 대상.
 *
 * `stored`를 주면 **이미 저장돼 있던 지정은 뺀다**(개인별 메뉴 권한과 같은 규칙): 전에 지정한 사람이 그 뒤 퇴직했거나
 * 범위의 과목이 없어졌다고 역할 표 저장까지 막히면, 화면에 안 보이는 줄 하나 때문에 이 면을 영영 저장할 수 없다.
 * `stored`가 null이면 요청 전부를 본다. 순수 함수 — 저장값은 깨져 있을 수 있어(손으로 넣은 값) 읽을 수 있는 것만 "있던 것"으로 친다.
 * ⚠️ 칸마다 따로 본다 — 급여명세서에 있던 사람을 수업 나누기에 새로 넣는 것은 새 지정이다.
 */
export function specialAccessTargets(next: SpecialAccess, stored: unknown): { userIds: string[]; subjects: string[] } {
  const before = isRecord(stored) ? stored : {};
  const added = SPECIAL_ACCESS_ID_LISTS.flatMap((key) => {
    const had = new Set(key === "payslipManagerIds" ? effectivePayslipManagerIds(before) : strings(before[key]));
    return (next[key] ?? []).filter((id) => !had.has(id));
  });
  const keptScopes = new Set(
    (Array.isArray(before.staffSubjectScopes) ? before.staffSubjectScopes : []).flatMap((row) =>
      isRecord(row) && typeof row.userId === "string" ? [scopeKey(row.userId, strings(row.subjects))] : [],
    ),
  );
  const changedScopes = next.staffSubjectScopes.filter((row) => !keptScopes.has(scopeKey(row.userId, row.subjects)));
  return {
    userIds: [...new Set([...added, ...changedScopes.map((row) => row.userId)])],
    subjects: [...new Set(changedScopes.flatMap((row) => row.subjects))],
  };
}
