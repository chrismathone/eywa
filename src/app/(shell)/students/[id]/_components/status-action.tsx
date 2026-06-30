"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusDialog } from "./status-dialog";

type Target = "withdrawn" | "on_hold" | "enrolled";

const STATUS_LABEL: Record<string, string> = {
  prospect: "예비",
  consulted: "상담완료",
  enrolled: "재원",
  on_hold: "휴원",
  withdrawn: "퇴원",
};

export function StatusAction({
  studentId,
  studentName,
  currentStatus,
}: {
  studentId: string;
  studentName: string;
  currentStatus: string;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Target>("withdrawn");
  const [menuOpen, setMenuOpen] = useState(false);

  function trigger(t: Target) {
    setTarget(t);
    setMenuOpen(false);
    setOpen(true);
  }

  // 메뉴 아이템 동적: 현재 상태에 따라 사용 가능한 전환
  const actions: { target: Target; label: string }[] = [];
  if (currentStatus === "enrolled") {
    actions.push({ target: "withdrawn", label: "퇴원 처리…" });
    actions.push({ target: "on_hold", label: "휴원 처리…" });
  } else if (currentStatus === "on_hold") {
    actions.push({ target: "enrolled", label: "재원으로 복구…" });
    actions.push({ target: "withdrawn", label: "퇴원 처리…" });
  } else if (currentStatus === "withdrawn") {
    actions.push({ target: "enrolled", label: "재원으로 복구…" });
  } else {
    // prospect, consulted
    actions.push({ target: "enrolled", label: "재원으로 전환…" });
  }

  if (actions.length === 0) return null;

  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setMenuOpen((v) => !v)}>
        상태 변경
        <ChevronDown className="size-3.5" />
      </Button>
      {menuOpen ? (
        <div className="bg-card border-border absolute right-0 z-30 mt-1 w-44 rounded-md border py-1 shadow-lg">
          {actions.map((a) => (
            <button
              key={a.target}
              type="button"
              onClick={() => trigger(a.target)}
              className="text-foreground hover:bg-bg-soft block w-full px-3 py-1.5 text-left text-sm"
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
      {open ? (
        <StatusDialog
          studentId={studentId}
          studentName={studentName}
          currentStatus={STATUS_LABEL[currentStatus] ?? currentStatus}
          initialTarget={target}
          onClose={(changed) => {
            setOpen(false);
            if (changed) location.reload();
          }}
        />
      ) : null}
    </div>
  );
}
