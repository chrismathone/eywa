"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2, Trash2 } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import {
  approveLeave,
  deleteLeave,
  type LeaveActionState,
} from "@/features/payroll/server/actions";
import type { StaffLeaveRow } from "@/features/payroll/server/queries";

function dur(a: string, b: string): string {
  return a === b ? a : `${a} ~ ${b}`;
}

export function LeavesAdminClient({
  leaves,
  canManage,
}: {
  leaves: StaffLeaveRow[];
  canManage: boolean;
}) {
  return (
    <div className="bg-card border-line shadow-card overflow-x-auto rounded-md border">
      <table className="w-full text-sm [&_td]:whitespace-nowrap">
        <thead className="border-line text-text-dim border-b text-left text-xs [&_th]:whitespace-nowrap">
          <tr>
            <th className="px-4 py-3 font-normal">직원</th>
            <th className="px-4 py-3 font-normal">유형</th>
            <th className="px-4 py-3 font-normal">기간</th>
            <th className="px-4 py-3 font-normal">사유</th>
            <th className="px-4 py-3 font-normal">상태</th>
            {canManage ? <th className="px-4 py-3 text-right font-normal">처리</th> : null}
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {leaves.map((l) => (
            <tr key={l.id} className="hover:bg-bg-soft/40">
              <td className="px-4 py-2.5">
                <WindowLink href={`/staff/${l.userId}`} title={l.staffName} className="text-foreground font-medium hover:underline">
                  {l.staffName}
                </WindowLink>
                {l.staffRole ? <span className="text-text-faint ml-1.5 text-xs">{l.staffRole}</span> : null}
              </td>
              <td className="text-text-dim px-4 py-2.5">{l.leaveType}</td>
              <td className="text-text-dim num px-4 py-2.5 text-xs">{dur(l.startsOn, l.endsOn)}</td>
              <td className="text-text-dim max-w-[200px] truncate px-4 py-2.5 text-xs" title={l.reason ?? ""}>
                {l.reason ?? "—"}
              </td>
              <td className="px-4 py-2.5">
                {l.approvedAt ? (
                  <span className="text-chart-2 bg-chart-2/10 border-chart-2/20 inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium">
                    승인{l.approvedByName ? ` · ${l.approvedByName}` : ""}
                  </span>
                ) : (
                  <span className="text-chart-3 bg-chart-3/10 border-chart-3/20 inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium">
                    대기
                  </span>
                )}
              </td>
              {canManage ? (
                <td className="px-4 py-2.5 text-right">
                  <RowActions leave={l} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ApproveBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border-line text-primary hover:bg-primary-soft inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition disabled:opacity-50"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
      승인
    </button>
  );
}

function DeleteBtn() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-text-faint hover:text-danger inline-flex items-center p-1 transition disabled:opacity-50"
      aria-label="삭제"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
    </button>
  );
}

function RowActions({ leave }: { leave: StaffLeaveRow }) {
  const [, approveAction] = useActionState<LeaveActionState, FormData>(approveLeave, undefined);
  const [, deleteAction] = useActionState<LeaveActionState, FormData>(deleteLeave, undefined);
  return (
    <div className="flex items-center justify-end gap-1.5">
      {!leave.approvedAt ? (
        <form action={approveAction}>
          <input type="hidden" name="id" value={leave.id} />
          <input type="hidden" name="userId" value={leave.userId} />
          <ApproveBtn />
        </form>
      ) : null}
      <form action={deleteAction}>
        <input type="hidden" name="id" value={leave.id} />
        <input type="hidden" name="userId" value={leave.userId} />
        <DeleteBtn />
      </form>
    </div>
  );
}
