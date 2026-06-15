"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Loader2,
  MessageSquare,
  Pencil,
  Save,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  batchMarkInvoicesPaid,
  updateInvoicePayment,
  type UpdateInvoiceState,
} from "@/features/billing/server/actions";
import type { InvoiceRow } from "@/features/billing/server/queries";

const STATUS_LABEL: Record<string, string> = {
  paid: "완납",
  partial: "부분",
  unpaid: "미수",
  refunded: "환불",
  void: "취소",
};

const STATUS_COLOR: Record<string, string> = {
  paid: "text-chart-2 bg-chart-2/10 border-chart-2/20",
  partial: "text-chart-3 bg-chart-3/10 border-chart-3/20",
  unpaid: "text-chart-4 bg-chart-4/10 border-chart-4/20",
  refunded: "text-muted-foreground bg-muted border-border",
  void: "text-muted-foreground bg-muted border-border",
};

const KRW = new Intl.NumberFormat("ko-KR");
function won(n: number) {
  return `${KRW.format(n)}원`;
}

type SortKey =
  | "status"
  | "name"
  | "amount_total"
  | "amount_paid"
  | "amount_discount"
  | "due_date";

type Props = {
  rows: InvoiceRow[];
  sort?: SortKey;
  desc?: boolean;
  period?: string;
  q?: string;
};

function buildSortHref(
  col: SortKey,
  current: { sort?: SortKey; desc?: boolean; period?: string; q?: string },
): string {
  const params = new URLSearchParams();
  if (current.period) params.set("period", current.period);
  if (current.q) params.set("q", current.q);
  // 같은 col 두번 클릭하면 desc 토글
  const nextDesc = current.sort === col ? !current.desc : false;
  if (col !== "status") params.set("sort", col);
  if (nextDesc) params.set("desc", "1");
  const s = params.toString();
  return s ? `/billing?${s}` : "/billing";
}

function SortHeader({
  col,
  label,
  current,
  className,
}: {
  col: SortKey;
  label: string;
  current: { sort?: SortKey; desc?: boolean; period?: string; q?: string };
  className?: string;
}) {
  const active = current.sort === col;
  return (
    <Link
      href={buildSortHref(col, current)}
      className={`text-text-dim hover:text-foreground inline-flex items-center gap-0.5 transition ${
        active ? "text-foreground font-bold" : ""
      } ${className ?? ""}`}
    >
      {label}
      <span className="font-mono text-[9px]">{active ? (current.desc ? "▼" : "▲") : "▼"}</span>
    </Link>
  );
}

