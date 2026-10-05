"use client";

import type { MakeupCaseDetail, MakeupFulfillment } from "../server/read-types";
import { CommandForm } from "./command-form";
import { ReasonField, TextField, formText } from "./form-fields";
import { MAKEUP_STATE, makeupText } from "../status";

export function FulfillmentReview({ fulfillment, detail, actorId }: { fulfillment: MakeupFulfillment; detail: MakeupCaseDetail; actorId: string }) {
  const allocations = detail.allocations.filter(row => row.participant_id === fulfillment.participant_id);
  const isConductor = fulfillment.actual_teacher_id === actorId;
  return <div className="border-line space-y-3 border-t pt-3">
    <p className="font-medium">실시 검토 · {makeupText(MAKEUP_STATE, fulfillment.state)} · 실제 {fulfillment.actual_minutes ?? "미정"}분</p>
    <p className="whitespace-pre-wrap text-sm">{fulfillment.learning_summary || "지도 근거 미기록"}</p>
    {fulfillment.homework ? <p className="whitespace-pre-wrap text-sm">과제 · {fulfillment.homework}</p> : null}
    {fulfillment.return_reason ? <p className="text-sm">보완 요청 · {fulfillment.return_reason}</p> : null}
    {isConductor && fulfillment.state === "submitted" ? <p className="text-sm">실시한 사람이 같은 건을 검토할 수 없습니다. 다른 검토자에게 확인을 요청해 주세요.</p> : null}
    {detail.permissions.verify && !isConductor && fulfillment.state === "submitted" ? <>
      <CommandForm action="verify" revision={fulfillment.revision} label="실시 인정" payload={data => ({ fulfillment_id: fulfillment.id,
        recognitions: [...data.entries()].filter(([key]) => key.startsWith("recognition:")).map(([key, value]) => ({ case_id: key.slice(12), minutes: Number(value) })),
        reason: formText(data, "reason"), release_remainder: true,
      })}>
        {allocations.map(row => <TextField key={String(row.id)} name={`recognition:${row.case_id}`}
          label={`원수업 ${typeof row.original_date === "string" ? row.original_date : "배정 건"} 인정(분)`} type="number" min={0} step={1}
          max={Number(row.allocated_minutes) - Number(row.released_minutes || 0)} required />)}
        <ReasonField label="검토 근거" />
        <p className="text-sm">인정량 합계는 실제 지도 분량을 넘을 수 없습니다. 미실시 잔여 배정은 함께 해제합니다.</p>
      </CommandForm>
      <CommandForm action="verify" revision={fulfillment.revision} label="보완 요청" payload={data => ({ fulfillment_id: fulfillment.id, status: "returned", reason: formText(data, "reason") })}>
        <ReasonField label="보완할 내용" />
      </CommandForm>
    </> : null}
    {detail.permissions.reverse && fulfillment.state === "verified" ? <details><summary className="min-h-6 cursor-pointer">인정 정정</summary>
      <CommandForm action="reverse" revision={fulfillment.revision} label="인정 반전" payload={data => ({ fulfillment_id: fulfillment.id, reason: formText(data, "reason") })}>
        <ReasonField /><p className="text-sm">원 인정 배분을 복원합니다. 출결·급여·취소한 좌석은 자동 변경하지 않습니다.</p>
      </CommandForm>
    </details> : null}
  </div>;
}
