"use client";
import { useSearchParams } from "next/navigation";
import { ContributionLink as EmbedLink } from "./student-contribution-scope";
import { contributionListHref } from "../model/list-state";

export function StudentDetailActions({ studentId }: { studentId: string }) {
  const params = useSearchParams();
  return <div className="flex flex-wrap gap-2">
    <EmbedLink href={`/student-contribution/${studentId}/factors`} className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-white">42팩터 정밀분석</EmbedLink>
    <button type="button" className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-muted" onClick={() => {
      const panel = document.getElementById(`current-connections-${studentId}`);
      if (!(panel instanceof HTMLDetailsElement)) return;
      panel.open = true;
      const target = document.getElementById(`record-summary-${studentId}`);
      (target ?? panel).scrollIntoView({ block: "start" });
      (target ?? panel).focus({ preventScroll: true });
    }}>최근 기록 요약</button>
    <EmbedLink href={contributionListHref(params.get("list"))} className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-muted">전체 충성도 목록</EmbedLink>
  </div>;
}
