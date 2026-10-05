"use client";

import type { MakeupCaseDetail } from "../server/read-types";
import { MAKEUP_RECON, MAKEUP_STATE, MAKEUP_EVIDENCE, makeupText } from "../status";
import { CommandForm } from "./command-form";
import { ReasonField, formText } from "./form-fields";
import { ReconciliationDetail } from "./reconciliation-detail";
import { EmbedLink as Link } from "@/components/embed-link";

export function ReconciliationPanel({ detail }: { detail: MakeupCaseDetail }) {
  if (!detail.reconciliation.length && !detail.projection_jobs.length) return null;
  return <ReconciliationItems items={detail.reconciliation} jobs={detail.projection_jobs}
    canResolve={detail.permissions.resolve_reconciliation === true} canAcceptManual={detail.permissions.accept_manual_units === true} />;
}

export function ReconciliationItems({ items, jobs, canResolve, canAcceptManual }: {
  items: MakeupCaseDetail["reconciliation"]; jobs: MakeupCaseDetail["projection_jobs"];
  canResolve: boolean; canAcceptManual: boolean;
}) {
  return <section className="border-line space-y-3 rounded-lg border p-4"><h2 className="font-bold">대사·기록 반영</h2>
    <p className="text-sm">시수·출결·보고서 차이를 확인한 뒤 처리합니다. 미처리 항목이 남으면 종결할 수 없습니다.</p>
    {items.map(item => <div key={String(item.id)} className="border-line space-y-2 border-t pt-3">
      <p>{makeupText(MAKEUP_RECON, String(item.kind))} · {item.state === "open" ? "미처리" : "처리됨"}</p>
      {typeof item.summary === "string" ? <p className="whitespace-pre-wrap text-sm">{item.summary}</p> : null}
      <ReconciliationDetail kind={item.kind} value={item.detail} restricted={item.restricted === true} />
      <RelatedCases item={item} />
      {item.kind === "units_review" || item.kind === "units_mismatch" ? <p className="text-sm">출석부에서 실제 시수·담당 강사를 확인하고 필요한 정정을 먼저 저장해 주세요.</p> : null}
      {canResolve && item.state === "open" ? <CommandForm action="resolve_reconciliation" revision={item.revision} label="대사 확인·처리" payload={data => ({ reconciliation_id: item.id, reason: formText(data, "reason"),
        ...(data.get("accept_manual_units") === "on" ? { accept_manual_units: true } : {}),
      })}>
        {canAcceptManual && ["units_review", "units_mismatch"].includes(String(item.kind)) ? <label className="flex min-h-10 items-center gap-2">
          <input type="checkbox" name="accept_manual_units" /><span>현재 수기 시수를 확인하고 차이를 승인</span>
        </label> : null}
        <ReasonField label="확인 근거·조치 내용" />
      </CommandForm> : null}
    </div>)}
    {jobs.map(job => <div key={String(job.id)} className="border-line space-y-2 border-t pt-3">
      <p>기록 반영 · {makeupText(MAKEUP_STATE, String(job.state))}</p>
      {typeof job.last_error === "string" ? <p className="text-sm">{MAKEUP_EVIDENCE[job.last_error] ?? "연결된 출결·보고서·실시 근거를 확인해 주세요."}</p> : null}
      <RelatedCases item={job} />
      {canResolve && ["pending", "failed"].includes(String(job.state)) ? <CommandForm action="resolve_reconciliation" revision={job.revision} label="출결·시수 반영 다시 확인" payload={data => ({ projection_id: job.id, reason: formText(data, "reason") })}>
        <ReasonField label="재반영 사유" />
      </CommandForm> : null}
    </div>)}
  </section>;
}

function RelatedCases({ item }: { item: Record<string, unknown> }) {
  const ids = [item.case_id, ...(Array.isArray(item.case_ids) ? item.case_ids : [])];
  const validIds = [...new Set(ids.filter((id): id is string => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))];
  return <div className="flex flex-wrap gap-3">{validIds.map((id, index) =>
    <Link key={id} href={`/makeups/${id}`} className="text-primary inline-block min-h-6 underline">연결된 보강 {index + 1} 보기</Link>)}</div>;
}
