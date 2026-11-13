"use client";
import { tipProps } from "@/components/hover-tip/tip";

// 수납 표 — 청구서 한 건(학생x청구월)이 **라인마다 한 줄**이라 4항목짜리 하나가 화면 넉 줄을 먹었다.
// 기본은 **접어서 합계 한 줄**, 줄을 누르거나 '전체 펼치기'로 세부 항목을 편다(원장 2026-08-31:
// *"기본적으로 접어진상태로 합계금액이 보이도록, 클릭하거나 펼쳤을때 세부내역"*).
// 🔴 접힌 줄의 값은 순수 함수 [`summarizeLines`](src/features/billing/line-summary.ts) **한 곳**에서만
//    만든다 - 표 안에서 또 더하면 아래 '이 페이지 합계'와 조용히 갈린다.
import { MergedReceiptDetails } from "./merged-receipt-details";
import { useState } from "react";
import Link from "next/link";
import { WindowLink } from "@/components/workspace/window-link";
import { summarizeLines } from "@/features/billing/line-summary";
import { invoiceDisplayLines, invoiceKindLabel, isManualInvoiceShape, PAYMENT_METHOD_LABEL } from "@/features/billing/invoice-lines";
import { ManualInvoiceActions } from "./manual-invoice-actions";
import { overdueLinesOnly } from "@/features/billing/sync-window";
import type { InvoiceRow, InvoiceLineItem, SortKey } from "@/features/billing/server/queries";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { EyIcon } from "@/components/icons/aywa-icons";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";

// 구분(수납 분류) = makeedu 고정 taxonomy(과목 enum 아님) → 여기 라벨/색 하드코딩 허용.
const KIND_STYLE: Record<string, string> = {
  수업: "text-primary bg-primary-soft",
  교재: "text-gold bg-gold-soft",
  차량비: "text-text-dim bg-bg-soft",
  기타: "text-text-dim bg-bg-soft",
  원복: "text-text-dim bg-bg-soft",
};
// 레거시 kind 라벨·결제수단 라벨·라인 펼치기는 엑셀과 한 벌([`invoice-lines.ts`](src/features/billing/invoice-lines.ts), 감사 N3).
const kindLabel = invoiceKindLabel;
const KRW = new Intl.NumberFormat("ko-KR");
const won = (n: number) => `${KRW.format(n)}원`;
/** billed_at("2026-07-05" 또는 timestamptz) → 일(day) 숫자. 라인에 dueDay가 없는 수동 청구서 폴백. */
function dayOfMonth(iso: string | null): number | null {
  if (!iso) return null;
  const day = Number(iso.slice(8, 10));
  return Number.isFinite(day) && day >= 1 && day <= 31 ? day : null;
}
const dash = (n: number) => (n > 0 ? won(n) : "—");
const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit" }) : "—";

type Props = {
  rows: InvoiceRow[];
  sort?: SortKey;
  desc?: boolean;
  period?: string;
  q?: string;
  /** 기한 경과만 보기 필터 상태 — 정렬 링크가 이 필터를 잃지 않게 함께 실어 나른다. */
  overdueOnly?: boolean;
  /** 마지막 동기화에 없던 행만 보기 — 위와 같은 이유로 정렬 링크가 함께 실어 나른다. */
  missingOnly?: boolean;
  /** 수납 쓰기 권한 — 수동 청구서의 '완납'·'취소'를 세운다(감사 N15, 게이트는 서버가 다시 본다). */
  canWrite?: boolean;
};

function buildSortHref(
  col: SortKey,
  current: {
    sort?: SortKey; desc?: boolean; period?: string; q?: string; overdueOnly?: boolean; missingOnly?: boolean;
  },
): string {
  const params = new URLSearchParams();
  if (current.period) params.set("period", current.period);
  if (current.q) params.set("q", current.q);
  if (current.overdueOnly) params.set("overdue", "1");
  if (current.missingOnly) params.set("missing", "1");
  const nextDesc = current.sort === col ? !current.desc : false;
  if (col !== "status") params.set("sort", col);
  if (nextDesc) params.set("desc", "1");
  const s = params.toString();
  return s ? `/billing?${s}` : "/billing?list=1";
}

