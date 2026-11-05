"use client";

import { SYSTEM_ROLES, type AccessMatrix, type MenuKey, type SystemRole } from "@/lib/permissions";
import { CONNECTED_APP_GROUP, type PermissionRowGroup } from "@/features/owner/permission-rows";
import { RoleMatrixTable } from "./role-matrix-table";
import { SettingsCard } from "./settings-card";

/**
 * '연결 앱 권한' 표에 세울 앱 — 이 지점에서 **켠** 앱만(page.tsx가 `getTenantConnectedApps`로 넘긴다).
 * `note` = 이 표와 따로 앱을 가리는 규칙(예: 담당 과목이 영어뿐인 직원) — 과목 이름은 학원 설정에서 만든다(page.tsx).
 */
export type ConnectedAppPermissionRow = { permission: MenuKey; label: string; note?: string };

/**
 * 앱 하나 = 묶음 하나 = 줄 하나. 줄 이름은 사이드바에 보이는 앱 이름이고, 묶음 이름도 같아서 표가 묶음 머리 줄을 따로 세우지 않는다
 * (role-matrix-table `isTabRow`).
 */
export function connectedAppRowGroups(apps: readonly ConnectedAppPermissionRow[]): PermissionRowGroup[] {
  return apps.map((app) => ({
    id: `${CONNECTED_APP_GROUP.id}:${app.permission}`,
    label: app.label,
    hiddenInMenu: false,
    rows: [{ menu: app.permission, label: app.label, covers: [], hiddenInMenu: false, inner: false }],
  }));
}

/**
 * 역할·권한 면의 '연결 앱 권한' 카드 — 역할별 메뉴 권한 표 바로 아래(원장 2026-11-05 *"연결앱 권한 따로 빼나줘 … 역할별 밑에 넣어줘"*).
 * 역할별 표와 **같은 표(matrix)·같은 저장**이다 — 칸은 전체(보임) ↔ 없음만 돈다(permissions.ts `isPermissionLocked`).
 * 켠 앱이 없으면 카드도 없다(꺼진 기능은 있었는지조차 모르게 — 결정 로그 tenant.md). 그래서 앱 이름·안내도 켠 앱에서만 만든다.
 * 설명은 접는 제목 줄이 아니라 본문에 둔다(제목 줄 안의 글자를 누르면 카드가 접히고, 화면 낭독기가 설명 전체를 단추 이름으로 읽는다).
 */
export function ConnectedAppPermissionsCard({
  apps,
  matrix,
  savedMatrix,
  onCycle,
}: {
  apps: readonly ConnectedAppPermissionRow[];
  matrix: AccessMatrix;
  savedMatrix: AccessMatrix;
  onCycle: (menu: MenuKey, role: SystemRole) => void;
}) {
  if (apps.length === 0) return null;
  const opened = (app: ConnectedAppPermissionRow) => SYSTEM_ROLES.filter((role) => matrix[app.permission][role] !== "none").length;
  // 이 카드의 저장하지 않은 칸 — 역할별 카드는 연결 앱 칸을 세지 않으니 여기서 센다(접어 둬도 보이게 · 저장은 역할별과 한 번에).
  const unsaved = apps.reduce((n, app) => n + SYSTEM_ROLES.filter((role) => matrix[app.permission][role] !== savedMatrix[app.permission][role]).length, 0);
  return (
    <SettingsCard
      title="연결 앱 권한"
      collapsible
      defaultOpen
      summary={[...apps.map((app) => `${app.label} ${opened(app)}개 역할`), ...(unsaved ? [`저장하지 않은 칸 ${unsaved}개`] : [])].join(" · ")}
    >
      {/* 표 위 글자와 표 사이 = 이 간격(12px) + 표의 pt-3 = 24px — 붙은 머리 줄의 가림 띠(20px)가 글자를 덮지 않는다(role-matrix-table). */}
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-text-dim text-xs">
            연결 앱 링크(왼쪽 ‘연결 앱’ · 강사 ‘내 메뉴’ · 폰 메뉴)를 보여 줄 역할입니다. 셀을 클릭하면 <b>전체(보임) ↔ 없음</b>으로 바뀌고,
            역할별 메뉴 권한과 함께 저장됩니다. 새로 연결하는 앱은 모든 역할이 없음으로 시작합니다.
            링크가 보여도 로그인은 그 앱의 연동 자격이 있는 사람만 됩니다.
          </p>
          {apps.filter((app) => app.note).map((app) => (
            <p key={app.permission} className="text-text-dim text-xs">
              {app.label}: {app.note}
            </p>
          ))}
        </div>
        <RoleMatrixTable groups={connectedAppRowGroups(apps)} matrix={matrix} savedMatrix={savedMatrix} onCycle={onCycle} rowHeader="앱" />
      </div>
    </SettingsCard>
  );
}
