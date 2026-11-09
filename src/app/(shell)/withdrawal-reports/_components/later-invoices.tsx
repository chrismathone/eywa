"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { approveWithdrawalRefund, declineWithdrawalRefund } from "@/features/withdrawal-reports/server/refund-actions";
import { separateWithdrawalRefundIncrease } from "@/features/withdrawal-reports/server/refund-separate-actions";
import { lineRefundable as refundable, unpickedNotice, type OpenClaim } from "@/features/withdrawal-reports/refund-decision";
import { LATER_FAILED_TEXT, LATER_HIDDEN_TEXT, LATER_LIMIT_TEXT, type DetailRefundNote, type LaterState } from "@/features/withdrawal-reports/refund-detail-notes";
import { titledName } from "@/features/withdrawal-reports/model";
import type { LaterInvoice } from "@/features/withdrawal-reports/server/refund";
import { won, type LineDeductionView } from "./later-line-text";
import { LaterRow, laterLabel as label } from "./later-row";
import { RefundNotes } from "./refund-notes";

const control = "rounded-md border bg-background px-2 py-1.5 text-sm";
/**
 * 원장 환불 결정(원장 2026-11-06) — 이 화면의 환불 가능 줄 중 결정 안 된 줄 · '환불하지 않음'으로 정한 줄(서버 `getReport` · DB 결정 표) ·
 * 이 묶음 요청서가 담은 줄 중 다시 정할 것(결정 뒤 낸 돈이 늚 · 표식 키가 낡음 — 리뷰 r2 D-2·D-4) · 줄별 뺄 몫(이전 환불 완료 기록·따로 환불 — 리뷰 r3 R2-I2) ·
 * 결정 기록·대기 표시를 못 읽음(`failed` — 결정 단추를 막는다 · 그중 결정 기록이면 `decisionsFailed` — 줄 표시도 '확인 못 함' · 리뷰 r3 R2-m10) ·
 * 이 칸 안에 보일 안내(목록 표시와 다름 · 지금 다시 판정 — 리뷰 r3 R2-I1).
 */
export type RefundDecisionView = { undecided: readonly string[]; declined: readonly string[]; openClaims?: readonly OpenClaim[]; deductions?: readonly LineDeductionView[];
  failed?: boolean; decisionsFailed?: boolean; notes?: readonly DetailRefundNote[] };
/**
 * 퇴원월 **뒤** 청구 — 원장 2026-10-29 *"이후에 납부한건 혹은 환불한 건에 대해서도 표시"*. 과목 수강종료는 끝내는 반 줄만.
 * 수납 청구 줄마다 토글 — *"어떤건을 환불할건지 토글토글토글해서 선택선택선택해 그 건을 환불하게"*. 고른 줄이 있을 때만
 * '환불 승인' → 데스크 담당자 고르기 + 확인("환불을 승인하시겠습니까?") → 요청서 한 장. 다른 사람은 청구·요청서·담당·완료 여부만 본다.
 * 원장 2026-11-03: 환불은 **데스크 환불 단계**다 — 승인은 원장급만(`canRequestRefund` → `canApprove` · 10-29 규칙 그대로).
 * 처리 전 보고서(`gates`)는 데스크가 환불완료일자를 넣어야 퇴원·수강종료를 처리한다 — 끝난 뒤 알림은 서버가 실제로 이은 결과(`result.gates`)로 정한다.
 * 원장 2026-11-06(**원장 환불 결정**): 처리 전 보고서(`decisionOpen`)에 환불할 수 있는 줄이 남아 있으면 원장이 정해야 처리한다 —
 * '환불 승인'(고르지 않은 줄은 같은 동작에서 '환불하지 않음' · 확인 칸에 그 건수) 또는 **'환불 없음'**(확인 칸). 줄마다 '결정 전' · '환불 안 함(원장 결정)'을 보인다.
 * 원장 결정 2026-11-09: 환불을 마친 줄에 그 뒤 낸 돈이 늘면 그 줄에서 '환불하지 않음 — 늘어난 몫은 수납에서 따로 처리'(첫 환불 기록은 그대로).
 * 데스크 담당자는 학원 설정 '데스크 담당자'로 지정한 사람만 — 지정이 비었으면 안내(`deskNotice`)로 환불 승인을 막는다.
 */
