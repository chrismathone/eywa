"use client";

import { useState } from "react";
import { kstShortStamp } from "@/lib/date-kst";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { WindowLink } from "@/components/workspace/window-link";
import { CARE_EVENT_LABEL, EVIDENCE_KIND_LABEL, careStatus, evidenceHref, type CareCommand, type CareRecord } from "../model";
import type { StudentCareView } from "../server/queries";
import { getCareHistory } from "../server/actions";
import { CareContentForm } from "./care-content-form";
import { CARE_TEXTAREA } from "./care-explore-dialogs";

const isSheet = (kind: string) => kind === "english_sheet" || kind === "math_sheet";

export function CareCard({ record, view, busy, onSave }: { record: CareRecord; view: StudentCareView; busy: boolean; onSave: (command: CareCommand) => void }) {
  const [edit, setEdit] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState<Awaited<ReturnType<typeof getCareHistory>> | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const doc = record.document;
  const state = careStatus(doc, view.today, view.student?.enrolledOn ?? null);
  const own = doc.content.ownerId === view.actor.id;
  const canSubmit = doc.state === "open" && (view.actor.canManage || (own && view.actor.canContribute));
  const owner = view.staff.find((s) => s.id === doc.content.ownerId)?.name ?? (own ? "나" : "배정된 담당자");
  const visible = (item: { kind: CareRecord["document"]["evidence"][number]["kind"]; recordId: string }) =>
    isSheet(item.kind) ? view.references.evidence.some((r) => r.kind === item.kind && r.id === item.recordId) : view.references.evidenceKinds.includes(item.kind);
  return (
    <article className="bg-card border-line shadow-card flex flex-col gap-4 rounded-2xl border p-4" aria-label={doc.content.promise}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{doc.content.promise}</h2>
        <span className="text-text-dim text-sm">v{doc.revision} · {doc.state === "completed" ? "확인 완료" : doc.state === "cancelled" ? "취소" : "진행 중"}</span>
      </div>
      <p className="text-sm">{owner} · {doc.content.subject || "공통"} · 목표일 <span className="num">{doc.content.dueOn}</span></p>
      <p className="text-sm">{state.handoffPending ? "인수 확인 대기" : doc.acknowledged ? "담당자 인수 확인됨" : "인수 기록 없음"}{state.overdue ? " · 기한 경과" : ""}{state.continuing ? " · 90일 이후 계속 관리" : ""}</p>
      <dl className="flex flex-col gap-1 text-sm">
        <dt className="font-bold">학부모 요구</dt><dd className="whitespace-pre-wrap">{doc.content.need}</dd>
        <dt className="font-bold">완료 확인 기준</dt><dd className="whitespace-pre-wrap">{doc.content.criterion}</dd>
      </dl>
      {doc.content.sourceId && view.references.sources.some((s) => s.id === doc.content.sourceId) ? <WindowLink className="text-primary text-sm font-semibold hover:underline" href={`/enrollment/${doc.content.sourceId}`}>입학상담 원본</WindowLink> : null}
      {own && view.actor.canContribute && state.handoffPending ? <Button className="self-start" disabled={busy} onClick={() => onSave({ kind: "acknowledge" })}>내용 확인·인수</Button> : null}
      <section aria-label="이행 증거" className="flex flex-col gap-2 text-sm">
        <h3 className="font-bold">이번 버전의 이행 증거 {state.currentEvidence.length}건</h3>
        {state.currentEvidence.map((item) => (
          <div key={`${item.kind}:${item.recordId}`} className="border-line-faint rounded-lg border px-2 py-1.5">
            {visible(item) ? <WindowLink className="text-primary font-semibold hover:underline" href={evidenceHref(item.kind, item.recordId)}>{EVIDENCE_KIND_LABEL[item.kind]} 원본</WindowLink>
              : isSheet(item.kind) ? <WindowLink className="text-primary font-semibold hover:underline" href={evidenceHref(item.kind, item.recordId)}>이전 {EVIDENCE_KIND_LABEL[item.kind]} 기록 확인</WindowLink>
              : <span>{EVIDENCE_KIND_LABEL[item.kind]} · 원본 열람 권한 없음</span>}
            <p className="whitespace-pre-wrap">{item.note}</p>
          </div>
        ))}
        {canSubmit && view.student ? (
          <form className="flex flex-col gap-2" onSubmit={(e) => {
            e.preventDefault();
            const selected = view.references.evidence.find((r) => `${r.kind}:${r.id}` === evidence);
            if (selected) onSave({ kind: "evidence", evidence: { kind: selected.kind, recordId: selected.id, note } });
          }}>
            <label className="flex flex-col gap-1 font-medium">증거로 연결할 기록
              <SearchableSelect ariaLabel="증거로 연결할 기록" placeholder="이 학생의 최근 상담·수업·개별 진도 선택" value={evidence} onValueChange={setEvidence}
                options={view.references.evidence.map((r) => ({ value: `${r.kind}:${r.id}`, label: r.label, group: EVIDENCE_KIND_LABEL[r.kind] }))} />
            </label>
            <label className="flex flex-col gap-1 font-medium">약속의 이행을 보여 주는 내용
              <textarea required maxLength={1000} rows={2} className={CARE_TEXTAREA} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <Button type="submit" variant="outline" className="self-start" disabled={busy || !evidence || !note.trim()}>증거 제출</Button>
            <p className="text-text-dim">종류별 최근 50건을 표시합니다. 반 전체 계획은 제외합니다. 증거 제출 후 관리자가 완료 기준을 확인합니다.</p>
          </form>
        ) : null}
      </section>
      {doc.closed ? <p className="text-sm">처리 사유: {doc.closed.reason}</p> : null}
      {view.actor.canManage && doc.state === "open" ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-sm font-medium">완료 확인 또는 취소 사유
            <textarea maxLength={1000} rows={2} className={CARE_TEXTAREA} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !reason.trim() || !doc.acknowledged || !state.currentEvidence.length} onClick={() => onSave({ kind: "complete", reason })}>이행 확인·완료</Button>
            <Button variant="outline" disabled={busy || !reason.trim()} onClick={() => onSave({ kind: "cancel", reason })}>사유 남기고 취소</Button>
          </div>
          {!doc.acknowledged || !state.currentEvidence.length ? <p className="text-text-dim text-sm">담당자 인수 확인과 이번 버전의 증거 제출 후 완료할 수 있습니다.</p> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3 text-sm">
        {view.actor.canManage ? <Button variant="link" className="px-0" onClick={() => setEdit(!edit)}>{edit ? "변경 닫기" : "내용·담당자 변경"}</Button> : null}
        <Button variant="link" className="px-0" disabled={historyBusy} onClick={async () => {
          setHistoryBusy(true);
          try { setHistory(await getCareHistory(view.intake ? { intakeId: view.intake.id } : record.studentId!, record.id)); } catch { setHistory({ error: "변경 이력을 불러오지 못했습니다", events: [] }); } finally { setHistoryBusy(false); }
        }}>{historyBusy ? "불러오는 중…" : "변경 이력 · 최근 100건"}</Button>
      </div>
      {edit ? <CareContentForm view={view} initial={doc.content} sourceLocked={!!record.intakeId} busy={busy} onSave={(content, reason) => onSave({ kind: "revise", content, reason })} /> : null}
      {history ? (
        <div className="text-text-dim flex flex-col gap-2 text-sm" aria-label="변경 이력">
          {history.error ? <p role="alert">{history.error}</p> : history.events.map((event) => (
            <div key={event.version}>
              <p>저장 {event.version} · {CARE_EVENT_LABEL[event.kind] ?? "변경"} · {kstShortStamp(event.created_at)} {event.reason}</p>
              <p>{event.document?.content?.promise} · 목표일 {event.document?.content?.dueOn}</p>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}
