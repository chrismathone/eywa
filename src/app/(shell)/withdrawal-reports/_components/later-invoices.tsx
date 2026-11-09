"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { WindowLink } from "@/components/workspace/window-link";
import { INVOICE_CATEGORY_LABEL } from "@/features/withdrawal-reports/prefill";
import { approveWithdrawalRefund, declineWithdrawalRefund } from "@/features/withdrawal-reports/server/refund-actions";
import { approvable, lineRefundable as refundable, unpickedNotice, type OpenClaim } from "@/features/withdrawal-reports/refund-decision";
import { LATER_FAILED_TEXT, LATER_HIDDEN_TEXT, type LaterState } from "@/features/withdrawal-reports/refund-detail-notes";
import { titledName } from "@/features/withdrawal-reports/model";
import type { LaterInvoice, LaterLine } from "@/features/withdrawal-reports/server/refund";
import { lineStatus, otherRefundText, unallocNote, won } from "./later-line-text";

const control = "rounded-md border bg-background px-2 py-1.5 text-sm";
/**
 * 원장 환불 결정(원장 2026-11-06) — 이 화면의 환불 가능 줄 중 결정 안 된 줄 · '환불하지 않음'으로 정한 줄(서버 `getReport` · DB 결정 표) ·
 * 이 묶음 요청서가 담은 줄 중 다시 정할 것(결정 뒤 낸 돈이 늚 · 표식 키가 낡음 — 리뷰 r2 D-2·D-4 · '환불 없음'으로만).
 */
export type RefundDecisionView = { undecided: readonly string[]; declined: readonly string[]; openClaims?: readonly OpenClaim[] };
/**
 * 퇴원월 **뒤** 청구 — 원장 2026-10-29 *"이후에 납부한건 혹은 환불한 건에 대해서도 표시"*. 과목 수강종료는 끝내는 반 줄만.
 * 수납 청구 줄마다 토글 — *"어떤건을 환불할건지 토글토글토글해서 선택선택선택해 그 건을 환불하게"*. 고른 줄이 있을 때만
 * '환불 승인' → 데스크 담당자 고르기 + 확인("환불을 승인하시겠습니까?") → 요청서 한 장. 다른 사람은 청구·요청서·담당·완료 여부만 본다.
 * 원장 2026-11-03: 환불은 **데스크 환불 단계**다 — 승인은 원장급만(`canRequestRefund` → `canApprove` · 10-29 규칙 그대로).
 * 처리 전 보고서(`gates`)는 데스크가 환불완료일자를 넣어야 퇴원·수강종료를 처리한다 — 끝난 뒤 알림은 서버가 실제로 이은 결과(`result.gates`)로 정한다.
 * 원장 2026-11-06(**원장 환불 결정**): 처리 전 보고서(`decisionOpen`)에 환불할 수 있는 줄이 남아 있으면 원장이 정해야 처리한다 —
 * '환불 승인'(고르지 않은 줄은 같은 동작에서 '환불하지 않음' · 확인 칸에 그 건수) 또는 **'환불 없음'**(확인 칸). 줄마다 '결정 전' · '환불 안 함(원장 결정)'을 보인다.
 * 데스크 담당자는 학원 설정 '데스크 담당자'로 지정한 사람만 — 지정이 비었으면 안내(`deskNotice`)로 환불 승인을 막는다.
 */
