"use client";

/**
 * 회차 미룸·당김 **확인 창** — 주간 시트·자리 JJ 열·월간 달력이 같은 창을 띄운다.
 *
 * 원장 2026-10-19 *"미루고, 당길때 얼럿창 띄우고 덮어쓰기(되돌리기)"* → (가)안: 누르면 이 창이 뜨고 [덮어쓰기]를
 * 눌러야 실행된다. 실행 뒤 토스트의 [되돌리기]는 호출부(`use-plan-handlers`·`month-client`)가 단다.
 * 🔑 네이티브 `confirm()`이 아니라 디자인 확인 창([`ConfirmDialog`](@/components/ui/confirm-dialog.tsx)) — 표 안
 *    버튼에서 열려도 포털이라 표 스타일을 물려받지 않는다.
 */
import { useCallback, useState, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useSheetT } from "@/features/teacher-view/lang-context";

export type ShiftKind = "skip" | "advance";

export function useShiftConfirm(run: (date: string, slotStart: string, kind: ShiftKind) => void): {
  ask: (date: string, slotStart: string, kind: ShiftKind) => void;
  dialog: ReactNode;
} {
  const t = useSheetT();
  const [pending, setPending] = useState<{ date: string; slotStart: string; kind: ShiftKind } | null>(null);
  const ask = useCallback((date: string, slotStart: string, kind: ShiftKind) => setPending({ date, slotStart, kind }), []);
  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={pending ? t(pending.kind === "skip" ? "plan.shift.skip" : "plan.shift.advance") : undefined}
      message={pending ? t(pending.kind === "skip" ? "plan.shift.confirm.skip" : "plan.shift.confirm.advance") : ""}
      confirmLabel={t("plan.shift.confirm.ok")}
      cancelLabel={t("plan.shift.confirm.cancel")}
      danger
      onCancel={() => setPending(null)}
      onConfirm={() => {
        const p = pending;
        setPending(null);
        if (p) run(p.date, p.slotStart, p.kind);
      }}
    />
  );
  return { ask, dialog };
}
