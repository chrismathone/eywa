"use client";

import { useState } from "react";
import { ChevronDown } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { StatusDialog, type OpenEnrollment } from "./status-dialog";
import type { ReportEntry } from "./withdrawal-report-entry";

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
  openEnrollments,
  reportEntry,
  scheduledWithdrawal,
}: {
  studentId: string;
  studentName: string;
  currentStatus: string;
  /** 활성 수강 — 수강 종료 다이얼로그가 "어느 수업을 종료할지" 고르게 하는 재료. */
  openEnrollments: OpenEnrollment[];
  /** 퇴원보고서 입구 — 모든 과목을 끝내려 하면(=퇴원) 창이 이리로 보낸다. */
  reportEntry: ReportEntry | null;
  /** 이번 변경 전에 걸린 퇴원 예약일(없으면 null) — 그날 처리되니 창이 퇴원보고서 대신 그 사실을 말한다. */
  scheduledWithdrawal: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<Target>("withdrawn");
  const [menuOpen, setMenuOpen] = useState(false);

  function trigger(t: Target) {
    setTarget(t);
    setMenuOpen(false);
    setOpen(true);
  }

  // 메뉴 아이템 동적: 현재 상태에 따라 사용 가능한 전환.
  // 🔴 라벨에 말줄임(…)을 붙이지 않는다(원장 2026-09-16 *"…은 지우고"*) — 어차피 전부 다이얼로그를
  //    여는 항목이라 …가 구분을 만들지 못하고, 좁은 메뉴에서 글자만 길어진다.
  // 🔴 '퇴원 처리'는 없다 — 퇴원은 퇴원보고서로만(원장 2026-10-23, 머리글의 '퇴원보고서'). 여기서는 일부 과목의 수강 종료만.
  const actions: { target: Target; label: string }[] = [];
  if (currentStatus === "enrolled") {
    actions.push({ target: "withdrawn", label: "수강 종료" });
    actions.push({ target: "on_hold", label: "휴원 처리" });
  } else if (currentStatus === "on_hold") {
    actions.push({ target: "enrolled", label: "재원으로 복구" });
    actions.push({ target: "withdrawn", label: "수강 종료" });
  } else if (currentStatus === "withdrawn") {
    actions.push({ target: "enrolled", label: "재원으로 복구" });
  } else {
    // prospect, consulted
    actions.push({ target: "enrolled", label: "재원으로 전환" });
  }

  if (actions.length === 0) return null;

  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setMenuOpen((v) => !v)}>
        상태 변경
        <ChevronDown className="size-3.5" />
      </Button>
      {menuOpen ? (
        <div className="bg-card border-border absolute right-0 z-30 mt-1 w-44 rounded-lg border py-1 shadow-lg">
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
          statusKey={currentStatus}
          initialTarget={target}
          openEnrollments={openEnrollments}
          reportEntry={reportEntry}
          scheduledWithdrawal={scheduledWithdrawal}
          onClose={(changed) => {
            setOpen(false);
            if (changed) location.reload();
          }}
        />
      ) : null}
    </div>
  );
}
