"use client";
import { useState, useTransition } from "react";
import { getParentEventEvidence } from "../server/parent-event-evidence";

export function ParentEventEvidence({ id, studentId }: { id: string; studentId: string }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof getParentEventEvidence>> | null>(null);
  const [pending, start] = useTransition();
  return <div>{result && "url" in result ? <a href={result.url} target="_blank" rel="noreferrer" title="명단을 가져올 때 확인한 위치입니다. 이후 원본 행이 이동했을 수 있습니다." className="text-primary underline underline-offset-4">{result.cancelled ? "취소된 신청 원본" : "명단 원본"} · 가져온 위치 {result.row}행 ↗</a>
    : <button type="button" disabled={pending} onClick={() => start(async () => setResult(await getParentEventEvidence(id, studentId)))} className="text-primary underline underline-offset-4 disabled:opacity-50">{pending ? "위치 확인 중…" : "명단 원본 확인"}</button>}
    {result && "error" in result && <p role="status" className="mt-1 text-xs">{result.error}</p>}</div>;
}
