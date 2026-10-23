"use client";

import { useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getContributionPendingDetails } from "../server/pending-actions";
import { pendingDetails } from "../model/pending-details";
import type { Metric } from "../model/config";
import { metricLabels } from "./presentation";

export function PendingBadge({ studentId, name, metrics }: { studentId: string; name: string; metrics: Metric[] }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof getContributionPendingDetails>>>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const requested = useRef(false);
  const show = (value: boolean) => {
    setOpen(value);
    if (!value || requested.current) return;
    requested.current = true; setState("loading");
    void getContributionPendingDetails(studentId).then(data => { setResult(data); setState(data ? "ready" : "failed"); if (!data) requested.current = false; })
      .catch(() => { requested.current = false; setState("failed"); });
  };
  if (!metrics.length) return null;
  const details = result?.details ?? pendingDetails(metrics);
  return <TooltipProvider delay={150}><Tooltip open={open} onOpenChange={show}>
    <TooltipTrigger onClick={() => show(!open)} aria-label={`${name} 확인 전 항목 ${metrics.length}개`}
      className="cursor-help rounded bg-secondary px-1.5 py-0.5 text-xs font-normal underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-primary">일부 확인 전</TooltipTrigger>
    <TooltipContent side="bottom" align="start" className="block max-w-[min(24rem,90vw)] border border-line bg-background p-4 text-foreground shadow-lg">
      <p className="text-sm font-semibold">{name} · 확인이 필요한 항목</p>
      <ul className="mt-3 space-y-3">{details.map(d => <li key={d.metric}>
        <p className="font-semibold">{metricLabels[d.metric]}{d.count !== null ? ` · ${d.count}건` : ""}</p>
        <p className="mt-1 leading-relaxed">{d.reason}</p>
        {!!d.months.length && <p className="mt-1 text-primary">확인된 해당 월: {d.months.join(", ")}</p>}
        {!!d.lessons?.length && <p className="mt-1 leading-relaxed">수업명: {d.lessons.slice(0, 8).join(" · ")}{d.lessons.length > 8 ? ` 외 ${d.lessons.length - 8}개` : ""}</p>}
      </li>)}</ul>
      {state === "loading" && <p className="mt-3 text-xs" role="status">해당 월을 확인하는 중…</p>}
      {state === "failed" && <p className="mt-3 text-xs" role="status">세부 자료를 불러오지 못했습니다. 위 안내는 마지막 집계의 항목 기준입니다.</p>}
      {result?.computedAt && <p className="mt-3 border-t border-line pt-2 text-xs">{new Date(result.computedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })} 집계 기준</p>}
      {state === "ready" && !details.length && <p className="mt-2">최근 집계에서는 모두 확인됐습니다. 목록을 새로고침해 주세요.</p>}
    </TooltipContent>
  </Tooltip></TooltipProvider>;
}
