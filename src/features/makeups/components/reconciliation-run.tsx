"use client";

import { CommandForm } from "./command-form";
import { ReasonField, formText } from "./form-fields";

const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "확인 필요";
const states: Record<string, string> = { running: "진행 중", succeeded: "완료", completed: "완료", done: "완료", failed: "실패" };
export function ReconciliationRun({ lastRun, canRun }: { lastRun: Record<string, unknown> | null; canRun: boolean }) {
  return <section className="border-line space-y-3 rounded-lg border p-4">
    <h2 className="font-bold">대사 실행 상태</h2>
    {lastRun ? <dl className="grid gap-3 sm:grid-cols-3">
      <div><dt>최근 실행</dt><dd>{text(lastRun.started_at)}</dd></div>
      <div><dt>결과</dt><dd>{states[text(lastRun.status)] ?? "확인 필요"}</dd></div>
      <div><dt>검사·발견</dt><dd>{text(lastRun.checked)}건 · {text(lastRun.opened)}건</dd></div>
    </dl> : <p>아직 실행 기록이 없습니다.</p>}
    {lastRun?.status === "failed" ? <p role="alert">최근 대사를 완료하지 못했습니다. 다시 실행하여 미처리 업무를 확인해 주세요.</p> : null}
    {canRun ? <details><summary className="min-h-6 cursor-pointer font-medium">현재 기록 다시 대사</summary>
      <CommandForm action="reconcile" label="대사 실행" payload={data => ({ reason: formText(data, "reason") })}>
        <ReasonField label="대사 실행 사유" /><p className="text-sm">출결·시수·잔량을 비교해 확인 항목을 만듭니다. 시수나 인정량을 자동 변경하지 않습니다.</p>
      </CommandForm>
    </details> : null}
  </section>;
}
