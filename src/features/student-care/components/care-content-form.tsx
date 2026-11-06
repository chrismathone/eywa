"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import type { CareContent } from "../model";
import type { StudentCareView } from "../server/queries";
import { CARE_TEXTAREA } from "./care-explore-dialogs";

const NO_SOURCE = "__none__";

export function CareContentForm({ view, initial, sourceLocked, busy, onSave }: {
  view: StudentCareView; initial?: CareContent; sourceLocked?: boolean; busy: boolean; onSave: (content: CareContent, reason: string) => void;
}) {
  const [content, setContent] = useState<CareContent>(initial ?? { need: "", promise: "", criterion: "", dueOn: "", ownerId: "", subject: "", sourceId: view.intake?.id ?? null });
  const [reason, setReason] = useState("");
  const patch = (key: keyof CareContent, value: string | null) => setContent((current) => ({ ...current, [key]: value }));
  const sourceOptions = [
    { value: NO_SOURCE, label: "직접 기록 · 연결 원본 없음" },
    ...view.references.sources.map((source) => ({ value: source.id, label: `${source.date} · ${source.need.slice(0, 45) || "상담 내용 없음"}` })),
    ...(initial?.sourceId && !view.references.sources.some((s) => s.id === initial.sourceId) ? [{ value: initial.sourceId, label: "기존 연결 원본" }] : []),
  ];
  return (
    <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); onSave(content, reason); }}>
      <label className="flex flex-col gap-1 text-sm font-medium">
        입학상담 원본
        <SearchableSelect
          ariaLabel="입학상담 원본"
          disabled={!!view.intake || sourceLocked}
          value={content.sourceId ?? NO_SOURCE}
          onValueChange={(v) => patch("sourceId", v === NO_SOURCE ? null : v)}
          options={sourceOptions}
        />
      </label>
      {content.sourceId ? (
        <Button
          type="button"
          variant="link"
          className="self-start px-0"
          disabled={!view.references.sources.some((s) => s.id === content.sourceId)}
          onClick={() => {
            const source = view.references.sources.find((s) => s.id === content.sourceId);
            if (source) patch("need", source.need);
          }}
        >
          선택한 상담 내용을 요구사항에 가져오기
        </Button>
      ) : null}
      <label className="flex flex-col gap-1 text-sm font-medium">학부모 요구사항
        <textarea required maxLength={3000} rows={3} className={CARE_TEXTAREA} value={content.need} onChange={(e) => patch("need", e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">학원에서 약속한 내용
        <textarea required maxLength={2000} rows={2} className={CARE_TEXTAREA} value={content.promise} onChange={(e) => patch("promise", e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">완료를 확인할 기준
        <textarea required maxLength={1000} rows={2} className={CARE_TEXTAREA} value={content.criterion} onChange={(e) => patch("criterion", e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm font-medium">목표일
          <Input required type="date" value={content.dueOn} onChange={(e) => patch("dueOn", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">담당자
          <SearchableSelect
            ariaLabel="담당자"
            placeholder="담당자 선택"
            value={content.ownerId}
            onValueChange={(v) => patch("ownerId", v)}
            options={view.staff.map((staff) => ({ value: staff.id, label: staff.name }))}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">과목·분야
          <Input maxLength={60} value={content.subject} onChange={(e) => patch("subject", e.target.value)} />
        </label>
      </div>
      {initial ? (
        <label className="flex flex-col gap-1 text-sm font-medium">변경 사유
          <textarea required maxLength={1000} rows={2} className={CARE_TEXTAREA} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      ) : null}
      {initial ? <p className="text-text-dim text-sm">변경하면 새 버전으로 열립니다. 담당자 인수와 이행 증거를 다시 확인합니다.</p> : null}
      <Button type="submit" className="self-start" disabled={busy || view.staffError || !content.ownerId}>
        {busy ? "저장 중…" : initial ? "새 버전 저장" : "약속 등록·인계"}
      </Button>
    </form>
  );
}
