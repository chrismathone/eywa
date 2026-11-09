import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./defaults";
import { GENERIC_SETTINGS } from "./generic-defaults";
import { permissionsCanonical } from "./permissions-canonical";
import { diffSettingsSection, formatSettingChange } from "./settings-diff";
import { permissionsSchema, SPECIAL_ACCESS_ID_LISTS, type PermissionsSettings } from "./settings-types";
import { specialAccessTargets } from "./special-access";

/**
 * 학원 설정 '데스크 담당자'(원장 2026-11-06 *"데스크 담당자는 학원 설정에서 지정"* · `specialAccess.withdrawalDeskIds`) —
 * '퇴원보고서 승인자'와 같은 화면·같은 저장 방식(c0974591d). 퇴원보고서 환불 승인의 데스크 담당은 여기 지정한 사람(그중 수납 쓰기 권한자)만이고,
 * DB(s2_0036 `attach_withdrawal_report_refund`)도 같은 칸을 읽는다. 비면 환불 승인을 막는다.
 */
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ROOT = process.cwd();
const special = (patch: Partial<PermissionsSettings["specialAccess"]> = {}) => ({ payslipViewerIds: [], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [], ...patch });
const perms = (patch: Partial<PermissionsSettings["specialAccess"]> = {}): PermissionsSettings => ({ overrides: [], userOverrides: [], specialAccess: special(patch) });

describe("학원 설정 '데스크 담당자'", () => {
  it("사람 id 명단 칸이다 — 저장 검사(재직 직원) · 운영 계정 보호 · 옛 화면 보존이 같은 목록을 돈다", () => {
    expect(SPECIAL_ACCESS_ID_LISTS).toContain("withdrawalDeskIds");
    expect(permissionsSchema.parse({ overrides: [], specialAccess: special({ withdrawalDeskIds: [A] }) }).specialAccess.withdrawalDeskIds).toEqual([A]);
    expect(permissionsSchema.safeParse({ overrides: [], specialAccess: special({ withdrawalDeskIds: [A, A] }) }).success).toBe(false);
    expect(permissionsSchema.safeParse({ overrides: [], specialAccess: special({ withdrawalDeskIds: ["not-a-uuid"] }) }).success).toBe(false);
    // 옛 저장값(칸 없음)도 읽힌다 — 없음 = 빈 명단.
    expect(permissionsSchema.parse({ overrides: [], specialAccess: special() }).specialAccess.withdrawalDeskIds).toBeUndefined();
  });

  it("기본값 둘은 빈 명단이다(지정 전 = 환불 승인 막힘)", () => {
    expect(DEFAULT_SETTINGS.permissions.specialAccess.withdrawalDeskIds).toEqual([]);
    expect(GENERIC_SETTINGS.permissions.specialAccess.withdrawalDeskIds).toEqual([]);
  });

  it("새로 지정하는 사람은 저장 검사 대상이다(이미 있던 사람은 아니다) · 퇴원보고서 승인자와 다른 칸이다", () => {
    expect(specialAccessTargets(special({ withdrawalDeskIds: [A] }), special()).userIds).toEqual([A]);
    expect(specialAccessTargets(special({ withdrawalDeskIds: [A] }), special({ withdrawalDeskIds: [A] })).userIds).toEqual([]);
    expect(specialAccessTargets(special({ withdrawalDeskIds: [A] }), special({ withdrawalApproverIds: [A] })).userIds).toEqual([A]);
  });

  it("바꾸면 역할·권한 표준 문자열이 달라진다(화면을 연 뒤 다른 곳이 바꿨으면 저장을 막는 기준)", () => {
    expect(permissionsCanonical(perms({ withdrawalDeskIds: [A] }))).not.toBe(permissionsCanonical(perms()));
    expect(permissionsCanonical(perms({ withdrawalDeskIds: [A, B] }))).toBe(permissionsCanonical(perms({ withdrawalDeskIds: [B, A] })));
    expect(permissionsCanonical(perms({ withdrawalDeskIds: [A] }))).not.toBe(permissionsCanonical(perms({ withdrawalApproverIds: [A] })));
  });

  it("설정 변경 감사로그에 '데스크 담당자'로 남는다(지정 · 해제)", () => {
    const added = diffSettingsSection("permissions", perms(), perms({ withdrawalDeskIds: [A] }));
    expect(added.changes.map(formatSettingChange).join(" / ")).toContain("데스크 담당자");
    const removed = diffSettingsSection("permissions", perms({ withdrawalDeskIds: [A] }), perms());
    expect(removed.changes).toHaveLength(1);
    expect(formatSettingChange(removed.changes[0]!)).toContain("데스크 담당자");
  });

  it("화면 — 개인별 기능 권한에 '데스크 담당자' 칸(퇴원보고서 승인자 바로 아래 · 같은 고르기 · 원장 역할은 고르기에 없음)", () => {
    const src = readFileSync(join(ROOT, "src/app/(shell)/owner/_components/special-access-editor.tsx"), "utf8");
    const approver = src.indexOf('label="퇴원보고서 승인자"');
    const desk = src.indexOf('label="데스크 담당자"');
    expect(approver).toBeGreaterThan(0);
    expect(desk).toBeGreaterThan(approver);
    const block = src.slice(desk, src.indexOf("/>", desk));
    expect(block).toContain("ids={value.withdrawalDeskIds ?? []}");
    expect(block).toContain("staffOptions={pickable}");
    expect(block).toContain("withdrawalDeskIds: update(prev.withdrawalDeskIds ?? [])");
  });
});
