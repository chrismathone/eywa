"use client";

import { useEffect, useState } from "react";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { formatKoreanDate } from "@/lib/date-kst";
import { BEFORE_CLASS_ITEMS, percentLabel } from "../items";
import { groupStats, totalStat, type DayRecord, type PeriodStat, type StatUnit } from "../stats";
import { getBeforeClassStudentHistory } from "../server/stats-actions";
import type { RosterStudent } from "../types";
import { CardCounts } from "./badges";

type Loaded = { days: DayRecord[]; since: string | null } | { error: string };

/**
 * 학생 통계(원장 2026-10-28 *"학생별 통계도 보고 싶음 주간, 월간 등등"*) — 학생을 고르면 그 학생의 이 반 기록(추적 시작 ~ 오늘,
 * 최대 6개월)을 서버에서 한 번 받아 주간·월간으로 묶는다(묶기는 화면 안 · stats.ts). 받은 기록은 학생마다 기억해 다시 안 부른다.
 * 막대 = 완료율 한 가지(한 색) · 값은 막대 옆 글자로도 적는다.
 */
export function StudentStats({ classId, students, version }: { classId: string; students: RosterStudent[]; version: number }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [unit, setUnit] = useState<StatUnit>("week");
  const [cache, setCache] = useState<Record<string, Loaded>>({});
  const student = students.find((s) => s.id === picked) ?? students[0] ?? null;
  const cacheKey = student ? `${student.id}|${version}` : "";
  const loaded = cacheKey ? cache[cacheKey] : undefined;

  useEffect(() => {
    if (!student || loaded) return;
    let alive = true;
    void getBeforeClassStudentHistory({ classId, studentId: student.id }).then((res) => {
      if (!alive) return;
      setCache((c) => ({ ...c, [cacheKey]: res.ok ? { days: res.days, since: res.since } : { error: res.error } }));
    });
    return () => { alive = false; };
  }, [classId, student, cacheKey, loaded]);

  if (!student) return <p className="text-text-dim px-1 py-6 text-sm">이 달 이 반 명단에 학생이 없습니다.</p>;
  return (
    <div className="flex flex-col gap-4 px-1 lg:flex-row lg:items-start">
      <ul className="flex flex-wrap gap-1.5 lg:w-48 lg:shrink-0 lg:flex-col" aria-label="학생 고르기">
        {students.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => setPicked(s.id)}
              className={`w-full rounded-lg px-2.5 py-1.5 text-left text-sm whitespace-nowrap ${s.id === student.id ? "bg-primary text-primary-foreground font-bold" : "hover:bg-bg-soft border-line border"}`}
            >
              {s.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-base font-bold">{student.name} <span className="text-text-dim text-sm font-normal">{student.schoolGrade}</span></p>
          <ToolbarSegment label="묶음">
            <ToolbarSegmentItem active={unit === "week"} onClick={() => setUnit("week")}>주간</ToolbarSegmentItem>
            <ToolbarSegmentItem active={unit === "month"} onClick={() => setUnit("month")}>월간</ToolbarSegmentItem>
          </ToolbarSegment>
        </div>
        {!loaded ? (
          <div className="bg-muted h-48 animate-pulse rounded-2xl" role="status" aria-label="기록 불러오는 중" />
        ) : "error" in loaded ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-danger">{loaded.error}</span>
            {/* 실패는 기억하지 않는다 — 지우면 위 effect가 다시 부른다. */}
            <button type="button" className="text-primary underline" onClick={() => setCache((c) => { const n = { ...c }; delete n[cacheKey]; return n; })}>
              다시 시도
            </button>
          </div>
        ) : loaded.days.length === 0 ? (
          <p className="text-text-dim py-6 text-sm">아직 이 반에서 체크한 기록이 없습니다.</p>
        ) : (
          <StatsBody days={loaded.days} unit={unit} since={loaded.since} />
        )}
      </div>
    </div>
  );
}

