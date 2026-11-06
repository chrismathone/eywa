"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import type { CareCommand } from "../model";
import { listCareEvidenceOptions, saveCare } from "../server/actions";
import type { CareCommitmentView, CareExploreView } from "../server/explore";
import { CareCompleteDialog, CareEvidenceDialog, type EvidenceOptionsState } from "./care-explore-dialogs";

/**
 * 연결 탐색 '약속·할 일' 조각 — 이 원생의 약속(진행 중/완료 · 버전 · 담당 · 목표일 · 학부모 요구 · 완료 기준 · 이행 기록 N건)과
 * 진행 중 약속의 '기록 추가' · '완료 확인'. 만들기·고치기·인수 확인·취소는 약속 관리 화면(`careHref`)에서.
 * 상태가 ready가 아니면 까닭마다 다른 문장 — 실패를 '약속 없음'으로 꾸미지 않는다.
 */
export function CareExploreBlock({ studentId, view }: { studentId: string; view: CareExploreView }) {
  if (view.state !== "ready") return <p className="text-text-dim text-sm" role="status">{STATE_TEXT[view.state]}</p>;
  if (view.commitments.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p className="text-text-dim">아직 약속이 없습니다.</p>
        <ManageLink href={view.careHref} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {view.commitments.map((c) => (
        <CommitmentCard key={`${c.id}:${c.version}`} studentId={studentId} commitment={c} canManage={view.canManage} canContribute={view.canContribute} />
      ))}
      <ManageLink href={view.careHref} />
    </div>
  );
}

const STATE_TEXT: Record<Exclude<CareExploreView["state"], "ready">, string> = {
  unavailable: "약속·인계 표가 아직 연결되지 않았습니다(관리자에게 문의해 주세요).",
  denied: "이 원생의 약속을 볼 권한이 없습니다.",
  error: "약속을 불러오지 못했습니다. 잠시 후 새로고침해 주세요.",
};

function ManageLink({ href }: { href: string }) {
  return <WindowLink href={href} className="text-primary text-sm font-semibold hover:underline">약속 관리 열기 ›</WindowLink>;
}

/** `2026-11-04` → `11.04` */
const monthDay = (ymd: string | null) => (ymd ? ymd.slice(5, 10).replace("-", ".") : "");

function CommitmentCard({ studentId, commitment: c, canManage, canContribute }: {
  studentId: string; commitment: CareCommitmentView; canManage: boolean; canContribute: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"evidence" | "complete" | null>(null);
  const [options, setOptions] = useState<EvidenceOptionsState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = c.state === "open";
  const canComplete = c.acknowledged && c.evidence.length > 0;

  async function openEvidence() {
    setError(null);
    setDialog("evidence");
    setOptions({ status: "loading" });
    const result = await listCareEvidenceOptions(studentId).catch(() => ({ ok: false as const, error: "기록 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." }));
    setOptions(result.ok ? { status: "ready", options: result.options, warning: result.warning } : { status: "error", error: result.error });
  }
  // 트랜지션으로 감싸지 않는다(#102 — 오래 도는 서버 액션이 그동안의 화면 이동을 막는다). 진행 표시는 상태 하나로.
  async function save(command: CareCommand) {
    setBusy(true);
    setError(null);
    try {
      const result = await saveCare({ studentId, id: c.id, version: c.version, command });
      if (!result.ok) { setError(result.error); return; }
      setDialog(null);
      router.refresh();
    } catch {
      setError("저장 결과를 확인하지 못했습니다. 새로고침해 기록을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="border-line flex flex-col gap-2 rounded-2xl border px-3.5 py-3" aria-label={c.promise}>
      <div className="flex items-center justify-between gap-2">
        <b className="min-w-0 text-base font-extrabold">{c.promise}</b>
        <span className="shrink-0 text-sm whitespace-nowrap">
          {c.state === "completed" ? <Pill color="green">완료 {monthDay(c.closedOn)}</Pill>
            : c.state === "cancelled" ? <Pill color="neutral">취소 {monthDay(c.closedOn)}</Pill>
            : <span className="text-text-dim">진행 중 · v{c.revision}</span>}
        </span>
      </div>
      <p className="text-sm">
        {c.ownerName ?? "담당자 미정"} · {c.subject || "공통"} · 목표일 <span className="num">{c.dueOn}</span>
        {" · "}{c.acknowledged ? "담당자 인수 확인됨" : "인수 전"}
        {c.state === "completed" && c.closedByName ? ` · ${c.closedByName} 완료 확인` : ""}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 text-sm">
        <dt className="font-bold whitespace-nowrap">학부모 요구</dt><dd className="whitespace-pre-wrap">{c.need}</dd>
        <dt className="font-bold whitespace-nowrap">완료 기준</dt><dd className="whitespace-pre-wrap">{c.criterion}</dd>
      </dl>
      <div className="border-line-faint flex flex-col gap-1.5 border-t pt-2">
        <h4 className="text-sm font-extrabold">기록 {c.evidence.length}건</h4>
        {c.evidence.map((e) => (
          <div key={`${e.kind}:${e.recordId}`} className="border-line-faint rounded-lg border px-2 py-1.5 text-sm">
            {e.href ? <WindowLink href={e.href} className="text-primary font-semibold hover:underline">{e.kindLabel}</WindowLink>
              : <span><span className="font-semibold">{e.kindLabel}</span><span className="text-text-dim"> · 원본 열람 권한 없음</span></span>}
            <p className="whitespace-pre-wrap">{e.note}</p>
          </div>
        ))}
        {c.state === "completed" ? <p className="text-text-dim text-sm">완료된 약속은 고정 · 새 요구는 v{c.revision + 1}로</p> : null}
        {c.state === "cancelled" ? <p className="text-text-dim text-sm">취소된 약속 · 다시 열려면 약속 관리에서 새 버전으로</p> : null}
        {open && (canManage || canContribute) ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" variant="outline" disabled={busy} onClick={openEvidence}>기록 추가</Button>
            {canManage ? <Button size="sm" disabled={busy || !canComplete} onClick={() => { setError(null); setDialog("complete"); }}>완료 확인</Button> : null}
            {canManage && !canComplete ? (
              <span className="text-text-dim text-sm">{c.acknowledged ? "이행 기록이 1건 이상 있어야 완료할 수 있습니다." : "담당자 인수 확인 뒤 완료할 수 있습니다."}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      {dialog === "evidence" ? <CareEvidenceDialog commitment={c} options={options} busy={busy} error={error} onClose={() => setDialog(null)} onSave={save} /> : null}
      {dialog === "complete" ? <CareCompleteDialog commitment={c} busy={busy} error={error} onClose={() => setDialog(null)} onSave={save} /> : null}
    </article>
  );
}
