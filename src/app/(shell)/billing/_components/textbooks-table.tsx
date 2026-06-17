"use client";

import { useState, useTransition } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TextbookDialog } from "./textbook-dialog";
import { deleteTextbookOrder, setTextbookStatus } from "@/features/billing/server/textbook-actions";
import type { StudentOption, TextbookOrderRow } from "@/features/billing/server/textbook-queries";

const KRW = new Intl.NumberFormat("ko-KR");
const won = (n: number) => `${KRW.format(n)}원`;

const STATUS: { key: string; label: string }[] = [
  { key: "requested", label: "신청" },
  { key: "ordered", label: "주문" },
  { key: "delivered", label: "배부" },
  { key: "billed", label: "청구" },
  { key: "paid", label: "납부" },
];

export function TextbooksTable({
  rows,
  students,
}: {
  rows: TextbookOrderRow[];
  students: StudentOption[];
}) {
  const [dialog, setDialog] = useState<{ order: TextbookOrderRow | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function changeStatus(r: TextbookOrderRow, status: string) {
    if (status === r.status) return;
    const fd = new FormData();
    fd.append("id", r.id);
    fd.append("status", status);
    setBusy(r.id);
    startTransition(async () => {
      await setTextbookStatus(undefined, fd);
      setBusy(null);
    });
  }

  function handleDelete(r: TextbookOrderRow) {
    if (!confirm(`"${r.bookName}" 교재신청을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    const fd = new FormData();
    fd.append("id", r.id);
    setBusy(r.id);
    startTransition(async () => {
      await deleteTextbookOrder(undefined, fd);
      setBusy(null);
    });
  }

  return (
    <>
      <div className="flex items-center justify-end">
        <Button size="sm" onClick={() => setDialog({ order: null })}>
          <Plus className="size-4" />
          교재 신청 등록
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="border-line text-text-faint rounded-md border border-dashed px-4 py-10 text-center text-sm">
          교재신청 내역이 없습니다. 위 “교재 신청 등록”으로 추가하세요.
        </div>
      ) : (
      <div className="bg-card border-line shadow-card overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="border-line bg-bg-soft/50 border-b [&_th]:whitespace-nowrap">
            <tr>
              <th className="micro px-4 py-2 text-left">신청일</th>
              <th className="micro px-4 py-2 text-left">교재</th>
              <th className="micro px-4 py-2 text-left">학생</th>
              <th className="micro px-4 py-2 text-left">강사</th>
              <th className="micro px-4 py-2 text-left">상태</th>
              <th className="micro px-4 py-2 text-right">금액</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {rows.map((r) => {
              const isBusy = busy === r.id;
              return (
                <tr key={r.id} className={`hover:bg-bg-soft/30 ${isBusy ? "opacity-50" : ""}`}>
                  <td className="num text-text-dim px-4 py-2 text-xs">{r.requestDate ?? "—"}</td>
                  <td className="text-foreground px-4 py-2 text-xs">
                    {r.bookName}
                    {r.bookDetail ? <span className="text-text-faint"> · {r.bookDetail}</span> : null}
                  </td>
                  <td className="text-foreground px-4 py-2 text-xs">{r.studentName ?? "—"}</td>
                  <td className="text-text-dim px-4 py-2 text-xs">{r.teacherName ?? "—"}</td>
                  <td className="px-4 py-2">
                    <Select value={r.status} onValueChange={(v) => changeStatus(r, v as string)}>
                      <SelectTrigger size="sm" className="w-[84px]" disabled={isBusy}>
                        <SelectValue>
                          {(v) => STATUS.find((s) => s.key === v)?.label ?? (v as string)}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS.map((s) => (
                          <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="num text-foreground px-4 py-2 text-right text-xs font-medium">{won(r.price)}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setDialog({ order: r })}
                        disabled={isBusy}
                        className="text-text-faint hover:text-foreground p-1"
                        aria-label="수정"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(r)}
                        disabled={isBusy}
                        className="text-text-faint hover:text-danger p-1"
                        aria-label="삭제"
                      >
                        {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {dialog ? (
        <TextbookDialog order={dialog.order} students={students} onClose={() => setDialog(null)} />
      ) : null}
    </>
  );
}
