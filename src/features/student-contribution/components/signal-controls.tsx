"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { changePositiveSignal } from "../server/actions";
import type { DisplaySignal } from "../server/signal-display";
import { ListPager } from "./list-pager";
import { fieldClass } from "./presentation";
const labels = { observed: "관찰된 긍정 신호", unsupported_praise: "구체적 관찰 없는 칭찬", thanks: "감사 표현", other: "그 외 내용" };
export function SignalControls({ signals, canWrite }: { signals: DisplaySignal[]; canWrite: boolean }) {
  const [filter, setFilter] = useState("all"), [page, setPage] = useState(1), [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState(""), [message, setMessage] = useState(""), [busy, start] = useTransition();
  const router = useRouter();
  const act = (id: string, operation: "cancel" | "rejudge") => start(async () => {
    const r = await changePositiveSignal({ id, operation, reason }); setMessage(r.error ?? r.message ?? "");
    if (!r.error) { setSelected(null); setReason(""); } router.refresh();
  });
  const rows = signals.filter((s) => filter === "all" || (filter === "cancelled" ? !!s.cancelled_at : s.classification === "observed" && !s.cancelled_at)).sort((a, b) => b.occurred_on.localeCompare(a.occurred_on));
  const current = Math.min(page, Math.max(1, Math.ceil(rows.length / 8)));
  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><p className="text-sm leading-relaxed">글에서 확인한 구체적인 관찰 내용만 점수에 반영합니다.<br />글이 수정되어도 자동으로 다시 판정하지 않으며, 재판정 요청은 야간 집계에서 처리합니다.</p>
      <select aria-label="긍정 신호 상태" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); setSelected(null); setReason(""); }} className={fieldClass}><option value="all">전체 판정</option><option value="observed">인정된 긍정 신호</option><option value="cancelled">취소된 판정</option></select></div>
    {message && <p role="status" className="rounded-lg bg-primary-softer p-3 text-sm">{message}</p>}
    <ul className="divide-y divide-line">{rows.slice((current - 1) * 8, current * 8).map((s) => <li key={s.id} className="py-4 text-sm">
      <div className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-start gap-4 phone:grid-cols-1">
        <p className="tabular-nums">{s.occurred_on}<span className="mt-1 block text-xs">{s.source === "parent" ? "학부모 글" : "선생님 답글"}</span></p>
        <div className="space-y-2"><p className="font-semibold">{s.author_label ?? (s.source === "parent" ? "학부모" : "선생님")} <span className="ml-2 rounded bg-secondary px-2 py-1 text-xs font-normal">{labels[s.classification]}{s.cancelled_at ? " · 취소됨" : ""}</span></p>
          {s.evidence && <blockquote className="bg-bg-soft/60 rounded-md px-3 py-2 leading-relaxed">{s.evidence}</blockquote>}
          {s.evidenceStatus !== "current" && <p className="text-xs">{s.evidenceStatus === "changed" ? "원문이 바뀌어 이전 인용문을 표시하지 않습니다." : "현재 원문을 확인할 수 없어 인용문을 표시하지 않습니다."}</p>}
          <p className="text-xs">{s.model_label ? "AI 판정" : "규칙 판정"} · {new Date(s.judged_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}{s.cancel_reason ? ` · 취소 사유: ${s.cancel_reason}` : ""}{s.rejudge_requested_at ? " · 재판정 대기" : ""}</p></div>
        {canWrite && <Button size="sm" variant="outline" disabled={busy} aria-expanded={selected === s.id} onClick={() => { setSelected(selected === s.id ? null : s.id); setReason(""); }}>판정 검토</Button>}
      </div>
      {canWrite && selected === s.id && <div className="mt-3 space-y-3 rounded-lg bg-secondary p-4"><label className="block">취소·재판정 사유<input aria-label="취소·재판정 사유" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="확인한 내용을 2자 이상 적어 주세요" className={`${fieldClass} mt-2 w-full`} /></label>
        <div className="flex flex-wrap gap-2">{!s.cancelled_at && s.classification === "observed" && <Button size="sm" variant="outline" disabled={busy || reason.trim().length < 2} onClick={() => act(s.id, "cancel")}>판정 취소</Button>}
          <Button size="sm" variant="outline" disabled={busy || !!s.rejudge_requested_at || reason.trim().length < 2} onClick={() => act(s.id, "rejudge")}>재판정 요청</Button></div></div>}
    </li>)}</ul>
    {!rows.length && <p className="py-8 text-center text-sm">조건에 맞는 판정이 없습니다. 새로운 글의 AI 판정은 야간 집계 후 확인할 수 있습니다.</p>}
    <ListPager page={current} total={rows.length} pageSize={8} onChange={(next) => { setPage(next); setSelected(null); setReason(""); }} label="긍정 신호" />
  </div>;
}