function StatsBody({ days, unit, since }: { days: DayRecord[]; unit: StatUnit; since: string | null }) {
  const total = totalStat(days);
  const periods = groupStats(days, unit);
  const attended = total.lessons - total.absentCount - total.excusedCount;
  return (
    <>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="평균 완료율" value={percentLabel(total.average)} />
        <Tile label="수업" value={`${total.lessons}회`} />
        <Tile label="보충 필요" value={`${total.supplementCount}회`} />
        <Tile label="결석" value={`${total.absentCount}회${total.excusedCount ? ` · 제외 ${total.excusedCount}회` : ""}`} />
      </dl>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold">받은 카드</span>
        <CardCounts counts={total.cardCounts} />
      </div>
      <p className="text-text-dim text-xs">
        {since ? `${formatKoreanDate(since)}부터의 기록 · ` : ""}체크가 없는 수업일은 모두 해 온 것으로 셉니다(시트와 같은 기준).
      </p>
      <section>
        <h3 className="mb-1.5 text-sm font-bold">{unit === "week" ? "주간" : "월간"} 추이</h3>
        <PeriodTable periods={periods} />
      </section>
      <section>
        <h3 className="mb-1.5 text-sm font-bold">항목별 미흡 <span className="text-text-dim font-normal">(체크한 수업 {attended}회 중)</span></h3>
        <ul className="space-y-1.5">
          {BEFORE_CLASS_ITEMS.map((i) => {
            const n = total.itemCounts[i.key];
            return (
              <li key={i.key} className="grid grid-cols-[6.5rem_1fr_3.5rem] items-center gap-2 text-sm">
                <span className="break-keep">{i.short}</span>
                <Bar ratio={attended ? n / attended : 0} />
                <span className="text-right tabular-nums">{n}회</span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function PeriodTable({ periods }: { periods: PeriodStat[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
        <thead>
          <tr className="border-line border-b text-xs">
            <th className="px-2 py-2 text-left font-semibold">기간</th>
            <th className="px-2 py-2 text-center font-semibold">수업</th>
            <th className="w-[40%] px-2 py-2 text-left font-semibold">완료율</th>
            <th className="px-2 py-2 text-center font-semibold">보충 필요</th>
            <th className="px-2 py-2 text-center font-semibold">결석</th>
            <th className="px-2 py-2 text-left font-semibold">카드</th>
            <th className="px-2 py-2 text-left font-semibold">자주 놓친 항목</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => {
            const top = BEFORE_CLASS_ITEMS.map((i) => ({ label: i.short, n: p.itemCounts[i.key] }))
              .filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
            return (
              <tr key={p.key} className="border-line-faint border-b">
                <td className="px-2 py-1.5 whitespace-nowrap">{p.label}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{p.lessons}</td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <Bar ratio={p.average ?? 0} />
                    <span className="w-11 shrink-0 text-right font-semibold tabular-nums">{percentLabel(p.average)}</span>
                  </div>
                </td>
                <td className={`px-2 py-1.5 text-center tabular-nums ${p.supplementCount ? "text-amber font-semibold" : ""}`}>{p.supplementCount || "—"}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{p.absentCount || "—"}</td>
                <td className="px-2 py-1.5"><CardCounts counts={p.cardCounts} /></td>
                <td className="px-2 py-1.5 text-xs">{top.length ? top.map((t) => `${t.label} ${t.n}`).join(" · ") : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-line rounded-2xl border px-3 py-2">
      <dt className="text-text-dim text-xs">{label}</dt>
      <dd className="text-lg font-bold tabular-nums">{value}</dd>
    </div>
  );
}

/** 한 색 막대(0~1) — 값은 옆 글자가 말한다(색만으로 읽히지 않게). */
function Bar({ ratio }: { ratio: number }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <div className="bg-bg-soft h-2.5 min-w-16 flex-1 overflow-hidden rounded-full" aria-hidden>
      <div className="bg-primary h-full rounded-full" style={{ width: `${pct}%` }} />
    </div>
  );
}
