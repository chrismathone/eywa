"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { WindowLink } from "@/components/workspace/window-link";
import type { StudentCareView } from "../server/queries";
import { targetHref, type CareTarget, type CareCommand, type CareRecord } from "../model";
import { saveCare } from "../server/actions";
import { CareCard } from "./care-card";
import { CareContentForm } from "./care-content-form";

/** 약속 관리 화면 본문(머리글은 page가 PageHeader로) — 학생(`/students/<id>/care`)과 등록 전 상담(`/enrollment/<id>/care`)이 같은 본문. */
export function CareWorkspace({ view }: { view: StudentCareView }) {
  const router = useRouter();
  const target: CareTarget = view.intake ? { intakeId: view.intake.id } : { studentId: view.student!.id };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  // 트랜지션으로 감싸지 않는다(#102 — 오래 도는 서버 액션이 그동안의 화면 이동을 막는다). 진행 표시는 상태 하나로.
  async function save(command: CareCommand, record?: CareRecord) {
    setError(null);
    const id = record?.id ?? draftId ?? crypto.randomUUID();
    if (!record) setDraftId(id);
    setBusy(true);
    try {
      const result = await saveCare({ ...target, id, version: record?.version ?? 0, command });
      if (!result.ok) { setError(result.error); return; }
      if (!record) { setAdding(false); setDraftId(null); }
      router.refresh();
    } catch {
      setError("저장 결과를 확인하지 못했습니다. 새로 불러와 기록을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-text-dim text-sm">요구사항 → 약속과 기한 → 담당자 인수 → 실제 기록으로 이행 확인</p>
      <nav className="flex flex-wrap gap-3 text-sm font-semibold" aria-label="관련 화면">
        {view.student ? <WindowLink href={`/students/${view.student.id}`} className="text-primary hover:underline">학생 기록</WindowLink> : null}
        {view.intake ? <WindowLink href={`/enrollment/${view.intake.id}`} className="text-primary hover:underline">입학상담</WindowLink> : null}
        <WindowLink href="/students/care" className="text-primary hover:underline">미완료 약속</WindowLink>
      </nav>
      {view.intake && !view.student ? <p className="border-line rounded-2xl border p-3 text-sm">등록 전 인계입니다. 학생 등록 시 같은 약속과 변경 이력이 학생 관리로 이어집니다. 이행 증거는 등록 후 연결합니다.</p> : null}
      {view.error ? <p className="border-line rounded-2xl border p-4" role="status">{view.error}</p> : (
        <>
          {view.references.warning ? <p className="text-danger text-sm" role="alert">{view.references.warning}</p> : null}
          {view.staffError ? <p className="text-danger text-sm" role="alert">담당자 목록을 불러오지 못했습니다. 새로 불러온 뒤 등록해 주세요.</p> : null}
          {error ? (
            <div role="alert" className="border-att-absent flex flex-col items-start gap-2 rounded-2xl border p-3 text-sm">
              <p>{error}</p>
              <Button variant="link" className="px-0" onClick={() => router.refresh()}>새로 불러오기</Button>
            </div>
          ) : null}
          {view.actor.canManage ? <Button className="self-start" onClick={() => setAdding(!adding)}>{adding ? "등록 닫기" : "상담 약속 등록"}</Button> : null}
          {adding ? <section className="border-line rounded-2xl border p-4" aria-label="상담 약속 등록"><CareContentForm view={view} busy={busy} onSave={(content) => save({ kind: "create", content })} /></section> : null}
          {view.records.length === 0 ? <p className="text-text-dim">표시할 상담 약속이 없습니다.</p> : view.records.map((record) => <CareCard key={`${record.id}:${record.version}`} record={record} view={view} busy={busy} onSave={(command) => save(command, record)} />)}
          <nav className="flex gap-4 text-sm font-semibold" aria-label="약속 목록 페이지">
            {view.page > 0 ? <WindowLink className="text-primary hover:underline" href={`${targetHref(target)}?page=${view.page - 1}`}>이전 100건</WindowLink> : null}
            {view.more ? <WindowLink className="text-primary hover:underline" href={`${targetHref(target)}?page=${view.page + 1}`}>다음 100건</WindowLink> : null}
          </nav>
        </>
      )}
    </div>
  );
}
