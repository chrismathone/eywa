"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { EVIDENCE_KIND_LABEL, type CareCommand } from "../model";
import type { CareEvidenceOption } from "../server/actions";
import type { CareCommitmentView } from "../server/explore";

/** 연결 탐색 '약속·할 일'의 두 창 — 이행 기록 추가 · 완료 확인. 저장은 부모가(같은 saveCare). */
export const CARE_TEXTAREA = "border-input focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-lg border bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:ring-3";

export type EvidenceOptionsState =
  | { status: "loading" }
  | { status: "ready"; options: CareEvidenceOption[]; warning: string | null }
  | { status: "error"; error: string };

export function CareEvidenceDialog({ commitment, options, busy, error, onClose, onSave }: {
  commitment: CareCommitmentView; options: EvidenceOptionsState; busy: boolean; error: string | null;
  onClose: () => void; onSave: (command: CareCommand) => void;
}) {
  const [picked, setPicked] = useState("");
  const [note, setNote] = useState("");
  // 이번 버전에 이미 이은 기록은 고르지 않는다(서버도 막는다 — model.ts '이번 버전에 이미 연결된 기록').
  const linked = new Set(commitment.evidence.map((e) => `${e.kind}:${e.recordId}`));
  const choices = options.status === "ready" ? options.options.filter((o) => !linked.has(`${o.kind}:${o.id}`)) : [];
  const selected = choices.find((o) => `${o.kind}:${o.id}` === picked) ?? null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>이행 기록 추가</DialogTitle>
          <DialogDescription>
            ‘{commitment.promise}’ — 이 원생의 최근 상담·수업보고서·강사 시트 기록 하나를 골라 이번 버전(v{commitment.revision})의 기록으로 잇습니다.
          </DialogDescription>
        </DialogHeader>
        {options.status === "loading" ? <p className="text-text-dim text-sm" role="status">기록 목록을 불러오는 중…</p> : null}
        {options.status === "error" ? <p className="text-danger text-sm" role="alert">{options.error}</p> : null}
        {options.status === "ready" ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (selected && note.trim()) onSave({ kind: "evidence", evidence: { kind: selected.kind, recordId: selected.id, note } });
            }}
          >
            {options.warning ? <p className="text-danger text-sm" role="alert">{options.warning}</p> : null}
            {choices.length === 0 ? (
              <p className="text-text-dim text-sm">이을 수 있는 최근 기록이 없습니다. 종류별 최근 50건 중 이 약속에 아직 잇지 않은 기록만 보입니다.</p>
            ) : (
              <label className="flex flex-col gap-1 text-sm font-medium">
                이을 기록
                <SearchableSelect
                  portal
                  ariaLabel="이을 기록"
                  placeholder="상담·수업보고서·강사 시트 기록 선택"
                  value={picked}
                  onValueChange={setPicked}
                  options={choices.map((o) => ({ value: `${o.kind}:${o.id}`, label: o.label, group: EVIDENCE_KIND_LABEL[o.kind] }))}
                />
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm font-medium">
              약속의 이행을 보여 주는 내용
              <textarea required maxLength={1000} rows={3} className={CARE_TEXTAREA} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {error ? <p className="text-danger text-sm" role="alert">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>닫기</Button>
              <Button type="submit" disabled={busy || !selected || !note.trim()}>{busy ? "저장 중…" : "기록 잇기"}</Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function CareCompleteDialog({ commitment, busy, error, onClose, onSave }: {
  commitment: CareCommitmentView; busy: boolean; error: string | null; onClose: () => void; onSave: (command: CareCommand) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>이행 확인·완료</DialogTitle>
          <DialogDescription>완료하면 약속 v{commitment.revision}이 닫히고 감사로그에 남습니다. 새 요구는 새 버전으로 엽니다.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); if (reason.trim()) onSave({ kind: "complete", reason }); }}>
          <p className="text-base font-bold">{commitment.promise}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="font-bold">담당</dt><dd>{commitment.ownerName ?? "담당자 미정"} · {commitment.subject || "공통"} · 인수 확인됨</dd>
            <dt className="font-bold">목표일</dt><dd className="num">{commitment.dueOn}</dd>
            <dt className="font-bold">완료 확인 기준</dt><dd className="whitespace-pre-wrap">{commitment.criterion}</dd>
            <dt className="font-bold">이행 기록</dt><dd>{commitment.evidence.length}건 · {[...new Set(commitment.evidence.map((e) => e.kindLabel))].join(", ")}</dd>
          </dl>
          <label className="flex flex-col gap-1 text-sm font-medium">
            완료 확인 사유
            <textarea required maxLength={1000} rows={3} className={CARE_TEXTAREA} value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {error ? <p className="text-danger text-sm" role="alert">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>닫기</Button>
            <Button type="submit" disabled={busy || !reason.trim()}>{busy ? "저장 중…" : "완료 처리"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
