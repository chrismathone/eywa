import Link from "next/link";
import { Pill } from "@/components/atoms/pill";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { APPROVAL_FORM_LABEL, docStatusLabel } from "@/features/approvals/types";
import type { ApprovalDocRow } from "@/features/approvals/server/queries";

/**
 * 결재 문서 목록 — 결재함 여섯 함(대기·예정·진행·완료·반려·회수·참조)이 공유하는 표.
 * 그룹웨어 관행대로 **문서번호 → 제목 → 기안자 → 기안일 → 진행 → 상태** 순서.
 * "어디까지 결재됐나"는 진행 열(progressLabel)이 담당한다 — "2/3 김예원 차례".
 * 표 규약(디자인 v5 16단계 2026-09-04): 머리 16px 굵게 · 본문 16px · 카드는 링 하나(border 없음).
 */

/** 지금 누구 차례인가 / 어디까지 왔나 — "2/3 김예원" 식 한 줄. */
function progressLabel(doc: ApprovalDocRow): string {
  const total = doc.steps.length;
  if (total === 0) return "결재선 없음";
  if (doc.status !== "pending") {
    const decided = doc.steps.filter((s) => s.decision !== "pending").length;
    return `${decided}/${total} 처리`;
  }
  const current = doc.steps.find((s) => s.stepNo === doc.currentStep);
  return current ? `${doc.currentStep}/${total} ${current.approverName} 차례` : `${doc.currentStep}/${total}`;
}

export function DocList({
  docs,
  emptyText,
  showDrafter = true,
  deferredConfirmIds = [],
}: {
  docs: ApprovalDocRow[];
  emptyText: string;
  /** 상신함은 전부 내 문서라 기안자 열이 의미 없다. */
  showDrafter?: boolean;
  /**
   * 내가 **부재중 후결로 넘긴 뒤 확인이 남은** 문서 id — 진행 열에 "후결 확인"으로 적는다(page가 `needsMyDeferredConfirm`으로
   * 고른다). 없으면 그 행이 "남의 차례"·"승인"으로 읽혀 '결재 대기'에 왜 있는지 안 보인다(적대 리뷰 2026-09-04).
   */
  deferredConfirmIds?: readonly string[];
}) {
  const deferred = new Set(deferredConfirmIds);
  if (docs.length === 0) {
    return (
      <div className="border-line text-text-faint rounded-2xl border border-dashed px-4 py-12 text-center text-sm">
        {emptyText}
      </div>
    );
  }

  return (
    <DragScrollArea className="bg-card shadow-card rounded-2xl">
      <table className="w-full min-w-[720px] text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-[--line-faint]">
        <thead className="border-line bg-bg-soft/50 border-b [&_th]:whitespace-nowrap">
          <tr className="text-text-dim text-sm [&_th]:font-bold">
            <th className="px-3 py-2 text-center">문서번호</th>
            <th className="px-3 py-2 text-center">양식</th>
            <th className="px-3 py-2 text-center">제목</th>
            {showDrafter ? <th className="px-3 py-2 text-center">기안자</th> : null}
            <th className="px-3 py-2 text-center">기안일</th>
            <th className="px-3 py-2 text-center">진행</th>
            <th className="px-3 py-2 text-center">상태</th>
          </tr>
        </thead>
        <tbody className="divide-line divide-y">
          {docs.map((d) => {
            const status = docStatusLabel(d.status);
            return (
              <tr key={d.id} className="hover:bg-bg-soft/30">
                <td className="num text-text-dim px-3 py-2 text-sm whitespace-nowrap">{d.docNo}</td>
                <td className="text-text-dim px-3 py-2 text-sm whitespace-nowrap">
                  {APPROVAL_FORM_LABEL[d.form] ?? d.form}
                </td>
                <td className="px-3 py-2 text-sm">
                  <Link href={`/approvals/${d.id}`} className="hover:text-primary font-medium hover:underline">
                    {d.title}
                  </Link>
                </td>
                {showDrafter ? (
                  <td className="text-foreground px-3 py-2 text-sm whitespace-nowrap">
                    {d.drafterName}
                    {d.drafterJobTitle ? (
                      <span className="text-text-faint"> {d.drafterJobTitle}</span>
                    ) : null}
                  </td>
                ) : null}
                <td className="num text-text-dim px-3 py-2 text-sm whitespace-nowrap">
                  {d.submittedAt.slice(0, 10)}
                </td>
                <td className="text-text-dim px-3 py-2 text-sm whitespace-nowrap">
                  {deferred.has(d.id) ? <span className="text-amber font-bold">후결 확인</span> : progressLabel(d)}
                </td>
                <td className="px-3 py-2 text-center">
                  <Pill color={status.color}>{status.label}</Pill>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
