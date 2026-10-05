"use client";

import { useRouter } from "next/navigation";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import type { MakeupCandidate } from "../server/read-types";
import { CommandForm } from "./command-form";

export function CandidateAction({ kind, row, caseId, sourceHash, batchId }: { kind: "absence" | "legacy"; row: MakeupCandidate; caseId?: string; sourceHash?: string; batchId?: string }) {
  const router = useRouter();
  const embed = useEmbed();
  // Navigates on success, so the action skips the page re-render (no discarded action, no extra refresh).
  return <CommandForm action={kind === "legacy" ? "link_legacy" : "intake"} refresh="client"
    label={kind === "legacy" ? "기존 약속 연결" : "보강 접수"} payload={() => kind === "legacy" ? {
      source_id: row.id, ...(caseId ? { case_id: caseId } : {}),
      ...(sourceHash ? { expected_source_hash: sourceHash } : {}), ...(batchId ? { batch_id: batchId } : {}),
    } : { student_id: row.student_id, subject_key: row.subject_key, original_class_id: row.class_id,
      original_date: row.original_date, reason: "absence", source_kind: "attendance", source_id: row.id,
    }} onSaved={result => { const id = result.case_id ?? result.id;
      if (typeof id === "string") router.push(embed ? withEmbed(`/makeups/${id}`) : `/makeups/${id}`); }}>
    <p className="text-sm">{kind === "legacy" ? "일정을 보존하고 검토할 보강 건에 연결합니다." : "분량은 승인 대기로 접수합니다."}</p>
  </CommandForm>;
}
