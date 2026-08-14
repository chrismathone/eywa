"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Pill } from "@/components/atoms/pill";
import { Button } from "@/components/ui/button";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { decideLeaveRequest, type LeaveActionState } from "@/features/leave/server/actions";
import type { LeaveRequestRow } from "@/features/leave/server/queries";
import { formatLeaveDays } from "@/features/leave/request-days";
import { LEAVE_DECISION_LABEL, LEAVE_KIND_LABEL, leaveStatusLabel } from "@/features/leave/types";

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-1.5 text-[13px] outline-none transition";

function period(row: LeaveRequestRow): string {
  return row.endDate !== row.startDate ? `${row.startDate} ~ ${row.endDate}` : row.startDate;
}

function DecideButtons() {
  const { pending } = useFormStatus();
  return (
    <span className="flex items-center gap-2">
      {pending ? <Loader2 className="text-text-faint size-4 animate-spin" /> : null}
      <Button type="submit" name="decision" value="rejected" variant="outline" disabled={pending}>
        반려
      </Button>
      <Button type="submit" name="decision" value="approved" disabled={pending}>
        승인
      </Button>
    </span>
  );
}

/**
 * 결재 카드 1건 — 전자결재창. 승인/반려는 **같은 폼의 서로 다른 submit 버튼**(name="decision")이라
 * 의견(note)을 함께 싣는다.
 */
function ApprovalCard({ row }: { row: LeaveRequestRow }) {
  const [state, action] = useActionState<LeaveActionState, FormData>(decideLeaveRequest, undefined);
  const seen = useRef<LeaveActionState>(undefined);

  useEffect(() => {
    if (!state || state === seen.current) return;
    seen.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success(state.notice ?? "결재했습니다");
  }, [state]);

  const others = row.approvals.filter((a) => a.decision !== "pending");

  return (
    <form action={action} className="border-line bg-card shadow-card space-y-3 rounded-2xl border p-4">
      <input type="hidden" name="requestId" value={row.id} />

      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-foreground text-sm font-bold">{row.requesterName}</span>
          <Pill color={row.kind === "half" ? "purple" : "blue"}>{LEAVE_KIND_LABEL[row.kind]}</Pill>
          <span className="num text-foreground text-[13px]">{period(row)}</span>
          <span className="num text-primary text-[13px] font-semibold">
            {formatLeaveDays(row.days)}
          </span>
        </div>
        <span className="text-text-faint text-[11px]">
          신청 {row.createdAt.slice(0, 10)} · 부여 {formatLeaveDays(row.grantedDays)}(
          {row.periodStart}~{row.periodEnd})
        </span>
      </div>

      {row.reason ? (
        <p className="text-text-dim bg-bg-soft/50 rounded-xl px-3 py-2 text-[13px] break-keep">
          {row.reason}
        </p>
      ) : null}

      {others.length > 0 ? (
        <p className="text-text-faint text-[11px]">
          {others
            .map(
              (a) =>
                `${a.approverName} ${LEAVE_DECISION_LABEL[a.decision]}${a.note ? ` — ${a.note}` : ""}`,
            )
            .join(" · ")}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <input
          name="note"
          maxLength={500}
          placeholder="의견 (선택) — 반려 사유를 적으면 신청자에게 남습니다"
          className={`${inputClass} sm:max-w-[420px]`}
        />
        <DecideButtons />
      </div>
    </form>
  );
}

export function ApprovalInbox({ rows }: { rows: LeaveRequestRow[] }) {
  const waiting = rows.filter((r) => r.status === "pending");
  const done = rows.filter((r) => r.status !== "pending");

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h2 className="text-foreground px-1 text-sm font-bold">
          결재 대기 <span className="num text-text-dim">{waiting.length}</span>
        </h2>
        {waiting.length === 0 ? (
          <div className="border-line text-text-faint rounded-2xl border border-dashed px-4 py-10 text-center text-sm">
            결재할 휴가 신청이 없습니다.
          </div>
        ) : (
          waiting.map((r) => <ApprovalCard key={r.id} row={r} />)
        )}
      </section>

      {done.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-foreground px-1 text-sm font-bold">처리한 신청</h2>
          <DragScrollArea className="bg-card border-line shadow-card rounded-2xl border">
            <table className="w-full min-w-[600px] text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-[--line-faint]">
              <thead className="border-line bg-bg-soft/50 border-b [&_th]:whitespace-nowrap">
                <tr>
                  <th className="micro px-3 py-2 text-center">신청자</th>
                  <th className="micro px-3 py-2 text-center">기간</th>
                  <th className="micro px-3 py-2 text-center">일수</th>
                  <th className="micro px-3 py-2 text-center">상태</th>
                  <th className="micro px-3 py-2 text-center">결재 결과</th>
                </tr>
              </thead>
              <tbody className="divide-line divide-y">
                {done.map((r) => {
                  const status = leaveStatusLabel(r.status);
                  return (
                    <tr key={r.id} className="hover:bg-bg-soft/30">
                      <td className="text-foreground px-3 py-2 text-xs">{r.requesterName}</td>
                      <td className="num text-text-dim px-3 py-2 text-xs whitespace-nowrap">
                        {period(r)}
                      </td>
                      <td className="num text-foreground px-3 py-2 text-right text-xs">
                        {formatLeaveDays(r.days)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <Pill color={status.color}>{status.label}</Pill>
                      </td>
                      <td className="text-text-dim px-3 py-2 text-[11px] break-keep">
                        {r.decisionNote ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </DragScrollArea>
        </section>
      ) : null}
    </div>
  );
}