function SortHeader({
  col,
  label,
  current,
  className,
}: {
  col: SortKey;
  label: string;
  current: {
    sort?: SortKey; desc?: boolean; period?: string; q?: string; overdueOnly?: boolean; missingOnly?: boolean;
  };
  className?: string;
}) {
  const active = current.sort === col;
  return (
    <Link
      href={buildSortHref(col, current)}
      className={`text-text-dim hover:text-foreground inline-flex items-center gap-0.5 transition ${active ? "text-foreground font-bold" : ""} ${className ?? ""}`}
    >
      {label}
      <EyIcon name={active && !current.desc ? "chevronUp" : "chevronDown"} size={14} />
    </Link>
  );
}

const toLines = (r: InvoiceRow): InvoiceLineItem[] => invoiceDisplayLines(r);

export function BillingTable({ rows, sort, desc, period, q, overdueOnly, missingOnly, canWrite = false }: Props) {
  const current = { sort, desc, period, q, overdueOnly, missingOnly };
  // '기한 경과만'은 **미납 라인만** 보여준다 — 필터가 청구서 단위라 예전엔 같은 청구서의 완납 라인이
  // 함께 딸려 나왔다(sync-window.overdueLinesOnly에 판정·예외 근거).
  const groups = rows.map((r) => {
    const lines = toLines(r);
    return { r, lines: overdueOnly ? overdueLinesOnly(lines) : lines };
  });

  // 접힘 상태 - **기본은 전부 접힘**. 라인이 하나뿐인 청구서는 접어도 같은 줄이라 늘 펼친 채로 둔다
  // (누를 것이 없는 화살표를 놓지 않는다). 페이지·정렬이 바뀌면 id가 달라 자연히 다시 접힌다.
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  const foldable = groups.filter((g) => g.lines.length > 1);
  const allOpen = foldable.length > 0 && foldable.every((g) => openIds.has(g.r.id));
  const toggleAll = () =>
    setOpenIds(allOpen ? new Set<string>() : new Set(foldable.map((g) => g.r.id)));
  const toggleOne = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // 페이지 합계(라인 기준)
  let pageBilled = 0, pageDiscount = 0, pagePoints = 0, pagePaid = 0, pageUnpaid = 0, lineCount = 0;
  for (const g of groups)
    for (const li of g.lines) {
      pageBilled += li.amount;
      pageDiscount += li.discount ?? 0;
      pagePoints += li.points ?? 0;
      pagePaid += li.paid ?? 0;
      pageUnpaid += li.unpaid ?? 0;
      lineCount++;
    }

  const numTh = "num px-3 py-2.5 text-right";
  return (
    // 카드 = 헤어라인 링 하나(디자인 v5 ⑤) — 링 위에 border를 겹치지 않는다. 열 제목은 본문 크기(16)·굵게(v5, 옛 eyebrow 14 대문자).
    <div className="bg-card shadow-card rounded-2xl">
      {/* 표 위 한 줄 - 지금 몇 건을 보고 있는지 + 전체 펼치기. 접을 것이 없으면(전부 1항목) 버튼도 없다. */}
      <div className="border-line flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-text-dim text-sm">
          청구서 <span className="num">{groups.length}</span>건 · 항목{" "}
          <span className="num">{lineCount}</span>개
        </span>
        {foldable.length > 0 ? (
          <button
            type="button"
            onClick={toggleAll}
            className="text-text-dim hover:text-foreground hover:bg-bg-soft inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium transition"
          >
            <EyIcon name={allOpen ? "chevronUp" : "chevronDown"} size={14} />
            {allOpen ? "전체 접기" : "전체 펼치기"}
          </button>
        ) : null}
      </div>
      <DragScrollArea className="rounded-b-2xl">
      <table className="w-full min-w-[1080px] text-sm [&_td]:whitespace-nowrap">
        <thead className="border-line text-text-dim border-b text-left text-sm [&_th]:font-bold [&_th]:whitespace-nowrap">
          <tr>
            <th className="w-7 px-1 py-3" />
            <th className="px-3 py-2.5">학년</th>
            <th className="px-3 py-2.5">
              <SortHeader col="name" label="이름" current={current} />
            </th>
            <th className="px-3 py-2.5">청구월</th>
            <th className="px-3 py-2.5 text-center">청구일</th>
            <th className="px-3 py-2.5">구분</th>
            <th className="px-3 py-2.5">수납명</th>
            <th className={numTh}>
              <SortHeader col="amount_total" label="청구액" current={current} className="justify-end" />
            </th>
            <th className={numTh}>할인액</th>
            <th className={numTh}>적립금</th>
            <th className={numTh}>실제낸금액</th>
            <th className={numTh}>미납금액</th>
            <th className="px-3 py-2.5">결제수단</th>
            <th className="num px-3 py-2.5 text-center">수납일</th>
            <th className="px-3 py-2.5">메모</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(({ r, lines }) => {
            const open = lines.length <= 1 || openIds.has(r.id);
            if (!open) {
              const sum = summarizeLines(lines);
              return (
                <tr
                  key={`${r.id}-fold`}
                  onClick={() => toggleOne(r.id)}
                  className="border-line hover:bg-accent/30 cursor-pointer border-t transition-colors"
                >
                  <td className="px-1 py-2.5 text-center">
                    {/* 줄 전체가 눌리지만 버튼도 둔다 - 키보드·스크린리더가 쓰는 진짜 조작부는 이쪽이다. */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleOne(r.id);
                      }}
                      aria-expanded={false}
                      aria-label={`${r.studentName} ${r.period} 세부 항목 ${sum.count}개 펼치기`}
                      className="text-text-faint hover:text-foreground inline-flex size-5 items-center justify-center rounded transition"
                    >
                      <EyIcon name="chevronRight" size={14} />
                    </button>
                  </td>
                  <td className="text-text-dim px-3 py-2.5">{r.studentGrade ?? "—"}</td>
                  {/* 🔴 이름 칸은 줄 펼치기를 삼킨다 - 학생을 열려고 누른 클릭이 접힘까지 건드리면
                      창이 열리면서 표가 함께 튀어 "뭘 누른 건지" 알 수 없다. */}
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <span className="inline-flex items-center">
                      <WindowLink
                        href={`/students/${r.studentId}`}
                        title={r.studentName}
                        className="text-foreground font-medium hover:underline"
                      >
                        {r.studentName}
                      </WindowLink>
                      {r.syncAddedAt ? <MakeeduOriginTag className="ml-1.5" /> : null}
                      {canWrite && isManualInvoiceShape(r.lineItems) ? (
                        <ManualInvoiceActions invoiceId={r.id} status={r.status} label={`${r.studentName} ${r.period}`} />
                      ) : null}
                    </span>
                  </td>
                  <td className="text-text-dim num px-3 py-2.5 text-xs">{r.period}</td>
                  <td className="text-text-dim num px-3 py-2.5 text-center text-xs">
                    {sum.dueDay ?? dayOfMonth(r.billedAt) ?? "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {/* 구분이 섞인 청구서는 한 칩으로 뭉치지 않는다 - '수업'이라 적어 놓고 교재가 섞이면 거짓말. */}
                    {sum.kind ? (
                      <span className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium ${KIND_STYLE[kindLabel(sum.kind)] ?? "text-text-dim bg-bg-soft"}`}>
                        {kindLabel(sum.kind) || "수업"}
                      </span>
                    ) : (
                      <span className="text-text-dim bg-bg-soft inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium">
                        여러 구분
                      </span>
                    )}
                  </td>
                  <td
                    className="text-foreground max-w-[280px] px-3 py-2.5"
                    title={lines.map((l) => l.description).filter(Boolean).join(", ")}
                  >
                    <span className="inline-block max-w-[200px] truncate align-bottom">
                      {sum.description || "—"}
                    </span>
                    <span className="text-text-dim ml-1 text-xs">
                      외 <span className="num">{sum.count - 1}</span>건
                    </span>
                  </td>
                  <td className="text-foreground num px-3 py-2.5 text-right font-medium">{won(sum.amount)}</td>
                  <td className="num px-3 py-2.5 text-right text-xs">
                    {sum.discount > 0 ? (
                      <span className="text-amber">-{won(sum.discount)}</span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                  <td className="num px-3 py-2.5 text-right text-xs">
                    {sum.points > 0 ? (
                      <span className="text-text-dim">{won(sum.points)}</span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                  <td className="num px-3 py-2.5 text-right">
                    <span className={sum.paid > 0 ? "text-green" : "text-text-faint"}>{dash(sum.paid)}</span>
                  </td>
                  <td className="num px-3 py-2.5 text-right">
                    {sum.unpaid === undefined ? (
                      <span className="text-text-faint">—</span>
                    ) : sum.unpaid > 0 ? (
                      <span className="text-danger font-medium">{won(sum.unpaid)}</span>
                    ) : (
                      <span className="text-green">완납</span>
                    )}
                  </td>
                  <td className="text-text-dim px-3 py-2.5 text-xs">
                    {sum.method ? (PAYMENT_METHOD_LABEL[sum.method] ?? sum.method) : "—"}
                  </td>
                  <td className="text-text-dim num px-3 py-2.5 text-center text-xs">
                    {shortDate(sum.paidDate)}
                  </td>
                  <td className="text-text-dim px-3 py-2.5 text-xs">
                    {r.notes ? (
                      <span className="line-clamp-1" {...tipProps(r.notes)}>
                        {r.notes}
                      </span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            }
            return lines.map((li, i) => {
              const first = i === 0;
              // undefined = 라인별 미납 미상(구형 데이터의 2번째+ 라인) — 0(완납)과 구분해 "—"로.
              const unpaid = li.unpaid;
              return (
                <tr
                  key={`${r.id}-${i}`}
                  className={`hover:bg-accent/30 transition-colors ${first ? "border-line border-t" : ""}`}
                >
                  <td className="px-1 py-2.5 text-center">
                    {first && lines.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => toggleOne(r.id)}
                        aria-expanded={true}
                        aria-label={`${r.studentName} ${r.period} 세부 항목 접기`}
                        className="text-text-faint hover:text-foreground inline-flex size-5 items-center justify-center rounded transition"
                      >
                        <EyIcon name="chevronDown" size={14} />
                      </button>
                    ) : null}
                  </td>
                  <td className="text-text-dim px-3 py-2.5">{first ? (r.studentGrade ?? "—") : ""}</td>
                  <td className="px-3 py-2.5">
                    {first ? (
                      <span className="inline-flex items-center">
                        <WindowLink
                          href={`/students/${r.studentId}`}
                          title={r.studentName}
                          className="text-foreground font-medium hover:underline"
                        >
                          {r.studentName}
                        </WindowLink>
                        {r.syncAddedAt ? <MakeeduOriginTag className="ml-1.5" /> : null}
                        {canWrite && isManualInvoiceShape(r.lineItems) ? (
                          <ManualInvoiceActions invoiceId={r.id} status={r.status} label={`${r.studentName} ${r.period}`} />
                        ) : null}
                      </span>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="text-text-dim num px-3 py-2.5 text-xs">{first ? r.period : ""}</td>
                  {/* 청구일 — makeedu 라인엔 dueDay가 있고, aywa 수동 청구서엔 없다(billed_at에만 저장).
                      폴백이 없던 시절엔 사용자가 다이얼로그에서 청구일을 입력해도 항상 '—'로 떠서
                      "저장은 됐는데 아무도 안 읽는" write-only-orphan이었다. */}
                  <td className="text-text-dim num px-3 py-2.5 text-center text-xs">
                    {li.dueDay ?? dayOfMonth(r.billedAt) ?? "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-block rounded-sm px-1.5 py-0.5 text-xs font-medium ${KIND_STYLE[kindLabel(li.kind)] ?? "text-text-dim bg-bg-soft"}`}>
                      {kindLabel(li.kind) || "수업"}
                    </span>
                  </td>
                  <td className="text-foreground max-w-[280px] px-3 py-2.5">
                    <span className="block truncate" title={li.description}>{li.description || "—"}</span>
                    <MergedReceiptDetails line={li} />
                  </td>
                  <td className="text-foreground num px-3 py-2.5 text-right">{won(li.amount)}</td>
                  {/* 할인 사유(discount_reason)는 저장만 되고 어디에도 안 뜨던 orphan — 금액 셀 **카드**로 노출.
                      (별도 열을 늘리면 좁은 창에서 표가 깨진다 · 카드 규약은 원장 2026-09-15.) */}
                  <td
                    className="num px-3 py-2.5 text-right text-xs"
                    {...tipProps(first && r.discountReason ? { rows: [["할인 사유", r.discountReason]] } : null)}
                  >
                    {(li.discount ?? 0) > 0 ? (
                      <span className={`text-amber${first && r.discountReason ? " underline decoration-dotted underline-offset-2" : ""}`}>
                        -{won(li.discount ?? 0)}
                      </span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                  <td className="num px-3 py-2.5 text-right text-xs">
                    {(li.points ?? 0) > 0 ? <span className="text-text-dim">{won(li.points ?? 0)}</span> : <span className="text-text-faint">—</span>}
                  </td>
                  <td className="num px-3 py-2.5 text-right">
                    <span className={(li.paid ?? 0) > 0 ? "text-green" : "text-text-faint"}>{dash(li.paid ?? 0)}</span>
                  </td>
                  <td className="num px-3 py-2.5 text-right">
                    {unpaid === undefined ? (
                      <span className="text-text-faint">—</span>
                    ) : unpaid > 0 ? (
                      <span className="text-danger font-medium">{won(unpaid)}</span>
                    ) : (
                      <span className="text-green">완납</span>
                    )}
                  </td>
                  <td className="text-text-dim px-3 py-2.5 text-xs">
                    {li.method ? (PAYMENT_METHOD_LABEL[li.method] ?? li.method) : "—"}
                  </td>
                  <td className="text-text-dim num px-3 py-2.5 text-center text-xs">{shortDate(li.paidDate)}</td>
                  <td className="text-text-dim px-3 py-2.5 text-xs">
                    {first && r.notes ? (
                      <span className="line-clamp-1" {...tipProps(r.notes)}>{r.notes}</span>
                    ) : (
                      <span className="text-text-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            });
          })}
        </tbody>
        <tfoot>
          <tr className="border-line bg-bg-soft border-t font-bold">
            <td className="text-text-dim px-3 py-3 text-xs" colSpan={7}>
              이 페이지 합계 · <span className="num">{lineCount}</span>개 항목 / {groups.length}건
            </td>
            <td className="text-foreground num px-3 py-3 text-right">{won(pageBilled)}</td>
            <td className="num px-3 py-3 text-right text-xs">{pageDiscount > 0 ? <span className="text-amber">-{won(pageDiscount)}</span> : "—"}</td>
            <td className="num px-3 py-3 text-right text-xs">{pagePoints > 0 ? won(pagePoints) : "—"}</td>
            <td className="text-foreground num px-3 py-3 text-right">{won(pagePaid)}</td>
            <td className="num px-3 py-3 text-right">{pageUnpaid > 0 ? <span className="text-danger">{won(pageUnpaid)}</span> : <span className="text-green">완납</span>}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
      </DragScrollArea>
    </div>
  );
}
