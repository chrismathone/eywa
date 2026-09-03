"use client";

// 수업보고서 > 강사별 주간 작성률(Part B) — 이번 주(월~일) 작성 건수 + 오늘 작성률·미작성.
// [전체/과목] 칩으로 강사 분류(반 담당 기준 태깅, 학원설정 승인 과목만 칩 노출 — 하드코딩 금지).
// 예외 강사(report.writingExemptTeachers)는 서버 쿼리에서 이미 제외되어 여기 안 온다.
import Link from "next/link";
import { SortableTh } from "@/components/table/sortable-th";
import { WritingRateMonth } from "./writing-rate-month";
import { sortRows, type SortState } from "@/lib/table/sort";
import { useMemo, useState } from "react";
import { useSubjectMaps } from "@/features/owner/operations-context";
import type { WritingRatesView } from "@/features/report-admin/server/queries";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

function weekdayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return WEEKDAY[new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay()] ?? "";
}

function rateTone(rate: number | null): string {
  if (rate == null) return "text-text-faint";
  if (rate >= 90) return "text-primary";
  if (rate >= 60) return "text-amber";
  return "text-danger";
}

function nameList(names: string[], max = 4): string {
  const head = names.slice(0, max).join("·");
  return names.length > max ? `${head} 외 ${names.length - max}` : head;
}

/** 오늘 남은 수업 안내 — 대상(분모)은 "시작된 수업"까지만이라 그 이유를 툴팁으로 밝힌다. */
function pendingTitle(p: { classes: number; firstStart: string }): string {
  return `오늘 시작 전 수업 ${p.classes}개 (첫 수업 ${p.firstStart}) — 작성률 대상에는 수업이 시작된 뒤 들어갑니다`;
}

function formatMonth(month: string): string {
  const [y, m] = month.split("-");
  return `${y}년 ${Number(m)}월`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, (m ?? 1) - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * 주간 ↔ 월간 전환 + 월 이동. 링크(searchParam)라 서버가 그 범위로 다시 계산한다 —
 * 클라에 한 달치를 미리 받아두지 않는다(주간만 보는 사람이 월간 비용을 물지 않게).
 */
function RangeSwitch({ range }: { range: WritingRatesView["range"] }) {
  const isMonth = range.kind === "month";
  const base = "/lesson-reports?tab=writing";
  const chip = "rounded-full border px-3 py-1 text-xs transition";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isMonth ? (
        <>
          <Link href={`${base}&rmonth=${shiftMonth(range.month, -1)}`} className={`${chip} border-line text-text-dim hover:bg-bg-soft`} aria-label="이전 달">
            ‹
          </Link>
          <span className="text-foreground px-1 text-xs font-bold">{formatMonth(range.month)}</span>
          <Link href={`${base}&rmonth=${shiftMonth(range.month, 1)}`} className={`${chip} border-line text-text-dim hover:bg-bg-soft`} aria-label="다음 달">
            ›
          </Link>
        </>
      ) : null}
      <Link href={base} className={`${chip} ${isMonth ? "border-line text-text-dim hover:bg-bg-soft" : "border-primary bg-primary text-white"}`}>
        이번 주
      </Link>
      <Link
        href={`${base}&rmonth=${range.month}`}
        className={`${chip} ${isMonth ? "border-primary bg-primary text-white" : "border-line text-text-dim hover:bg-bg-soft"}`}
      >
        월간
      </Link>
    </div>
  );
}

