"use client";

import { useState, useTransition } from "react";
import { Check, FileText, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TextbookDialog } from "./textbook-dialog";
import { usePrintWindow } from "@/components/workspace/print-window";
import { deleteTextbookOrder, toggleTextbookCheck } from "@/features/billing/server/textbook-actions";
import type { StudentOption, TextbookOrderRow } from "@/features/billing/server/textbook-queries";
import type { CatalogOption } from "@/features/billing/server/catalog-queries";
import type { AccountSetting } from "@/features/owner/settings-types";

const KRW = new Intl.NumberFormat("ko-KR");
const won = (n: number) => `${KRW.format(n)}원`;

// ijw식 3개 독립 체크. 표시 순서 = 등록 → 납부 → 주문(사용자 요청). 체크 시 솔리드 색(Pill SOLID와 동일 토큰).
type CheckField = "registered" | "ordered" | "paid";
const CHECKS: { field: CheckField; dateKey: "registeredAt" | "orderedAt" | "paidAt"; label: string; active: string }[] = [
  { field: "registered", dateKey: "registeredAt", label: "등록", active: "bg-primary text-primary-foreground border-primary" },
  { field: "paid", dateKey: "paidAt", label: "납부", active: "bg-blue text-white border-blue" },
  { field: "ordered", dateKey: "orderedAt", label: "주문", active: "bg-amber text-white border-amber" },
];

function fmtShort(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function fmtFull(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function TextbooksTable({
  rows,
  students,
  catalog,
  academyName,
  logoUrl,
  account,
}: {
  rows: TextbookOrderRow[];
  students: StudentOption[];
  catalog: CatalogOption[];
  // 다이얼로그 실시간 미리보기(요청서 카드)용 — billing 페이지가 학원설정에서 도출.
  academyName: string;
  logoUrl: string | null;
  account: AccountSetting;
}) {
  const [dialog, setDialog] = useState<{ order: TextbookOrderRow | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const openPrint = usePrintWindow();

  function toggleCheck(r: TextbookOrderRow, field: CheckField, checked: boolean) {
    const fd = new FormData();
    fd.append("id", r.id);
    fd.append("field", field);
    fd.append("checked", String(checked));
    setBusy(r.id);
    startTransition(async () => {
      await toggleTextbookCheck(undefined, fd);
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
              <th className="micro px-4 py-2 text-left">진행 (등록·납부·주문)</th>
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
                    {r.notes ? (
                      <div className="text-text-faint mt-0.5 text-[11px] whitespace-pre-wrap">메모: {r.notes}</div>
                    ) : null}
                  </td>
                  <td className="text-foreground px-4 py-2 text-xs">{r.studentName ?? "—"}</td>
                  <td className="text-text-dim px-4 py-2 text-xs">{r.teacherName ?? "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {CHECKS.map((c) => {
                        const checked = r[c.field];
                        const date = r[c.dateKey];
                        return (
                          <button
                            key={c.field}
                            type="button"
                            disabled={isBusy}
                            onClick={() => toggleCheck(r, c.field, !checked)}
                            title={checked ? `${c.label} 완료 · ${fmtFull(date)}` : `${c.label} (미완료) — 클릭하여 체크`}
                            className={`inline-flex shrink-0 items-center gap-0.5 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium transition ${
                              checked
                                ? c.active
                                : "border-line text-text-faint hover:text-foreground hover:bg-bg-soft"
                            }`}
                          >
                            {checked ? <Check className="size-3" strokeWidth={2.5} /> : null}
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                    {/* '처리자·시각'은 사무실이 실제로 등록/납부/주문을 체크했을 때만 — 신규(미처리) 요청엔
                        status_by_name이 생성자(=요청 강사)라 신청일·강사 컬럼과 중복되고 "등록함"으로 오해됨. */}
                    {(r.registered || r.paid || r.ordered) && (r.statusAt || r.statusByName) ? (
                      <p className="text-text-faint mt-1 text-[10px]" title={`마지막 처리 · ${fmtFull(r.statusAt)}`}>
                        처리 {r.statusAt ? fmtShort(r.statusAt) : ""}
                        {r.statusByName ? ` · ${r.statusByName}` : ""}
                      </p>
                    ) : null}
                  </td>
                  <td className="num text-foreground px-4 py-2 text-right text-xs font-medium">{won(r.price)}</td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={(e) =>
                          openPrint(
                            {
                              id: `print/textbook/${r.id}`,
                              href: `/textbook/${r.id}/print`,
                              title: "교재 요청서",
                            },
                            e,
                          )
                        }
                        className="text-text-faint hover:text-primary p-1"
                        aria-label="교재 요청서"
                        title="교재 요청서 (인쇄·이미지 저장)"
                      >
                        <FileText className="size-3.5" />
                      </button>
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
        <TextbookDialog
          order={dialog.order}
          students={students}
          catalog={catalog}
          academyName={academyName}
          logoUrl={logoUrl}
          account={account}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </>
  );
}