export function BillingTable({ rows, sort, desc, period, q }: Props) {
  const current = { sort, desc, period, q };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<InvoiceRow | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const unpaidRows = rows.filter((r) => r.status === "unpaid" || r.status === "partial");
  const allSelectable = unpaidRows.length;
  const allSelected = allSelectable > 0 && unpaidRows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((s) => {
      if (allSelected) return new Set();
      const next = new Set(s);
      for (const r of unpaidRows) next.add(r.id);
      return next;
    });
  }

  function handleBatchPaid() {
    if (selected.size === 0) return;
    if (!confirm(`${selected.size}건을 모두 완납 처리합니다. 진행할까요?`)) return;
    const fd = new FormData();
    fd.append("ids", Array.from(selected).join(","));
    startTransition(async () => {
      const result = await batchMarkInvoicesPaid(undefined, fd);
      if (result?.error) {
        setToast(`실패: ${result.error}`);
      } else if (result?.saved) {
        setToast(`${result.saved}건 완납 처리됨`);
        setSelected(new Set());
      }
    });
  }

  return (
    <>
      {toast ? (
        <div className="border-chart-2/30 bg-chart-2/5 text-chart-2 mb-3 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
          <CheckCircle2 className="size-4" />
          {toast}
        </div>
      ) : null}

      <div className="border-border bg-card mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5">
        <span className="text-muted-foreground text-xs">
          선택 <span className="text-foreground num font-medium">{selected.size}</span> / {allSelectable}건 미수금
        </span>
        <Button
          size="sm"
          variant={selected.size > 0 ? "default" : "outline"}
          disabled={selected.size === 0 || isPending}
          onClick={handleBatchPaid}
        >
          {isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
          선택 항목 완납 처리
        </Button>
      </div>

      <div className="bg-card border-border overflow-x-auto rounded-lg border">
        <table className="w-full text-sm [&_td]:whitespace-nowrap">
          <thead className="border-border text-muted-foreground border-b text-left text-xs [&_th]:whitespace-nowrap">
            <tr>
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={allSelectable === 0}
                  className="size-4"
                  aria-label="전체 선택"
                />
              </th>
              <th className="eyebrow px-5 py-3 font-normal">학년</th>
              <th className="eyebrow px-5 py-3 font-normal">
                <SortHeader col="name" label="이름" current={current} />
              </th>
              <th className="eyebrow px-5 py-3 font-normal">항목</th>
              <th className="eyebrow num px-5 py-3 text-right font-normal">
                <SortHeader col="amount_total" label="청구액" current={current} />
              </th>
              <th className="eyebrow num px-5 py-3 text-right font-normal">
                <SortHeader col="amount_discount" label="할인" current={current} />
              </th>
              <th className="eyebrow num px-5 py-3 text-right font-normal">
                <SortHeader col="amount_paid" label="수납액" current={current} />
              </th>
              <th className="eyebrow px-5 py-3 font-normal">
                <SortHeader col="status" label="상태" current={current} />
              </th>
              <th className="eyebrow num px-5 py-3 text-right font-normal">
                <SortHeader col="due_date" label="기한·결제" current={current} />
              </th>
              <th className="eyebrow px-5 py-3 font-normal">메모</th>
              <th className="w-10 px-3 py-3" />
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((r) => {
              const description = r.lineItems[0]?.description ?? "—";
              const settledAt = r.paidAt
                ? new Date(r.paidAt).toLocaleDateString("ko-KR")
                : null;
              const selectable = r.status === "unpaid" || r.status === "partial";
              return (
                <tr
                  key={r.id}
                  className={`hover:bg-accent/40 transition-colors ${
                    selected.has(r.id) ? "bg-accent/30" : ""
                  }`}
                >
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      disabled={!selectable}
                      className="size-4"
                      aria-label={`${r.studentName} 선택`}
                    />
                  </td>
                  <td className="text-muted-foreground px-5 py-3">{r.studentGrade ?? "—"}</td>
                  <td className="px-5 py-3">
                    <Link
                      href={`/students/${r.studentId}`}
                      className="text-foreground font-medium hover:underline"
                    >
                      {r.studentName}
                    </Link>
                  </td>
                  <td className="text-muted-foreground px-5 py-3 text-xs">{description}</td>
                  <td className="text-foreground num px-5 py-3 text-right">{won(r.amountTotal)}</td>
                  <td className="num px-5 py-3 text-right text-xs">
                    {r.amountDiscount > 0 ? (
                      <span className="text-amber">-{won(r.amountDiscount)}</span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                  <td className="num px-5 py-3 text-right">
                    <span
                      className={
                        r.amountPaid === r.amountTotal
                          ? "text-primary"
                          : "text-text-dim"
                      }
                    >
                      {won(r.amountPaid)}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${
                        STATUS_COLOR[r.status] ?? "bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </td>
                  <td className="num px-5 py-3 text-right text-xs">
                    {settledAt ? (
                      <span className="text-muted-foreground">{settledAt}</span>
                    ) : (
                      <span className="text-muted-foreground">
                        기한 {r.dueDate ?? "—"}
                      </span>
                    )}
                  </td>
                  <td className="text-text-dim px-5 py-3 text-xs">
                    {r.notes ? (
                      <span className="line-clamp-1" title={r.notes}>
                        {r.notes}
                      </span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      className="text-muted-foreground hover:text-foreground inline-flex items-center"
                      aria-label="수정"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing ? (
        <EditInvoiceDialog
          invoice={editing}
          onClose={(saved) => {
            setEditing(null);
            if (saved) setToast(`${editing.studentName} 수납 정보 저장됨`);
          }}
        />
      ) : null}
    </>
  );
}

// ─────────────────────────── edit dialog ───────────────────────────

function SubmitEdit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
      저장
    </Button>
  );
}

function EditInvoiceDialog({
  invoice,
  onClose,
}: {
  invoice: InvoiceRow;
  onClose: (saved: boolean) => void;
}) {
  const [state, formAction] = useActionState<UpdateInvoiceState, FormData>(
    updateInvoicePayment,
    undefined,
  );
  const [amountPaid, setAmountPaid] = useState(invoice.amountPaid);
  const [status, setStatus] = useState(invoice.status);

  const remaining = invoice.amountTotal - amountPaid;

  // Close on successful save (no fieldErrors, no error → undefined)
  if (state && !state.error && !state.fieldErrors) {
    queueMicrotask(() => onClose(true));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-border w-full max-w-md rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">청구서 수정</p>
            <h2 className="text-foreground mt-1 text-lg font-semibold">{invoice.studentName}</h2>
            <p className="text-muted-foreground text-xs">
              {invoice.studentGrade ?? "—"} · {invoice.period} ·{" "}
              {invoice.lineItems[0]?.description ?? "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onClose(false)}
            className="text-muted-foreground hover:text-foreground"
            aria-label="닫기"
          >
            <X className="size-4" />
          </button>
        </header>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="id" value={invoice.id} />

          <div className="border-border bg-muted/30 rounded-md border px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">청구액</span>
              <span className="text-foreground num font-medium">
                {KRW.format(invoice.amountTotal)}원
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="amountPaid" className="text-foreground block text-sm font-medium">
              수납액
            </label>
            <input
              id="amountPaid"
              name="amountPaid"
              type="number"
              min="0"
              step="1000"
              defaultValue={amountPaid}
              onChange={(e) => setAmountPaid(Number(e.target.value) || 0)}
              className="border-input bg-background num w-full rounded-md border px-3 py-2 text-right text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {state?.fieldErrors?.amountPaid ? (
              <p className="text-chart-4 text-xs">{state.fieldErrors.amountPaid}</p>
            ) : null}
            <p
              className={`text-xs ${
                remaining <= 0 ? "text-chart-2" : "text-muted-foreground"
              }`}
            >
              잔액 <span className="num">{KRW.format(Math.max(0, remaining))}</span>원
              {remaining <= 0 ? " · 완납" : ""}
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="status" className="text-foreground block text-sm font-medium">
              상태
            </label>
            <select
              id="status"
              name="status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">자동 (수납액으로 판정)</option>
              <option value="refunded">환불</option>
              <option value="void">취소</option>
            </select>
            <p className="text-muted-foreground text-xs">
              비워두면 수납액에 따라 미수/부분/완납 자동 설정
            </p>
          </div>

          {state?.error ? (
            <p className="text-chart-4 bg-chart-4/10 border-chart-4/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
              <AlertCircle className="size-4" />
              {state.error}
            </p>
          ) : null}

          {/* 결제 알림 메시지 (미수/부분일 때만 노출) */}
          {remaining > 0 ? (
            <ReminderMessage invoice={invoice} balance={remaining} />
          ) : null}

          <div className="flex items-center justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => onClose(false)}>
              취소
            </Button>
            <SubmitEdit />
          </div>
        </form>
      </div>
    </div>
  );
}

function ReminderMessage({
  invoice,
  balance,
}: {
  invoice: InvoiceRow;
  balance: number;
}) {
  const [copied, setCopied] = useState(false);

  const message = [
    `안녕하세요, ${invoice.studentName} 학부모님.`,
    ``,
    `${invoice.period} 수강료 안내 드립니다.`,
    `청구금액: ${KRW.format(invoice.amountTotal)}원`,
    invoice.amountDiscount > 0 ? `할인: ${KRW.format(invoice.amountDiscount)}원` : null,
    invoice.amountPaid > 0 ? `입금 확인: ${KRW.format(invoice.amountPaid)}원` : null,
    `미납 잔액: ${KRW.format(balance)}원`,
    invoice.dueDate ? `기한: ${invoice.dueDate}` : null,
    ``,
    `편하신 시간에 입금 부탁드립니다. 감사합니다.`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = message;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="border-border bg-bg-soft/40 rounded-md border p-3">
      <div className="text-foreground mb-2 inline-flex items-center gap-1.5 text-xs font-semibold">
        <MessageSquare className="size-3.5" />
        결제 알림 메시지 (학부모 발송용)
      </div>
      <pre className="text-foreground bg-card border-border whitespace-pre-wrap rounded-sm border p-2.5 text-[11px] leading-relaxed">
        {message}
      </pre>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={copy}
          className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition"
        >
          {copied ? (
            <>
              <CheckCircle2 className="text-chart-2 size-3" />
              복사됨
            </>
          ) : (
            <>
              <Copy className="size-3" />
              메시지 복사
            </>
          )}
        </button>
      </div>
    </div>
  );
}