export function WritingRateCard({ view }: { view: WritingRatesView }) {
  const { dates, rates } = view;
  const isMonth = view.range.kind === "month";
  const subjects = useSubjectMaps();
  const [sel, setSel] = useState("all");
  // 칩 = 학원설정 승인 과목 중 실제 데이터에 등장하는 과목만(승인 밖 키·미태깅 강사는 '전체'에서만 보임).
  const chipOptions = useMemo(() => {
    const present = new Set(rates.flatMap((r) => r.subjects));
    return subjects.options.filter((o) => present.has(o.value));
  }, [rates, subjects.options]);
  const showChips = chipOptions.length >= 2;
  const filtered = sel === "all" || !showChips ? rates : rates.filter((r) => r.subjects.includes(sel));
  // 헤더 정렬 — 기본은 서버가 준 순서(대개 과목·이름). '오늘/주간'은 낮은 작성률부터 보는 게 쓸모 있어
  // 값 자체로 정렬한다(수업 없음=null은 규약대로 항상 뒤).
  const [sort, setSort] = useState<SortState<"teacher" | "today" | "week">>(null);
  const sorted = sortRows(filtered, sort, (r, k) =>
    k === "teacher" ? r.teacher : k === "today" ? r.todayRate : r.weekRate,
  );

  return (
    <section className="bg-card shadow-card rounded-2xl px-5 py-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        {/* 카드 헤더 위계(문법 ①) — 작은 소라벨 → 볼드 타이틀 → dim 서브 */}
        <div>
          <p className="editorial-eyebrow">작성 현황</p>
          <h2 className="text-foreground mt-0.5 text-base font-bold">강사별 작성률</h2>
          <p className="text-text-faint mt-0.5 text-xs">
            {isMonth ? (
              <>
                {formatMonth(view.range.month)} 날짜별·월간 작성률 — 작성/대상(결석 제외) · 오늘은{" "}
                <b className="font-medium">시작된 수업</b>까지만
              </>
            ) : (
              <>
                이번 주(월~일) 요일별·주간 작성률 — 작성/대상(결석 제외) · 오늘은{" "}
                <b className="font-medium">시작된 수업</b>까지만
              </>
            )}
          </p>
        </div>
        <RangeSwitch range={view.range} />
        {/* ⚠️ 월간은 본문을 WritingRateMonth가 그리고 **자기 과목 칩**을 따로 갖는다 — 여기 칩까지 두면
            같은 필터가 두 벌로 보이고(원장 제보 2026-07-23), 게다가 이 칩은 월간 표에 아무 영향이 없다
            (filtered는 주간표 전용). 죽은 컨트롤을 숨긴다. */}
        {showChips && !isMonth ? (
          <div className="flex flex-wrap gap-1.5">
            {[{ value: "all", label: "전체" }, ...chipOptions].map((o) => {
              const on = sel === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setSel(o.value)}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1 text-xs transition ${
                    on
                      ? "border-primary bg-primary/10 text-primary font-bold"
                      : "border-line text-text-dim hover:bg-bg-soft"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* 월간은 열이 31개라 주간표(요일 7열 + 오늘 열)와 레이아웃이 다르다 — 전용 매트릭스로 분기.
          과목 칩·정렬은 각 뷰가 자기 것을 쓴다(주간표의 '오늘' 정렬은 월간에 의미가 없다). */}
      {isMonth ? (
        <WritingRateMonth view={view} />
      ) : filtered.length === 0 ? (
        <p className="text-text-faint text-sm">
          {rates.length === 0 ? "최근 작성 기록이 없습니다." : "이 과목 강사의 작성 기록이 없습니다."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead>
              <tr className="border-line text-text-faint group border-b">
                <SortableTh sortKey="teacher" state={sort} onSort={setSort}>
                  강사
                </SortableTh>
                <SortableTh sortKey="today" state={sort} onSort={setSort} align="center">
                  오늘
                </SortableTh>
                {dates.map((d) => (
                  <th key={d} className="px-2 py-2 text-center font-bold" title={d}>
                    {weekdayOf(d)}
                  </th>
                ))}
                <SortableTh sortKey="week" state={sort} onSort={setSort} align="center">
                  주간
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.teacher} className="border-line border-b last:border-b-0 align-top">
                  <td className="px-3 py-2">
                    <span className="text-foreground font-bold">{r.teacher}</span>
                    {/* 영어는 ClassNote 반 알림장이 소스라 셈법이 다르다 — 배지로 밝혀 둔다. */}
                    {r.source === "classnote" ? (
                      <span
                        className="border-line text-text-dim ml-1.5 rounded-full border px-1.5 py-0.5 text-xs"
                        title="영어는 강사가 ClassNote에 직접 쓰므로 반 알림장 기준으로 셉니다(반 단위 · 주간만)"
                      >
                        ClassNote
                      </span>
                    ) : null}
                    {r.todayMissing.length > 0 ? (
                      <p className="text-danger mt-0.5 text-xs">미작성: {nameList(r.todayMissing)}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.source === "classnote" ? (
                      // ⚠️ "수업 없음"으로 렌더하면 거짓말이다 — 수업은 있고 일간 집계가 없을 뿐.
                      <span
                        className="text-text-faint text-xs"
                        title="반 단위 알림장이라 '오늘 학생 몇 명분' 단위가 없습니다. 주간 합계만 집계합니다."
                      >
                        주간만 집계
                      </span>
                    ) : r.todayRate == null ? (
                      // ⚠️ 대상 0 = "수업 없음"이 아니다 — 저녁 수업만 있는 강사는 낮엔 '아직 시작 전'이다.
                      r.todayPending ? (
                        <span className="text-text-dim text-xs" title={pendingTitle(r.todayPending)}>
                          {r.todayPending.firstStart} 수업 예정
                        </span>
                      ) : (
                        <span className="text-text-faint text-xs">수업 없음</span>
                      )
                    ) : (
                      <span
                        className={`num text-sm font-bold ${rateTone(r.todayRate)}`}
                        title={r.todayPending ? pendingTitle(r.todayPending) : undefined}
                      >
                        {r.todayRate}%
                        <span className="text-text-faint num ml-1 text-xs font-normal">
                          {r.todayWritten}/{r.todayTarget}
                        </span>
                        {r.todayPending ? (
                          <span className="text-text-faint ml-1 text-xs font-normal">
                            +{r.todayPending.classes}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </td>
                  {r.daily.map((d) => (
                    <td key={d.date} className="px-2 py-2 text-center align-middle">
                      {d.target == null ? (
                        d.holiday ? (
                          // 휴일은 "·"(수업 없음)와 구분해 표기 — 왜 분모에서 빠졌는지 화면에서 읽히게.
                          <span
                            className="text-text-faint text-xs"
                            title={`휴일${d.holidayName ? `(${d.holidayName})` : ""} · 작성률에서 제외`}
                          >
                            휴일
                          </span>
                        ) : d.pending ? (
                          <span className="text-text-dim text-xs" title="오늘 수업이 아직 시작 전입니다">
                            수업 전
                          </span>
                        ) : (
                          <span className="text-text-faint text-xs">·</span>
                        )
                      ) : (
                        <span className={`num text-xs font-bold ${rateTone(d.rate)}`} title={`${d.written}/${d.target} 작성`}>
                          {d.rate}%
                          <span className="text-text-faint num block font-normal">{d.written}/{d.target}</span>
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center align-middle">
                    {r.weekTarget > 0 ? (
                      <span className={`num text-sm font-bold ${rateTone(r.weekRate)}`}>
                        {r.weekRate}%
                        <span className="text-text-faint num block text-xs font-normal">
                          {r.weekWritten}/{r.weekTarget}
                        </span>
                      </span>
                    ) : (
                      <span className="text-text-faint text-xs">·</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
