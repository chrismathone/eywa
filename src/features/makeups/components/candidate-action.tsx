"use client";

import { useRouter } from "next/navigation";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import type { MakeupCandidate } from "../server/read-types";
import { MAKEUP_ACTION } from "../status";
import { CommandForm } from "./command-form";

export function CandidateAction({ kind, row, caseId, sourceHash, batchId }: { kind: "absence" | "legacy"; row: MakeupCandidate; caseId?: string; sourceHash?: string; batchId?: string }) {
  const router = useRouter();
  const embed = useEmbed();
  // Navigates on success, so the action skips the page re-render (no discarded action, no extra refresh).
  return <CommandForm action={kind === "legacy" ? "link_legacy" : "intake"} refresh="client"
    label={kind === "legacy" ? MAKEUP_ACTION.link_legacy : MAKEUP_ACTION.intake} payload={() => kind === "legacy" ? {
      source_id: row.id, ...(caseId ? { case_id: caseId } : {}),
      ...(sourceHash ? { expected_source_hash: sourceHash } : {}), ...(batchId ? { batch_id: batchId } : {}),
    } : { student_id: row.student_id, subject_key: row.subject_key, original_class_id: row.class_id,
      original_date: row.original_date, reason: "absence", source_kind: "attendance", source_id: row.id,
    }} onSaved={result => { const id = result.case_id ?? result.id;
      if (typeof id === "string") router.push(embed ? withEmbed(`/makeups/${id}`) : `/makeups/${id}`); }}>
    <p className="text-sm">{kind === "legacy" ? "기존 보강 예약을 보강관리 기록에 연결합니다." : "접수 후 담당자가 보강 시간을 승인합니다."}</p>
  </CommandForm>;
}
