"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EmbedLink as Link } from "@/components/embed-link";
import { Button } from "@/components/ui/button";
import { WindowLink } from "@/components/workspace/window-link";
import { recheckWithdrawalRefund } from "@/features/withdrawal-reports/server/refund-actions";
import type { DetailRefundNote } from "@/features/withdrawal-reports/refund-detail-notes";

const box = { plain: "rounded-lg border bg-muted/20 p-4 text-sm", note: "rounded-lg border border-dashed p-4 text-sm", alert: "rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive" } as const;

/**
 * 퇴원보고서 상세의 환불·처리 안내(리뷰 r2 (b) — 판정은 `detailRefundNotes` 한 곳). 결정할 줄이 다른 보고서에 있으면 그 보고서로 바로 가는 링크,
 * 목록 표시(DB)와 지금 계산이 다르면 사실대로 한 줄 · 원장에게는 '지금 다시 판정'(cron 안전망과 같은 release 함수 — 새 쓰기 길 아님).
 */
export function RefundNotes({ notes, reportId }: { notes: DetailRefundNote[]; reportId: string }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function recheck() {
    setError("");
    startTransition(async () => {
      try {
        const result = await recheckWithdrawalRefund(reportId);
        if ("error" in result) { setError(result.error); return; }
        setAsking(false);
        toast.success(result.processed ? "다시 판정했습니다. 결정할 건이 없어 퇴원·수강종료를 처리했습니다."
          : result.hold === false ? "다시 판정했습니다. 결정할 건이 없어 환불 결정 대기를 풀었습니다."
          : result.hold ? "다시 판정했습니다. 원장이 정할 건이 남아 있어 환불 결정 대기를 유지합니다." : "다시 판정했습니다. 새로고침해 결과를 확인해 주세요.");
        router.refresh();
      } catch { setError("다시 판정하지 못했습니다. 새로고침 후 확인해 주세요."); }
    });
  }
  return <>{notes.map(n => <div key={n.key} role={n.tone === "note" ? "note" : n.tone === "alert" ? "alert" : undefined} className={box[n.tone]}>
    <p>{n.text}{n.href && <> {n.href.startsWith("#")
      // 같은 화면 안 자리(리뷰 r3 R2-I1 — '환불 확인' 칸으로) — 화면 이동 없이 그 자리로.
      ? <a href={n.href} className="text-primary hover:underline">{n.linkText}</a>
      : n.href.startsWith("/billing/")
      ? <WindowLink href={n.href} className="text-primary hover:underline">{n.linkText}</WindowLink>
      : <Link href={n.href} className="text-primary hover:underline">{n.linkText}</Link>}</>}</p>
    {n.recheck && (asking
      ? <div className="mt-3 space-y-2" role="alertdialog" aria-label="다시 판정 확인">
          <p>지금 계산으로 환불 결정 대기를 다시 판정합니다. 결정할 건이 없고 승인·데스크 환불이 끝났으면 바로 퇴원·수강종료를 처리합니다(매일 00:05 확인과 같은 처리).</p>
          <div className="flex gap-2"><Button size="sm" disabled={pending} onClick={recheck}>{pending ? "판정 중…" : "다시 판정 확인"}</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => setAsking(false)}>닫기</Button></div>
        </div>
      : <div className="mt-3"><Button size="sm" variant="outline" onClick={() => { setError(""); setAsking(true); }}>지금 다시 판정</Button></div>)}
    {n.recheck && error && <p role="alert" className="mt-2 text-destructive">{error}</p>}
  </div>)}</>;
}
