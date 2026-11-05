"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Loader2, Trash2 } from "@/components/icons/aywa-icon-compat";
import { useFormStatus } from "react-dom";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import {
  deleteTuitionQuote,
  type SaveQuoteState,
} from "@/features/billing/server/tuition-quote-actions";
import type { QuoteListItem } from "@/features/billing/server/tuition-quote-queries";
import type { StudentOption } from "@/features/billing/server/textbook-queries";
import { CreateInvoiceTrigger } from "./create-invoice-dialog";
import { schoolGradeLabel } from "@/lib/format/school-grade";

const KRW = new Intl.NumberFormat("ko-KR");
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function DeleteBtn() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="text-text-faint hover:text-danger shrink-0 p-1" title="삭제" aria-label="견적 삭제">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
    </button>
  );
}

export function SavedQuotesList({
  rows,
  students,
  defaultPeriod,
  canConvert,
  canDelete,
}: {
  rows: QuoteListItem[];
  students: StudentOption[];
  defaultPeriod: string;
  /** '청구서로 전환' — 서버 createInvoice와 같은 canWriteTenant(billing). 읽기 권한이면 그리지 않는다. */
  canConvert: boolean;
  /** 견적 삭제 — 서버 deleteTuitionQuote와 같은 full(canManageTenant billing). 읽기 권한이면 그리지 않는다. */
  canDelete: boolean;
}) {
  const embed = useEmbed();
  const [, delAction] = useActionState<SaveQuoteState, FormData>(deleteTuitionQuote, undefined);
  const href = (id: string) => {
    const u = `/billing?tab=calculator&qid=${id}`;
    return embed ? withEmbed(u) : u;
  };

  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li
          key={r.id}
          className="bg-card border-line shadow-card hover:bg-bg-soft/50 flex items-center gap-3 rounded-2xl border px-4 py-3 transition"
        >
          <Link href={href(r.id)} className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <span className="text-foreground truncate text-sm font-bold">{r.studentName}</span>
              <span className="text-text-dim shrink-0 text-xs">
                {schoolGradeLabel(r.school, r.grade)}
              </span>
            </div>
            <p className="text-text-faint mt-0.5 text-xs">
              수강 {r.courseCount}개 · 교재/기타 {r.extraCount}개 · {fmtDate(r.createdAt)}
            </p>
          </Link>
          <span className="text-foreground num shrink-0 text-sm font-bold">
            {KRW.format(r.totalAmount)}원
          </span>
          {canConvert ? (
            <CreateInvoiceTrigger
              students={students}
              defaultPeriod={defaultPeriod}
              variant="outline"
              label="청구서로 전환"
              prefill={{
                amountTotal: r.totalAmount,
                notes: `견적 전환 · ${r.studentName} · 수강 ${r.courseCount}개, 교재/기타 ${r.extraCount}개`,
              }}
            />
          ) : null}
          {canDelete ? (
            <form action={delAction} className="shrink-0">
              <input type="hidden" name="id" value={r.id} />
              <DeleteBtn />
            </form>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
