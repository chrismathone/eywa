"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Check, FileText, Loader2, Pencil, Plus, Trash2 } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { TextbookDialog } from "./textbook-dialog";
import { usePrintWindow } from "@/components/workspace/print-window";
import { deleteTextbookOrder, toggleTextbookCheck } from "@/features/billing/server/textbook-actions";
import { ELAPSED_STRONG_DAYS, elapsedDays, shouldShowElapsed } from "@/features/billing/textbook-progress";
import type { StudentOption, TextbookOrderRow } from "@/features/billing/server/textbook-queries";
import type { CatalogOption } from "@/features/billing/server/catalog-queries";
import type { AccountSetting } from "@/features/owner/settings-types";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { writeLockedPlaceholder } from "@/lib/write-lock";

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
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function TextbooksTable({
  rows,
  students,
  catalog,
  academyName,
  logoUrl,
  account,
  todayKst,
  toolbar,
  emptyTitle,
  canWrite,
}: {
  toolbar?: ReactNode;
  emptyTitle?: string;
  /**
   * 등록·체크·수정·삭제를 세울지 — 서버(TextbooksPanel)가 액션과 **같은 함수**(canWriteTenant billing)로 정한 값.
   * 읽기 권한이면 쓰기 단추는 그리지 않고 진행 체크는 비활성으로 보여 준다(원장 2026-11-05).
   */
  canWrite: boolean;
  rows: TextbookOrderRow[];
  students: StudentOption[];
  catalog: CatalogOption[];
  // 다이얼로그 실시간 미리보기(요청서 카드)용 — billing 페이지가 학원설정에서 도출.
  academyName: string;
  logoUrl: string | null;
  account: AccountSetting;
  todayKst: string; // 서버(KST) 기준 오늘 — 신청일 경과 라벨 계산(클라 Date로 하면 하이드레이션 불일치).
}) {
  const [dialog, setDialog] = useState<{ order: TextbookOrderRow | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** 삭제 실패 사유(행별) — 버리면 "눌러도 아무 일 없음"이 된다. */
  const [delError, setDelError] = useState<{ id: string; message: string } | null>(null);
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
    setDelError(null);
    // 학부모에게 보낸 요청이면 그 사실을 함께 묻는다 — 같은 줄이 둘일 때 발송한 쪽을 지운 9건(2026-10-20).
    const sentNote = r.classnoteNoticeId ? "\n학부모 알림장으로 보낸 요청입니다(지워도 알림장 글은 남습니다)." : "";
    if (!confirm(`"${r.bookName}" 교재신청을 삭제할까요? 되돌릴 수 없습니다.${sentNote}`)) return;
    const fd = new FormData();
    fd.append("id", r.id);
    setBusy(r.id);
    startTransition(async () => {
      // 🔴 결과를 버리면 **실패가 화면에서 사라진다**(원장 2026-08-03 "삭제가 안 되는 것 같은데").
      //    RLS에 막힌 행은 PostgREST가 **에러 없이 0행**을 지우므로, 액션이 ok를 돌려줘도 행은 그대로다
      //    → 서버가 "지웠다"고 말했는데 목록이 안 변하면 그것도 알린다(조용한 성공 = 조용한 실패다).
      const res = await deleteTextbookOrder(undefined, fd);
      setBusy(null);
      if (res?.error) setDelError({ id: r.id, message: res.error });
      else setDelError(null);
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {toolbar}
        {canWrite ? (
          <Button size="sm" className="shrink-0" onClick={() => setDialog({ order: null })}>
            <Plus className="size-4" />
            교재 신청 등록
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="border-line text-text-faint rounded-2xl border border-dashed px-4 py-10 text-center text-sm">
          {emptyTitle ?? (canWrite ? "교재신청 내역이 없습니다. 위 ‘교재 신청 등록’으로 추가하세요." : "교재신청 내역이 없습니다.")}
        </div>
      ) : (
      <DragScrollArea className="bg-card shadow-card rounded-2xl">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="border-line bg-bg-soft/50 text-text-dim border-b text-sm [&_th]:font-bold [&_th]:whitespace-nowrap">
            <tr>
              <th className="px-4 py-2 text-left">신청일</th>
              <th className="px-4 py-2 text-left">교재</th>
              <th className="px-4 py-2 text-left">학생</th>
              <th className="px-4 py-2 text-left">강사</th>
              <th className="px-4 py-2 text-left">진행 (등록·납부·주문)</th>
              <th className="px-4 py-2 text-right">금액</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-line divide-y">
            {rows.map((r) => {
              const isBusy = busy === r.id;
              // 경과 라벨 = **처리 지연 신호**라 아직 안 끝난 줄에만 붙는다(판정은 shouldShowElapsed 단일 소스).
              // 예전엔 날짜만 봐서 등록·납부·주문이 다 끝난 줄에도 떴다(2026-08-20 원장 제보, 실측 485건 중 484건이 거짓).
              const elapsed = elapsedDays(r.requestDate, todayKst);
              const elapsedLabel = shouldShowElapsed(r, elapsed) ? elapsed : null;
              return (
                <tr key={r.id} className={`hover:bg-bg-soft/30 ${isBusy ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2 text-xs whitespace-nowrap">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="num text-text-dim">{r.requestDate ?? "—"}</span>
                      {elapsedLabel !== null ? (
                        <span
                          title={`신청 후 ${elapsedLabel}일 경과`}
                          className={`num inline-block rounded-sm border px-1 py-px text-xs font-medium whitespace-nowrap ${
                            elapsedLabel >= ELAPSED_STRONG_DAYS
                              ? "bg-amber text-white border-amber"
                              : "bg-amber-soft text-amber border-amber/30"
                          }`}
                        >
                          {elapsedLabel}일 경과
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="text-foreground px-4 py-2 text-xs">
                    {r.bookName}
                    {r.bookDetail ? <span className="text-text-faint"> · {r.bookDetail}</span> : null}
                    {r.notes ? (
                      <div className="text-text-faint mt-0.5 text-xs whitespace-pre-wrap">메모: {r.notes}</div>
                    ) : null}
                  </td>
                  <td className="text-foreground px-4 py-2 text-xs whitespace-nowrap">{r.studentName ?? "—"}</td>
                  <td className="text-text-dim px-4 py-2 text-xs whitespace-nowrap">{r.teacherName ?? "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {CHECKS.map((c) => {
                        const checked = r[c.field];
                        const date = r[c.dateKey];
                        return (
                          <button
                            key={c.field}
                            type="button"
                            disabled={isBusy || !canWrite}
                            onClick={canWrite ? () => toggleCheck(r, c.field, !checked) : undefined}
                            title={
                              checked
                                ? `${c.label} 완료 · ${fmtFull(date)}`
                                : canWrite
                                  ? `${c.label} (미완료) — 클릭하여 체크`
                                  : `${c.label} (미완료) · ${writeLockedPlaceholder("billing")}`
                            }
                            className={`inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs font-medium transition disabled:cursor-not-allowed ${
                              checked
                                ? c.active
                                : canWrite
                                  ? "border-line text-text-faint hover:text-foreground hover:bg-bg-soft"
                                  : "border-line text-text-faint"
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
                      <p className="text-text-faint mt-1 text-xs" title={`마지막 처리 · ${fmtFull(r.statusAt)}`}>
                        처리 {r.statusAt ? fmtShort(r.statusAt) : ""}
                        {r.statusByName ? ` · ${r.statusByName}` : ""}
                      </p>
                    ) : null}
                  </td>
                  <td className="num text-foreground px-4 py-2 text-right text-xs font-medium whitespace-nowrap">{won(r.price)}</td>
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
                      {canWrite ? (
                        <>
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
                        </>
                      ) : null}
                    </div>
                    {/* 삭제 실패 사유 — 권한(RLS)에 막히면 예전엔 아무 표시 없이 행이 남아 "고장난 버튼"으로 읽혔다. */}
                    {delError?.id === r.id ? (
                      <p className="text-danger mt-1 text-xs whitespace-normal">{delError.message}</p>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </DragScrollArea>
      )}

      {canWrite && dialog ? (
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
