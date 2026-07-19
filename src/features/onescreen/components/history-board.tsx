"use client";

// 원스크린 "지난 보고서" 뷰 — 강사 본인이 쓴 보고서 이력을 날짜별로 묶어 열람(읽기 전용).
// 뷰 진입 시에만 서버 액션으로 로드(첫 페인트 비블로킹, B7 취지) + "더 보기" 커서 페이징.
// 표시 규칙: 과목=labelOf(한글), 발송상태=classnoteBadge(한글), 학교·학년=schoolGradeLabel 압축.
import { useEffect, useRef, useState } from "react";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { EyIcon } from "@/components/icons/eywa-icons";
import { getMyPastReports, type PastReportRow } from "../server/history-actions";
import { isShareExpired } from "../share-expiry";
import { classnoteBadge } from "./report-card";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

function dateLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = WEEKDAY[new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay()] ?? "";
  return `${m}/${d} (${dow})`;
}

export function HistoryBoard() {
  const subjects = useSubjectMaps();
  const [rows, setRows] = useState<PastReportRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true); // 첫 로드
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(""); // 학생 이름 필터(로드된 범위 내)
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return; // StrictMode 이중 실행 방어
    loadedRef.current = true;
    void getMyPastReports().then((res) => {
      if (res.ok) {
        setRows(res.rows ?? []);
        setHasMore(res.hasMore ?? false);
      } else setError(res.error ?? "불러오지 못했습니다");
      setLoading(false);
    });
  }, []);

  const loadMore = async () => {
    const oldest = rows[rows.length - 1]?.reportDate;
    if (!oldest || loadingMore) return;
    setLoadingMore(true);
    const res = await getMyPastReports({ before: oldest });
    if (res.ok) {
      setRows((prev) => [...prev, ...(res.rows ?? [])]);
      setHasMore(res.hasMore ?? false);
    } else setError(res.error ?? "더 불러오지 못했습니다");
    setLoadingMore(false);
  };

  if (loading)
    return (
      <div className="bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-md border p-10 text-sm">
        지난 보고서를 불러오는 중…
      </div>
    );
  if (error)
    return (
      <div className="bg-card border-line shadow-card text-danger flex items-center justify-center rounded-md border p-10 text-sm">
        {error}
      </div>
    );

  const q = query.trim();
  const filtered = q ? rows.filter((r) => r.studentName.includes(q)) : rows;
  // 날짜별 그룹(로드 순서 = 최신순 유지)
  const byDate = new Map<string, PastReportRow[]>();
  for (const r of filtered) {
    const list = byDate.get(r.reportDate);
    if (list) list.push(r);
    else byDate.set(r.reportDate, [r]);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="학생 이름 검색"
          className="border-line bg-card focus:border-primary w-44 rounded-md border px-2.5 py-1.5 text-[12.5px] outline-none"
        />
        <span className="text-text-faint ml-auto text-[12px]">
          불러온 보고서 {rows.length}건{q ? ` · 검색 결과 ${filtered.length}건` : ""}
        </span>
      </div>

      {byDate.size === 0 ? (
        <div className="bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-md border p-10 text-sm">
          {q ? "검색 결과가 없습니다" : "작성한 보고서가 없습니다"}
        </div>
      ) : (
        [...byDate.entries()].map(([date, list]) => (
          <section key={date} className="bg-card border-line shadow-card rounded-md border">
            <header className="border-line flex items-baseline gap-2 border-b px-3 py-2">
              <h3 className="text-foreground text-[13px] font-bold">{dateLabel(date)}</h3>
              <span className="text-text-faint text-[11px]">
                {list.length}건 · 발송 {list.filter((r) => r.classnoteStatus === "success").length}
              </span>
            </header>
            <ul className="divide-border divide-y">
              {list.map((r) => {
                const badge = classnoteBadge(r.classnoteStatus ?? undefined);
                const linkOk = r.shareToken && !r.revoked && !isShareExpired(r.reportDate);
                return (
                  <li key={r.id} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-3 py-2">
                    <span className="text-foreground w-24 shrink-0 truncate text-[13px] font-bold">
                      {r.studentName}
                    </span>
                    <span className="text-text-faint w-20 shrink-0 truncate text-[11px]">{r.studentLabel}</span>
                    {r.subject ? (
                      <span className="border-line text-text-dim shrink-0 rounded-md border px-1.5 py-0.5 text-[11px]">
                        {subjects.labelOf(r.subject)}
                      </span>
                    ) : null}
                    <span className="text-text-dim min-w-0 flex-1 truncate text-[12px]" title={r.progress ?? ""}>
                      {r.progress || "—"}
                    </span>
                    {r.examInfo ? (
                      <span className="text-text-faint hidden shrink-0 text-[11px] sm:inline">{r.examInfo}</span>
                    ) : null}
                    {badge ? (
                      <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    ) : null}
                    {r.viewCount > 0 ? (
                      <span className="text-text-faint shrink-0 text-[11px]">열람 {r.viewCount}</span>
                    ) : null}
                    {linkOk ? (
                      <a
                        href={`/r/${r.shareToken}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary inline-flex shrink-0 items-center gap-0.5 text-[11px] hover:underline"
                      >
                        보고서 보기 <EyIcon name="arrowRight" size={11} />
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {hasMore ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="border-line text-text-dim hover:bg-bg-soft mx-auto rounded-md border px-4 py-1.5 text-[12px] font-bold disabled:opacity-50"
        >
          {loadingMore ? "불러오는 중…" : "이전 보고서 더 보기"}
        </button>
      ) : null}
    </div>
  );
}
