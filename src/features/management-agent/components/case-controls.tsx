"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { RESULT_LABEL, type AgentCase, type ResultKind } from "../model";
import { changeManagementCase } from "../server/actions";
import { generateManagementAdvice } from "../server/advice-action";
import type { CaseCommand } from "../validation";

const field = "border-line w-full rounded-lg border bg-card p-3 text-sm";
export function CaseControls({ row, manager }: { row: AgentCase; manager: boolean }) {
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ResultKind>("contacted");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const closed = row.status === "resolved" || row.status === "dismissed";
  const blocked = row.status === "blocked";
  function submit(command: CaseCommand["command"]) {
    start(async () => {
      try {
        const response = await changeManagementCase({ caseId: row.id, version: row.version, command, result, note, nextCheckOn: next || null });
        setMessage(response.error ?? response.message ?? "");
        if (!response.error) { setNote(""); router.refresh(); }
      } catch { setMessage("저장하지 못했습니다. 다시 시도해 주세요."); }
    });
  }
  return <div className="space-y-3">
    {!closed && !blocked && !row.acknowledged_at ? <Button disabled={pending} onClick={() => submit("acknowledge")}>업무 접수</Button> : null}
    {blocked ? <p className="text-sm">원본 상담을 확인하거나, 관리자가 사유를 기록해 조치 불필요로 종료해 주세요.</p> : null}
    {(!closed || manager) ? <>
      {!closed && !blocked ? <fieldset disabled={pending} className="flex flex-wrap gap-3">
        <legend className="mb-2 text-sm font-bold">처리 결과</legend>
        {(Object.entries(RESULT_LABEL) as [ResultKind,string][]).map(([value,label]) => <label key={value} className="flex items-center gap-2 text-sm">
          <input type="radio" name={`result-${row.id}`} checked={result === value} onChange={() => setResult(value)} />{label}
        </label>)}
      </fieldset> : null}
      {!closed && result === "retry" ? <label className="block text-sm">다음 연락일
        <input type="date" className={field} value={next} disabled={pending} onChange={(e) => setNext(e.target.value)} />
      </label> : null}
      <label className="block space-y-1 text-sm"><span>처리 내용 또는 판단 근거</span>
        <textarea className={field} rows={3} maxLength={1000} disabled={pending} value={note} onChange={(e) => setNote(e.target.value)} placeholder="연락 결과, 다음 조치 또는 확인한 근거를 적어 주세요." />
      </label>
      <div className="flex flex-wrap gap-2">
        {!closed && !blocked ? <Button disabled={pending} onClick={() => submit("submit")}>처리 결과 저장</Button> : null}
        {manager && !closed ? <>
          <Button variant="outline" disabled={pending || row.status !== "waiting_review" || row.result_kind !== "contacted" || !row.source_done} onClick={() => submit("verify")}>근거 확인 후 종료</Button>
          <Button variant="outline" disabled={pending} onClick={() => submit("dismiss")}>조치 불필요로 종료</Button>
        </> : null}
        {manager && closed ? <Button variant="outline" disabled={pending} onClick={() => submit("reopen")}>사유 기록 후 다시 열기</Button> : null}
      </div>
    </> : null}
    {!closed && !blocked ? <Button variant="outline" disabled={pending} onClick={() => start(async () => {
      try { const response = await generateManagementAdvice(row.id); setMessage(response.error ?? response.message ?? ""); if (!response.error) router.refresh(); }
      catch { setMessage("대응안을 작성하지 못했습니다. 다시 시도해 주세요."); }
    })}>AI 대응안 확인</Button> : null}
    <p className="text-text-dim text-xs">완료 체크와 처리 결과를 확인한 뒤 관리자가 종료합니다. 등록 전환이나 문제 해결을 자동으로 단정하지 않습니다.</p>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
  </div>;
}
