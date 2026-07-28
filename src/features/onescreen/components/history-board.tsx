"use client";

// 원스크린 "지난 보고서" 목록 — 강사 본인이 쓴 보고서 이력을 날짜별로 묶어 열람(읽기 전용).
// 뷰 진입 시에만 서버 액션으로 로드(첫 페인트 비블로킹, B7 취지) + "더 보기" 커서 페이징.
// 표시 규칙: 과목=labelOf(한글), 발송상태=classnoteBadge(한글), 학교·학년=schoolGradeLabel 압축.
//
// 두 가지 모드를 같은 렌더로 쓴다(중복 구현 금지):
//  · `date` 없음 = 최신부터 커서 페이징(전체 이력 훑기)
//  · `date` 지정 = 그 하루만(월간 달력에서 날짜를 눌렀을 때의 상세 패널)
import { useEffect, useState } from "react";
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

export function HistoryBoard({ date }: { date?: string }) {
  const subjects = useSubjectMaps();
  const [rows, setRows] = useState<PastReportRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null); // 지금 rows가 어느 조회분인지
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(""); // 학생 이름 필터(로드된 범위 내)

  // ⚠️ loading을 state로 두고 effect 안에서 setLoading(true)를 부르면 react-hooks/set-state-in-effect 위반(#25).
  // "지금 화면의 rows가 지금 요청분인가"를 **파생**해서 쓴다 — 날짜를 바꾼 순간 자동으로 로딩 상태가 된다.
  const key = date ?? "";
  const loading = loadedKey !== key;

  useEffect(() => {
    // `date`가 바뀌면 다시 읽는다(달력에서 다른 날짜를 누른 경우).
    // ⚠️ 늦게 도착한 이전 요청이 새 날짜 결과를 덮지 않도록 취소 플래그로 버린다(StrictMode 이중 실행도 여기서 흡수).
    let cancelled = false;
    void getMyPastReports(date ? { on: date } : undefined).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setRows(res.rows ?? []);
        setHasMore(res.hasMore ?? false);
        setError(null);
      } else {
        setRows([]);
        setHasMore(false);
        setError(res.error ?? "불러오지 못했습니다");
      }
      setLoadedKey(key);
    }).catch(() => {
      // ⚠️ reject되면 loadedKey가 영영 안 바뀌어 '불러오는 중…'에 갇힌다(에러도 재시도도 없음).
      if (cancelled) return;
      setRows([]);
      setHasMore(false);
      setError("보고서를 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요");
      setLoadedKey(key);
    });
    return () => {
      cancelled = true;
    };
  }, [date, key]);

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
      <div className="bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-2xl border p-10 text-sm">
        지난 보고서를 불러오는 중…
      </div>
    );
  if (error)
    return (
      <div className="bg-card border-line shadow-card text-danger flex items-center justify-center rounded-2xl border p-10 text-sm">
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
          className="border-line bg-card focus:border-primary w-44 rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none"
        />
        <span className="text-text-faint ml-auto text-[12px]">
          {date ? "이 날짜" : "불러온"} 보고서 {rows.length}건{q ? ` · 검색 결과 ${filtered.length}건` : ""}
        </span>
      </div>

      {byDate.size === 0 ? (
        <div className="bg-card border-line shadow-card text-text-faint flex items-center justify-center rounded-2xl border p-10 text-sm">
          {q ? "검색 결과가 없습니다" : date ? "이 날짜에 작성한 보고서가 없습니다" : "작성한 보고서가 없습니다"}
        </div>
      ) : (
        [...byDate.entries()].map(([date, list]) => (
          <section key={date} className="bg-card border-line shadow-card rounded-2xl border">
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
                  // ⚠️ 열 정렬(2026-07-28 원장 제보): 예전 flex-wrap + 조건부 렌더는 값이 없는 항목의 **자리가
                  // 통째로 사라져** 행마다 열이 어긋났다(점수·상태·열람이 뒤섞여 보임). 오른쪽 열들은 값이
                  // 없어도 고정폭 슬롯을 **항상** 렌더해 세로 정렬을 보장한다(wrap 금지 — 진도만 truncate).
                  <li key={r.id} className="flex items-baseline gap-x-2.5 px-3 py-2">
                    <span className="text-foreground w-24 shrink-0 truncate text-[13px] font-bold">
                      {r.studentName}
                    </span>
                    <span className="text-text-faint w-20 shrink-0 truncate text-[11px]">{r.studentLabel}</span>
                    <span className="w-12 shrink-0 text-center">
                      {r.subject ? (
                        <span className="border-line text-text-dim rounded-full border px-1.5 py-0.5 text-[11px]">
                          {subjects.labelOf(r.subject)}
                        </span>
                      ) : null}
                    </span>
                    <span className="text-text-dim min-w-0 flex-1 truncate text-[12px]" title={r.progress ?? ""}>
                      {r.progress || "—"}
                    </span>
                    <span
                      className="text-text-faint hidden w-12 shrink-0 truncate text-right text-[11px] sm:inline-block"
                      title={r.examInfo ?? ""}
                    >
                      {r.examInfo ?? ""}
                    </span>
                    <span className="w-32 shrink-0 text-right">
                      {badge ? (
                        <span
                          className={`inline-block max-w-full truncate rounded-md px-1.5 py-0.5 align-bottom text-[10.5px] font-bold ${badge.cls}`}
                          title={badge.label}
                        >
                          {badge.label}
                        </span>
                      ) : r.sendable ? (
                        // 미발송 + 발송 게이트 통과(0128a sendable) = 지금 그 날짜로 가서 발송하면 실제로 나감.
                        // 달력 요약의 '보낼 수 있음'과 같은 판정·같은 amber(2026-07-28 원장 제보: 실패는 보이는데
                        // 보낼 수 있는 건이 목록에서 구분되지 않았다).
                        <span className="bg-amber-soft text-amber rounded-pill inline-block px-1.5 py-0.5 text-[10.5px] font-bold">
                          보낼 수 있음
                        </span>
                      ) : (
                        // 미발송이지만 게이트 밖(이관분·취소·과목 밖·기한 초과) — 사실만 표기(재촉 아님, #77).
                        <span className="text-text-faint text-[10.5px]">미발송</span>
                      )}
                    </span>
                    <span className="text-text-faint w-12 shrink-0 text-right text-[11px]">
                      {r.viewCount > 0 ? `열람 ${r.viewCount}` : ""}
                    </span>
                    <span className="w-[74px] shrink-0 text-right">
                      {linkOk ? (
                        <a
                          href={`/r/${r.shareToken}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary inline-flex items-center gap-0.5 text-[11px] hover:underline"
                        >
                          보고서 보기 <EyIcon name="arrowRight" size={11} />
                        </a>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {/* 하루만 보는 모드에선 "이전 더 보기"가 의미 없다(커서가 날짜 단위). 대신 잘렸다는 사실만 알린다. */}
      {hasMore && date ? (
        <p className="text-text-faint text-center text-[11px]">
          이 날짜 보고서가 많아 최근 {rows.length}건만 표시했습니다
        </p>
      ) : null}
      {hasMore && !date ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="border-line text-text-dim hover:bg-bg-soft mx-auto rounded-lg border px-4 py-1.5 text-[12px] font-bold disabled:opacity-50"
        >
          {loadingMore ? "불러오는 중…" : "이전 보고서 더 보기"}
        </button>
      ) : null}
    </div>
  );
}
