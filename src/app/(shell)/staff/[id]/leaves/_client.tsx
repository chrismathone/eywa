"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Loader2, Plus, Trash2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  approveLeave,
  deleteLeave,
  requestLeave,
  type LeaveActionState,
} from "@/features/payroll/server/actions";
import type { LeaveRow } from "@/features/payroll/server/queries";

const LEAVE_TYPES = ["연차", "반차", "병가", "경조사", "기타"];

function PlusBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
      휴가 추가
    </Button>
  );
}

export function LeavesClient({
  userId,
  leaves,
  canManage,
}: {
  userId: string;
  leaves: LeaveRow[];
  canManage: boolean;
}) {
  const [state, formAction] = useActionState<LeaveActionState, FormData>(requestLeave, undefined);

  return (
    <div className="space-y-4">
      {/* 신규 휴가 폼 */}
      {canManage ? (
        <form
          action={formAction}
          className="bg-card border-border space-y-3 rounded-md border p-4"
        >
        <input type="hidden" name="userId" value={userId} />
        <h3 className="text-foreground text-sm font-bold">신규 휴가</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <label className="text-muted-foreground block text-[11px] font-medium">유형</label>
            <select
              name="leaveType"
              required
              className="border-border bg-card text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
            >
              {LEAVE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground block text-[11px] font-medium">시작</label>
            <input
              name="startsOn"
              type="date"
              required
              className="border-border bg-card text-foreground num w-full rounded-md border px-2 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground block text-[11px] font-medium">종료</label>
            <input
              name="endsOn"
              type="date"
              required
              className="border-border bg-card text-foreground num w-full rounded-md border px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-end">
            <PlusBtn />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-muted-foreground block text-[11px] font-medium">사유 (선택)</label>
          <input
            name="reason"
            type="text"
            placeholder="예: 친지 결혼"
            className="border-border bg-card text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
          />
        </div>
        {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}
        </form>
      ) : null}

      {/* 휴가 목록 */}
      {leaves.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">기록된 휴가가 없습니다</p>
      ) : (
        <ul className="bg-card border-border divide-border divide-y rounded-md border">
          {leaves.map((l) => (
            <LeaveRowItem key={l.id} leave={l} userId={userId} canManage={canManage} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LeaveRowItem({
  leave,
  userId,
  canManage,
}: {
  leave: LeaveRow;
  userId: string;
  canManage: boolean;
}) {
  const [, approveAction] = useActionState<LeaveActionState, FormData>(approveLeave, undefined);
  const [, deleteAction] = useActionState<LeaveActionState, FormData>(deleteLeave, undefined);

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <span className="bg-chart-1/10 text-chart-1 border-chart-1/20 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium">
        {leave.leaveType}
      </span>
      <span className="num text-foreground text-sm">
        {leave.startsOn}
        {leave.endsOn !== leave.startsOn ? <> ~ {leave.endsOn}</> : null}
      </span>
      {leave.reason ? (
        <span className="text-muted-foreground text-xs">— {leave.reason}</span>
      ) : null}
      <div className="ml-auto flex items-center gap-2">
        {leave.approvedAt ? (
          <span className="text-chart-2 inline-flex items-center gap-1 text-[11px]">
            <Check className="size-3" />
            {leave.approvedByName ? `${leave.approvedByName} 승인` : "승인됨"}
          </span>
        ) : canManage ? (
          <form action={approveAction}>
            <input type="hidden" name="id" value={leave.id} />
            <input type="hidden" name="userId" value={userId} />
            <button
              type="submit"
              className="text-chart-2 hover:underline text-xs"
            >
              승인
            </button>
          </form>
        ) : (
          <span className="text-text-dim text-[11px]">승인 대기</span>
        )}
        {canManage ? (
          <form action={deleteAction}>
            <input type="hidden" name="id" value={leave.id} />
            <input type="hidden" name="userId" value={userId} />
            <button
              type="submit"
              className="text-muted-foreground hover:text-chart-4"
              aria-label="삭제"
            >
              <Trash2 className="size-3" />
            </button>
          </form>
        ) : null}
      </div>
    </li>
  );
}
