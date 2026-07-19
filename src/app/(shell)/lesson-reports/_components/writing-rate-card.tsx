"use client";

// 수업보고서 > 강사별 주간 작성률(Part B) — 이번 주(월~일) 작성 건수 + 오늘 작성률·미작성.
// [전체/과목] 칩으로 강사 분류(반 담당 기준 태깅, 학원설정 승인 과목만 칩 노출 — 하드코딩 금지).
// 예외 강사(report.writingExemptTeachers)는 서버 쿼리에서 이미 제외되어 여기 안 온다.
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

export function WritingRateCard({ view }: { view: WritingRatesView }) {
  const { dates, rates } = view;
  const subjects = useSubjectMaps();
  const [sel, setSel] = useState("all");
  // 칩 = 학원설정 승인 과목 중 실제 데이터에 등장하는 과목만(승인 밖 키·미태깅 강사는 '전체'에서만 보임).
  const chipOptions = useMemo(() => {
    const present = new Set(rates.flatMap((r) => r.subjects));
    return subjects.options.filter((o) => present.has(o.value));
  }, [rates, subjects.options]);
  const showChips = chipOptions.length >= 2;
  const filtered = sel === "all" || !showChips ? rates : rates.filter((r) => r.subjects.includes(sel));

  return (
    <section className="bg-card shadow-card rounded-2xl px-5 py-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        {/* 카드 헤더 위계(문법 ①) — 작은 소라벨 → 볼드 타이틀 → dim 서브 */}
        <div>
          <p className="editorial-eyebrow">작성 현황</p>
          <h2 className="text-foreground mt-0.5 text-[16px] font-bold">강사별 작성률</h2>
          <p className="text-text-faint mt-0.5 text-[12px]">이번 주(월~일) 요일별·주간 작성률 — 작성/대상(결석 제외)</p>
        </div>
        {showChips ? (
          <div className="flex flex-wrap gap-1.5">
            {[{ value: "all", label: "전체" }, ...chipOptions].map((o) => {
              const on = sel === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setSel(o.value)}
                  aria-pressed={on}
                  className={`rounded-full border px-3 py-1 text-[12px] transition ${
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

      {filtered.length === 0 ? (
        <p className="text-text-faint text-[13px]">
          {rates.length === 0 ? "최근 작성 기록이 없습니다." : "이 과목 강사의 작성 기록이 없습니다."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[12px]">
            <thead>
              <tr className="border-line text-text-faint border-b">
                <th className="px-3 py-2 font-bold">강사</th>
                <th className="px-3 py-2 text-center font-bold">오늘</th>
                {dates.map((d) => (
                  <th key={d} className="px-2 py-2 text-center font-bold" title={d}>
                    {weekdayOf(d)}
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-bold">주간</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.teacher} className="border-line border-b last:border-b-0 align-top">
                  <td className="px-3 py-2">
                    <span className="text-foreground font-bold">{r.teacher}</span>
                    {r.todayMissing.length > 0 ? (
                      <p className="text-danger mt-0.5 text-[11px]">미작성: {nameList(r.todayMissing)}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {r.todayRate == null ? (
                      <span className="text-text-faint text-[11px]">수업 없음</span>
                    ) : (
                      <span className={`num text-[14px] font-bold ${rateTone(r.todayRate)}`}>
                        {r.todayRate}%
                        <span className="text-text-faint num ml-1 text-[11px] font-normal">
                          {r.todayWritten}/{r.todayTarget}
                        </span>
                      </span>
                    )}
                  </td>
                  {r.daily.map((d) => (
                    <td key={d.date} className="px-2 py-2 text-center align-middle">
                      {d.target == null ? (
                        <span className="text-text-faint text-[11px]">·</span>
                      ) : (
                        <span className={`num text-[11px] font-bold ${rateTone(d.rate)}`} title={`${d.written}/${d.target} 작성`}>
                          {d.rate}%
                          <span className="text-text-faint num block font-normal">{d.written}/{d.target}</span>
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center align-middle">
                    {r.weekTarget > 0 ? (
                      <span className={`num text-[14px] font-bold ${rateTone(r.weekRate)}`}>
                        {r.weekRate}%
                        <span className="text-text-faint num block text-[11px] font-normal">
                          {r.weekWritten}/{r.weekTarget}
                        </span>
                      </span>
                    ) : (
                      <span className="text-text-faint text-[11px]">·</span>
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