export function LaterInvoices({ reportId, rows, canApprove, deskStaff, gates = false, decisionOpen = false, decision = { undecided: [], declined: [] }, deskNotice, laterState = "ok", subjectLabels = {} }: {
  /** 과목 키 → 이름(미배분 과목 몫 설명). */
  subjectLabels?: Record<string, string>;
  reportId: string; rows: LaterInvoice[]; canApprove: boolean; deskStaff: { id: string; name: string; jobTitle?: string | null }[]; gates?: boolean;
  /** 퇴원월 뒤 청구를 읽었나(리뷰 r2 I3) — 조회 실패 · 수납 열람권 없음이면 '없음'이라고 말하지 않는다. */
  laterState?: LaterState;
  /** 처리 전(진행 중·처리 예약) 보고서 — 원장 결정이 처리를 막는다(`decisionBlocksProcessing`). */
  decisionOpen?: boolean;
  decision?: RefundDecisionView;
  /** 데스크 담당자를 고를 수 없는 까닭(학원 설정 미지정 등) — 있으면 환불 승인을 막는다. */
  deskNotice?: string;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState<"approve" | "decline" | null>(null);
  const [desk, setDesk] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  // 보고서 양식의 '환불 확인' 칸(원장 2026-10-30 *"퇴원보고서 내의 공간을 만들고 거기에 토글"*) — 청구가 없어도 칸은 있다.
  // 못 읽었거나(조회 실패) 수납 열람권이 없으면 '없음'이 아니라 그 사실을(리뷰 r2 I3 — 원장이 결정할 길이 없다고 오해하지 않게).
  // `id="refund"` = 목록 '내 환불 결정 필요'·상세 안내 링크가 이 칸으로 바로 온다(리뷰 r2 m8).
  if (laterState !== "ok") return <span id="refund" role={laterState === "failed" ? "alert" : undefined} className={laterState === "failed" ? "text-destructive" : "text-muted-foreground"}>{laterState === "failed" ? LATER_FAILED_TEXT : LATER_HIDDEN_TEXT}</span>;
  if (!rows.length) return <span id="refund" className="text-muted-foreground">퇴원월 뒤 청구 없음 — 환불할 건이 없습니다.</span>;
  const lines = rows.flatMap(inv => inv.lines.map(line => ({ inv, line })));
  // 원장이 정할 줄 = 환불 가능 줄 + 다시 정할 이 묶음 요청서 줄(서버 `decisionTargets`와 같은 묶음 — '환불 없음'·고르지 않은 줄이 이 차례로 간다).
  const reopen = new Map((decision.openClaims ?? []).map(o => [o.key, o]));
  const open = lines.filter(x => refundable(x.inv, x.line) || reopen.has(x.line.key));
  const chosen = open.filter(x => picked.has(x.line.key));
  const unpicked = open.filter(x => !picked.has(x.line.key));
  const total = chosen.reduce((s, x) => s + x.line.paidNet, 0);
  const undecided = new Set(decision.undecided);
  const declined = new Set(decision.declined);
  const waiting = decisionOpen && open.some(x => undecided.has(x.line.key));
  function toggle(key: string) {
    setError(""); setAsking(null);
    setPicked(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  function approve() {
    setError("");
    startTransition(async () => {
      try {
        const result = await approveWithdrawalRefund(reportId, chosen.map(x => x.line.key), desk, unpicked.map(x => x.line.key));
        if ("error" in result) { setError(result.error); return; }
        setAsking(null); setPicked(new Set()); setDesk("");
        // 다른 보고서에 결정할 건이 남았으면 그것을 먼저 말한다(DB가 센 묶음 전체 — 리뷰 r2 m12 · '환불 없음'과 같은 갈래).
        toast.success(!result.gates ? "환불을 승인했습니다. 환불 요청서를 만들고 데스크 담당자의 할 일로 보냈습니다."
          : result.undecided ? `환불을 승인했습니다. 데스크 담당자의 할 일로 보냈습니다. 함께 요청한 다른 보고서에 결정할 건 ${result.undecided}건이 남아 있어, 그 결정과 환불 처리가 끝나야 퇴원·수강종료를 처리합니다.`
          : "환불을 승인했습니다. 데스크 담당자의 할 일로 보냈고, 환불 처리와 남은 승인이 끝나면 퇴원·수강종료를 처리합니다.");
        router.refresh();
      } catch { setError("처리를 완료하지 못했습니다. 새로고침 후 확인해 주세요."); }
    });
  }
  function decline() {
    setError("");
    startTransition(async () => {
      try {
        const result = await declineWithdrawalRefund(reportId, open.map(x => x.line.key));
        if ("error" in result) { setError(result.error); return; }
        setAsking(null);
        toast.success(result.processed ? "환불 없음으로 정하고 퇴원·수강종료를 처리했습니다."
          : result.undecided === null ? "환불 없음으로 정했습니다. 처리 확인 대기 — 다음 확인(매일 00:05) 때 다시 판정합니다."
          : result.undecided > 0 ? `환불 없음으로 정했습니다. 함께 요청한 다른 보고서에 결정할 건 ${result.undecided}건이 남아 있습니다.` : "환불 없음으로 정했습니다. 남은 승인·데스크 환불이 끝나면 처리합니다.");
        router.refresh();
      } catch { setError("처리를 완료하지 못했습니다. 새로고침 후 확인해 주세요."); }
    });
  }
  const label = (inv: LaterInvoice, l: LaterLine) => `${inv.period} ${INVOICE_CATEGORY_LABEL[inv.category] ?? "기타"} · ${l.description.trim()}`;
  const subjectLabel = (k: string) => subjectLabels[k] ?? "기타 과목";
  // 줄의 원장 결정 표시 — 처리 전 보고서만('결정 전'), 정해 둔 '환불 안 함'은 늘.
  const decisionMark = (key: string) => declined.has(key) ? "환불 안 함(원장 결정)" : decisionOpen && undecided.has(key) ? (canApprove ? "결정 전" : "원장 결정 전") : null;
  // 다른 요청에서 이미 환불을 마친 줄(이 요청에선 결정 대상 · '환불 없음'이면 '환불하지 않음'으로 남는다 — 리뷰 r2 m10).
  const otherDone = open.filter(x => x.line.otherRefund?.completed).length;
  return <div id="refund" className="space-y-2" aria-label="환불 확인">
    <div><p className="text-xs text-muted-foreground">퇴원월 다음 달부터 잡힌 수납 청구입니다{rows.some(r => r.partial) ? "(과목 수강종료라 끝내는 과목 몫과 기타 항목만)" : ""}. {canApprove
      ? `환불할 건만 토글로 고른 뒤 환불 승인을 누르세요.${waiting ? " 환불할 건이 없으면 '환불 없음'을 누르세요. 원장이 정하기 전에는 퇴원·수강종료를 처리하지 않습니다." : " 고르지 않으면 아무것도 하지 않습니다."}${gates ? " 환불을 승인하면 데스크 환불 처리까지 끝나야 퇴원·수강종료를 처리합니다." : ""}`
      : "환불 승인은 원장만 할 수 있습니다."}</p></div>
    <table className="w-full text-xs">
      <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 font-normal">청구</th><th className="font-normal">청구액</th><th className="font-normal">납부</th><th className="font-normal">상태</th><th className="font-normal">환불요청</th></tr></thead>
      <tbody>{lines.map(({ inv, line }, i) => {
        const on = picked.has(line.key);
        const re = reopen.get(line.key);
        const mark = refundable(inv, line) || re ? decisionMark(line.key) : null;
        const note = unallocNote(line, subjectLabel);
        return <tr key={line.key} className="border-b last:border-0">
          <td className="py-2">{label(inv, line)}{line.unbound && <span className="text-muted-foreground ml-1 text-xs">· 기타 항목</span>}
            {note && <div className="text-muted-foreground mt-0.5 text-xs">{note}</div>}
            {inv.status === "void" && inv.reissued && (i === 0 || lines[i - 1]!.inv.id !== inv.id) && <div role="note" className="mt-0.5 text-xs text-destructive">같은 달 재발행 청구가 있습니다 — 낸 돈이 옮겨졌는지 수납에서 확인</div>}</td>
          {/* 미배분 납부 줄은 청구된 항목이 아니다 — 청구액 '—'(리뷰 r2 m11). 부분 환불 줄은 남은 낸 돈과 그 내역. */}
          <td>{line.unallocated ? "—" : won(line.amount)}{line.discount ? <span className="text-xs text-muted-foreground"> (할인 {won(line.discount)})</span> : null}</td>
          <td>{won(line.paidNet)}{line.billingRefundAmount ? <span className="text-xs text-muted-foreground"> (낸 돈 {won(line.paidNet + line.billingRefundAmount)} · 환불 {won(line.billingRefundAmount)})</span> : null}</td>
          <td>{lineStatus(inv, line)}</td>
          <td>{line.refund
            ? <><WindowLink href={`/billing/refunds/${line.refund.documentId}`} title="환불 요청서" className="text-primary hover:underline">{line.refund.completed ? "환불 완료" : "데스크 환불 대기"}{line.refund.deskName ? ` · 담당 ${line.refund.deskName}` : ""} · 요청서</WindowLink>
              {/* 다시 정할 이 묶음 요청서 줄(리뷰 r2 D-2·D-4) — 늘어난 몫을 환불하려면 요청서를 지우고 다시 환불 승인(완료 전에만). '환불 없음'은 더 환불하지 않음. */}
              {re && <div className="mt-0.5 text-muted-foreground">{mark ? `${mark} · ` : ""}{re.reason === "increase" ? `결정 뒤 낸 돈이 늘었습니다(+${won(re.now - (re.before ?? 0))}) — 더 환불하지 않으면 '환불 없음'` : "줄 내용이 바뀌어 이 요청서가 담았는지 다시 정합니다 — 더 환불하지 않으면 '환불 없음'"}</div>}</>
            : !refundable(inv, line) ? <span className="text-muted-foreground">—</span>
            : canApprove && approvable(inv, line)
              ? <span className="inline-flex flex-wrap items-center gap-2"><button type="button" role="switch" aria-checked={on} aria-label={`${label(inv, line)} 환불`} disabled={pending} onClick={() => toggle(line.key)}
                  className="inline-flex items-center gap-2 text-sm disabled:opacity-50 print:hidden"><span className={`relative inline-block h-5 w-9 rounded-full transition-colors ${on ? "bg-primary" : "bg-muted-foreground/30"}`}><span className={`absolute top-0.5 size-4 rounded-full bg-background shadow transition-all ${on ? "left-4" : "left-0.5"}`} /></span>{on ? "환불" : "안 함"}</button>
                  {mark && <span className="text-muted-foreground">{mark}</span>}</span>
              : <span className="text-muted-foreground">{mark ?? "요청서 없음"}</span>}
            {/* 다른 요청(묶음)의 요청서가 담은 줄 — 이 요청에선 줄을 잡지 않는다(원장 결정 대기 · 팀장 결정 2026-11-06). 참고로 그 요청서를 보인다.
                다시 고를 수 있는 것은 취소된 요청의 환불 전 요청서뿐(`reapprovable`) — 그 밖엔 '환불하지 않음'으로만 정한다(같은 돈 두 번 막기). */}
            {!line.refund && line.otherRefund && <div className="mt-0.5"><WindowLink href={`/billing/refunds/${line.otherRefund.documentId}`} title="환불 요청서" className="text-muted-foreground hover:underline">{otherRefundText(line.otherRefund)}</WindowLink></div>}</td>
        </tr>;
      })}</tbody>
    </table>
    {canApprove && chosen.length > 0 && !asking && <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm">선택 {chosen.length}건 · 환불 {won(total)}</span>
      <Button disabled={pending} onClick={() => { setError(""); setDesk(""); setAsking("approve"); }}>환불 승인</Button>
    </div>}
    {canApprove && chosen.length === 0 && waiting && !asking && <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" disabled={pending} onClick={() => { setError(""); setAsking("decline"); }}>환불 없음</Button>
    </div>}
    {asking === "approve" && chosen.length > 0 && <div className="space-y-3 rounded-lg border bg-muted/20 p-4" role="alertdialog" aria-label="환불 승인 확인">
      <p className="text-sm">환불을 승인하시겠습니까? 고른 {chosen.length}건 · {won(total)}에 대한 환불 요청서가 만들어지고, 고른 데스크 담당자의 할 일·알림으로 갑니다.{gates ? " 데스크가 환불을 처리(환불완료일자 입력)해야 퇴원·수강종료를 처리합니다." : ""}{unpicked.length ? ` ${unpickedNotice(unpicked.length)}.` : ""}</p>
      <ul className="list-disc pl-5 text-xs text-muted-foreground">{chosen.map(x => <li key={x.line.key}>{label(x.inv, x.line)} {won(x.line.paidNet)}</li>)}</ul>
      {deskNotice
        ? <p role="alert" className="text-sm text-destructive">{deskNotice}</p>
        : <label className="flex flex-wrap items-center gap-2 text-sm">데스크 담당자
          <select className={control} aria-label="데스크 담당자" value={desk} disabled={pending} onChange={e => setDesk(e.target.value)}>
            <option value="">고르기</option>
            {/* 목록·결재란과 같은 표기 '홍길동 대리'(리뷰 r2 m15). */}
            {deskStaff.map(s => <option key={s.id} value={s.id}>{titledName({ name: s.name, jobTitle: s.jobTitle ?? null }, s.name)}</option>)}
          </select>
        </label>}
      <div className="flex gap-2"><Button disabled={pending || !desk || !!deskNotice} onClick={approve}>{pending ? "처리 중…" : "환불 승인"}</Button><Button variant="outline" disabled={pending} onClick={() => setAsking(null)}>닫기</Button></div>
    </div>}
    {asking === "decline" && <div className="space-y-3 rounded-lg border bg-muted/20 p-4" role="alertdialog" aria-label="환불 없음 확인">
      <p className="text-sm">환불 없음으로 정하시겠습니까? 이 보고서에서 정할 {open.length}건{declined.size ? `(이미 '환불 안 함' ${open.filter(x => declined.has(x.line.key)).length}건 포함)` : ""}을 모두 환불하지 않음으로 기록합니다.{otherDone ? ` 다른 요청에서 이미 환불을 마친 ${otherDone}건도 이 요청에선 '환불하지 않음'으로 남습니다(다시 돌려주지 않습니다).` : ""} 남은 승인·데스크 환불이 끝났으면 바로 퇴원·수강종료를 처리합니다.</p>
      <ul className="list-disc pl-5 text-xs text-muted-foreground">{open.map(x => <li key={x.line.key}>{label(x.inv, x.line)} {won(x.line.paidNet)}</li>)}</ul>
      <div className="flex gap-2"><Button disabled={pending} onClick={decline}>{pending ? "처리 중…" : "환불 없음 확인"}</Button><Button variant="outline" disabled={pending} onClick={() => setAsking(null)}>닫기</Button></div>
    </div>}
    {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
  </div>;
}
