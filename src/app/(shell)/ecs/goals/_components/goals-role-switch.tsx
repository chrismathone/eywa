"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { setMyEcsGoalsRole } from "@/features/class-sheets/server/goals-board-actions";
import { GOALS_BOARD_ROLES, type GoalsBoardRole } from "@/features/class-sheets/lib/goals-board";
import { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * 반 계획 보기의 **담임 / 부담임** 토글 — 계정 귀속(`ui_prefs.ecs.goalsRole`).
 * ⚠️ 서버가 표를 그리므로 저장 뒤 `router.refresh()`(프로그램 필터와 같은 규약).
 */
export function GoalsRoleSwitch({ value }: { value: GoalsBoardRole }) {
  const router = useRouter();
  const t = useSheetT();
  const [pending, setPending] = useState(false);

  const pick = async (next: GoalsBoardRole) => {
    if (pending || next === value) return;
    setPending(true);
    try {
      const r = await setMyEcsGoalsRole(next);
      if (!r.ok) {
        toast.error(t("filter.saveFailed"));
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <ToolbarSegment label={t("goals.role")}>
      {GOALS_BOARD_ROLES.map((r) => (
        <ToolbarSegmentItem key={r} active={value === r} disabled={pending} onClick={() => pick(r)}>
          {t(r === "homeroom" ? "goals.role.homeroom" : "goals.role.assistant")}
        </ToolbarSegmentItem>
      ))}
    </ToolbarSegment>
  );
}
