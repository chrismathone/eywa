"use client";

import { shortDateLabel } from "../dates";
import {
  BEFORE_CLASS_ITEMS, completionRate, effectiveCard, excuseText, isExcused, needsSupplement, percentLabel, summarizeStudent, type BeforeClassCheck,
} from "../items";
import { checkKey, type RosterStudent } from "../types";
import { DONE_CHECK, isRecordedDay } from "../stats";
import { encodeTip } from "@/components/hover-tip/tip";
import { CardBadge } from "./badges";

/**
 * 월별 현황 — 학생 줄 × 수업일 칸(완료율 · 결석 · 카드) + 평균 · 보충 필요 횟수 · 결석 · 자주 놓친 항목.
 * 시트의 'X열 평균'과 'Y열 항목별 누적'을 한 표로 접었다. 날짜 머리를 누르면 그날 체크 화면으로 간다.
 * 시트처럼 **체크가 없는 칸 = 모두 해 옴**(100%) — 추적 시작(이 반 첫 체크) ~ 오늘의 수업일만(stats.ts `isRecordedDay`).
 * 그 밖의 날은 '—' · 그날 명단에 없던 학생은 빈 칸.
 */
export function MonthTable({
  dates, students, checks, today, trackingStart, onPickDate,
}: {
  dates: string[];
  today: string;
  trackingStart: string | null;
  students: RosterStudent[];
  checks: Record<string, BeforeClassCheck>;
  onPickDate: (date: string) => void;
}) {
  if (students.length === 0) return <p className="text-text-dim px-1 py-6 text-sm">이 달 이 반 명단에 학생이 없습니다.</p>;
  return (
    <div className="overflow-x-auto px-1">
      <table className="w-full border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
        <thead>
          <tr className="border-line border-b">
            <th className="bg-background sticky left-0 z-10 px-2 py-2 text-left font-semibold">이름</th>
            {dates.map((d) => (
              <th key={d} className="px-1 py-2 text-center text-xs font-semibold whitespace-nowrap">
                <button type="button" className="hover:text-primary underline-offset-2 hover:underline" onClick={() => onPickDate(d)}>
                  {shortDateLabel(d)}
                </button>
              </th>
            ))}
            <th className="px-2 py-2 text-center text-xs font-semibold">평균</th>
            <th className="px-2 py-2 text-center text-xs font-semibold">보충 필요</th>
            <th className="px-2 py-2 text-center text-xs font-semibold">결석</th>
            <th className="px-2 py-2 text-left text-xs font-semibold">자주 놓친 항목</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => {
            const own = s.activeDates.filter((d) => isRecordedDay(d, today, trackingStart)).map((d) => checks[checkKey(s.id, d)] ?? DONE_CHECK);
            const sum = summarizeStudent(own);
            const top = BEFORE_CLASS_ITEMS
              .map((i) => ({ label: i.short, count: sum.itemCounts.get(i.key) ?? 0 }))
              .filter((x) => x.count > 0)
              .sort((a, b) => b.count - a.count)
              .slice(0, 3);
            return (
              <tr key={s.id} className="border-line-faint border-b">
                <td className="bg-background sticky left-0 z-10 px-2 py-1.5 whitespace-nowrap">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-text-dim ml-1.5 text-xs">{s.schoolGrade}</span>
                </td>
                {dates.map((d) => <MonthCell key={d} active={s.activeDates.includes(d)} check={checks[checkKey(s.id, d)] ?? (isRecordedDay(d, today, trackingStart) ? DONE_CHECK : undefined)} />)}
                <td className="px-2 py-1.5 text-center font-semibold tabular-nums">{percentLabel(sum.average)}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{sum.supplementCount || "—"}</td>
                <td className="px-2 py-1.5 text-center tabular-nums">{sum.absentCount || "—"}</td>
                <td className="px-2 py-1.5 text-xs">
                  {top.length ? top.map((t) => `${t.label} ${t.count}`).join(" · ") : <span className="text-text-dim">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MonthCell({ active, check }: { active: boolean; check: BeforeClassCheck | undefined }) {
  if (!active) return <td className="bg-bg-soft px-1 py-1.5" />;
  if (!check) return <td className="text-text-dim px-1 py-1.5 text-center">—</td>;
  if (isExcused(check)) {
    // 체크 제외 — 완료율·카드 없이 '제외'(사유는 마우스 오버 카드).
    return <td className="bg-bg-soft text-text-dim px-1 py-1.5 text-center text-xs" data-tip={encodeTip({ title: "체크 제외", lines: [excuseText(check) || "사유 없음"] })}>제외</td>;
  }
  const tone = check.absent ? "bg-danger-soft text-danger" : needsSupplement(check) ? "bg-amber-soft text-amber" : "bg-blue-soft text-blue";
  return (
    <td className={`px-1 py-1 text-center ${tone}`}>
      <div className="font-semibold tabular-nums">{check.absent ? "결석" : percentLabel(completionRate(check))}</div>
      {effectiveCard(check) ? <div className="mt-0.5"><CardBadge card={effectiveCard(check)} /></div> : null}
    </td>
  );
}
