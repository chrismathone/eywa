"use client";
import { useState } from "react";
import { readContributionVideoCheck } from "../server/video-check-action";
import { Button } from "@/components/ui/button";
import { ContributionLink } from "./student-contribution-scope";
import { ListPager } from "./list-pager";
import { monthText } from "./presentation";
const LABEL = { submitted: "제출 확인", missing: "미제출", unchecked: "제출 기한 남음" };
export function VideoCompletionCheck({ studentId, month }: { studentId: string; month: string }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof readContributionVideoCheck>> | null>(null), [busy, setBusy] = useState(false), [page, setPage] = useState(1);
  const data = result?.data;
  const load = async () => { setBusy(true); try { setResult(await readContributionVideoCheck({ studentId, month })); } catch { setResult({ error: "원본을 확인하지 못했습니다. 다시 시도해 주세요." }); } finally { setBusy(false); } };
  return <details className="rounded-xl border border-line" onToggle={(event) => { if (event.currentTarget.open && !result && !busy) load(); }}>
    <summary className="cursor-pointer px-5 py-4 font-semibold">영상 숙제 인정 내역</summary>
    <div className="space-y-3 border-t border-line px-5 py-4 text-sm">
      <p>배정된 숙제에 제출 영상이 하나 이상 확인되면 숙제당 1회 인정합니다. 같은 숙제에 영상이 2개 이상 있어도 한 번만 계산합니다. 점수는 인정 건수에 현재 배점을 곱합니다.</p>
      <p className="text-xs">아래는 지금 조회한 원본입니다. 마감된 달의 실적·점수와 다를 수 있으며, 조회만으로 점수를 바꾸지 않습니다.</p>
      {busy && <p role="status">배정과 제출 기록을 확인하고 있습니다…</p>}
      {result?.error && <div role="status">{result.error} <Button size="sm" variant="outline" disabled={busy} onClick={load}>다시 확인</Button></div>}
      {data && <>
        <p className="font-medium">{monthText(month)} · 배정 {data.rows.length}건 · 제출 확인 {data.rows.filter((r) => r.status === "submitted").length}건 · 미제출 {data.rows.filter((r) => r.status === "missing").length}건 · 기한 남음 {data.rows.filter((r) => r.status === "unchecked").length}건</p>
        <p className="text-xs">이 달 업로드가 확인된 영상 {data.uploaded}개 · 숙제의 배정일과 영상 업로드일은 다를 수 있습니다.</p>
        <p className="text-primary">현재 원본 기준 인정 {data.rows.filter(r => r.status === "submitted").length}건 · 새 제출 내역은 다음 집계에 반영합니다.</p>
        {!data.rows.length ? <p>이 달에 배정된 영상 숙제 기록이 없어 인정할 숙제가 없습니다.</p> : <>
          <ul className="divide-y divide-line">{data.rows.slice((page - 1) * 10, page * 10).map((r) => <li key={`${r.classId}:${r.date}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="tabular-nums">{r.date}</span><span className={r.status === "missing" ? "text-danger" : r.status === "submitted" ? "text-green" : "text-text-dim"}>{LABEL[r.status]}</span>
            {r.videoId && <ContributionLink href={`/students/${studentId}?tab=homework-videos&video=${encodeURIComponent(r.videoId)}`} className="text-primary underline">영상 보기</ContributionLink>}
          </li>)}</ul><ListPager page={page} total={data.rows.length} pageSize={10} onChange={setPage} label="영상 숙제 배정" />
        </>}
        <p className="text-xs">확인 시각 {new Date(data.checkedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</p>
      </>}
      <ContributionLink href={`/students/${studentId}?tab=homework-videos`} className="inline-block text-primary underline underline-offset-4">학생의 전체 숙제 영상 보기</ContributionLink>
    </div>
  </details>;
}
