import { SYSTEM_ROLES, type AccessMatrix } from "@/lib/permissions";

/** 원장 확정 첫 시범 지점(2026-10-22). 실험실 동의는 별도로 확인한다. */
export const CONTRIBUTION_PILOT_TENANT = "becaa316-e636-42e9-9d09-08b133e0b094";
export function capContributionMenu(matrix: AccessMatrix, tenantId: string): AccessMatrix {
  return { ...matrix, student_contribution: Object.fromEntries(SYSTEM_ROLES.map((role) => [role,
    tenantId === CONTRIBUTION_PILOT_TENANT && matrix.billing[role] !== "none" ? matrix.student_contribution[role] : "none",
  ])) as AccessMatrix["student_contribution"] };
}
