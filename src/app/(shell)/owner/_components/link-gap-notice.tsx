"use client";

import { MENU_LABEL, SYSTEM_ROLES, type AccessMatrix } from "@/lib/permissions";
import type { PermissionRowGroup } from "@/features/owner/permission-rows";
import { linkGaps, type LinkContext } from "@/features/owner/permission-links";
import { ROLE_LABEL } from "./permission-ui";

/**
 * 효과 없는 칸 알림 — 열려 있는데 함께 필요한 권한이 모자라 화면이 열리지 않는 칸(반대 방향: 필요한 권한을 닫았을 때 · 옛 저장값).
 * 표에서 파생한다(상태 없음). 표에 선 줄만 센다(감춘 메뉴의 줄은 알리지 않는다).
 */
export function LinkGapNotice({ matrix, groups, ctx }: { matrix: AccessMatrix; groups: readonly PermissionRowGroup[]; ctx: LinkContext }) {
  const shown = new Set(groups.flatMap((g) => g.rows.map((r) => r.menu)));
  const gaps = linkGaps(matrix, SYSTEM_ROLES, ctx).filter((g) => shown.has(g.menu));
  if (gaps.length === 0) return null;
  return (
    <div role="status" className="border-amber/30 bg-amber-soft mt-3 rounded-md border px-3 py-2 text-xs leading-relaxed">
      <b>열려 있어도 화면이 열리지 않는 칸</b> — 함께 필요한 권한이 닫혀 있습니다.
      <ul className="mt-1 space-y-0.5">
        {gaps.map((g) => (
          <li key={`${g.menu}:${g.role}`}>
            {`‘${MENU_LABEL[g.menu]}’ · ${ROLE_LABEL[g.role]} — ${g.missing.map((m) => `‘${MENU_LABEL[m]}’`).join("·")} 권한도 필요합니다`}
          </li>
        ))}
      </ul>
    </div>
  );
}
