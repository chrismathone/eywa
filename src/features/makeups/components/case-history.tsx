"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { loadMakeupEvents } from "../server/actions";
import type { MakeupEventPage } from "../server/read-types";
import { MAKEUP_EVENT, makeupText } from "../status";

export function CaseHistory({ caseId }: { caseId: string }) {
  const [data, setData] = useState<MakeupEventPage>();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const load = (page: number) => startTransition(async () => {
    try {
      const result = await loadMakeupEvents({ case_id: caseId, page });
      if (!result.data) { setError(result.error); return; }
      setData(result.data); setError("");
    } catch { setError("변경 이력을 불러오지 못했습니다. 다시 조회해 주세요."); }
  });
  return <details onToggle={event => { if (event.currentTarget.open && !data && !pending) load(1); }}>
    <summary className="min-h-6 cursor-pointer font-medium">변경 이력</summary>
    {pending ? <p role="status">이력을 조회하고 있습니다…</p> : null}
    {error ? <div role="alert"><p>{error}</p><Button variant="outline" disabled={pending} onClick={() => load(data?.page ?? 1)}>이력 다시 조회</Button></div> : null}
    {data ? <>
      <ol className="mt-3 space-y-2">{data.rows.map(event => <li key={event.id} className="border-line border-t pt-2">
        <p>{new Date(event.occurred_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} · {makeupText(MAKEUP_EVENT, event.event_type)} · {event.actor_name ?? "처리 기록"}</p>
        {event.reason ? <p className="whitespace-pre-wrap">{event.reason}</p> : null}
      </li>)}</ol>
      {!data.rows.length ? <p>변경 이력이 없습니다.</p> : null}
      <nav aria-label="보강 변경 이력 페이지" className="mt-3 flex items-center justify-between gap-3">
        <Button variant="outline" disabled={pending || data.page <= 1} onClick={() => load(data.page - 1)} aria-label="변경 이력 이전 페이지">이전</Button>
        <span>{data.page} / {Math.max(1, Math.ceil(data.total / data.page_size))} · {data.total}건</span>
        <Button variant="outline" disabled={pending || data.page * data.page_size >= data.total} onClick={() => load(data.page + 1)} aria-label="변경 이력 다음 페이지">다음</Button>
      </nav>
    </> : null}
  </details>;
}
