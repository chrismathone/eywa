"use client";

// 강사별 **월간** 작성률 매트릭스 — 행=강사, 열=1~31일, 셀=그날 작성률.
//
// 왜 달력이 아니라 매트릭스인가(원장 확정 2026-07-21): 이 화면에서 하는 일은 **강사끼리 비교**다.
// 강사뷰의 월간 달력은 한 사람의 한 달이라 비교가 안 되고, 출석부가 이미 `행=사람 × 열=1~31일`이라
// 같은 문법이면 새로 배울 게 없다. 주간표가 못 답하던 질문("이번 주만 그런가, 계속 그런가")에 답하는 게 목적.
//
// ⚠️ 셀 색은 작성률 규칙(rateTone)만 쓴다 — 출석부의 `--att-*` 팔레트를 다른 화면으로 가져오지 않는다.

import { useMemo, useState } from "react";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import type { WritingRatesView } from "@/features/report-admin/server/queries";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

function dayMeta(ymd: string): { day: number; dow: number } {
  const [y, m, d] = ymd.split("-").map(Number);
  return { day: d ?? 1, dow: new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)).getUTCDay() };
}

/** 셀 배경 — 100%는 조용하게(정상이 눈에 안 띄어야 예외가 보인다), 낮을수록 강해진다. */
function cellTone(rate: number | null): string {
  if (rate == null) return "text-text-faint";
  if (rate >= 90) return "bg-primary-soft text-primary";
  if (rate >= 60) return "bg-amber/20 text-amber";
  return "bg-danger/20 text-danger";
}

function totalTone(rate: number | null): string {
  if (rate == null) return "text-text-faint";
  if (rate >= 90) return "text-primary";
  if (rate >= 60) return "text-amber";
  return "text-danger";
}

