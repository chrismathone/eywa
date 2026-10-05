"use client";

import type { MakeupCaseDetail } from "../server/read-types";
import { CommandForm } from "./command-form";
import { OptionPicker } from "./option-picker";
import { ReasonField, TextField, formMinutes, formText } from "./form-fields";
import { MAKEUP_CLOSURE } from "../status";
import { useState } from "react";
import { MergeCasePicker } from "./merge-case-picker";

export function CaseDecisions({ detail }: { detail: MakeupCaseDetail }) {
  const [closure, setClosure] = useState("completed");
  const row = detail.case, permissions = detail.permissions;
  const base = { case_id: row.id };
  return <div className="grid items-start gap-4 lg:grid-cols-2">
    {permissions.approve && row.eligibility === "pending" ? <section className="border-line space-y-3 rounded-lg border p-4">
      <h2 className="font-bold">자격·분량 승인</h2>
      <CommandForm action="approve" revision={row.revision} label="분량 승인" payload={data => ({ ...base,
        target_minutes: formMinutes(data, "target_minutes"), note: formText(data, "note"),
        ...(formText(data, "policy_version_id") ? { policy_version_id: formText(data, "policy_version_id") } : {}),
      })}>
        <TextField name="target_minutes" label="승인 분량(분)" type="number" min={1} step={1} required />
        <OptionPicker kind="policies" name="policy_version_id" label="정책 버전" />
        <p className="text-sm">정책을 선택하지 않으면 분 단위·자동 소멸 없음·실시 검토 기준의 기본 정책을 승인 기록에 고정합니다.</p>
        <ReasonField name="note" label="승인 근거" />
      </CommandForm>
    </section> : null}
    {permissions.assign ? <section className="border-line space-y-3 rounded-lg border p-4"><h2 className="font-bold">담당·기한 지정</h2>
      <CommandForm action="assign" revision={row.revision} label="담당·기한 저장" payload={data => ({ ...base,
        owner_id: formText(data, "owner_id") || null,
        ...(permissions.adjust || row.eligibility === "pending" ? { due_date: formText(data, "due_date") || null } : {}),
        reason: formText(data, "reason"),
      })}>
        <OptionPicker kind="staff" name="owner_id" label="다음 업무 담당" initial={row.owner_id ? { id: row.owner_id, name: row.owner_name ?? "현재 담당" } : undefined} />
        {permissions.adjust || row.eligibility === "pending" ? <TextField name="due_date" label="처리 기한" type="date" initial={row.due_date ?? ""} /> : <p>처리 기한 {row.due_date ?? "미지정"}</p>}
        <ReasonField label="담당·기한 지정 사유" />
      </CommandForm>
    </section> : null}
    {permissions.deny && row.eligibility === "pending" ? <details className="border-line rounded-lg border p-4"><summary className="min-h-6 cursor-pointer font-bold">자격 거절</summary>
      <CommandForm action="deny" revision={row.revision} label="자격 거절" payload={data => ({ ...base, reason: formText(data, "reason") })}><ReasonField /></CommandForm>
    </details> : null}
    {permissions.waive && row.eligibility === "approved" ? <details className="border-line rounded-lg border p-4"><summary className="min-h-6 cursor-pointer font-bold">미실시 분량 면제</summary>
      <CommandForm action="waive" revision={row.revision} label="분량 면제" payload={data => ({ ...base, minutes: formMinutes(data, "minutes"), reason: formText(data, "reason") })}>
        <TextField name="minutes" label="면제 분량(분)" type="number" min={1} step={1} required /><ReasonField />
      </CommandForm>
    </details> : null}
    {permissions.adjust && row.eligibility === "approved" ? <details className="border-line rounded-lg border p-4"><summary className="min-h-6 cursor-pointer font-bold">목표 분량 조정</summary>
      <CommandForm action="adjust" revision={row.revision} label="분량 조정" payload={data => ({ ...base, minutes: formMinutes(data, "minutes"), reason: formText(data, "reason") })}>
        <TextField name="minutes" label="증감 분량(분) · 줄일 때 음수" type="number" step={1} required /><ReasonField />
      </CommandForm>
    </details> : null}
    {permissions.hold && row.lifecycle === "open" ? <details className="border-line rounded-lg border p-4"><summary className="min-h-6 cursor-pointer font-bold">보류</summary>
      <CommandForm action="hold" revision={row.revision} label="보류" payload={data => ({ ...base, reason: formText(data, "reason"), hold_review_at: formText(data, "hold_review_at") || null })}>
        <TextField name="hold_review_at" label="다시 검토할 날짜" type="date" required /><ReasonField />
      </CommandForm>
    </details> : null}
    {permissions.resume && row.lifecycle === "on_hold" ? <CommandForm action="resume" revision={row.revision} label="진행 재개" payload={() => base}><p>잔량·기존 약속을 유지하고 진행을 재개합니다.</p></CommandForm> : null}
    {permissions.close && row.lifecycle !== "closed" ? <details className="border-line rounded-lg border p-4"><summary className="min-h-6 cursor-pointer font-bold">종결</summary>
      <CommandForm action="close" revision={row.revision} label="종결" payload={data => ({ ...base, closure_reason: formText(data, "closure_reason"),
        ...(closure === "duplicate" ? { merged_into: formText(data, "merged_into") } : {}), reason: formText(data, "reason") })}>
        <label className="block space-y-1"><span className="block font-medium">종결 구분</span>
          <select name="closure_reason" value={closure} onChange={event => setClosure(event.target.value)} className="border-line min-h-10 w-full rounded-md border bg-white px-2" required>
            {Object.entries(MAKEUP_CLOSURE).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>{closure === "duplicate" ? <MergeCasePicker row={row} /> : null}<ReasonField /><p className="text-sm">예약·미검토 실시·미처리 대사가 남아 있으면 종결할 수 없습니다.</p>
      </CommandForm>
    </details> : null}
  </div>;
}