export function LaterInvoices({ reportId, rows, canApprove, deskStaff, gates = false, decisionOpen = false, decision = { undecided: [], declined: [] }, deskNotice, laterState = "ok", subjectLabels = {} }: {
  /** 과목 키 → 이름(미배분 과목 몫 설명). */
  subjectLabels?: Record<string, string>;
  reportId: string; rows: LaterInvoice[]; canApprove: boolean; deskStaff: { id: string; name: string; jobTitle?: string | null }[]; gates?: boolean;
  /** 퇴원월 뒤 청구를 읽었나(리뷰 r2 I3) — 조회 실패 · 수납 열람권 없음 · 청구가 너무 많음이면 '없음'이라고 말하지 않는다. */
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
  const [separating, setSeparating] = useState<string | null>(null);
  const [desk, setDesk] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  // 보고서 양식의 '환불 확인' 칸(원장 2026-10-30 *"퇴원보고서 내의 공간을 만들고 거기에 토글"*) — 청구가 없어도 칸은 있다.
  // `id="refund"` = 목록 '내 환불 결정 필요'·상세 안내 링크가 이 칸으로 바로 온다(리뷰 r2 m8) — 목록 표시와 다를 때의 안내·'지금 다시 판정'도 이 칸 맨 위에(리뷰 r3 R2-I1).
  const lead = decision.notes?.length ? <RefundNotes notes={[...decision.notes]} reportId={reportId} /> : null;
  // 못 읽었거나(조회 실패 · 청구가 너무 많음) 수납 열람권이 없으면 '없음'이 아니라 그 사실을(리뷰 r2 I3 — 원장이 결정할 길이 없다고 오해하지 않게).
  if (laterState !== "ok") return <div id="refund" className="space-y-2" aria-label="환불 확인">{lead}<span role={laterState === "hidden" ? undefined : "alert"} className={laterState === "hidden" ? "text-muted-foreground" : "text-destructive"}>{laterState === "failed" ? LATER_FAILED_TEXT : laterState === "limit" ? LATER_LIMIT_TEXT : LATER_HIDDEN_TEXT}</span></div>;
  if (!rows.length) return <div id="refund" className="space-y-2" aria-label="환불 확인">{lead}<span className="text-muted-foreground">퇴원월 뒤 청구 없음 — 환불할 건이 없습니다.</span></div>;
  // 결정 기록·대기 표시를 못 읽었으면 정하지 않는다(이미 정한 줄이 '결정 전'으로 보일 수 있다 — 리뷰 r3 R2-m10 · 닫힌 쪽).
  const canDecide = canApprove && !decision.failed;
  const lines = rows.flatMap(inv => inv.lines.map(line => ({ inv, line })));
  // 원장이 정할 줄 = 환불 가능 줄 + 다시 정할 이 묶음 요청서 줄(서버 `decisionTargets`와 같은 묶음 — '환불 없음'·고르지 않은 줄이 이 차례로 간다).
  const reopen = new Map((decision.openClaims ?? []).map(o => [o.key, o]));
  const deductions = new Map((decision.deductions ?? []).map(d => [d.key, d]));
  // 다시 승인하면 요청할 돈 = 낸 돈 − 이전 환불 완료 기록 − 따로 환불(서버 approve · DB attach 상한과 같은 식).
  const remainOf = (key: string, paid: number) => { const d = deductions.get(key); return Math.max(0, paid - (d ? d.refunded + d.separate : 0)); };
  const open = lines.filter(x => refundable(x.inv, x.line) || reopen.has(x.line.key));
  const chosen = open.filter(x => picked.has(x.line.key));
  const unpicked = open.filter(x => !picked.has(x.line.key));
  const total = chosen.reduce((s, x) => s + remainOf(x.line.key, x.line.paidNet), 0);
  const undecided = new Set(decision.undecided);
  const declined = new Set(decision.declined);
  const waiting = decisionOpen && open.some(x => undecided.has(x.line.key));
  const sepClaim = separating ? reopen.get(separating) : undefined;
  function toggle(key: string) {
    setError(""); setAsking(null); setSeparating(null);
    setPicked(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  }
  function run(task: () => Promise<string | null>) {
    setError("");
    startTransition(async () => {
      try { const failed = await task(); if (failed) setError(failed); else router.refresh(); }
      catch { setError("처리를 완료하지 못했습니다. 새로고침 후 확인해 주세요."); }
    });
  }
  const approve = () => run(async () => {
    const result = await approveWithdrawalRefund(reportId, chosen.map(x => x.line.key), desk, unpicked.map(x => x.line.key));
    if ("error" in result) return result.error;
    setAsking(null); setPicked(new Set()); setDesk("");
    // 다른 보고서에 결정할 건이 남았으면 그것을 먼저 말한다(DB가 센 묶음 전체 — 리뷰 r2 m12 · '환불 없음'과 같은 갈래).
    toast.success(!result.gates ? "환불을 승인했습니다. 환불 요청서를 만들고 데스크 담당자의 할 일로 보냈습니다."
      : result.undecided ? `환불을 승인했습니다. 데스크 담당자의 할 일로 보냈습니다. 함께 요청한 다른 보고서에 결정할 건 ${result.undecided}건이 남아 있어, 그 결정과 환불 처리가 끝나야 퇴원·수강종료를 처리합니다.`
      : "환불을 승인했습니다. 데스크 담당자의 할 일로 보냈고, 환불 처리와 남은 승인이 끝나면 퇴원·수강종료를 처리합니다.");
    return null;
  });
  const decline = () => run(async () => {
    const result = await declineWithdrawalRefund(reportId, open.map(x => x.line.key));
    if ("error" in result) return result.error;
    setAsking(null);
    toast.success(result.processed ? "환불 없음으로 정하고 퇴원·수강종료를 처리했습니다."
      : result.undecided === null ? "환불 없음으로 정했습니다. 처리 확인 대기 — 다음 확인(매일 00:05) 때 다시 판정합니다."
      : result.undecided > 0 ? `환불 없음으로 정했습니다. 함께 요청한 다른 보고서에 결정할 건 ${result.undecided}건이 남아 있습니다.` : "환불 없음으로 정했습니다. 남은 승인·데스크 환불이 끝나면 처리합니다.");
    return null;
  });
  const separate = (key: string) => run(async () => {
    const result = await separateWithdrawalRefundIncrease(reportId, key);
    if ("error" in result) return result.error;
    setSeparating(null);
    const head = `늘어난 ${won(result.amount)}은 수납에서 따로 환불하기로 정했습니다(담당 데스크에게 알림).`;
    toast.success(result.processed ? `${head} 이어서 퇴원·수강종료를 처리했습니다.`
      : result.undecided === null ? `${head} 처리 확인 대기 — 다음 확인(매일 00:05) 때 다시 판정합니다.`
      : result.undecided > 0 ? `${head} 결정할 건 ${result.undecided}건이 남아 있습니다.` : `${head} 남은 승인·데스크 환불이 끝나면 처리합니다.`);
    return null;
  });
  const subjectLabel = (k: string) => subjectLabels[k] ?? "기타 과목";
  // 줄의 원장 결정 표시 — 처리 전 보고서만('결정 전'), 정해 둔 '환불 안 함'은 늘. 결정 기록을 못 읽었으면 '결정 확인 못 함'.
  const decisionMark = (key: string) => decision.decisionsFailed ? "결정 기록 확인 못 함" : declined.has(key) ? "환불 안 함(원장 결정)" : decisionOpen && undecided.has(key) ? (canApprove ? "결정 전" : "원장 결정 전") : null;
  // 다른 요청에서 이미 환불을 마친 줄(이 요청에선 결정 대상 · '환불 없음'이면 '환불하지 않음'으로 남는다 — 리뷰 r2 m10).
  const otherDone = open.filter(x => x.line.otherRefund?.completed).length;
  // 환불을 마친 줄의 늘어난 몫 — '환불 없음'이면 그 몫도 환불하지 않음으로 남는다(따로 환불하려면 그 줄의 단추 · 원장 결정 2026-11-09).
  const increase = open.reduce((s, x) => { const o = reopen.get(x.line.key); return o?.separable ? s + o.now - (o.before ?? 0) : s; }, 0);
  return <div id="refund" className="space-y-2" aria-label="환불 확인">
    {lead}
    {decision.failed && <p role="alert" className="text-sm text-destructive">{decision.decisionsFailed ? "환불 결정 기록을 불러오지 못했습니다(새로고침) — 이미 정한 건을 다시 정하지 않게 결정 단추를 막았습니다."
      : "환불 결정 대기 표시를 불러오지 못했습니다(새로고침) — 결정 단추를 막았습니다."}</p>}
    <div><p className="text-xs text-muted-foreground">퇴원월 다음 달부터 잡힌 수납 청구입니다{rows.some(r => r.partial) ? "(과목 수강종료라 끝내는 과목 몫과 기타 항목만)" : ""}. {canApprove
      ? `환불할 건만 토글로 고른 뒤 환불 승인을 누르세요.${waiting ? " 환불할 건이 없으면 '환불 없음'을 누르세요. 원장이 정하기 전에는 퇴원·수강종료를 처리하지 않습니다." : " 고르지 않으면 아무것도 하지 않습니다."}${gates ? " 환불을 승인하면 데스크 환불 처리까지 끝나야 퇴원·수강종료를 처리합니다." : ""}`
      : "환불 승인은 원장만 할 수 있습니다."}</p></div>
    <table className="w-full text-xs">
      <thead><tr className="border-b text-left text-xs text-muted-foreground [&>th]:whitespace-nowrap [&>th]:pr-2"><th className="py-2 font-normal">청구</th><th className="font-normal">청구액</th><th className="font-normal">납부</th><th className="font-normal">상태</th><th className="font-normal">환불요청</th></tr></thead>
      <tbody>{lines.map(({ inv, line }, i) => {
        const re = reopen.get(line.key);
        return <LaterRow key={line.key} inv={inv} line={line} showReissue={inv.status === "void" && !!inv.reissued && (i === 0 || lines[i - 1]!.inv.id !== inv.id)}
          view={{ on: picked.has(line.key), mark: refundable(inv, line) || re ? decisionMark(line.key) : null, re, deduction: deductions.get(line.key), remain: remainOf(line.key, line.paidNet) }}
          canDecide={canDecide} decisionOpen={decisionOpen} pending={pending} subjectLabel={subjectLabel} onToggle={toggle}
          onSeparate={key => { setError(""); setAsking(null); setSeparating(key); }} />;
      })}</tbody>
    </table>
    {canDecide && chosen.length > 0 && !asking && !sepClaim && <div className="flex flex-wrap items-center gap-3">
      <span className="text-sm">선택 {chosen.length}건 · 환불 {won(total)}</span>
      <Button disabled={pending} onClick={() => { setError(""); setDesk(""); setSeparating(null); setAsking("approve"); }}>환불 승인</Button>
    </div>}
    {canDecide && chosen.length === 0 && waiting && !asking && !sepClaim && <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" disabled={pending} onClick={() => { setError(""); setSeparating(null); setAsking("decline"); }}>환불 없음</Button>
    </div>}
    {canDecide && sepClaim && <div className="space-y-3 rounded-lg border bg-muted/20 p-4" role="alertdialog" aria-label="늘어난 몫 따로 환불 확인">
      <p className="text-sm">늘어난 {won(sepClaim.now - (sepClaim.before ?? 0))}은 수납에서 일반 환불 요청서로 따로 환불합니다. 이 건은 &apos;환불하지 않음 — 늘어난 몫은 수납에서 따로 처리&apos;로 남고, 환불을 마친 요청서는 그대로 둡니다. 담당 데스크에게 알림이 갑니다. 정할 건이 더 없고 승인·데스크 환불이 끝났으면 바로 퇴원·수강종료를 처리합니다.</p>
      <div className="flex gap-2"><Button disabled={pending} onClick={() => separate(sepClaim.key)}>{pending ? "처리 중…" : "따로 환불 확인"}</Button><Button variant="outline" disabled={pending} onClick={() => setSeparating(null)}>닫기</Button></div>
    </div>}
    {asking === "approve" && chosen.length > 0 && <div className="space-y-3 rounded-lg border bg-muted/20 p-4" role="alertdialog" aria-label="환불 승인 확인">
      <p className="text-sm">환불을 승인하시겠습니까? 고른 {chosen.length}건 · {won(total)}에 대한 환불 요청서가 만들어지고, 고른 데스크 담당자의 할 일·알림으로 갑니다.{gates ? " 데스크가 환불을 처리(환불완료일자 입력)해야 퇴원·수강종료를 처리합니다." : ""}{unpicked.length ? ` ${unpickedNotice(unpicked.length)}.` : ""}</p>
      <ul className="list-disc pl-5 text-xs text-muted-foreground">{chosen.map(x => { const r = remainOf(x.line.key, x.line.paidNet); return <li key={x.line.key}>{label(x.inv, x.line)} {won(r)}{r < x.line.paidNet ? ` (낸 돈 ${won(x.line.paidNet)} − 이전 환불·따로 환불 ${won(x.line.paidNet - r)})` : ""}</li>; })}</ul>
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
      <p className="text-sm">환불 없음으로 정하시겠습니까? 이 보고서에서 정할 {open.length}건{declined.size ? `(이미 '환불 안 함' ${open.filter(x => declined.has(x.line.key)).length}건 포함)` : ""}을 모두 환불하지 않음으로 기록합니다.{otherDone ? ` 다른 요청에서 이미 환불을 마친 ${otherDone}건도 이 요청에선 '환불하지 않음'으로 남습니다(다시 돌려주지 않습니다).` : ""}{increase ? ` 환불을 마친 줄의 늘어난 몫 ${won(increase)}도 환불하지 않음으로 남습니다 — 수납에서 따로 환불하려면 그 줄의 '늘어난 몫은 수납에서 따로 처리'를 쓰세요.` : ""} 남은 승인·데스크 환불이 끝났으면 바로 퇴원·수강종료를 처리합니다.</p>
      <ul className="list-disc pl-5 text-xs text-muted-foreground">{open.map(x => <li key={x.line.key}>{label(x.inv, x.line)} {won(x.line.paidNet)}</li>)}</ul>
      <div className="flex gap-2"><Button disabled={pending} onClick={decline}>{pending ? "처리 중…" : "환불 없음 확인"}</Button><Button variant="outline" disabled={pending} onClick={() => setAsking(null)}>닫기</Button></div>
    </div>}
    {error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
  </div>;
}