export function WritingRateMonth({ view }: { view: WritingRatesView }) {
  const { dates, rates } = view;
  const subjects = useSubjectMaps();
  const [sel, setSel] = useState("all");

  const chipOptions = useMemo(() => {
    const present = new Set(rates.flatMap((r) => r.subjects));
    return subjects.options.filter((o) => present.has(o.value));
  }, [rates, subjects.options]);
  const showChips = chipOptions.length >= 2;
  const shown = sel === "all" ? rates : rates.filter((r) => r.subjects.includes(sel));

  // 정렬 = 월 작성률 낮은 순(worst 먼저) — 원장이 찾는 건 "안 쓰는 사람"이다. 대상 0(빈 행)은 맨 뒤.
  const sorted = useMemo(
    () =>
      [...shown].sort((a, b) => {
        const ar = a.weekTarget > 0 ? (a.weekRate ?? 0) : 1e9;
        const br = b.weekTarget > 0 ? (b.weekRate ?? 0) : 1e9;
        return ar - br || a.teacher.localeCompare(b.teacher, "ko");
      }),
    [shown],
  );

  const days = useMemo(() => dates.map(dayMeta), [dates]);
  // 휴일 날짜 — 헤더 숫자를 **일요일과 같은 색**으로(원장 2026-07-22). 휴일은 강사가 아니라 날짜의 성질이라
  // 어느 행에서 읽어도 같지만, 행이 비어 있을 수 있어 전 행을 훑어 모은다.
  const holidayDates = useMemo(() => {
    const s = new Set<string>();
    for (const r of rates) for (const c of r.daily) if (c.holiday) s.add(c.date);
    return s;
  }, [rates]);

  return (
    <div className="space-y-3">
      {showChips ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {[{ value: "all", label: "전체" }, ...chipOptions].map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => setSel(o.value)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                sel === o.value ? "bg-primary text-white" : "border-line text-text-dim hover:bg-bg-soft border"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      ) : null}

      <DragScrollArea className="bg-card shadow-card rounded-2xl">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="bg-bg-soft border-line sticky left-0 z-10 border-b border-r px-3 py-2 text-left whitespace-nowrap">
                <span className="micro">강사</span>
              </th>
              {days.map((d, i) => (
                <th
                  key={dates[i]}
                  className={`border-line min-w-[30px] border-b border-r px-1 py-2 text-center text-xs font-bold ${
                    d.dow === 0 || holidayDates.has(dates[i]!)
                      ? "text-danger"
                      : d.dow === 6
                        ? "text-blue"
                        : "text-text-dim"
                  }`}
                  title={`${dates[i]} (${WEEKDAY[d.dow]})${holidayDates.has(dates[i]!) ? " · 휴일" : ""}`}
                >
                  {d.day}
                </th>
              ))}
              <th className="bg-bg-soft border-line sticky right-0 z-10 border-b border-l px-3 py-2 text-right whitespace-nowrap">
                <span className="micro">월간</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.teacher} className="hover:bg-bg-soft/40">
                <td className="border-line text-foreground bg-card sticky left-0 z-10 border-b border-r px-3 py-2 text-xs font-bold whitespace-nowrap">
                  {r.teacher}
                  {/* 영어는 ClassNote 반 알림장 기준 — 일자 칸은 전부 '·'이고 월간 합계만 유효하다.
                      배지가 없으면 "매일 안 썼는데 합계는 있다"로 읽혀 오해를 산다. */}
                  {r.source === "classnote" ? (
                    <span
                      className="border-line text-text-dim ml-1.5 rounded-full border px-1.5 py-0.5 text-xs font-normal"
                      title="영어는 ClassNote 반 알림장 기준(반 단위) — 일자별은 집계하지 않고 어제까지의 합계만 셉니다"
                    >
                      ClassNote
                    </span>
                  ) : null}
                </td>
                {r.daily.map((c) => (
                  <td
                    key={c.date}
                    // 휴일은 "수업 없음(·)"과 눈으로도 구분되게 옅은 음영 — 분모에서 빠진 날임을 표에서 바로 읽게.
                    className={`border-line min-w-[30px] border-b border-r px-1 py-2 text-center text-xs font-bold ${
                      c.holiday ? "bg-bg-soft text-text-faint" : cellTone(c.rate)
                    }`}
                    title={
                      c.holiday
                        ? c.target == null
                          ? `${c.date} — 휴일${c.holidayName ? `(${c.holidayName})` : ""} · 작성률에서 제외`
                          : `${c.date} — 휴일${c.holidayName ? `(${c.holidayName})` : ""}인데 ${c.written}건 작성 · 한 일로 인정`
                        : c.target == null
                          ? c.pending
                            ? `${c.date} — 수업 전(대상은 수업이 시작된 뒤 잡힙니다)`
                            : `${c.date} — 수업 없음`
                          : `${c.date} — ${c.written}/${c.target}${c.rate == null ? "" : ` (${c.rate}%)`}`
                    }
                  >
                    {c.holiday && c.target == null ? "휴" : c.target == null ? "·" : c.rate == null ? "·" : `${c.rate}`}
                  </td>
                ))}
                <td className="border-line bg-card sticky right-0 z-10 border-b border-l px-3 py-2 text-right whitespace-nowrap">
                  <div className={`num text-xs font-bold ${totalTone(r.weekRate)}`}>
                    {r.weekRate == null ? "·" : `${r.weekRate}%`}
                  </div>
                  <div className="text-text-faint num text-xs">
                    {r.weekWritten}/{r.weekTarget}
                  </div>
                </td>
              </tr>
            ))}
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={days.length + 2} className="text-text-faint px-3 py-8 text-center text-sm">
                  이 과목에 해당하는 강사가 없습니다
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </DragScrollArea>

      <p className="text-text-faint text-xs break-keep">
        숫자 = 그날 작성률(%). 칸에 마우스를 올리면 작성/대상이 보입니다. <b>·</b> = 수업 없음(또는 아직 수업 전).
        오늘은 <b>시작된 수업까지만</b> 대상에 넣고, 이후 날짜는 판정하지 않습니다.
      </p>
    </div>
  );
}
