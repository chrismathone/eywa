"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { CATEGORY_LABEL, type MonthHistory } from "@/features/visitor-history/model";
import { kstShortStamp } from "@/lib/date-kst";

export function RecordTable({ month, data, error, today }: { month: string; data?: MonthHistory; error?: string; today: string }) {
  const [filter, setFilter] = useState("all"), [page, setPage] = useState(1);
  const records = data?.records.filter(r => filter === "all" || r.status === filter || r.category === filter) ?? [];
  const pageCount = Math.max(1, Math.ceil(records.length / 50));
  const visiblePage = Math.min(page, pageCount);
  return <section className="space-y-3" aria-label="선택한 달 예약 원본">
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="font-semibold">{month.replace("-", "년 ")}월 예약 기록</h2>
      <select aria-label="기록 분류" className={TOOLBAR_SELECT} value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }}>
        <option value="all">전체</option><option value="active">집계 예약</option>
        <option value="consultation">상담</option><option value="entrance">입학테스트·입테</option><option value="test">테스트</option>
        <option value="cancelled">취소</option><option value="review">확인 대기</option>
      </select>
      {data && <span className="text-xs text-muted-foreground">{kstShortStamp(data.checkedAt)} 조회 · 사본 {data.duplicates}건 합침</span>}
    </div>
    {error ? <p role="alert">{error}</p> : !data ? <p className="text-sm text-muted-foreground">이 달의 기록을 아직 조회하지 않았습니다.</p> : <>
      {!data.complete && <p role="alert" className="text-sm text-destructive">일부만 조회되어 월별 합계와 비교를 보류했습니다. 아래 목록도 일부일 수 있습니다.</p>}
      <p className="text-xs text-muted-foreground">{data.sources.map(s => `${s.source}: ${s.complete ? "조회 완료" : "조회 미완료"}${s.unclassified ? ` · 날짜·제목 등 확인 불가 ${s.unclassified}건` : ""}`).join(" / ") || "이 학원의 구글 캘린더 연결을 확인해 주세요."}</p>
      {records.length ? <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/50 text-left"><tr>{["예약일", "구분", "예약 제목", "상태·확인 사항", "출처"].map(h =>
          <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{records.slice((visiblePage - 1) * 50, visiblePage * 50).map(r => <tr key={r.key} className="border-t">
          <td className="whitespace-nowrap px-3 py-3">{r.date.slice(5)} {r.time ?? "종일"}</td>
          <td className="whitespace-nowrap px-3 py-3">{r.category ? CATEGORY_LABEL[r.category] : "미분류"}</td>
          <td className={`max-w-80 break-words px-3 py-3 ${r.status === "cancelled" ? "line-through" : ""}`}>
            {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="text-primary underline underline-offset-4">{r.title}</a> : r.title}
          </td>
          <td className="max-w-60 px-3 py-3">{r.reason ?? (r.date >= today ? "예정 · 방문 미확인" : "지난 예약 · 방문 미확인")}</td>
          <td className="px-3 py-3 text-muted-foreground">{r.source}</td>
        </tr>)}</tbody>
      </table></div> : <p className="text-sm text-muted-foreground">{data.complete ? "이 조건에 맞는 예약 기록이 없습니다." : "현재 읽은 범위에서 표시할 기록이 없습니다."}</p>}
      <div className="flex items-center gap-3 text-sm">
        <Button variant="ghost" disabled={visiblePage <= 1} onClick={() => setPage(visiblePage - 1)}>이전</Button>
        <span>{visiblePage} / {pageCount}쪽 · {records.length}건{!data.complete ? " (일부)" : ""}</span>
        <Button variant="ghost" disabled={visiblePage >= pageCount} onClick={() => setPage(visiblePage + 1)}>다음</Button>
      </div>
    </>}
  </section>;
}
