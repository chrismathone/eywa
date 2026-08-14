"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Pill } from "@/components/atoms/pill";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { cancelLeaveRequest } from "@/features/leave/server/actions";
import type { LeaveRequestRow } from "@/features/leave/server/queries";
import { formatLeaveDays } from "@/features/leave/request-days";
import { LEAVE_DECISION_LABEL, LEAVE_KIND_LABEL, leaveStatusLabel } from "@/features/leave/types";

/** 결재선 진행 상황 — "김예원 승인 · 이승엽 대기". 사람 이름 앞에 아바타를 두지 않는다(영구 규칙). */
function approvalTrail(row: LeaveRequestRow): string {
  if (row.approvals.length === 0) return "결재선 없음";
  return row.approvals
    .map((a) => `${a.approverName} ${LEAVE_DECISION_LABEL[a.decision]}`)
    .join(" · ");
}

export function MyRequests({ rows }: { rows: LeaveRequestRow[] }) {
  const [confirmTarget, setConfirmTarget] = useState<LeaveRequestRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function doCancel(row: LeaveRequestRow) {
    const fd = new FormData();
    fd.append("requestId", row.id);
    setBusy(row.id);
    startTransition(async () => {
      const res = await cancelLeaveRequest(undefined, fd);
      setBusy(null);
      if (res?.error) toast.error(res.error);
      else if (res?.ok) toast.success(res.notice ?? "취소했습니다");
    });
  }

  return (
    <section className="space-y-2">
      <h2 className="text-foreground px-1 text-sm font-bold">내 신청 내역</h2>
      {rows.length === 0 ? (
        <div className="border-line text-text-faint rounded-2xl border border-dashed px-4 py-10 text-center text-sm">
          아직 신청한 휴가가 없습니다.
        </div>
      ) : (
        <DragScrollArea className="bg-card border-line shadow-card rounded-2xl border">
          <table className="w-full min-w-[680px] text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-[--line-faint]">
            <thead className="border-line bg-bg-soft/50 border-b [&_th]:whitespace-nowrap">
              <tr>
                <th className="micro px-3 py-2 text-center">기간</th>
                <th className="micro px-3 py-2 text-center">종류</th>
                <th className="micro px-3 py-2 text-center">일수</th>
                <th className="micro px-3 py-2 text-center">사유</th>
                <th className="micro px-3 py-2 text-center">결재</th>
                <th className="micro px-3 py-2 text-center">상태</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-line divide-y">
              {rows.map((r) => {
                const status = leaveStatusLabel(r.status);
                const isBusy = busy === r.id;
                return (
                  <tr key={r.id} className={`hover:bg-bg-soft/30 ${isBusy ? "opacity-50" : ""}`}>
                    <td className="num text-foreground px-3 py-2 text-xs whitespace-nowrap">
                      {r.startDate}
                      {r.endDate !== r.startDate ? ` ~ ${r.endDate}` : ""}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Pill color={r.kind === "half" ? "purple" : "blue"}>{LEAVE_KIND_LABEL[r.kind]}</Pill>
                    </td>
                    <td className="num text-foreground px-3 py-2 text-right text-xs whitespace-nowrap">
                      {formatLeaveDays(r.days)}
                    </td>
                    <td className="text-text-dim max-w-[220px] px-3 py-2 text-xs">
                      <span className="line-clamp-2">{r.reason ?? "—"}</span>
                    </td>
                    <td className="text-text-dim px-3 py-2 text-[11px]" title={r.decisionNote ?? undefined}>
                      {approvalTrail(r)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Pill color={status.color}>{status.label}</Pill>
                    </td>
                    <td className="px-2 py-2 text-right">
                      {r.status === "pending" ? (
                        <button
                          type="button"
                          onClick={() => setConfirmTarget(r)}
                          disabled={isBusy}
                          className="text-text-faint hover:text-danger px-1 text-[11px]"
                        >
                          {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : "취소"}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DragScrollArea>
      )}

      <ConfirmDialog
        open={!!confirmTarget}
        title="휴가 신청 취소"
        message={
          confirmTarget
            ? `${confirmTarget.startDate} ${formatLeaveDays(confirmTarget.days)} 신청을 취소합니다. 결재선에서도 사라집니다.`
            : ""
        }
        confirmLabel="신청 취소"
        danger
        onConfirm={() => {
          const target = confirmTarget;
          setConfirmTarget(null);
          if (target) doCancel(target);
        }}
        onCancel={() => setConfirmTarget(null)}
      />
    </section>
  );
}
