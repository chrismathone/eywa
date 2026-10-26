"use client";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { EmbedLink as Link } from "@/components/embed-link";
import type { CorrectionDetail } from "../model/corrections";
import { ListPager } from "./list-pager";
import { useOntologyNavigation } from "./ontology-navigation";
import { metricLabels, monthText, rawText } from "./presentation";

function EvidenceIds({ ids }: { ids: string[] }) {
  const [page, setPage] = useState(1);
  return <details className="mt-2 text-xs"><summary className="cursor-pointer">근거 기록 번호 {ids.length}건</summary>
    <ul className="mt-2 space-y-1">{ids.slice((page - 1) * 10, page * 10).map((id) => <li key={id} className="break-all">{id}</li>)}</ul>
    {ids.length > 10 && <ListPager page={page} total={ids.length} pageSize={10} onChange={setPage} label="정정 근거" />}</details>;
}
/** 원래 달의 차이와 이전에 반영한 차감을 한 달 묶음으로 유지한다. */
export function CorrectionDetails({ entries, studentId }: { entries: CorrectionDetail[]; studentId: string }) {
  const [page, setPage] = useState(1);
  const params = useSearchParams(), { navigate } = useOntologyNavigation();
  const monthHref = (month: string) => {
    const query = new URLSearchParams(params.toString()); query.set("month", month); query.delete("page");
    return `/student-contribution/${encodeURIComponent(studentId)}?${query}`;
  };
  const months = [...new Set(entries.map((entry) => entry.month))].sort().reverse();
  const current = Math.min(page, Math.max(1, Math.ceil(months.length / 6)));
  return <div className="mt-4 border-t border-line pt-3"><ul className="divide-y divide-line">{months.slice((current - 1) * 6, current * 6).map((month) => <li key={month} className="py-3">
    <Link href={monthHref(month)} scroll={false} onClick={(event) => {
      // 같은 화면의 달 이동은 차트·탭과 한 이동 상태로 처리한다(이동 중 탭 전환이 이동을 버리지 않게).
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); navigate(event.currentTarget.getAttribute("href")!);
    }} className="text-sm font-medium text-primary underline">{monthText(month)} 원래 달 내역</Link>
    <ul className="mt-3 space-y-3">{entries.filter((entry) => entry.month === month).map((entry, i) => <li key={`${entry.metric}:${entry.kind}:${i}`}><p className="font-medium">{metricLabels[entry.metric]}</p><p className="mt-1">{entry.kind === "alreadyApplied" ? `중복 반영을 막기 위해 이전 정정 ${rawText(entry.metric, entry.before)} 차감` : `마감 시 ${rawText(entry.metric, entry.before)} → 최근 확인 ${rawText(entry.metric, entry.after)}`}</p><EvidenceIds ids={entry.evidenceIds} /></li>)}</ul>
  </li>)}</ul>{months.length > 6 && <ListPager page={current} total={months.length} pageSize={6} onChange={setPage} label="정정 월" />}</div>;
}
