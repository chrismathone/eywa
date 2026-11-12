"use client";

import { cycleSkipsScoped, nextPermissionAccess } from "@/features/owner/permission-edit";
import { linkedGrants, requirementsOf, satisfies, type LinkContext } from "@/features/owner/permission-links";
import { isPermissionLocked, type Access, type AccessMatrix, type MenuKey, type SystemRole } from "@/lib/permissions";
import { useLinkedGrantPrompt } from "./linked-grant-dialog";
import { ROLE_LABEL } from "./permission-ui";

type ScopedSkip = { menu: MenuKey; role: SystemRole; to: Access; adoptions: number } | null;

/**
 * 역할 표 칸 누름 — 다음 값으로 돌리고('담당' 건너뜀 안내 포함), **연동된 권한**이 모자라면 먼저 묻는다(원장 2026-11-12).
 * 승인 = 누른 칸 + 필요한 권한(가장 좁은 값)을 함께 · 취소 = 아무것도 바꾸지 않는다. 묻는 중·막 닫은 직후의 칸 누름은 받지 않는다.
 */
export function useMatrixCycle({ matrix, setMatrix, adoptions, linkCtx, onScopedSkip }: {
  matrix: AccessMatrix;
  setMatrix: (next: (m: AccessMatrix) => AccessMatrix) => void;
  adoptions: number;
  linkCtx: LinkContext;
  onScopedSkip: (v: ScopedSkip) => void;
}) {
  const link = useLinkedGrantPrompt(adoptions);
  // 역할 표는 화면이 열리는 데 필요한 것만 묻는다(저장에 필요한 쓰기는 줄 설명에 — 칸 순서상 '읽기'까지 못 가는 것을 막는다).
  const ctx: LinkContext = { ...linkCtx, openOnly: true };

  function cycle(menu: MenuKey, role: SystemRole) {
    if (link.busy()) return;
    const current = matrix[menu][role];
    const next = nextPermissionAccess(menu, role, current);
    if (isPermissionLocked(menu, role, next)) return; // 가드레일 셀은 변경 거부
    const apply = () => {
      onScopedSkip(cycleSkipsScoped(menu, role, current) ? { menu, role, to: next, adoptions } : null);
      setMatrix((m) => {
        const out = { ...m, [menu]: { ...m[menu], [role]: next } };
        // 승인 때 다시 본다 — 그사이 채워진 필요 권한은 좁히지 않는다(모자랄 때만 올린다).
        for (const req of requirementsOf(menu, next, ctx, role)) {
          const g = grants?.find((x) => x.menu === req.menu);
          if (g && !satisfies(out[req.menu][role], req.need)) out[req.menu] = { ...out[req.menu], [role]: g.access };
        }
        return out;
      });
    };
    const grants = linkedGrants(menu, role, next, (m) => matrix[m][role], ctx, current);
    if (grants && grants.length > 0) {
      link.ask({ menu, who: ROLE_LABEL[role], grants, onConfirm: apply });
      return;
    }
    apply();
  }

  return { cycle, link };
}
